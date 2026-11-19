// The screen half: two canvases, pointers (finger, stylus, mouse), toolbar, files.
// One finger, a stylus or a mouse draws; two fingers move and zoom the board.
"use strict";

const C = BoardCore;
const base = document.getElementById("base"); // everything finished
const live = document.getElementById("live"); // strokes being drawn right now
const bctx = base.getContext("2d");
const lctx = live.getContext("2d");
const STORE = "whiteboard.v1";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const BACKGROUNDS = ["dots", "grid", "lines", "plain"];
// A sticky note takes a soft version of the chosen colour.
const NOTE = { "#1a1a1a": "#fef3a0", "#7c3aed": "#e9d5ff", "#3b82f6": "#bfdbfe", "#f472b6": "#fbcfe8",
  "#facc15": "#fef3a0", "#22c55e": "#bbf7d0", "#d62828": "#fecaca", "#f08c00": "#fed7aa", "#0f766e": "#99f6e4",
  "#1f5fd6": "#bfdbfe", "#ffffff": "#ffffff" };

let board = new C.History();
const view = { s: 1, x: 0, y: 0 }; // screen = board * s + (x, y), in CSS pixels
const opts = { tool: "pen", color: "#1a1a1a", size: 5, bg: "dots" };
let W = 0, H = 0, dpr = 1;

const pointers = new Map(); // pointerId -> {x, y, type, mode, ...}
let pinch = null;
let penSeen = false; // once a stylus is used, fingers only move the board (palm rejection)
let spaceDown = false;
let textbox = null;
let sel = []; // what the select tool picked: a tap, Shift-taps, or a box dragged round several
const picked = () => sel.filter((it) => board.items.includes(it));
let noteEdit = null; // a sticky note being typed into

const r2 = (n) => Math.round(n * 100) / 100;
const toBoard = (sx, sy) => [(sx - view.x) / view.s, (sy - view.y) / view.s];
const clampScale = (s) => Math.min(8, Math.max(0.1, s));

// ------------------------------------------------------------------ drawing
const images = new Map(); // data: URL -> <img>, drawn once it has loaded
function imageOf(src) {
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => paint(BASE);
    img.src = src;
    images.set(src, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

// Words broken onto lines that fit `width` (a sticky note's text).
function wrap(ctx, text, width) {
  const out = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? line + " " + word : word;
      if (line && ctx.measureText(next).width > width) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

function drawBox(ctx, it) {
  if (it.tool === "image") {
    const img = imageOf(it.src);
    if (img) ctx.drawImage(img, it.x, it.y, it.w, it.h);
    else { ctx.fillStyle = "#f1f1f4"; ctx.fillRect(it.x, it.y, it.w, it.h); }
    return;
  }
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.12)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = it.color;
  ctx.beginPath();
  ctx.roundRect(it.x, it.y, it.w, it.h, Math.min(12, it.w / 8));
  ctx.fill();
  ctx.restore();
  if (it.color === "#ffffff") { ctx.strokeStyle = "#d4d4d8"; ctx.lineWidth = 1.5; ctx.stroke(); }
  if (!it.text) return;
  ctx.fillStyle = "#1f2328";
  ctx.font = "500 " + it.size + "px " + FONT;
  ctx.textBaseline = "top";
  const pad = Math.max(8, it.size * 0.6), lineH = it.size * 1.25;
  const lines = wrap(ctx, it.text, it.w - 2 * pad);
  const top = it.y + Math.max(pad, (it.h - lines.length * lineH) / 2); // centred, like a label
  ctx.save();
  ctx.beginPath();
  ctx.rect(it.x, it.y, it.w, it.h);
  ctx.clip();
  ctx.textAlign = "center";
  lines.forEach((line, i) => ctx.fillText(line, it.x + it.w / 2, top + i * lineH));
  ctx.restore();
}

function drawItem(ctx, it) {
  if (C.isBox(it)) return drawBox(ctx, it);
  ctx.strokeStyle = ctx.fillStyle = it.color;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.globalAlpha = it.tool === "hl" ? 0.35 : 1;
  const p = it.points;
  if (it.tool === "text") {
    ctx.font = it.size + "px " + FONT;
    ctx.textBaseline = "top";
    it.text.split("\n").forEach((line, i) => ctx.fillText(line, it.x, it.y + i * it.size * 1.25));
  } else if (p.length === 1) {
    ctx.beginPath();
    ctx.arc(p[0][0], p[0][1], (it.pressure ? it.width * (0.5 + p[0][2]) : it.width) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (it.tool === "pen" && it.pressure) {
    // Each piece its own width, curved through the midpoints between samples.
    for (let i = 0; i < p.length - 1; i++) {
      const a = i ? mid(p[i - 1], p[i]) : p[0];
      const b = i < p.length - 2 ? mid(p[i], p[i + 1]) : p[p.length - 1];
      ctx.lineWidth = it.width * (0.5 + p[i][2]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.quadraticCurveTo(p[i][0], p[i][1], b[0], b[1]);
      ctx.stroke();
    }
  } else {
    ctx.lineWidth = it.width;
    ctx.beginPath();
    if (it.tool === "pen" || it.tool === "hl") {
      ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length - 1; i++) {
        const m = mid(p[i], p[i + 1]);
        ctx.quadraticCurveTo(p[i][0], p[i][1], m[0], m[1]);
      }
      ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
    } else if (it.tool === "ellipse") {
      ctx.ellipse((p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2,
        Math.abs(p[1][0] - p[0][0]) / 2, Math.abs(p[1][1] - p[0][1]) / 2, 0, 0, Math.PI * 2);
    } else if (it.tool === "rect") {
      ctx.rect(p[0][0], p[0][1], p[1][0] - p[0][0], p[1][1] - p[0][1]);
    } else {
      ctx.moveTo(p[0][0], p[0][1]);
      ctx.lineTo(p[1][0], p[1][1]);
      if (it.tool === "arrow") {
        const ang = Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]);
        const len = it.width * 5;
        for (const side of [-1, 1]) {
          ctx.moveTo(p[1][0], p[1][1]);
          ctx.lineTo(p[1][0] - len * Math.cos(ang + side * 0.45), p[1][1] - len * Math.sin(ang + side * 0.45));
        }
      }
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }

function drawBackground() {
  if (opts.bg === "plain") return;
  let step = 32 * view.s;
  while (step < 12) step *= 2; // zoomed far out: fewer, wider lines
  if (opts.bg === "dots") {
    bctx.fillStyle = "#cfd3dc";
    for (let y = ((view.y % step) + step) % step; y < H; y += step) {
      for (let x = ((view.x % step) + step) % step; x < W; x += step) bctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    }
    return;
  }
  bctx.strokeStyle = "#e6eaf0";
  bctx.lineWidth = 1;
  bctx.beginPath();
  for (let y = ((view.y % step) + step) % step; y < H; y += step) {
    bctx.moveTo(0, Math.round(y) + 0.5);
    bctx.lineTo(W, Math.round(y) + 0.5);
  }
  if (opts.bg === "grid") {
    for (let x = ((view.x % step) + step) % step; x < W; x += step) {
      bctx.moveTo(Math.round(x) + 0.5, 0);
      bctx.lineTo(Math.round(x) + 0.5, H);
    }
  }
  bctx.stroke();
}

function redrawBase() {
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bctx.fillStyle = "#ffffff";
  bctx.fillRect(0, 0, W, H);
  drawBackground();
  bctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.x, dpr * view.y);
  const [x0, y0] = toBoard(0, 0);
  const [x1, y1] = toBoard(W, H);
  for (const it of board.items) {
    const b = C.bounds(it);
    if (b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1) drawItem(bctx, it);
  }
  updateButtons();
}

function redrawLive() {
  lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  lctx.clearRect(0, 0, W, H);
  const chosen = picked();
  if (chosen.length) {
    // Each picked drawing glows, so it is plain which ones Liza is looking at.
    lctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.x, dpr * view.y);
    for (const it of chosen) if (!C.isBox(it)) drawItem(lctx, { ...it, color: "rgba(124,58,237,0.28)", width: (it.width || 2) + 12 / view.s, pressure: false });
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const b = C.boundsOf(chosen), m = 6;
    const [x0, y0] = [b.x0 * view.s + view.x - m, b.y0 * view.s + view.y - m];
    const [x1, y1] = [b.x1 * view.s + view.x + m, b.y1 * view.s + view.y + m];
    lctx.strokeStyle = "#7c3aed";
    lctx.lineWidth = 1.5;
    lctx.setLineDash([6, 4]);
    lctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    lctx.setLineDash([]);
    lctx.fillStyle = "#fff";
    for (const [hx, hy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      lctx.fillRect(hx - 4, hy - 4, 8, 8);
      lctx.strokeRect(hx - 4, hy - 4, 8, 8);
    }
  }
  for (const p of pointers.values()) {
    if (!p.box) continue;
    const [bx0, by0, bx1, by1] = p.box.map((v, i) => v * view.s + (i % 2 ? view.y : view.x));
    lctx.fillStyle = "rgba(124,58,237,0.08)";
    lctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
    lctx.strokeStyle = "#7c3aed";
    lctx.lineWidth = 1;
    lctx.setLineDash([4, 3]);
    lctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
    lctx.setLineDash([]);
  }
  placeSelbar();
  lctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.x, dpr * view.y);
  for (const p of pointers.values()) {
    if (p.item) drawItem(lctx, p.item);
    if (p.erase) {
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lctx.strokeStyle = "#6b7280";
      lctx.lineWidth = 1.5;
      lctx.beginPath();
      lctx.arc(p.x, p.y, eraserRadius(), 0, Math.PI * 2);
      lctx.stroke();
      lctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.x, dpr * view.y);
    }
  }
}

const BASE = 1, LIVE = 2;
let pending = 0, frame = 0;
function paint(what) {
  pending |= what;
  if (!frame) frame = requestAnimationFrame(() => {
    frame = 0;
    if (pending & BASE) redrawBase();
    if (pending & LIVE) redrawLive();
    pending = 0;
  });
}

function resize() {
  dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  for (const c of [base, live]) {
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    c.style.width = W + "px";
    c.style.height = H + "px";
  }
  paint(BASE | LIVE);
}

// ------------------------------------------------------------------ pointers
const pressureOf = (e) => (e.pointerType === "pen" && e.pressure > 0 ? r2(e.pressure) : 0.5);
const eraserRadius = () => 6 + opts.size * 2; // screen pixels
const touchIds = () => [...pointers].filter(([, p]) => p.type === "touch").map(([id]) => id);

live.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button === 2) {
    // Right-click: on blank space nothing stays picked; on a picked drawing, just that one is let go.
    const hit = itemAt(...toBoard(e.clientX, e.clientY));
    if (sel.length) select(hit && sel.includes(hit) ? sel.filter((it) => it !== hit) : hit ? sel : null);
    return;
  }
  if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
  e.preventDefault();
  closeFly();
  closeNote();
  const closedText = commitText();
  try { live.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
  if (e.pointerType === "pen" && !penSeen) {
    penSeen = true;
    toast("Stylus found: fingers now move the board");
  }
  const p = { x: e.clientX, y: e.clientY, downX: e.clientX, downY: e.clientY, type: e.pointerType, mode: "idle" };
  pointers.set(e.pointerId, p);
  const fingers = touchIds();
  if (e.pointerType === "touch" && fingers.length === 2) return startPinch(fingers);
  if (e.pointerType === "touch" && (fingers.length > 2 || pinch)) return;
  if (e.button === 1 || spaceDown || opts.tool === "hand" || (e.pointerType === "touch" && penSeen)) {
    p.mode = "pan";
    return;
  }
  if (closedText && opts.tool === "text") return; // that tap only finished the text
  startDraw(p, e);
});

live.addEventListener("pointermove", (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  e.preventDefault();
  if (p.mode === "pan") {
    view.x += e.clientX - p.x;
    view.y += e.clientY - p.y;
  }
  const events = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
  if (p.mode === "draw") for (const ev of events.length ? events : [e]) extendDraw(p, ev);
  if (p.mode === "box") {
    [p.box[2], p.box[3]] = toBoard(e.clientX, e.clientY);
    paint(LIVE);
  }
  if (p.mode === "move") {
    const dx = (e.clientX - p.x) / view.s, dy = (e.clientY - p.y) / view.s;
    for (const it of p.moving) C.shift(it, dx, dy); // shown as it goes; one undo step when let go
    p.total[0] += dx;
    p.total[1] += dy;
    paint(BASE | LIVE);
  }
  p.x = e.clientX;
  p.y = e.clientY;
  if (p.mode === "pinch") movePinch();
  paint(p.mode === "draw" ? LIVE : BASE | LIVE);
});

function endPointer(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  pointers.delete(e.pointerId);
  if (p.mode === "draw" && e.type === "pointerup") finishDraw(p);
  if (p.mode === "move") {
    const [dx, dy] = p.total;
    for (const it of p.moving) C.shift(it, -dx, -dy);
    if (e.type === "pointerup" && Math.hypot(dx, dy) * view.s > 2) board.move(p.moving, dx, dy);
    else if (e.type === "pointerup" && p.again && p.moving[0].tool === "sticky") editNote(p.moving[0]); // a second tap on a note
    save();
  }
  if (p.mode === "box") {
    const [x0, x1] = [p.box[0], p.box[2]].sort((a, b) => a - b), [y0, y1] = [p.box[1], p.box[3]].sort((a, b) => a - b);
    p.box = null;
    if (e.type === "pointerup" && (x1 - x0) * view.s > 4 && (y1 - y0) * view.s > 4) {
      select(board.items.filter((it) => { const b = C.bounds(it); return b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1; }));
    } else if (e.type === "pointerup") select(null); // a tap on blank space lets everything go
  }
  if (pinch && pinch.ids.includes(e.pointerId)) {
    pinch = null;
    // The other finger is still down: it neither draws nor pans until lifted.
    for (const q of pointers.values()) if (q.mode === "pinch") q.mode = "idle";
  }
  paint(BASE | LIVE);
}
live.addEventListener("pointerup", endPointer);
live.addEventListener("pointercancel", endPointer);

function startPinch(ids) {
  for (const id of ids) {
    const p = pointers.get(id);
    p.item = null; // the first finger's stroke was really the start of a pinch
    p.erase = false;
    p.mode = "pinch";
  }
  const [a, b] = ids.map((id) => pointers.get(id));
  pinch = { ids, d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), s0: view.s,
    anchor: toBoard((a.x + b.x) / 2, (a.y + b.y) / 2) };
  paint(LIVE);
}

function movePinch() {
  const [a, b] = pinch.ids.map((id) => pointers.get(id));
  view.s = clampScale(pinch.s0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0);
  view.x = (a.x + b.x) / 2 - pinch.anchor[0] * view.s;
  view.y = (a.y + b.y) / 2 - pinch.anchor[1] * view.s;
}

// The top-most item under a point, for the select tool.
function itemAt(x, y) {
  const r = 8 / view.s;
  for (let i = board.items.length - 1; i >= 0; i--) if (C.hits(board.items[i], x, y, r)) return board.items[i];
  return null;
}

function select(items) {
  const had = sel.length;
  sel = items ? [].concat(items) : [];
  paint(LIVE);
  if ((had || sel.length) && window.Liza) Liza.changed(); // she reads just what is picked (liza.js visibleItems)
}

function startDraw(p, e) {
  const [x, y] = toBoard(e.clientX, e.clientY);
  const width = opts.size / view.s; // looks the chosen size at today's zoom
  if (opts.tool === "select") {
    const hit = itemAt(x, y), had = picked();
    if (hit && (e.shiftKey || e.ctrlKey || e.metaKey)) return select(had.includes(hit) ? had.filter((it) => it !== hit) : [...had, hit]);
    p.again = !!hit && had.length === 1 && had[0] === hit;
    if (hit && !had.includes(hit)) select(hit);
    if (hit) Object.assign(p, { mode: "move", moving: picked(), total: [0, 0] });
    else Object.assign(p, { mode: "box", box: [x, y, x, y] }); // dragging empty board picks everything it touches
    return;
  }
  if (opts.tool === "sticky") {
    const w = 220 / view.s, h = 160 / view.s;
    const note = { tool: "sticky", color: NOTE[opts.color] || "#fef3a0", x: r2(x - w / 2), y: r2(y - h / 2),
      w: r2(w), h: r2(h), text: "", size: r2(20 / view.s) };
    board.add(note);
    setTool("select");
    select(note);
    paint(BASE);
    save();
    editNote(note, true);
    return;
  }
  select(null);
  p.mode = "draw";
  if (opts.tool === "eraser") {
    p.erase = true;
    p.group = {};
    p.last = [x, y];
    eraseAlong(p, x, y);
  } else if (opts.tool === "text") {
    p.text = true;
  } else if (opts.tool === "pen" || opts.tool === "hl") {
    p.item = { tool: opts.tool, color: opts.color, width: opts.tool === "hl" ? width * 4 : width,
      pressure: e.pointerType === "pen", points: [[r2(x), r2(y), pressureOf(e)]] };
  } else {
    p.item = { tool: opts.tool, color: opts.color, width, points: [[r2(x), r2(y), 0.5], [r2(x), r2(y), 0.5]] };
  }
  paint(LIVE);
}

function extendDraw(p, ev) {
  const [x, y] = toBoard(ev.clientX, ev.clientY);
  if (p.erase) return eraseAlong(p, x, y);
  if (!p.item) return;
  const pts = p.item.points;
  if (p.item.tool === "pen" || p.item.tool === "hl") {
    const last = pts[pts.length - 1];
    if (Math.hypot(x - last[0], y - last[1]) * view.s >= 1) pts.push([r2(x), r2(y), pressureOf(ev)]);
  } else {
    pts[1] = [r2(x), r2(y), 0.5];
  }
}

// Steps from the last point so a fast swipe can't jump over a stroke.
function eraseAlong(p, x, y) {
  const r = eraserRadius() / view.s;
  const steps = Math.max(1, Math.ceil(Math.hypot(x - p.last[0], y - p.last[1]) / r));
  const hit = new Set();
  for (let i = 1; i <= steps; i++) {
    const cx = p.last[0] + ((x - p.last[0]) * i) / steps, cy = p.last[1] + ((y - p.last[1]) * i) / steps;
    for (const it of board.items) if (C.hits(it, cx, cy, r)) hit.add(it);
  }
  p.last = [x, y];
  if (hit.size) {
    board.remove([...hit], p.group);
    paint(BASE);
    save();
  }
}

function finishDraw(p) {
  if (p.text) {
    if (Math.hypot(p.x - p.downX, p.y - p.downY) < 10) openText(p.downX, p.downY);
  } else if (p.item) {
    const pts = p.item.points;
    const tiny = pts.length === 2 && p.item.tool !== "pen" && p.item.tool !== "hl" &&
      Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) * view.s < 4;
    if (!tiny) board.add(p.item);
    p.item = null;
    save();
  }
  p.erase = false;
}

// ------------------------------------------------------------------ text
function openText(sx, sy) {
  const px = 14 + opts.size * 3; // font size on screen
  const el = document.createElement("textarea");
  el.id = "textbox";
  el.rows = 1;
  el.spellcheck = false;
  el.style.left = sx + "px";
  el.style.top = sy + "px";
  el.style.fontSize = px + "px";
  el.style.color = opts.color;
  document.body.appendChild(el);
  // Border 2px + padding inside the box, and CSS's half-leading above the letters.
  const [x, y] = toBoard(sx + 6, sy + 4 + px * 0.125);
  textbox = { el, x, y, size: px / view.s, color: opts.color };
  const grow = () => {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
    el.style.width = Math.max(120, Math.min(W - sx - 8, el.scrollWidth + 4)) + "px";
  };
  el.addEventListener("input", grow);
  el.addEventListener("blur", commitText);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { el.value = ""; commitText(); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) commitText();
  });
  grow();
  el.focus();
}

function commitText() {
  if (!textbox) return false;
  const t = textbox;
  textbox = null;
  const text = t.el.value.replace(/\s+$/, "");
  t.el.remove();
  if (text) {
    board.add({ tool: "text", color: t.color, x: r2(t.x), y: r2(t.y), size: r2(t.size), text });
    paint(BASE);
    save();
  }
  return true;
}

// ------------------------------------------------------------------ sticky notes and the selection
function editNote(note, fresh = false) {
  closeNote();
  const el = document.createElement("textarea");
  el.className = "note-edit";
  el.spellcheck = false;
  el.value = note.text;
  const place = () => {
    Object.assign(el.style, { left: note.x * view.s + view.x + "px", top: note.y * view.s + view.y + "px",
      width: note.w * view.s + "px", height: note.h * view.s + "px", fontSize: note.size * view.s + "px", background: note.color });
  };
  place();
  document.body.appendChild(el);
  noteEdit = { el, note, fresh, place };
  el.addEventListener("blur", closeNote);
  el.addEventListener("keydown", (e) => { if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) el.blur(); });
  el.focus();
}

function closeNote() {
  if (!noteEdit) return;
  const { el, note } = noteEdit;
  noteEdit = null;
  const text = el.value.replace(/\s+$/, "");
  el.remove();
  if (text !== note.text && board.items.includes(note)) {
    const edited = { ...note, text };
    board.replace(note, edited);
    sel = sel.map((it) => (it === note ? edited : it));
  }
  paint(BASE | LIVE);
  save();
}

function placeSelbar() {
  const bar = $("selbar");
  const chosen = picked(), show = chosen.length > 0 && !pointers.size;
  bar.hidden = !show;
  if (!show) return;
  $("sel-edit").hidden = !(chosen.length === 1 && chosen[0].tool === "sticky");
  const b = C.boundsOf(chosen);
  const x = ((b.x0 + b.x1) / 2) * view.s + view.x, y = b.y0 * view.s + view.y - 58;
  bar.style.left = Math.max(8, Math.min(W - bar.offsetWidth - 8, x - bar.offsetWidth / 2)) + "px";
  bar.style.top = Math.max(70, y) + "px";
}

function deleteSelected() {
  if (!picked().length) return;
  board.remove(picked());
  select(null);
  paint(BASE);
  save();
}

let clipboard = null;
function copyOf(it, dx = 0, dy = 0) {
  const c = JSON.parse(JSON.stringify(it));
  C.shift(c, dx, dy);
  return c;
}
function duplicateSelected() {
  if (!picked().length) return;
  const c = picked().map((it) => copyOf(it, 24 / view.s, 24 / view.s));
  board.addMany(c);
  select(c);
  paint(BASE);
  save();
}

// ------------------------------------------------------------------ zoom and keys
function zoomAt(sx, sy, factor) {
  const [x, y] = toBoard(sx, sy);
  view.s = clampScale(view.s * factor);
  view.x = sx - x * view.s;
  view.y = sy - y * view.s;
  paint(BASE | LIVE);
  save(true);
}

// Everything on the board in view, never past 100%; an empty board goes home.
// The part of the window the board is seen through: between the rail, the top
// bar, the bottom bar and the Ask Liza panel.
function clearArea() {
  const rail = $("rail").getBoundingClientRect(), top = $("topbar").offsetHeight;
  const panel = $("panel").hidden || innerWidth <= 760 ? 0 : $("panel").offsetWidth + 24;
  return { x0: rail.right + 16, y0: top + 56, x1: W - panel - 16, y1: $("bar").getBoundingClientRect().top - 16 };
}

// `b` (board units) in the middle of the clear area, never past 100%.
function fitTo(b) {
  const a = clearArea();
  const w = Math.max(100, a.x1 - a.x0), h = Math.max(100, a.y1 - a.y0);
  view.s = clampScale(Math.min(1, (w - 40) / (b.x1 - b.x0 || 1), (h - 40) / (b.y1 - b.y0 || 1)));
  view.x = a.x0 + (w - (b.x1 - b.x0) * view.s) / 2 - b.x0 * view.s;
  view.y = a.y0 + (h - (b.y1 - b.y0) * view.s) / 2 - b.y0 * view.s;
  paint(BASE | LIVE);
  save(true);
}

// Everything on the board in view; an empty board goes home.
function fit() {
  const b = C.boundsOf(board.items);
  if (b) return fitTo(b);
  Object.assign(view, { s: 1, x: 0, y: 0 });
  paint(BASE | LIVE);
  save(true);
}

live.addEventListener("wheel", (e) => {
  e.preventDefault();
  const k = e.deltaMode === 1 ? 16 : 1; // Firefox scrolls in lines
  if (e.ctrlKey || e.metaKey) return zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * k * 0.01));
  view.x -= e.deltaX * k;
  view.y -= e.deltaY * k;
  paint(BASE | LIVE);
  save(true);
}, { passive: false });

const KEYS = { v: "select", p: "pen", h: "hl", e: "eraser", l: "line", a: "arrow", r: "rect", o: "ellipse", t: "text", s: "sticky" };
document.addEventListener("keydown", (e) => {
  if (textbox || noteEdit || ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
  if (e.key === "Escape") { closeFly(); return select(null); }
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (mod && k === "z") e.shiftKey ? redo() : undo();
  else if (mod && k === "y") redo();
  else if ((k === "delete" || k === "backspace") && sel.length) deleteSelected();
  else if (mod && k === "d" && sel.length) { e.preventDefault(); duplicateSelected(); }
  else if (mod && k === "a") { e.preventDefault(); setTool("select"); select(board.items.slice()); }
  else if (mod && k === "c" && sel.length) clipboard = picked().map((it) => copyOf(it));
  else if (mod && k === "v" && clipboard) { clipboard = clipboard.map((it) => copyOf(it, 24 / view.s, 24 / view.s)); const c = clipboard.map((it) => copyOf(it)); board.addMany(c); select(c); paint(BASE); save(); }
  else if (k === "enter" && sel.length === 1 && sel[0].tool === "sticky") editNote(sel[0]);
  else if (k === " ") { spaceDown = true; document.body.classList.add("panning"); }
  else if (!mod && KEYS[k]) setTool(KEYS[k]);
  else if (!mod && (k === "+" || k === "=")) zoomAt(W / 2, H / 2, 1.25);
  else if (!mod && k === "-") zoomAt(W / 2, H / 2, 0.8);
  else if (!mod && k === "0") fit();
  else return;
  e.preventDefault();
});
document.addEventListener("keyup", (e) => {
  if (e.key === " ") {
    spaceDown = false;
    document.body.classList.toggle("panning", opts.tool === "hand");
  }
});

// Safari's own pinch-to-zoom of the page, and long-press menus.
document.addEventListener("gesturestart", (e) => e.preventDefault());
live.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("resize", resize);

// ------------------------------------------------------------------ toolbar
const $ = (id) => document.getElementById(id);

const SHAPES = ["line", "arrow", "rect", "ellipse"];

function setTool(tool) {
  opts.tool = tool;
  document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === tool));
  $("shape").classList.toggle("on", SHAPES.includes(tool) && tool !== "arrow");
  document.body.classList.toggle("panning", tool === "hand");
  document.body.classList.toggle("selecting", tool === "select");
  if (tool !== "select") select(null);
}

// A panel opens beside the button that opened it: right of the left rail, above the bottom bar.
let openFly = null;
function toggleFly(id, button) {
  const was = openFly;
  closeFly();
  if (was === id) return;
  const fly = $(id);
  fly.hidden = false;
  const b = (button || $("bar")).getBoundingClientRect();
  Object.assign(fly.style, { left: "", right: "", top: "", bottom: "", transform: "" });
  if (button && button.closest("#rail")) {
    fly.style.left = b.right + 10 + "px";
    fly.style.top = Math.min(b.top, innerHeight - fly.offsetHeight - 10) + "px";
  } else {
    fly.style.bottom = innerHeight - b.top + 10 + "px";
    fly.style.left = Math.max(8, Math.min(innerWidth - fly.offsetWidth - 8, b.left + b.width / 2 - fly.offsetWidth / 2)) + "px";
  }
  openFly = id;
}
function closeFly() {
  if (openFly) $(openFly).hidden = true;
  openFly = null;
}

function setColor(color, button) {
  opts.color = color;
  document.querySelectorAll(".swatch").forEach((b) => b.classList.toggle("on", b === button));
  $("colour").style.setProperty("--c", color);
  // A note that is picked takes the colour too.
  const one = picked();
  if (one.length === 1 && one[0].tool === "sticky") {
    const recoloured = { ...one[0], color: NOTE[color] || "#fef3a0" };
    board.replace(one[0], recoloured);
    select(recoloured);
    paint(BASE);
    save();
    return;
  }
  if (["eraser", "hand", "select"].includes(opts.tool)) setTool("pen");
}

function undo() { if (board.undo()) { select(null); paint(BASE); save(); } }
function redo() { if (board.redo()) { select(null); paint(BASE); save(); } }

function updateButtons() {
  $("undo").disabled = $("undo-top").disabled = !board.done.length;
  $("redo").disabled = $("redo-top").disabled = !board.undone.length;
  $("zoom").textContent = Math.round(view.s * 100) + "%";
}

// Chrome drops the click of a finger tap that comes just after a fast swipe on
// the board (it takes the tap as "stop scrolling"), so Undo right after a quick
// erase did nothing. Finger and stylus taps on any button act on pointerup instead.
let pressedButton = null, tappedAt = 0;
document.addEventListener("pointerdown", (e) => { pressedButton = e.target.closest("button"); }, true);
document.addEventListener("pointerup", (e) => {
  const b = e.target.closest("button");
  if (e.pointerType === "mouse" || !b || b !== pressedButton || b.disabled) return;
  tappedAt = performance.now();
  b.click();
}, true);
document.addEventListener("click", (e) => {
  // ...and the browser's own click for that tap, if it does come, is not a second press.
  if (e.isTrusted && performance.now() - tappedAt < 800 && e.target.closest("button")) {
    e.stopPropagation();
    e.preventDefault();
  }
}, true);

document.querySelectorAll("[data-fly]").forEach((b) => b.addEventListener("click", () => toggleFly(b.dataset.fly, b)));
// Any choice made in a panel, or another bar button, closes the panel.
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b && !b.dataset.fly && b.closest(".tb")) closeFly();
});
document.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
document.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", () => setColor(b.dataset.color, b)));
$("pick").addEventListener("input", (e) => {
  const label = e.target.parentElement;
  label.style.setProperty("--c", e.target.value);
  setColor(e.target.value, label);
});
document.querySelectorAll("[data-size]").forEach((b) => b.addEventListener("click", () => {
  opts.size = Number(b.dataset.size);
  document.querySelectorAll("[data-size]").forEach((x) => x.classList.toggle("on", x === b));
}));
$("undo").addEventListener("click", undo);
$("redo").addEventListener("click", redo);
$("undo-top").addEventListener("click", undo);
$("redo-top").addEventListener("click", redo);
$("zoom-in").addEventListener("click", () => zoomAt(W / 2, H / 2, 1.25));
$("zoom-out").addEventListener("click", () => zoomAt(W / 2, H / 2, 0.8));
$("sel-del").addEventListener("click", deleteSelected);
$("sel-copy").addEventListener("click", duplicateSelected);
$("sel-edit").addEventListener("click", () => sel.length === 1 && editNote(sel[0]));
$("sel-ask").addEventListener("click", () => window.Liza && Liza.askAbout());
$("clear").addEventListener("click", () => {
  if (!board.items.length) return;
  select(null);
  board.clear();
  paint(BASE);
  save();
  toast("Board cleared. Undo brings it back.");
});
$("bg").addEventListener("click", () => {
  opts.bg = BACKGROUNDS[(BACKGROUNDS.indexOf(opts.bg) + 1) % BACKGROUNDS.length];
  $("bgname").textContent = opts.bg;
  paint(BASE);
  save();
});
$("zoom").addEventListener("click", fit);
$("png").addEventListener("click", exportPng);
$("save").addEventListener("click", () => {
  const data = JSON.stringify({ app: "whiteboard", version: 2, title: $("title").value, ...boardData() });
  download(new Blob([data], { type: "application/json" }), fileName() + ".json");
});
$("open").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (_) {
    return toast("That isn't a whiteboard file");
  }
  const loaded = C.sanitizeBoard(data);
  if (!loaded.pages.some((items) => items.length)) return toast("Nothing in that file to draw");
  if (pages.some((h) => h.items.length) && !confirm("Replace this board with the file?")) return;
  loadBoard(data);
  if (typeof data.title === "string") $("title").value = data.title.slice(0, 120);
  fit();
  save();
  toast("Opened " + file.name);
});

const fullscreenOK = document.fullscreenEnabled || document.webkitFullscreenEnabled;
if (!fullscreenOK) $("full").hidden = true; // iPhone: use Add to Home Screen instead
$("full").addEventListener("click", () => {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  }
});

// ------------------------------------------------------------------ pictures
// Shrunk to at most 1200 px a side so the board stays small enough to save.
$("image").addEventListener("click", () => $("imagefile").click());
$("imagefile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch (_) { return toast("That picture couldn't be opened."); }
  const k = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bitmap.width * k);
  c.height = Math.round(bitmap.height * k);
  c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
  const src = file.type === "image/png" && c.width * c.height < 400000 ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.85);
  const w = Math.min(480, W * 0.4) / view.s, h = (w * c.height) / c.width;
  const [cx, cy] = toBoard(W / 2, H / 2);
  const item = { tool: "image", color: "#000000", x: r2(cx - w / 2), y: r2(cy - h / 2), w: r2(w), h: r2(h), src };
  board.add(item);
  setTool("select");
  select(item);
  paint(BASE);
  save();
});

// ------------------------------------------------------------------ files
function fileName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `whiteboard-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function exportPng() {
  const b = C.boundsOf(board.items);
  if (!b) return toast("Nothing on the board to save yet");
  const m = 24, w = b.x1 - b.x0 + 2 * m, h = b.y1 - b.y0 + 2 * m;
  // Sharp, but under the ~16 megapixel canvas limit of phone browsers.
  const k = Math.min(2, Math.sqrt(16e6 / (w * h)));
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * k);
  c.height = Math.ceil(h * k);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(k, 0, 0, k, (m - b.x0) * k, (m - b.y0) * k);
  board.items.forEach((it) => drawItem(ctx, it));
  c.toBlob((blob) => download(blob, fileName() + ".png"), "image/png");
}

// ------------------------------------------------------------------ pages
let pages = [board];
let pageNo = 0;
let boardKey = 0; // goes up whenever another page or board is put on screen (liza.js reads afresh)

function showPage(i, quiet = false) {
  commitText();
  closeNote();
  select(null);
  pageNo = Math.max(0, Math.min(pages.length - 1, i));
  board = pages[pageNo];
  boardKey++;
  updatePager();
  paint(BASE | LIVE);
  save(quiet);
}

function updatePager() {
  $("page-label").textContent = `Page ${pageNo + 1} / ${pages.length}`;
  $("page-del").hidden = pages.length < 2;
  $("pagelist-items").replaceChildren(...pages.map((h, i) => {
    const b = document.createElement("button");
    b.className = "page" + (i === pageNo ? " on" : "");
    b.textContent = `Page ${i + 1}` + (h.items.length ? "" : " (empty)");
    b.addEventListener("click", () => { closeFly(); showPage(i); });
    return b;
  }));
}
$("page-add").addEventListener("click", () => {
  closeFly();
  pages.splice(pageNo + 1, 0, new C.History());
  showPage(pageNo + 1);
  Object.assign(view, { s: 1, x: 0, y: 0 });
  paint(BASE);
  toast(`Page ${pageNo + 1} added`);
});
$("page-del").addEventListener("click", () => {
  closeFly();
  if (pages.length < 2) return;
  if (board.items.length && !confirm(`Delete page ${pageNo + 1} and everything on it?`)) return;
  pages.splice(pageNo, 1);
  showPage(Math.min(pageNo, pages.length - 1));
});
$("thumb-toggle").addEventListener("click", () => $("pages").classList.toggle("small"));
$("thumb").addEventListener("click", fit);

// The page in miniature, bottom left.
function drawThumb() {
  const c = $("thumb"), ctx = c.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  const b = C.boundsOf(board.items);
  if (!b) return;
  const m = 10, k = Math.min((c.width - 2 * m) / (b.x1 - b.x0 || 1), (c.height - 2 * m) / (b.y1 - b.y0 || 1), 0.5);
  const ox = (c.width - (b.x1 - b.x0) * k) / 2 - b.x0 * k, oy = (c.height - (b.y1 - b.y0) * k) / 2 - b.y0 * k;
  ctx.setTransform(k, 0, 0, k, ox, oy);
  board.items.forEach((it) => drawItem(ctx, it));
}

const boardData = () => ({ pages: pages.map((h) => ({ items: h.items })), bg: opts.bg });

function loadBoard(data) {
  const loaded = C.sanitizeBoard(data);
  pages = loaded.pages.map((items) => new C.History(items));
  if (BACKGROUNDS.includes(loaded.bg)) opts.bg = loaded.bg;
  $("bgname").textContent = opts.bg;
  showPage(Number.isInteger(data && data.page) ? data.page : 0, true);
}

// ------------------------------------------------------------------ saving
// Always kept in this browser; when signed in, also on the server under the
// person's account (the top bar says which). Save makes a file to move elsewhere.
let saveTimer = 0, saveWarned = false;
function save(viewOnly = false) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ ...boardData(), page: pageNo, view, title: $("title").value, cloud: cloud.id }));
    } catch (_) {
      if (!saveWarned) toast("Too much to keep in this browser. Use Save to keep it as a file.");
      saveWarned = true;
    }
    drawThumb();
    if (window.Liza) Liza.changed(); // liza.js: read the board again, or move her marks with it
  }, 400);
  if (!viewOnly) cloudSave();
}

function restore() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(STORE)); } catch (_) { /* private mode or junk */ }
  if (!data) return;
  loadBoard(data);
  if (typeof data.title === "string") $("title").value = data.title;
  cloud.id = typeof data.cloud === "string" ? data.cloud : null;
  const v = data.view || {};
  if ([v.s, v.x, v.y].every(Number.isFinite)) Object.assign(view, { s: clampScale(v.s), x: v.x, y: v.y });
}

async function api(method, url, body) {
  const r = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(out.detail || "Something went wrong."), { status: r.status });
  return out;
}

const cloud = { on: false, id: null, timer: 0, busy: false, again: false, at: 0 };

function saveState(kind, words) {
  $("savestate").className = kind;
  $("savetext").textContent = words;
}
function ago(t) {
  const s = (Date.now() - t) / 1000;
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString();
}
setInterval(() => { if (cloud.on && cloud.at && $("savestate").className === "saved") saveState("saved", "Saved " + ago(cloud.at)); }, 30000);

function cloudSave() {
  if (!cloud.on || !cloud.id) return;
  clearTimeout(cloud.timer);
  saveState("saving", "Saving…");
  cloud.timer = setTimeout(push, 1200);
}

async function push() {
  clearTimeout(cloud.timer);
  if (!cloud.on || !cloud.id) return;
  if (cloud.busy) { cloud.again = true; return; }
  cloud.busy = true;
  try {
    await api("PUT", `api/boards/${cloud.id}`, { title: $("title").value, data: boardData() });
    cloud.at = Date.now();
    saveState("saved", "Saved just now");
  } catch (err) {
    saveState("failed", err.status === 413 ? "Too big to save" : "Not saved yet");
    if (err.status !== 413) cloud.timer = setTimeout(push, 10000); // try again; it is still in this browser
  }
  cloud.busy = false;
  if (cloud.again) { cloud.again = false; push(); }
}

async function openBoard(id) {
  const b = await api("GET", `api/boards/${id}`);
  cloud.id = b.id;
  $("title").value = b.title;
  loadBoard(b.data);
  cloud.at = b.updated * 1000;
  saveState("saved", "Saved " + ago(cloud.at));
  fit();
}

// Signed in: open the board this browser had, else the latest; the first time,
// what is on this device becomes their first board. A share link gives them a copy.
async function cloudStart() {
  const me = window.WB_AUTH ? await window.WB_AUTH : null;
  if (!me) return saveState("saved", "Saved on this device");
  cloud.on = true;
  try {
    const shared = new URLSearchParams(location.search).get("share");
    if (shared) {
      history.replaceState(null, "", location.pathname);
      const got = await api("POST", `api/shared/${encodeURIComponent(shared)}`);
      await openBoard(got.id);
      return toast(got.own ? "That's your own board." : "This is your own copy of the shared board.");
    }
    const list = await api("GET", "api/boards");
    let id = list.some((b) => b.id === cloud.id) ? cloud.id : list.length ? list[0].id : null;
    if (!id) id = (await api("POST", "api/boards", { title: $("title").value, data: boardData() })).id;
    await openBoard(id);
  } catch (err) {
    saveState("failed", "Not saved to your account");
    toast(err.message);
  }
}

$("title").addEventListener("input", () => save());
$("title").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
$("title").addEventListener("blur", () => { if (!$("title").value.trim()) { $("title").value = "Untitled board"; save(); } });

$("share").addEventListener("click", async () => {
  if (!cloud.on || !cloud.id) return toast("Sign in to share your boards.");
  try {
    await push();
    const { token } = await api("POST", `api/boards/${cloud.id}/share`);
    const link = location.origin + location.pathname + "?share=" + token;
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copied. Whoever opens it gets their own copy of this board.");
    } catch (_) {
      prompt("Copy this link. Whoever opens it gets their own copy of this board:", link);
    }
  } catch (err) {
    toast(err.message);
  }
});

$("new-board").addEventListener("click", async () => {
  closeFly();
  if (!cloud.on) {
    if (pages.some((h) => h.items.length) && !confirm("Start a new board? This one will be cleared (save it as a file first if you need it).")) return;
    loadBoard({ pages: [{ items: [] }], bg: opts.bg });
    $("title").value = "Untitled board";
    return fit();
  }
  try {
    await push();
    const { id } = await api("POST", "api/boards", { title: "Untitled board" });
    await openBoard(id);
    toast("New board");
  } catch (err) { toast(err.message); }
});

$("my-boards").addEventListener("click", async (e) => {
  if (!cloud.on) { closeFly(); return toast("Sign in to keep several boards."); }
  const button = e.currentTarget;
  let list;
  try { await push(); list = await api("GET", "api/boards"); } catch (err) { return toast(err.message); }
  $("boards-list").replaceChildren(...list.map((b) => {
    const row = document.createElement("div");
    row.className = "board-row";
    const open = document.createElement("button");
    open.className = "open" + (b.id === cloud.id ? " current" : "");
    const name = document.createElement("b");
    name.textContent = b.title;
    const when = document.createElement("small");
    when.textContent = "Edited " + ago(b.updated * 1000);
    open.append(name, when);
    open.addEventListener("click", async () => { closeFly(); try { await openBoard(b.id); } catch (err) { toast(err.message); } });
    const del = document.createElement("button");
    del.title = "Delete this board";
    del.innerHTML = '<svg><use href="#i-clear"/></svg>';
    del.addEventListener("click", async () => {
      if (!confirm(`Delete "${b.title}" for good?`)) return;
      try {
        await api("DELETE", `api/boards/${b.id}`);
        row.remove();
        if (b.id === cloud.id) { cloud.id = null; closeFly(); cloudStart(); }
      } catch (err) { toast(err.message); }
    });
    row.append(open, del);
    return row;
  }));
  toggleFly("boards", button);
});

// ------------------------------------------------------------------ mind maps and flowcharts
// The AI gives a list of ideas (boards.py); here they become sticky notes and
// lines on the board, laid out around the middle of the screen, one undo step.
const NOTE_COLOURS = ["#bfdbfe", "#bbf7d0", "#fed7aa", "#fbcfe8", "#fef3a0", "#99f6e4", "#fecaca", "#e9d5ff"];

function addDiagram(d) {
  select(null);
  const u = 1 / view.s, out = [], lines = [];
  const a = clearArea();
  const [cx, cy] = toBoard((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2);
  const note = (x, y, w, h, text, color, size) => {
    const n = { tool: "sticky", color, x: r2(x - (w * u) / 2), y: r2(y - (h * u) / 2), w: r2(w * u), h: r2(h * u), text, size: r2(size * u) };
    out.push(n);
    return n;
  };
  const centre = (n) => [n.x + n.w / 2, n.y + n.h / 2];
  const link = (tool, p, q, color = "#a78bfa") =>
    lines.push({ tool, color, width: r2(3 * u), pressure: false, points: [[r2(p[0]), r2(p[1]), 0.5], [r2(q[0]), r2(q[1]), 0.5]] });
  if (d.kind === "mindmap") {
    const mid = note(cx, cy, 250, 100, d.center, "#ddd6fe", 24);
    const n = d.branches.length;
    d.branches.forEach((br, i) => {
      const ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
      const colour = NOTE_COLOURS[i % NOTE_COLOURS.length];
      const bn = note(cx + Math.cos(ang) * 340 * u, cy + Math.sin(ang) * 250 * u, 200, 80, br.label, colour, 19);
      link("line", centre(mid), centre(bn));
      const m = br.children.length, spread = Math.min(0.42, (2 * Math.PI) / n / Math.max(1, m));
      br.children.forEach((child, j) => {
        const ca = ang + (j - (m - 1) / 2) * spread;
        const kn = note(cx + Math.cos(ca) * 620 * u, cy + Math.sin(ca) * 430 * u, 190, 66, child, "#ffffff", 16);
        link("line", centre(bn), centre(kn), colour === "#fef3a0" ? "#eab308" : "#c4b5fd");
      });
    });
  } else {
    // Rows by distance from the start; whatever isn't reached goes underneath.
    const depth = new Map();
    const start = d.nodes.find((x) => x.type === "start") || d.nodes[0];
    depth.set(start.id, 0);
    for (let changed = true, guard = 0; changed && guard < 50; guard++) {
      changed = false;
      for (const l of d.links) {
        if (depth.has(l.from) && !depth.has(l.to)) { depth.set(l.to, depth.get(l.from) + 1); changed = true; }
      }
    }
    let last = Math.max(...depth.values());
    for (const x of d.nodes) if (!depth.has(x.id)) depth.set(x.id, ++last);
    const rows = [];
    for (const x of d.nodes) (rows[depth.get(x.id)] = rows[depth.get(x.id)] || []).push(x);
    const placed = new Map(), W0 = 230, H0 = 84, gapX = 280, gapY = 170;
    const top = cy - ((rows.length - 1) * gapY * u) / 2;
    rows.forEach((row, r) => row.forEach((x, k) => {
      const colour = x.type === "decision" ? "#fef3a0" : x.type === "step" ? "#bfdbfe" : "#bbf7d0";
      placed.set(x.id, note(cx + (k - (row.length - 1) / 2) * gapX * u, top + r * gapY * u, W0, H0, x.label, colour, 17));
    }));
    for (const l of d.links) {
      const p = placed.get(l.from), q = placed.get(l.to);
      const down = q.y > p.y;
      const from = [p.x + p.w / 2, down ? p.y + p.h : p.y + p.h / 2];
      const to = [q.x + q.w / 2, down ? q.y : q.y + q.h / 2];
      link("arrow", from, to, "#6b7280");
      if (l.label) out.push({ tool: "text", color: "#4b5563", x: r2((from[0] + to[0]) / 2 + 8 * u), y: r2((from[1] + to[1]) / 2 - 10 * u), size: r2(16 * u), text: l.label });
    }
  }
  const all = [...lines, ...out]; // lines first, so the notes sit on top of their ends
  board.addMany(all);
  fitTo(C.boundsOf(all));
  save();
}

window.Board = { addDiagram, get key() { return boardKey; }, get selection() { return picked(); } };

let toastTimer = 0;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

restore();
$("bgname").textContent = opts.bg;
updatePager();
resize();
drawThumb();
cloudStart();
