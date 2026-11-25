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


# ------------------------------------------------------------------ neat writing, summaries, questions
def _png(data_url):
    """The page as the browser drew it: a PNG data URL, checked before it goes to the model."""
    if not (isinstance(data_url, str) and data_url.startswith("data:image/png;base64,")):
        raise HTTPException(400, "Write or draw something first.")
    if len(data_url) > 6_000_000:
        raise HTTPException(413, "That is too much to read at once. Select a part of it.")
    return data_url


def _ask_picture(prompt, image, max_tokens):
    messages = [{"role": "user", "content": prompt}]
    if image:
        messages = brain.attach_picture(messages, image, "Reply with the JSON only.")
    try:
        return _json_in(brain.complete(messages, max_tokens=max_tokens))
    except Exception as exc:
        print(f"[STUDY] {exc}", flush=True)
        raise HTTPException(502, "I couldn't reach the AI just now. Try again.")


def level_words(cls):
    """The student's level as words for a prompt: "Class 8", "college (undergraduate)"..."""
    import profiles
    norm = profiles.normalise_class(cls)
    if norm in profiles.LEVEL_WORDS:
        return profiles.LEVEL_WORDS[norm]
    return f"Class {norm}" if norm and norm.isdigit() else "Class 8"


SYLLABI = {"cbse": "CBSE (NCERT textbooks)", "icse": "ICSE / ISC", "state": "their state board", "ib": "IB",
           "igcse": "Cambridge IGCSE", "other": ""}
LANGUAGES = {"en": "English", "hi": "Hindi", "mr": "Marathi", "bn": "Bengali", "ta": "Tamil", "te": "Telugu",
             "gu": "Gujarati", "kn": "Kannada", "ml": "Malayalam", "pa": "Punjabi", "ur": "Urdu", "or": "Odia"}


def audience(cls, syllabus="", lang=""):
    """Who it is for, as a prompt phrase: level, syllabus, and the language to write in."""
    words = level_words(cls)
    if SYLLABI.get(syllabus) and words.startswith("Class"):
        words += f", following the {SYLLABI[syllabus]} syllabus and its terms"
    language = LANGUAGES.get(lang, "English")
    if language != "English":
        words += f". Write every word of the reply in {language} (in its own script); keep maths symbols and numbers as they are"
    return words


NEATEN_PROMPT = (
    "This is handwriting from a student's whiteboard. Copy out exactly what is written, cleaned up: "
    "correct spelling of words they clearly meant, but never add, answer or solve anything. Keep each "
    "written line as one line. Maths in plain text with Unicode symbols (x², √, ≤, π, →). Keep the "
    "student's own language and script.\n"
    "Reply with JSON only: {\"lines\": [\"...\"], \"drawing\": false}\n"
    "Set \"drawing\": true if the picture is mostly a drawing, graph or diagram rather than writing "
    "(then copy only the words written on it, if any).")


class NeatenIn(BaseModel):
    image: str


@router.post("/api/neaten")
def neaten(body: NeatenIn, request: Request):
    raw = _ask_picture(NEATEN_PROMPT, _png(body.image), 500) or {}
    lines = [_words(l, 200) for l in (raw.get("lines") or []) if isinstance(l, str) and _words(l)][:30]
    if lines:
        access.log(request, "neatened", lines[0][:120])
    return {"lines": lines, "drawing": bool(raw.get("drawing"))}


STUDY_PROMPTS = {
    "summary": (
        "Summarise everything on this student's whiteboard page for a student at this level: {level}. "
        "Topic hint (what was read off the page): {topic}\n"
        "Reply with JSON only: {{\"title\": \"short title\", \"points\": [\"one clear sentence\", ...]}}\n"
        "3 to 7 points, in the order the ideas build up, each under 25 words, at that level's depth. "
        "Fix any mistake you see on the board in the point itself. Correct facts only."),
    "questions": (
        "Write practice questions about the topic on this student's whiteboard, for a student at this level: "
        "{level}. Topic (read off the page): {topic}\n"
        "Reply with JSON only: {{\"topic\": \"short topic name\", \"questions\": [{{\"q\": \"the question\", "
        "\"answer\": \"a short worked answer\", \"level\": \"easy|medium|hard\"}}, ...]}}\n"
        "Exactly 6 questions: 2 easy, 2 medium, 2 hard, as an exam at that level would ask them -- a mix of "
        "recall, understanding and, where the topic has numbers, a calculation with the values given. "
        "Answers under 60 words; maths in plain text with Unicode symbols. Correct facts only."),
}


class StudyIn(BaseModel):
    kind: str
    image: str = ""   # the page; questions can also come from a typed topic alone
    topic: str = ""
    cls: str = ""
    syllabus: str = ""
    lang: str = ""


@router.post("/api/study")
def study(body: StudyIn, request: Request):
    if body.kind not in STUDY_PROMPTS:
        raise HTTPException(400, "Unknown request.")
    level = level_words(body.cls)
    prompt = STUDY_PROMPTS[body.kind].format(level=audience(body.cls, body.syllabus, body.lang), topic=_words(body.topic, 200) or "(read it from the picture)")
    if not body.image and (body.kind == "summary" or not body.topic.strip()):
        raise HTTPException(400, "Write or draw something first.")
    image = _png(body.image) if body.image else None
    for _ in range(2):  # one retry if the reply isn't usable JSON
        raw = _ask_picture(prompt, image, 1400)
        out = clean_study(body.kind, raw)
        if out:
            access.log(request, "made summary" if body.kind == "summary" else "made questions",
                       out.get("title") or out.get("topic") or body.topic[:120])
            return {"kind": body.kind, "level": level, **out}
    raise HTTPException(502, "I couldn't make that one. Try again.")


def clean_study(kind, raw):
    """The model's JSON reduced to what the panel shows; None if it isn't usable."""
    if not isinstance(raw, dict):
        return None
    if kind == "summary":
        points = [_words(p, 300) for p in raw.get("points") or [] if isinstance(p, str) and _words(p)][:8]
        return {"title": _words(raw.get("title"), 80) or "Summary", "points": points} if points else None
    qs = []
    for q in raw.get("questions") or []:
        if isinstance(q, dict) and _words(q.get("q")) and _words(q.get("answer")):
            lvl = q.get("level") if q.get("level") in ("easy", "medium", "hard") else "medium"
            qs.append({"q": _words(q["q"], 400), "answer": _words(q["answer"], 600), "level": lvl})
    return {"topic": _words(raw.get("topic"), 80), "questions": qs[:10]} if len(qs) >= 2 else None


# ------------------------------------------------------------------ check my work
CHECK_PROMPT = (
    "A student at this level: {level} has worked a problem on their whiteboard (the picture). Mark it like a "
    "kind teacher. Read their working line by line. For each line say if it is right, and if not, what is "
    "wrong in a short note -- point at the mistake, NEVER write the corrected line or the final answer.\n"
    "Reply with JSON only: {{\"problem\": \"what they are solving, short\", \"lines\": [{{\"work\": \"the line as "
    "written\", \"ok\": true, \"note\": \"\"}}], \"verdict\": \"correct|mistake|incomplete\", \"hint\": \"one "
    "question or nudge that helps them find the next step themselves\", \"praise\": \"one specific thing they did well\"}}\n"
    "\"correct\" only when the final answer is there and right. Maths in plain text with Unicode symbols.")


class CheckIn(BaseModel):
    image: str
    cls: str = ""
    syllabus: str = ""
    lang: str = ""


def clean_check(raw):
    if not isinstance(raw, dict):
        return None
    lines = [{"work": _words(l.get("work"), 200), "ok": l.get("ok") is not False, "note": _words(l.get("note"), 200)}
             for l in raw.get("lines") or [] if isinstance(l, dict) and _words(l.get("work"))][:20]
    verdict = raw.get("verdict") if raw.get("verdict") in ("correct", "mistake", "incomplete") else None
    if not lines or not verdict:
        return None
    if verdict == "correct" and not all(l["ok"] for l in lines):
        verdict = "mistake"  # a wrong line can't be a right answer
    return {"problem": _words(raw.get("problem"), 120), "lines": lines, "verdict": verdict,
            "hint": _words(raw.get("hint"), 240), "praise": _words(raw.get("praise"), 160)}


@router.post("/api/check")
def check(body: CheckIn, request: Request):
    image = _png(body.image)
    prompt = CHECK_PROMPT.format(level=audience(body.cls, body.syllabus, body.lang))
    for _ in range(2):
        out = clean_check(_ask_picture(prompt, image, 1200))
        if out:
            access.log(request, "checked work", f"{out['problem'] or 'a problem'}: {out['verdict']}")
            return {**out, "level": level_words(body.cls)}
    raise HTTPException(502, "I couldn't check that one. Try again.")
