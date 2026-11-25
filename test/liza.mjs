// Liza's flows on the whiteboard, tapped through in a real browser against the
// server with only the model scripted (test/fake_server.py): her measuring,
// buttons, steps, graph, lab and 3D views are all real. No OpenRouter calls.
// Run: node --experimental-websocket test/liza.mjs [screenshot dir]
import assert from "node:assert/strict";
import { launch, startFakeServer, pageUrl } from "./cdp.mjs";

const server = await startFakeServer({ port: 8098 });
const b = await launch({ port: 9343, shots: process.argv[2] });
const { send, js, touch, fingerLine, tapButton, shot, sleep, errors } = b;

async function waitFor(expr, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await js(expr);
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for " + what + "; chip: " + (await js("document.getElementById('chip').textContent")));
    await sleep(200);
  }
}
async function tapAt(selector, index = 0) {
  const [x, y] = await js(`(() => { const r = document.querySelectorAll(${JSON.stringify(selector)})[${index}].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await touch("touchStart", [[x, y]]);
  await touch("touchEnd", []);
}
async function tapPill(label) {
  const sel = `[...document.querySelectorAll('.pill')].findIndex(p => p.querySelector('b').textContent === ${JSON.stringify(label)})`;
  await waitFor(`${sel} >= 0`, label + " button");
  await tapAt(".pill", await js(sel));
}
const pills = () => js("[...document.querySelectorAll('#suggest .pill b')].map(b => b.textContent)");
async function freshBoard(read, reply = {}) {
  await server.script({ read, reply });
  if (await js("board.items.length")) await tapButton("#clear");
  await waitFor("document.getElementById('chip').hidden", "the chip to go");
}
async function scribble() {
  await fingerLine(250, 260, 330, 330);
  await fingerLine(360, 300, 460, 300);
  await fingerLine(500, 250, 560, 340);
  await sleep(700); // past app.js's 400 ms save, so a reading of the half-drawn page is already dropped
}

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await b.routeApi("http://127.0.0.1:8098");
  await send("Page.navigate", { url: pageUrl });
  await sleep(1500);

  console.log("measure it");
  await freshBoard({ read: "a triangle", shape: "Triangle" });
  await fingerLine(350, 520, 560, 200, 16);
  await fingerLine(560, 200, 780, 520, 16);
  await fingerLine(780, 520, 350, 520, 16);
  await sleep(700);
  await waitFor("document.getElementById('chip').textContent === 'I read: a triangle' && !!Liza.state().reading", "the reading");
  console.log("  buttons", await pills());
  await tapPill("Measure it");
  const marks = await js("[...document.querySelectorAll('#measure text')].map(t => t.textContent)");
  const angles = marks.filter((m) => /^\d+°$/.test(m)).map((m) => parseInt(m));
  console.log("  marks", marks.join(" "));
  assert.equal(angles.length, 3, "an angle in each corner");
  assert.ok(Math.abs(angles.reduce((a, c) => a + c, 0) - 180) <= 1, "they add up to 180");
  assert.ok(marks.includes("A + B + C = 180°"));
  await shot("liza-measure");

  console.log("plot it, solve it");
  await freshBoard({ read: "2x + 3 = 7", plot: ["2x + 3 = 7"], solve: "solve 2x + 3 = 7" },
    { sentences: ["Take 3 from both sides, so 2x is 4.", "Then divide both sides by 2.", "So x is 2!"],
      action: "show_visual:solution | Solve 2x + 3 = 7; 2x + 3 = 7 :: the equation; 2x = 4 :: take 3 from both sides; x = 2 :: divide both sides by 2; answer = x = 2; see = graph: y = 2x + 3" });
  await scribble();
  await waitFor("document.getElementById('chip').textContent === 'I read: 2x + 3 = 7' && !!Liza.state().reading", "the reading");
  assert.deepEqual(await pills(), ["Solve it", "Plot it"], "her buttons, in her order");
  await tapPill("Plot it");
  await waitFor("!document.getElementById('graph').hidden && document.querySelector('#graph-stage .gc-view svg, #graph-stage .gc-view canvas')", "her graph card");
  await waitFor("document.getElementById('graph-keys').textContent.includes('roots x = -1.5') && document.getElementById('graph-keys').textContent.includes('y-intercept 3')", "the graph's key points");
  await shot("liza-graph");
  await tapPill("Solve it");
  await waitFor("!document.getElementById('steps').hidden && document.querySelectorAll('#steps-list li').length === 4 && document.querySelector('#steps-list .katex')", "her steps, typeset");
  assert.equal(await js("document.querySelector('#steps-list li.answer').textContent.replace(/\\s+/g, ' ').includes('x=2') || document.querySelector('#steps-list li.answer .katex-mathml').textContent.includes('x=2')"), true, "the answer row");
  await waitFor("[...document.querySelectorAll('#chat .msg.liza')].some(m => m.textContent.includes('divide both sides by 2'))", "her words in the Ask Liza panel");
  assert.equal(await js("document.getElementById('steps-see').textContent.includes('See the graph')"), true, "her see button");
  const asked = (await server.asked()).at(-1);
  assert.equal(asked.question, "User: Solve what I've written on the board, step by step.");
  assert.equal(asked.board, true, "the page went with the question");
  await sleep(500);
  await shot("liza-steps");

  console.log("typed question");
  // Her voice is off in the test server, so each line waits out her speaker's retries first.
  await waitFor("!document.getElementById('askLiza').disabled", "her to finish", 30000);
  await js("document.getElementById('question').value = 'Is my answer right?'; 1");
  await tapButton("#askLiza");
  await waitFor("[...document.querySelectorAll('#chat .msg.user')].at(-1)?.textContent === 'Is my answer right?'", "the question in the chat");
  await sleep(800);
  assert.equal((await server.asked()).at(-1).question, "User: Is my answer right?");

  console.log("clearing the board takes her buttons and cards with it");
  assert.equal(await js("!document.getElementById('steps').hidden && !!document.querySelector('#offers .pill, #steps-see:not([hidden])')"), true, "her steps and button are up before");
  await tapButton("#clear");
  await waitFor("document.getElementById('offers').hidden && !document.querySelector('#offers .pill') && document.getElementById('steps').hidden && document.getElementById('graph').hidden", "her buttons and cards to go");

  console.log("cube: her geometry lab");
  await freshBoard({ read: "a cube ; 4 cm", solid: "Cube; side = 4 cm", solve: "find the volume of the cube" });
  await js("document.getElementById('steps').hidden = true; document.getElementById('graph').hidden = true; 1");
  await scribble();
  await waitFor("document.getElementById('chip').className === 'read'", "the reading");
  console.log("  buttons", await pills());
  await tapPill("See it in 3D");
  await waitFor("!document.getElementById('viewport').hidden && document.querySelector('.geo-big')", "her lab");
  await sleep(500);
  await shot("liza-lab");
  assert.equal(await js("document.querySelectorAll('.live-dims input').length"), 1, "a side slider");
  await js("{ const i = document.querySelector('.live-dims input'); i.value = 6; i.dispatchEvent(new Event('input')); } 1");
  await waitFor("document.querySelector('.geo-big') && document.querySelector('.geo-big').textContent.includes('216')", "the cube at side 6 (volume 216)", 15000);
  await shot("liza-lab-resized");
  await tapAt(".geo-big .geo-tap", (await js("document.querySelectorAll('.geo-big .geo-tap').length")) - 1);
  await waitFor("document.getElementById('viewport').hidden", "the lab to close");

  console.log("molecule: her 3D model");
  await freshBoard({ read: "CH₄", molecule: "methane" });
  await scribble();
  await waitFor("document.getElementById('chip').className === 'read'", "the reading");
  console.log("  buttons", await pills());
  await tapPill("See it in 3D");
  // Her engine's methane, captured as real 3D (tools/capture_engine.py), not her video of it.
  await waitFor("document.querySelector('.e3d') && document.querySelector('.e3d-wait').hidden", "the 3D methane", 30000);
  await sleep(1500);
  await shot("liza-molecule");
  await tapAt(".e3d-close");
  await waitFor("!document.querySelector('.e3d')", "the 3D view to close");

  console.log("reaction: her drawing");
  await freshBoard({ read: "H₂ + O₂ → H₂O", reaction: "H2 + O2 -> H2O", solve: "balance the equation" });
  await scribble();
  await waitFor("document.getElementById('chip').className === 'read'", "the reading");
  console.log("  buttons", await pills());
  assert.equal((await pills())[0], "Balance it");
  await tapPill("See the reaction");
  await waitFor("document.querySelector('.bv-big img')", "her reaction picture");
  await sleep(300);
  await shot("liza-reaction");

  console.log("black hole: her 3D Explorer");
  await js("document.querySelector('.bv-big') && document.querySelector('.bv-big').click(); 1");
  await freshBoard({ read: "black hole" });
  await scribble();
  await tapPill("Visualize in 3D");
  await waitFor("(() => { const f = document.querySelector('.holo-frame'); return !!(f && f.contentWindow.__holo && f.contentWindow.__holo.model); })()", "the black hole model", 30000);
  await sleep(1500);
  await shot("liza-blackhole");
  await js("document.querySelector('.holo-frame').contentWindow.__holo ? (window.lizaHolo.close(), 1) : 1");
  await waitFor("!document.querySelector('.holo-frame')", "the explorer to close");

  console.log("projectile motion: live from its equations");
  await js("Liza.runOffer({ kind: 'model3d', payload: 'projectile motion' }); 1");
  await waitFor("document.querySelector('.live-sim .e3d-readings div')", "the live projectile", 30000);
  const r1 = await js("document.querySelector('.e3d-readings').innerText");
  await sleep(1200);
  const r2 = await js("document.querySelector('.e3d-readings').innerText");
  assert.notEqual(r1, r2, "it runs: the readings move on");
  assert.match(r1, /Range\s+40.77 m/, "u 20, 45°: Liza's engine's range");
  assert.equal(await js("document.querySelectorAll('.live-params input').length"), 4, "u, θ, g, h");
  await js("{ const i = document.querySelectorAll('.live-params input')[1]; i.value = 30; i.dispatchEvent(new Event('input')); } 1");
  await waitFor("/Range\\s+35.31 m/.test(document.querySelector('.e3d-readings').innerText)", "the range at 30°");
  assert.ok(await js("document.querySelectorAll('.live-eq .katex').length === 5"), "its equations, typeset");
  await sleep(500);
  await shot("liza-projectile");
  await js("document.querySelector('.e3d-close').click(); 1");
  await waitFor("!document.querySelector('.e3d')", "the 3D view to close");

  console.log("select some drawings: she reads only those");
  await freshBoard({ read: "a parabola on axes", curve: "y = x²" }, { sentences: ["That is a parabola."] });
  await js(`window.__reads = []; const f0 = window.fetch; window.fetch = (u, o) => { if (String(u).includes("/api/board/read")) __reads.push(JSON.parse(o.body).strokes.length); return f0(u, o); }; 1`);
  await scribble();
  await fingerLine(850, 250, 1000, 330);
  await waitFor("__reads.at(-1) === 4", "a reading of the whole page");
  await tapButton('#rail [data-tool="select"]');
  await fingerLine(225, 246, 590, 365); // a box round the scribble, not the line on the right
  assert.equal(await js("Board.selection.length"), 3, "the box picks the three strokes it touches");
  assert.equal(await js("document.getElementById('selbar').hidden"), false, "the selection bar is up");
  await waitFor("__reads.at(-1) === 3 && document.getElementById('chip').className === 'read'", "a reading of just the picked strokes");
  await shot("liza-selection");
  await tapButton("#sel-ask");
  await waitFor("[...document.querySelectorAll('#chat .user')].some(m => m.textContent.includes('what I picked'))", "her chat about the picked part");
  const rightClick = async (x, y) => {
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "right", buttons: type === "mousePressed" ? 2 : 0, clickCount: 1 });
    await sleep(100);
  };
  await rightClick(290, 295); // on a picked stroke: only that one is let go
  assert.equal(await js("Board.selection.length"), 2, "right-click on a picked drawing drops just it");
  await rightClick(700, 600); // blank space
  assert.equal(await js("Board.selection.length"), 0, "right-click on blank space drops them all");
  await waitFor("__reads.at(-1) === 4", "the whole page again once nothing is picked");
  await fingerLine(225, 246, 590, 365);
  assert.equal(await js("Board.selection.length"), 3);
  await touch("touchStart", [[700, 600]]);
  await touch("touchEnd", []);
  assert.equal(await js("Board.selection.length"), 0, "a tap on blank space drops them all");

  console.log("the action dock, neat writing, questions, the back button");
  await waitFor("document.querySelectorAll('#suggest .act').length", "the action dock");
  assert.deepEqual(await js("[...document.querySelectorAll('#suggest .act span')].map(s => s.textContent)"),
    ["Explain", "Questions", "Summarise", "Neaten writing"], "a graph: no picture or diagram, the rest for any topic");
  await js(`window.__f1 = window.fetch; window.fetch = (u, o) => {
    const j = (d) => Promise.resolve(new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } }));
    if (String(u).includes("/api/check")) { window.__checkBody = JSON.parse(o.body); return j({ problem: "2x + 3 = 7", verdict: "mistake", hint: "What is 7 − 3?", praise: "Good start",
      lines: [{ work: "2x + 3 = 7", ok: true, note: "" }, { work: "2x = 10", ok: false, note: "7 − 3 isn't 10" }] }); }
    if (String(u).includes("/api/neaten")) return j({ lines: ["y = x²", "vertex at 0"], drawing: false });
    if (String(u).includes("/api/study")) { window.__studyLevel = JSON.parse(o.body).cls; return j({ kind: "questions", level: "college (undergraduate)", topic: "Parabolas",
      questions: [{ q: "Where is the vertex?", answer: "At the origin.", level: "easy" }, { q: "Roots of y = x² − 4?", answer: "x = ±2", level: "medium" }] }); }
    return window.__f1(u, o); }; 1`);
  await js("document.getElementById('cls').value = 'college'; 1");
  const before = await js("board.items.length");
  await js("[...document.querySelectorAll('#suggest .act')].find(b => b.textContent === 'Neaten writing').click(); 1");
  await waitFor("board.items.some(it => it.tool === 'text' && it.text === 'y = x²\\nvertex at 0')", "the neat text");
  assert.equal(await js("board.items.filter(it => it.tool === 'pen').length"), 0, "the handwriting went");
  await tapButton("#undo");
  assert.equal(await js("board.items.length"), before, "undo brings the handwriting back");
  await js("[...document.querySelectorAll('#suggest .act')].find(b => b.textContent === 'Questions').click(); 1");
  await waitFor("document.querySelectorAll('.msg.study ol li').length === 2", "the questions card");
  assert.equal(await js("window.__studyLevel"), "college", "asked at the chosen level");
  assert.equal(await js("document.querySelector('.msg.study .answer').hidden"), true, "answers hidden at first");
  await js("document.querySelector('.msg.study li .mini').click(); 1");
  assert.equal(await js("document.querySelector('.msg.study .answer').hidden"), false);
  await shot("liza-questions");
  await js("document.getElementById('syllabus').value = 'icse'; document.getElementById('lang').value = 'hi'; Liza.checkWork(); 1");
  await waitFor("document.querySelector('.verdict.mistake') && document.querySelectorAll('.checks li.bad').length === 1", "her marking");
  assert.deepEqual(await js("[__checkBody.cls, __checkBody.syllabus, __checkBody.lang, __checkBody.image.slice(0, 22)]"),
    ["college", "icse", "hi", "data:image/png;base64,"], "the page and the settings go with it");
  assert.match(await js("document.querySelector('.nudge').textContent"), /7 − 3/);
  assert.equal(await js("document.getElementById('panel-back').hidden"), false, "a way back to the options");
  await tapButton("#panel-back");
  assert.deepEqual(await js("[document.getElementById('welcome').hidden, document.getElementById('chat').hidden]"), [false, true]);
  await tapButton('[data-quick="mindmap"]');
  assert.equal(await js("document.getElementById('panel-back').hidden"), false, "back from a chosen option too");
  await tapButton("#panel-back");
  assert.equal(await js("document.getElementById('quick-chip').hidden"), true);
  await js("window.fetch = window.__f1; 1");

  console.log("phone");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(600);
  await shot("liza-phone");

  assert.deepEqual(errors, [], "no errors in the page");
  console.log("liza: all checks pass");
} finally {
  await b.close();
  server.close();
}
