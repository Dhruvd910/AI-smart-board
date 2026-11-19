// Turning a manifest into something on screen, and tying meshes to components.
//
// A component names the nodes it is made of (mesh_names). Every mesh under
// those nodes belongs to it. Components are resolved parents first, so a
// child (the nucleolus inside the nucleus, the drill on the turret) claims
// its own meshes: a tap lands on the most specific part.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { BUILDERS } from './procedural.js';

let draco = null;
function gltfLoader(token) {
  const loader = new GLTFLoader();
  if (!draco) {
    draco = new DRACOLoader();
    draco.setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/');
    draco.setDecoderConfig({ type: 'wasm' });
    draco.setWorkerLimit(2);
  }
  loader.setDRACOLoader(draco);
  loader.setRequestHeader({ 'X-Holo-Token': token });
  return loader;
}

function depth(comp, byId) {
  let d = 0, c = comp;
  while (c && c.parent_id && d < 10) { c = byId.get(c.parent_id); d++; }
  return d;
}

export async function loadModel(manifest, { token, onProgress } = {}) {
  const t0 = performance.now();
  let root, builder = null, clips = [];
  if (manifest.asset.kind === 'procedural') {
    const make = BUILDERS[manifest.asset.builder];
    if (!make) throw new Error(`no builder called ${manifest.asset.builder}`);
    builder = make({ manifest });
    root = builder.root;
  } else if (manifest.asset.format === 'jpg') {
    // A verified picture (a NASA planet map) that a builder wraps onto a shape.
    const make = BUILDERS[manifest.asset.builder];
    if (!make) throw new Error(`no builder called ${manifest.asset.builder}`);
    const r = await fetch(`api/model/${manifest.model_id}/file`, { headers: { 'X-Holo-Token': token } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'the picture did not load');
    const bitmap = await createImageBitmap(await r.blob(), { imageOrientation: 'flipY' });
    const texture = new THREE.Texture(bitmap);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    builder = make({ manifest, texture });
    root = builder.root;
    var textures = [texture];
  } else {
    const loader = gltfLoader(token);
    const gltf = await loader.loadAsync(`api/model/${manifest.model_id}/file`, e => onProgress && onProgress(e.loaded, e.total));
    root = gltf.scene;
    clips = gltf.animations || [];
    // Glass-like "transmission" makes the renderer draw the whole scene a
    // second time into a buffer every frame. On the Pi that cost a third of
    // the frame rate (Perseverance's camera lenses); plain transparency looks
    // nearly the same.
    root.traverse(o => [].concat(o.material || []).forEach(m => {
      if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = Math.min(m.opacity, 0.45); m.depthWrite = false; }
    }));
    // Every texture the file made, attached to a material or not, so none
    // outlives the model (one per load leaked before this, measured).
    var textures = await gltf.parser.getDependencies('texture').catch(() => []);
  }
  // Stand the model up: the viewer is Y-up, some files are Z-up (BodyParts3D,
  // several museum scans). Rotating a wrapper leaves the file's own nodes alone.
  const up = (manifest.view && manifest.view.up) || 'y';
  if (up !== 'y') {
    const stand = new THREE.Group();
    stand.add(root);
    if (up === 'z') stand.rotation.x = -Math.PI / 2;
    else if (up === '-z') stand.rotation.x = Math.PI / 2;
    else if (up === 'x') stand.rotation.z = Math.PI / 2;
    else if (up === '-x') stand.rotation.z = -Math.PI / 2;
    root = stand;
  }
  const model = new Model(manifest, root, builder, clips);
  model.extraTextures = textures || [];
  model.loadMs = Math.round(performance.now() - t0);
  return model;
}

// The box the camera frames: every drawn thing except tap volumes and parts
// marked noFit (a galaxy's faint halo would otherwise shrink the galaxy).
function fitBox(root) {
  const box = new THREE.Box3(), part = new THREE.Box3();
  root.traverse(o => {
    if (!o.geometry || o.userData.proxy || o.userData.noFit) return;
    if (o.isInstancedMesh) { o.computeBoundingBox(); part.copy(o.boundingBox).applyMatrix4(o.matrixWorld); }
    else {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      part.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    }
    box.union(part);
  });
  return box.isEmpty() ? new THREE.Box3().setFromObject(root) : box;
}

export class Model {
  constructor(manifest, root, builder, clips) {
    this.manifest = manifest;
    this.root = new THREE.Group();
    this.root.add(root);
    this.builder = builder;
    this.clips = clips;
    this.mixer = clips.length ? new THREE.AnimationMixer(root) : null;
    this.components = new Map();
    this.meshToComp = new Map();
    this.missing = [];
    this.allMeshes = [];
    this.root.traverse(o => { if (o.isMesh) this.allMeshes.push(o); });
    this._resolve();
    this.root.updateMatrixWorld(true);
    const box = fitBox(this.root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.center = sphere.center;
    this.radius = sphere.radius || 1;
  }

  _resolve() {
    const comps = this.manifest.components;
    const byId = new Map(comps.map(c => [c.id, c]));
    const byName = new Map();
    this.root.traverse(o => {
      if (!o.name) return;
      if (!byName.has(o.name)) byName.set(o.name, []);
      byName.get(o.name).push(o);
    });
    const ordered = [...comps].sort((a, b) => depth(a, byId) - depth(b, byId));
    for (const c of ordered) {
      const objects = [];
      for (const name of c.mesh_names) {
        // GLTFLoader cleans node names ("arm.003" -> "arm003"); look up both.
        const found = byName.get(name) || byName.get(THREE.PropertyBinding.sanitizeNodeName(name));
        if (found) objects.push(...found);
        else this.missing.push(`${c.id}:${name}`);
      }
      const entry = { meta: c, objects, meshes: [] };
      for (const obj of objects) obj.traverse(o => { if (o.isMesh) this.meshToComp.set(o, c.id); });
      this.components.set(c.id, entry);
    }
    for (const [mesh, id] of this.meshToComp) this.components.get(id).meshes.push(mesh);
    // A parent owns its children's meshes too, for hiding and focusing as a whole.
    for (const c of ordered.slice().reverse()) {
      if (!c.parent_id || !this.components.has(c.parent_id)) continue;
      const parent = this.components.get(c.parent_id);
      for (const m of this.components.get(c.id).meshes) if (!parent.meshes.includes(m)) parent.meshes.push(m);
    }
  }

  // Meshes for a component id or a group name.
  meshesOf(id) {
    if (this.components.has(id)) return this.components.get(id).meshes;
    const members = (this.manifest.groups || {})[id];
    if (!members) return [];
    return members.flatMap(m => this.components.has(m) ? this.components.get(m).meshes : []);
  }

  bounds(id) {
    const meshes = id ? this.meshesOf(id) : this.allMeshes;
    const box = new THREE.Box3();
    meshes.forEach(m => { if (m.userData.proxy) return; box.expandByObject(m); });
    if (box.isEmpty()) meshes.forEach(m => box.expandByObject(m));
    return box.getBoundingSphere(new THREE.Sphere());
  }

  dispose() {
    if (this.mixer) { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.mixer.getRoot()); }
    const seen = new Set();
    this.root.traverse(o => {
      if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
      const mats = [].concat(o.material || [], o.userData.__mats || []);
      for (const m of mats) {
        if (!m || seen.has(m)) continue;
        seen.add(m);
        for (const v of Object.values(m)) if (v && v.isTexture && !seen.has(v)) { seen.add(v); v.dispose(); }
        m.dispose();
      }
      if (o.isInstancedMesh) o.dispose();
    });
    for (const t of this.extraTextures || []) if (t && !seen.has(t)) { seen.add(t); t.dispose(); }
    this.root.removeFromParent();
  }
}
