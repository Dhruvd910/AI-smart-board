"""The whiteboard's server: the page in public/, and the board's brains in backend/.

Self-contained: backend/ holds its own copy of the reading, answering, graph,
geometry and 3D code, and .env its own keys. Nothing outside this folder is used.

    .venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8095
"""
import base64
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "backend")
sys.path.insert(0, BACKEND)
os.environ.setdefault("LIZA_DIR", os.path.join(BACKEND, "liza"))
os.environ.setdefault("SERVE_FRONTEND", "0")
os.environ.setdefault("LIZA_STORE", "0")  # no student records from here

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.middleware.gzip import GZipMiddleware  # noqa: E402
from fastapi.responses import Response, StreamingResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from PIL import Image  # noqa: E402
from pydantic import BaseModel  # noqa: E402

import board as board_kit  # noqa: E402
import brain  # noqa: E402
import explorer  # noqa: E402
import geolab  # noqa: E402
import model3d  # noqa: E402
import voice  # noqa: E402
import whiteboard  # noqa: E402
from liza import prompts  # noqa: E402
import access  # noqa: E402  (after the backend, which loads .env)

app = FastAPI(title="Whiteboard", docs_url=None, redoc_url=None)
# The 3D captures are JSON that shrinks to about a quarter (an answer's NDJSON is flushed as it comes).
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.middleware("http")(access.guard)
app.include_router(access.router)
import boards  # noqa: E402
boards.setup()
app.include_router(boards.router)
CLASSES = {str(n) for n in range(1, 13)}


def profile(cls):
    # Her answers are pitched at the student's class, as on the device.
    return {"class": cls if cls in CLASSES else os.getenv("WB_CLASS", "8"), "name": "Student"}


def picture(data_url):
    """A PNG data: URL from the page as a PIL image, or None."""
    if not (isinstance(data_url, str) and data_url.startswith("data:image/png;base64,")):
        return None
    if len(data_url) > 6_000_000:
        raise HTTPException(413, "That picture is too big.")
    try:
        return Image.open(io.BytesIO(base64.b64decode(data_url[22:], validate=True))).convert("RGB")
    except ValueError:
        raise HTTPException(400, "bad picture")


# ------------------------------------------------------------------ the live reading
class ReadIn(BaseModel):
    strokes: list
    hindi: bool = False
    image: str | None = None  # only when typed text is on screen, which strokes can't carry


@app.post("/api/board/read")
def board_read(body: ReadIn, request: Request):
    """whiteboard.Reader, as Liza's web server does it (board.read_page)."""
    found = read_board(body)
    if found.get("read"):
        access.log(request, "wrote", found["read"])
    return found


def read_board(body):
    try:
        image = picture(body.image)
        if image is None:
            return board_kit.read_page(body.strokes, body.hindi)
        found = whiteboard.read(image)
        strokes = board_kit._strokes(body.strokes)
        measured = whiteboard.measure_drawing(strokes, found) if found.get("read") else None
        if measured:
            found = dict(found, measure=dict(measured, name=found.get("shape") or ""),
                         measure_names=whiteboard.figure_names(measured))
        found["suggest"] = whiteboard.suggestions(found, body.hindi) if found.get("read") else []
        return found
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[BOARD] Reading failed ({exc}).", flush=True)
        return {"read": "", "suggest": []}


# ------------------------------------------------------------------ asking her
class TurnIn(BaseModel):
    text: str = ""
    board_ask: str = ""          # "ask" or "solve": Ask Liza / Solve it with nothing said
    board_strokes: list | None = None
    board_image: str | None = None
    heard_language: str = ""
    screen: dict | None = None   # what is up: the lab, her buttons (for ON_BOARD / BUTTONS)
    explorer: dict | None = None  # the 3D Explorer's view, when it is open
    history: list | None = None  # [{role, content}], this browser's last few turns
    cls: str = ""


@app.post("/api/turn")
def turn(body: TurnIn, request: Request):
    """Liza web's /api/turn without accounts: her prompt, the page as a picture
    with BOARD_NOTE, her reply streamed sentence by sentence, her one action."""
    board_url = None
    if body.board_image and picture(body.board_image) is not None:
        board_url = body.board_image
    elif body.board_strokes:
        board_url = board_kit.sketch(body.board_strokes)
    heard = body.heard_language.strip().lower()[:16]
    text = " ".join(body.text.split())[:600]
    if not text and board_url and body.board_ask:
        # Ask Liza / Solve it / Balance it with nothing said: the device's own words for them.
        lang = "hi" if heard in ("hi", "hinglish") else "en"
        questions = prompts.BOARD_SOLVE_QUESTIONS.get(body.board_ask, prompts.BOARD_ASK_QUESTIONS)
        text = questions.get(lang, questions["en"])
    if not text:
        return StreamingResponse(iter([brain.to_ndjson({"type": "done", "answer": "", "empty": True})]),
                                 media_type="application/x-ndjson")
    access.log(request, "asked", text)
    language = brain.detect_language(text, heard)
    shown = body.screen if isinstance(body.screen, dict) else {}
    lab = geolab.for_turn(shown.get("geometry"), text)
    on_board = explorer.board_line(body.explorer) or board_kit.on_board_line(shown)
    buttons = board_kit.offers_line(shown)
    system = brain.system_prompt(profile(body.cls), "TUTOR", language, None, on_board,
                                 whiteboard=bool(board_url), buttons=buttons)
    turns = [t for t in (body.history or [])[-12:]
             if isinstance(t, dict) and t.get("role") in ("user", "assistant") and isinstance(t.get("content"), str)]
    messages = ([{"role": "system", "content": system}] + brain.history_messages(turns)
                + [{"role": "user", "content": f"User: {text}"}])
    if board_url:
        messages = brain.attach_picture(messages, board_url, prompts.BOARD_NOTE)
    if lab:
        messages[0]["content"] = messages[0]["content"].replace(
            "GEOMETRY: " + geolab.device_line(None), "GEOMETRY: " + lab["line"], 1)
    hindi = language in ("hi", "hinglish")

    def events():
        yield brain.to_ndjson({"type": "heard", "text": text, "language": language})
        if lab and lab["picks"]:
            yield brain.to_ndjson({"type": "geometry_pick", "picks": lab["picks"]})
        acted, said = False, []
        for event in brain.stream_reply(messages, language, board=bool(board_url)):
            if event["type"] == "action":
                if not acted:  # one action per reply, as on the device
                    acted = True
                    for out in act(event["raw"], hindi, said if board_url else None):
                        yield brain.to_ndjson(out)
                continue
            if event["type"] == "sentence":
                said.append(event["text"])
            if event["type"] == "done" and event.get("answer") and not acted:
                # No tag: still a button for what the question was about (offer_for_topic).
                try:
                    offer = model3d.offer_for_topic(text, board_kit.make_offer, hindi, shown.get("visual"))
                except Exception as exc:
                    print(f"[3D] No topic button ({exc})", flush=True)
                    offer = None
                if offer:
                    yield brain.to_ndjson({"type": "offers", "offers": [offer]})
            yield brain.to_ndjson(event)

    return StreamingResponse(events(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


def act(raw, hindi, said_lines):
    """Her action tag done as Liza web's app._act does it."""
    name, param = board_kit.first_tag(f"[ACTION: {raw}]")
    if name == "show_visual":
        kind = (param or "").partition("|")[0].strip().lower()
        if kind == "solution":
            worked = brain.parse_solution(f"show_visual:{param}")
            if worked:
                yield {"type": "solution", **worked}
            if said_lines is not None:
                try:
                    drawn = board_kit.panel(param.partition("|")[2].strip(), said_lines)
                except Exception as exc:
                    print(f"[SOLUTION] {exc}", flush=True)
                    drawn = None
                if drawn:
                    yield {"type": "panel", **drawn}
        try:
            done = board_kit.show(param, hindi, lab=True)
        except Exception as exc:
            print(f"[VISUAL] {exc}", flush=True)
            done = {"error": "that did not come out right"}
        if done.get("visual"):
            yield {"type": "visual", **done["visual"]}
        if done.get("say"):
            yield {"type": "sentence", "text": done["say"]}
        if done.get("offers"):
            yield {"type": "offers", "offers": done["offers"]}
        if done.get("error"):
            yield {"type": "status", "text": f"I couldn't draw that: {done['error']}."}
    elif name == "offer_visual":
        offers = board_kit.offers_from(param, hindi)
        if offers:
            yield {"type": "offers", "offers": offers}
    elif name in board_kit.PAGE_ACTIONS:
        yield {"type": "do", "action": name, "param": param or ""}
    elif name:
        print(f"[ACTION] Not on the whiteboard: {name}", flush=True)


# ------------------------------------------------------------------ what her buttons open
class VisualIn(BaseModel):
    kind: str
    payload: str
    language: str = "en"
    lab: bool = True


@app.post("/api/visual")
def show_visual(body: VisualIn, request: Request):
    access.log(request, "opened", body.payload.split(";")[0][:200])  # "projectile motion", "y = sin x"
    done = board_kit.show(f"{body.kind} | {body.payload[:600]}", body.language in ("hi", "hinglish"), body.lab)
    if done.get("error"):
        raise HTTPException(422, done["error"])
    return done


class GraphIn(BaseModel):
    payload: str
    kind: str = "graph"
    values: list | None = None
    window: list | None = None
    aspect: float | None = None


@app.post("/api/graph")
def graph_points(body: GraphIn):
    drawn = board_kit.graph(body.payload[:600], body.values, body.window, body.aspect, body.kind[:20])
    if drawn is None:
        raise HTTPException(422, "I can't plot that one.")
    return drawn


class GeometryIn(BaseModel):
    payload: str
    points: list | None = None
    reshaped: bool = False
    picks: list | None = None


@app.post("/api/geometry")
def geometry_build(body: GeometryIn):
    built = geolab.build(body.payload[:600])
    if built is None:
        raise HTTPException(422, "I can't measure that one.")
    return built


@app.post("/api/geometry/measure")
def geometry_measure(body: GeometryIn):
    done = geolab.measure(body.model_dump(), body.picks or [])
    if done is None:
        raise HTTPException(422, "I can't measure that one.")
    return done


# ------------------------------------------------------------------ her 3D Explorer
class HoloAskIn(BaseModel):
    model_id: str
    component_id: str | None = None
    question: str = ""
    language: str = "en"


@app.post("/api/holo/ask")
def holo_ask(body: HoloAskIn):
    """Ask Liza from a part's panel in the Explorer (her app.py holo_ask)."""
    language = body.language if body.language in ("en", "hi", "hinglish") else "en"
    messages = explorer.ask_messages(body.model_id, body.component_id, body.question, language)
    if not messages:
        raise HTTPException(404, "I don't know that model.")
    try:
        return {"answer": explorer.clean_answer(brain.complete(messages))}
    except Exception as exc:
        print(f"[HOLO] Ask failed: {exc}", flush=True)
        return {"error": "I couldn't reach the AI just now. The model still works."}


# ------------------------------------------------------------------ her ears and voice
@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...), language: str = Form("")):
    data = await audio.read()
    if len(data) > 8_000_000:
        raise HTTPException(413, "That recording is too long.")
    try:
        text, heard = voice.transcribe(data, audio.filename or "speech.webm", language or None)
    except voice.VoiceUnavailable as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        print(f"[STT] {exc}", flush=True)
        raise HTTPException(502, "I could not hear that. Try again.")
    return {"text": text, "language": heard}


@app.get("/api/tts")
def tts(t: str = "", l: str = "", tone: str = ""):
    text = t.strip()[:500]
    if not text:
        raise HTTPException(400, "Nothing to say.")
    try:
        audio = voice.synthesize(text, l if l in ("en", "hi") else None, tone or None)
    except voice.VoiceUnavailable as exc:
        print(f"[TTS] {exc}", flush=True)
        raise HTTPException(503, "Her voice is unavailable right now.")  # the page uses the browser's
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/status")
def status():
    return {"ready": True}


# public/ only: .env and this file are outside it. lw/ is a link to Liza's web frontend.
app.mount("/", StaticFiles(directory=os.path.join(HERE, "public"), html=True, follow_symlink=True), name="page")
