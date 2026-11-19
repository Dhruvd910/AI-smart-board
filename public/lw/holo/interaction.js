// Picking, highlighting, hiding, isolating, cutaways and the exploded view.
//
// Nothing here edits geometry or the loaded materials: each mesh keeps its
// original material, and highlighted / see-through versions are clones made
// on first use (and disposed with the model). Restoring is putting the
// original back.
import * as THREE from 'three';

const HIGHLIGHT = new THREE.Color('#2fd8ff');

function variant(mesh, kind) {
  const ud = mesh.userData;
  if (!ud.__orig) ud.__orig = mesh.material;
  const key = '__' + kind;
  if (!ud[key]) {
    const make = m => {
      const c = m.clone();
      if (kind === 'hl') {
        if (c.emissive) { c.emissive = HIGHLIGHT.clone(); c.emissiveIntensity = 0.55; }
        else if (c.color) c.color.lerp(HIGHLIGHT, 0.5);
      } else {
        c.transparent = true;
        c.opacity = Math.min(m.opacity ?? 1, 0.12);
        c.depthWrite = false;
      }
      (ud.__mats = ud.__mats || []).push(c);
      return c;
    };
    ud[key] = Array.isArray(ud.__orig) ? ud.__orig.map(make) : make(ud.__orig);
  }
  return ud[key];
}
function forEachMat(mesh, fn) {
  for (const k of ['__orig', '__hl', '__ghost']) {
    const v = mesh.userData[k] || (k === '__orig' ? mesh.material : null);
    if (v) [].concat(v).forEach(fn);
  }
}
function visibleChain(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

export class Interaction {
  constructor(sceneMgr, canvas, onPick) {
    this.sm = sceneMgr;
    this.model = null;
    this.selected = null;
    this.hidden = new Set();
    this.isolated = null;
    this.cutaway = false;
    this.exploded = false;
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    this.raycaster = new THREE.Raycaster();
    this.onPick = onPick;
    // A tap is a press and release that barely moved -- generous, because
    // the Pi's resistive panel jitters by several pixels on a still finger.
    let down = null;
    canvas.addEventListener('pointerdown', e => { if (e.isPrimary) down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    canvas.addEventListener('pointerup', e => {
      if (!down || !e.isPrimary) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 14 && performance.now() - down.t < 600) this.tap(e.clientX, e.clientY);
      down = null;
    });
  }

  setModel(model) {
    this.model = model;
    this.selected = null;
    this.hidden.clear();
    this.isolated = null;
    this.cutaway = false;
    this.exploded = false;
    this._explodeT = 0;
  }

  // ---------- picking ----------
  tap(x, y) {
    if (!this.model) return;
    const r = this.sm.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.sm.camera);
    const hits = this.raycaster.intersectObject(this.model.root, true).filter(h => {
      const o = h.object;
      if (!visibleChain(o)) return false;
      if (!o.userData.proxy && o.material && [].concat(o.material).every(m => m.visible === false)) return false;
      if (this.cutaway && this._clipped(o) && this.clipPlane.distanceToPoint(h.point) < 0) return false;
      return true;
    });
    // See-through parts are seen through: prefer a solid one behind them.
    const solid = hits.find(h => !this._isGhost(h.object) && this.model.meshToComp.has(h.object));
    const hit = solid || hits.find(h => this.model.meshToComp.has(h.object));
    const id = hit ? this.model.meshToComp.get(hit.object) : null;
    this.onPick(id, !!hits.length);
  }

  _isGhost(o) { return o.material === o.userData.__ghost; }
  _clipped(o) {
    if (o.userData.clip) return true;
    const id = this.model.meshToComp.get(o);
    return !!(id && this.model.components.get(id).meta.outer);
  }

  // ---------- appearance ----------
  _apply() {
    const m = this.model;
    if (!m) return;
    const sel = this.selected ? new Set(m.meshesOf(this.selected)) : null;
    const outerGhost = this.cutaway && m.manifest.cutaway === 'transparent_outer';
    for (const mesh of m.allMeshes) {
      const id = m.meshToComp.get(mesh);
      const meta = id ? m.components.get(id).meta : null;
      let visible = true;
      if (id && this.hidden.has(id)) visible = false;
      if (this.isolated) visible = !!(sel && sel.has(mesh)) || mesh.userData.proxy;
      for (const h of this.hidden) if (m.meshesOf(h).includes(mesh)) visible = false;
      mesh.visible = visible;
      let kind = 'orig';
      if (sel && sel.has(mesh)) kind = 'hl';
      else if (outerGhost && meta && meta.outer) kind = 'ghost';
      else if (sel && this.ghostOthers) kind = 'ghost';
      const want = kind === 'orig' ? (mesh.userData.__orig || mesh.material) : variant(mesh, kind);
      if (mesh.material !== want) { if (!mesh.userData.__orig) mesh.userData.__orig = mesh.material; mesh.material = want; }
    }
    this.sm.wake();
  }

  select(id) {
    if (id && !this.model.components.has(id) && !(this.model.manifest.groups || {})[id]) return false;
    this.selected = id || null;
    if (this.isolated && id) this.isolated = id;
    if (!id) this.isolated = null;
    this._apply();
    return true;
  }

  focus(id) {
    const s = this.model.bounds(id);
    // Small parts get room around them for context; a part nearly as big as
    // the model (a black hole's disk) is framed snugly, or focusing zooms out.
    const margin = s.radius < this.model.radius * 0.5 ? 1.8 : 1.05;
    this.sm.frame(s.center, Math.max(s.radius * margin, this.model.radius * 0.35));
  }

  hide(id) { if (!id) return; this.hidden.add(id); if (this.selected === id) this.selected = null; this._apply(); }
  show(id) { this.hidden.delete(id); this._apply(); }
  isolate(id) { if (!id) return; this.selected = id; this.isolated = id; this.hidden.clear(); this._apply(); }
  showAll() { this.hidden.clear(); this.isolated = null; this.ghostOthers = false; this._apply(); }
  setGhostOthers(on) { this.ghostOthers = on; this._apply(); }

  // ---------- inside the model ----------
  setCutaway(on) {
    const m = this.model;
    if (!m || !m.manifest.cutaway) return false;
    this.cutaway = on;
    if (m.manifest.cutaway === 'clip_plane') {
      // Cut along the plane facing the camera through the model's centre, so
      // the half nearest the viewer is taken away.
      const n = this.sm.camera.position.clone().sub(m.center).normalize().negate();
      this.clipPlane.setFromNormalAndCoplanarPoint(n, m.center);
      for (const mesh of m.allMeshes) {
        if (!this._clipped(mesh)) continue;
        forEachMat(mesh, mat => { mat.clippingPlanes = on ? [this.clipPlane] : null; mat.clipShadows = true; mat.needsUpdate = true; });
      }
    }
    this._apply();
    return true;
  }

  setExploded(on) {
    const m = this.model;
    if (!m || !m.manifest.components.length) return false;
    this.exploded = on;
    const tops = m.manifest.components.filter(c => !c.parent_id && !c.outer);
    const start = performance.now();
    const items = [];
    for (const c of tops) {
      const entry = m.components.get(c.id);
      const s = m.bounds(c.id);
      const dir = s.center.clone().sub(m.center);
      if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0);
      dir.normalize().multiplyScalar(m.radius * 0.45);
      for (const obj of entry.objects) {
        if (!obj.userData.__pos0) obj.userData.__pos0 = obj.position.clone();
        let to = obj.userData.__pos0.clone();
        if (on && obj.parent) {
          // Move it by `dir` in world space, expressed in its parent's frame.
          const world = obj.parent.localToWorld(to.clone()).add(dir);
          to = obj.parent.worldToLocal(world);
        }
        items.push({ obj, from: obj.position.clone(), to });
      }
    }
    this.sm.tweens.push({ step: now => {
      const u = Math.min(1, (now - start) / 700);
      const e = 1 - Math.pow(1 - u, 3);
      items.forEach(it => it.obj.position.lerpVectors(it.from, it.to, e));
      return u >= 1;
    } });
    this.sm.wake();
    return true;
  }
}
