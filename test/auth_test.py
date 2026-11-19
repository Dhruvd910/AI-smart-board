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

# Sign out ends the session.
assert boss.post("/api/auth/logout").status_code == 200
assert boss.get("/api/admin/users").status_code == 401
print("auth: all checks pass")
