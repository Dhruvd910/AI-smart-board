"""A copy of the database every day, the last 14 kept, next to it in data/backups/.

SQLite's own backup API, so a copy taken while people are saving is still a
consistent one. shortcut: the copies live on the same server disk -- they save
you from a bad change or a deleted board, not from losing the server; for that,
also turn on Lightsail's automatic snapshots (or copy data/backups off the server).
"""
import os
import sqlite3
import threading
import time

import access

KEEP = int(os.getenv("WB_BACKUPS_KEEP", "14"))


def folder():
    return os.path.join(os.path.dirname(access.DB_PATH), "backups")


def backup_now():
    """Today's copy (taken once a day); returns its path."""
    os.makedirs(folder(), exist_ok=True)
    path = os.path.join(folder(), f"whiteboard-{time.strftime('%Y-%m-%d', time.gmtime())}.db")
    if not os.path.exists(path):
        target = sqlite3.connect(path + ".part")
        with access._lock:
            access.db().backup(target)
        target.close()
        os.replace(path + ".part", path)
        print(f"[BACKUP] {path}", flush=True)
    old = sorted(f for f in os.listdir(folder()) if f.startswith("whiteboard-") and f.endswith(".db"))
    for name in old[:-KEEP]:
        os.remove(os.path.join(folder(), name))
    return path


def start():
    def loop():
        while True:
            try:
                backup_now()
            except Exception as exc:  # a full disk must not take the site down
                print(f"[BACKUP] failed: {exc}", flush=True)
            time.sleep(3600)  # checks hourly, copies once a day
    threading.Thread(target=loop, name="backups", daemon=True).start()
