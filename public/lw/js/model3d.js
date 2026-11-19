// Liza's own 3D view, as ui.py draws it (show_model3d, _open_model3d) and
// viewer3d.py renders it.
//
// A scene of parts (models3d: the solar system, a cell, a cube with its
// formulas) or of balls and sticks (a molecule) is plain data from the server,
// built here with Three.js the way viewer3d._mesh builds it with PyVista: the
// same shapes, colours, labels on a layer of their own, a camera framed as
// _frame_camera frames it, a slow turn until the first touch, orbits and waves
// that keep going. The 3D engine's models (the pendulum, projectile motion)
// cannot run in a browser; they come as recordings made on the Pi by
// tools/bake_engine.py, played in the same frame with the same buttons.

import { at, h } from "./ui.js";

const THREE_URL = new URL("../holo/vendor/three/build/three.module.min.js", import.meta.url).href;
let threeLoading = null;
function loadThree() {
  if (!threeLoading) threeLoading = import(THREE_URL);
  return threeLoading;
}

const UI_W = 800, UI_H = 480;
const BIG_BOX = [0, 62, UI_W, UI_H - 58];      // BIG_MODEL3D_BOX
const SIM_PANEL_W = 236;
const DRAG_DEG = 0.45;                         // MODEL3D_DRAG_DEG
const SPIN_DEG_PER_S = 30;                     // viewer3d.Renderer.SPIN_DEG_PER_S
const BACKGROUND = 0x0b1020;                   // viewer3d.BACKGROUND
const LEADER_COLOUR = "#8C9BC4";
const LABELS_MIN_WIDTH = 500;
const BOND_RADIUS = 0.10, BOND_GAP = 0.13;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- the view
export class Model3DView {
  // scene: from /api/model3d; screen: the stage element; onClose: back to the
  // board, with a still of the model for it.
  constructor(screen, scene, { onClose, onSetting } = {}) {
    this.screen = screen;
    this.scene = scene;
    this.onClose = onClose;
    this.onSetting = onSetting;
    this.engine = scene.kind === "engine";
    this.hasPanel = !!(this.engine && scene.simulation);
    this.paused = false;
    this.el = null;
    this.stage = null;
  }

  pictureBox() {
    const [x0, y0, x1, y1] = BIG_BOX;
    return [x0, y0, this.hasPanel ? x1 - SIM_PANEL_W : x1, y1];
  }

  async open() {
    const s = this.scene;
    const el = h("div", { class: "m3-big" });
    this.el = el;
    el.appendChild(at(h("div", { class: "m3-title", text: s.title || "3D model" }), 20, 10, 700, 26));
    // The colour key: a dot and a name per element, left to right.
    if ((s.legend || []).length) {
      const key = h("div", { class: "m3-legend" });
      for (const [, name, colour] of s.legend) {
        key.append(h("span", { class: "m3-dot", style: { background: colour } }), h("span", { text: name }));
      }
      el.appendChild(at(key, 22, 40, 740, 16));
    }
    const [x0, y0, x1, y1] = this.pictureBox();
    const glass = h("div", { class: "m3-glass" });
    this.glass = glass;
    el.appendChild(at(glass, x0, y0, x1 - x0, y1 - y0));
    this.wait = h("div", { class: "m3-wait", text: "Building the 3D model…" });
    glass.appendChild(this.wait);

    const bottom = UI_H - 29;
    this.button(UI_W / 2 - 150, bottom, "−", () => this.zoom(1 / 1.25));
    this.button(UI_W / 2 - 80, bottom, "+", () => this.zoom(1.25));
    this.button(UI_W / 2 + 20, bottom, "Reset", () => this.reset(), 96);
    if (s.animated || this.engine) this.pauseButton = this.button(UI_W / 2 + 130, bottom, "Pause", () => this.togglePause(), 96);
    el.appendChild(at(h("div", { class: "m3-hint", text: "drag to turn it" }), UI_W - 220, bottom - 9, 200, 18));
    if ((s.formulas || []).length) {
      const box = h("div", { class: "m3-formulas" }, ...s.formulas.map((line) => h("div", { text: line })));
      el.appendChild(at(box, UI_W - 420, 62, 400));
    }
    if (s.note) {
      el.appendChild(at(h("div", { class: "m3-note", text: s.note }), 16, bottom - 16, UI_W / 2 - 196, 32));
    }
    const close = h("button", { class: "m3-close", html: "✕", "aria-label": "Close" });
    close.addEventListener("click", (e) => { e.stopPropagation(); this.close(); });
    el.appendChild(at(close, UI_W - 40, 10, 28, 28));
    if (this.hasPanel) this.panel = new SimPanel(el, s, (name, value) => this.setting(name, value));

    this.screen.appendChild(el);
    this.bindDrag(glass);
    try {
      this.stage = this.engine ? new Recording(glass, s) : new Stage(await loadThree(), glass, s);
      await this.stage.ready;
      this.wait.remove();
      this.stage.size(x1 - x0, y1 - y0);
      this.stage.spin(true);
      this.stage.animate(true);
    } catch (err) {
      console.error(err);
      this.wait.textContent = "The 3D model could not be drawn on this screen.";
    }
  }

  button(cx, cy, text, command, width = 56) {
    const b = h("button", { class: `m3-btn${text.length === 1 ? " big" : ""}`, text });
    b.addEventListener("click", (e) => { e.stopPropagation(); command(); });
    this.el.appendChild(at(b, cx - width / 2, cy - 20, width, 40));
    return b;
  }

  bindDrag(glass) {
    let last = null;
    glass.addEventListener("pointerdown", (e) => {
      last = [e.clientX, e.clientY];
      glass.setPointerCapture(e.pointerId);
      if (this.stage) this.stage.spin(false);
    });
    glass.addEventListener("pointermove", (e) => {
      if (!last || !this.stage) return;
      const scale = stageScale();
      const dx = (e.clientX - last[0]) / scale, dy = (e.clientY - last[1]) / scale;
      last = [e.clientX, e.clientY];
      // Right drags the front of the model right; down tips its top towards you.
      this.stage.turn(-dx * DRAG_DEG, dy * DRAG_DEG);
    });
    const end = () => { last = null; if (this.stage) this.stage.dragEnd(); };
    glass.addEventListener("pointerup", end);
    glass.addEventListener("pointercancel", end);
    glass.addEventListener("wheel", (e) => { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); },
      { passive: false });
  }

  zoom(factor) {
    if (!this.stage) return;
    this.stage.spin(false);
    this.stage.zoom(factor);
  }

  reset() {
    if (!this.stage) return;
    this.stage.reset();
    this.stage.spin(true);
  }

  togglePause() {
    this.paused = !this.paused;
    if (this.stage) this.stage.animate(!this.paused);
    if (this.pauseButton) this.pauseButton.textContent = this.paused ? "Play" : "Pause";
  }

  // An offer's numbers ("angle", 60), set once the simulation is up, as
  // actions.run_offer tells the engine "change the angle to 60".
  async applySettings(settings) {
    if (!this.engine || !settings || !settings.length) return;
    try { await this.stage.ready; } catch (err) { return; }
    const params = (this.scene.settings || {}).params || {};
    for (const [said, value] of settings) {
      const name = paramNamed(params, said);
      if (!name) continue;
      const take = await this.setting(name, Number(value));
      if (take && this.panel) this.panel.showTake(take);
    }
  }

  async setting(name, value) {
    // A recording made with that setting (bake_engine.py records each
    // slider's stops); the nearest one is what plays.
    const take = this.stage && this.stage.useSetting ? this.stage.useSetting(name, value) : null;
    if (take && this.paused) this.togglePause();
    if (this.onSetting && take) this.onSetting(take);
    return take;
  }

  // What ON_BOARD says now (a slider changes the numbers she should use).
  boardTitle() {
    return this.stage && this.stage.boardTitle ? this.stage.boardTitle() : null;
  }

  // Back to the board, which keeps a still of the whole model.
  close() {
    let still = null;
    if (this.stage) {
      try { still = this.stage.still(); } catch (err) { still = null; }
      this.stage.dispose();
    }
    this.stage = null;
    if (this.el) this.el.remove();
    this.el = null;
    if (this.onClose) this.onClose(still);
  }
}

function stageScale() {
  const stage = document.getElementById("stage");
  if (!stage) return 1;
  const rect = stage.getBoundingClientRect();
  return rect.width / UI_W || 1;
}

// ---------------------------------------------------------------- the sliders
// ui.py _sim_panel_draw: a slider per setting down the right of the picture;
// the number follows the finger, and the change is made on letting go.
const SIM_LABELS = { "amplitude|°": "starting angle", "initial_velocity|m/s": "launch speed",
  "height|m": "height", "r1|Ω": "resistor 1", "r2|Ω": "resistor 2",
  "mass1|kg": "mass of cart 1", "mass2|kg": "mass of cart 2", "velocity1|m/s": "speed of cart 1",
  "velocity2|m/s": "speed of cart 2", "n1|": "refractive index 1", "n2|": "refractive index 2" };
const SIM_MOVING_RESULTS = ["now", "time", "years_elapsed", "half_lives_passed"];

// "launch speed", "angle", "initial velocity": which setting that is.
function paramNamed(params, said) {
  const key = String(said || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key in params) return key;
  for (const [name, p] of Object.entries(params)) {
    const label = SIM_LABELS[`${name}|${p.unit || ""}`];
    if (label && label.replace(/ /g, "_") === key) return name;
  }
  return Object.keys(params).find((name) => name.includes(key) || key.includes(name)) || null;
}

function simStep(p) {
  const step = Number(p.step || 0);
  if (step > 0) return step;
  const raw = (p.max - p.min) / 100;
  for (const nice of [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]) if (nice >= raw) return nice;
  return raw;
}

function simValueText(value, p, step) {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const unit = p.unit || "";
  const number = value.toFixed(decimals);
  if (!unit) return number;
  return unit === "°" || unit === "×" ? `${number}${unit}` : `${number} ${unit}`;
}

export function simResultsText(measurements) {
  const lines = [];
  for (const [key, value] of Object.entries(measurements || {})) {
    if (key === "x" || SIM_MOVING_RESULTS.some((w) => key.includes(w))) continue;
    const name = key.replace(/_/g, " ");
    lines.push(`${name[0].toUpperCase()}${name.slice(1)}: ${value}`);
  }
  return lines.slice(0, 4).join("\n");
}

class SimPanel {
  constructor(parent, scene, onRelease) {
    const settings = scene.settings || {};
    const params = settings.params || {};
    const px0 = UI_W - SIM_PANEL_W + 6, py0 = BIG_BOX[1] + 4, px1 = UI_W - 8, py1 = BIG_BOX[3] - 4;
    const panel = h("div", { class: "m3-panel" });
    panel.addEventListener("pointerdown", (e) => e.stopPropagation());
    at(panel, px0, py0, px1 - px0, py1 - py0);
    panel.appendChild(at(h("div", { class: "m3-panel-head", text: "Change it" }), 14, 9, 200, 18));
    const names = Object.keys(params);
    if (!names.length) {
      panel.appendChild(at(h("div", { class: "m3-panel-msg", text: "Nothing to change here." }), 12, 0, px1 - px0 - 24, py1 - py0));
    }
    const resultsH = 78;
    const top = 40, bottom = py1 - py0 - resultsH;
    const row = Math.min(62, (bottom - top) / Math.max(1, names.length));
    const width = px1 - px0;
    this.sliders = names.map((name, i) => {
      const p = params[name];
      const y = top + i * row;
      const step = simStep(p);
      const label = SIM_LABELS[`${name}|${p.unit || ""}`] || name.replace(/_/g, " ");
      panel.appendChild(at(h("div", { class: "m3-slider-name", text: label[0].toUpperCase() + label.slice(1) }), 14, y, 150, 16));
      const valueEl = h("div", { class: "m3-slider-value" });
      panel.appendChild(at(valueEl, width - 112, y, 100, 16));
      const hit = h("div", { class: "m3-slider-hit" });
      const track = h("div", { class: "m3-track" });
      const fill = h("div", { class: "m3-fill" });
      const knob = h("div", { class: "m3-knob" });
      track.append(fill);
      hit.append(track, knob);
      panel.appendChild(at(hit, 6, y + 14, width - 12, 36));
      const slider = { name, p: { ...p }, step, value: Number(p.value), start: Number(p.value),
        valueEl, fill, knob, tx0: 16, tx1: width - 12 - 16 };
      this.place(slider, slider.value);
      const drag = (e) => {
        const rect = hit.getBoundingClientRect();
        const scale = rect.width / (width - 12);
        const f = Math.min(1, Math.max(0, ((e.clientX - rect.left) / scale - slider.tx0) / (slider.tx1 - slider.tx0)));
        let value = p.min + f * (p.max - p.min);
        // Whole steps of the number itself; the ends stay reachable.
        value = f <= 0 ? p.min : f >= 1 ? p.max : Math.round(value / step) * step;
        slider.value = Math.round(Math.min(p.max, Math.max(p.min, value)) * 1e6) / 1e6;
        this.place(slider, slider.value);
      };
      let down = false;
      hit.addEventListener("pointerdown", (e) => { down = true; hit.setPointerCapture(e.pointerId); drag(e); });
      hit.addEventListener("pointermove", (e) => { if (down) drag(e); });
      hit.addEventListener("pointerup", async (e) => {
        if (!down) return;
        down = false;
        drag(e);
        if (Math.abs(slider.value - Number(slider.p.value)) < 1e-9) return;
        this.results.textContent = "Working it out…";
        const take = await onRelease(name, slider.value);
        if (!take) {
          this.results.textContent = "That setting has not been recorded for the website.";
          return;
        }
        this.showTake(take);
      });
      return slider;
    });
    this.results = h("div", { class: "m3-results", text: simResultsText(settings.measurements) });
    panel.appendChild(at(this.results, 14, py1 - py0 - resultsH + 6, width - 26, resultsH - 10));
    parent.appendChild(panel);
  }

  // The recording nearest the finger: the knobs go to what is playing.
  showTake(take) {
    for (const other of this.sliders) {
      const v = Number(take.values[other.name] ?? other.start);
      other.p.value = v;
      other.value = v;
      this.place(other, v);
    }
    this.results.textContent = simResultsText(take.measurements);
  }

  place(slider, value) {
    const p = slider.p;
    const span = (p.max - p.min) || 1;
    const x = slider.tx0 + (slider.tx1 - slider.tx0) * (value - p.min) / span;
    slider.fill.style.width = `${x - slider.tx0}px`;
    slider.knob.style.left = `${x - 11}px`;
    slider.valueEl.textContent = simValueText(value, p, slider.step);
  }
}

// ---------------------------------------------------------------- recordings
// The engine's model, recorded on the Pi: a model that spins was recorded
// turning once round, so a sideways drag turns it by moving through the
// recording; a simulation was recorded running once, and plays on a loop.
class Recording {
  constructor(glass, scene) {
    this.scene = scene;
    this.spins = scene.spin !== false;
    this.secondsPerDegree = 1 / SPIN_DEG_PER_S;
    this.scale = 1;
    this.playing = true;
    this.spinning = true;
    const video = h("video", { class: "m3-video", muted: true, loop: true, playsinline: true,
      preload: "auto", poster: scene.still || undefined });
    video.muted = true;
    video.src = scene.video;
    this.video = video;
    this.take = { values: {}, measurements: (scene.settings || {}).measurements, title: null };
    glass.appendChild(video);
    this.ready = new Promise((resolve, reject) => {
      video.addEventListener("loadeddata", resolve, { once: true });
      video.addEventListener("error", () => reject(new Error("the recording did not load")), { once: true });
    });
  }

  size(w, hgt) {
    this.video.style.width = `${w}px`;
    this.video.style.height = `${hgt}px`;
  }

  play() {
    if (this.playing && (this.spinning || !this.spins)) this.video.play().catch(() => {});
    else this.video.pause();
  }

  spin(on) {
    // A spinning model's turn IS the recording: holding it still is a pause.
    this.spinning = on;
    this.play();
  }

  animate(on) {
    this.playing = on;
    this.play();
  }

  turn(dAzimuth) {
    if (!this.spins || !this.video.duration) return;
    const d = this.video.duration;
    this.video.currentTime = (((this.video.currentTime + dAzimuth * this.secondsPerDegree) % d) + d) % d;
  }

  dragEnd() {}

  zoom(factor) {
    this.scale = Math.min(4, Math.max(0.5, this.scale * factor));
    this.video.style.transform = `scale(${this.scale})`;
  }

  reset() {
    this.scale = 1;
    this.video.style.transform = "";
    this.video.currentTime = 0;
  }

  // A slider's recording: the one made at the stop nearest the value, with
  // every other setting as it starts.
  useSetting(name, value) {
    const params = (this.scene.settings || {}).params || {};
    const takes = (this.scene.takes || []).filter((t) => name in t.values);
    if (!takes.length || !params[name]) return null;
    // Where it starts is the main recording.
    takes.push({ values: { [name]: Number(params[name].value) }, video: this.scene.video,
      still: this.scene.still, measurements: (this.scene.settings || {}).measurements, title: null });
    const best = takes.reduce((a, b) => (Math.abs(b.values[name] - value) < Math.abs(a.values[name] - value) ? b : a));
    this.video.src = best.video;
    this.video.play().catch(() => {});
    this.take = best;
    return best;
  }

  boardTitle() {
    return this.take && this.take.title;
  }

  still() {
    return this.take && this.take.still ? this.take.still : this.scene.still;
  }

  dispose() {
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video.remove();
  }
}

// ---------------------------------------------------------------- Three.js
class Stage {
  constructor(THREE, glass, scene) {
    this.T = THREE;
    this.glass = glass;
    this.scene = scene;
    this.spinning = false;
    this.animating = false;
    this.clock = 0;
    this.movers = [];
    this.waves = [];
    this.labels = [];
    this.followers = [];
    this.w = 400;
    this.h = 300;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, (window.devicePixelRatio || 1) * stageScale()));
    renderer.setClearColor(BACKGROUND, 1);
    renderer.localClippingEnabled = true;
    this.renderer = renderer;
    renderer.domElement.className = "m3-canvas";
    glass.appendChild(renderer.domElement);
    this.labelLayer = h("div", { class: "m3-labels" });
    this.leaders = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.leaders.setAttribute("class", "m3-leaders");
    glass.append(this.leaders, this.labelLayer);
    this.world = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.01, 1e5);
    this.camera.up.set(0, 0, 1);
    this.focal = new THREE.Vector3();
    this.lights(scene.lighting);
    if (scene.kind === "molecule") this.addMolecule(scene);
    else this.addParts(scene);
    this.frame();
    this.advance(0);
    this.ready = Promise.resolve();
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // VTK's default light kit, near enough: a light at the camera and a soft fill.
  lights(kind) {
    const T = this.T;
    if (kind === "sun") {
      // One light, at the Sun, so the far side of the Earth is night -- and a
      // little from the viewer, so night is dark rather than missing.
      const sun = new T.PointLight(0xffffff, 1.3 * Math.PI, 0, 0);
      this.world.add(sun);
      this.head = new T.DirectionalLight(0xffffff, 0.12 * Math.PI);
    } else {
      this.world.add(new T.AmbientLight(0xffffff, 0.35));
      this.head = new T.DirectionalLight(0xffffff, 2.3);
    }
    this.world.add(this.head);
    this.world.add(this.head.target);
  }

  material(colour, { opacity = 1, lit = true, clip = null, flat = false } = {}) {
    const T = this.T;
    const common = { color: new T.Color(colour), transparent: opacity < 1, opacity,
      side: clip || opacity < 1 ? T.DoubleSide : T.FrontSide, depthWrite: opacity >= 1 };
    if (clip) {
      common.clippingPlanes = clip.planes;
      common.clipIntersection = clip.intersection;
    }
    if (!lit) return new T.MeshBasicMaterial(common);
    return new T.MeshPhongMaterial({ ...common, shininess: 15, specular: new T.Color(0x4d4d4d),
      flatShading: flat });
  }

  // viewer3d._mesh: one part's shape, turned and placed as it says.
  geometry(p, atOrigin = false) {
    const T = this.T;
    const shape = p.shape;
    let g;
    if (shape === "tube") {
      const pts = p.points.map((q) => new T.Vector3(...q));
      const path = new PolylineCurve(T, pts, !!p.closed);
      g = new T.TubeGeometry(path, Math.max(8, pts.length * 2), p.radius, 12, !!p.closed);
      return g;     // points are where they are: no centre
    }
    if (shape === "points" || shape === "particles") return null;   // instanced below
    if (shape === "sphere") g = new T.SphereGeometry(p.radius, 48, 48);
    else if (shape === "ellipsoid") {
      g = new T.SphereGeometry(1, 40, 40);
      g.scale(...p.radii);
    } else if (shape === "cylinder") {
      g = new T.CylinderGeometry(p.radius, p.radius, p.height, p.resolution || 28);
      g.rotateX(Math.PI / 2);
    } else if (shape === "cone") {
      g = new T.ConeGeometry(p.radius, p.height, 28);
      g.rotateX(Math.PI / 2);
    } else if (shape === "torus") {
      g = new T.TorusGeometry(p.ring, p.tube, 16, 64);
    } else if (shape === "box") {
      g = new T.BoxGeometry(...p.size);
    } else if (shape === "disc") {
      g = new T.RingGeometry(p.inner, p.outer, 72, 2);
    } else if (shape === "icosahedron") {
      g = new T.IcosahedronGeometry(p.radius, 0);
    } else if (shape === "prism") {
      const outline = new T.Shape(p.points2d.map(([x, y]) => new T.Vector2(x, y)));
      g = new T.ExtrudeGeometry(outline, { depth: p.depth, bevelEnabled: false });
      g.translate(0, 0, -p.depth / 2);
    } else if (shape === "polyhedron") {
      const pos = [];
      for (const face of p.faces) {
        for (let k = 1; k < face.length - 1; k++) {
          for (const idx of [face[0], face[k], face[k + 1]]) pos.push(...p.vertices[idx]);
        }
      }
      g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
    } else if (shape === "revolve") {
      g = new T.LatheGeometry(p.profile.map(([r, z]) => new T.Vector2(Math.max(0, r), z)), 72);
      g.rotateX(Math.PI / 2);
    } else {
      throw new Error(`no shape called ${shape}`);
    }
    if (p.rotate) {
      const [rx, ry, rz] = p.rotate.map((d) => (d * Math.PI) / 180);
      g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
    }
    const toward = p.direction || p.normal;
    if (toward) {
      const d = new T.Vector3(...toward).normalize();
      const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), d);
      g.applyQuaternion(q);
    }
    if (!atOrigin && p.centre) g.translate(...p.centre);
    if (shape === "box" || shape === "prism" || shape === "polyhedron") {
      g = g.index ? g.toNonIndexed() : g;
      g.computeVertexNormals();
    }
    return g;
  }

  // viewer3d._cut: a part with a slice or a corner taken out.
  clipFor(p) {
    const T = this.T;
    const centre = new T.Vector3(...(p.centre || [0, 0, 0]));
    const cut = p.cut || {};
    if (cut.box) {
      const [x0, x1, y0, y1, z0, z1] = cut.box;
      return { intersection: true, planes: [
        new T.Plane(new T.Vector3(-1, 0, 0), x0), new T.Plane(new T.Vector3(1, 0, 0), -x1),
        new T.Plane(new T.Vector3(0, -1, 0), y0), new T.Plane(new T.Vector3(0, 1, 0), -y1),
        new T.Plane(new T.Vector3(0, 0, -1), z0), new T.Plane(new T.Vector3(0, 0, 1), -z1)] };
    }
    const planes = [];
    if (cut.normal) {
      // PyVista's clip keeps the side the normal points away from.
      const n = new T.Vector3(...cut.normal).normalize();
      planes.push(new T.Plane(n.clone().negate(), n.dot(centre)));
    }
    if (p.cut_front !== undefined) planes.push(new T.Plane(new T.Vector3(-1, 0, 0), p.cut_front));
    if (p.keep_front !== undefined) planes.push(new T.Plane(new T.Vector3(1, 0, 0), -p.keep_front));
    return planes.length ? { intersection: false, planes } : null;
  }

  balls(centres, radius, mat) {
    const T = this.T;
    const ball = new T.SphereGeometry(radius, 12, 12);
    const mesh = new T.InstancedMesh(ball, mat, centres.length);
    const m = new T.Matrix4();
    centres.forEach((c, i) => { m.makeTranslation(c[0], c[1], c[2]); mesh.setMatrixAt(i, m); });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  addParts(scene) {
    const T = this.T;
    for (const p of scene.parts || []) {
      const mat = this.material(p.colour, { opacity: p.opacity ?? 1, lit: p.lighting !== false,
        clip: this.clipFor(p), flat: ["box", "prism", "polyhedron"].includes(p.shape) });
      if (p.shape === "points" || p.shape === "particles") {
        const mesh = this.balls(p.centres, p.radius, mat);
        this.world.add(mesh);
        if (p.shape === "particles" && p.wave) this.waves.push({ mesh, base: p.centres, wave: p.wave });
        continue;
      }
      const mesh = new T.Mesh(this.geometry(p, !!p.orbit), mat);
      if (p.opacity !== undefined && p.opacity < 1) mesh.renderOrder = 1;
      this.world.add(mesh);
      if (p.orbit) this.movers.push({ mesh, orbit: p.orbit, id: p.id });
    }
    const fixed = (scene.labels || []).filter((l) => !("follow" in l));
    for (const l of fixed) this.labels.push(this.label(l.text, l.at, 14, l.anchor));
    for (const l of (scene.labels || []).filter((l) => "follow" in l)) {
      const item = this.label(l.text, [0, 0, 0], 13);
      this.followers.push({ item, id: l.follow, offset: l.offset || [0, 0, 0.6] });
      this.labels.push(item);
    }
  }

  addMolecule(scene) {
    const T = this.T;
    const atoms = scene.atoms;
    const detail = atoms.length <= 20 ? 28 : 18;
    const byColour = new Map();
    const add = (colour, g) => { if (!byColour.has(colour)) byColour.set(colour, []); byColour.get(colour).push(g); };
    for (const a of atoms) {
      const g = new T.SphereGeometry(a.radius, detail, detail);
      g.translate(...a.pos);
      add(a.colour, g);
    }
    for (const bond of scene.bonds || []) {
      const a = atoms[bond.a], b = atoms[bond.b];
      const pa = new T.Vector3(...a.pos), pb = new T.Vector3(...b.pos);
      const axis = pb.clone().sub(pa);
      const length = axis.length();
      if (length < 1e-6) continue;
      axis.divideScalar(length);
      let side = axis.clone().cross(new T.Vector3(0, 0, 1));
      if (side.length() < 1e-3) side = axis.clone().cross(new T.Vector3(0, 1, 0));
      side.normalize();
      const offsets = { 1: [0], 2: [-0.5, 0.5], 3: [-1, 0, 1] }[bond.order] || [0];
      const radius = bond.order === 1 ? BOND_RADIUS : BOND_RADIUS * 0.7;
      const middle = pa.clone().add(pb).multiplyScalar(0.5);
      for (const k of offsets) {
        const shift = side.clone().multiplyScalar(k * BOND_GAP * 2);
        // Two halves, each the colour of the atom at its end.
        for (const [start, end, colour] of [[pa, middle, a.colour], [middle, pb, b.colour]]) {
          const dir = end.clone().sub(start);
          const g = new T.CylinderGeometry(radius, radius, dir.length(), Math.max(8, detail >> 1), 1, true);
          g.rotateX(Math.PI / 2);
          g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), dir.clone().normalize()));
          const c = start.clone().add(end).multiplyScalar(0.5).add(shift);
          g.translate(c.x, c.y, c.z);
          add(colour, g);
        }
      }
    }
    for (const [colour, list] of byColour) {
      for (const g of list) {
        this.world.add(new T.Mesh(g, this.material(colour)));
      }
    }
    if (scene.labels) {
      // Dark letters on light balls, white on dark ones.
      for (const a of atoms) {
        const light = isLight(a.colour);
        const item = this.label(a.element, a.pos, 17);
        item.el.classList.add(light ? "dark" : "light");
        item.el.classList.add("atom");
        this.labels.push(item);
      }
    }
  }

  label(text, where, size, anchor = null) {
    const el = h("div", { class: "m3-label", text, style: { fontSize: `${Math.round(size * 1.15)}px` } });
    this.labelLayer.appendChild(el);
    let line = null;
    if (anchor) {
      line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("stroke", LEADER_COLOUR);
      line.setAttribute("stroke-width", "2");
      this.leaders.appendChild(line);
    }
    return { el, at: new this.T.Vector3(...where), anchor: anchor ? new this.T.Vector3(...anchor) : null, line };
  }

  // viewer3d._frame_camera: the parts from the front (xz), a molecule from
  // the corner (iso); framed to fit, then zoomed in a little.
  frame() {
    const T = this.T;
    const view = this.scene.view || {};
    const parts = this.scene.kind === "parts";
    const box = new T.Box3().setFromObject(this.world);
    // The pointer lines are part of the model's own layer on the device, so
    // its camera frames them too (and the words at their ends stay in view).
    for (const item of this.labels) {
      if (!item.anchor) continue;
      box.expandByPoint(item.anchor);
      box.expandByPoint(item.anchor.clone().lerp(item.at, 0.86));
    }
    if (box.isEmpty()) box.set(new T.Vector3(-1, -1, -1), new T.Vector3(1, 1, 1));
    const sphere = box.getBoundingSphere(new T.Sphere());
    this.focal.copy(sphere.center);
    const named = { xz: [0, -1, 0], xy: [0, 0, 1], yz: [1, 0, 0], iso: [1, 1, 1],
      zx: [0, 1, 0], yx: [0, 0, -1], zy: [-1, 0, 0] };
    const camera = view.camera || (parts ? "xz" : "iso");
    let dir;
    let up = new T.Vector3(0, 0, 1);
    if (Array.isArray(camera) && Array.isArray(camera[0])) {
      dir = new T.Vector3(...camera[0]).sub(new T.Vector3(...camera[1]));
      if (camera[2]) up = new T.Vector3(...camera[2]);
    } else {
      dir = new T.Vector3(...(named[camera] || named.iso));
      if (camera === "xy" || camera === "yx") up = new T.Vector3(0, 1, 0);
    }
    dir.normalize();
    this.radius = sphere.radius || 1;
    this.camera.up.copy(up);
    this.place(dir);
    if (view.azimuth) this.orbit(view.azimuth, 0);
    if (view.elevation) this.orbit(0, view.elevation);
    this.zoomFactor = view.zoom || 1.25;
    this.applyFov();
  }

  place(dir) {
    // VTK's ResetCamera: far enough back for the bounding sphere to fit a
    // 30 degree view, whichever way of the window is narrower.
    const aspect = this.w / this.h;
    let angle = (30 * Math.PI) / 180;
    if (aspect < 1) angle = 2 * Math.atan(Math.tan(angle / 2) * aspect);
    const distance = this.radius / Math.sin(angle / 2);
    this.camera.position.copy(this.focal).addScaledVector(dir, distance);
    this.camera.lookAt(this.focal);
    this.camera.near = Math.max(distance - this.radius * 3, distance / 1000);
    this.camera.far = distance + this.radius * 3;
  }

  applyFov() {
    this.camera.fov = 30 / this.zoomFactor;
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
  }

  // VTK's Azimuth then Elevation, round the focal point, and
  // OrthogonalizeViewUp after: the camera's own up follows the tilt.
  orbit(dAzimuth, dElevation) {
    const T = this.T;
    const offset = this.camera.position.clone().sub(this.focal);
    const up = this.camera.up.clone().normalize();
    offset.applyAxisAngle(up, (dAzimuth * Math.PI) / 180);
    const forward = offset.clone().negate().normalize();
    const right = forward.clone().cross(up).normalize();
    const tilt = (dElevation * Math.PI) / 180;
    offset.applyAxisAngle(right, -tilt);
    const newUp = up.clone().applyAxisAngle(right, -tilt);
    this.camera.position.copy(this.focal).add(offset);
    this.camera.up.copy(newUp);
    this.camera.lookAt(this.focal);
    // OrthogonalizeViewUp
    const f = this.focal.clone().sub(this.camera.position).normalize();
    const r = f.clone().cross(this.camera.up).normalize();
    this.camera.up.copy(r.cross(f).normalize());
    this.camera.lookAt(this.focal);
    void T;
  }

  size(w, hgt) {
    this.w = w;
    this.h = hgt;
    this.renderer.setSize(w, hgt, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${hgt}px`;
    this.leaders.setAttribute("viewBox", `0 0 ${w} ${hgt}`);
    this.leaders.style.width = `${w}px`;
    this.leaders.style.height = `${hgt}px`;
    const dir = this.camera.position.clone().sub(this.focal).normalize();
    this.place(dir);
    this.applyFov();
    this.labelLayer.style.display = w >= LABELS_MIN_WIDTH || this.scene.kind === "molecule" ? "" : "none";
    this.leaders.style.display = this.labelLayer.style.display;
    this.draw();
  }

  spin(on) { this.spinning = on && this.scene.spin !== false; }
  animate(on) { this.animating = on && !!this.scene.animated; }
  turn(dAzimuth, dElevation) { this.orbit(dAzimuth, dElevation); this.draw(); }
  dragEnd() {}
  zoom(factor) { this.zoomFactor *= factor; this.applyFov(); this.draw(); }
  reset() { this.frame(); this.draw(); }

  // Orbits round a point or round another part; waves of little balls.
  advance(step) {
    const T = this.T;
    this.clock += step;
    const where = new Map();
    for (const { mesh, orbit, id } of this.movers) {
      const around = orbit.around ?? [0, 0, 0];
      const centre = typeof around === "string" ? (where.get(around) || new T.Vector3()) : new T.Vector3(...around);
      const position = centre.clone();
      if (orbit.radius) {
        const [u, v] = basis(T, orbit.normal || [0, 0, 1]);
        const angle = (orbit.phase || 0) + (TAU * this.clock) / orbit.period;
        position.addScaledVector(u, orbit.radius * Math.cos(angle)).addScaledVector(v, orbit.radius * Math.sin(angle));
      }
      mesh.position.copy(position);
      if (id) where.set(id, position);
    }
    const m = new T.Matrix4();
    for (const { mesh, base, wave } of this.waves) {
      const travel = wave.travel, axis = wave.axis;
      base.forEach((b, i) => {
        const along = b[0] * travel[0] + b[1] * travel[1] + b[2] * travel[2];
        const phase = (TAU * this.clock) / wave.period - (TAU * along) / wave.wavelength;
        const s = wave.amplitude * Math.sin(phase);
        m.makeTranslation(b[0] + s * axis[0], b[1] + s * axis[1], b[2] + s * axis[2]);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const f of this.followers) {
      const p = where.get(f.id) || new T.Vector3();
      f.item.at.copy(p).add(new T.Vector3(...f.offset));
    }
  }

  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    const step = Math.min((now - this.last) / 1000, 0.2);
    this.last = now;
    let dirty = false;
    if (this.spinning) { this.orbit(SPIN_DEG_PER_S * step, 0); dirty = true; }
    if (this.animating) { this.advance(step); dirty = true; }
    if (dirty) this.draw();
  }

  draw() {
    this.head.position.copy(this.camera.position);
    this.head.target.position.copy(this.focal);
    this.renderer.render(this.world, this.camera);
    if (this.labelLayer.style.display === "none") return;
    const v = new this.T.Vector3();
    const toScreen = (p) => {
      v.copy(p).project(this.camera);
      return [(v.x + 1) / 2 * this.w, (1 - v.y) / 2 * this.h, v.z];
    };
    for (const item of this.labels) {
      const [x, y, z] = toScreen(item.at);
      item.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      item.el.style.visibility = z > 1 ? "hidden" : "";
      if (item.line) {
        // Stopped short of the words, so it points AT them.
        const [ax, ay] = toScreen(item.anchor);
        item.line.setAttribute("x1", ax);
        item.line.setAttribute("y1", ay);
        item.line.setAttribute("x2", ax + (x - ax) * 0.86);
        item.line.setAttribute("y2", ay + (y - ay) * 0.86);
      }
    }
  }

  // A still of the whole model for the board, framed afresh.
  still() {
    this.frame();
    this.labelLayer.style.display = "none";
    this.renderer.render(this.world, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.world.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

// A tube through the points as given: straight between them, as
// pyvista.lines_from_points draws it.
function PolylineCurve(T, points, closed) {
  const pts = closed ? [...points, points[0]] : points;
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = lengths[lengths.length - 1] || 1;
  const curve = new T.Curve();
  curve.getPoint = (t, target = new T.Vector3()) => {
    const d = t * total;
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < d) i++;
    const seg = lengths[i] - lengths[i - 1] || 1;
    return target.copy(pts[i - 1]).lerp(pts[i], (d - lengths[i - 1]) / seg);
  };
  return curve;
}

function basis(T, normal) {
  const n = new T.Vector3(...normal).normalize();
  const helper = Math.abs(n.x) < 0.9 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0);
  const u = n.clone().cross(helper).normalize();
  return [u, n.clone().cross(u)];
}

function isLight(colour) {
  const r = parseInt(colour.slice(1, 3), 16), g = parseInt(colour.slice(3, 5), 16), b = parseInt(colour.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}
