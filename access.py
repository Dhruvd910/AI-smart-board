"""Sign-in with Google, the people allowed in, and what they did.

On when GOOGLE_CLIENT_ID is set; without it (tests, the Pi on its own) the
board is open as before. New people wait for an admin to let them in; the
emails in ADMIN_EMAILS are admins and always in. Everything is kept in one
SQLite file (WB_DATA, default data/whiteboard.db).
"""
import os
import secrets
import sqlite3
import threading
import time

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
ADMINS = {e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}
DB_PATH = os.getenv("WB_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "whiteboard.db"))
COOKIE = "wb_session"
SESSION_DAYS = 30
STATUSES = ("pending", "active", "blocked")
OPEN = {"/api/status", "/api/auth/config", "/api/auth/google", "/api/auth/me", "/api/auth/logout"}

_lock = threading.Lock()
_db = None


def db():
    global _db
    if _db is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        _db = sqlite3.connect(DB_PATH, check_same_thread=False)
        _db.row_factory = sqlite3.Row
        _db.executescript("""
            CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, name TEXT, picture TEXT,
                status TEXT NOT NULL, created REAL NOT NULL, last_seen REAL);
            CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, email TEXT NOT NULL, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY, email TEXT NOT NULL, at REAL NOT NULL,
                kind TEXT NOT NULL, detail TEXT);
            CREATE INDEX IF NOT EXISTS activity_email ON activity(email, at);
            CREATE TABLE IF NOT EXISTS usage (email TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL,
                PRIMARY KEY (email, day));
        """)
        if "role" not in [c[1] for c in _db.execute("PRAGMA table_info(users)")]:
            _db.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'student'")  # teacher or student
            _db.commit()
    return _db


def q(sql, args=()):
    with _lock:
        cur = db().execute(sql, args)
        db().commit()
        return cur.fetchall()


def is_admin(email):
    return email.lower() in ADMINS


def user_of(request):
    return user_by_token(request.cookies.get(COOKIE))


def user_by_token(token):
    """The signed-in user's row as a dict, or None."""
    if not token:
        return None
    rows = q("SELECT u.* FROM sessions s JOIN users u ON u.email = s.email WHERE s.token = ? AND s.expires > ?",
             (token, time.time()))
    if not rows:
        return None
    user = dict(rows[0])
    user["admin"] = is_admin(user["email"])
    if user["admin"]:
        user["status"] = "active"
    user["teacher"] = user["admin"] or user.get("role") == "teacher"
    return user


def log(request, kind, detail=""):
    """One line in the activity log for whoever is signed in (nothing when sign-in is off).
    Only the name of what they did and when, never the drawing itself."""
    user = getattr(request.state, "user", None)
    if user:
        q("INSERT INTO activity (email, at, kind, detail) VALUES (?, ?, ?, ?)",
          (user["email"], time.time(), kind, str(detail or "")[:500]))


# Calls that cost money at the AI provider: counted per person per day, with a ceiling.
AI_PATHS = {"/api/turn", "/api/board/read", "/api/diagram", "/api/study", "/api/neaten", "/api/check", "/api/visual"}
DAILY_AI = int(os.getenv("WB_DAILY_AI", "500"))
DAILY_AI_TEACHER = int(os.getenv("WB_DAILY_AI_TEACHER", "1500"))


def today():
    return time.strftime("%Y-%m-%d", time.gmtime())


def spend(user):
    """Count one AI call; False when today's limit is used up (admins have none)."""
    if user["admin"]:
        return True
    limit = DAILY_AI_TEACHER if user["teacher"] else DAILY_AI
    with _lock:
        row = db().execute("SELECT n FROM usage WHERE email = ? AND day = ?", (user["email"], today())).fetchone()
        if row and row[0] >= limit:
            return False
        db().execute("INSERT INTO usage (email, day, n) VALUES (?, ?, 1) ON CONFLICT(email, day) DO UPDATE SET n = n + 1",
                     (user["email"], today()))
        db().commit()
    return True


async def guard(request: Request, call_next):
    """Middleware: every /api call but sign-in itself needs an active user; /api/admin an admin."""
    request.state.user = None
    path = request.url.path
    if not CLIENT_ID or not path.startswith("/api/") or path in OPEN:
        return await call_next(request)
    user = user_of(request)
    if not user:
        return JSONResponse({"detail": "Please sign in."}, status_code=401)
    if user["status"] != "active":
        return JSONResponse({"detail": f"Your account is {user['status']}.", "status": user["status"]}, status_code=403)
    if path.startswith("/api/admin/") and not user["admin"]:
        return JSONResponse({"detail": "Admins only."}, status_code=403)
    request.state.user = user
    if path in AI_PATHS and not spend(user):
        return JSONResponse({"detail": "You've used today's AI limit. It resets at midnight (UTC)."}, status_code=429)
    if time.time() - (user["last_seen"] or 0) > 60:
        q("UPDATE users SET last_seen = ? WHERE email = ?", (time.time(), user["email"]))
    return await call_next(request)


def verify_google(credential):
    """Google's own check of a Sign in with Google ID token; the claims, or None."""
    try:
        r = httpx.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": credential}, timeout=10)
    except httpx.HTTPError:
        raise HTTPException(502, "Couldn't reach Google. Try again.")
    if r.status_code != 200:
        return None
    claims = r.json()
    ok = (claims.get("aud") == CLIENT_ID
          and claims.get("iss") in ("accounts.google.com", "https://accounts.google.com")
          and str(claims.get("email_verified")).lower() == "true"
          and float(claims.get("exp", 0)) > time.time())
    return claims if ok else None


router = APIRouter()


@router.get("/api/auth/config")
def config():
    return {"enabled": bool(CLIENT_ID), "client_id": CLIENT_ID}


class GoogleIn(BaseModel):
    credential: str


@router.post("/api/auth/google")
def google(body: GoogleIn, request: Request):
    if not CLIENT_ID:
        raise HTTPException(404, "Sign-in is off.")
    claims = verify_google(body.credential[:5000])
    if not claims:
        raise HTTPException(401, "Google couldn't confirm that sign-in.")
    email = claims["email"].lower()
    now = time.time()
    if not q("SELECT 1 FROM users WHERE email = ?", (email,)):
        q("INSERT INTO users (email, name, picture, status, created, last_seen) VALUES (?, ?, ?, ?, ?, ?)",
          (email, claims.get("name", ""), claims.get("picture", ""), "active" if is_admin(email) else "pending", now, now))
    else:
        q("UPDATE users SET name = ?, picture = ?, last_seen = ? WHERE email = ?",
          (claims.get("name", ""), claims.get("picture", ""), now, email))
    token = secrets.token_urlsafe(32)
    q("INSERT INTO sessions (token, email, expires) VALUES (?, ?, ?)", (token, email, now + SESSION_DAYS * 86400))
    q("INSERT INTO activity (email, at, kind, detail) VALUES (?, ?, 'sign in', '')", (email, now))
    response = JSONResponse(me_of(user_by_token(token)))
    response.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax",
                        secure=request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https")
    return response


def me_of(user):
    if not user:
        return {"signed_in": False, "enabled": bool(CLIENT_ID)}
    return {"signed_in": True, "enabled": True, "email": user["email"], "name": user["name"],
            "picture": user["picture"], "status": user["status"], "admin": user["admin"], "teacher": user["teacher"]}


@router.get("/api/auth/me")
def me(request: Request):
    if not CLIENT_ID:
        return {"signed_in": False, "enabled": False}
    return me_of(user_of(request))


@router.post("/api/auth/logout")
def logout(request: Request):
    token = request.cookies.get(COOKIE)
    if token:
        q("DELETE FROM sessions WHERE token = ?", (token,))
    response = JSONResponse({"signed_in": False})
    response.delete_cookie(COOKIE)
    return response


# ------------------------------------------------------------------ a person's own history
@router.get("/api/me/history")
def my_history(request: Request, limit: int = 200):
    rows = q("SELECT id, at, kind, detail FROM activity WHERE email = ? AND kind != 'sign in' ORDER BY at DESC LIMIT ?",
             (request.state.user["email"], max(1, min(limit, 1000))))
    return [dict(r) for r in rows]


@router.post("/api/me/delete")
def delete_me(request: Request):
    """Erase the person and everything kept about them (the right to erasure)."""
    email = request.state.user["email"]
    if is_admin(email):
        raise HTTPException(400, "An admin account can't delete itself here.")
    steps = [(f"DELETE FROM {t} WHERE email = ?", (email,)) for t in ("boards", "activity", "usage", "members", "sessions", "users")]
    steps.append(("UPDATE classes SET ended = COALESCE(ended, ?), snap = NULL WHERE owner = ?", (time.time(), email)))
    for sql, args in steps:
        try:
            q(sql, args)
        except sqlite3.OperationalError:
            pass  # a table this server doesn't have (a feature off)
    response = JSONResponse({"deleted": True})
    response.delete_cookie(COOKIE)
    return response


# ------------------------------------------------------------------ the admin's view
@router.get("/api/admin/users")
def users():
    rows = q("""SELECT u.*, (SELECT COUNT(*) FROM activity a WHERE a.email = u.email) AS actions,
                COALESCE((SELECT n FROM usage g WHERE g.email = u.email AND g.day = ?), 0) AS ai_today
                FROM users u ORDER BY (u.status = 'pending') DESC, u.last_seen DESC""", (today(),))
    return [{**dict(r), "admin": is_admin(r["email"])} for r in rows]


class StatusIn(BaseModel):
    status: str


@router.post("/api/admin/users/{email}")
def set_status(email: str, body: StatusIn):
    email = email.lower()
    if body.status not in STATUSES:
        raise HTTPException(400, "Unknown status.")
    if is_admin(email):
        raise HTTPException(400, "Admins can't be changed here.")
    if not q("SELECT 1 FROM users WHERE email = ?", (email,)):
        raise HTTPException(404, "No such user.")
    q("UPDATE users SET status = ? WHERE email = ?", (body.status, email))
    if body.status == "blocked":
        q("DELETE FROM sessions WHERE email = ?", (email,))  # signed out everywhere at once
    return {"email": email, "status": body.status}


class RoleIn(BaseModel):
    role: str


@router.post("/api/admin/users/{email}/role")
def set_role(email: str, body: RoleIn):
    """Teachers can start classes and have a higher daily AI limit."""
    email = email.lower()
    if body.role not in ("teacher", "student"):
        raise HTTPException(400, "Unknown role.")
    if not q("SELECT 1 FROM users WHERE email = ?", (email,)):
        raise HTTPException(404, "No such user.")
    q("UPDATE users SET role = ? WHERE email = ?", (body.role, email))
    return {"email": email, "role": body.role}


@router.get("/api/admin/activity")
def activity(email: str = "", limit: int = 200):
    limit = max(1, min(limit, 1000))
    if email:
        rows = q("SELECT * FROM activity WHERE email = ? ORDER BY at DESC LIMIT ?", (email.lower(), limit))
    else:
        rows = q("SELECT * FROM activity ORDER BY at DESC LIMIT ?", (limit,))
    return [dict(r) for r in rows]
