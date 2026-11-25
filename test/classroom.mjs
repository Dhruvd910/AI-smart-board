// Classroom mode's screens, teacher and student, in a real browser. Chromium here
// can't reach a local server, so the classroom server is stood in for inside the
// page (the real one is tested in auth_test.py): this checks what each screen
// sends and how it shows what comes back.
// Run: node --experimental-websocket test/classroom.mjs [screenshot dir]
import assert from "node:assert/strict";
import { launch, pageUrl, sleep } from "./cdp.mjs";

const b = await launch({ port: 9371, shots: process.argv[2] });
const { send, js, tapButton, fingerLine, shot, errors } = b;

async function waitFor(expr, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await js(expr);
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for " + what);
    await sleep(200);
  }
}

// A pretend classroom server: what the page asked, and what to answer.
const STAND_IN = `(() => {
  const me = JSON.parse(localStorage.getItem("test.me") || "null");
  const cls = window.__cls = { sent: [], task: null, task_at: 0, ended: null, showing: false, snapAt: 0, calls: [] };
  const json = (d, status = 200) => Promise.resolve(new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } }));
  const real = window.fetch;
  window.fetch = (url, opts = {}) => {
    url = String(url);
    if (!url.includes("api/")) return real(url, opts);
    const path = url.split("api/").pop().split("?")[0], method = opts.method || "GET";
    const body = opts.body ? JSON.parse(opts.body) : {};
    cls.calls.push(method + " " + path);
    if (path === "auth/me") return json(me ? { signed_in: true, enabled: true, status: "active", admin: false, ...me } : { signed_in: false, enabled: false });
    if (path === "boards" && method === "GET") return json([]);
    if (path === "boards" && method === "POST") return json({ id: "b1" });
    if (path.startsWith("boards/")) return json({ id: "b1", updated: Date.now() / 1000 });
    if (path === "classes/mine") return json([]);
    if (path === "classes" && method === "POST") return json({ code: "ABC234", title: body.title || "My class" });
    if (path === "classes/join") return json({ code: body.code, title: "Physics 9A", own: false });
    if (path === "classes/ABC234") return json({ code: "ABC234", title: "Physics 9A", students: [
      { email: "sam@example.com", name: "Sam", snap_at: cls.snapAt, online: true },
      { email: "ria@example.com", name: "Ria", snap_at: 0, online: false }] });
    if (path === "classes/ABC234/me") { if ("image" in body) cls.sent.push(body.image); return json({ title: "Physics 9A", task: cls.task, task_at: cls.task_at, ended: cls.ended, showing: cls.showing, snap_at: 1 }); }
    if (path === "classes/ABC234/task") { cls.task = body.text; return json({ ok: true }); }
    if (path === "classes/ABC234/show") { cls.shown = body.image; return json({ ok: true }); }
    if (path === "classes/ABC234/end") { cls.ended = 1; return json({ ok: true }); }
    if (path === "classes/ABC234/leave") return json({ ok: true });
    return json({ read: "", suggest: [] });
  };
})();`;

async function openAs(person) {
  await send("Page.navigate", { url: pageUrl });
  await sleep(300);
  await js(`localStorage.clear(); localStorage.setItem("test.me", ${JSON.stringify(JSON.stringify(person))}); 1`);
  await send("Page.navigate", { url: pageUrl });
  await waitFor("window.__cls && !document.getElementById('profile').hidden", "signed in");
  await tapButton("#panel-min");
}

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: STAND_IN });

  console.log("teacher: start a class, see students, send a question, show the board, end");
  await openAs({ email: "teach@example.com", name: "Ms Rao", teacher: true });
  await fingerLine(300, 300, 600, 420);
  await tapButton("#class-btn");
  await waitFor("!document.getElementById('classfly').hidden", "the class menu");
  assert.equal(await js("document.getElementById('class-teach').hidden"), false, "teachers can start a class");
  await js("document.getElementById('class-title').value = 'Physics 9A'; 1");
  await tapButton("#class-start");
  await waitFor("document.querySelectorAll('#cr-grid .tile').length === 2", "a tile per student");
  assert.equal(await js("document.getElementById('cr-code').textContent"), "ABC234");
  assert.match(await js("document.getElementById('cr-count').textContent"), /2 joined · 1 online/);
  await js("__cls.snapAt = 5; 1");
  await waitFor("[...document.querySelectorAll('#cr-grid .tile img')].some(i => i.getAttribute('src') === 'api/classes/ABC234/snap/sam%40example.com?t=5')", "Sam's board picture asked for");
  await js("document.getElementById('cr-task-text').value = 'Draw the forces on a ball in flight'; document.querySelector('#cr-task button').click(); 1");
  await waitFor("__cls.task === 'Draw the forces on a ball in flight'", "the question sent");
  await js("document.getElementById('cr-show').click(); 1");
  await waitFor("typeof __cls.shown === 'string' && __cls.shown.startsWith('data:image/jpeg;base64,')", "the teacher's board sent");
  await shot("class-teacher");
  await js("window.confirm = () => true; document.getElementById('cr-end').click(); 1");
  await waitFor("__cls.ended === 1 && document.getElementById('classroom').hidden", "the class ended");

  console.log("student: join, board sent, the question arrives, the teacher's board, sent out at the end");
  await openAs({ email: "sam@example.com", name: "Sam", teacher: false });
  await tapButton("#class-btn");
  await waitFor("!document.getElementById('classfly').hidden", "the class menu");
  assert.equal(await js("document.getElementById('class-teach').hidden"), true, "students can't start classes");
  await js("document.getElementById('class-code').value = 'abc234'; 1");
  await tapButton("#class-join");
  await waitFor("!document.getElementById('classbar').hidden", "the in-class bar");
  assert.equal(await js("document.getElementById('classbar-title').textContent"), "Physics 9A");
  await fingerLine(300, 300, 700, 300);
  await waitFor("__cls.sent.some(s => typeof s === 'string' && s.startsWith('data:image/jpeg;base64,'))", "the student's board sent");
  await js("__cls.task = 'Draw the forces on a ball in flight'; __cls.task_at = 10; __cls.showing = true; 1");
  await waitFor("[...document.querySelectorAll('.msg.teacher')].some(m => m.textContent.includes('forces on a ball'))", "the question at the student");
  await waitFor("!document.getElementById('classbar-teacher').hidden", "the Teacher's board button");
  await shot("class-student");
  await tapButton("#classbar-teacher");
  assert.equal(await js("document.getElementById('bv-img').getAttribute('src').startsWith('api/classes/ABC234/teacher')"), true);
  await tapButton("#bv-close");
  await js("__cls.ended = 1; 1");
  await waitFor("document.getElementById('classbar').hidden", "sent out of the ended class");

  assert.deepEqual(errors.filter((e) => !/Failed to load resource|ERR_FILE_NOT_FOUND/.test(e)), [], "no errors in the page");
  console.log("classroom: all checks pass");
} finally {
  b.close();
}
