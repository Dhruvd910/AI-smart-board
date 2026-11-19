"""Every setting the web backend reads, in one place.

On Cloud Run these come from the service's environment variables. Running on
the Pi for development, web/.env is read first and then Liza's own .env, so the
same OpenRouter, Groq and Cartesia keys work without being copied. A variable
already in the environment always wins over either file.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.dirname(HERE)
REPO_DIR = os.path.dirname(WEB_DIR)


def _load_env_file(path):
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            # A trailing " # comment", as Liza's config.py allows.
            if value[:1] not in "\"'":
                for at in range(1, len(value)):
                    if value[at] == "#" and value[at - 1] in " \t":
                        value = value[:at].rstrip()
                        break
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            if key and not os.getenv(key):
                os.environ[key] = value


_load_env_file(os.path.join(WEB_DIR, ".env"))
_load_env_file(os.path.join(REPO_DIR, ".env"))


def _int(name, default):
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _float(name, default):
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


# ----- the reply model (OpenRouter), as on the device -----
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "google/gemini-2.5-flash")
LLM_TEMPERATURE = _float("LLM_TEMPERATURE", 0.4)
LLM_MAX_TOKENS = _int("LLM_MAX_TOKENS", 900)
# google-ai-studio answers gemini-2.5-flash in about half the time Vertex does;
# see the measurements above LLM_PROVIDER_ORDER in Liza's config.py.
LLM_PROVIDER_ORDER = [p.strip() for p in
                      os.getenv("LLM_PROVIDER_ORDER", "google-ai-studio").split(",")
                      if p.strip()]

# ----- hearing (Groq Whisper) -----
GROQ_API_KEY = (os.getenv("GROQ_API_KEY")
                or (os.getenv("GROQ_STT_KEYS") or "").split(",")[0].strip())
STT_MODEL = os.getenv("GROQ_STT_MODEL", "whisper-large-v3")

# ----- her voice (Cartesia) -----
# Firebase Authentication (project liza-tutor-web): the web API key is public by
# design; it only identifies the project to Firebase's sign-in service.
FIREBASE_API_KEY = os.getenv("FIREBASE_API_KEY", "")
CARTESIA_API_KEY = os.getenv("CARTESIA_API_KEY", "")
# More keys, comma-separated: when one runs out of credit (or is busy) her
# voice moves on to the next without a gap. CARTESIA_API_KEY is used too.
CARTESIA_API_KEYS = [k for k in dict.fromkeys(
    [k.strip() for k in os.getenv("CARTESIA_API_KEYS", "").split(",")] + [CARTESIA_API_KEY]) if k]
CARTESIA_MODEL = os.getenv("CARTESIA_MODEL", "sonic-3.5")
CARTESIA_SPEED = os.getenv("CARTESIA_SPEED", "fast")
CARTESIA_VOICE_ID = os.getenv("CARTESIA_VOICE_ID", "")
VOICE_IDS = {
    "en": os.getenv("CARTESIA_VOICE_ID_EN", "") or CARTESIA_VOICE_ID,
    "hi": os.getenv("CARTESIA_VOICE_ID_HI", "") or CARTESIA_VOICE_ID,
}

# ----- weather card (optional; OpenWeatherMap, as on the device) -----
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY", "")
WEATHER_CITY = os.getenv("WEATHER_CITY", "Delhi")

# ----- the database -----
# Its own database, never the device's `liza` one: visitors' turns must not mix
# with the real students' notebooks.
DATABASE_URL = os.getenv("WEB_DATABASE_URL", "postgresql:///liza_web")

# ----- who may call the API -----
# Comma-separated origins, e.g. "https://liza-demo.web.app". Empty allows any,
# which is only sensible while developing.
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",")
                   if o.strip()]

# ----- limits, because every visitor costs money -----
TURNS_PER_MINUTE = _int("TURNS_PER_MINUTE", 8)          # per visitor (IP)
TTS_PER_MINUTE = _int("TTS_PER_MINUTE", 90)             # per visitor, sentences
DAILY_TURN_CAP = _int("DAILY_TURN_CAP", 1500)           # all visitors together
DAILY_TTS_CHAR_CAP = _int("DAILY_TTS_CHAR_CAP", 250000)  # all visitors together
MAX_AUDIO_BYTES = _int("MAX_AUDIO_BYTES", 3_000_000)    # about a minute of opus
MAX_TEXT_CHARS = _int("MAX_TEXT_CHARS", 600)

# Visitors' own profiles, and everything the demo profiles collect, are wiped
# after this long, so one visitor's data never stays for the next.
DEMO_RESET_HOURS = _int("DEMO_RESET_HOURS", 24)

# Where the browser files are, for serving them while developing. On Firebase
# Hosting the backend serves none of them.
FRONTEND_DIR = os.getenv("FRONTEND_DIR", os.path.join(WEB_DIR, "frontend"))
SERVE_FRONTEND = os.getenv("SERVE_FRONTEND", "1") == "1"
