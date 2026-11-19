// The Transcribe Board, full screen: ui.py's open_whiteboard and its _wb_*
// drawing, on the same 800x480 layout. A toolbar (four pens, the rubber,
// undo, the bin, "Ask Liza", the collapse mark), a dotted page, the bar along
// the bottom with her microphone, state and captions, the chip that says what
// she read, the buttons under the writing, the measured figure, and her
// worked solution as a column beside the writing with each step lit as she
// says it. The reading, the buttons and the column come from the device's own
// whiteboard.py and solution.py on the server.

import * as api from "../api.js";
import { h } from "../ui.js";
import { listener, speaker } from "../voice.js";
import { LiveGraph } from "../graphcard.js";

const UI_W = 800, UI_H = 480, WB_TOP = 52, WB_BOTTOM = 432;
const PAGE_H = WB_BOTTOM - WB_TOP;
const PENS = ["#1E2233", "#1D4ED8", "#DC2626", "#059669"];
const PEN_W = 4, RUBBER_W = 30;
const PANEL_RIGHT = [446, 60, 792, 426], PANEL_LEFT = [8, 60, 354, 426];
const INDIGO = "#6366F1", TEXT = "#1E2233", TEXT_DIM = "#8891A8", FAINT = "#B6BDD0";
const STATE = { idle: ["TAP TO SPEAK", "#4C6FFF"], listening: ["LISTENING", "#14B8A6"],
  thinking: ["THINKING", "#F59E0B"], speaking: ["SPEAKING", "#EC4899"] };
const LETTERS = "ABCDEFGHIJKLMNPQRSTUVWXYZ";
const HINT = "Write or draw anything, then tap Ask Liza — or just ask me.";
const SCALE = 2;
const DEVANAGARI = /[ऀ-ॿ]/;
const NS = "http://www.w3.org/2000/svg";

function el(tag, cls, style = {}) {
  const node = h(tag, { class: cls });
  Object.assign(node.style, style);
  return node;
}
function px(node, x, y, w, hgt) {
  Object.assign(node.style, { position: "absolute", left: `${x}px`, top: `${y}px` });
  if (w !== undefined) node.style.width = `${w}px`;
  if (hgt !== undefined) node.style.height = `${hgt}px`;
  return node;
}

// hooks: {profile, mode(), onVisual(v), onOffer(offer), onDo(name, param)}
export function openWhiteboard({ screen, profile, mode, onVisual, onDo }) {
  const root = el("div", "wb2");
  screen.appendChild(root);

  let pen = 0, erasing = false;
  const strokes = [];            // {points: [[x,y]...], colour, width, erase}
  const undo = [];               // ["stroke", s] | ["clear", [strokes]]
  let current = null;
  let version = 0;
  let readTimer = null, readVersion = -1;
  let chip = [null, ""];         // mode: null | reading | read | hint
  let hintTimer = null;
  let suggestions = [], measure = null, measureShown = false;
  let offers = [];
  let panel = null, panelOpen = false, panelBox = PANEL_RIGHT, step = -1, scroll = 0;
  let graph = null, graphOpen = false;     // a graph, as a card on the page (_wb_show_graph)
  let caption = [HINT, "hint"];
  let state = "idle";
  let controller = null;
  let alive = true;

  // ----- the page -----
  const page = px(el("div", "wb2-page"), 0, WB_TOP, UI_W, PAGE_H);
  const canvas = h("canvas");
  canvas.width = UI_W * SCALE; canvas.height = PAGE_H * SCALE;
  px(canvas, 0, 0, UI_W, PAGE_H);
  canvas.style.touchAction = "none";
  page.appendChild(canvas);
  root.appendChild(page);
  const ctx = canvas.getContext("2d");
  const overlay = px(el("div", "wb2-layer"), 0, 0, UI_W, UI_H);   // chip, buttons, panel
  root.appendChild(overlay);
  const toolbar = px(el("div", "wb2-toolbar"), 0, 0, UI_W, WB_TOP);
  const bar = px(el("div", "wb2-bar"), 0, WB_BOTTOM, UI_W, UI_H - WB_BOTTOM);
  root.append(toolbar, bar);

  function drawStroke(s) {
    ctx.strokeStyle = s.colour; ctx.fillStyle = s.colour;
    ctx.lineWidth = s.width * SCALE; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const p = s.points;
    if (p.length === 1) {
      ctx.beginPath(); ctx.arc(p[0][0] * SCALE, p[0][1] * SCALE, s.width * SCALE / 2, 0, Math.PI * 2); ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(p[0][0] * SCALE, p[0][1] * SCALE);
    for (let i = 1; i < p.length - 1; i++) {
      const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
      ctx.quadraticCurveTo(p[i][0] * SCALE, p[i][1] * SCALE, mx * SCALE, my * SCALE);
    }
    const lastP = p[p.length - 1];
    ctx.lineTo(lastP[0] * SCALE, lastP[1] * SCALE);
    ctx.stroke();
  }
  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(drawStroke);
    if (current) drawStroke(current);
  }
  const clamp = (x, y) => [Math.max(2, Math.min(UI_W - 2, x)), Math.max(3, Math.min(PAGE_H - 3, y))];
  function point(e) {
    const r = canvas.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width * UI_W, (e.clientY - r.top) / r.height * PAGE_H);
  }
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    current = { points: [point(e)], erase: erasing, colour: erasing ? "#FFFFFF" : PENS[pen], width: erasing ? RUBBER_W : PEN_W };
    clearTimeout(readTimer);
    drawSuggestions(true);
    redraw();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!current) return;
    const [x, y] = point(e);
    const [lx, ly] = current.points[current.points.length - 1];
    if (Math.abs(x - lx) + Math.abs(y - ly) < 2) return;
    current.points.push([x, y]);
    redraw();
  });
  const lift = () => {
    if (!current) return;
    strokes.push(current); undo.push(["stroke", current]); current = null;
    changed();
  };
  canvas.addEventListener("pointerup", lift);
  canvas.addEventListener("pointercancel", lift);

  const hasInk = () => strokes.some((s) => !s.erase);
  const frozen = () => strokes.map((s) => [s.points, s.colour, s.width, s.erase]);
  function inkBox() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of strokes) if (!s.erase) for (const [x, y] of s.points) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return x0 === Infinity ? null : [x0, y0, x1, y1];
  }

  function changed() {
    version += 1;
    suggestions = []; measure = null; measureShown = false;
    drawToolbar();
    redraw();
    if (hasInk()) {
      clearTimeout(readTimer);
      readTimer = setTimeout(readNow, 1000);           // BOARD_READ_PAUSE_S
    } else {
      setChip(null);
    }
    drawOverlay();
  }

  // ----- the live reading (whiteboard.Reader) -----
  async function readNow() {
    if (!alive || current || version === readVersion || !hasInk()) return;
    const asked = version;
    setChip("reading");
    let found;
    try {
      found = await api.send("POST", "/api/board/read", { strokes: frozen(), hindi: language() === "hi" });
    } catch (_) { found = { read: "", suggest: [] }; }
    if (!alive || asked !== version) return;
    readVersion = asked;
    setChip(found.read ? "read" : null, found.read || "");
    suggestions = found.suggest || [];
    measure = found.measure || null;
    drawOverlay();
  }

  function setChip(m, text = "") {
    if (m !== "hint") clearTimeout(hintTimer);
    chip = [m, text];
    drawOverlay();
  }
  function hint(text) {
    const before = chip[0] !== "hint" ? chip : [null, ""];
    setChip("hint", text);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { if (chip[0] === "hint") setChip(...before); }, 3500);
  }

  // ----- toolbar (_wb_draw_toolbar) -----
  function drawToolbar() {
    toolbar.replaceChildren();
    const cy = WB_TOP / 2;
    const tool = (cx, half, svg, onclick) => {
      const t = px(el("div", "wb2-tool"), cx - half, cy - 20, half * 2, 40);
      t.innerHTML = svg;
      t.addEventListener("click", onclick);
      toolbar.appendChild(t);
    };
    PENS.forEach((colour, i) => {
      const chosen = i === pen && !erasing;
      tool(26 + i * 36, 17, `<svg width="34" height="40" viewBox="-17 -20 34 40">${chosen ? `<circle r="15" fill="none" stroke="${colour}" stroke-width="3"/>` : ""}<circle r="10" fill="${colour}"/></svg>`,
        () => { pen = i; erasing = false; drawToolbar(); });
    });
    tool(182, 17, `<svg width="34" height="40" viewBox="-17 -20 34 40">${erasing ? `<circle r="16" fill="none" stroke="${INDIGO}" stroke-width="3"/>` : ""}<polygon points="-9,4 1,-8 10,-1 0,11" fill="#F9A8D4" stroke="#9D174D" stroke-width="2"/><line x1="-4" y1="-2" x2="5" y2="5" stroke="#9D174D" stroke-width="2"/></svg>`,
      () => { erasing = !erasing; drawToolbar(); });
    const undoInk = undo.length ? INDIGO : FAINT;
    tool(226, 17, `<svg width="34" height="40" viewBox="-17 -20 34 40"><path d="M -8.5 2.5 A 9 9 0 1 1 5 8" fill="none" stroke="${undoInk}" stroke-width="3"/><polygon points="-13,-1 -4,-1 -9,6" fill="${undoInk}"/></svg>`, undoLast);
    const binInk = strokes.length ? "#F43F5E" : FAINT;
    tool(268, 17, `<svg width="34" height="40" viewBox="-17 -20 34 40" fill="none" stroke="${binInk}" stroke-width="2" stroke-linecap="round"><line x1="-10" y1="-7" x2="10" y2="-7"/><line x1="-3" y1="-10" x2="3" y2="-10"/><polygon points="-7,-4 7,-4 6,11 -6,11"/><line x1="-3" y1="-1" x2="-3" y2="8" stroke-width="1"/><line x1="0" y1="-1" x2="0" y2="8" stroke-width="1"/><line x1="3" y1="-1" x2="3" y2="8" stroke-width="1"/></svg>`, clearPage);
    const cards = [];
    if (graph && !graphOpen) cards.push(["Graph", showGraph]);
    if (panel && !panelOpen) cards.push(["Steps", showPanel]);
    if (cards.length < 2) {
      const title = px(el("div", "wb2-title"), 0, 0, UI_W, WB_TOP);
      title.textContent = "Transcribe Board";
      toolbar.appendChild(title);
    }
    let right = 588;
    for (const [words, onclick] of cards) {
      const c = px(el("button", "wb2-card"), right - 80, cy - 16, 80, 32);
      c.textContent = words; c.addEventListener("click", onclick);
      toolbar.appendChild(c); right -= 92;
    }
    const ask = px(el("button", "wb2-ask"), 602, cy - 18, 136, 36);
    ask.innerHTML = `<svg width="16" height="16" viewBox="-8 -8 16 16"><polygon points="0,-7 2.1,-2.1 7,0 2.1,2.1 0,7 -2.1,2.1 -7,0 -2.1,-2.1" fill="#fff"/></svg><span>Ask Liza</span>`;
    ask.addEventListener("click", () => askLiza());
    toolbar.appendChild(ask);
    const close = px(el("div", "wb2-collapse"), UI_W - 28 - 15, cy - 15, 30, 30);
    close.innerHTML = `<svg width="30" height="30" viewBox="-15 -15 30 30" stroke="${INDIGO}" stroke-width="2" stroke-linecap="round" fill="none">${[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => { const x = 3 * sx, y = 3 * sy; return `<path d="M ${x + 5 * sx} ${y} L ${x} ${y} L ${x} ${y + 5 * sy}"/>`; }).join("")}</svg>`;
    close.addEventListener("click", closeBoard);
    toolbar.appendChild(close);
  }

  function undoLast() {
    const last = undo.pop();
    if (!last) return;
    if (last[0] === "stroke") { const i = strokes.indexOf(last[1]); if (i >= 0) strokes.splice(i, 1); }
    else strokes.unshift(...last[1]);
    changed();
  }
  function clearPage() {
    if (!strokes.length) return;
    undo.push(["clear", strokes.splice(0)]);
    panelOpen = false;
    changed();
  }

  // ----- the bar along the bottom (_wb_draw_bar / _wb_draw_caption) -----
  function drawBar() {
    bar.replaceChildren();
    const cy = (UI_H - WB_BOTTOM) / 2;
    const mic = px(el("div", "wb2-mic"), 30 - 19, cy - 19, 38, 38);
    mic.style.background = state === "listening" ? "#14B8A6" : INDIGO;
    mic.innerHTML = `<svg width="38" height="38" viewBox="-19 -19 38 38"><rect x="-5" y="-11" width="10" height="14" rx="5" fill="#fff"/><path d="M -9 1 A 9 7 0 0 0 9 1" fill="none" stroke="#fff" stroke-width="2"/><line x1="0" y1="8" x2="0" y2="12" stroke="#fff" stroke-width="2"/></svg>`;
    mic.addEventListener("click", speak);
    bar.appendChild(mic);
    const [label, colour] = STATE[state] || STATE.idle;
    const st = px(el("div", "wb2-state"), 58, cy - 8);
    st.textContent = label; st.style.color = colour;
    bar.appendChild(st);
    const [words, who] = caption;
    const cap = px(el("div", "wb2-caption"), 150, cy - 9, UI_W - 150 - 14);
    cap.textContent = who === "hint" ? words : `${who === "liza" ? "Liza" : "You"}: ${words}`;
    cap.style.color = who === "hint" ? TEXT_DIM : TEXT;
    bar.appendChild(cap);
  }
  function setState(next) { state = next; drawBar(); }
  function setCaption(text, who) { caption = [text, who]; drawBar(); }

  // ----- what goes on the page: chip, buttons, figure, panel, offers -----
  function cardBox() { return (panel && panelOpen) || (graph && graphOpen) ? panelBox : null; }

  function drawOverlay() {
    overlay.replaceChildren();
    drawMeasure();
    drawPanel();
    drawGraphCard();
    const offerLeft = drawOffers();
    drawChip(offerLeft);
    drawSuggestions();
  }

  function drawChip(offerLeft = UI_W - 14) {
    const [m, text] = chip;
    if (!m) return;
    const [words, ink, ground] = m === "reading" ? ["Reading what you wrote…", TEXT_DIM, "#F3F5FD"]
      : m === "read" ? [`I read:  ${text}`, "#3730A3", "#EEF2FF"] : [text, "#9A3412", "#FFF7ED"];
    let x0 = 12, right = UI_W - 14;
    const card = cardBox();
    if (card) { if (card[0] < UI_W / 4) x0 = card[2] + 12; else right = card[0] - 14; }
    right = Math.min(right, offerLeft - 10);
    const cy = WB_BOTTOM - 24;
    const c = px(el("div", "wb2-chip"), x0, cy - 16);
    Object.assign(c.style, { maxWidth: `${right - x0}px`, color: ink, background: ground, borderColor: mix(ink) });
    c.innerHTML = `<svg width="20" height="14" viewBox="-10 -7 20 14"><ellipse rx="9" ry="6" fill="none" stroke="${ink}" stroke-width="2"/><circle r="3" fill="${ink}"/></svg>`;
    const span = h("span", { text: words });
    if (m === "read") span.style.fontWeight = "700";
    c.appendChild(span);
    overlay.appendChild(c);
  }

  function pill(offer, x, y, w, hgt, onclick) {
    const p = px(el("button", "bv-offer"), x, y, w, hgt);
    p.append(h("span", { class: "bv-play" }),
      h("span", { class: "bv-offer-words" }, h("b", { text: offer.label }), offer.sub ? h("small", { text: offer.sub }) : null));
    p.addEventListener("click", onclick);
    return p;
  }

  // _wb_draw_suggestions: under the writing (or above it, near the floor).
  function drawSuggestions(hidden = false) {
    overlay.querySelectorAll(".wb2-suggest").forEach((n) => n.remove());
    if (hidden || current || !suggestions.length) return;
    const box = inkBox();
    if (!box) return;
    const list = suggestions.map((o) => (o.kind === "measure" && measureShown ? { ...o, label: "Hide the angles" } : o));
    const widths = list.map((o) => Math.min(210, Math.max(o.label.length * 7.4, (o.sub || "").length * 5.6) + 52));
    let left = 10, right = UI_W - 10;
    const card = cardBox();
    if (card && card[0] < UI_W / 4) left = card[2] + 10; else if (card) right = card[0] - 10;
    const gap = 8, hgt = 38;
    while (widths.length && widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1) > right - left) widths.pop();
    const shown = list.slice(0, widths.length);
    if (!shown.length) return;
    const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
    let x = Math.max(left, Math.min(box[0], right - total));
    const floor = WB_BOTTOM - 50;
    let y = box[3] + WB_TOP + 14;
    if (y + hgt > floor) { y = box[1] + WB_TOP - 14 - hgt; if (y < WB_TOP + 8) y = floor - hgt; }
    const ground = px(el("div", "wb2-suggest wb2-suggest-ground"), x - 7, y - 7, total + 14, hgt + 14);
    overlay.appendChild(ground);
    shown.forEach((offer, i) => {
      const p = pill(offer, x, y, widths[i], hgt, () => suggestionTapped(offer));
      p.classList.add("wb2-suggest");
      overlay.appendChild(p);
      x += widths[i] + gap;
    });
  }

  // _wb_suggestion_tapped
  function suggestionTapped(offer) {
    if (offer.kind === "ask") return askLiza(offer.payload);
    if (offer.kind === "measure") { measureShown = !measureShown; return drawOverlay(); }
    if (offer.kind === "explore") { measureShown = true; return drawOverlay(); }
    runOffer(offer);
  }

  async function runOffer(offer) {
    try {
      const done = await api.send("POST", "/api/visual", { kind: offer.kind, payload: offer.payload, language: language() });
      if (done.visual && done.visual.graph) setGraph(done.visual.graph);
      else if (done.visual) onVisual({ ...done.visual, settings: offer.settings }, true);
      if (done.say) { hint(done.say); speaker.say(done.say); }
    } catch (_) {
      hint("I couldn't open that one, sorry.");
    }
  }

  // _wb_draw_offers: her buttons, bottom right, beside the chip.
  function drawOffers() {
    let right = UI_W - 14;
    const card = cardBox();
    if (card && card[0] >= UI_W / 4) right = card[0] - 12;
    const cy = WB_BOTTOM - 24;
    const list = offers.filter((o) => !(panel && panelOpen && panel.see && o.kind === panel.see.kind && o.payload === panel.see.payload)).slice(0, 3);
    for (const offer of list.reverse()) {
      const width = Math.min(230, Math.max(offer.label.length * 7.4, (offer.sub || "").length * 5.6) + 52);
      if (right - width < 160) break;
      overlay.appendChild(pill(offer, right - width, cy - 17, width, 34, () => runOffer(offer)));
      right -= width + 8;
    }
    return right;
  }

  // _wb_draw_measure: the drawn figure tidied, a letter at each corner, each
  // angle written inside it, and what they add up to.
  function drawMeasure() {
    if (!(measureShown && measure)) return;
    const pts = measure.points.map(([x, y]) => [x, y + WB_TOP]);
    const faces = measure.faces;
    const ink = "#7C3AED";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", UI_W); svg.setAttribute("height", UI_H);
    svg.classList.add("wb2-measure");
    const add = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.appendChild(n); return n; };
    const sides = new Set();
    faces.forEach((f) => f.forEach((a, i) => { const b = f[(i + 1) % f.length]; sides.add(`${Math.min(a, b)},${Math.max(a, b)}`); }));
    for (const key of sides) {
      const [a, b] = key.split(",").map(Number);
      add("line", { x1: pts[a][0], y1: pts[a][1], x2: pts[b][0], y2: pts[b][1], stroke: ink, "stroke-width": 3, "stroke-linecap": "round" });
    }
    const many = faces.length > 1;
    const size = many || faces[0].length > 4 ? 12 : 14.5;
    const middles = [];
    faces.forEach((f, k) => {
      const ring = f.map((i) => pts[i]);
      const n = ring.length;
      const cx = ring.reduce((s, p) => s + p[0], 0) / n, cy = ring.reduce((s, p) => s + p[1], 0) / n;
      middles.push([cx, cy]);
      const shortest = Math.min(...ring.map((p, i) => Math.hypot(p[0] - ring[(i - 1 + n) % n][0], p[1] - ring[(i - 1 + n) % n][1])));
      const radius = Math.max(9, Math.min(22, shortest * 0.22));
      ring.forEach(([x, y], i) => {
        const [ax, ay] = ring[(i - 1 + n) % n], [bx, by] = ring[(i + 1) % n];
        const first = Math.atan2(y - ay, ax - x) * 180 / Math.PI;
        const second = Math.atan2(y - by, bx - x) * 180 / Math.PI;
        let extent = ((second - first) % 360 + 360) % 360, start = first;
        const angle = measure.angles[k][i];
        if ((extent > 180) !== (angle > 180)) { start = second; extent = 360 - extent; }
        const r0 = start * Math.PI / 180, r1 = (start + extent) * Math.PI / 180;
        add("path", { d: `M ${x + radius * Math.cos(r0)} ${y - radius * Math.sin(r0)} A ${radius} ${radius} 0 ${extent > 180 ? 1 : 0} 0 ${x + radius * Math.cos(r1)} ${y - radius * Math.sin(r1)}`,
          fill: "none", stroke: ink, "stroke-width": 2 });
        const middle = (start + extent / 2) * Math.PI / 180;
        const reach = radius + (extent > 60 ? 14 : 22);
        const lx = x + Math.cos(middle) * reach, ly = y - Math.sin(middle) * reach;
        const words = `${angle}°`;
        const half = words.length * size * 0.32 + 3;
        add("rect", { x: lx - half, y: ly - 9, width: half * 2, height: 18, rx: 7, fill: "#fff" });
        const t = add("text", { x: lx, y: ly + size * 0.35, "text-anchor": "middle", fill: ink, "font-size": size, "font-weight": 700, "font-family": "Noto Sans, sans-serif" });
        t.textContent = words;
      });
    });
    pts.forEach(([x, y], i) => {
      const owners = faces.map((f, k) => (f.includes(i) ? middles[k] : null)).filter(Boolean);
      const ox = owners.reduce((s, p) => s + p[0], 0) / owners.length, oy = owners.reduce((s, p) => s + p[1], 0) / owners.length;
      let dx = x - ox, dy = y - oy, away = Math.hypot(dx, dy);
      if (away < 6) { dx = 0; dy = -1; away = 1; }
      const t = add("text", { x: x + dx / away * 17, y: y + dy / away * 17 + 6, "text-anchor": "middle", fill: TEXT, "font-size": 16, "font-weight": 700, "font-family": "Noto Sans, sans-serif" });
      t.textContent = LETTERS[i] || "";
    });
    const words = many ? faces.slice(0, 4).map((f) => `${f.map((i) => LETTERS[i]).join("")} = ${(f.length - 2) * 180}°`).join("  ·  ")
      : (faces[0].length <= 4 ? `${faces[0].map((i) => LETTERS[i]).join(" + ")} = ${(faces[0].length - 2) * 180}°`
        : `The angles add up to ${(faces[0].length - 2) * 180}°`);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const width = words.length * 4.6 + 12;
    let x = (Math.min(...xs) + Math.max(...xs)) / 2, y = Math.min(...ys) - 34;
    if (y < WB_TOP + 18) { x = Math.max(...xs) + width + 24; y = (Math.min(...ys) + Math.max(...ys)) / 2; }
    x = Math.max(12 + width, Math.min(UI_W - 12 - width, x));
    add("rect", { x: x - width, y: y - 14, width: width * 2, height: 28, rx: 14, fill: "#F5F3FF", stroke: "#DDD6FE" });
    const t = add("text", { x, y: y + 5.5, "text-anchor": "middle", fill: ink, "font-size": 16, "font-weight": 700, "font-family": "Noto Sans, sans-serif" });
    t.textContent = words;
    overlay.appendChild(svg);
  }

  // _wb_draw_panel: the working beside the writing, on whichever side covers less of it.
  function pickSide() {
    const under = ([x0, y0, x1, y1]) => strokes.filter((s) => !s.erase)
      .reduce((n, s) => n + s.points.filter(([x, y]) => x0 <= x && x <= x1 && y0 <= y + WB_TOP && y + WB_TOP <= y1).length, 0);
    return under(PANEL_LEFT) < under(PANEL_RIGHT) ? PANEL_LEFT : PANEL_RIGHT;
  }
  // _wb_graph_box: beside the writing, narrowed to the room next to it.
  function graphBox() {
    const side = pickSide();
    const ink = inkBox();
    if (!ink) return side;
    const [x0, y0, x1, y1] = side;
    if (side === PANEL_RIGHT && ink[2] + 12 > x0 && x1 - (ink[2] + 12) >= 250) return [ink[2] + 12, y0, x1, y1];
    if (side === PANEL_LEFT && ink[0] - 12 < x1 && (ink[0] - 12) - x0 >= 250) return [x0, y0, ink[0] - 12, y1];
    return side;
  }
  function showGraph() {
    if (!graph) return;
    panelOpen = false;
    panelBox = graphBox(); graphOpen = true;
    drawToolbar(); drawOverlay();
  }
  function setGraph(data) {
    graph = new LiveGraph(data);
    showGraph();
  }
  function drawGraphCard() {
    if (!(graph && graphOpen)) return;
    const [x0, y0, x1, y1] = panelBox;
    overlay.appendChild(px(el("div", "wb2-panel-shadow"), x0 + 2, y0 + 3, x1 - x0, y1 - y0));
    graph.draw(overlay, panelBox, "card", { onClose: () => { graphOpen = false; drawToolbar(); drawOverlay(); } });
  }
  function showPanel() {
    if (!panel) return;
    graphOpen = false;
    panelBox = pickSide(); panelOpen = true;
    drawToolbar(); drawOverlay();
  }
  function drawPanel() {
    if (!(panel && panelOpen)) return;
    const [x0, y0, x1, y1] = panelBox;
    overlay.appendChild(px(el("div", "wb2-panel-shadow"), x0 + 2, y0 + 3, x1 - x0, y1 - y0));
    const box = px(el("div", "wb2-panel"), x0, y0, x1 - x0, y1 - y0);
    overlay.appendChild(box);
    let head = 36;
    if (panel.title) {
      const title = px(h("img", { src: panel.title, alt: "" }), 14, 10);
      box.appendChild(title);
      title.onload = () => { head = 18 + title.naturalHeight; layoutBody(); };
    }
    const close = px(el("div", "bv-close wb2-panel-close"), x1 - x0 - 22 - 13, 22 - 13, 26, 26);
    close.textContent = "✕";
    close.addEventListener("click", () => { panelOpen = false; drawToolbar(); drawOverlay(); });
    box.appendChild(close);
    const rule = el("div", "wb2-rule");
    const body = el("div", "wb2-body");
    box.append(rule, body);
    const img = h("img", { src: panel.columns[step + 1] || panel.columns[0], alt: "", draggable: "false" });
    body.appendChild(img);
    let see = null;
    if (panel.see) {
      see = px(el("button", "wb2-see"), 12, y1 - y0 - 44, x1 - x0 - 24, 36);
      see.innerHTML = `<svg width="14" height="16" viewBox="0 0 14 16"><polygon points="0,0 0,16 13,8" fill="#fff"/></svg><span></span>`;
      see.querySelector("span").textContent = panel.see.label;
      see.addEventListener("click", () => runOffer(panel.see));
      box.appendChild(see);
    }
    function layoutBody() {
      const foot = see ? 50 : 6;
      px(rule, 10, head - 3, x1 - x0 - 20, 2);
      px(body, 4, head, x1 - x0 - 8, y1 - y0 - head - foot);
      body.scrollTop = scroll;
    }
    layoutBody();
    body.addEventListener("scroll", () => { scroll = body.scrollTop; });
    panel.body = body; panel.img = img;
  }
  // _wb_match_step: light the step her sentence is about, and keep it in view.
  function lightStep(next) {
    if (!(panel && panelOpen) || next === step || next < -1) return;
    step = next;
    if (panel.img) panel.img.src = panel.columns[step + 1] || panel.columns[0];
    const span = panel.spans[step];
    if (span && panel.body) {
      const [top, bottom] = span;
      if (top < panel.body.scrollTop) panel.body.scrollTop = top - 6;
      else if (bottom > panel.body.scrollTop + panel.body.clientHeight) panel.body.scrollTop = bottom - panel.body.clientHeight + 6;
    }
  }

  // ----- talking: Ask Liza, and the microphone -----
  function language() {
    const [text, who] = caption;
    return who === "user" && DEVANAGARI.test(text) ? "hi" : "en";
  }

  function askLiza(what = null) {
    if (!hasInk()) return hint("Write or draw something first, then tap Ask Liza.");
    turn({ boardAsk: what || "ask" });
  }

  async function speak() {
    listener.prime();
    if (state === "listening") { listener.finishNow(); return; }
    speaker.stop();
    if (controller) controller.abort();
    setState("listening");
    listener.onLevel = (v) => { const m = bar.querySelector(".wb2-mic"); if (m) m.style.boxShadow = v > 0 ? `0 0 0 ${2 + Math.round(v * 7)}px rgba(20,184,166,.45)` : ""; };
    let audio = null;
    try { audio = await listener.listen({ startTimeoutMs: 8000, endSilenceMs: 900, maxMs: 25000 }); }
    catch (_) { setState("idle"); hint("Allow the microphone, or tap Ask Liza."); return; }
    finally { listener.onLevel = () => {}; }
    if (!audio || !alive) { setState("idle"); return; }
    turn({ audio });
  }

  async function turn({ audio = null, boardAsk = "" }) {
    if (controller) controller.abort();
    speaker.stop();
    const mine = new AbortController();
    controller = mine;
    setState("thinking");
    offers = [];
    const sentences = [];
    let sentenceSteps = null;
    speaker.onStart = (item) => {
      if (!alive) return;
      setState("speaking");
      setCaption(item.text, "liza");
      const i = sentences.indexOf(item.text);
      if (sentenceSteps && i >= 0) lightStep(sentenceSteps[i]);
    };
    try {
      await api.turn({ profileId: profile.id, mode: mode(), text: "", audio, boardAsk,
        boardStrokes: hasInk() ? frozen() : null, signal: mine.signal }, (ev) => {
        if (mine !== controller) return;
        if (ev.type === "heard" && ev.text) setCaption(ev.text, "user");
        else if (ev.type === "sentence") { sentences.push(ev.text); speaker.say(ev.text); }
        else if (ev.type === "panel") {
          panel = { ...ev }; sentenceSteps = ev.sentence_steps; step = -1; scroll = 0;
          graphOpen = false; panelBox = pickSide(); panelOpen = true;
          drawToolbar(); drawOverlay();
        } else if (ev.type === "visual" && ev.graph) setGraph(ev.graph);
        else if (ev.type === "visual") onVisual(ev, true);
        else if (ev.type === "offers") { offers = ev.offers || []; drawOverlay(); }
        else if (ev.type === "do") {
          if (ev.action === "board_close") closeBoard();
          else onDo(ev.action, ev.param);
        } else if (ev.type === "status") hint(ev.text);
      });
    } catch (err) {
      if (err.name === "AbortError") return;
      setState("idle");
      hint(err.message || "Something went wrong. Try again.");
      return;
    }
    if (mine !== controller) return;
    controller = null;
    await speaker.finished();
    if (alive && state !== "listening") setState("idle");
  }

  function closeBoard() {
    alive = false;
    clearTimeout(readTimer); clearTimeout(hintTimer);
    if (controller) controller.abort();
    listener.cancel();
    speaker.stop();
    root.remove();
  }

  drawToolbar();
  drawBar();
  drawOverlay();
  return closeBoard;
}

function mix(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * 0.4 + 255 * 0.6));
  return `rgb(${c.join(",")})`;
}
