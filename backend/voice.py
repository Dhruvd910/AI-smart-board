"""Hearing and speaking: Groq Whisper in, Cartesia out -- the device's pair.

The browser records the microphone and plays the audio; only the API calls
happen here, so the keys never reach the visitor's machine.
"""
import re
import threading
import time

from cartesia import Cartesia
from groq import Groq

import settings
from liza import spoken

RE_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
HINDI_STT_ALIASES = {"hi", "hindi", "ur", "urdu"}

_groq = Groq(api_key=settings.GROQ_API_KEY, timeout=20.0) if settings.GROQ_API_KEY else None
class CartesiaKeys:
    """Her voice over several Cartesia keys.

    One key is used until it fails: a key that has run out (no credit, quota
    used up, refused) is put aside for an hour and the next one takes over at
    once; a key that is only busy (the plan's limit on requests at the same
    time) is skipped for this request, so the keys share the load. Nobody hears
    the switch -- only when every key has failed does the browser's own voice
    take over."""
    OUT_FOR_S = 3600        # a spent key is tried again after this (credit may be topped up)
    BUSY_WAIT_S = 0.35

    def __init__(self, keys):
        self.keys = list(keys)
        self.clients = {}
        self.out_until = {}
        self.current = 0
        self.lock = threading.Lock()

    def __bool__(self):
        return bool(self.keys)

    def client(self, key):
        if key not in self.clients:
            self.clients[key] = Cartesia(api_key=key)
        return self.clients[key]

    def order(self):
        """The keys to try, the current one first, spent ones left out."""
        now = time.time()
        with self.lock:
            n = len(self.keys)
            ring = [self.keys[(self.current + i) % n] for i in range(n)]
        return [k for k in ring if self.out_until.get(k, 0) <= now]

    def spent(self, key, why):
        with self.lock:
            self.out_until[key] = time.time() + self.OUT_FOR_S
            if self.keys[self.current] == key:
                self.current = (self.current + 1) % len(self.keys)
        print(f"[TTS] Cartesia key {self.keys.index(key) + 1} of {len(self.keys)} set aside "
              f"for an hour ({why}); using the next.", flush=True)

    @staticmethod
    def kind(exc):
        """'busy', 'spent' or 'other' for a failed request."""
        status = getattr(exc, "status_code", None)
        text = str(exc).lower()
        if "concurrency" in text:
            return "busy"
        if status in (401, 402, 403) or any(w in text for w in (
                "credit", "quota", "insufficient", "payment", "exceeded", "unauthorized",
                "invalid api key", "subscription")):
            return "spent"
        if status == 429:
            return "busy"
        return "other"

    def run(self, call):
        """call(client) with the first key that works."""
        last = None
        for attempt in range(4):
            keys = self.order()
            if not keys:
                break
            any_busy = False
            for key in keys:
                try:
                    return call(self.client(key))
                except Exception as exc:
                    last = exc
                    kind = self.kind(exc)
                    if kind == "spent":
                        self.spent(key, str(exc)[:120])
                    elif kind == "busy":
                        any_busy = True
                    # 'other' (a network blip, a 5xx): the next key may still answer.
            if not any_busy:
                break
            time.sleep(self.BUSY_WAIT_S * (attempt + 1))
        raise VoiceUnavailable(f"Cartesia failed on every key: {last}")


_cartesia = CartesiaKeys(settings.CARTESIA_API_KEYS)


class VoiceUnavailable(Exception):
    pass


def transcribe(audio, filename="speech.webm", language=None, prompt=None, strict=False):
    """(text, language) for one recorded clip. language is Whisper's guess.
    strict: drop what Whisper invents out of silence (questions to her; not the
    KG screens, whose answers can be a single letter or "yes")."""
    if _groq is None:
        raise VoiceUnavailable("Speech recognition is not set up (GROQ_API_KEY).")
    params = {
        "file": (filename, audio),
        "model": settings.STT_MODEL,
        "response_format": "verbose_json",
        "temperature": 0.0,
        # Her name, so "Liza" is not written as "Lisa" or "Leeza".
        "prompt": prompt or "Liza, a friendly tutor. Hello Liza.",
    }
    if language:
        params["language"] = language
    result = _groq.audio.transcriptions.create(**params)
    text = (result.text or "").strip()
    invented = looks_invented(text, _worst_logprob(result)) if strict else ""
    if invented:
        # Whisper fed silence or a cough answers "Thank you." -- and she would
        # thank them back. The device drops these too (speech.looks_hallucinated).
        print(f"[STT] Dropped {text!r}: {invented}", flush=True)
        text = ""
    return text, (getattr(result, "language", "") or "").lower()


def _worst_logprob(result):
    """speech._worst_logprob: the least sure segment, or None."""
    scores = []
    for segment in (getattr(result, "segments", None) or []):
        data = segment if isinstance(segment, dict) else vars(segment)
        if data.get("avg_logprob") is not None:
            scores.append(data["avg_logprob"])
    return min(scores) if scores else None


def looks_invented(text, logprob=None):
    """The device's speech.looks_hallucinated, with its own lists from
    config.py: a reason when the transcript is Whisper's imagination, else ""."""
    import config
    lowered = (text or "").strip().lower()
    if not lowered:
        return ""
    bare = lowered.strip(" .!?,;:\u0964\u0965\u2026\"'-")
    if not bare:
        return "punctuation only"
    if lowered in config.HALLUCINATIONS or bare in config.HALLUCINATIONS:
        return "known phrase"
    if config.RE_HALLUCINATION.search(lowered):
        return "known phrase family"
    if len(bare) == 1 and bare.isascii() and bare.isalpha():
        return "a single letter, alone"
    if logprob is not None and logprob < config.STT_MIN_LOGPROB:
        return f"low confidence {logprob:.2f}"
    return ""


def tts_language(text):
    return "hi" if RE_DEVANAGARI.search(text or "") else "en"


_TONES = None


def tone_config(tone):
    """kg.KG_EMOTIONS: how a KG line is DELIVERED (Cartesia generation_config)."""
    global _TONES
    if _TONES is None:
        try:
            from liza import constant
            _TONES = constant("kg.py", "KG_EMOTIONS")
        except Exception:
            _TONES = {}
    return _TONES.get(tone or "")


def synthesize(text, language=None, tone=None):
    """MP3 bytes of her saying `text`. Raises VoiceUnavailable on any failure,
    so the browser can fall back to its own voice."""
    if _cartesia is None:
        raise VoiceUnavailable("Her voice is not set up (CARTESIA_API_KEY).")
    language = language or tts_language(text)
    voice_id = settings.VOICE_IDS.get(language) or settings.CARTESIA_VOICE_ID
    if not voice_id:
        raise VoiceUnavailable("No Cartesia voice is set (CARTESIA_VOICE_ID).")
    # Cartesia allows only a couple of requests at once on this plan
    # ("concurrency_limited"); two visitors, or a story, can ask for more.
    # Busy is worth waiting out briefly -- the alternative is the browser's
    # own voice taking over in the middle of a story.
    config = tone_config(tone)
    transcript = spoken.speakable(text, language)   # said, not read: "H2SO4", "x squared"

    def call(client):
        return client.tts.generate(
            model_id=settings.CARTESIA_MODEL,
            transcript=transcript,
            voice={"mode": "id", "id": voice_id},
            language=language,
            output_format={"container": "mp3", "sample_rate": 44100, "bit_rate": 128000},
            # generation_config carries its own speed; the two are never sent together.
            **({"generation_config": config} if config else {"speed": settings.CARTESIA_SPEED}),
        ).read()

    return _cartesia.run(call)
