"""One turn of conversation: Liza's own prompt, OpenRouter, and her reply cut
into sentences as it streams, so the browser can start speaking the first one
while the rest is still being written.

The prompt is the device's UNIVERSAL_SYSTEM_PROMPT from prompts.py, filled the
way assistant.ai_loop fills it, with three web differences:
- the device's action list is replaced by WEB_ACTIONS (no music, camera,
  files or board here),
- there are no textbooks (they cannot be published), and
- the device state says it is the web demo.
A web search still works: SEARCH: <query> is answered from DuckDuckGo exactly
as assistant.py does it.
"""
import json
import re
from datetime import datetime

from openai import OpenAI
import httpx

import settings
from liza import prompts, profiles

_client = OpenAI(api_key=settings.OPENROUTER_API_KEY or "missing",
                 base_url="https://openrouter.ai/api/v1",
                 timeout=httpx.Timeout(25.0, connect=5.0))

MODES = ("TUTOR", "CO-TELL", "RE-TELL")
MAX_HISTORY_TURNS = 6
MAX_HISTORY_BYTES = 6000

# The device's own action list, word for word, so she draws, offers and
# switches exactly as on the Pi. Only what needs the Pi's own files, speakers
# or shell is taken away, with the reason.
WEB_ACTIONS = prompts.AGENTIC_ACTIONS + """

ON THIS SCREEN (you are on a web page, on their own laptop, tablet or phone): everything above works -- show_visual, offer_visual, hide_visual, enlarge_visual, shrink_visual, ui_mode, sleep, board_open, board_close, camera_off -- EXCEPT open_file, close_file, list_files, run_command and stop_media: there are no files, music or videos here. Asked for one of those, say warmly in one sentence that it works on the Liza device, and help another way. The page also has a 3D Explorer: when their question names something it has a model of, a "Visualize in 3D" button appears by itself."""

RE_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
RE_LATIN_WORD = re.compile(r"[A-Za-z]{2,}")
RE_ROMAN_HINDI = re.compile(
    r"\b(kya|hai|hain|kaise|kyun|kyon|mujhe|mera|meri|aap|tum|nahi|nahin|batao|"
    r"samjhao|kaun|kab|kahan|accha|acha|theek|haan|bhi|aur|ke|ki|ka)\b", re.I)
HINDI_STT = {"hi", "hindi", "ur", "urdu"}

MOODS = {"curious", "encouraging", "calm", "excited", "thoughtful", "happy", "warm",
         "playful", "gentle", "proud", "empathetic", "serious", "cheerful",
         "concerned", "sad", "neutral", "friendly", "caring", "amused", "surprised"}
RE_EMOTION = re.compile(r"EMOTION:\s*\[?\s*[A-Za-z]*\s*\]?", re.I)
RE_ANSWER = re.compile(r"ANSWER:\s*", re.I)
RE_ACTION = re.compile(r"\[ACTION:\s*([^\]]*)\]", re.I)
RE_SENTENCE_END = re.compile(r"([.!?।]+[\"'”’)\]]*)(\s+)|(\n+)")
RE_MARKDOWN = re.compile(r"\*\*|__|`|^#+\s*|^\s*[-*•]\s+", re.M)
RE_SEARCH = re.compile(r"^\s*SEARCH:\s*(.+)", re.I | re.S)


def detect_language(text, stt_language=""):
    has_dev = bool(RE_DEVANAGARI.search(text))
    if has_dev and RE_LATIN_WORD.search(text):
        return "hinglish"
    if has_dev:
        return "hi"
    if (stt_language or "").lower() in HINDI_STT and RE_ROMAN_HINDI.search(text):
        return "hinglish"
    return "en"


def profile_block(profile):
    """The device's student_profile_block, without the books and the notebook,
    which stay on the device."""
    instruction = profiles.band_instruction(profile.get("class"))
    if not instruction:
        return ""
    board = (profile.get("board") or "").strip()
    board_line = (f"Their school follows the {board} board, so that is the syllabus, "
                  f"the terminology and the textbook to answer from. You already know "
                  f"this: NEVER ask them which board, which syllabus or which book they "
                  f"follow.\n" if board else "")
    return (
        "### 1a. WHO YOU ARE TEACHING (CRITICAL OVERRIDE -- GOVERNS DEPTH, NOT BEHAVIOUR)\n"
        f"You are teaching {profile.get('name') or 'a student'}, "
        f"who is in {profiles.LEVEL_WORDS.get(profiles.normalise_class(profile.get('class')), 'Class ' + str(profile.get('class')))}.\n"
        f"{board_line}"
        f"{instruction}\n"
        "This sets HOW DEEP and HOW PLAIN the answer is. The mode below still decides HOW\n"
        "you teach -- explaining, asking, or examining -- and rule 5 still decides how you\n"
        "speak. The sentence ceiling here is a maximum, never a target: a one-line question\n"
        "still gets a one-line answer. NEVER mention the student's class, their year, or\n"
        "that you are adjusting anything; just answer at that level.\n\n")


def device_state(mode, on_board=None, camera_on=False, whiteboard=False, buttons=None):
    camera = ("ON: your live camera is on their screen, and the picture with this question "
              "is what it sees right now" if camera_on else "off (they can turn it on with "
              "the camera button on the Transcribe Board)")
    board = ("OPEN, full screen: they wrote or drew on it; the picture with this question is "
             "the page" if whiteboard else "closed (the board button on the Transcribe Board opens it)")
    return ("CURRENTLY_PLAYING: None (nothing is playing)\n"
            "CURRENTLY_OPEN_FILE: None (no file is open)\n"
            f"CURRENT_UI_MODE: {mode}\n"
            "LAST_GRAPH: None (you have not plotted one)\n"
            f"ON_BOARD: {on_board or 'None (the board is empty)'}\n"
            f"CAMERA: {camera}\n"
            f"WHITEBOARD: {board}\n"
            "GEOMETRY: None (the geometry lab is not open)\n"
            f"BUTTONS: {buttons or 'None'}")


def system_prompt(profile, mode, language, mode_instruction=None, on_board=None,
                  camera_on=False, whiteboard=False, buttons=None):
    return prompts.UNIVERSAL_SYSTEM_PROMPT.format(
        education_scope=prompts.ASSISTANT_SCOPE,
        emotion_persona=prompts.EMOTION_PERSONA,
        agentic_actions=WEB_ACTIONS,
        grade_guidelines=profile_block(profile),
        textbook_context="",
        domain_guidelines=mode_instruction or prompts.MODE_INSTRUCTIONS.get(
            mode, prompts.MODE_INSTRUCTIONS["TUTOR"]),
        language_guidelines=prompts.LANGUAGE_INSTRUCTIONS[language],
        device_state=device_state(mode, on_board, camera_on, whiteboard, buttons),
        system_time=datetime.now().strftime("%I:%M %p, %A, %B %d, %Y"),
    )


def history_messages(turns):
    """Stored turns as the device writes them into its history."""
    out = []
    for t in turns:
        if t["role"] == "user":
            out.append({"role": "user", "content": f"User: {t['content']}"})
        else:
            out.append({"role": "assistant", "content": f"ANSWER: {t['content']}"})
    out = out[-MAX_HISTORY_TURNS * 2:]
    total = sum(len(m["content"].encode()) for m in out)
    while len(out) > 1 and total > MAX_HISTORY_BYTES:
        total -= len(out.pop(0)["content"].encode())
    return out


def retell_reference(turns):
    taught = [t["content"][:420] for t in turns if t["role"] == "assistant"][-6:]
    text = "\n".join(f"- {t}" for t in taught)[-2400:]
    return text or "None: nothing was taught earlier in this conversation."


def retell_past(rows):
    rows = [r for r in rows if r["kind"] == "retell"][:3]
    if not rows:
        return "None: this is their first re-tell."
    return "\n".join(
        f"- {r['topic']}: "
        + (f"{r['score']}/{r.get('out_of') or 10}" if r.get("score") is not None else "no score")
        + f"; focus was: {r.get('detail') or '-'}" for r in rows)


BOARD_MAX_TOKENS = 2400   # the spoken steps and the written working


def attach_picture(messages, data_url, note):
    """camera.attach on the device: the picture on the last user turn, the
    picture first and the note after the words. A copy; the history never
    holds an image."""
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "user" and isinstance(messages[i].get("content"), str):
            turn = {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": data_url}},
                {"type": "text", "text": f"{messages[i]['content']}\n\n{note}"},
            ]}
            return messages[:i] + [turn] + messages[i + 1:]
    return messages


def parse_solution(raw):
    """show_visual:solution | Title; expr :: note; ...; answer = x; see = ..."""
    kind, _, body = (raw or "").partition("|")
    if kind.strip().lower() not in ("show_visual:solution", "solution"):
        return None
    title, steps, answer = "", [], ""
    for i, part in enumerate(p.strip() for p in body.split(";")):
        if not part:
            continue
        low = part.lower()
        if low.startswith("answer"):
            answer = part.split("=", 1)[1].strip() if "=" in part else part
        elif low.startswith("see ="):
            continue
        elif "::" in part:
            expr, note = part.split("::", 1)
            steps.append({"expr": expr.strip(), "note": note.strip()})
        elif i == 0 and not title:
            title = part
        else:
            steps.append({"expr": part, "note": ""})
    if not steps and not answer:
        return None
    return {"title": title, "steps": steps[:20], "answer": answer}


def parse_report(param):
    """show_visual:report | Topic: x; Score: 7/10; Strong: a; Weak: b; Focus: c"""
    kind, _, body = param.partition("|")
    if kind.strip().lower() not in ("show_visual:report", "report"):
        return None
    report = {"strong": [], "weak": []}
    for part in body.split(";"):
        key, _, value = part.partition(":")
        key, value = key.strip().lower(), value.strip()
        if not value:
            continue
        if key in ("strong", "weak"):
            report[key].append(value)
        elif key in ("topic", "score", "before", "focus"):
            report[key] = value
    return report if report.get("topic") else None


def _start_stream(messages, board=False):
    kwargs = {"model": settings.LLM_MODEL, "messages": messages, "stream": True,
              "max_tokens": BOARD_MAX_TOKENS if board else settings.LLM_MAX_TOKENS,
              "temperature": settings.LLM_TEMPERATURE}
    # A question about the board thinks first, as on the device (board_tuning):
    # the slips thinking catches are exactly the ones in a worked sum.
    extra = ({"reasoning": {"effort": "low", "exclude": True}} if board
             else {"reasoning": {"enabled": False}})
    if settings.LLM_PROVIDER_ORDER:
        extra["provider"] = {"order": settings.LLM_PROVIDER_ORDER, "allow_fallbacks": True}
    try:
        return _client.with_options(max_retries=1).chat.completions.create(
            extra_body=extra, **kwargs)
    except Exception as exc:
        status = getattr(exc, "status_code", None)
        if status and 400 <= status < 500 and status != 429:
            # A model that does not take the latency settings.
            return _client.with_options(max_retries=1).chat.completions.create(**kwargs)
        raise


def complete(messages, max_tokens=300):
    """One short unstreamed answer (the 3D Explorer's Ask Liza)."""
    extra = {"reasoning": {"enabled": False}}
    if settings.LLM_PROVIDER_ORDER:
        extra["provider"] = {"order": settings.LLM_PROVIDER_ORDER, "allow_fallbacks": True}
    response = _client.with_options(max_retries=1).chat.completions.create(
        model=settings.LLM_MODEL, messages=messages, max_tokens=max_tokens,
        temperature=settings.LLM_TEMPERATURE, extra_body=extra)
    return response.choices[0].message.content or ""


def _clean(raw):
    """The speakable text so far, and whether a tag is still open at the end."""
    text = RE_EMOTION.sub("", raw)
    text = RE_ANSWER.sub("", text)
    # A bare mood word on the first line, which the model sometimes sends
    # without its EMOTION: label.
    first, nl, rest = text.lstrip().partition("\n")
    if nl and first.strip().strip("[]").lower() in MOODS:
        text = rest
    text = RE_ACTION.sub("", text)
    open_tag = text.rfind("[")
    pending = open_tag != -1 and "]" not in text[open_tag:]
    if pending:
        text = text[:open_tag]
    text = RE_MARKDOWN.sub("", text)
    return text.lstrip(), pending


def _speakable_line(sentence):
    """A sentence fit to say and show. Worked-solution notation that slipped
    out of its tag ("3x = 15 :: add 5") belongs on the board, not in her
    voice; and $...$ around maths is markup, not words."""
    if not sentence or "::" in sentence:
        return ""
    return re.sub(r"\$([^$]*)\$", r"\1", sentence).strip()


def _web_search(query):
    try:
        from ddgs import DDGS
        context = ""
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=4))
        if results:
            context = "\n".join(f"- {r['title']}: {r.get('body', r.get('snippet', ''))}"
                                for r in results)
        return context or "The web search failed or no results were found."
    except Exception as exc:
        print(f"[SEARCH] {exc}", flush=True)
        return "The web search failed or no results were found."


def stream_reply(messages, language, board=False):
    """Yields events: {"type": "sentence", "text"}, {"type": "status", "text"},
    {"type": "action", "name", "param"} and finally {"type": "done", "answer"}.
    """
    for search_pass in range(2):
        raw, sent_upto = "", 0
        try:
            stream = _start_stream(messages, board)
            for chunk in stream:
                if not chunk.choices:
                    continue
                piece = chunk.choices[0].delta.content or ""
                if not piece:
                    continue
                raw += piece
                stripped = RE_ANSWER.sub("", RE_EMOTION.sub("", raw)).lstrip()
                # Hold everything while it could still be a SEARCH: line.
                if not search_pass and ("SEARCH:".startswith(stripped[:7].upper())
                                        or RE_SEARCH.match(stripped)):
                    continue
                text, _pending = _clean(raw)
                while True:
                    match = RE_SENTENCE_END.search(text, sent_upto)
                    if not match:
                        break
                    sentence = text[sent_upto:match.end()].strip()
                    sent_upto = match.end()
                    sentence = _speakable_line(sentence)
                    if sentence:
                        yield {"type": "sentence", "text": sentence}
        except Exception as exc:
            print(f"[LLM] {exc}", flush=True)
            line = prompts.LLM_UNREACHABLE.get(language, prompts.LLM_UNREACHABLE["en"])
            yield {"type": "sentence", "text": line}
            yield {"type": "done", "answer": line, "failed": True}
            return

        stripped = RE_ANSWER.sub("", RE_EMOTION.sub("", raw)).strip()
        search = RE_SEARCH.match(stripped) if not search_pass else None
        if search:
            query = search.group(1).strip().splitlines()[0].strip("[] ")
            notice = prompts.SEARCH_NOTICES.get(language, prompts.SEARCH_NOTICES["en"])
            yield {"type": "sentence", "text": notice.format(query=query)}
            yield {"type": "status", "text": f"Searching for: {query}..."}
            results = _web_search(query)
            messages = messages + [
                {"role": "assistant", "content": raw},
                {"role": "user", "content":
                    f"Live web search results:\n{results}\n\nAnswer from these ONLY. If they "
                    "do not contain the answer, say 'I couldn't find the exact data online "
                    "right now.' Do not guess or change the subject. The results may be in "
                    "English; you MUST still answer in the student's language and script "
                    "per rule 2. Start with ANSWER:"}]
            continue

        text, _ = _clean(raw + "\n")
        tail = _speakable_line(text[sent_upto:].strip())
        if tail:
            yield {"type": "sentence", "text": tail}
        for match in RE_ACTION.finditer(raw):
            name, _, param = match.group(1).partition(":")
            yield {"type": "action", "name": name.strip(), "param": param.strip(),
                   "raw": match.group(1).strip()}
        answer = text.strip()
        yield {"type": "done", "answer": answer}
        return


def to_ndjson(event):
    return json.dumps(event, ensure_ascii=False) + "\n"
