// The live graph (ui.py show_graph / _draw_graph): a white card with the
// formula as its heading, a grid with nice ticks, the axes, one curve per
// formula in its colour, and a slider per number in it. Dragging a slider asks
// the server (the device's own visuals.sample) for the curve at that value;
// the window stays put while it moves, so the change is what you see.

import * as api from "./api.js";

const SIZES = {
  small: { corner: 10, title: 14, heading: 7, pad: 8, label: 20, axis: 6, line: 2, legend: 13, legendFont: 7, row: 20, knob: 6, track: 4, name: 7, readout: 34, edge: 10 },
  card: { corner: 16, title: 34, heading: 12, pad: 12, label: 26, axis: 8, line: 3, legend: 20, legendFont: 10, row: 32, knob: 10, track: 6, name: 11, readout: 46, edge: 14 },
  big: { corner: 16, title: 30, heading: 12, pad: 26, label: 34, axis: 9, line: 4, legend: 26, legendFont: 12, row: 38, knob: 11, track: 7, name: 11, readout: 62, edge: 30 },
};
const PT = 1.333;
const GRID = "#EDF1FA", AXIS = "#98A4BE", DIM = "#8891A8", TEXT = "#1E2233", INDIGO = "#6366F1", TRACK = "#E6E9F5";
const NS = "http://www.w3.org/2000/svg";

let measureCtx = null;
function textWidth(words, pt, bold) {
  measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
  measureCtx.font = `${bold ? 700 : 400} ${pt * PT}px Noto Sans, sans-serif`;
  return measureCtx.measureText(words).width;
}
function ellipsize(words, pt, bold, room) {
  if (textWidth(words, pt, bold) <= room) return words;
  while (words.length > 1 && textWidth(`${words}…`, pt, bold) > room) words = words.slice(0, -1);
  return `${words}…`;
}

// ui.py _nice_ticks
function niceTicks(low, high, count = 4) {
  const span = high - low;
  if (span <= 0) return [low];
  const rough = Math.max(span / count, 1e-12);
  const power = 10 ** Math.floor(Math.log10(rough));
  let step = power;
  for (const m of [1, 2, 2.5, 5, 10]) { step = m * power; if (span / step <= count + 1) break; }
  const ticks = [];
  for (let v = Math.ceil(low / step) * step; v <= high + step * 0.01; v += step) {
    ticks.push(Math.abs(v) < step * 1e-6 ? 0 : +v.toPrecision(12));
  }
  return ticks;
}
const fmt = (v) => String(+(+v).toPrecision(6));

// One shared state per graph, drawn into any number of views (the board,
// the big view, the card on the whiteboard), as ui.py's graph["views"].
export class LiveGraph {
  constructor(data) {
    this.data = data;
    this.values = [...data.values];
    this.views = new Set();
    this.inFlight = false;
    this.queued = false;
  }

  // Draw into `parent` at box [x0,y0,x1,y1]; returns the view's element.
  draw(parent, box, size, { onEnlarge = null, onClose = null } = {}) {
    const view = { parent, box, size, onEnlarge, onClose };
    view.el = document.createElement("div");
    view.el.className = "gc-view";
    parent.appendChild(view.el);
    this.views.add(view);
    this.paint(view);
    return view;
  }

  forget(view) { this.views.delete(view); if (view.el) view.el.remove(); }

  repaintAll() { for (const v of [...this.views]) { if (!v.el.isConnected) { this.views.delete(v); continue; } this.paint(v); } }

  paint(view) {
    const d = this.data;
    const m = SIZES[view.size];
    const [x0, y0, x1, y1] = view.box;
    const W = x1 - x0, H = y1 - y0;
    Object.assign(view.el.style, { position: "absolute", left: `${x0}px`, top: `${y0}px`, width: `${W}px`, height: `${H}px` });
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", W); svg.setAttribute("height", H);
    const add = (tag, attrs, words) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (words !== undefined) n.textContent = words;
      svg.appendChild(n); return n;
    };
    const text = (x, y, words, pt, { bold = false, fill = TEXT, anchor = "start" } = {}) =>
      add("text", { x, y, "dominant-baseline": "central", "text-anchor": anchor, fill,
        "font-size": pt * PT, "font-weight": bold ? 700 : 400, "font-family": "Noto Sans, sans-serif" }, words);
    add("rect", { x: 1, y: 1, width: W - 2, height: H - 2, rx: m.corner, fill: "#FFFFFF",
      stroke: view.size === "card" ? "#C7D2FE" : "#D8E0F0", "stroke-width": view.size === "card" ? 2 : 1 });
    let top = m.pad / 2;
    const heading = d.heading || "";
    if (view.size === "card") {
      text(16, m.title / 2 + 2, ellipsize(heading || "Graph", m.heading, true, W - 110), m.heading, { bold: true, fill: INDIGO });
      top = m.title;
    } else if (heading) {
      text(W / 2, m.title / 2 + 2, ellipsize(heading, m.heading, true, W - 44), m.heading, { bold: true, fill: INDIGO, anchor: "middle" });
      top = m.title;
    }
    const curves = d.curves;
    if (curves.length > 1) {
      const swatch = m.legend < 16 ? 14 : 20, gap = 14;
      let x = m.edge, y = top + m.legend / 2, lines = 1;
      for (const c of curves) {
        const words = ellipsize(c.label, m.legendFont, true, W - 2 * m.edge - swatch - 6);
        const width = swatch + 6 + textWidth(words, m.legendFont, true);
        if (x > m.edge && x + width > W - m.edge) { if (lines === 2) break; x = m.edge; y += m.legend; lines += 1; }
        add("line", { x1: x, y1: y, x2: x + swatch, y2: y, stroke: c.colour, "stroke-width": Math.max(2, m.line), "stroke-linecap": "round" });
        text(x + swatch + 6, y, words, m.legendFont, { bold: true, fill: c.colour });
        x += width + gap;
      }
      top += lines * m.legend;
    }
    const knobs = d.knobs;
    const plot = [m.pad + m.label, top + m.pad / 2, W - m.pad, H - m.pad - m.label / 2 - knobs.length * m.row];
    const [px0, py0, px1, py1] = plot;
    const [left, right, low, high] = d.window;
    const sx = (x) => px0 + (x - left) / (right - left) * (px1 - px0);
    const sy = (y) => py1 - (y - low) / (high - low) * (py1 - py0);
    const xTicks = d.x_ticks || niceTicks(left, right).map((v) => [v, fmt(v)]);
    for (const [v, words] of xTicks) {
      add("line", { x1: sx(v), y1: py0, x2: sx(v), y2: py1, stroke: GRID });
      text(sx(v), py1 + m.axis + 1, words, m.axis, { fill: DIM, anchor: "middle" });
    }
    for (const v of niceTicks(low, high)) {
      add("line", { x1: px0, y1: sy(v), x2: px1, y2: sy(v), stroke: GRID });
      text(px0 - 3, sy(v), fmt(v), m.axis, { fill: DIM, anchor: "end" });
    }
    if (low <= 0 && 0 <= high) add("line", { x1: px0, y1: sy(0), x2: px1, y2: sy(0), stroke: AXIS });
    if (left <= 0 && 0 <= right) add("line", { x1: sx(0), y1: py0, x2: sx(0), y2: py1, stroke: AXIS });
    // _graph_curve: unbroken runs, the pen lifted at a hole, clipped at the plot's edge.
    for (const c of curves) {
      let runs = [];
      if (c.runs) {
        runs = c.runs.map((run) => run.filter(([x, y]) => x !== null && y !== null).map(([x, y]) => [sx(x), sy(y)]));
      } else {
        let run = [], edge = null;
        for (const [x, y] of c.points) {
          if (y === null || x === null) { if (run.length >= 2) runs.push(run); run = []; edge = null; continue; }
          const X = sx(x), Y = sy(y);
          if (py0 <= Y && Y <= py1) { if (!run.length && edge) run.push(edge); run.push([X, Y]); edge = null; continue; }
          edge = [X, Math.max(py0, Math.min(py1, Y))];
          if (run.length) { run.push(edge); if (run.length >= 2) runs.push(run); run = []; }
        }
        if (run.length >= 2) runs.push(run);
      }
      for (const run of runs) {
        if (run.length < 2) continue;
        add("polyline", { points: run.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" "), fill: "none",
          stroke: c.colour, "stroke-width": m.line, "stroke-linejoin": "round", "stroke-linecap": "round" });
      }
    }
    view.el.replaceChildren(svg);
    // The sliders (ui.py _draw_slider), one row each along the foot.
    const labelW = Math.max(24, ...knobs.map((k) => textWidth(k.label, m.name, true) + 14));
    knobs.forEach((knob, i) => {
      const rowTop = H - m.pad - (knobs.length - i) * m.row;
      const mid = rowTop + m.row / 2;
      const colour = knob.colour || INDIGO;
      const row = document.createElement("div");
      row.className = "gc-row";
      Object.assign(row.style, { left: `${m.edge}px`, top: `${rowTop}px`, width: `${W - 2 * m.edge}px`, height: `${m.row}px` });
      view.el.appendChild(row);
      text(m.edge, mid, knob.label, m.name, { bold: true, fill: knob.colour ? colour : DIM });
      const t0 = m.edge + labelW, t1 = W - m.edge - m.readout;
      add("line", { x1: t0, y1: mid, x2: t1, y2: mid, stroke: TRACK, "stroke-width": m.track, "stroke-linecap": "round" });
      const value = this.values[i];
      const f = Math.max(0, Math.min(1, (value - knob.low) / (knob.high - knob.low)));
      add("circle", { cx: t0 + f * (t1 - t0), cy: mid, r: m.knob, fill: colour, stroke: "#FFFFFF", "stroke-width": 2 });
      text(W - m.edge, mid, fmt(value), m.name, { bold: true, anchor: "end" });
      const drag = (e) => {
        const r = view.el.getBoundingClientRect();
        const scale = r.width / W;
        const x = (e.clientX - r.left) / scale;
        const frac = Math.max(0, Math.min(1, (x - t0) / Math.max(1, t1 - t0)));
        let v = knob.low + frac * (knob.high - knob.low);
        v = Math.round(Math.round(v / knob.step) * knob.step * 1e6) / 1e6;
        if (v !== this.values[i]) { this.values[i] = v; this.refresh(); }
      };
      row.addEventListener("pointerdown", (e) => { row.setPointerCapture(e.pointerId); drag(e); e.stopPropagation(); });
      row.addEventListener("pointermove", (e) => { if (e.buttons) drag(e); });
    });
    if (view.size === "small" && view.onEnlarge) {
      const icon = document.createElement("div");
      icon.className = "bv-expand gc-icon";
      Object.assign(icon.style, { right: "6px", top: "6px" });
      icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B3F8F" stroke-width="2.4"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
      icon.addEventListener("click", view.onEnlarge);
      view.el.appendChild(icon);
    }
    if (view.onClose) {
      const close = document.createElement("div");
      close.className = "bv-close gc-close";
      close.textContent = "✕";
      close.addEventListener("click", view.onClose);
      view.el.appendChild(close);
    }
  }

  // A slider moved: draw the knob at once, the curve when the server answers.
  async refresh() {
    this.repaintAll();
    if (this.inFlight) { this.queued = true; return; }
    this.inFlight = true;
    try {
      const fresh = await api.send("POST", "/api/graph", { payload: this.data.payload, kind: this.data.kind || "graph",
        values: this.values, window: this.data.window });
      this.data = { ...fresh, window: this.data.window };
    } catch (_) { /* keep the last curve */ }
    this.inFlight = false;
    if (this.queued) { this.queued = false; return this.refresh(); }
    this.repaintAll();
  }

  // ON_BOARD / LAST_GRAPH for her: the formula with the slider values in it.
  describe() { return this.data.describe; }
}
