// Live, editable visuals Liza's board lacks (EduVision acceptance tests A–C):
// key points on her graph card, dimension sliders on her geometry lab, and a
// projectile simulation driven by its equations instead of her recorded takes.
// Everything here is computed, never asked of the model.

// ------------------------------------------------------------------ physics
const RAD = Math.PI / 180;

// Projectile from height h at speed u, angle deg, gravity g (no air resistance).
export function projectile(u, deg, g, h = 0) {
  const vx = u * Math.cos(deg * RAD), vy = u * Math.sin(deg * RAD);
  const T = (vy + Math.sqrt(vy * vy + 2 * g * h)) / g;
  const tPeak = Math.max(0, vy / g);
  return {
    vx, vy, T, tPeak,
    range: vx * T,
    maxHeight: h + vy * tPeak - g * tPeak * tPeak / 2,
    at: (t) => ({ t, x: vx * t, y: h + vy * t - g * t * t / 2, vx, vy: vy - g * t }),
  };
}

// ------------------------------------------------------------------ graph key points
// Roots, turning points and the y-intercept of one sampled curve [[x, y|null], ...].
// A turning point is a 3-point parabola fit, exact for a quadratic.
export function keyPoints(points) {
  const roots = [], turns = [];
  let yInt = null;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    if (y0 === null || y1 === null || x0 === null || x1 === null) continue;
    if (x0 <= 0 && 0 <= x1 && yInt === null) yInt = x1 === x0 ? y0 : y0 + (y1 - y0) * (0 - x0) / (x1 - x0);
    if (y0 === 0) roots.push(x0);
    else if (y0 * y1 < 0 && Math.abs(y1 - y0) < 1e6) roots.push(x0 - y0 * (x1 - x0) / (y1 - y0));
    const nxt = points[i + 1];
    if (!nxt || nxt[1] === null) continue;
    const y2 = nxt[1];
    if ((y1 - y0) * (y2 - y1) < 0) {
      const h = x1 - x0, den = y0 - 2 * y1 + y2;
      const dx = den ? h * (y0 - y2) / (2 * den) : 0;
      turns.push([x1 + dx, y1 - (y0 - y2) * dx / (4 * h)]);
    }
  }
  return { roots: dedupe(roots), turns, yInt };
}
const dedupe = (xs) => xs.filter((x, i) => i === 0 || Math.abs(x - xs[i - 1]) > 1e-6);
const num = (v) => { const r = Math.round(v * 100) / 100; return String(Object.is(r, -0) ? 0 : r); };

export function keyPointsLine(curves) {
  const parts = [];
  for (const c of curves || []) {
    const pts = c.points || (c.runs || []).flat();
    const k = keyPoints(pts);
    const bits = [];
    if (k.roots.length) bits.push(`roots x = ${k.roots.slice(0, 4).map(num).join(", ")}`);
    if (k.turns.length) bits.push(`${k.turns.length === 1 ? "vertex" : "turning points"} ${k.turns.slice(0, 3).map(([x, y]) => `(${num(x)}, ${num(y)})`).join(", ")}`);
    if (k.yInt !== null) bits.push(`y-intercept ${num(k.yInt)}`);
    if (bits.length) parts.push(((curves.length > 1 ? c.label + ": " : "") + bits.join(" · ")));
  }
  return parts.join("\n");
}

// ------------------------------------------------------------------ geometry dimensions
// Which measurements each of her solids takes, in geometry.build's words.
const DIMS = {
  cube: [["a", "side", 4]], cuboid: [["l", "length", 6], ["b", "breadth", 4], ["h", "height", 3]],
  cylinder: [["r", "radius", 3], ["h", "height", 6]], cone: [["r", "radius", 3], ["h", "height", 4]],
  sphere: [["r", "radius", 4]], hemisphere: [["r", "radius", 4]], tetrahedron: [["a", "side", 4]],
  prism: [["a", "side", 4], ["h", "height", 6]], pyramid: [["a", "side", 4], ["h", "height", 4]],
};

export function dimsFor(payload) {
  const head = String(payload || "").split(";")[0];
  const kind = Object.keys(DIMS).find((k) => new RegExp(`\\b${k}`, "i").test(head));
  if (!kind) return null;
  const nums = [...String(payload).matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => +m[1]);
  const named = (key, word) => {
    const m = String(payload).match(new RegExp(`\\b(?:${key}|${word})\\s*(?:=|:|of|is)?\\s*(\\d+(?:\\.\\d+)?)`, "i"));
    return m ? +m[1] : null;
  };
  const triple = String(payload).match(/(\d+(?:\.\d+)?)\s*\w*\s*[x×*]\s*(\d+(?:\.\d+)?)\s*\w*\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  const unit = (String(payload).match(/\d\s*(mm|cm|km|m|in|ft)\b/i) || [])[1] || "";
  const dims = DIMS[kind].map(([key, word, dflt], i) => ({
    key, word,
    value: named(key, word) ?? (triple && kind === "cuboid" ? +triple[i + 1] : DIMS[kind].length === 1 && nums.length === 1 ? nums[0] : dflt),
  }));
  return { head: head.trim(), dims, unit };
}

export const payloadFor = ({ head, dims, unit }) =>
  [head, ...dims.map((d) => `${d.word} = ${num(d.value)}${unit ? " " + unit : ""}`)].join("; ");

// The slider strip over her lab; `rebuild(payload)` asks her geolab for the figure again.
export function dimsBar(payload, rebuild) {
  const spec = dimsFor(payload);
  closeDims();
  if (!spec) return;
  const el = document.createElement("div");
  el.className = "e3d-panel live-dims";
  el.innerHTML = `<b>Change the size</b>`;
  let timer = 0;
  for (const d of spec.dims) {
    const row = document.createElement("label");
    row.innerHTML = `<span class="e3d-name"></span><b></b><input type="range" min="0.5" max="20" step="0.5">`;
    row.querySelector("span").textContent = `${d.word} (${d.key})`;
    const out = row.querySelector("b"), input = row.querySelector("input");
    input.value = d.value;
    out.textContent = num(d.value) + (spec.unit ? " " + spec.unit : "");
    input.addEventListener("input", () => {
      d.value = +input.value;
      out.textContent = num(d.value) + (spec.unit ? " " + spec.unit : "");
      clearTimeout(timer);
      timer = setTimeout(() => rebuild(payloadFor(spec)), 120); // geometry is computed on the server: one ask per pause
    });
    el.append(row);
  }
  document.body.append(el);
}
export function closeDims() { document.querySelectorAll(".live-dims").forEach((n) => n.remove()); }

// ------------------------------------------------------------------ projectile simulation
const PARAMS = [
  ["initial_velocity", "u", "Initial velocity", "m/s", 1, 100, 0.5, 20],
  ["angle", "θ", "Launch angle", "°", 0, 90, 1, 45],
  ["gravity", "g", "Gravity", "m/s²", 0.5, 30, 0.01, 9.81],
  ["height", "h", "Initial height", "m", 0, 50, 0.5, 0],
];

let sim = null;

export function openProjectile({ title = "Projectile motion", settings = [] } = {}) {
  closeProjectile();
  const p = Object.fromEntries(PARAMS.map(([name, , , , , , , v]) => [name, v]));
  for (const [name, value] of settings || []) if (name in p && isFinite(+value)) p[name] = +value;

  const el = document.createElement("div");
  el.className = "e3d live-sim";
  el.innerHTML = `<canvas></canvas>
    <div class="e3d-head"><b class="e3d-title"></b><button class="e3d-close" aria-label="Close">✕</button></div>
    <div class="e3d-panel">
      <div class="e3d-readings"></div>
      <div class="live-eq"></div>
      <div class="live-params"></div>
      <label><span class="e3d-name">Time</span><b class="live-t"></b><input class="live-timeline" type="range" min="0" max="1" step="0.001" value="0"></label>
      <div class="e3d-buttons">
        <button data-do="play">Pause</button><button data-do="step">Step ▸</button><button data-do="reset">Reset</button>
        <button data-do="speed">1×</button>
      </div>
    </div>`;
  document.body.append(el);
  el.querySelector(".e3d-title").textContent = title;
  const canvas = el.querySelector("canvas"), ctx = canvas.getContext("2d");
  sim = { el, t: 0, playing: true, speed: 1, last: performance.now(), raf: 0 };
  let model = projectile(p.initial_velocity, p.angle, p.gravity, p.height);

  const box = el.querySelector(".live-params");
  for (const [name, sym, words, unit, min, max, step] of PARAMS) {
    const row = document.createElement("label");
    row.innerHTML = `<span class="e3d-name"></span><b></b><input type="range">`;
    row.querySelector("span").textContent = `${words} (${sym})`;
    const input = row.querySelector("input"), out = row.querySelector("b");
    Object.assign(input, { min, max, step, value: p[name] });
    out.textContent = `${num(p[name])} ${unit}`;
    input.addEventListener("input", () => {
      p[name] = +input.value;
      out.textContent = `${num(p[name])} ${unit}`;
      model = projectile(p.initial_velocity, p.angle, p.gravity, p.height);
      sim.t = Math.min(sim.t, model.T);
      equations();
    });
    box.append(row);
  }
  const timeline = el.querySelector(".live-timeline");
  timeline.addEventListener("input", () => { sim.playing = false; sim.t = +timeline.value * model.T; buttons(); });
  el.querySelector(".e3d-close").addEventListener("click", closeProjectile);
  el.querySelector(".e3d-buttons").addEventListener("click", (e) => {
    const what = e.target.dataset.do;
    if (what === "play") { if (sim.t >= model.T) sim.t = 0; sim.playing = !sim.playing; }
    if (what === "step") { sim.playing = false; sim.t = Math.min(model.T, sim.t + model.T / 40); }
    if (what === "reset") { sim.playing = false; sim.t = 0; }
    if (what === "speed") sim.speed = { 0.25: 0.5, 0.5: 1, 1: 2, 2: 0.25 }[sim.speed];
    buttons();
  });
  const buttons = () => {
    el.querySelector('[data-do="play"]').textContent = sim.playing ? "Pause" : "Play";
    el.querySelector('[data-do="speed"]').textContent = sim.speed + "×";
  };

  function equations() {
    const s = model, u = num(p.initial_velocity), a = num(p.angle), g = num(p.gravity), h = num(p.height);
    const lines = [
      `x = u\\cos\\theta\\,t = ${num(s.vx)}\\,t`,
      `y = h + u\\sin\\theta\\,t - \\tfrac12 g t^2 = ${h} + ${num(s.vy)}\\,t - ${num(p.gravity / 2)}\\,t^2`,
      `T = \\frac{u\\sin\\theta + \\sqrt{u^2\\sin^2\\theta + 2gh}}{g} = ${num(s.T)}\\text{ s}`,
      `R = u\\cos\\theta\\,T = ${num(s.range)}\\text{ m}`,
      `H = h + \\frac{u^2\\sin^2\\theta}{2g} = ${num(s.maxHeight)}\\text{ m}`,
    ];
    const eq = el.querySelector(".live-eq");
    eq.replaceChildren(...lines.map((l) => {
      const d = document.createElement("div");
      try { window.katex.render(l, d, { throwOnError: true }); } catch (_) { d.textContent = l; }
      return d;
    }));
    eq.title = `u = ${u} m/s, θ = ${a}°, g = ${g} m/s², h = ${h} m`;
  }

  function draw() {
    const W = el.clientWidth, H = el.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#10141a"; ctx.fillRect(0, 0, W, H);
    const panelW = W > 700 ? 340 : 0, panelH = W > 700 ? 0 : H * 0.42;
    const left = 56, right = W - panelW - 24, top = 80, bottom = H - panelH - 48;
    const spanX = Math.max(model.range, 1) * 1.1, spanY = Math.max(model.maxHeight, 1) * 1.15;
    const k = Math.min((right - left) / spanX, (bottom - top) / spanY);
    const X = (x) => left + x * k, Y = (y) => bottom - y * k;
    // grid with metre ticks
    const tick = niceStep(Math.max(spanX, spanY) / 8);
    ctx.font = "12px system-ui"; ctx.fillStyle = "#8a94a6"; ctx.strokeStyle = "#232a35"; ctx.lineWidth = 1;
    for (let x = 0; X(x) <= right; x += tick) { line(X(x), top, X(x), bottom); ctx.fillText(num(x), X(x) - 6, bottom + 16); }
    for (let y = 0; Y(y) >= top; y += tick) { line(left, Y(y), right, Y(y)); ctx.fillText(num(y), left - 34, Y(y) + 4); }
    ctx.strokeStyle = "#5b6577"; ctx.lineWidth = 2; line(left, bottom, right, bottom); line(left, bottom, left, top);
    ctx.fillText("x (m)", right - 30, bottom + 16); ctx.fillText("y (m)", left - 40, top - 10);
    // trajectory
    ctx.strokeStyle = "#6366f1"; ctx.lineWidth = 2.5; ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) { const q = model.at(model.T * i / 120); i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y)); }
    ctx.stroke();
    // max height and range
    const peak = model.at(model.tPeak);
    ctx.setLineDash([5, 4]); ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 1.5;
    line(X(peak.x), Y(peak.y), X(peak.x), bottom);
    ctx.fillStyle = "#f59e0b"; ctx.fillText(`H = ${num(model.maxHeight)} m`, X(peak.x) + 6, Y(peak.y) - 8);
    ctx.fillStyle = "#22c55e"; ctx.fillText(`R = ${num(model.range)} m`, X(model.range / 2) - 30, bottom + 32);
    ctx.setLineDash([]);
    // the ball and its vectors (1 m/s drawn as vk px)
    const q = model.at(sim.t), vk = 40 / Math.max(1, p.initial_velocity) * 2;
    arrow(X(q.x), Y(q.y), q.vx * vk, 0, "#ef4444", "vx");
    arrow(X(q.x), Y(q.y), 0, -q.vy * vk, "#38bdf8", "vy");
    arrow(X(q.x), Y(q.y), q.vx * vk, -q.vy * vk, "#22c55e", "v");
    arrow(X(q.x), Y(q.y), 0, 34, "#f59e0b", "g");
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), 8, 0, 7); ctx.fill();
    // readouts
    const speed = Math.hypot(q.vx, q.vy);
    el.querySelector(".e3d-readings").innerHTML = [
      ["Time of flight", `${num(model.T)} s`], ["Range", `${num(model.range)} m`], ["Max height", `${num(model.maxHeight)} m`],
      ["t", `${num(q.t)} s`], ["x, y", `${num(q.x)} m, ${num(q.y)} m`], ["vx, vy", `${num(q.vx)}, ${num(q.vy)} m/s`], ["speed", `${num(speed)} m/s`],
    ].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join("");
    el.querySelector(".live-t").textContent = `${num(q.t)} s`;
    timeline.value = model.T ? sim.t / model.T : 0;
  }
  const line = (a, b, c, d) => { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); };
  function arrow(x, y, dx, dy, colour, label) {
    const len = Math.hypot(dx, dy);
    if (len < 2) return;
    ctx.strokeStyle = ctx.fillStyle = colour; ctx.lineWidth = 2.5;
    line(x, y, x + dx, y + dy);
    const a = Math.atan2(dy, dx);
    ctx.beginPath(); ctx.moveTo(x + dx, y + dy);
    ctx.lineTo(x + dx - 10 * Math.cos(a - 0.4), y + dy - 10 * Math.sin(a - 0.4));
    ctx.lineTo(x + dx - 10 * Math.cos(a + 0.4), y + dy - 10 * Math.sin(a + 0.4)); ctx.fill();
    ctx.font = "bold 13px system-ui"; ctx.fillText(label, x + dx + 4, y + dy - 4);
  }
  function frame(now) {
    const dt = Math.min(0.1, (now - sim.last) / 1000);
    sim.last = now;
    if (sim.playing) {
      sim.t += dt * sim.speed;
      if (sim.t >= model.T) { sim.t = model.T; sim.playing = false; buttons(); }
    }
    draw();
    sim.raf = requestAnimationFrame(frame);
  }
  equations();
  sim.raf = requestAnimationFrame(frame);
  return true;
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

export function closeProjectile() {
  if (!sim) return;
  cancelAnimationFrame(sim.raf);
  sim.el.remove();
  sim = null;
}
