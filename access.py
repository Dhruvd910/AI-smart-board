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
        """)
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
    return user


def log(request, kind, detail=""):
    """One line in the activity log for whoever is signed in (nothing when sign-in is off).
    Only the name of what they did and when, never the drawing itself."""
    user = getattr(request.state, "user", None)
    if user:
        q("INSERT INTO activity (email, at, kind, detail) VALUES (?, ?, ?, ?)",
          (user["email"], time.time(), kind, str(detail or "")[:500]))


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
            "picture": user["picture"], "status": user["status"], "admin": user["admin"]}


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


# ------------------------------------------------------------------ the admin's view
@router.get("/api/admin/users")
def users():
    rows = q("""SELECT u.*, (SELECT COUNT(*) FROM activity a WHERE a.email = u.email) AS actions
                FROM users u ORDER BY (u.status = 'pending') DESC, u.last_seen DESC""")
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


@router.get("/api/admin/activity")
def activity(email: str = "", limit: int = 200):
    limit = max(1, min(limit, 1000))
    if email:
        rows = q("SELECT * FROM activity WHERE email = ? ORDER BY at DESC LIMIT ?", (email.lower(), limit))
    else:
        rows = q("SELECT * FROM activity ORDER BY at DESC LIMIT ?", (limit,))
    return [dict(r) for r in rows]
