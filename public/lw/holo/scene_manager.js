// One renderer, one scene, one camera for the life of the page.
//
// It draws only when something changed (a drag, a tween, an animation), not
// sixty times a second for a still model: on the Pi that is the difference
// between the GPU idling and Liza's speech stuttering.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneManager {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // The Pi's screen is 800x480 at 1:1; never render more pixels than it shows.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#060b18');
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 2000);
    this.camera.position.set(0, 0, 10);
    this.scene.add(new THREE.HemisphereLight('#dbe8ff', '#1a1f33', 1.4));
    const key = new THREE.DirectionalLight('#ffffff', 1.6);
    key.position.set(4, 6, 8);
    this.camera.add(key);      // the light follows the eye, so the side you look at is lit
    this.scene.add(this.camera);
    this.scene.add(this._grid());

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.rotateSpeed = 0.8;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', () => this.wake());

    this.clock = new THREE.Clock();
    this.time = 0;
    this.continuous = false;     // true while something animates
    this._awake = 2;             // frames still to draw
    this.tweens = [];
    this.onFrame = [];
    this.fps = 0;
    this._frames = 0; this._fpsT = performance.now();
    this.home = { pos: new THREE.Vector3(0, 0, 10), target: new THREE.Vector3() };
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this._loop());
  }

  _grid() {
    // A faint holographic floor ring, to give the model a place to stand.
    const g = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: '#38e1ff', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
    [1, 0.7].forEach((r, i) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.006, r, 96), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.material = i ? ringMat.clone() : ringMat;
      if (i) ring.material.opacity = 0.09;
      g.add(ring);
    });
    g.name = '__floor';
    this.floor = g;
    return g;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this._applyInset();
    this.wake();
  }

  // Keep the model centred in the part of the screen the bars and the panel
  // leave free: the projection is shifted, so labels and taps stay exact.
  setInsets(insets) {
    this.insets = { top: 0, left: 0, right: 0, bottom: 0, ...insets };
    this.insetRight = this.insets.right;
    this._applyInset();
    this.wake();
  }
  setInsetRight(px) { this.setInsets({ ...(this.insets || {}), right: px }); }
  freeArea() {
    const i = this.insets || { top: 0, left: 0, right: 0, bottom: 0 };
    return { x0: i.left, y0: i.top, x1: window.innerWidth - i.right, y1: window.innerHeight - i.bottom };
  }
  _applyInset() {
    const w = window.innerWidth, h = window.innerHeight, i = this.insets || { top: 0, left: 0, right: 0, bottom: 0 };
    const dx = (i.right - i.left) / 2, dy = (i.bottom - i.top) / 2;
    if (dx || dy) this.camera.setViewOffset(w, h, dx, dy, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  wake(frames = 2) { this._awake = Math.max(this._awake, frames); }

  // Frame a bounding sphere: centre and radius in world units.
  frame(center, radius, { setHome = false, duration = 600, direction = null } = {}) {
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    // Fit inside the free middle, not the whole screen.
    const a = this.freeArea ? this.freeArea() : null;
    const fh = a ? (a.y1 - a.y0) / window.innerHeight : 1, fw = a ? (a.x1 - a.x0) / window.innerWidth : 1;
    const vHalf = Math.atan(Math.tan(fov / 2) * fh), hHalf = Math.atan(Math.tan(fov / 2) * this.camera.aspect * fw);
    const fit = Math.max(radius / Math.sin(vHalf), radius / Math.sin(hHalf));
    const dir = (direction || this.camera.position.clone().sub(this.controls.target)).normalize();
    if (dir.lengthSq() < 1e-6) dir.set(0.3, 0.35, 1).normalize();
    // A bounding sphere is generous for long shapes; 0.92 fills the space better.
    const pos = center.clone().add(dir.multiplyScalar(fit * 1.02));
    if (setHome) {
      this.home = { pos: pos.clone(), target: center.clone(), radius };
      this.controls.minDistance = radius * 0.08;
      this.controls.maxDistance = fit * 4;
      this.camera.near = Math.max(radius / 500, 0.001);
      this.camera.far = fit * 20;
      this.camera.updateProjectionMatrix();
      this.floor.scale.setScalar(radius * 1.3);
      this.floor.position.set(center.x, center.y - radius * 0.95, center.z);
    }
    this.tweenTo(pos, center, duration);
  }

  tweenTo(pos, target, duration = 600) {
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    if (duration <= 0) {
      this.camera.position.copy(pos); this.controls.target.copy(target); this.controls.update(); this.wake();
      return;
    }
    const start = performance.now();
    this.tweens = [{ step: now => {
      const u = Math.min(1, (now - start) / duration);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      this.camera.position.lerpVectors(p0, pos, e);
      this.controls.target.lerpVectors(t0, target, e);
      return u >= 1;
    } }];
    this.wake();
  }

  goHome(duration = 600) { this.tweenTo(this.home.pos, this.home.target, duration); }

  zoom(factor) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(off.length() / factor, this.controls.minDistance, this.controls.maxDistance);
    this.tweenTo(this.controls.target.clone().add(off.setLength(len)), this.controls.target.clone(), 250);
  }

  distanceRatio() {
    const d = this.camera.position.distanceTo(this.controls.target);
    const h = this.home.pos.distanceTo(this.home.target) || 1;
    return d / h;
  }

  _loop() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const now = performance.now();
    if (this.tweens.length) {
      this.tweens = this.tweens.filter(t => !t.step(now));
      this._awake = Math.max(this._awake, 1);
    }
    const damping = this.controls.update();
    if (!(this.continuous || this._awake > 0 || damping)) return;
    if (this.continuous) this.time += dt;
    for (const f of this.onFrame) f(this.continuous ? dt : 0, this.time);
    this.renderer.render(this.scene, this.camera);
    this._awake = Math.max(0, this._awake - 1);
    this._frames++;
    if (now - this._fpsT >= 1000) {
      this.fps = Math.round(this._frames * 1000 / (now - this._fpsT));
      this._frames = 0; this._fpsT = now;
    }
  }

  // Draw continuously for `ms` and report the frame rate actually reached.
  measureFps(ms = 2000) {
    return new Promise(resolve => {
      const was = this.continuous;
      this.continuous = true;
      const f0 = this._frames, t0 = performance.now();
      let total = 0, last = f0;
      const tick = () => {
        // _frames resets every second; count what it adds up to.
        const cur = this._frames;
        total += cur >= last ? cur - last : cur;
        last = cur;
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else { this.continuous = was; resolve(Math.round(total * 1000 / (performance.now() - t0))); }
      };
      requestAnimationFrame(tick);
    });
  }
}
