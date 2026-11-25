"""Classroom mode: a teacher starts a class and gets a join code; students join
from their own devices. The teacher sees each student's board (a small picture
sent every few seconds), sends a question to everyone, and can show their own
board to the class. Plain polling, no sockets: it works through any proxy.

Teachers are users the admin marked as teacher (access.py role), and admins.
"""
import base64
import secrets
import time

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

import access

router = APIRouter()
MAX_SNAP = 600_000          # characters of data URL: a page picture, small JPEG
LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # no 0/O or 1/I to misread off a projector


def setup():
    access.q("""CREATE TABLE IF NOT EXISTS classes (code TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL,
                created REAL NOT NULL, ended REAL, task TEXT, task_at REAL, snap BLOB, snap_at REAL)""")
    access.q("""CREATE TABLE IF NOT EXISTS members (code TEXT NOT NULL, email TEXT NOT NULL, name TEXT, picture TEXT,
                joined REAL NOT NULL, seen REAL NOT NULL, snap BLOB, snap_at REAL, PRIMARY KEY (code, email))""")


def me(request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "Please sign in.")
    return user


def live_class(code):
    rows = access.q("SELECT * FROM classes WHERE code = ?", ((code or "").upper(),))
    if not rows:
        raise HTTPException(404, "There's no class with that code.")
    return dict(rows[0])


def owned(code, request):
    c = live_class(code)
    if c["owner"] != me(request)["email"]:
        raise HTTPException(403, "Only the class's teacher can do that.")
    return c


def jpeg(data_url):
    """A page picture from the browser, as bytes; None clears it (an empty board)."""
    if not data_url:
        return None
    if not (isinstance(data_url, str) and data_url.startswith("data:image/jpeg;base64,")) or len(data_url) > MAX_SNAP:
        raise HTTPException(400, "That picture isn't usable.")
    try:
        return base64.b64decode(data_url[23:], validate=True)
    except ValueError:
        raise HTTPException(400, "That picture isn't usable.")


def picture_response(blob, at):
    if not blob:
        return Response(status_code=204)
    return Response(blob, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600", "X-Snap-At": str(at or 0)})


# ------------------------------------------------------------------ the teacher
class NewClass(BaseModel):
    title: str = ""


@router.post("/api/classes")
def start(body: NewClass, request: Request):
    user = me(request)
    if not user.get("teacher"):
        raise HTTPException(403, "Only teachers can start a class. Ask the admin to make you a teacher.")
    for _ in range(20):
        code = "".join(secrets.choice(LETTERS) for _ in range(6))
        if not access.q("SELECT 1 FROM classes WHERE code = ?", (code,)):
            break
    title = " ".join(body.title.split())[:80] or f"{user['name'] or 'My'} class"
    access.q("INSERT INTO classes (code, owner, title, created) VALUES (?, ?, ?, ?)", (code, user["email"], title, time.time()))
    access.log(request, "started class", f"{title} ({code})")
    return {"code": code, "title": title}


@router.get("/api/classes/mine")
def mine(request: Request):
    rows = access.q("SELECT code, title, created FROM classes WHERE owner = ? AND ended IS NULL ORDER BY created DESC",
                    (me(request)["email"],))
    return [dict(r) for r in rows]


@router.get("/api/classes/{code}")
def view(code: str, request: Request):
    """The teacher's view: who is in, and when each board last changed."""
    c = owned(code, request)
    rows = access.q("SELECT email, name, picture, joined, seen, snap_at FROM members WHERE code = ? ORDER BY name",
                    (c["code"],))
    now = time.time()
    return {"code": c["code"], "title": c["title"], "task": c["task"], "ended": c["ended"],
            "students": [{**dict(r), "online": now - r["seen"] < 20} for r in rows]}


@router.get("/api/classes/{code}/snap/{email}")
def student_board(code: str, email: str, request: Request):
    c = owned(code, request)
    rows = access.q("SELECT snap, snap_at FROM members WHERE code = ? AND email = ?", (c["code"], email.lower()))
    return picture_response(rows[0]["snap"], rows[0]["snap_at"]) if rows else Response(status_code=404)


class TaskIn(BaseModel):
    text: str


@router.post("/api/classes/{code}/task")
def send_task(code: str, body: TaskIn, request: Request):
    c = owned(code, request)
    text = " ".join(body.text.split())[:500]
    access.q("UPDATE classes SET task = ?, task_at = ? WHERE code = ?", (text or None, time.time(), c["code"]))
    if text:
        access.log(request, "sent class question", text[:120])
    return {"ok": True}


class SnapIn(BaseModel):
    image: str | None = None


@router.post("/api/classes/{code}/show")
def show_board(code: str, body: SnapIn, request: Request):
    """The teacher's own board for the class to see (None: stop showing it)."""
    c = owned(code, request)
    access.q("UPDATE classes SET snap = ?, snap_at = ? WHERE code = ?", (jpeg(body.image), time.time(), c["code"]))
    return {"ok": True}


@router.post("/api/classes/{code}/end")
def end(code: str, request: Request):
    c = owned(code, request)
    access.q("UPDATE classes SET ended = ? WHERE code = ?", (time.time(), c["code"]))
    access.log(request, "ended class", c["title"])
    return {"ok": True}


# ------------------------------------------------------------------ the students
class JoinIn(BaseModel):
    code: str


@router.post("/api/classes/join")
def join(body: JoinIn, request: Request):
    user = me(request)
    c = live_class(body.code.strip())
    if c["ended"]:
        raise HTTPException(410, "That class has ended.")
    now = time.time()
    access.q("""INSERT INTO members (code, email, name, picture, joined, seen) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(code, email) DO UPDATE SET seen = excluded.seen""",
             (c["code"], user["email"], user["name"], user["picture"], now, now))
    access.log(request, "joined class", c["title"])
    return {"code": c["code"], "title": c["title"], "own": c["owner"] == user["email"]}


@router.post("/api/classes/{code}/me")
def checkin(code: str, body: SnapIn, request: Request):
    """A student's few-second check-in: their board's picture (when it changed), and back
    what the class needs from them: the teacher's question, whether the class is over."""
    user = me(request)
    c = live_class(code)
    member = access.q("SELECT 1 FROM members WHERE code = ? AND email = ?", (c["code"], user["email"]))
    if not member:
        raise HTTPException(403, "Join the class first.")
    if body.image is not None:
        access.q("UPDATE members SET seen = ?, snap = ?, snap_at = ? WHERE code = ? AND email = ?",
                 (time.time(), jpeg(body.image), time.time(), c["code"], user["email"]))
    else:
        access.q("UPDATE members SET seen = ? WHERE code = ? AND email = ?", (time.time(), c["code"], user["email"]))
    return {"title": c["title"], "task": c["task"], "task_at": c["task_at"], "ended": c["ended"],
            "showing": bool(c["snap"]), "snap_at": c["snap_at"]}


@router.get("/api/classes/{code}/teacher")
def teacher_board(code: str, request: Request):
    user = me(request)
    c = live_class(code)
    if not access.q("SELECT 1 FROM members WHERE code = ? AND email = ?", (c["code"], user["email"])) and c["owner"] != user["email"]:
        raise HTTPException(403, "Join the class first.")
    return picture_response(c["snap"], c["snap_at"])


@router.post("/api/classes/{code}/leave")
def leave(code: str, request: Request):
    access.q("DELETE FROM members WHERE code = ? AND email = ?", (code.upper(), me(request)["email"]))
    return {"ok": True}
