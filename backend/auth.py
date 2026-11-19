"""Who is asking: the signed-in account behind a request.

The pages sign people in with Firebase Authentication (email and password;
Firebase itself sends the verification and password-reset emails) and send
the Firebase ID token with every call as `Authorization: Bearer <token>`.
It is checked here with Firebase's own accounts:lookup, which also says
whether the email has been verified -- no new dependency and no key file.
"""
import threading
import time

import httpx
from fastapi import HTTPException, Request

import settings

LOOKUP = "https://identitytoolkit.googleapis.com/v1/accounts:lookup"
CACHE_S = 300                 # a token is re-checked with Firebase every five minutes
_cache, _lock = {}, threading.Lock()


def account_of(request: Request):
    """The verified account's Firebase uid, or a 401 the page answers by
    showing the sign-in screen."""
    header = request.headers.get("authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else ""
    if not token or not settings.FIREBASE_API_KEY:
        raise HTTPException(401, "Please sign in.")
    now = time.time()
    with _lock:
        hit = _cache.get(token)
    if hit and hit[1] > now:
        uid, verified = hit[0], hit[2]
    else:
        try:
            reply = httpx.post(LOOKUP, params={"key": settings.FIREBASE_API_KEY},
                               json={"idToken": token}, timeout=10)
        except httpx.HTTPError:
            raise HTTPException(503, "Sign-in could not be checked. Try again.")
        users = reply.json().get("users") if reply.status_code == 200 else None
        if not users:
            raise HTTPException(401, "Please sign in again.")
        uid, verified = users[0]["localId"], bool(users[0].get("emailVerified"))
        with _lock:
            if len(_cache) > 5000:
                _cache.clear()
            _cache[token] = (uid, now + CACHE_S, verified)
    if not verified:
        raise HTTPException(403, "Please verify your email first.")
    return uid
