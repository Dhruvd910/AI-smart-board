"""Each person's boards, kept on the server (the "Saved just now" in the top bar),
share links that hand someone else their own copy, and mind maps / flowcharts
made by the AI as plain node lists the page lays out and draws.

Needs sign-in (access.py): without it the page keeps the board in the browser only.
"""
import json
import re
import secrets
import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import access
import brain

MAX_BOARD = 12_000_000   # bytes of JSON; pictures on the board are most of it
router = APIRouter()


def setup():
    access.q("""CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, email TEXT NOT NULL, title TEXT NOT NULL,
                data TEXT NOT NULL, updated REAL NOT NULL, share TEXT UNIQUE)""")
    access.q("CREATE INDEX IF NOT EXISTS boards_email ON boards(email, updated)")


def me(request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "Please sign in.")
    return user["email"]


def mine(board_id, email):
    rows = access.q("SELECT * FROM boards WHERE id = ? AND email = ?", (board_id, email))
    if not rows:
        raise HTTPException(404, "No such board.")
    return dict(rows[0])


def new_board(email, title, data):
    board_id = secrets.token_urlsafe(9)
    access.q("INSERT INTO boards (id, email, title, data, updated) VALUES (?, ?, ?, ?, ?)",
             (board_id, email, title[:120] or "Untitled board", data, time.time()))
    return board_id


@router.get("/api/boards")
def list_boards(request: Request):
    rows = access.q("SELECT id, title, updated FROM boards WHERE email = ? ORDER BY updated DESC", (me(request),))
    return [dict(r) for r in rows]


class NewIn(BaseModel):
    title: str = "Untitled board"
    data: dict | None = None


@router.post("/api/boards")
def create(body: NewIn, request: Request):
    data = json.dumps(body.data or {"pages": [{"items": []}]})
    if len(data) > MAX_BOARD:
        raise HTTPException(413, "That board is too big to save.")
    board_id = new_board(me(request), body.title.strip(), data)
    access.log(request, "new board", body.title.strip()[:120])
    return {"id": board_id}


@router.get("/api/boards/{board_id}")
def load(board_id: str, request: Request):
    b = mine(board_id, me(request))
    return {"id": b["id"], "title": b["title"], "updated": b["updated"], "data": json.loads(b["data"])}


class SaveIn(BaseModel):
    title: str | None = None
    data: dict | None = None


@router.put("/api/boards/{board_id}")
def save(board_id: str, body: SaveIn, request: Request):
    b = mine(board_id, me(request))
    title = (body.title.strip()[:120] or "Untitled board") if body.title is not None else b["title"]
    data = json.dumps(body.data) if body.data is not None else b["data"]
    if len(data) > MAX_BOARD:
        raise HTTPException(413, "That board is too big to save. Take a picture or two off it.")
    now = time.time()
    access.q("UPDATE boards SET title = ?, data = ?, updated = ? WHERE id = ?", (title, data, now, board_id))
    return {"id": board_id, "title": title, "updated": now}


@router.delete("/api/boards/{board_id}")
def delete(board_id: str, request: Request):
    mine(board_id, me(request))
    access.q("DELETE FROM boards WHERE id = ?", (board_id,))
    return {"deleted": board_id}


@router.post("/api/boards/{board_id}/share")
def share(board_id: str, request: Request):
    b = mine(board_id, me(request))
    token = b["share"] or secrets.token_urlsafe(12)
    access.q("UPDATE boards SET share = ? WHERE id = ?", (token, board_id))
    return {"token": token}


@router.post("/api/shared/{token}")
def open_shared(token: str, request: Request):
    """Someone opened a share link: they get their own copy, the owner's board stays as it is."""
    email = me(request)
    rows = access.q("SELECT * FROM boards WHERE share = ?", (token,))
    if not rows:
        raise HTTPException(404, "That share link doesn't work any more.")
    b = rows[0]
    if b["email"] == email:
        return {"id": b["id"], "own": True}
    board_id = new_board(email, f"{b['title']} (copy)", b["data"])
    access.log(request, "opened shared board", b["title"])
    return {"id": board_id, "own": False}


# ------------------------------------------------------------------ mind maps and flowcharts
DIAGRAM_PROMPTS = {
    "mindmap": ("Make a mind map for a school student about: {topic}\n"
                "Reply with JSON only, no prose: {{\"center\": \"short title\", \"branches\": "
                "[{{\"label\": \"2-4 words\", \"children\": [\"2-5 words\", ...]}}, ...]}}\n"
                "4 to 6 branches, 2 to 3 children each. Correct facts only."),
    "flowchart": ("Make a flowchart for a school student about: {topic}\n"
                  "Reply with JSON only, no prose: {{\"nodes\": [{{\"id\": \"n1\", \"label\": \"step in at most 6 words\", "
                  "\"type\": \"start|step|decision|end\"}}, ...], \"links\": [{{\"from\": \"n1\", \"to\": \"n2\", "
                  "\"label\": \"\"}}, ...]}}\n"
                  "5 to 10 nodes, one start, at least one end; label decision branches just Yes or No. Correct facts only."),
}


def _json_in(text):
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except ValueError:
        return None


def _words(v, n=60):
    """Tidied to at most n characters, cut between words with an ellipsis."""
    text = " ".join(str(v or "").split())
    if len(text) <= n:
        return text
    cut = text[:n - 1].rsplit(" ", 1)[0] if " " in text[:n - 1] else text[:n - 1]
    return cut.rstrip(" ,;:-(") + "…"


def clean_diagram(kind, raw):
    """The model's JSON reduced to what the page draws; None if it isn't usable."""
    if not isinstance(raw, dict):
        return None
    if kind == "mindmap":
        branches = []
        for b in raw.get("branches") or []:
            if isinstance(b, dict) and _words(b.get("label")):
                kids = [_words(c) for c in (b.get("children") or []) if _words(c)][:5]
                branches.append({"label": _words(b["label"]), "children": kids})
        center = _words(raw.get("center"))
        return {"center": center, "branches": branches[:8]} if center and len(branches) >= 2 else None
    nodes, ids = [], set()
    for n in raw.get("nodes") or []:
        if isinstance(n, dict) and _words(n.get("id"), 20) and _words(n.get("label")) and n["id"] not in ids:
            ids.add(n["id"])
            kind_ = n.get("type") if n.get("type") in ("start", "step", "decision", "end") else "step"
            nodes.append({"id": _words(n["id"], 20), "label": _words(n["label"]), "type": kind_})
    links = [{"from": l["from"], "to": l["to"], "label": _words(l.get("label"), 20)}
             for l in raw.get("links") or []
             if isinstance(l, dict) and l.get("from") in ids and l.get("to") in ids and l["from"] != l["to"]]
    return {"nodes": nodes[:14], "links": links[:24]} if len(nodes) >= 2 else None


class DiagramIn(BaseModel):
    kind: str
    topic: str


@router.post("/api/diagram")
def diagram(body: DiagramIn, request: Request):
    kind, topic = body.kind, _words(body.topic, 200)
    if kind not in DIAGRAM_PROMPTS or not topic:
        raise HTTPException(400, "Say what the diagram should be about.")
    prompt = DIAGRAM_PROMPTS[kind].format(topic=topic)
    for _ in range(2):  # one retry if the reply isn't usable JSON
        try:
            out = clean_diagram(kind, _json_in(brain.complete([{"role": "user", "content": prompt}], max_tokens=900)))
        except Exception as exc:
            print(f"[DIAGRAM] {exc}", flush=True)
            raise HTTPException(502, "I couldn't reach the AI just now. Try again.")
        if out:
            access.log(request, "made " + ("mind map" if kind == "mindmap" else "flowchart"), topic)
            return {"kind": kind, "topic": topic, **out}
    raise HTTPException(502, "I couldn't make that one. Try saying the topic another way.")
