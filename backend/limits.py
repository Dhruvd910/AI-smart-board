"""Rate limits and daily caps.

There is no sign-in, so a visitor is their IP address. The per-minute limits
live in memory on each instance -- a visitor bouncing between Cloud Run
instances gets a little more, which is fine. The daily caps are in the database
so they hold across every instance: they are what stops a busy day, or a
script, from emptying the OpenRouter and Cartesia accounts.
"""
import threading
import time
from collections import defaultdict, deque

import db
import settings

_lock = threading.Lock()
_hits = defaultdict(deque)


class Limited(Exception):
    def __init__(self, message, retry_after=30):
        super().__init__(message)
        self.retry_after = retry_after


def per_minute(bucket, visitor, limit):
    now = time.monotonic()
    key = (bucket, visitor)
    with _lock:
        hits = _hits[key]
        while hits and now - hits[0] > 60:
            hits.popleft()
        if len(hits) >= limit:
            raise Limited("Too many requests. Wait a moment and try again.",
                          retry_after=int(60 - (now - hits[0])) + 1)
        hits.append(now)
        # Keep the table from growing with every visitor who ever came by.
        if len(_hits) > 5000:
            for stale in [k for k, v in _hits.items() if not v or now - v[-1] > 60]:
                del _hits[stale]


def daily(key, cap, amount=1):
    if cap <= 0:
        return
    try:
        if db.usage(key) + amount > cap:
            raise Limited("Liza's demo has reached today's limit. Please come back tomorrow.",
                          retry_after=3600)
        db.add_usage(key, amount)
    except Limited:
        raise
    except Exception as exc:
        # A database hiccup should not take the demo down with it.
        print(f"[LIMITS] Could not check the daily cap ({exc}).", flush=True)


def visitor_of(request):
    # Vercel puts the address it saw in its own header, which a visitor
    # cannot set.
    real = request.headers.get("x-vercel-forwarded-for")
    if real:
        return real.split(",")[0].strip()
    # Cloud Run's front end APPENDS the address it saw, so the last entry is
    # the real one; anything before it came from the visitor and can be made up.
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"
