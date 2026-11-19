"""The whiteboard's server with only the model replaced, for testing the page
without OpenRouter. Liza's measuring, buttons, drawings, steps, graphs and lab
stay real; what the model would have read or said is scripted per test with
POST /test/script {"read": {...}, "reply": {"sentences": [...], "action": "..."}}.

    .venv/bin/python test/fake_server.py 8098
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server  # noqa: E402
import uvicorn  # noqa: E402

script = {"read": {}, "reply": {}}
asked = []


def fake_read(image):
    return {**server.whiteboard.EMPTY_READING, **script["read"]}


def fake_stream(messages, language, board=False):
    asked.append({"question": messages[-1]["content"] if isinstance(messages[-1]["content"], str)
                  else messages[-1]["content"][1]["text"].split("\n\n")[0], "board": board})
    reply = script["reply"]
    for line in reply.get("sentences", []):
        yield {"type": "sentence", "text": line}
    if reply.get("action"):
        name, _, param = reply["action"].partition(":")
        yield {"type": "action", "name": name, "param": param, "raw": reply["action"]}
    yield {"type": "done", "answer": " ".join(reply.get("sentences", []))}


def no_voice(*_args, **_kwargs):
    raise server.voice.VoiceUnavailable("test: no voice")


server.access.CLIENT_ID = ""  # sign-in off: these tests are about the board
server.whiteboard.read = fake_read
server.brain.stream_reply = fake_stream
server.voice.synthesize = no_voice


@server.app.post("/test/script")
def set_script(body: dict):
    script.update(body)
    return {"ok": True}


@server.app.get("/test/asked")
def get_asked():
    return asked


# The page's catch-all mount goes back to the end, behind these routes.
routes = server.app.router.routes
page = next(r for r in routes if getattr(r, "name", "") == "page")
routes.remove(page)
routes.append(page)

if __name__ == "__main__":
    uvicorn.run(server.app, host="127.0.0.1", port=int(sys.argv[1] if len(sys.argv) > 1 else 8098), log_level="warning")
