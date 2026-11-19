// Liza's whiteboard on this board. Her web copy's screens/whiteboard.js, laid
// over a touch canvas that zooms and scrolls instead of her fixed 800x480 page:
// the live reading and its chip, her buttons under the writing, Measure it,
// Ask Liza (typed, spoken or tapped), her voice with each step of her working
// lit as she says it, her graph card, and her full-screen views (a picture, a
// 3D model, the geometry lab) on her own stage. The modules in lw/ are hers,
// unchanged; the server behind /api is her code too (server.py).
// Uses app.js's board, view, W, H, C, drawItem, pointers, textbox, paint, save.

import * as api from "./lw/js/api.js";
import { LiveGraph } from "./lw/js/graphcard.js";
import { BoardVisual } from "./lw/js/boardvisual.js";
import { listener, speaker } from "./lw/js/voice.js";
import { fitStage, stage } from "./lw/js/ui.js";
import * as explorer from "./lw/js/explorer.js";
import * as engine3d from "./engine3d.js";
import * as live from "./live.js";

const PAGE_W = 800, PAGE_H = 380;      // her page (board.PAGE_SIZE): what her measuring is tuned for
const READ_PAUSE_MS = 600;             // + app.js's 400 ms save delay = her 1 s (BOARD_READ_PAUSE_S)
const LETTERS = "ABCDEFGHIJKLMNPQRSTUVWXYZ";
const DEVANAGARI = /[ऀ-ॿ]/;
const NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);

let lastSig = "", readTimer = 0, reading = null;   // reading: {found, frame} for what is on screen
let measureShown = false;
let offers = [];                                    // her buttons from her last answer
let panel = null, step = -1;                        // her worked solution (board.panel)
let graph = null;                                   // her graph card (LiveGraph)
let controller = null, lang = "en";
const history = [];

// ------------------------------------------------------------------ the page in her frame
function visibleItems() {
  const chosen = window.Board ? Board.selection : [];
  if (chosen.length) return chosen; // drawings picked with the select tool: she looks at those alone
  const [x0, y0] = toBoard(0, 0), [x1, y1] = toBoard(W, H);
  return board.items.filter((it) => {
    const b = C.bounds(it);
    return b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1;
  });
}

const toScreen = ([x, y]) => [x * view.s + view.x, y * view.s + view.y];

function inkBox(items) {
  const b = C.boundsOf(items);
  if (!b) return null;
  const [x0, y0] = toScreen([b.x0, b.y0]), [x1, y1] = toScreen([b.x1, b.y1]);
  return [x0, y0, x1, y1];
}

// Screen pixels are about her page's pixels on a phone or a laptop; a big
// drawing on a smartboard is shrunk to fit her page, never blown up.
function frameFor(items) {
  const [x0, y0, x1, y1] = inkBox(items);
  const k = Math.min(1, (PAGE_W - 40) / Math.max(1, x1 - x0), (PAGE_H - 20) / Math.max(1, y1 - y0));
  return { k, ox: 20 - x0 * k, oy: 10 - y0 * k };
}
const toPage = (f, p) => { const [x, y] = toScreen(p); return [x * f.k + f.ox, y * f.k + f.oy]; };
const fromPage = (f, [x, y]) => [(x - f.ox) / f.k, (y - f.oy) / f.k];

// The writing as her whiteboard.py takes it: [points, colour, width, erase].
// Highlighter is left out: on her page it would be an opaque bar over the ink.
function strokesFor(items, f) {
  const out = [];
  for (const it of items) {
    if (it.tool === "text" || it.tool === "hl") continue;
    const width = Math.max(2, it.width * view.s * f.k);
    out.push([C.outline(it).map((p) => toPage(f, p)), it.color, width, false]);
    if (it.tool === "arrow") {
      const [a, b] = it.points;
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = it.width * 5;
      for (const side of [-1, 1]) {
        out.push([[toPage(f, b), toPage(f, [b[0] - len * Math.cos(ang + side * 0.45), b[1] - len * Math.sin(ang + side * 0.45)])], it.color, width, false]);
      }
    }
  }
  return out;
}

// Typed text can't go as strokes, so a page with text on it goes as a picture too.
function pictureFor(items) {
  if (!items.some((it) => it.tool === "text")) return null;
  const b = C.boundsOf(items), m = 18 / view.s;
  const w = b.x1 - b.x0 + 2 * m, h = b.y1 - b.y0 + 2 * m;
  const k = Math.min(1280 / Math.max(w, h), view.s * 3);
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * k);
  c.height = Math.ceil(h * k);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(k, 0, 0, k, (m - b.x0) * k, (m - b.y0) * k);
  items.filter((it) => it.tool !== "hl").forEach((it) => drawItem(ctx, it));
  return c.toDataURL("image/png");
}

function page() {
  const items = visibleItems();
  if (!items.length) return null;
  const frame = frameFor(items);
  return { items, frame, strokes: strokesFor(items, frame), image: pictureFor(items) };
}

// ------------------------------------------------------------------ the live reading
function forgetBoard() {
  setOffers([]);
  $("steps").hidden = true;
  $("graph").hidden = true;
  panel = null;
  graph = null;
}

function changed() {
  const items = visibleItems();
  const sig = (window.Board ? Board.key : 0) + "|" + board.version + "|" + board.items.length + "|" + items.map((it) => board.items.indexOf(it)).join(",");
  if (sig === lastSig) return placeAll();     // the board only moved: things follow the writing
  lastSig = sig;
  clearTimeout(readTimer);
  reading = null;
  measureShown = false;
  placeAll();
  if (!board.items.length) forgetBoard(); // cleared, or another page: her buttons and cards were about what was there
  if (!items.length) return setChip(null);
  readTimer = setTimeout(() => readNow(sig), READ_PAUSE_MS);
}

async function readNow(sig) {
  if (pointers.size || textbox) { readTimer = setTimeout(() => readNow(sig), 400); return; }
  const p = page();
  if (!p) return;
  setChip("reading");
  let found;
  try {
    found = await api.send("POST", "/api/board/read", { strokes: p.strokes, image: p.image, hindi: lang === "hi" });
  } catch (_) {
    found = { read: "", suggest: [] };
  }
  if (sig !== lastSig) return;
  const holo = holoOffer(found.read);
  if (holo && !(found.suggest || []).some((o) => o.kind === "holo")) found.suggest = [holo, ...(found.suggest || [])].slice(0, 3);
  reading = { found, frame: p.frame };
  setChip(found.read ? "read" : null, found.read || "");
  placeAll();
}

function setChip(mode, text = "") {
  const chip = $("chip");
  chip.hidden = !mode;
  chip.className = mode || "";
  chip.textContent = mode === "reading" ? "Reading what you wrote…" : mode === "read" ? "I read: " + text : text;
}

let hintTimer = 0;
function hint(text) {
  const before = [$("chip").className, $("chip").textContent];
  setChip("hint", text);
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    if ($("chip").className !== "hint") return;
    if (reading && reading.found.read) setChip("read", reading.found.read);
    else setChip(before[0] === "hint" ? null : before[0] || null, before[1]);
  }, 3500);
}

// ------------------------------------------------------------------ buttons
function pill(offer, onclick) {
  const b = document.createElement("button");
  b.className = "pill";
  const words = document.createElement("b");
  words.textContent = offer.label;
  b.append(words);
  if (offer.sub) {
    const sub = document.createElement("small");
    sub.textContent = offer.sub;
    b.append(sub);
  }
  b.addEventListener("click", onclick);
  return b;
}

// Under the writing (above it when it reaches the bottom), as _wb_draw_suggestions.
function placeSuggestions() {
  const box = $("suggest");
  const list = reading && !pointers.size ? reading.found.suggest || [] : [];
  box.replaceChildren(...list.map((o) => pill(
    o.kind === "measure" && measureShown ? { ...o, label: "Hide the angles", sub: "" } : o,
    () => suggestionTapped(o))));
  box.hidden = !list.length;
  if (!list.length) return;
  const ink = inkBox(visibleItems());
  if (!ink) return;
  const r = box.getBoundingClientRect();
  const floor = H - $("bar").offsetHeight - 24;
  let y = ink[3] + 14;
  if (y + r.height > floor) y = Math.max(70, ink[1] - 14 - r.height);
  const right = $("panel").hidden || W <= 760 ? W : $("panel").getBoundingClientRect().left;
  const x = Math.max(8, Math.min(right - r.width - 8, ink[0]));
  box.style.left = x + "px";
  box.style.top = y + "px";
}

function suggestionTapped(offer) {
  if (offer.kind === "ask") return turn({ boardAsk: offer.payload || "ask" });
  if (offer.kind === "measure") { measureShown = !measureShown; return placeAll(); }
  if (offer.kind === "explore") { measureShown = true; return placeAll(); }
  runOffer(offer);
}

// "Visualize in 3D" when the words name one of her 3D Explorer's models
// (a black hole, the Milky Way, the heart...): holo/bridge.py after_reply.
function holoOffer(text) {
  const o = text && explorer.offerFor(text, lang);
  return o ? { kind: "holo", payload: o.modelId, label: o.label, sub: o.sub } : null;
}

function openExplorer(modelId, focus = null) {
  explorer.open(modelId, {
    focus,
    language: lang,
    hooks: {
      close: () => { speaker.stop(); const v = explorer.current(); if (v) v.close(); },
      say: (line) => speaker.say(line, lang),
      talk: (what) => (what === "stop" ? $("stopTalk").click() : $("mic").click()),
    },
  });
}

async function runOffer(offer) {
  if (offer.kind === "holo") return openExplorer(offer.payload);
  try {
    const done = await api.send("POST", "/api/visual", { kind: offer.kind, payload: offer.payload, language: lang, lab: true });
    if (done.visual) showVisual({ ...done.visual, settings: offer.settings });
    if (done.offers) setOffers(done.offers);
    if (done.say) { hint(done.say); speaker.say(done.say, lang); }
  } catch (_) {
    hint("I couldn't open that one, sorry.");
  }
}

function setOffers(list) {
  offers = (list || []).slice(0, 3);
  const box = $("offers");
  const shown = offers.filter((o) => !(panel && !$("steps").hidden && panel.see && o.kind === panel.see.kind && o.payload === panel.see.payload));
  box.replaceChildren(...shown.map((o) => pill(o, () => runOffer(o))));
  box.hidden = !shown.length;
  dock();
}

// ------------------------------------------------------------------ Measure it (_wb_draw_measure)
function placeMeasure() {
  const svg = $("measure");
  svg.replaceChildren();
  const m = reading && reading.found.measure;
  if (!(measureShown && m)) return;
  const pts = m.points.map((p) => fromPage(reading.frame, p));
  const faces = m.faces, ink = "#7C3AED";
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    svg.appendChild(n);
    return n;
  };
  const sides = new Set();
  faces.forEach((f) => f.forEach((a, i) => { const b = f[(i + 1) % f.length]; sides.add(`${Math.min(a, b)},${Math.max(a, b)}`); }));
  for (const key of sides) {
    const [a, b] = key.split(",").map(Number);
    add("line", { x1: pts[a][0], y1: pts[a][1], x2: pts[b][0], y2: pts[b][1], stroke: ink, "stroke-width": 3, "stroke-linecap": "round" });
  }
  const many = faces.length > 1;
  const size = many || faces[0].length > 4 ? 13 : 16;
  const middles = [];
  faces.forEach((f, k) => {
    const ring = f.map((i) => pts[i]);
    const n = ring.length;
    middles.push([ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n]);
    const shortest = Math.min(...ring.map((p, i) => Math.hypot(p[0] - ring[(i - 1 + n) % n][0], p[1] - ring[(i - 1 + n) % n][1])));
    const radius = Math.max(10, Math.min(26, shortest * 0.22));
    ring.forEach(([x, y], i) => {
      const [ax, ay] = ring[(i - 1 + n) % n], [bx, by] = ring[(i + 1) % n];
      const first = Math.atan2(y - ay, ax - x) * 180 / Math.PI;
      const second = Math.atan2(y - by, bx - x) * 180 / Math.PI;
      let extent = ((second - first) % 360 + 360) % 360, start = first;
      const angle = m.angles[k][i];
      if ((extent > 180) !== (angle > 180)) { start = second; extent = 360 - extent; }
      const r0 = start * Math.PI / 180, r1 = (start + extent) * Math.PI / 180;
      add("path", { d: `M ${x + radius * Math.cos(r0)} ${y - radius * Math.sin(r0)} A ${radius} ${radius} 0 ${extent > 180 ? 1 : 0} 0 ${x + radius * Math.cos(r1)} ${y - radius * Math.sin(r1)}`,
        fill: "none", stroke: ink, "stroke-width": 2 });
      const mid = (start + extent / 2) * Math.PI / 180;
      const reach = radius + (extent > 60 ? 16 : 24);
      const lx = x + Math.cos(mid) * reach, ly = y - Math.sin(mid) * reach;
      const words = `${angle}°`, half = words.length * size * 0.32 + 3;
      add("rect", { x: lx - half, y: ly - 10, width: half * 2, height: 20, rx: 7, fill: "#fff" });
      add("text", { x: lx, y: ly + size * 0.35, "text-anchor": "middle", fill: ink, "font-size": size, "font-weight": 700 }, words);
    });
  });
  pts.forEach(([x, y], i) => {
    const owners = faces.map((f, k) => (f.includes(i) ? middles[k] : null)).filter(Boolean);
    const ox = owners.reduce((s, p) => s + p[0], 0) / owners.length, oy = owners.reduce((s, p) => s + p[1], 0) / owners.length;
    let dx = x - ox, dy = y - oy, away = Math.hypot(dx, dy);
    if (away < 6) { dx = 0; dy = -1; away = 1; }
    add("text", { x: x + dx / away * 19, y: y + dy / away * 19 + 6, "text-anchor": "middle", fill: "#1E2233", "font-size": 18, "font-weight": 700 }, LETTERS[i] || "");
  });
  const words = many ? faces.slice(0, 4).map((f) => `${f.map((i) => LETTERS[i]).join("")} = ${(f.length - 2) * 180}°`).join("  ·  ")
    : faces[0].length <= 4 ? `${faces[0].map((i) => LETTERS[i]).join(" + ")} = ${(faces[0].length - 2) * 180}°`
      : `The angles add up to ${(faces[0].length - 2) * 180}°`;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const half = words.length * 4.8 + 14;
  let x = (Math.min(...xs) + Math.max(...xs)) / 2, y = Math.min(...ys) - 38;
  if (y < 80) { x = Math.max(...xs) + half + 24; y = (Math.min(...ys) + Math.max(...ys)) / 2; }
  x = Math.max(12 + half, Math.min(W - 12 - half, x));
  add("rect", { x: x - half, y: y - 15, width: half * 2, height: 30, rx: 15, fill: "#F5F3FF", stroke: "#DDD6FE" });
  add("text", { x, y: y + 6, "text-anchor": "middle", fill: ink, "font-size": 16, "font-weight": 700 }, words);
}

// ------------------------------------------------------------------ her working and her graph, beside the writing
// The board slides over so the card doesn't sit on the writing.
function openCard(id) {
  for (const c of document.querySelectorAll(".card")) c.hidden = c.id !== id;
  const card = $(id).getBoundingClientRect();
  const ink = inkBox(visibleItems());
  if (ink) {
    const sheet = card.height < H * 0.7; // a sheet along the bottom on a phone
    if (sheet && ink[3] > card.top - 12) view.y -= Math.max(0, Math.min(ink[3] - card.top + 12, ink[1] - 70));
    if (!sheet && ink[2] > card.left - 12) view.x -= Math.max(0, Math.min(ink[2] - card.left + 12, ink[0] - 12));
    paint(BASE | LIVE);
    save();
  }
}

// Her working, typeset here rather than her 338-pixel picture of it, so it is
// sharp on any screen. Her maths comes LaTeX-ish (\\frac{4}{2}, $\\int x^2 dx$).
const MATH_WORDS = /^(sin|cos|tan|cot|sec|csc|log|ln|exp|lim|max|min)$/;
function tex(expr) {
  const s = String(expr || "").replace(/\$/g, "")
    // Chemistry: H2O -> H₂O, and a real arrow.
    .replace(/([A-Z][a-z]?|\))(\d+)/g, "$1_{$2}").replace(/<->|⇌/g, "\\rightleftharpoons ").replace(/->|→/g, "\\rightarrow ")
    // Words stay words: a run of 3+ letters not after a backslash goes in \text{}.
    .replace(/(^|[^\\A-Za-z\u0900-\u097F])((?:[A-Za-z\u0900-\u097F]{3,}|[\u0900-\u097F]+)(?:[ ,]+(?:[A-Za-z\u0900-\u097F]{2,}|[\u0900-\u097F]+))*)/g,
      (m, pre, words) => (MATH_WORDS.test(words) ? `${pre}\\${words} ` : `${pre}\\text{${words}}`));
  const out = document.createElement("span");
  try {
    window.katex.render(s, out, { throwOnError: true, strict: "ignore" });
  } catch (_) {
    out.textContent = String(expr || "").replace(/\$/g, "");
  }
  return out;
}

function showPanel(p, worked) {
  panel = p;
  step = -1;
  $("steps-title").textContent = (worked && worked.title) || "";
  const rows = [];
  for (const s of (worked && worked.steps) || []) rows.push([s.expr, s.note, false]);
  if (worked && worked.answer) rows.push([worked.answer, "", true]);
  $("steps-list").replaceChildren(...rows.map(([expr, note, answer]) => {
    const li = document.createElement("li");
    if (answer) li.className = "answer";
    const maths = document.createElement("div");
    maths.className = "maths";
    if (answer) { const b = document.createElement("b"); b.textContent = lang === "hi" ? "उत्तर" : "Answer"; maths.append(b); }
    maths.append(tex(expr));
    li.append(maths);
    if (note) { const n = document.createElement("div"); n.className = "note"; n.textContent = note; li.append(n); }
    return li;
  }));
  $("steps-body").scrollTop = 0;
  const see = $("steps-see");
  see.hidden = !p.see;
  if (p.see) see.textContent = "▶  " + p.see.label;
  openCard("steps");
  setOffers(offers);
}
$("steps-see").addEventListener("click", () => panel && panel.see && runOffer(panel.see));
$("steps-close").addEventListener("click", () => { $("steps").hidden = true; setOffers(offers); });

// _wb_match_step: the step her sentence is about, lit and kept in view.
function lightStep(next) {
  if (!panel || $("steps").hidden || next === step || next < -1) return;
  step = next;
  const rows = $("steps-list").children;
  [...rows].forEach((r, i) => r.classList.toggle("lit", i === step));
  if (rows[step]) rows[step].scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// Her graph card, drawn by her graphcard.js on a little stage of her own units.
function showGraph(data) {
  graph = new LiveGraph(data);
  // Her card redraws after every slider; the roots and vertex follow it.
  const repaint = graph.repaintAll.bind(graph);
  graph.repaintAll = () => { repaint(); showKeys(); };
  openCard("graph");
  drawGraph();
}
function drawGraph() {
  if (!graph || $("graph").hidden) return;
  const holder = $("graph-stage");
  holder.replaceChildren();
  showKeys();
  const r = $("graph").getBoundingClientRect();
  const w = 346, h = Math.round(346 * (r.height - $("graph-keys").offsetHeight) / r.width), k = r.width / w;
  Object.assign(holder.style, { width: w + "px", height: h + "px", transform: `scale(${k})` });
  graph.draw(holder, [0, 0, w, h], "card", {
    onEnlarge: () => showVisual({ kind: "graph", title: graph.data.describe, steps: [], graph: graph.data }, { big: true }),
    onClose: () => { $("graph").hidden = true; },
  });
}

function showKeys() {
  const keys = $("graph-keys"), line = graph ? live.keyPointsLine(graph.data.curves) : "";
  keys.textContent = line;
  keys.hidden = !line;
}

// ------------------------------------------------------------------ her full-screen views
const visual = new BoardVisual(stage, {
  onOffer: (offer) => runOffer(offer),
  onAsk: (question) => turn({ text: question, withPage: false }), // the geometry lab's Ask Liza
});

// A graph goes in the card beside the writing (as on her board); anything else,
// or the graph enlarged, on her stage over the whole screen.
function showVisual(v, { big = false } = {}) {
  if (v.graph && !big) return showGraph(v.graph);
  // Her Explorer has it (the heart, a cell): it opens instead of her own 3D view.
  if (v.scene && v.payload) {
    const instead = explorer.insteadOfModel3d(v.payload);
    if (instead) return openExplorer(instead.modelId, instead.focus);
  }
  // Her engine's models (projectile motion, a molecule...) in real 3D when captured;
  // her web copy's flat recording otherwise.
  // Projectile motion runs live from its equations, not her recorded takes.
  if (v.scene && v.scene.model_id === "physics.mechanics.projectile_motion") {
    return live.openProjectile({ title: v.scene.title || v.title || "Projectile motion", settings: v.settings });
  }
  if (v.scene && v.scene.kind === "engine") {
    engine3d.open(v.scene.model_id, { title: v.scene.title || v.title || "", settings: v.settings })
      .then((ok) => { if (!ok) onStage(v); });
    return;
  }
  onStage(v);
}

function onStage(v) {
  $("viewport").hidden = false;
  fitStage();
  visual.show(v, { enlarge: true });
  if ((v.settings || []).length) visual.applySettings(v.settings);
  // Her lab draws the solid at one size; these sliders ask her geolab again at another.
  if (v.geometry) live.dimsBar(v.geometry.payload, resizeSolid);
  syncViewport();
}

async function resizeSolid(payload) {
  try {
    const lab = await api.send("POST", "/api/geometry", { payload });
    visual.show({ kind: "geometry", title: lab.describe, steps: [], geometry: lab }, { enlarge: true });
  } catch (_) {
    hint("I couldn't redraw it at that size.");
  }
}

// The stage is up while one of her big views is: a picture, a 3D model, the lab.
function syncViewport() {
  const open = !!document.querySelector(".bv-big, .m3-big, .geo-big");
  $("viewport").hidden = !open;
  if (!document.querySelector(".geo-big")) live.closeDims();
}
new MutationObserver(() => syncViewport()).observe(document.body, { childList: true, subtree: true });
$("viewport").addEventListener("click", (e) => { if (e.target === $("viewport")) visual.shrink(); });

// ------------------------------------------------------------------ asking her
function setState(state) {
  document.body.dataset.liza = state;
  $("stopTalk").hidden = state === "idle";
  $("askLiza").disabled = state === "thinking";
}

// The conversation, in the Ask Liza panel: what was asked, and what she said.
function message(who, text) {
  const m = document.createElement("div");
  m.className = "msg " + who + (text ? "" : " wait");
  m.textContent = text;
  $("chat").append(m);
  $("welcome").hidden = true;
  setPanel(true);
  m.scrollIntoView({ block: "nearest" });
  return m;
}
function addWords(m, text) {
  m.classList.remove("wait");
  m.textContent = (m.textContent ? m.textContent + " " : "") + text;
  m.scrollIntoView({ block: "nearest" });
}
const ASKED = { solve: "Solve what I've written.", ask: "Help me with my board." };

async function turn({ text = "", boardAsk = "", heard = "", withPage = true } = {}) {
  const p = withPage ? page() : null;
  if (!text && !p) return hint("Write or draw something first, then tap Ask Liza.");
  if (controller) controller.abort();
  speaker.stop();
  const mine = new AbortController();
  controller = mine;
  setState("thinking");
  setOffers([]);
  const picked = window.Board && Board.selection.length && p;
  const mine_q = message("user", text || (picked && boardAsk !== "solve" ? "Tell me about what I picked." : ASKED[boardAsk] || ASKED.ask));
  const reply = message("liza", "");
  const sentences = [];
  let sentenceSteps = null, answer = "", asked = text, worked = null;
  speaker.onStart = (item) => {
    setState("speaking");
    const i = sentences.indexOf(item.text);
    if (sentenceSteps && i >= 0) lightStep(sentenceSteps[i]);
  };
  const body = {
    text, board_ask: text ? "" : boardAsk || "ask", heard_language: heard || (lang === "hi" ? "hi" : ""),
    board_strokes: p ? p.strokes : null, board_image: p ? p.image : null,
    screen: { ...visual.state(), offers: offers.map((o) => ({ label: o.label, kind: o.kind, payload: o.payload })) },
    history: history.slice(-12), cls: $("cls").value,
    explorer: explorer.current() ? explorer.current().state : null,
  };
  try {
    const r = await fetch("/api/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: mine.signal });
    if (!r.ok) throw new Error(`Something went wrong (${r.status}).`);
    const reader = r.body.getReader(), decoder = new TextDecoder();
    let buffer = "";
    const handle = (ev) => {
      if (mine !== controller) return;
      if (ev.type === "heard") {
        asked = ev.text;
        lang = ev.language === "hi" || ev.language === "hinglish" || DEVANAGARI.test(ev.text) ? "hi" : "en";
        mine_q.textContent = ev.text;
      } else if (ev.type === "sentence") { sentences.push(ev.text); addWords(reply, ev.text); speaker.say(ev.text, lang); }
      else if (ev.type === "solution") worked = ev;
      else if (ev.type === "panel") { sentenceSteps = ev.sentence_steps; showPanel(ev, worked); }
      else if (ev.type === "visual" && ev.kind !== "solution") showVisual(ev);
      else if (ev.type === "offers") setOffers(ev.offers);
      else if (ev.type === "geometry_pick") visual.geometryPick(ev.picks);
      else if (ev.type === "do" && ev.action === "hide_visual") visual.shrink();
      else if (ev.type === "status") hint(ev.text);
      else if (ev.type === "done") answer = ev.answer || "";
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) handle(JSON.parse(line));
      }
    }
    if (buffer.trim()) handle(JSON.parse(buffer));
  } catch (err) {
    if (err.name === "AbortError") { if (!reply.textContent) reply.remove(); return; }
    setState("idle");
    addWords(reply, err.message || "Something went wrong. Try again.");
    return;
  }
  if (!reply.textContent) reply.remove();
  if (mine !== controller) return;
  controller = null;
  const holo = holoOffer(asked);
  if (answer && holo && !offers.some((o) => o.kind === "holo")) setOffers([holo, ...offers]);
  if (answer) history.push({ role: "user", content: asked + (p ? " [about what is written on your board]" : "" ) }, { role: "assistant", content: answer });
  if (!sentences.length) setState("idle");
  await speaker.finished();
  if (controller === null) setState("idle"); // unless another question has started meanwhile
}

// The panel's three starters: they ask for a topic, then make it.
const QUICK = {
  mindmap: { chip: "Mind map", hint: "What is the mind map about?" },
  explain: { chip: "Explain", hint: "Which concept?" },
  flowchart: { chip: "Flowchart", hint: "What should the flowchart show?" },
};
let quick = null;
function setQuick(kind) {
  quick = kind;
  $("quick-chip").hidden = !kind;
  $("question").placeholder = kind ? QUICK[kind].hint : "Ask anything…";
  if (!kind) return;
  $("quick-chip").querySelector("span").textContent = QUICK[kind].chip;
  if (!$("question").value && reading && reading.found.read) $("question").value = reading.found.read; // what is written is a good guess
  $("question").focus();
}
document.querySelectorAll("[data-quick]").forEach((b) => b.addEventListener("click", () => setQuick(b.dataset.quick)));
$("quick-chip").querySelector("button").addEventListener("click", () => setQuick(null));

async function makeDiagram(kind, topic) {
  const name = kind === "mindmap" ? "mind map" : "flowchart";
  message("user", `Make a ${name} about ${topic}.`);
  const reply = message("liza", "");
  setState("thinking");
  try {
    const d = await api.send("POST", "/api/diagram", { kind, topic });
    if (!window.Board) throw new Error("The board isn't ready yet.");
    Board.addDiagram(d);
    addWords(reply, `Here's a ${name} of ${d.topic}. Drag the notes to move them, and tap a note twice to change its words.`);
  } catch (err) {
    addWords(reply, err.message || "I couldn't make that one. Try again.");
  }
  setState("idle");
}

$("askbar").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("question").value.trim();
  if (quick && !q) return hint(QUICK[quick].hint);
  $("question").value = "";
  $("question").blur();
  const kind = quick;
  setQuick(null);
  if (kind === "mindmap" || kind === "flowchart") return makeDiagram(kind, q);
  if (kind === "explain") return turn({ text: `Explain ${q} in simple words.`, withPage: false });
  turn(q ? { text: q } : { boardAsk: "ask" });
});

// The panel: open on a big screen, a button to bring it back when put away.
function setPanel(open) {
  if (open === !$("panel").hidden) return;
  $("panel").hidden = !open;
  $("panel-open").hidden = open;
  document.body.classList.toggle("panel-open", open);
  try { localStorage.setItem("whiteboard.panel", open ? "open" : "closed"); } catch (_) { /* private mode */ }
  placeAll();
  drawGraph();
}
$("panel-min").addEventListener("click", () => setPanel(false));
$("panel-open").addEventListener("click", () => setPanel(true));
$("panel-max").addEventListener("click", () => {
  document.body.classList.toggle("panel-max");
  placeAll();
  drawGraph();
});
{
  let saved = null;
  try { saved = localStorage.getItem("whiteboard.panel"); } catch (_) { /* private mode */ }
  const open = innerWidth > 760 && saved !== "closed";
  $("panel").hidden = !open;
  $("panel-open").hidden = open;
  document.body.classList.toggle("panel-open", open);
}
$("stopTalk").addEventListener("click", () => {
  if (controller) controller.abort();
  controller = null;
  speaker.stop();
  listener.cancel();
  setState("idle");
});

// Her microphone needs a secure page: the Pi itself (localhost) or https.
const canListen = window.isSecureContext && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
$("mic").hidden = !canListen;
$("mic").addEventListener("click", async () => {
  listener.prime();
  if (document.body.dataset.liza === "listening") return listener.finishNow();
  speaker.stop();
  if (controller) controller.abort();
  setState("listening");
  let audio = null;
  try {
    audio = await listener.listen({ startTimeoutMs: 8000, endSilenceMs: 900, maxMs: 25000 });
  } catch (_) {
    setState("idle");
    return hint("Allow the microphone, or type your question.");
  }
  if (!audio) return setState("idle");
  setState("thinking");
  try {
    const heard = await api.transcribe(audio, "");
    if (!heard.text) { setState("idle"); return hint("I didn't catch that. Try again."); }
    turn({ text: heard.text, heard: heard.language });
  } catch (err) {
    setState("idle");
    hint(err.message || "I could not hear that.");
  }
});

// ------------------------------------------------------------------ everything that follows the writing
// The ask row sits just above the toolbar (one row on a laptop, two on a phone),
// and the cards stop above both.
function dock() {
  const bar = $("bar");
  document.documentElement.style.setProperty("--dock", bar.offsetHeight + 30 + "px");
  // Centred, unless that puts it over the page picker in the bottom-left corner.
  bar.style.marginLeft = "0px";
  const pages = $("pages").getBoundingClientRect(), left = bar.getBoundingClientRect().left;
  if (W > 760 && left < pages.right + 12) bar.style.marginLeft = Math.min(pages.right + 12 - left, Math.max(0, W - 8 - bar.getBoundingClientRect().right)) + "px";
}

function placeAll() {
  dock();
  placeSuggestions();
  placeMeasure();
}

try { $("cls").value = localStorage.getItem("whiteboard.class") || "8"; } catch (_) { $("cls").value = "8"; }
$("cls").addEventListener("change", () => { try { localStorage.setItem("whiteboard.class", $("cls").value); } catch (_) { /* private mode */ } });
window.addEventListener("resize", () => { placeAll(); drawGraph(); if (!$("viewport").hidden) fitStage(); });
setState("idle");

// The first reading waits for her Explorer's catalogue, so its button can come with it.
explorer.loadCatalog().finally(() => changed());
// The selection bar's Ask Liza: her panel open, a question about the picked drawings only.
function askAbout() {
  setPanel(true);
  turn({ boardAsk: "ask" });
}

window.Liza = { changed, turn, askAbout, runOffer, state: () => ({ reading, offers, panel, graph: !!graph }) };
