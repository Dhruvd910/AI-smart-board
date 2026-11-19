// The explorer page: wires the scene, the model, the touch UI and Liza.
//
// Python decides WHAT to show (a validated model id and actions arrive over
// /api/events); this page decides how. It never receives code, paths or URLs
// from the AI -- only ids from the catalogue and names from a fixed list.
import * as THREE from 'three';
import { SceneManager } from './scene_manager.js';
import { loadModel } from './model_loader.js';
import { Interaction } from './interaction.js';
import { Labels } from './labels.js';
import { Guided } from './guided.js';

const params = new URLSearchParams(location.search);
const TOKEN = params.get('t') || '';
// Any script error lands in Liza's log, so a broken viewer is visible from there.
const sendError = (msg) => fetch('api/report', { method: 'POST', headers: { 'X-Holo-Token': TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ kind: 'js_error', error: String(msg).slice(0, 300) }) }).catch(() => {});
window.addEventListener('error', e => sendError(`${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', e => sendError(e.reason && (e.reason.stack || e.reason.message) || e.reason));
const $ = id => document.getElementById(id);
const TYPE_TEXT = {
  interactive_3d: ['Real 3D model', 'real'],
  schematic_3d: ['3D schematic', 'schematic'],
  animated_diagram: ['Animated diagram', 'animated'],
  static_illustration: ['Picture only', 'static'],
};

// Where the camera starts, after the model has been stood Y-up with its front
// (BodyParts3D's -y) towards +z.
const VIEW_FROM = {
  front: new THREE.Vector3(0, 0.12, 1), three_quarter: new THREE.Vector3(0.25, 0.3, 1),
  side: new THREE.Vector3(1, 0.2, 0.15), left: new THREE.Vector3(-1, 0.2, 0.15),
  back: new THREE.Vector3(0, 0.2, -1), top: new THREE.Vector3(0, 1, 0.05), above: new THREE.Vector3(0.15, 0.85, 0.75),
};

// The zones in styles.css, so the camera centres the model in the free middle.
const INSETS = { top: 52, left: 68, bottom: 66, panel: 280, tour: 84 };
const icon = name => `<svg><use href="#i-${name}"/></svg>`;

class UI {
  constructor(app) {
    this.app = app;
    $('back').onclick = () => app.back();
    $('home').onclick = () => { app.guided.stop(); app.select(null); app.ix.showAll(); app.sm.goHome(); this.refresh(); };
    $('zoomin').onclick = () => app.sm.zoom(1.35);
    $('zoomout').onclick = () => app.sm.zoom(1 / 1.35);
    $('mode').onclick = () => app.toggleMoveMode();
    $('tour-next').onclick = () => app.guided.next();
    $('tour-prev').onclick = () => app.guided.prev();
    $('tour-stop').onclick = () => app.guided.stop();
    $('p-close').onclick = () => app.select(null);
    $('p-focus').onclick = () => app.ix.focus(app.ix.selected);
    $('p-hide').onclick = () => { app.ix.hide(app.ix.selected); app.select(null); this.dock(); };
    $('p-isolate').onclick = () => {
      const id = app.ix.selected;
      if (app.ix.isolated === id) app.ix.showAll(); else app.ix.isolate(id);
      app.ix.focus(id); this.refresh(); app.reportState();
    };
    $('p-ask').onclick = () => app.askAI();
    $('p-inside').onclick = () => app.openNested();
    $('p-parent').onclick = () => {
      const c = app.comp(app.ix.selected);
      if (c && c.parent_id) { app.select(c.parent_id); app.ix.focus(c.parent_id); }
      else { app.select(null); app.sm.goHome(); }
    };
    $('err-back').onclick = () => app.back();
    $('err-retry').onclick = () => app.load(app.wantId);
    $('liza').onclick = () => app.api('POST', 'api/liza', { do: this._lizaSpeaking ? 'stop' : 'talk' }).catch(() => {});
    $('credits').onclick = () => $('creditbox').classList.toggle('open');
    $('creditbox').onclick = () => $('creditbox').classList.remove('open');
    this.layout();
  }

  // Tell the camera how much of the screen the bars and the panel take.
  layout() {
    const panel = document.body.classList.contains('panel-open');
    const touring = document.body.classList.contains('touring');
    this.app.sm.setInsets({ top: INSETS.top, left: INSETS.left, right: panel ? INSETS.panel : 0,
                            bottom: touring ? INSETS.tour : INSETS.bottom });
  }

  loading(text, frac) {
    $('loading').classList.toggle('open', text != null);
    if (text != null) { $('load-text').textContent = text; $('load-bar').style.width = `${Math.round((frac || 0) * 100)}%`; }
  }

  error(text) {
    $('error').classList.toggle('open', !!text);
    if (text) $('err-text').textContent = text;
  }

  model(m) {
    const lang = this.app.lang;
    $('title').textContent = (lang === 'hi' && m.title_hi) || m.title;
    const [t, cls] = TYPE_TEXT[m.visualization_type] || ['', ''];
    $('badge').textContent = t; $('badge').className = 'badge ' + cls;
    const overlay = this.app.model && this.app.model.builder && this.app.model.builder.overlay;
    $('formula').textContent = overlay || '';
    $('formula').classList.toggle('open', !!overlay);
    // The honesty note, briefly, where messages go; it stays in (i).
    if (m.fidelity_note) this.toast(m.fidelity_note, { note: true, ms: 4500 });
    const lic = m.license || {};
    $('creditbox').innerHTML = '';
    const add = (tag, text, cls) => { if (!text) return; const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; $('creditbox').appendChild(e); };
    add('h3', m.title);
    add('p', m.summary);
    add('p', m.fidelity_note);
    add('p', m.scale_note);
    add('p', `Licence: ${lic.id || 'unknown'}`);
    add('p', lic.attribution);
    add('p', m.reference ? `Reference: ${m.reference}` : '');
    add('p', !m.selectable ? 'This model is one piece: you can turn and zoom it, but its parts cannot be picked separately.' : '');
    add('p', 'Tap anywhere on this box to close it.', 'hint');
    this.panel(null);
    this.dock();
  }

  // The bottom dock: only the tools this model really has.
  dock() {
    const app = this.app, box = $('dock'), m = app.manifest;
    box.innerHTML = '';
    if (!m) return;
    const chip = (name, label, on, fn, cls = '') => {
      const b = document.createElement('button');
      b.className = `chip ${on ? 'on' : ''} ${cls}`;
      b.innerHTML = `${icon(name)}<span></span>`;
      b.querySelector('span').textContent = label;
      b.onclick = () => { fn(); this.dock(); app.reportState(); };
      box.appendChild(b);
    };
    if (app.navStack.length) chip('back', app.navStack[app.navStack.length - 1].title, false, () => app.closeNested());
    if ((m.guided || []).length) chip('play', 'Tour', false, () => app.guided.start(), 'tour');
    if (m.selectable) chip('tag', 'Labels', app.labels.enabled, () => app.setLabels(!app.labels.enabled));
    if (m.cutaway === 'clip_plane') chip('layers', 'Cut open', app.ix.cutaway, () => app.ix.setCutaway(!app.ix.cutaway));
    if (m.cutaway === 'transparent_outer') chip('layers', 'See inside', app.ix.cutaway, () => app.ix.setCutaway(!app.ix.cutaway));
    if (m.explode) chip('apart', 'Pull apart', app.ix.exploded, () => app.ix.setExploded(!app.ix.exploded));
    if (app.model && app.model.mixer) chip('motion', 'Animate', app.animating, () => app.toggleAnimation());
    for (const c of (app.model && app.model.builder && app.model.builder.controls) || []) {
      chip('gear', c.label, c.active, () => { if (c.toggle() === 'refit') app.refit(); app.sm.wake(); });
    }
    if (app.ix.hidden.size || app.ix.isolated) chip('eye', 'Show all', false, () => { app.ix.showAll(); this.refresh(); });
  }

  refresh() {
    const move = this.app.moveMode;
    $('mode-icon').setAttribute('href', move ? '#i-move' : '#i-turn');
    $('mode-text').textContent = move ? 'Move' : 'Turn';
    $('mode').classList.toggle('active', move);
    this.panel(this.app.ix.selected);
    this.dock();
    this.app.sm.wake();
  }

  panel(id) {
    const app = this.app;
    const c = id ? app.comp(id) : null;
    const group = id && !c ? (app.manifest.groups || {})[id] : null;
    // During a tour the tour bar does the talking; the part is just lit.
    const open = !!(c || group) && !app.guided.active;
    document.body.classList.toggle('panel-open', open);
    this.layout();
    $('p-answer').textContent = '';
    if (!open) return;
    const lang = app.lang;
    const parent = c && c.parent_id ? app.comp(c.parent_id) : null;
    $('p-parent-text').textContent = parent ? ((lang === 'hi' && parent.label_hi) || parent.label) : `Whole ${app.manifest.title.toLowerCase()}`;
    $('p-name').textContent = c ? ((lang === 'hi' && c.label_hi) || c.label) : id.replace(/_/g, ' ');
    $('p-desc').textContent = c ? c.description : `${group.length} parts: ` + group.map(g => app.comp(g).label).join(', ');
    $('p-func').textContent = c && c.function ? `Job: ${c.function}` : '';
    const facts = $('p-facts'); facts.innerHTML = '';
    for (const f of (c && c.facts) || []) { const li = document.createElement('li'); li.textContent = f; facts.appendChild(li); }
    const terms = $('p-terms'); terms.innerHTML = '';
    for (const t of (c && c.terms) || []) { const s = document.createElement('span'); s.textContent = t; terms.appendChild(s); }
    $('p-inside').hidden = !(c && c.nested_model);
    $('p-isolate').classList.toggle('on', app.ix.isolated === id);
    $('p-isolate').querySelector('span').textContent = app.ix.isolated === id ? 'Show all' : 'Only this';
    $('p-scroll').scrollTop = 0;
  }

  toast(text, { note = false, ms = null } = {}) {
    const el = $('toast');
    el.textContent = text; el.classList.toggle('note', note); el.classList.add('open');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('open'), ms || Math.min(14000, 3000 + text.length * 70));
  }

  caption(text, who) {
    if (!who) return this.toast(text);
    const el = $('toast');
    el.innerHTML = '<span class="who"></span><span class="line"></span>';
    el.querySelector('.who').textContent = who === 'you' ? 'You said' : 'Liza';
    el.querySelector('.line').textContent = text;
    el.classList.toggle('you', who === 'you'); el.classList.remove('note'); el.classList.add('open');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('open'), Math.min(16000, 3500 + text.length * 70));
  }

  // The Liza button: Talk when she is waiting, Stop while she speaks.
  liza(st) {
    const b = $('liza');
    const state = st.speaking ? 'speaking' : st.asleep ? 'asleep' : st.state;
    const look = { speaking: ['stop', 'Stop'], listening: ['mic', 'Listening…'], thinking: ['dots', 'Thinking…'],
                   asleep: ['mic', 'Wake Liza'] }[state] || ['mic', 'Talk'];
    this._lizaSpeaking = !!st.speaking;
    b.className = `lizabtn ${['speaking', 'listening', 'thinking', 'asleep'].includes(state) ? state : 'idle'}`;
    $('liza-icon').setAttribute('href', `#i-${look[0]}`);
    $('liza-text').textContent = look[1];
  }

  tour(step, i, n) {
    document.body.classList.toggle('touring', !!step);
    if (step) {
      $('tour-text').textContent = (this.app.lang === 'hi' && step.say_hi) || step.say;
      $('tour-count').textContent = `TOUR · ${i + 1} OF ${n}`;
      $('tour-next').querySelector('span').textContent = i === n - 1 ? 'Finish' : 'Next';
      $('tour-prev').style.visibility = i === 0 ? 'hidden' : '';
    }
    this.panel(this.app.ix.selected);
  }

  // Older name, still called from App.
  extras() { this.dock(); }
}

class App {
  constructor() {
    this.lang = 'en';
    this.sm = new SceneManager($('view'));
    this.ix = new Interaction(this.sm, $('view'), (id, hitSomething) => this.picked(id, hitSomething));
    this.labels = new Labels($('labelLayer'), $('leaders'), this.sm, id => this.select(id));
    this.guided = new Guided(this);
    this.ui = new UI(this);
    this.model = null;
    this.manifest = null;
    this.navStack = [];
    this.moveMode = false;
    this.animating = false;
    this.sm.onFrame.push(dt => { if (this.model && this.model.builder && this.model.builder.update) this.model.builder.update(dt, this.sm.time); });
    this.sm.onFrame.push(dt => { if (this.model && this.model.mixer) this.model.mixer.update(dt); });
    // Parts that always face the viewer (a black hole's lensed light).
    this.sm.onFrame.push(() => {
      for (const o of (this.model && this.model.builder && this.model.builder.faceCamera) || []) o.quaternion.copy(this.sm.camera.quaternion);
    });
    this.since = Number(params.get('since') || 0);
    this._loadSeq = 0;
  }

  api(method, path, body) {
    return fetch(path, {
      method, headers: { 'X-Holo-Token': TOKEN, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(r => r.json().then(j => { if (!r.ok) throw new Error(j.error || r.statusText); return j; }));
  }

  comp(id) { return this.manifest && this.manifest.components.find(c => c.id === id); }

  async load(modelId, { focus = null, push = false } = {}) {
    const seq = ++this._loadSeq;
    this.wantId = modelId;
    this.ui.error(null);
    this.ui.loading('Getting the model ready…', 0);
    let poll = null;
    try {
      const manifest = await this.api('GET', `api/model/${modelId}`);
      if (manifest.asset.kind === 'remote' && manifest.status !== 'cached') {
        this.ui.loading(`Downloading ${manifest.title}…`, 0);
        poll = setInterval(() => this.api('GET', `api/model/${modelId}/progress`).then(p => {
          if (p.size) this.ui.loading(`Downloading ${manifest.title}… ${Math.round(p.got / 1048576 * 10) / 10} of ${Math.round(p.size / 1048576 * 10) / 10} MB`, p.got / p.size);
        }).catch(() => {}), 400);
        await this.api('GET', `api/model/${modelId}/prepare`);
      }
      const model = await loadModel(manifest, { token: TOKEN, onProgress: (l, t) => t && this.ui.loading('Opening…', l / t) });
      if (seq !== this._loadSeq) { model.dispose(); return; }
      if (push && this.manifest) this.navStack.push({ id: this.manifest.model_id, title: this.manifest.title });
      if (!push) this.navStack = [];
      this.unload();
      this.manifest = manifest;
      this.model = model;
      
      this.sm.scene.add(model.root);
      this.ix.setModel(model);
      this.labels.setModel(model, this.ix);
      this.labels.setLanguage(this.lang);
      this.guided.setModel(manifest);
      this.sm.continuous = !!(model.builder && model.builder.animated);
      this.animating = false;
      this.ui.model(manifest);
      this.ui.refresh();
      this.sm.frame(model.center, model.radius, { setHome: true, duration: 0, direction: VIEW_FROM[(manifest.view || {}).from] || VIEW_FROM.three_quarter });
      if (model.missing.length) console.warn('components without meshes', model.missing);
      if (focus) { this.select(focus); this.ix.focus(focus); }
      this.ui.loading(null);
      this.reportState();
      this.report({ kind: 'loaded', model_id: modelId, load_ms: model.loadMs, missing: model.missing, meshes: model.allMeshes.length });
    } catch (e) {
      if (seq !== this._loadSeq) return;
      this.ui.loading(null);
      const offline = !navigator.onLine || /internet|network|Failed to fetch/i.test(e.message);
      const why = /responded with|status/i.test(e.message) ? 'something went wrong loading it' : e.message;
      this.ui.error(`I couldn't open this model: ${why}.` + (offline ? ' Check the internet connection. Models already on the device still work.' : ''));
      this.report({ kind: 'load_failed', model_id: modelId, error: String(e.message) });
    } finally {
      clearInterval(poll);
    }
  }

  unload() {
    this.guided.stop();
    if (this.model) { this.model.dispose(); this.model = null; }
    this.labels.setModel(null);
    this.sm.renderer.renderLists.dispose();
  }

  refit() { this.model.root.updateMatrixWorld(true); const s = this.model.bounds(null); this.model.center = s.center; this.model.radius = s.radius; this.sm.frame(s.center, s.radius, { setHome: true }); }

  picked(id, hitSomething) {
    if (id) { this.select(id); return; }
    if (hitSomething && this.manifest && !this.manifest.selectable) this.ui.caption('This model is one piece, so its parts can\'t be picked separately. Turn it and zoom in to look closely.');
    else if (!hitSomething) this.select(null);
  }

  select(id, { quiet = false } = {}) {
    if (!this.model) return;
    if (!quiet && this.guided.active) this.guided.stop();
    this.ix.select(id);
    if (this.model.builder && this.model.builder.onSelect) this.model.builder.onSelect(id);
    this.ui.panel(id);
    this.sm.wake();
    this.reportState();
  }

  setLabels(on) { this.labels.enabled = on; this.ui.refresh(); this.reportState(); }

  toggleMoveMode() {
    this.moveMode = !this.moveMode;
    this.sm.controls.touches.ONE = this.moveMode ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    this.sm.controls.mouseButtons.LEFT = this.moveMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    this.ui.refresh();
  }

  toggleAnimation() {
    const mx = this.model && this.model.mixer;
    if (!mx) return;
    this.animating = !this.animating;
    if (this.animating) this.model.clips.forEach(c => { const a = mx.clipAction(c); a.reset(); a.setLoop(THREE.LoopPingPong); a.play(); });
    else mx.stopAllAction();
    this.sm.continuous = this.animating || !!(this.model.builder && this.model.builder.animated);
  }

  async openNested() {
    const c = this.comp(this.ix.selected);
    if (c && c.nested_model) await this.load(c.nested_model, { push: true });
  }

  async closeNested() {
    const prev = this.navStack.pop();
    if (prev) { const stack = this.navStack; await this.load(prev.id, { push: false }); this.navStack = stack; this.ui.extras(); }
  }

  back() {
    if (this.navStack.length) return this.closeNested();
    this.api('POST', 'api/close', {}).catch(() => {});
  }

  async askAI(question) {
    const id = this.ix.selected;
    $('p-answer').textContent = 'Asking Liza…'; $('p-answer').classList.add('open');
    try {
      const r = await this.api('POST', 'api/ask', { model_id: this.manifest.model_id, component_id: id, question: question || '' });
      $('p-answer').textContent = r.answer || r.error || '';
    } catch (e) {
      $('p-answer').textContent = 'Liza could not answer just now. Everything else still works.';
    }
  }

  reportState() {
    clearTimeout(this._stateT);
    this._stateT = setTimeout(() => {
      if (!this.manifest) return;
      this.api('POST', 'api/state', {
        model_id: this.manifest.model_id, selected: this.ix.selected, hidden: [...this.ix.hidden],
        labels: this.labels.enabled, guided_step: this.guided.active ? this.guided.index : null, fps: this.sm.fps,
      }).catch(() => {});
    }, 250);
  }

  report(body) {
    const mem = performance.memory ? { js_heap_mb: Math.round(performance.memory.usedJSHeapSize / 1048576) } : {};
    const info = this.sm.renderer.info.memory;
    return this.api('POST', 'api/report', { ...body, ...mem, geometries: info.geometries, textures: info.textures }).catch(() => {});
  }

  // ---------- commands from Python ----------
  handle(ev) {
    if (ev.type === 'load') { this.lang = ev.language || 'en'; this.labels.setLanguage(this.lang); return this.load(ev.model_id, { focus: ev.focus }); }
    if (ev.type === 'caption') return this.ui.caption(ev.text || '', ev.who);
    if (ev.type === 'liza') return this.ui.liza(ev);
    if (ev.type !== 'action' || !this.model) return;
    const id = ev.component_id;
    switch (ev.action) {
      case 'select_component': this.select(id); break;
      case 'focus_component': this.select(id); this.ix.focus(id); break;
      case 'hide_component': this.ix.hide(id); this.select(null); break;
      case 'show_component': this.ix.show(id); break;
      case 'isolate_component': this.ix.isolate(id); this.ix.focus(id); this.ui.refresh(); break;
      case 'show_all': this.ix.showAll(); this.ui.refresh(); break;
      case 'show_labels': this.setLabels(true); break;
      case 'hide_labels': this.setLabels(false); break;
      case 'reset_view': this.guided.stop(); this.select(null); this.ix.showAll(); this.sm.goHome(); break;
      case 'zoom_in': this.sm.zoom(1.35); break;
      case 'zoom_out': this.sm.zoom(1 / 1.35); break;
      case 'cutaway_on': case 'cutaway_off': this.ix.setCutaway(ev.action === 'cutaway_on'); this.ui.extras(); break;
      case 'explode_on': case 'explode_off': if (this.manifest.explode) this.ix.setExploded(ev.action === 'explode_on'); this.ui.extras(); break;
      case 'guided_start': this.guided.start(); break;
      case 'guided_next': this.guided.active ? this.guided.next() : this.guided.start(); break;
      case 'guided_prev': this.guided.prev(); break;
      case 'guided_stop': this.guided.stop(); break;
      case 'play_animation': if (!this.animating) this.toggleAnimation(); this.ui.extras(); break;
      case 'stop_animation': if (this.animating) this.toggleAnimation(); this.ui.extras(); break;
    }
    this.ui.dock();
    this.reportState();
  }

  async listen() {
    for (;;) {
      try {
        const r = await this.api('GET', `api/events?since=${this.since}`);
        this.since = r.seq;
        for (const ev of r.events) await this.handle(ev);
      } catch (e) {
        await new Promise(res => setTimeout(res, 1500));
      }
    }
  }

  // ---------- self-test / benchmark ----------
  async selftest() {
    const rounds = Number(params.get('rounds') || 1);
    const only = params.get('only');
    const cat = await this.api('GET', 'api/catalog');
    const results = [];
    for (let r = 0; r < rounds; r++) {
      for (const entry of cat.models) {
        if (only && !only.split(',').includes(entry.model_id)) continue;
        if (entry.status === 'not_downloaded' && !params.get('download')) continue;
        const t0 = performance.now();
        await this.load(entry.model_id);
        const res = { model_id: entry.model_id, round: r, open_ms: Math.round(performance.now() - t0) };
        if (!this.model || this.manifest.model_id !== entry.model_id) { res.error = 'did not load'; results.push(res); continue; }
        res.load_ms = this.model.loadMs; res.missing = this.model.missing; res.meshes = this.model.allMeshes.length;
        const ext = new THREE.Box3().setFromObject(this.model.root).getSize(new THREE.Vector3());
        res.extent = ext.toArray().map(v => +v.toFixed(2));
        let tri = 0; this.model.allMeshes.forEach(m => { const g = m.geometry; tri += (g.index ? g.index.count : g.attributes.position.count) / 3 * (m.count || 1); });
        res.triangles = Math.round(tri);
        const comps = this.manifest.components.slice(0, 6);
        const s0 = performance.now();
        for (const c of comps) { this.select(c.id); this.ix.focus(c.id); await new Promise(x => requestAnimationFrame(x)); }
        res.select_focus_ms = comps.length ? Math.round((performance.now() - s0) / comps.length) : null;
        if (comps[0]) { this.ix.hide(comps[0].id); this.ix.showAll(); this.ix.isolate(comps[0].id); this.ix.showAll(); }
        if (this.manifest.cutaway) { this.ix.setCutaway(true); this.ix.setCutaway(false); }
        this.select(null); this.sm.goHome(0);
        res.fps = await this.sm.measureFps(2500);
        const info = this.sm.renderer.info.memory;
        res.geometries = info.geometries; res.textures = info.textures;
        if (performance.memory) res.js_heap_mb = Math.round(performance.memory.usedJSHeapSize / 1048576);
        this.unload(); this.manifest = null;
        await new Promise(x => requestAnimationFrame(x));
        res.textures_after_unload = this.sm.renderer.info.memory.textures;
        res.geometries_after_unload = this.sm.renderer.info.memory.geometries;
        results.push(res);
        await this.report({ kind: 'selftest_model', ...res });
      }
    }
    this.unload();
    await new Promise(x => setTimeout(x, 300));
    const info = this.sm.renderer.info.memory;
    await this.report({ kind: 'selftest_done', count: results.length, after_unload_geometries: info.geometries, after_unload_textures: info.textures });
    document.title = 'selftest done';
  }
}

const app = new App();
window.__holo = app;
if (params.get('selftest')) app.selftest();
else app.listen();
