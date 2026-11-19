// The geometry lab, as ui.py draws it (show_geometry and the _geo_* section):
// a solid or a flat figure that turns under a finger, where a tap on edge AE
// and then on face ABCD says AE is perpendicular to it and draws the right
// angle where they meet; where three corners tapped are cut through, and a
// triangle's corner dragged changes its angles while they go on adding up to
// 180°.
//
// Every corner, edge and face is drawn here at a place on the 800x480 stage
// this knows exactly, so a tap is a pick, matched as _geo_hit matches it. The
// measuring is the device's own geometry.py, on the server (/api/geometry/
// measure): what the picks measure, the marks drawn on the figure, the facts.
// Like the device there are two views of one figure: small on the board, and
// the lab over everything.

import * as api from "./api.js";
import { at, h } from "./ui.js";

const UI_W = 800, UI_H = 480;
const TOP = 52, BOTTOM = 432;          // GEO_TOP, GEO_BOTTOM
const SPLIT = 522;                     // GEO_SPLIT: the figure left, the readings right
const DRAG_DEG = 0.5;                  // GEO_DRAG_DEG
const FACE = "#DCE7FF", EDGE = "#1E293B", HIDDEN = "#94A3B8";
const COL_BG = "#F3F5FD", COL_FRAME = "#E1E5F4", COL_TEXT = "#1E2233", COL_TEXT_DIM = "#8891A8";
const COL_INDIGO = "#6366F1", COL_STOP = "#F43F5E", SPEAKING = "#EC4899";
const PICK_COLOURS = ["#DC2626", "#2563EB", "#059669"];   // geometry.PICK_COLOURS
const MAX_PICKS = 3;
const HINT_3D = "Drag to turn it. Tap a corner, an edge or a face; tap two to see how "
  + "they meet; tap three corners to cut through them.";
const HINT_FLAT = "Drag a corner to change the shape. Tap a corner for its angle, two "
  + "sides for the angle between them, two corners for a diagonal.";
const ICON_R = 15, ICON_GLYPH = 9, ICON_ARM = 6;
const PT = 1.3375;                     // Tk points to pixels on the device
const FONT = "\"Noto Sans\", \"Noto Sans Devanagari\", sans-serif";
const NS = "http://www.w3.org/2000/svg";
const DEVANAGARI = /[ऀ-ॿ]/;

// ---------------------------------------------------------------- drawing helpers
function hex(c) { return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); }
// ui.py _mix
function mix(colour, target, t) {
  t = Math.max(0, Math.min(1, t));
  const a = hex(colour), b = hex(target);
  return "#" + a.map((v, i) => Math.trunc(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function px(pt) { return pt * PT; }
function lineHeight(pt) { const p = px(pt); return Math.ceil(1.069 * p) + Math.ceil(0.293 * p); }
let measureCtx = null;
function textWidth(words, pt, bold) {
  measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
  measureCtx.font = `${bold ? 700 : 400} ${px(pt)}px ${FONT}`;
  return measureCtx.measureText(words).width;
}
function ellipsize(words, pt, bold, room) {
  if (textWidth(words, pt, bold) <= room) return words;
  while (words && textWidth(`${words}…`, pt, bold) > room) words = words.slice(0, -1);
  return `${words}…`;
}
function s(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}
const pts = (list) => list.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
// A Tk smooth polygon (ui.py _round_rect): a quadratic curve round each
// corner from the middle of one side to the middle of the next.
function tkSmooth(points) {
  const n = points.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let d = "";
  for (let i = 0; i < n; i++) {
    const p = points[i], a = mid(points[(i - 1 + n) % n], p), b = mid(p, points[(i + 1) % n]);
    d += (i ? "L" : "M") + `${a[0]},${a[1]} Q${p[0]},${p[1]} ${b[0]},${b[1]} `;
  }
  return d + "Z";
}
function roundRect(x0, y0, x1, y1, r, attrs) {
  const p = [[x0 + r, y0], [x1 - r, y0], [x1, y0], [x1, y0 + r], [x1, y1 - r], [x1, y1],
    [x1 - r, y1], [x0 + r, y1], [x0, y1], [x0, y1 - r], [x0, y0 + r], [x0, y0]];
  return s("path", { d: tkSmooth(p), ...attrs });
}
// create_text, centred (Tk's default anchor) or at its west edge.
function label(x, y, words, pt, bold, fill, anchor = "middle") {
  return s("text", { x, y, fill, "font-size": px(pt), "font-weight": bold ? 700 : 400,
    "font-family": FONT, "text-anchor": anchor, "dominant-baseline": "central" }, words);
}
function line(coords, attrs) {
  const p = [];
  for (let i = 0; i < coords.length; i += 2) p.push([coords[i], coords[i + 1]]);
  return s("polyline", { points: pts(p), fill: "none", ...attrs });
}

// ---------------------------------------------------------------- vectors
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function unit(a) { const n = Math.hypot(...a); return n > 1e-12 ? a.map((v) => v / n) : [0, 0, 0]; }
// geometry._normal: Newell's normal, outwards for the server's oriented faces.
function newell(points) {
  const n = [0, 0, 0];
  points.forEach(([x0, y0, z0], i) => {
    const [x1, y1, z1] = points[(i + 1) % points.length];
    n[0] += (y0 - y1) * (z0 + z1);
    n[1] += (z0 - z1) * (x0 + x1);
    n[2] += (x0 - x1) * (y0 + y1);
  });
  return unit(n);
}
const samePick = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- the lab
export class GeoLab {
  // data: the server's figure (geolab.build); screen: the home screen element;
  // onAsk(question): Ask Liza was tapped; onClose(): the lab went back to the board.
  constructor(screen, data, { onAsk, onChange } = {}) {
    this.screen = screen;
    this.onAsk = onAsk;
    this.onChange = onChange;
    this.payload = data.payload;
    this.fig = data.figure;
    this.points = this.fig.points.map((p) => [...p]);
    this.ask = { name: data.ask_name, ask: data.ask, about: data.about };
    this.reading = data;
    this.picks = data.picks || [];
    this.flat = this.fig.flat;
    this.yaw = this.flat ? 0 : -32;
    this.pitch = this.flat ? 0 : 22;
    this.big = null;
    this.press = null;
    this.frozen = null;
    this.reshaped = false;
    this.caption = ["", "hint"];
    this.lastUser = "";
    this.inFlight = false;
    this.queued = false;
    this.job = null;
  }

  get title() { return this.reading.title || this.fig.name; }

  // What the page tells the server about the lab with each question: enough
  // to build the figure again, what is picked, and whether it is open.
  state() {
    const out = { payload: this.payload, picks: this.picks, reshaped: this.reshaped, open: !!this.big };
    if (this.reshaped) out.points = this.points;
    return out;
  }

  describe() { return this.reading.describe || this.title; }

  // ui.py geometry_pick: point at these parts (null keeps what is picked);
  // opens the lab if it was shut.
  point(picks, smallLayer = null) {
    if (picks) {
      this.picks = picks.slice(0, MAX_PICKS);
      this.refresh();
    }
    if (this.big) this.redraw();
    else this.open();
  }

  // ---- what the server measures ----
  // One request at a time; touches that come in meanwhile are folded into
  // the next one. A reading for the picks still up is taken even mid-drag.
  async refresh() {
    if (this.inFlight) { this.queued = true; return; }
    this.inFlight = true;
    try {
      const body = { payload: this.payload, picks: this.picks, reshaped: this.reshaped };
      if (this.reshaped) body.points = this.points.map((p) => [...p]);
      const done = await api.send("POST", "/api/geometry/measure", body);
      if (samePick(body.picks, this.picks)) {
        this.reading = done;
        this.picks = done.picks;
        if (this.onChange) this.onChange(this);
        if (this.big) this.redraw();
        else if (this.small) this.drawSmall();
      }
    } catch (err) {
      console.error(err);
    } finally {
      this.inFlight = false;
      if (this.queued) { this.queued = false; this.refresh(); }
    }
  }

  // ---- seeing it from where the finger has turned it ----
  view(box, small) {
    if (this.frozen && !small) return this.frozen;
    const [x0, y0, x1, y1] = box;
    const p = this.points;
    const low = [0, 1, 2].map((k) => Math.min(...p.map((q) => q[k])));
    const high = [0, 1, 2].map((k) => Math.max(...p.map((q) => q[k])));
    const centre = [0, 1, 2].map((k) => (low[k] + high[k]) / 2);
    let scale;
    if (this.flat) {
      const width = Math.max(high[0] - low[0], 1e-6), height = Math.max(high[1] - low[1], 1e-6);
      scale = Math.min((x1 - x0) * 0.7 / width, (y1 - y0) * 0.68 / height);
    } else {
      const radius = Math.max(...p.map((q) => Math.hypot(q[0] - centre[0], q[1] - centre[1], q[2] - centre[2]))) || 1;
      scale = Math.min(x1 - x0, y1 - y0) * 0.43 / radius;
    }
    return { centre, scale, mid: [(x0 + x1) / 2, (y0 + y1) / 2],
      yaw: this.yaw * Math.PI / 180, pitch: this.pitch * Math.PI / 180 };
  }

  static turn(view, [x, y, z]) {
    const { yaw, pitch } = view;
    [x, z] = [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)];
    [y, z] = [y * Math.cos(pitch) - z * Math.sin(pitch), y * Math.sin(pitch) + z * Math.cos(pitch)];
    return [x, y, z];
  }

  project(view, p) {
    const [cx, cy, cz] = view.centre;
    const [x, y, z] = GeoLab.turn(view, [p[0] - cx, p[1] - cy, p[2] - cz]);
    return [view.mid[0] + x * view.scale, view.mid[1] - y * view.scale, z];
  }

  colours() {
    const out = new Map();
    this.picks.forEach((p, i) => out.set(JSON.stringify(p), PICK_COLOURS[i % PICK_COLOURS.length]));
    return (pick) => out.get(JSON.stringify(pick));
  }

  // ui.py _geo_draw_figure: the figure, its picks and what they measure, into
  // `box` of the svg `g`. Returns where everything landed, for _geo_hit.
  drawFigure(g, box, small) {
    const fig = this.fig;
    const view = this.view(box, small);
    const screen = this.points.map((p) => this.project(view, p));
    const faces = fig.faces;
    const normals = faces.map((f) => newell(f.map((i) => this.points[i])));
    const visible = this.flat ? faces.map(() => true)
      : normals.map((n) => GeoLab.turn(view, n)[2] > 1e-6);
    const colourOf = this.colours();
    const marks = this.reading.marks || [];
    const light = [-0.35, 0.75, 0.55];
    const flat = (indices) => indices.flatMap((i) => screen[i].slice(0, 2));

    const order = faces.map((_, k) => k).sort((a, b) =>
      faces[a].reduce((t, i) => t + screen[i][2], 0) / faces[a].length
      - faces[b].reduce((t, i) => t + screen[i][2], 0) / faces[b].length);
    for (const k of order) {
      if (!visible[k]) continue;
      const group = fig.face_groups[k];
      const picked = colourOf(group ? ["surface", group] : ["face", k]);
      let fill;
      if (picked) fill = mix(picked, "#FFFFFF", 0.72);
      else if (this.flat) fill = "#EEF2FF";
      else {
        const n = GeoLab.turn(view, normals[k]);
        const bright = Math.max(0, dot(n, light));
        fill = mix(FACE, "#FFFFFF", 0.15 + 0.55 * bright);
      }
      // Outlined in its own colour: anti-aliasing would otherwise leave a
      // hairline between the strips of a curved surface (Tk draws none).
      g.appendChild(s("polygon", { points: pts(faces[k].map((i) => screen[i])), fill,
        stroke: fill, "stroke-width": 1, "stroke-linejoin": "round" }));
    }
    for (const mark of marks) {
      if (mark[0] !== "polygon") continue;
      g.appendChild(s("polygon", { points: pts(mark[1].map((p) => this.project(view, p))),
        fill: mix(mark[2], "#FFFFFF", 0.35), "fill-opacity": 0.5, stroke: mark[2], "stroke-width": 2 }));
    }
    // Edges: solid where they can be seen, dashed where they are behind.
    for (const [a, b, beside, smooth, group] of fig.edges) {
      const seen = this.flat || beside.some((k) => visible[k]);
      if (smooth) {
        if (beside.length === 2 && visible[beside[0]] !== visible[beside[1]]) {
          g.appendChild(line(flat([a, b]), { stroke: EDGE, "stroke-width": small ? 1 : 2 }));
        }
        continue;
      }
      const picked = colourOf(group ? ["rim", group] : ["edge", a, b]);
      if (picked) {
        g.appendChild(line(flat([a, b]), { stroke: picked, "stroke-width": small ? 3 : 5,
          "stroke-dasharray": seen ? null : "7 4", "stroke-linecap": "round" }));
      } else if (seen) {
        g.appendChild(line(flat([a, b]), { stroke: EDGE, "stroke-width": small ? 1.5 : 2.5,
          "stroke-linecap": "round" }));
      } else {
        g.appendChild(line(flat([a, b]), { stroke: HIDDEN, "stroke-width": small ? 1 : 1.5,
          "stroke-dasharray": "5 4" }));
      }
    }
    // A round solid's radius and height, and what the picks drew.
    fig.guides.forEach(([, a, b], gi) => {
      const picked = colourOf(["guide", gi]);
      g.appendChild(line(flat([a, b]), { stroke: picked || "#64748B",
        "stroke-width": picked ? (small ? 3 : 4) : 1.5, "stroke-dasharray": picked ? null : "4 3" }));
    });
    const centre = view.centre;
    const arcSize = (Math.max(...this.points.map((p) =>
      Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]))) || 1) * 0.16;
    const placed = [];
    for (const mark of marks) {
      if (mark[0] === "segment") {
        const [, p, q, colour, dashed] = mark;
        g.appendChild(line([...this.project(view, p).slice(0, 2), ...this.project(view, q).slice(0, 2)],
          { stroke: colour, "stroke-width": small ? 2 : 3, "stroke-dasharray": dashed ? "6 4" : null,
            "stroke-linecap": "round" }));
      } else if (mark[0] === "arc" && !small) {
        this.drawArc(g, view, mark, arcSize, placed);
      }
    }
    // The corners, lettered, the letters pushed out from the middle.
    const [mx, my] = view.mid;
    for (const i of fig.corners) {
      const name = fig.labels[i];
      const [sx, sy] = screen[i];
      const beside = faces.map((f, k) => (f.includes(i) ? k : -1)).filter((k) => k >= 0);
      const seen = this.flat || !beside.length || beside.some((k) => visible[k]);
      const picked = colourOf(["vertex", i]);
      const r = small ? (picked ? 5 : 3) : (picked ? 8 : 4.5);
      g.appendChild(s("circle", { cx: sx, cy: sy, r, fill: picked || (seen ? EDGE : HIDDEN),
        stroke: picked ? "#FFFFFF" : "none", "stroke-width": 2 }));
      if (name) {
        const dx = sx - mx, dy = sy - my;
        const away = Math.hypot(dx, dy) || 1;
        const push = small ? 11 : 19;
        g.appendChild(label(sx + dx / away * push, sy + dy / away * push, name, small ? 8 : 13, true,
          picked || (seen ? COL_TEXT : COL_TEXT_DIM)));
      }
    }
    if (this.flat && !small && fig.kind === "flat" && fig.edges.length <= 16 && faces[0].length <= 10) {
      // A flat figure's sides, measured where they are -- each once.
      for (const [a, b] of fig.edges) {
        const [ax, ay] = screen[a], [bx, by] = screen[b];
        let ex = ay - by, ey = bx - ax;
        if (ex * ((ax + bx) / 2 - mx) + ey * ((ay + by) / 2 - my) < 0) { ex = -ex; ey = -ey; }
        const away = Math.hypot(ex, ey) || 1;
        const pa = this.points[a], pb = this.points[b];
        const length = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
        g.appendChild(label((ax + bx) / 2 + ex / away * 16, (ay + by) / 2 + ey / away * 16,
          number(length), 9, false, COL_TEXT_DIM));
      }
    }
    return { points: screen, visible, order, view };
  }

  // ui.py _geo_draw_arc: an arc between the two arms -- or the little square
  // of a right angle -- and its size beside it.
  drawArc(g, view, mark, size, placed) {
    const [, centre, u, v, colour, words, facing] = mark;
    if (facing && !this.flat && GeoLab.turn(view, facing)[2] < -0.05) return;
    const d = dot(u, v);
    let w = u.map((a, k) => v[k] - d * a);
    const length = Math.hypot(...w);
    if (length < 1e-9) return;
    w = w.map((x) => x / length);
    const theta = Math.acos(Math.max(-1, Math.min(1, d)));
    const at3 = (t, r) => this.project(view, centre.map((c, k) =>
      c + r * (Math.cos(t) * u[k] + Math.sin(t) * w[k]))).slice(0, 2);
    if (Math.abs(theta * 180 / Math.PI - 90) < 0.5) {
      const q = size * 0.6;
      const corner = [centre.map((c, k) => c + q * u[k]), centre.map((c, k) => c + q * u[k] + q * w[k]),
        centre.map((c, k) => c + q * w[k])];
      g.appendChild(line(corner.flatMap((p) => this.project(view, p).slice(0, 2)), { stroke: colour, "stroke-width": 2 }));
    } else {
      const arc = [];
      for (let i = 0; i <= 16; i++) arc.push(...at3(theta * i / 16, size));
      g.appendChild(line(arc, { stroke: colour, "stroke-width": 2 }));
    }
    const reach = 1.9 + Math.max(0, (50 - theta * 180 / Math.PI) / 50) * 1.8;
    const half = textWidth(words, 10, true) / 2 + 5;
    let lx, ly, box;
    for (const extra of [0, 0.8, 1.6, 2.4, 3.2]) {
      [lx, ly] = at3(theta / 2, size * (reach + extra));
      box = [lx - half - 2, ly - 12, lx + half + 2, ly + 12];
      if (!placed.some((b) => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) break;
    }
    placed.push(box);
    g.appendChild(roundRect(lx - half, ly - 10, lx + half, ly + 10, 8,
      { fill: "#FFFFFF", stroke: mix(colour, "#FFFFFF", 0.5) }));
    g.appendChild(label(lx, ly, words, 10, true, colour));
  }

  // ---- on the board (ui.py _geo_draw_small) ----
  // layer: the board's layer; box: VISUAL_BOX.
  drawSmall(layer = this.small?.layer, box = this.small?.box) {
    if (!layer) return;
    if (this.small?.el) this.small.el.remove();
    const [x0, y0, x1, y1] = box;
    const svg = s("svg", { viewBox: `${x0} ${y0} ${x1 - x0} ${y1 - y0}`, width: x1 - x0, height: y1 - y0, class: "geo-small" });
    svg.appendChild(roundRect(x0, y0, x1, y1, 10, { fill: "#FFFFFF", stroke: "#D8E0F0" }));
    svg.appendChild(label(x0 + 12, y0 + 12, ellipsize(this.title, 8, true, x1 - x0 - 60), 8, true,
      COL_INDIGO, "start"));
    const g = s("g");
    svg.appendChild(g);
    this.drawFigure(g, [x0 + 6, y0 + 22, x1 - 6, y1 - 6], true);
    svg.appendChild(expandIcon(x1 - 17, y0 + 17));
    svg.addEventListener("click", () => this.open());
    const el = at(svg, x0, y0, x1 - x0, y1 - y0);
    layer.appendChild(el);
    this.small = { layer, box, el };
  }

  // ---- the lab (ui.py _geo_open, _geo_draw_big) ----
  open() {
    if (this.big) return;
    injectStyle();
    const el = h("div", { class: "geo-big" });
    this.big = el;
    const svg = s("svg", { viewBox: `0 0 ${UI_W} ${UI_H}`, width: UI_W, height: UI_H, class: "geo-fig" });
    svg.appendChild(s("rect", { x: 0, y: 0, width: UI_W, height: UI_H, fill: "#FFFFFF" }));
    this.figLayer = s("g");
    svg.appendChild(this.figLayer);
    el.appendChild(at(svg, 0, 0, UI_W, UI_H));
    this.figSvg = svg;
    this.panelEl = at(h("div", { class: "geo-panel" }), SPLIT, TOP + 2, UI_W - SPLIT, BOTTOM - TOP - 2);
    this.topEl = at(h("div", { class: "geo-top" }), 0, 0, UI_W, TOP + 1);
    this.barEl = at(h("div", { class: "geo-bar" }), 0, BOTTOM - 1, UI_W, UI_H - BOTTOM + 1);
    el.append(this.panelEl, this.topEl, this.barEl);
    this.screen.appendChild(el);
    this.bindFinger(svg);
    this.redraw();
    this.drawBar();
    if (this.onChange) this.onChange(this);
  }

  close() {
    if (!this.big) return;
    this.big.remove();
    this.big = null;
    this.press = this.frozen = null;
    this.drawSmall();
    if (this.onChange) this.onChange(this);
  }

  // The figure and both views gone (ui.py _drop_geometry).
  drop() {
    if (this.big) this.big.remove();
    this.big = null;
    if (this.small?.el) this.small.el.remove();
    this.small = null;
    clearTimeout(this.job);
  }

  redraw(figureOnly = false) {
    if (!this.big) return;
    this.figLayer.replaceChildren();
    this.screenAt = this.drawFigure(this.figLayer, [0, TOP, SPLIT, BOTTOM], false);
    if (!figureOnly) {
      this.drawPanel();
      this.drawTop();
    }
  }

  schedule() {
    if (this.job) return;
    this.job = setTimeout(() => {
      this.job = null;
      this.redraw(!this.flat);
    }, 28);
  }

  drawTop() {
    const top = this.topEl;
    top.replaceChildren();
    const svg = s("svg", { viewBox: `0 0 ${UI_W} ${TOP + 1}`, width: UI_W, height: TOP + 1 });
    top.appendChild(svg);
    svg.appendChild(s("rect", { x: 0, y: 0, width: UI_W, height: TOP, fill: "#FFFFFF" }));
    svg.appendChild(s("line", { x1: 0, y1: TOP, x2: UI_W, y2: TOP, stroke: COL_FRAME, "stroke-width": 2 }));
    const cy = TOP / 2;
    svg.appendChild(label(16, cy, ellipsize(this.title, 13, true, (this.flat ? 480 : 486) - 16), 13, true,
      COL_INDIGO, "start"));
    const button = (x0, x1, words, command) => {
      const g = s("g", { class: "geo-tap" });
      g.appendChild(roundRect(x0, cy - 17, x1, cy + 17, 14, { fill: "#FFFFFF", stroke: COL_INDIGO, "stroke-width": 2 }));
      g.appendChild(label((x0 + x1) / 2, cy, words, 11, true, COL_INDIGO));
      g.addEventListener("pointerdown", (e) => { e.stopPropagation(); command(); });
      svg.appendChild(g);
    };
    if (!this.flat) button(514, 616, "Turn back", () => this.resetView());
    if (this.picks.length) button(626, 712, "Clear", () => this.clearPicks());
    const close = closeIcon(UI_W - 26, cy);
    close.classList.add("geo-tap");
    close.addEventListener("pointerdown", (e) => { e.stopPropagation(); setTimeout(() => this.close(), 0); });
    svg.appendChild(close);
  }

  // ui.py _geo_draw_panel: what the picks measure, in their colours -- or,
  // with nothing picked, what there is to know about the figure.
  drawPanel() {
    const panel = this.panelEl;
    panel.replaceChildren();
    const x0 = SPLIT, y0 = TOP + 2, x1 = UI_W, y1 = BOTTOM;
    const ox = x0, oy = y0;                  // the panel's own origin on the stage
    const svg = s("svg", { viewBox: `${x0} ${y0} ${x1 - x0} ${y1 - y0}`, width: x1 - x0, height: y1 - y0 });
    panel.appendChild(at(svg, 0, 0, x1 - x0, y1 - y0));
    svg.appendChild(s("rect", { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: "#F8FAFF" }));
    svg.appendChild(s("line", { x1: x0, y1: y0, x2: x0, y2: y1, stroke: COL_FRAME, "stroke-width": 2 }));
    const left = x0 + 16, width = x1 - x0 - 30;
    const askTop = y1 - 52;
    let y = y0 + 12;
    let lines;
    const names = this.reading.names || [];
    const fresh = samePick(this.reading.picks || [], this.picks);
    if (this.picks.length) {
      let x = left;
      this.picks.forEach((pick, i) => {
        const colour = PICK_COLOURS[i % PICK_COLOURS.length];
        const words = (fresh ? names[i] : null) || this.elementName(pick);
        const chip = textWidth(words, 10, true) + 22;
        if (x + chip > x1 - 12) { x = left; y += 30; }
        svg.appendChild(roundRect(x, y, x + chip, y + 24, 12, { fill: mix(colour, "#FFFFFF", 0.85),
          stroke: colour, "stroke-width": 2 }));
        svg.appendChild(label(x + chip / 2, y + 12, words, 10, true, colour));
        x += chip + 6;
      });
      y += 34;
      lines = fresh ? (this.reading.lines || []) : [];
    } else {
      lines = (this.reading.facts || []).map((text, i) => [text, null, i === 0]);
    }
    const text = (tx, ty, words, pt, bold, colour) => {
      const div = h("div", { class: "geo-text", text: words });
      Object.assign(div.style, { font: `${bold ? 700 : 400} ${px(pt)}px/${lineHeight(pt)}px ${FONT}`,
        color: colour, width: `${width}px` });
      panel.appendChild(at(div, tx - ox, ty - oy));
      return div;
    };
    for (const [words, colour, bold] of lines) {
      if (y > askTop - 18) {
        text(left, y, "…", 10, true, COL_TEXT_DIM);
        break;
      }
      const div = text(left, y, words, bold ? 11 : 10, bold, colour || (bold ? COL_TEXT : COL_TEXT_DIM));
      y += div.offsetHeight + (bold ? 8 : 5);
    }
    if (!this.picks.length) {
      const div = text(left, y + 4, this.flat ? HINT_FLAT : HINT_3D, 10, false, "#7C3AED");
      if (y + 4 + div.offsetHeight > askTop - 6) div.remove();
    }
    const ask = s("g", { class: "geo-tap" });
    ask.appendChild(roundRect(left, askTop, x1 - 14, y1 - 12, 18, { fill: COL_INDIGO, stroke: COL_INDIGO }));
    ask.appendChild(sparkle(left + 24, (askTop + y1 - 12) / 2, 7, "#FFFFFF"));
    ask.appendChild(label((left + x1 - 14) / 2 + 10, (askTop + y1 - 12) / 2,
      this.picks.length ? "Ask Liza about it" : "Ask Liza", 12, true, "#FFFFFF"));
    ask.addEventListener("pointerdown", (e) => { e.stopPropagation(); this.askLiza(); });
    svg.appendChild(ask);
  }

  // A pick's name before the server has said it (Figure.element_name).
  elementName(pick) {
    const L = this.fig.labels;
    if (pick[0] === "vertex") return `corner ${L[pick[1]]}`;
    if (pick[0] === "edge" || pick[0] === "segment") return L[pick[1]] + L[pick[2]];
    if (pick[0] === "guide") return this.fig.guides[pick[1]][0];
    if (pick[0] === "surface" || pick[0] === "rim") return pick[1];
    return "face";
  }

  // ui.py _geo_draw_bar: her words along the bottom while she talks.
  drawBar() {
    if (!this.big) return;
    const bar = this.barEl;
    bar.replaceChildren();
    const svg = s("svg", { viewBox: `0 ${BOTTOM - 1} ${UI_W} ${UI_H - BOTTOM + 1}`, width: UI_W, height: UI_H - BOTTOM + 1 });
    svg.appendChild(s("rect", { x: 0, y: BOTTOM, width: UI_W, height: UI_H - BOTTOM, fill: COL_BG }));
    svg.appendChild(s("line", { x1: 0, y1: BOTTOM, x2: UI_W, y2: BOTTOM, stroke: COL_FRAME, "stroke-width": 2 }));
    bar.appendChild(at(svg, 0, 0, UI_W, UI_H - BOTTOM + 1));
    let [words, who] = this.caption;
    if (!words) [words, who] = ["Pick something, then tap Ask Liza to hear why.", "hint"];
    const colour = { liza: SPEAKING, user: COL_INDIGO }[who] || COL_TEXT_DIM;
    const said = who === "hint" ? words : (who === "liza" ? "Liza: " : "You: ") + words;
    const div = h("div", { class: "geo-text geo-caption", text: said });
    Object.assign(div.style, { font: `400 ${px(11)}px/${lineHeight(11)}px ${FONT}`, color: colour,
      width: `${UI_W - 32}px`, maxHeight: `${lineHeight(11) * 2}px` });
    bar.appendChild(at(div, 16, (BOTTOM + UI_H) / 2 - (BOTTOM - 1)));
    bar.addEventListener("pointerdown", (e) => e.stopPropagation());
  }

  setCaption(text, who) {
    if (who === "user") this.lastUser = text;
    this.caption = [text, who];
    this.drawBar();
  }

  // ---- the finger (ui.py _geo_press, _geo_drag, _geo_release) ----
  bindFinger(svg) {
    const where = (e) => {
      const r = this.big.getBoundingClientRect();
      return [(e.clientX - r.left) * UI_W / r.width, (e.clientY - r.top) * UI_H / r.height];
    };
    svg.addEventListener("pointerdown", (e) => {
      const [x, y] = where(e);
      if (x > SPLIT || y < TOP || y > BOTTOM) return;
      svg.setPointerCapture(e.pointerId);
      this.pressAt(x, y);
    });
    svg.addEventListener("pointermove", (e) => { if (this.press) this.dragTo(...where(e)); });
    svg.addEventListener("pointerup", (e) => { if (this.press) this.releaseAt(...where(e)); });
    svg.addEventListener("pointercancel", () => { this.press = null; this.frozen = null; });
  }

  pressAt(x, y) {
    const press = { x, y, last: [x, y], moved: false, corner: null };
    if (this.flat && this.fig.kind === "flat" && this.screenAt) {
      const screen = this.screenAt.points;
      const near = this.fig.corners.filter((i) => this.fig.labels[i])
        .map((i) => [Math.hypot(screen[i][0] - x, screen[i][1] - y), i]).filter((n) => n[0] < 22);
      if (near.length) {
        press.corner = near.reduce((a, b) => (b[0] < a[0] ? b : a))[1];
        this.frozen = this.screenAt.view;
      }
    }
    this.press = press;
  }

  dragTo(x, y) {
    const press = this.press;
    if (!press.moved && Math.hypot(x - press.x, y - press.y) < 7) return;
    press.moved = true;
    if (this.flat) {
      if (press.corner !== null) {
        const view = this.frozen;
        const [mx, my] = view.mid;
        const sx = Math.min(Math.max(x, 20), SPLIT - 20);
        const sy = Math.min(Math.max(y, TOP + 20), BOTTOM - 20);
        this.points[press.corner] = [(sx - mx) / view.scale + view.centre[0],
          -(sy - my) / view.scale + view.centre[1], 0];
        // geometry.reshaped, on the server: its name now says only what it
        // is made of, and what kind it has become is worked out live.
        this.reshaped = true;
        this.refresh();
        this.schedule();
      }
      return;
    }
    const [lx, ly] = press.last;
    press.last = [x, y];
    this.yaw += (x - lx) * DRAG_DEG;
    this.pitch = Math.max(-85, Math.min(85, this.pitch + (y - ly) * DRAG_DEG));
    this.schedule();
  }

  releaseAt(x, y) {
    const press = this.press;
    this.press = null;
    const reshaped = press.moved && press.corner !== null;
    this.frozen = null;
    if (!press.moved) {
      const element = this.hit(x, y);
      if (element) {
        this.picks = addPick(this.picks, element);
        this.refresh();
        if (this.onChange) this.onChange(this);
      }
      this.redraw();
    } else if (reshaped) {
      this.refresh();
      this.redraw();
    }
  }

  // ui.py _geo_hit: a corner within a fingertip first, then the nearest
  // line, then the face in front.
  hit(x, y) {
    const fig = this.fig;
    const { points, visible, order } = this.screenAt;
    let best = null;
    for (const i of fig.corners) {
      if (!fig.labels[i]) continue;
      const d = Math.hypot(points[i][0] - x, points[i][1] - y);
      if (d < 18 && (!best || d < best[0])) best = [d, ["vertex", i]];
    }
    if (best) return best[1];
    const gap = (a, b) => {
      const [ax, ay] = points[a], [bx, by] = points[b];
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / Math.max(1e-9, dx * dx + dy * dy)));
      return Math.hypot(ax + t * dx - x, ay + t * dy - y);
    };
    for (const [a, b, beside, smooth, group] of fig.edges) {
      if (smooth) continue;
      const seen = this.flat || beside.some((k) => visible[k]);
      const d = gap(a, b) + (seen ? 0 : 3);
      if (d < 11 && (!best || d < best[0])) best = [d, group ? ["rim", group] : ["edge", a, b]];
    }
    fig.guides.forEach(([, a, b], gi) => {
      const d = gap(a, b);
      if (d < 11 && (!best || d < best[0])) best = [d, ["guide", gi]];
    });
    if (best) return best[1];
    for (const k of [...order].reverse()) {
      if (!visible[k]) continue;
      const ring = fig.faces[k].map((i) => points[i]);
      let inside = false;
      ring.forEach(([ax, ay], i) => {
        const [bx, by] = ring[(i + 1) % ring.length];
        if ((ay > y) !== (by > y) && x < ax + (y - ay) * (bx - ax) / (by - ay)) inside = !inside;
      });
      if (inside) {
        const group = fig.face_groups[k];
        return group ? ["surface", group] : ["face", k];
      }
    }
    return null;
  }

  resetView() {
    this.yaw = -32;
    this.pitch = 22;
    this.redraw();
  }

  clearPicks() {
    this.picks = [];
    this.refresh();
    if (this.onChange) this.onChange(this);
    this.redraw();
  }

  // ui.py _geo_ask: Ask Liza about what is picked, with what it measures in
  // the question.
  askLiza() {
    const said = this.caption[1] === "user" ? this.caption[0] : this.lastUser;
    const language = DEVANAGARI.test(said || "") ? "hi" : "en";
    const name = this.ask.name || this.fig.name.toLowerCase();
    let question;
    if (this.picks.length) {
      const fresh = samePick(this.reading.picks || [], this.picks);
      const names = fresh ? this.reading.names : this.picks.map((p) => this.elementName(p));
      question = ((this.ask.ask || {})[language] || this.ask.ask.en)
        .replace("{figure}", name).replace("{picks}", names.join(", "))
        .replace("{reading}", fresh ? this.reading.headline : "");
    } else {
      question = ((this.ask.about || {})[language] || this.ask.about.en).replace("{figure}", name);
    }
    if (this.onAsk) this.onAsk(question);
  }
}

// geometry.add_pick: added -- or taken away again if it was there; a fourth
// pick starts over.
function addPick(picks, element) {
  if (picks.some((p) => samePick(p, element))) return picks.filter((p) => !samePick(p, element));
  const out = [...picks, element];
  return out.length > MAX_PICKS ? [element] : out;
}

// geometry.number
function number(value) {
  return Math.abs(value) >= 0.005 ? value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") : "0";
}

// ui.py _expand_icon / _close_icon / _sparkle
function expandIcon(cx, cy) {
  const g = s("g");
  g.appendChild(roundRect(cx - ICON_R, cy - ICON_R, cx + ICON_R, cy + ICON_R, 8, { fill: "#FFFFFF", stroke: "#D8E0F0" }));
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = cx + ICON_GLYPH * sx, y = cy + ICON_GLYPH * sy;
    g.appendChild(line([x, y, x - ICON_ARM * sx, y], { stroke: COL_INDIGO, "stroke-width": 2, "stroke-linecap": "round" }));
    g.appendChild(line([x, y, x, y - ICON_ARM * sy], { stroke: COL_INDIGO, "stroke-width": 2, "stroke-linecap": "round" }));
  }
  return g;
}
function closeIcon(cx, cy) {
  const g = s("g");
  g.appendChild(roundRect(cx - ICON_R, cy - ICON_R, cx + ICON_R, cy + ICON_R, 8, { fill: "#FFFFFF", stroke: "#D8E0F0" }));
  const q = ICON_GLYPH - 1;
  for (const dx of [-1, 1]) {
    g.appendChild(line([cx - q * dx, cy - q, cx + q * dx, cy + q], { stroke: COL_STOP, "stroke-width": 3, "stroke-linecap": "round" }));
  }
  return g;
}
function sparkle(cx, cy, r, colour) {
  return s("polygon", { fill: colour, points: pts([[cx, cy - r], [cx + r * 0.3, cy - r * 0.3], [cx + r, cy],
    [cx + r * 0.3, cy + r * 0.3], [cx, cy + r], [cx - r * 0.3, cy + r * 0.3], [cx - r, cy],
    [cx - r * 0.3, cy - r * 0.3]]) });
}

let styled = false;
function injectStyle() {
  if (styled) return;
  styled = true;
  document.head.appendChild(h("style", { text: `
.geo-big { position: absolute; inset: 0; z-index: 45; background: #fff; user-select: none; -webkit-user-select: none; touch-action: none; }
.geo-big svg { display: block; overflow: visible; }
.geo-fig { touch-action: none; }
.geo-panel, .geo-top, .geo-bar { overflow: hidden; }
.geo-text { position: absolute; white-space: normal; overflow-wrap: break-word; }
.geo-caption { transform: translateY(-50%); overflow: hidden; }
.geo-tap { cursor: pointer; }
.geo-small { cursor: pointer; overflow: hidden; }
` }));
}
