"""Liza on the web: the API the browser talks to.

    uvicorn app:app --host 0.0.0.0 --port 8080        (from web/backend)

Endpoints (all JSON unless noted):
  GET    /api/health
  GET    /api/profiles?own=id1,id2      demo profiles + the ones this browser made
  POST   /api/profiles                  {name, class, board}
  PATCH  /api/profiles/{id}             {name, class, board}   (not demo ones)
  DELETE /api/profiles/{id}                                      (not demo ones)
  GET    /api/profiles/{id}/history     the Chat screen
  DELETE /api/profiles/{id}/history
  GET    /api/profiles/{id}/progress    My progress
  POST   /api/progress                  {profile_id, kind, topic, detail, score, out_of}
  POST   /api/turn                      form: profile_id, mode, text | audio  -> NDJSON stream
  POST   /api/transcribe                form: audio [, language]  -> {text, language}
  POST   /api/tts                       {text, language}  -> audio/mpeg
  GET    /api/weather
  GET    /api/kg                        alphabets, numbers, spelling words, stories

The browser files in web/frontend are served too, so one process is the whole
site while developing; on Firebase Hosting they are served from there instead.
"""
import json
import os
import threading
import time

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import board as board_kit
import brain
import db
import auth
import explorer
import model3d
import geolab
import kgdata
import learning
import liza as liza_kit
import limits
import settings
import voice
from liza import kg_content, prompts

app = FastAPI(title="Liza web", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS or ["*"],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def _revalidate_site_files(request, call_next):
    # Browsers otherwise keep using an old app.js after an update; no-cache
    # still lets them reuse it, but only after asking whether it changed.
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


@app.exception_handler(limits.Limited)
def _limited(_request, exc):
    return JSONResponse({"error": str(exc)}, status_code=429,
                        headers={"Retry-After": str(exc.retry_after)})


def _cleanup_loop():
    while True:
        time.sleep(3600)
        try:
            db.cleanup()
        except Exception as exc:
            print(f"[DB] Cleanup failed ({exc}).", flush=True)


@app.on_event("startup")
def _startup():
    # Not fatal: on Vercel a database hiccup at a cold start must not take
    # the whole backend down. The tables are made on first use anyway.
    try:
        db.ensure()
    except Exception as exc:
        print(f"[DB] Not ready at start ({exc}); will retry on first use.", flush=True)
    threading.Thread(target=_cleanup_loop, daemon=True).start()
    missing = [name for name, value in (("OPENROUTER_API_KEY", settings.OPENROUTER_API_KEY),
                                        ("GROQ_API_KEY", settings.GROQ_API_KEY),
                                        ("CARTESIA_API_KEY", settings.CARTESIA_API_KEY))
               if not value]
    if missing:
        print(f"[WEB] Not set: {', '.join(missing)}.", flush=True)
    print(f"[WEB] Ready. Model {settings.LLM_MODEL}.", flush=True)


# ----- profiles -----

def _profile_fields(body: dict):
    name = " ".join(str(body.get("name", "")).split())[:24]
    class_value = str(body.get("class", "")).strip().upper()
    board = body.get("board") or None
    if not name:
        raise HTTPException(400, "Type a name.")
    if class_value not in db.CLASS_VALUES:
        raise HTTPException(400, "Pick a class.")
    if board is not None and board not in db.BOARDS:
        board = None
    return name, class_value, board


def _require_profile(pid, request):
    """The student, if it belongs to the signed-in account; else as if absent."""
    profile = db.get_profile(pid)
    if not profile or profile.get("owner") != auth.account_of(request):
        raise HTTPException(404, "That student is not here any more.")
    return profile


@app.get("/api/health")
def health():
    return {"ok": True, "model": settings.LLM_MODEL,
            "voice": bool(settings.CARTESIA_API_KEY), "hearing": bool(settings.GROQ_API_KEY)}


@app.get("/api/profiles")
def list_profiles(request: Request):
    return {"profiles": db.list_profiles(auth.account_of(request)),
            "classes": db.CLASS_VALUES, "boards": db.BOARDS}


@app.post("/api/profiles")
async def create_profile(request: Request):
    limits.per_minute("profiles", limits.visitor_of(request), 10)
    owner = auth.account_of(request)
    name, class_value, board = _profile_fields(await request.json())
    return db.create_profile(name, class_value, board, owner)


@app.patch("/api/profiles/{pid}")
async def update_profile(pid: str, request: Request):
    profile = _require_profile(pid, request)
    if profile["demo"]:
        raise HTTPException(403, "The demo students cannot be changed.")
    name, class_value, board = _profile_fields(await request.json())
    return db.update_profile(pid, name, class_value, board)


@app.delete("/api/profiles/{pid}")
def delete_profile(pid: str, request: Request):
    profile = _require_profile(pid, request)
    if profile["demo"]:
        raise HTTPException(403, "The demo students cannot be removed.")
    db.delete_profile(pid)
    return {"ok": True}


@app.get("/api/profiles/{pid}/history")
def history(pid: str, request: Request):
    _require_profile(pid, request)
    return {"turns": db.history(pid)}


@app.delete("/api/profiles/{pid}/history")
def clear_history(pid: str, request: Request):
    _require_profile(pid, request)
    db.clear_history(pid)
    return {"ok": True}


@app.get("/api/profiles/{pid}/progress")
def progress(pid: str, request: Request):
    _require_profile(pid, request)
    return {"progress": db.progress(pid), "totals": db.progress_totals(pid),
            # The dashboard's charts (dashboard.py): days, and the letters done.
            "daily": db.daily_activity(pid, 35), "letters": db.progress_topics(pid, "letters"),
            "today": db.today(),
            # dashboard.GOALS: the letters and stories are the real size of the set.
            "goals": {"letters": 26 + len(liza_kit.kg_content.HINDI_ALPHABET),
                      "story": len(liza_kit.kg_content.STORIES) + len(liza_kit.kg_content.HINDI_STORIES)}}


@app.post("/api/progress")
async def add_progress(request: Request):
    body = await request.json()
    pid = str(body.get("profile_id", ""))
    _require_profile(pid, request)
    limits.per_minute("progress", limits.visitor_of(request), 60)

    def num(value):
        try:
            return int(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    db.add_progress(pid, str(body.get("kind", "kg"))[:32], str(body.get("topic", ""))[:120],
                    (str(body["detail"])[:400] if body.get("detail") else None),
                    num(body.get("score")), num(body.get("out_of")))
    return {"ok": True}


# ----- talking -----

async def _read_picture(upload: UploadFile | None):
    """A camera or board picture as a data: URL, or None."""
    if upload is None:
        return None
    data = await upload.read()
    if not data:
        return None
    if len(data) > 4_000_000:
        raise HTTPException(413, "That picture is too big.")
    kind = upload.content_type if upload.content_type in ("image/jpeg", "image/png", "image/webp") \
        else "image/jpeg"
    import base64
    return f"data:{kind};base64,{base64.b64encode(data).decode()}"


async def _read_audio(audio: UploadFile):
    data = await audio.read()
    if len(data) > settings.MAX_AUDIO_BYTES:
        raise HTTPException(413, "That recording is too long.")
    return data


@app.post("/api/transcribe")
async def transcribe(request: Request, audio: UploadFile = File(...),
                     language: str = Form(""), seed: str = Form("")):
    limits.per_minute("transcribe", limits.visitor_of(request), settings.TURNS_PER_MINUTE * 3)
    data = await _read_audio(audio)
    try:
        # seed "letters": the device's KG_SEED_LETTERS, so a child spelling
        # out loud is heard as letters, not words.
        prompt = liza_kit.constant("kg.py", "KG_SEED_LETTERS") if seed == "letters" else None
        text, heard_language = voice.transcribe(data, audio.filename or "speech.webm",
                                                language or None, prompt)
    except voice.VoiceUnavailable as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        print(f"[STT] {exc}", flush=True)
        raise HTTPException(502, "I could not hear that. Try again.")
    return {"text": text, "language": heard_language}


@app.post("/api/turn")
async def turn(request: Request, profile_id: str = Form(...), mode: str = Form("TUTOR"),
               text: str = Form(""), retell: str = Form(""), board: str = Form(""),
               heard_language: str = Form(""), audio: UploadFile | None = File(None),
               photo: UploadFile | None = File(None),
               board_photo: UploadFile | None = File(None), board_ask: str = Form(""),
               screen: str = Form(""), board_strokes: str = Form("")):
    visitor = limits.visitor_of(request)
    limits.per_minute("turn", visitor, settings.TURNS_PER_MINUTE)
    profile = _require_profile(profile_id, request)
    mode = mode if mode in brain.MODES else "TUTOR"

    heard_language = heard_language.strip().lower()[:16]
    if audio is not None:
        data = await _read_audio(audio)
        try:
            text, heard_language = voice.transcribe(data, audio.filename or "speech.webm",
                                                    strict=mode != "RE-TELL")
        except voice.VoiceUnavailable as exc:
            raise HTTPException(503, str(exc))
        except Exception as exc:
            print(f"[STT] {exc}", flush=True)
            raise HTTPException(502, "I could not hear that. Try again.")
    # The live camera's picture of this moment, or the page on the whiteboard.
    camera_url = await _read_picture(photo)
    board_url = await _read_picture(board_photo)
    # The page's own lines: whiteboard.snapshot draws what she is shown,
    # exactly as on the device.
    if board_strokes:
        try:
            board_url = board_kit.sketch(json.loads(board_strokes[:2_000_000])) or board_url
        except ValueError:
            pass
    text = " ".join((text or "").split())[:settings.MAX_TEXT_CHARS]
    if not text and board_url and board_ask in ("ask", "solve"):
        # "Ask Liza" / "Solve it" on the board, with nothing said: the device's
        # own words for those buttons.
        lang = brain.detect_language(heard_language or "", heard_language)
        text = (prompts.BOARD_SOLVE_QUESTIONS["solve"] if board_ask == "solve"
                else prompts.BOARD_ASK_QUESTIONS).get(lang, prompts.BOARD_ASK_QUESTIONS["en"])
    if not text:
        return StreamingResponse(iter([brain.to_ndjson({"type": "heard", "text": ""}),
                                       brain.to_ndjson({"type": "done", "answer": "",
                                                        "empty": True})]),
                                 media_type="application/x-ndjson")
    limits.daily("turns", settings.DAILY_TURN_CAP)
    db.touch(profile_id)

    language = brain.detect_language(text, heard_language)
    turns = db.recent_turns(profile_id)
    # Shortly after a verdict the browser sends "auto": a question about the
    # feedback is answered, anything else is marked as a new recitation --
    # decided by the device's own RE_RETELL_FOLLOWUP.
    if retell == "auto":
        retell = "followup" if prompts.RE_RETELL_FOLLOWUP.search(text) else "evaluate"
    # What is on the screen goes in as ON_BOARD and BUTTONS, as on the device:
    # the 3D Explorer when it is open, else the board's picture and buttons.
    on_board = None
    if board:
        try:
            on_board = explorer.board_line(json.loads(board[:4000]))
        except ValueError:
            on_board = None
    try:
        shown = json.loads(screen[:20000]) if screen else {}
    except ValueError:
        shown = {}
    # The geometry lab: what is open and picked (GEOMETRY), and -- with it
    # open full screen -- the parts the question names, picked before she
    # answers (assistant.ai_loop).
    lab = geolab.for_turn(shown.get("geometry"), text) if isinstance(shown, dict) else None
    if lab and isinstance(shown.get("visual"), dict) and shown["visual"].get("kind") == "geometry":
        shown["visual"]["title"] = lab["describe"]
    on_board = on_board or board_kit.on_board_line(shown)
    buttons = board_kit.offers_line(shown)
    can_lab = bool(isinstance(shown, dict) and shown.get("lab"))
    # RE-TELL: "evaluate" marks what they recited; "followup" answers a question
    # about the verdict; anything else is the ordinary RE-TELL conversation.
    if mode == "RE-TELL" and retell == "evaluate":
        instruction = prompts.RETELL_EVALUATION_PROMPT.format(
            transcript=text, reference=brain.retell_reference(turns),
            past=brain.retell_past(db.progress(profile_id, limit=60)))
        system = brain.system_prompt(profile, mode, language, instruction, on_board,
                                     buttons=buttons)
        messages = [{"role": "system", "content": system},
                    {"role": "user", "content": "I have finished. Give me your verdict."}]
    else:
        instruction = prompts.RETELL_FOLLOWUP_PROMPT if (
            mode == "RE-TELL" and retell == "followup") else None
        system = brain.system_prompt(profile, mode, language, instruction, on_board,
                                     camera_on=bool(camera_url) or bool(shown.get("camera")),
                                     whiteboard=bool(board_url), buttons=buttons)
        messages = ([{"role": "system", "content": system}]
                    + brain.history_messages(turns)
                    + [{"role": "user", "content": f"User: {text}"}])
        if board_url:
            messages = brain.attach_picture(messages, board_url, prompts.BOARD_NOTE)
        elif camera_url:
            messages = brain.attach_picture(messages, camera_url, prompts.CAMERA_LIVE_NOTE)
    if lab:
        messages[0]["content"] = messages[0]["content"].replace(
            "GEOMETRY: " + geolab.device_line(None), "GEOMETRY: " + lab["line"], 1)
    # The history notes that a picture went with it (the picture itself never
    # does), so the turns after it know what the answer was about.
    said = text + (" [about what is written on your board]" if board_url
                   else " [with your camera on]" if camera_url else "")

    def events():
        yield brain.to_ndjson({"type": "heard", "text": text, "language": language})
        if lab and lab["picks"]:
            yield brain.to_ndjson({"type": "geometry_pick", "picks": lab["picks"]})
        answer = ""
        acted = False
        said_lines = []
        hindi = language in ("hi", "hinglish")
        for event in brain.stream_reply(messages, language, board=bool(board_url)):
            if event["type"] == "action":
                # One action per reply, as on the device: the first tag only.
                if acted:
                    continue
                acted = True
                report = brain.parse_report(event["raw"])
                if report:
                    _record_retell(profile_id, report)
                    # The verdict's card is the device's own board picture
                    # (visuals.py "report"); the page only needs to know a
                    # verdict was given, for the follow-up window.
                    yield brain.to_ndjson({"type": "marked"})
                    for out in _act(event["raw"], hindi, lab=can_lab):
                        yield brain.to_ndjson(out)
                    continue
                for out in _act(event["raw"], hindi, said_lines if board_url else None, can_lab):
                    yield brain.to_ndjson(out)
                continue
            if event["type"] == "sentence":
                said_lines.append(event["text"])
            if event["type"] == "done":
                answer = event.get("answer", "")
                # A reply with no tag at all still gets a button for the thing
                # the question was about, when it can be shown in 3D
                # (assistant.py, actions.offer_for_topic).
                if answer and not acted and mode != "RE-TELL":
                    try:
                        offer = model3d.offer_for_topic(text, board_kit.make_offer, hindi,
                                                        shown.get("visual"))
                    except Exception as exc:
                        print(f"[3D] No topic button ({exc})", flush=True)
                        offer = None
                    if offer:
                        yield brain.to_ndjson({"type": "offers", "offers": [offer]})
            yield brain.to_ndjson(event)
        if answer and mode != "RE-TELL":
            lesson = learning.lesson_for(text)
            if lesson:
                try:
                    db.add_progress(profile_id, "lesson", lesson[0], lesson[1])
                except Exception as exc:
                    print(f"[LEARN] {exc}", flush=True)
        if answer and not (mode == "RE-TELL" and retell == "evaluate"):
            db.add_turn(profile_id, mode, "user", said)
            db.add_turn(profile_id, mode, "assistant", answer)
        elif answer:
            db.add_turn(profile_id, mode, "user", f"(re-told) {text}")
            db.add_turn(profile_id, mode, "assistant", answer)

    return StreamingResponse(events(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


def _act(raw, hindi, said_lines=None, lab=False):
    """Her action tag, done as actions.execute_action does it: the board's
    pictures and buttons here, the rest by the page."""
    name, param = board_kit.first_tag(f"[ACTION: {raw}]")
    if not name:
        return
    if name == "show_visual":
        kind = (param or "").partition("|")[0].strip().lower()
        if kind == "solution":
            worked = brain.parse_solution(f"show_visual:{param}")
            if worked:
                yield {"type": "solution", **worked}
            if said_lines is not None:
                # The board is open: the working goes beside their writing,
                # as solution.Panel draws it (ui.py show_solution).
                try:
                    drawn = board_kit.panel(param.partition("|")[2].strip(), said_lines)
                except Exception as exc:
                    print(f"[SOLUTION] {exc}", flush=True)
                    drawn = None
                if drawn:
                    yield {"type": "panel", **drawn}
        try:
            done = board_kit.show(param, hindi, lab)
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
    else:
        print(f"[ACTION] Not on the web: {name}", flush=True)


class BoardReadIn(BaseModel):
    strokes: list
    hindi: bool = False


@app.post("/api/board/read")
def board_read(body: BoardReadIn, request: Request):
    """The live reading of the page (whiteboard.Reader): the chip's line and
    the buttons under the writing."""
    limits.per_minute("read", limits.visitor_of(request), 30)
    try:
        return board_kit.read_page(body.strokes, body.hindi)
    except Exception as exc:
        print(f"[BOARD] Reading failed ({exc}).", flush=True)
        return {"read": "", "suggest": []}


class GraphIn(BaseModel):
    payload: str
    kind: str = "graph"
    values: list | None = None
    window: list | None = None
    aspect: float | None = None


@app.post("/api/graph")
def graph_points(body: GraphIn, request: Request):
    """The graph card's curves for these slider values (ui.py _drag_knob)."""
    limits.per_minute("graph", limits.visitor_of(request), 400)
    drawn = board_kit.graph(body.payload[:600], body.values, body.window, body.aspect, body.kind[:20])
    if drawn is None:
        raise HTTPException(422, "I can't plot that one.")
    return drawn


class VisualIn(BaseModel):
    kind: str
    payload: str
    language: str = "en"
    lab: bool = False


@app.post("/api/visual")
def show_visual(body: VisualIn, request: Request):
    """A button on the board was tapped: draw what it offered (actions.run_offer)."""
    limits.per_minute("visual", limits.visitor_of(request), 20)
    hindi = body.language in ("hi", "hinglish")
    done = board_kit.show(f"{body.kind} | {body.payload[:600]}", hindi, body.lab)
    if done.get("error"):
        raise HTTPException(422, done["error"])
    return done


class GeometryIn(BaseModel):
    payload: str
    points: list | None = None
    reshaped: bool = False
    picks: list | None = None


@app.post("/api/geometry")
def geometry_build(body: GeometryIn, request: Request):
    """The geometry lab's figure (actions._show_geometry, geometry.build)."""
    limits.per_minute("geometry", limits.visitor_of(request), 400)
    built = geolab.build(body.payload[:600])
    if built is None:
        raise HTTPException(422, "I can't measure that one.")
    return built


@app.post("/api/geometry/measure")
def geometry_measure(body: GeometryIn, request: Request):
    """A tap, a dragged corner or Clear in the lab: what the picks measure now
    (geometry.measure, live_facts, lab_line)."""
    limits.per_minute("geometry", limits.visitor_of(request), 400)
    done = geolab.measure(body.model_dump(), body.picks or [])
    if done is None:
        raise HTTPException(422, "I can't measure that one.")
    return done


def _record_retell(pid, report):
    score = None
    try:
        score = int(str(report.get("score", "")).split("/")[0])
    except ValueError:
        pass
    try:
        db.add_progress(pid, "retell", report.get("topic", "")[:120],
                        report.get("focus"), score, 10)
    except Exception as exc:
        print(f"[DB] Could not record the re-tell ({exc}).", flush=True)


class TtsIn(BaseModel):
    text: str
    language: str | None = None


def _speak(text, language, request, cacheable, tone=""):
    text = (text or "").strip()[:500]
    if not text:
        raise HTTPException(400, "Nothing to say.")
    limits.per_minute("tts", limits.visitor_of(request), settings.TTS_PER_MINUTE)
    limits.daily("tts_chars", settings.DAILY_TTS_CHAR_CAP, len(text))
    language = language if language in ("en", "hi") else None
    try:
        audio = voice.synthesize(text, language, tone or None)
    except voice.VoiceUnavailable as exc:
        print(f"[TTS] {exc}", flush=True)
        # 503 tells the browser to use its own voice for this line.
        raise HTTPException(503, "Her voice is unavailable right now.")
    # The same words always sound the same, so a GET may be kept at the edge:
    # the alphabet, the numbers and the stories are then fetched from Cartesia
    # once, and every later visitor gets them at once and for nothing.
    cache = ("public, max-age=86400, s-maxage=31536000, immutable" if cacheable
             else "no-store")
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": cache})


@app.get("/api/tts")
def tts_get(request: Request, t: str = "", l: str = "", tone: str = ""):
    return _speak(t, l, request, cacheable=True, tone=tone)


@app.post("/api/tts")
def tts(body: TtsIn, request: Request):
    return _speak(body.text, body.language, request, cacheable=False)


# ----- the 3D Explorer -----

class HoloAskIn(BaseModel):
    model_id: str
    component_id: str | None = None
    question: str = ""
    language: str = "en"


@app.post("/api/holo/ask")
def holo_ask(body: HoloAskIn, request: Request):
    """Ask Liza, from a part's panel in the explorer: answered from the
    catalogue's verified text (holo/bridge.py _ask)."""
    limits.per_minute("turn", limits.visitor_of(request), settings.TURNS_PER_MINUTE)
    language = body.language if body.language in ("en", "hi", "hinglish") else "en"
    messages = explorer.ask_messages(body.model_id, body.component_id, body.question, language)
    if not messages:
        raise HTTPException(404, "I don't know that model.")
    limits.daily("turns", settings.DAILY_TURN_CAP)
    try:
        answer = explorer.clean_answer(brain.complete(messages))
    except Exception as exc:
        print(f"[HOLO] Ask failed: {exc}", flush=True)
        return {"error": "I couldn't reach the AI just now. The model still works."}
    return {"answer": answer}


# ----- the cards on the home screen -----

_weather = {"at": 0.0, "data": None}


@app.get("/api/weather")
def weather():
    if not settings.WEATHER_API_KEY:
        return {"city": settings.WEATHER_CITY, "available": False}
    if _weather["data"] and time.time() - _weather["at"] < 900:
        return _weather["data"]
    import httpx
    try:
        r = httpx.get("https://api.openweathermap.org/data/2.5/weather",
                      params={"q": settings.WEATHER_CITY, "appid": settings.WEATHER_API_KEY,
                              "units": "metric"}, timeout=6)
        j = r.json()
        data = {"available": True, "city": settings.WEATHER_CITY,
                "temp": round(j["main"]["temp"]), "min": round(j["main"]["temp_min"]),
                "max": round(j["main"]["temp_max"]), "humidity": j["main"]["humidity"],
                "summary": j["weather"][0]["main"], "icon": j["weather"][0]["icon"]}
        _weather.update(at=time.time(), data=data)
        return data
    except Exception as exc:
        print(f"[WEATHER] {exc}", flush=True)
        return _weather["data"] or {"city": settings.WEATHER_CITY, "available": False}


# ----- Kindergarten content, straight from kg_content.py -----

@app.get("/api/kg")
def kg():
    return kgdata.content()


class KgCheckIn(BaseModel):
    fn: str
    args: list = []


@app.post("/api/kg/check")
def kg_check(body: KgCheckIn):
    """kg_content's own marking: heard_spelling, matches_answer, number_matches..."""
    try:
        return kgdata.check(body.fn, body.args)
    except (ValueError, IndexError, TypeError) as exc:
        raise HTTPException(400, f"Cannot check that ({exc}).")


@app.get("/api/kg/test")
def kg_test(kind: str = "en"):
    """kg_content.test_questions: five questions, as the device draws them."""
    return {"questions": kgdata.test_questions(kind)}


class KgAskIn(BaseModel):
    profile_id: str
    question: str
    history: list = []


@app.post("/api/kg/ask")
def kg_ask(body: KgAskIn, request: Request):
    """kg.kg_answer_doubt: the child stopped a lesson to ask something."""
    limits.per_minute("turn", limits.visitor_of(request), settings.TURNS_PER_MINUTE)
    limits.daily("turns", settings.DAILY_TURN_CAP)
    profile = _require_profile(body.profile_id, request)
    question = " ".join((body.question or "").split())[:400]
    if not question:
        return {"answer": ""}
    history = [{"role": h.get("role"), "content": str(h.get("content"))[:600]}
               for h in body.history[-6:]
               if isinstance(h, dict) and h.get("role") in ("user", "assistant")]
    messages = ([{"role": "system", "content": liza_kit.constant("kg.py", "KG_DOUBT_PROMPT")}]
                + history
                + [{"role": "user", "content": f"{profile['name'] or 'A child'} asks: {question}"}])
    try:
        answer = brain.complete(messages, max_tokens=180).strip()
    except Exception as exc:
        print(f"[KG] Could not answer the doubt ({exc}).", flush=True)
        answer = ""
    return {"answer": answer}


# ----- the browser files -----

if settings.SERVE_FRONTEND and os.path.isdir(settings.FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=settings.FRONTEND_DIR, html=True), name="frontend")
