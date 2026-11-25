"""Sign-in, letting people in, blocking, and the activity log, with Google's check faked.
    .venv/bin/python test/auth_test.py
"""
import os
import sys
import tempfile

os.environ.update(GOOGLE_CLIENT_ID="test-client", ADMIN_EMAILS="Boss@example.com",
                  WB_DATA=os.path.join(tempfile.mkdtemp(), "wb.db"))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

server.access.verify_google = lambda credential: (
    None if credential == "forged" else {"email": credential, "name": credential.split("@")[0], "picture": ""})
server.board_kit.show = lambda request, hindi, lab: {"visual": {"kind": "test"}}
server.board_kit.read_page = lambda strokes, hindi=False: {"read": "y = x^2 - 3", "suggest": []}
STROKES = [[[[100, 100], [300, 200], [500, 120]], "#000000", 4, False]]


def client():
    return TestClient(server.app, base_url="https://testserver")


anon = client()
assert anon.get("/api/status").status_code == 200
assert anon.get("/api/auth/config").json() == {"enabled": True, "client_id": "test-client"}
assert anon.get("/api/auth/me").json()["signed_in"] is False
assert anon.post("/api/visual", json={"kind": "graph", "payload": "y=x"}).status_code == 401
assert anon.get("/api/admin/users").status_code == 401
assert anon.post("/api/auth/google", json={"credential": "forged"}).status_code == 401

# A new person waits for the admin.
amy = client()
r = amy.post("/api/auth/google", json={"credential": "amy@example.com"})
assert r.status_code == 200 and r.json()["status"] == "pending", r.json()
assert "httponly" in r.headers["set-cookie"].lower() and "secure" in r.headers["set-cookie"].lower()
assert amy.post("/api/visual", json={"kind": "graph", "payload": "y=x"}).status_code == 403

# The admin (any case of the email) is in at once and sees her waiting.
boss = client()
assert boss.post("/api/auth/google", json={"credential": "boss@example.com"}).json() | {} and \
    boss.get("/api/auth/me").json()["admin"] is True
assert amy.get("/api/admin/users").status_code == 403
people = {p["email"]: p for p in boss.get("/api/admin/users").json()}
assert people["amy@example.com"]["status"] == "pending"
assert boss.post("/api/admin/users/boss@example.com", json={"status": "blocked"}).status_code == 400  # admins stay

# Let in: she can use the board, and what she does is logged.
assert boss.post("/api/admin/users/amy@example.com", json={"status": "active"}).status_code == 200
assert amy.post("/api/visual", json={"kind": "graph", "payload": "y = x^2 - 3"}).status_code == 200
log = boss.get("/api/admin/activity?email=amy@example.com").json()
assert [a["kind"] for a in log] == ["opened", "sign in"], log
assert log[0]["detail"] == "y = x^2 - 3"

# What she writes is kept by name and time only: no picture is stored anywhere.
assert amy.post("/api/board/read", json={"strokes": STROKES}).json()["read"] == "y = x^2 - 3"
mine = amy.get("/api/me/history").json()
assert [(h["kind"], h["detail"]) for h in mine] == [("wrote", "y = x^2 - 3"), ("opened", "y = x^2 - 3")], mine
assert set(mine[0]) == {"id", "at", "kind", "detail"}
assert not os.path.exists(os.path.join(os.path.dirname(os.environ["WB_DATA"]), "drawings"))
assert amy.get(f"/api/drawing/{mine[0]['id']}").status_code == 404
bob = client()
bob.post("/api/auth/google", json={"credential": "bob@example.com"})
boss.post("/api/admin/users/bob@example.com", json={"status": "active"})
assert bob.get("/api/me/history").json() == [], "only her own history"

# Blocked: out everywhere at once, and can't come back in.
assert boss.post("/api/admin/users/amy@example.com", json={"status": "bogus"}).status_code == 400
assert boss.post("/api/admin/users/amy@example.com", json={"status": "blocked"}).status_code == 200
assert amy.post("/api/visual", json={"kind": "graph", "payload": "y=x"}).status_code == 401
again = client()
assert again.post("/api/auth/google", json={"credential": "amy@example.com"}).json()["status"] == "blocked"
assert again.post("/api/visual", json={"kind": "graph", "payload": "y=x"}).status_code == 403

# Boards: saved per person, private, shared as a copy.
board = {"pages": [{"items": [{"tool": "pen", "color": "#000", "width": 3, "points": [[0, 0, 0.5], [9, 9, 0.5]]}]}]}
bid = bob.post("/api/boards", json={"title": "Bob's maths", "data": board}).json()["id"]
assert [b["title"] for b in bob.get("/api/boards").json()] == ["Bob's maths"]
saved = bob.put(f"/api/boards/{bid}", json={"title": "Algebra", "data": board}).json()
assert saved["title"] == "Algebra"
assert bob.get(f"/api/boards/{bid}").json()["data"] == board
assert boss.get(f"/api/boards/{bid}").status_code == 404, "not even an admin opens someone's board by id"
assert boss.put(f"/api/boards/{bid}", json={"title": "x"}).status_code == 404
too_big = {"pages": [{"items": [{"tool": "text", "color": "#000", "x": 0, "y": 0, "size": 9, "text": "x" * 13_000_000}]}]}
assert bob.put(f"/api/boards/{bid}", json={"data": too_big}).status_code == 413
token = bob.post(f"/api/boards/{bid}/share").json()["token"]
assert bob.post(f"/api/boards/{bid}/share").json()["token"] == token, "one link per board"
copy = boss.post(f"/api/shared/{token}").json()
assert copy["own"] is False and copy["id"] != bid
mine_copy = boss.get(f"/api/boards/{copy['id']}").json()
assert mine_copy["title"] == "Algebra (copy)" and mine_copy["data"] == board
boss.put(f"/api/boards/{copy['id']}", json={"data": {"pages": [{"items": []}]}})
assert bob.get(f"/api/boards/{bid}").json()["data"] == board, "the owner's board is untouched by the copy"
assert bob.post(f"/api/shared/{token}").json() == {"id": bid, "own": True}
assert boss.post("/api/shared/nope").status_code == 404
assert bob.delete(f"/api/boards/{bid}").status_code == 200
assert bob.get("/api/boards").json() == []
assert anon.get("/api/boards").status_code == 401

# Mind maps and flowcharts: the model's JSON is checked and trimmed before the page draws it.
replies = iter([
    "Sure! {not json",
    '{"center": "Water cycle", "branches": [{"label": "Evaporation", "children": ["Sun heats water", 7, ""]},'
    ' {"label": "Rain", "children": ["Falls"]}, {"label": ""}]}',
])
server.boards.brain.complete = lambda messages, max_tokens=300: next(replies)
mm = bob.post("/api/diagram", json={"kind": "mindmap", "topic": "water cycle"}).json()
assert mm["center"] == "Water cycle" and [b["label"] for b in mm["branches"]] == ["Evaporation", "Rain"]
assert mm["branches"][0]["children"] == ["Sun heats water", "7"]
fc = server.boards.clean_diagram("flowchart", {"nodes": [{"id": "a", "label": "Start", "type": "start"},
    {"id": "b", "label": "Boil", "type": "weird"}, {"id": "a", "label": "dup"}],
    "links": [{"from": "a", "to": "b", "label": "next"}, {"from": "a", "to": "zzz"}, {"from": "b", "to": "b"}]})
assert [n["type"] for n in fc["nodes"]] == ["start", "step"] and len(fc["links"]) == 1
assert server.boards.clean_diagram("mindmap", {"center": "x", "branches": []}) is None
assert server.boards._words("Second Reading: General Discussion, Clause-by-Clause Consideration", 40) == "Second Reading: General Discussion…"
assert server.boards._words("short") == "short" and len(server.boards._words("x" * 100)) == 60
assert bob.post("/api/diagram", json={"kind": "poem", "topic": "x"}).status_code == 400
assert [a["kind"] for a in boss.get("/api/admin/activity?email=bob@example.com").json()][:1] == ["made mind map"]

# Neat writing, summaries and questions: the page goes as a picture, the reply is checked.
PNG = "data:image/png;base64,iVBORw0KGgo="
seen = []
def fake(messages, max_tokens=300):
    seen.append(messages)
    return next(replies)
server.boards.brain.complete = fake
replies = iter(['{"lines": ["Projectile motion", "", 5], "drawing": false}'])
assert bob.post("/api/neaten", json={"image": PNG}).json() == {"lines": ["Projectile motion"], "drawing": False}
assert seen[-1][-1]["content"][0]["image_url"]["url"] == PNG, "the page goes with the question"
assert bob.post("/api/neaten", json={"image": "data:text/html,hi"}).status_code == 400
replies = iter(['{"title": "Motion", "points": ["Thrown things curve.", ""]}'])
sm = bob.post("/api/study", json={"kind": "summary", "image": PNG, "cls": "college"}).json()
assert sm["points"] == ["Thrown things curve."] and sm["level"] == "college (undergraduate)"
assert "college (undergraduate)" in seen[-1][-1]["content"][1]["text"]
replies = iter(["no", '{"topic": "Projectile", "questions": [{"q": "What is range?", "answer": "How far it goes.", "level": "easy"},'
                ' {"q": "Max height for u = 20 m/s straight up?", "answer": "20.4 m", "level": "insane"}, {"q": "", "answer": "x"}]}'])
qs = bob.post("/api/study", json={"kind": "questions", "topic": "projectile motion", "cls": "9"}).json()
assert [q["level"] for q in qs["questions"]] == ["easy", "medium"] and qs["level"] == "Class 9"
assert isinstance(seen[-1][-1]["content"], str), "a typed topic alone: no picture"
assert bob.post("/api/study", json={"kind": "summary", "cls": "9"}).status_code == 400, "a summary needs the page"
assert bob.post("/api/study", json={"kind": "poem", "image": PNG}).status_code == 400
assert server.boards.level_words("higher") == "higher studies (postgraduate)" and server.boards.level_words("") == "Class 8"

# Check my work: lines marked, a wrong line can't make it "correct", level and language in the prompt.
replies = iter(['{"problem": "2x + 3 = 7", "lines": [{"work": "2x = 10", "ok": false, "note": "7 - 3 is not 10"},'
                ' {"work": "x = 5", "ok": true}], "verdict": "correct", "hint": "What is 7 - 3?", "praise": "Neat"}'])
ck = bob.post("/api/check", json={"image": PNG, "cls": "8", "syllabus": "cbse", "lang": "hi"}).json()
assert ck["verdict"] == "mistake" and [l["ok"] for l in ck["lines"]] == [False, True]
prompt_text = seen[-1][-1]["content"][1]["text"]
assert "CBSE" in prompt_text and "Hindi" in prompt_text and "Class 8" in prompt_text

# Teachers: the admin makes one; only teachers start classes.
assert bob.post("/api/classes", json={"title": "x"}).status_code == 403
assert boss.post("/api/admin/users/bob@example.com/role", json={"role": "teacher"}).status_code == 200
assert boss.post("/api/admin/users/bob@example.com/role", json={"role": "king"}).status_code == 400
assert bob.get("/api/auth/me").json()["teacher"] is True
cls = bob.post("/api/classes", json={"title": "  Physics   9A "}).json()
assert cls["title"] == "Physics 9A" and len(cls["code"]) == 6
code = cls["code"]

# A student joins, sends their board, gets the teacher's question; the teacher sees the picture.
JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=="
sam = client()
sam.post("/api/auth/google", json={"credential": "sam@example.com"})
boss.post("/api/admin/users/sam@example.com", json={"status": "active"})
assert sam.post("/api/classes/join", json={"code": "nope00"}).status_code == 404
assert sam.post("/api/classes/join", json={"code": code.lower()}).json()["title"] == "Physics 9A"
assert sam.post(f"/api/classes/{code}/me", json={"image": "data:image/png;base64,xx"}).status_code == 400
st = sam.post(f"/api/classes/{code}/me", json={"image": JPG}).json()
assert st["task"] is None and st["ended"] is None and st["showing"] is False
assert sam.get(f"/api/classes/{code}").status_code == 403, "only the teacher sees the class"
v = bob.get(f"/api/classes/{code}").json()
assert [s["email"] for s in v["students"]] == ["sam@example.com"] and v["students"][0]["online"]
pic = bob.get(f"/api/classes/{code}/snap/sam@example.com")
assert pic.status_code == 200 and pic.headers["content-type"] == "image/jpeg" and pic.content.startswith(b"\xff\xd8")
assert sam.get(f"/api/classes/{code}/snap/sam@example.com").status_code == 403
assert bob.post(f"/api/classes/{code}/task", json={"text": "Find the range for u = 20 m/s"}).status_code == 200
assert sam.post(f"/api/classes/{code}/me", json={}).json()["task"] == "Find the range for u = 20 m/s"
assert bob.post(f"/api/classes/{code}/show", json={"image": JPG}).status_code == 200
assert sam.post(f"/api/classes/{code}/me", json={}).json()["showing"] is True
assert sam.get(f"/api/classes/{code}/teacher").content.startswith(b"\xff\xd8")
assert [c["code"] for c in bob.get("/api/classes/mine").json()] == [code]
assert bob.post(f"/api/classes/{code}/end").status_code == 200
assert sam.post(f"/api/classes/{code}/me", json={}).json()["ended"]
assert sam.post("/api/classes/join", json={"code": code}).status_code == 410

# A daily AI limit per person (admins have none); the admin sees today's count.
server.access.DAILY_AI = 2
eve = client()
eve.post("/api/auth/google", json={"credential": "eve@example.com"})
boss.post("/api/admin/users/eve@example.com", json={"status": "active"})
codes = [eve.post("/api/board/read", json={"strokes": STROKES}).status_code for _ in range(3)]
assert codes == [200, 200, 429], codes
assert {p["email"]: p for p in boss.get("/api/admin/users").json()}["eve@example.com"]["ai_today"] == 2
assert eve.get("/api/boards").status_code == 200, "only AI calls count"
assert boss.post("/api/board/read", json={"strokes": STROKES}).status_code == 200
server.access.DAILY_AI = 500

# Delete my account: everything about them goes, and they are signed out.
eve.post("/api/boards", json={"title": "Eve's"})
assert eve.post("/api/me/delete").json() == {"deleted": True}
assert eve.get("/api/auth/me").json()["signed_in"] is False
assert not server.access.q("SELECT 1 FROM boards WHERE email = 'eve@example.com'")
assert not server.access.q("SELECT 1 FROM activity WHERE email = 'eve@example.com'")
assert "eve@example.com" not in {p["email"] for p in boss.get("/api/admin/users").json()}
assert boss.post("/api/me/delete").status_code == 400, "the admin can't delete itself"

# Daily backups: a real SQLite copy with the data in it.
import backups, sqlite3  # noqa: E402,E401
os.remove(backups.backup_now())  # the one taken when the server started, before any users
path = backups.backup_now()
assert sqlite3.connect(path).execute("SELECT COUNT(*) FROM users").fetchone()[0] >= 3

# Sign out ends the session.
assert boss.post("/api/auth/logout").status_code == 200
assert boss.get("/api/admin/users").status_code == 401
print("auth: all checks pass")
