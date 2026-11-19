"""The web demo's database: profiles, conversation turns, progress, usage.

PostgreSQL, like the device, but its own tables in its own database (see
settings.DATABASE_URL). There is no sign-in, so nothing here is private to a
visitor except by being unguessable: a profile id is a random UUID, the picker
lists only the demo profiles plus the ids this browser created, and everything
is wiped after DEMO_RESET_HOURS.

One autocommit connection behind a lock, reopened when it drops -- the same
shape as Liza's store.py, and plenty for a demo.
"""
import random
import threading
import uuid

import psycopg
from psycopg.rows import dict_row

import settings

_lock = threading.RLock()
_conn = None
_ready = False      # tables made and demo students in, this process

SCHEMA = """
CREATE TABLE IF NOT EXISTS web_profiles (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    class       TEXT NOT NULL,
    board       TEXT,
    avatar      INT  NOT NULL,
    demo        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS web_turns (
    id          BIGSERIAL PRIMARY KEY,
    profile_id  TEXT NOT NULL REFERENCES web_profiles(id) ON DELETE CASCADE,
    mode        TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS web_turns_profile ON web_turns (profile_id, id);
CREATE TABLE IF NOT EXISTS web_progress (
    id          BIGSERIAL PRIMARY KEY,
    profile_id  TEXT NOT NULL REFERENCES web_profiles(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    topic       TEXT NOT NULL,
    detail      TEXT,
    score       INT,
    out_of      INT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The account (Firebase uid) a student belongs to; NULL for the demo students.
ALTER TABLE web_profiles ADD COLUMN IF NOT EXISTS owner TEXT;
CREATE INDEX IF NOT EXISTS web_profiles_owner ON web_profiles (owner);
CREATE INDEX IF NOT EXISTS web_progress_profile ON web_progress (profile_id, id);
CREATE TABLE IF NOT EXISTS web_usage (
    day   DATE NOT NULL,
    key   TEXT NOT NULL,
    n     BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, key)
);
"""

# Made-up names: this page is public, and the device's real students stay on
# the device. Fixed ids, so a browser that remembers one keeps finding it.
DEMO_PROFILES = [
    ("demo-kg", "Aarav", "KG", None, 1),
    ("demo-3", "Meera", "3", "CBSE", 2),
    ("demo-6", "Kabir", "6", "CBSE", 6),
    ("demo-10", "Anaya", "10", "CBSE", 4),
]

CLASS_VALUES = ["KG"] + [str(n) for n in range(1, 13)]
BOARDS = ["CBSE", "ICSE", "State", "Other"]
AVATARS = 12


def connect():
    global _conn
    with _lock:
        if _conn is not None and not _conn.closed:
            return _conn
        _conn = psycopg.connect(settings.DATABASE_URL, autocommit=True,
                                row_factory=dict_row)
        return _conn


def run(sql, params=None, fetch=None):
    """One statement. fetch: None, "one" or "all". Retries once on a dropped
    connection, which is what a Cloud SQL restart looks like from here."""
    global _conn
    ensure()
    for attempt in range(2):
        try:
            with _lock:
                with connect().cursor() as cur:
                    cur.execute(sql, params)
                    if fetch == "one":
                        return cur.fetchone()
                    if fetch == "all":
                        return cur.fetchall()
                    return cur.rowcount
        except psycopg.OperationalError:
            with _lock:
                _conn = None
            if attempt:
                raise


def ensure():
    """Make the tables on first use. On Vercel there is no server start to do
    it at: each function instance starts cold, and its first query does this."""
    global _ready
    if _ready:
        return
    with _lock:
        if _ready:
            return
        _ready = True        # before init(), whose own queries come back here
        try:
            init()
        except Exception:
            _ready = False
            raise


def init():
    with _lock:
        with connect().cursor() as cur:
            cur.execute(SCHEMA)
    for pid, name, cls, board, avatar in DEMO_PROFILES:
        run("""INSERT INTO web_profiles (id, name, class, board, avatar, demo)
               VALUES (%s, %s, %s, %s, %s, TRUE)
               ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,
                   class = EXCLUDED.class, board = EXCLUDED.board,
                   avatar = EXCLUDED.avatar, demo = TRUE""",
            (pid, name, cls, board, avatar))
    cleanup()


def cleanup():
    """Forget visitors: their own profiles once unused for DEMO_RESET_HOURS,
    and whatever the demo profiles collected before that."""
    hours = settings.DEMO_RESET_HOURS
    # Only students no account owns: an account's students are kept.
    run("""DELETE FROM web_profiles WHERE NOT demo AND owner IS NULL
           AND last_seen < now() - make_interval(hours => %s)""", (hours,))
    run("""DELETE FROM web_turns WHERE created_at < now() - make_interval(hours => %s)
           AND profile_id IN (SELECT id FROM web_profiles WHERE demo)""", (hours,))
    run("""DELETE FROM web_progress WHERE created_at < now() - make_interval(hours => %s)
           AND profile_id IN (SELECT id FROM web_profiles WHERE demo)""", (hours,))
    run("DELETE FROM web_usage WHERE day < current_date - 7")


# ----- profiles -----

def _public(row):
    if not row:
        return None
    return {"id": row["id"], "name": row["name"], "class": row["class"],
            "board": row["board"], "avatar": row["avatar"], "demo": row["demo"],
            "owner": row.get("owner")}


def list_profiles(owner):
    rows = run("SELECT * FROM web_profiles WHERE owner = %s ORDER BY created_at",
               (owner,), fetch="all")
    return [_public(r) for r in rows]


def get_profile(pid):
    return _public(run("SELECT * FROM web_profiles WHERE id = %s", (pid,), fetch="one"))


def touch(pid):
    run("UPDATE web_profiles SET last_seen = now() WHERE id = %s", (pid,))


def create_profile(name, class_value, board, owner):
    pid = uuid.uuid4().hex
    run("""INSERT INTO web_profiles (id, name, class, board, avatar, owner)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (pid, name, class_value, board, random.randint(1, AVATARS), owner))
    return get_profile(pid)


def update_profile(pid, name, class_value, board):
    run("""UPDATE web_profiles SET name = %s, class = %s, board = %s, last_seen = now()
           WHERE id = %s AND NOT demo""", (name, class_value, board, pid))
    return get_profile(pid)


def delete_profile(pid):
    return run("DELETE FROM web_profiles WHERE id = %s AND NOT demo", (pid,))


# ----- conversation -----

def add_turn(pid, mode, role, content):
    run("INSERT INTO web_turns (profile_id, mode, role, content) VALUES (%s, %s, %s, %s)",
        (pid, mode, role, content))


def recent_turns(pid, limit=12):
    rows = run("""SELECT role, content, mode, created_at FROM web_turns
                  WHERE profile_id = %s ORDER BY id DESC LIMIT %s""",
               (pid, limit), fetch="all")
    return list(reversed(rows))


def history(pid, limit=200):
    rows = run("""SELECT role, content, mode, created_at FROM web_turns
                  WHERE profile_id = %s ORDER BY id DESC LIMIT %s""",
               (pid, limit), fetch="all")
    return [{"role": r["role"], "content": r["content"], "mode": r["mode"],
             "at": r["created_at"].isoformat()} for r in reversed(rows)]


def clear_history(pid):
    run("DELETE FROM web_turns WHERE profile_id = %s", (pid,))


# ----- progress -----

def add_progress(pid, kind, topic, detail=None, score=None, out_of=None):
    run("""INSERT INTO web_progress (profile_id, kind, topic, detail, score, out_of)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (pid, kind, topic, detail, score, out_of))


def progress(pid, limit=100):
    rows = run("""SELECT kind, topic, detail, score, out_of, created_at FROM web_progress
                  WHERE profile_id = %s ORDER BY id DESC LIMIT %s""",
               (pid, limit), fetch="all")
    return [{**{k: r[k] for k in ("kind", "topic", "detail", "score", "out_of")},
             "at": r["created_at"].isoformat()} for r in rows]


# ----- usage, for the daily caps shared by every Cloud Run instance -----

def add_usage(key, n):
    row = run("""INSERT INTO web_usage (day, key, n) VALUES (current_date, %s, %s)
                 ON CONFLICT (day, key) DO UPDATE SET n = web_usage.n + EXCLUDED.n
                 RETURNING n""", (key, n), fetch="one")
    return row["n"] if row else n


def usage(key):
    row = run("SELECT n FROM web_usage WHERE day = current_date AND key = %s",
              (key,), fetch="one")
    return row["n"] if row else 0


def progress_totals(pid):
    """store.progress_totals: one row per kind, newest kind first."""
    rows = run("""SELECT kind, COUNT(*) AS times, COUNT(DISTINCT topic) AS different,
                         SUM(score) AS scored, SUM(out_of) AS available,
                         MAX(created_at) AS last_seen
                    FROM web_progress WHERE profile_id = %s
                   GROUP BY kind ORDER BY MAX(created_at) DESC""", (pid,), fetch="all")
    return [{"kind": r["kind"], "times": r["times"], "different": r["different"],
             "scored": r["scored"] or 0, "available": r["available"] or 0,
             "last_seen": r["last_seen"].isoformat() if r["last_seen"] else None} for r in rows]


# Dates as the child's own: the server keeps UTC, and "yesterday" is Indian time.
LOCAL_TZ = "Asia/Kolkata"


def today():
    return run("SELECT (now() AT TIME ZONE %s)::date AS d", (LOCAL_TZ,), fetch="one")["d"].isoformat()


def daily_activity(pid, days=35):
    """store.daily_activity: {"YYYY-MM-DD": {kind: count}} for the last `days` days."""
    rows = run("""SELECT (created_at AT TIME ZONE %s)::date AS day, kind, COUNT(*) AS n
                    FROM web_progress
                   WHERE profile_id = %s
                     AND (created_at AT TIME ZONE %s)::date >= (now() AT TIME ZONE %s)::date - %s
                   GROUP BY 1, 2""", (LOCAL_TZ, pid, LOCAL_TZ, LOCAL_TZ, days - 1), fetch="all")
    out = {}
    for r in rows:
        out.setdefault(r["day"].isoformat(), {})[r["kind"]] = int(r["n"])
    return out


def progress_topics(pid, kind, limit=200):
    """store.progress_topics: how often each topic of one kind was done."""
    rows = run("""SELECT topic, COUNT(*) AS times FROM web_progress
                   WHERE profile_id = %s AND kind = %s GROUP BY topic
                   ORDER BY MAX(created_at) DESC LIMIT %s""", (pid, kind, limit), fetch="all")
    return [{"topic": r["topic"], "times": int(r["times"])} for r in rows]
