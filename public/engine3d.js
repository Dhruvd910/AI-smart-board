// Liza's 3D engine models as real 3D: the scenes tools/capture_engine.py took
// from her engine, played with Three.js. Unlike her web copy's videos they turn
// all the way round, zoom, and are drawn at the screen's own resolution. A
// simulation keeps her panel: its readouts as it runs, and sliders that load the
// capture made at that setting (as her videos load their takes).

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

let index = null;
let view = null;

export async function has(modelId) {
  if (!index) index = await fetch("scene3d/index.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return Boolean(index[modelId]);
}

export const isOpen = () => Boolean(view);

function decode(buf, quant) {
  const raw = Uint8Array.from(atob(buf.d), (c) => c.charCodeAt(0)).buffer;
  if (buf.k === "pos") {
    const q = new Uint16Array(raw), out = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) {
      const a = i % 3;
      out[i] = quant.lo[a] + (q[i] / 65535) * quant.span[a];
    }
    return out;
  }
  if (buf.k === "idx16") return new Uint16Array(raw);
  if (buf.k === "idx32") return new Uint32Array(raw);
  if (buf.k === "rgba") return new Uint8Array(raw);
  return new Float32Array(raw); // uv
}

// One captured scene, built into Three.js objects, with what each part does each frame.
async function build(file) {
  const data = await fetch(file).then((r) => {
    if (!r.ok) throw new Error("that model is not here");
    return r.json();
  });
  const arrays = data.buffers.map((b) => decode(b, data.quant));
  const textures = data.textures.map((url) => {
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  const root = new THREE.Group();
  const parts = [];
  for (const p of data.parts) {
    const colour = new THREE.Color(...p.colour);
    const geos = new Map();
    const label = p.texture !== null && p.texture !== undefined;
    // Each distinct shape the part takes, made once.
    const shape = (g) => {
      const key = JSON.stringify(g);
      if (geos.has(key)) return geos.get(key);
      const pos = arrays[g.p];
      const made = { pieces: [] };
      if (label && g.t !== undefined && pos.length === 12) {
        // A label tile: a picture that always faces you, the size it was in the scene.
        const box = new THREE.Box3().setFromArray(pos);
        const size = box.getSize(new THREE.Vector3());
        const dims = [size.x, size.y, size.z].sort((a, b) => b - a);
        made.sprite = { centre: box.getCenter(new THREE.Vector3()), w: dims[0], h: dims[1] };
      } else {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        if (g.c !== undefined) geo.setAttribute("color", new THREE.BufferAttribute(arrays[g.c], 4, true));
        if (g.uv !== undefined) geo.setAttribute("uv", new THREE.BufferAttribute(arrays[g.uv], 2));
        if (g.t !== undefined) {
          const tri = geo.clone();
          tri.setIndex(new THREE.BufferAttribute(arrays[g.t], 1));
          tri.computeVertexNormals();
          made.pieces.push(["mesh", tri]);
        }
        if (g.l !== undefined) {
          const seg = geo.clone();
          seg.setIndex(new THREE.BufferAttribute(arrays[g.l], 1));
          made.pieces.push(["line", seg]);
        }
        if (g.v !== undefined) {
          const pts = geo.clone();
          pts.setIndex(new THREE.BufferAttribute(arrays[g.v], 1));
          made.pieces.push(["points", pts]);
        }
      }
      geos.set(key, made);
      return made;
    };
    const vertexColours = p.keys.some(([, s]) => s.g && s.g.c !== undefined);
    const opts = { color: vertexColours ? 0xffffff : colour, opacity: p.opacity, transparent: p.opacity < 1,
      vertexColors: vertexColours, side: THREE.DoubleSide, map: label ? textures[p.texture] : null };
    const materials = {
      mesh: p.lit && !label ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.55, metalness: 0.05, wireframe: p.wire })
        : new THREE.MeshBasicMaterial({ ...opts, wireframe: p.wire }),
      line: new THREE.LineBasicMaterial({ color: opts.color, vertexColors: vertexColours, transparent: p.opacity < 1, opacity: p.opacity }),
      points: new THREE.PointsMaterial({ color: opts.color, vertexColors: vertexColours, size: Math.max(2, p.size || 4), sizeAttenuation: false }),
    };
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    root.add(holder);
    const objects = { mesh: new THREE.Mesh(undefined, materials.mesh), line: new THREE.LineSegments(undefined, materials.line),
      points: new THREE.Points(undefined, materials.points) };
    const sprite = label ? new THREE.Sprite(new THREE.SpriteMaterial({ map: textures[p.texture], depthTest: false, transparent: true })) : null;
    if (sprite) { sprite.renderOrder = 10; root.add(sprite); }
    for (const o of Object.values(objects)) { o.visible = false; holder.add(o); }
    // What it is on every frame: the last key at or before it.
    const frames = [];
    let state = { v: true, m: null, g: null };
    let k = 0;
    for (let f = 0; f < data.frames; f++) {
      while (k < p.keys.length && p.keys[k][0] <= f) {
        const s = p.keys[k][1];
        state = { v: "v" in s ? s.v : state.v, m: "m" in s ? s.m : state.m, g: "g" in s ? (s.g ? shape(s.g) : null) : state.g };
        k++;
      }
      frames.push(state);
    }
    parts.push({ holder, objects, sprite, frames });
  }
  return { data, root, parts };
}

function show(scene, f) {
  const m = new THREE.Matrix4();
  for (const p of scene.parts) {
    const s = p.frames[Math.min(f, p.frames.length - 1)];
    const on = s.v && s.g;
    if (s.m) { p.holder.matrix.fromArray(s.m); m.fromArray(s.m); }
    for (const [kind, o] of Object.entries(p.objects)) {
      const piece = on && s.g.pieces.find(([k]) => k === kind);
      o.visible = Boolean(piece);
      if (piece && o.geometry !== piece[1]) o.geometry = piece[1];
    }
    if (p.sprite) {
      p.sprite.visible = Boolean(on && s.g.sprite);
      if (p.sprite.visible) {
        p.sprite.position.copy(s.g.sprite.centre).applyMatrix4(s.m ? m : new THREE.Matrix4());
        p.sprite.scale.set(s.g.sprite.w, s.g.sprite.h, 1);
      }
    }
  }
}

// opts: {title, settings: [[name, value], ...] from her answer, onClose}
export async function open(modelId, { title = "", settings = [], onClose = () => {} } = {}) {
  if (!(await has(modelId))) return false;
  close();
  const entry = index[modelId];
  const el = document.createElement("div");
  el.className = "e3d";
  el.innerHTML = `<canvas></canvas>
    <div class="e3d-head"><b class="e3d-title"></b><button class="e3d-close" aria-label="Close">✕</button></div>
    <div class="e3d-hint">drag to turn · pinch or scroll to zoom</div>
    <div class="e3d-wait">Building the 3D model…</div>`;
  document.body.appendChild(el);
  el.querySelector(".e3d-title").textContent = title;
  const canvas = el.querySelector("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5)); // the screen's own sharpness
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1e6);
  // Made once the scene's "up" is known: OrbitControls fixes its up when it is
  // created, and her engine's scenes stand on Z, not Three.js's Y.
  let controls = null;
  const makeControls = () => {
    if (controls) controls.dispose();
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.addEventListener("start", () => { controls.autoRotate = false; });
    view.controls = controls;
  };
  const world = new THREE.Scene();
  world.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.1));
  const headlight = new THREE.DirectionalLight(0xffffff, 1.6);
  camera.add(headlight);
  headlight.position.set(0.3, 0.5, 1);
  world.add(camera);
  view = { el, renderer, controls: null, frame: 0, clock: performance.now(), playing: true, scene: null, onClose, raf: 0 };

  const resize = () => {
    const w = el.clientWidth, h = el.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  view.resize = resize;
  window.addEventListener("resize", resize);
  el.querySelector(".e3d-close").addEventListener("click", () => close());
  let currentFile = entry.file;
  async function load(file, keepCamera) {
    currentFile = file;
    const scene = await build(file);
    if (!view) return;
    if (view.scene) world.remove(view.scene.root);
    view.scene = scene;
    world.add(scene.root);
    world.background = new THREE.Color(...scene.data.background);
    if (!keepCamera) {
      const c = scene.data.camera;
      camera.fov = c.fov;
      camera.up.set(...c.up);
      camera.position.set(...c.position);
      makeControls();
      controls.target.set(...c.focal);
      // Room to turn it round: the far plane past the whole scene from anywhere.
      const [lo, hi] = scene.data.bounds;
      const span = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
      camera.near = span / 2000;
      camera.far = span * 50;
      controls.maxDistance = span * 6;
      controls.autoRotate = scene.data.spin;
      controls.autoRotateSpeed = 2;
      controls.update();
    }
    view.frame = 0;
    view.clock = performance.now();
    el.querySelector(".e3d-wait").hidden = true;
    resize();
    panel(scene.data);
  }

  // Her simulation panel: the readouts, and a slider per setting.
  function panel(data) {
    let box = el.querySelector(".e3d-panel");
    const params = (data.settings && data.settings.params) || null;
    if (!params && !data.readings) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement("div");
      box.className = "e3d-panel";
      el.appendChild(box);
    }
    box.replaceChildren();
    const reads = document.createElement("div");
    reads.className = "e3d-readings";
    box.appendChild(reads);
    view.readingsEl = reads;
    const takes = entry.takes || [];
    for (const [name, p] of Object.entries(params || {})) {
      const row = document.createElement("label");
      const stops = takes.filter((t) => name in t.values).map((t) => t.values[name]).concat([p.value]);
      const current = (data.settings.params[name] || p).value;
      row.innerHTML = `<span class="e3d-name"></span><input type="range"><b></b>`;
      row.querySelector(".e3d-name").textContent = p.description || name.replace(/_/g, " ");
      const input = row.querySelector("input");
      Object.assign(input, { min: p.min, max: p.max, step: "any", value: current });
      const shown = row.querySelector("b");
      const say = (v) => { shown.textContent = `${+(+v).toFixed(2)} ${p.unit || ""}`; };
      say(current);
      input.disabled = stops.length < 2;
      input.addEventListener("input", () => say(input.value));
      input.addEventListener("change", () => {
        // The capture made nearest where the finger let go (as her videos' takes).
        const want = +input.value;
        const best = stops.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
        input.value = best;
        say(best);
        const take = takes.find((t) => t.values[name] === best);
        load(take ? take.file : entry.file, true);
      });
      box.appendChild(row);
    }
    const buttons = document.createElement("div");
    buttons.className = "e3d-buttons";
    buttons.innerHTML = `<button data-do="play">Pause</button><button data-do="again">Start again</button><button data-do="view">Reset view</button>`;
    buttons.addEventListener("click", (e) => {
      const what = e.target.dataset.do;
      if (what === "play") { view.playing = !view.playing; e.target.textContent = view.playing ? "Pause" : "Play"; view.clock = performance.now() - view.frame * 1000 / view.scene.data.fps; }
      if (what === "again") { view.frame = 0; view.clock = performance.now(); }
      if (what === "view") load(currentFile, false);
    });
    box.appendChild(buttons);
  }

  function tick() {
    if (!view) return;
    view.raf = requestAnimationFrame(tick);
    if (controls) controls.update();
    const s = view.scene;
    if (s) {
      if (view.playing) view.frame = Math.floor(((performance.now() - view.clock) / 1000) * s.data.fps) % s.data.frames;
      show(s, view.frame);
      const r = s.data.readings && s.data.readings[view.frame];
      if (r && view.readingsEl) {
        view.readingsEl.innerHTML = Object.entries(r).map(([k, v]) => `<div><span>${k.replace(/_/g, " ")}</span><b>${v}</b></div>`).join("");
      }
    }
    renderer.render(world, camera);
  }
  tick();
  // A setting from her answer ("thrown at 30°"): the capture made nearest it.
  let first = entry.file;
  for (const [name, value] of settings || []) {
    const near = (entry.takes || []).filter((t) => name in t.values)
      .sort((a, b) => Math.abs(a.values[name] - value) - Math.abs(b.values[name] - value))[0];
    if (near) { first = near.file; break; }
  }
  try {
    await load(first, false);
  } catch (err) {
    el.querySelector(".e3d-wait").textContent = "Couldn't load the 3D model: " + err.message;
  }
  return true;
}

export function close() {
  if (!view) return;
  const v = view;
  view = null;
  cancelAnimationFrame(v.raf);
  window.removeEventListener("resize", v.resize);
  if (v.controls) v.controls.dispose();
  v.renderer.dispose();
  v.el.remove();
  v.onClose();
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
