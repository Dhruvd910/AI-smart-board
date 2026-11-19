// Labels on the model: HTML text (so Hindi shapes properly) with SVG
// leader lines back to the part.
//
// Progressive disclosure: the selected part first, then its sub-parts, then
// the major parts; minor parts only once you have zoomed in. Labels are
// pushed outward from the model's centre and nudged up or down to avoid one
// another; one that still collides is left out rather than drawn on top.
import * as THREE from 'three';

const MAX_LABELS = 12;
const v = new THREE.Vector3();

export class Labels {
  constructor(layer, svg, sceneMgr, onTap) {
    this.layer = layer;
    this.svg = svg;
    this.sm = sceneMgr;
    this.onTap = onTap;
    this.enabled = true;
    this.lang = 'en';
    this.items = new Map();
    sceneMgr.onFrame.push(() => this.update());
  }

  setModel(model, interaction) {
    this.clear();
    this.model = model;
    this.ix = interaction;
    if (!model) return;
    model.root.updateMatrixWorld(true);
    for (const [id, entry] of model.components) {
      if (!entry.objects.length) continue;
      // Remember the anchor in the part's own frame, so it rides along when
      // the part moves (orbits, the exploded view, animations).
      const host = entry.objects.length === 1 ? entry.objects[0] : model.root;
      const local = host.worldToLocal(this._anchor(model, id, entry));
      const el = document.createElement('button');
      el.className = 'label';
      el.type = 'button';
      el.addEventListener('pointerup', e => { e.stopPropagation(); this.onTap(id); });
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      this.svg.appendChild(line);
      this.layer.appendChild(el);
      this.items.set(id, { el, line, host, local, meta: entry.meta });
    }
    this.setLanguage(this.lang);
  }

  // Where a label's line should point. Moving particles: the middle of their
  // tap volume, not wherever they were at load. A skin around everything (a
  // membrane, a containment dome): a point ON the skin, found by casting a ray
  // in from outside -- its centre is the middle of some other part.
  _anchor(model, id, entry) {
    const proxies = entry.meshes.filter(m => m.userData.proxy);
    if (proxies.length) {
      const b = new THREE.Box3();
      proxies.forEach(p => b.expandByObject(p));
      return b.getCenter(new THREE.Vector3());
    }
    const s = model.bounds(id);
    if (entry.meta.outer) {
      const dir = new THREE.Vector3(-0.55, 0.45, 0.7).normalize();
      const ray = new THREE.Raycaster(s.center.clone().addScaledVector(dir, s.radius * 3), dir.clone().negate());
      const hit = ray.intersectObjects(entry.meshes, false)[0];
      if (hit) return hit.point;
    }
    return s.center.clone();
  }

  setLanguage(lang) {
    this.lang = lang;
    for (const it of this.items.values()) it.el.textContent = (lang === 'hi' && it.meta.label_hi) || it.meta.label;
  }

  clear() {
    for (const it of this.items.values()) { it.el.remove(); it.line.remove(); }
    this.items.clear();
  }

  _wanted() {
    const ix = this.ix, sel = ix.selected;
    const zoomedIn = this.sm.distanceRatio() < 0.6;
    const out = [];
    for (const [id, it] of this.items) {
      const meta = it.meta;
      if (ix.hidden.has(id) || (meta.parent_id && ix.hidden.has(meta.parent_id))) continue;
      if (ix.isolated && id !== ix.isolated && meta.parent_id !== ix.isolated) continue;
      let p = null;
      if (id === sel) p = 0;
      else if (sel && meta.parent_id === sel) p = 1;
      else if (!this.enabled) continue;
      else if (meta.major && !meta.parent_id) p = 2;
      else if (zoomedIn && !sel) p = 3;
      if (p !== null) out.push([p, id, it]);
    }
    return out.sort((a, b) => a[0] - b[0]);
  }

  update() {
    if (!this.model || !this.ix) return;
    const w = window.innerWidth, h = window.innerHeight;
    v.copy(this.model.center).project(this.sm.camera);
    const cx = (v.x + 1) / 2 * w, cy = (1 - v.y) / 2 * h;
    const placed = [];
    const shown = new Set();
    const area = this.sm.freeArea();
    const right = area.x1;
    let others = 0;
    for (const [prio, id, it] of this._wanted()) {
      if (shown.size >= MAX_LABELS) break;
      // With a part picked, a few major names for orientation, not all of them.
      if (this.ix.selected && prio >= 2 && ++others > 5) continue;
      it.host.localToWorld(v.copy(it.local));
      v.project(this.sm.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
      const ax = (v.x + 1) / 2 * w, ay = (1 - v.y) / 2 * h;
      if (ax > right || ax < area.x0 || ay < area.y0 || ay > area.y1) continue;
      let dx = ax - cx, dy = ay - cy;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      if (len < 4) { dx = 1; dy = 0; }
      const lw = it.el.offsetWidth || 90, lh = it.el.offsetHeight || 24;
      const push = prio === 0 ? 34 : 46;
      let lx = ax + dx * push + (dx < 0 ? -lw : 0), ly = ay + dy * push - lh / 2;
      let ok = false;
      for (let k = 0; k < 7; k++) {
        const off = [0, -1, 1, -2, 2, -3, 3][k] * (lh + 4);
        const r = { x: Math.max(area.x0 + 4, Math.min(right - lw - 4, lx)), y: Math.max(area.y0 + 4, Math.min(area.y1 - lh - 4, ly + off)), w: lw, h: lh };
        if (!placed.some(q => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h)) {
          lx = r.x; ly = r.y; ok = true; placed.push(r); break;
        }
      }
      if (!ok && prio > 1) continue;
      shown.add(id);
      it.el.style.transform = `translate(${Math.round(lx)}px, ${Math.round(ly)}px)`;
      it.el.classList.toggle('selected', prio === 0);
      it.el.classList.add('on');
      const ex = lx + (dx < 0 ? lw : 0), ey = ly + lh / 2;
      it.line.setAttribute('x1', ax); it.line.setAttribute('y1', ay);
      it.line.setAttribute('x2', ex); it.line.setAttribute('y2', ey);
      it.line.setAttribute('class', prio === 0 ? 'sel' : '');
      it.line.style.display = '';
    }
    for (const [id, it] of this.items) {
      if (!shown.has(id)) { it.el.classList.remove('on'); it.line.style.display = 'none'; }
    }
  }
}
