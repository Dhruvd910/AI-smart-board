// Procedural models: schematic scenes drawn with Three.js primitives.
//
// Each builder returns { root, update(dt, t)?, controls?: [{id, label, active, toggle()}] }.
// Every component in the catalogue is an Object3D whose NAME is the component
// id -- the manifest's mesh_names say exactly that, and the viewer's self-test
// checks it. A builder never invents a component the manifest does not list.
import * as THREE from 'three';

const TAU = Math.PI * 2;

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...opts });
}
function glass(color, opacity, opts = {}) {
  return mat(color, { transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, ...opts });
}
function named(id, obj) { obj.name = id; return obj; }
function group(id, children = []) { const g = new THREE.Group(); g.name = id; children.forEach(c => g.add(c)); return g; }
function mesh(geo, material, pos, rot) {
  const m = new THREE.Mesh(geo, material);
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  return m;
}
// An invisible but tappable volume, for things drawn as moving particles.
function proxy(geo, pos) {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
  if (pos) m.position.set(...pos);
  m.userData.proxy = true;
  return m;
}
// A seeded random, so a model looks the same every time it opens.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function randomInBall(rand, r) {
  for (;;) {
    const v = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    if (v.lengthSq() <= 1) return v.multiplyScalar(r);
  }
}
function instanced(geo, material, positions, scale = 1) {
  const m = new THREE.InstancedMesh(geo, material, positions.length);
  const d = new THREE.Object3D();
  positions.forEach((p, i) => { d.position.copy(p); d.scale.setScalar(scale); d.updateMatrix(); m.setMatrixAt(i, d.matrix); });
  m.instanceMatrix.needsUpdate = true;
  return m;
}
// ---------------------------------------------------------------- animal cell
function animal_cell() {
  const rand = rng(7);
  const root = new THREE.Group();
  const membrane = mesh(new THREE.SphereGeometry(3, 48, 32), glass('#7FB3E8', 0.28));
  membrane.scale.set(1.15, 0.9, 1);
  membrane.userData.clip = true;
  root.add(named('cell_membrane', membrane));
  const cyto = mesh(new THREE.SphereGeometry(2.9, 40, 28), glass('#BFE3F2', 0.10));
  cyto.scale.copy(membrane.scale);
  cyto.userData.clip = true;
  root.add(named('cytoplasm', cyto));

  const nucleus = mesh(new THREE.SphereGeometry(0.95, 36, 24), mat('#4A6FD8', { transparent: true, opacity: 0.8 }), [0.2, 0.1, 0]);
  nucleus.userData.clip = true;
  root.add(named('nucleus', nucleus));
  root.add(named('nucleolus', mesh(new THREE.SphereGeometry(0.33, 24, 16), mat('#22337A'), [0.35, 0.2, 0.1])));

  const mito = group('mitochondria');
  const mGeo = new THREE.CapsuleGeometry(0.17, 0.55, 6, 14);
  const mMat = mat('#E69F45');
  [[-2.1, 0.6, 0.8], [-1.6, -1.1, -0.9], [1.9, -0.9, 0.9], [2.2, 0.8, -0.6], [-0.6, 1.6, -1.2], [0.8, -1.7, -0.3]].forEach(p =>
    mito.add(mesh(mGeo, mMat, p, [rand() * 3, rand() * 3, rand() * 3])));
  root.add(mito);

  const rough = group('rough_er');
  const rMat = mat('#5BBF8A', { side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const t = mesh(new THREE.TorusGeometry(1.2 + i * 0.18, 0.05, 6, 40, Math.PI * 0.9), rMat, [0.2, 0.1, 0], [Math.PI / 2, 0, 0.6 + i * 0.12]);
    rough.add(t);
  }
  root.add(rough);

  const smooth = group('smooth_er');
  const sMat = mat('#9AD0A8');
  for (let k = 0; k < 3; k++) {
    const pts = [];
    for (let i = 0; i < 8; i++) pts.push(new THREE.Vector3(-1.9 + i * 0.16, -0.2 - k * 0.3 + Math.sin(i * 1.3 + k) * 0.18, 1.2 + Math.cos(i + k) * 0.2));
    smooth.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.05, 6), sMat));
  }
  root.add(smooth);

  const golgi = group('golgi');
  const gMat = mat('#E8C93A', { side: THREE.DoubleSide });
  for (let i = 0; i < 5; i++) {
    golgi.add(mesh(new THREE.TorusGeometry(0.55 - i * 0.04, 0.06, 6, 24, Math.PI * 0.8), gMat, [1.45, 0.9 - i * 0.16, 0.9], [0.2, 0.3, -0.4]));
  }
  [[1.0, 0.95, 1.05], [1.95, 0.4, 0.75]].forEach(p => golgi.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), gMat, p)));
  root.add(golgi);

  const ribPos = [];
  for (let i = 0; i < 70; i++) {
    const a = rand() * TAU, ring = 1.25 + rand() * 0.6;
    ribPos.push(new THREE.Vector3(0.2 + Math.cos(a) * ring, 0.1 + (rand() - 0.5) * 0.15, Math.sin(a) * ring));
  }
  for (let i = 0; i < 50; i++) ribPos.push(randomInBall(rand, 2.5).multiply(new THREE.Vector3(1.1, 0.85, 1)));
  root.add(named('ribosomes', instanced(new THREE.SphereGeometry(0.035, 6, 4), mat('#6B4E9B'), ribPos)));

  const lyso = group('lysosomes');
  const lMat = mat('#D9534F');
  [[-1.2, -0.3, -1.6], [-2.3, -0.4, 0], [1.2, -1.2, -1.2], [0.0, 1.7, 1.0]].forEach(p => lyso.add(mesh(new THREE.SphereGeometry(0.18, 16, 12), lMat, p)));
  root.add(lyso);

  const cent = group('centrosome');
  const cMat = mat('#9A6B3D');
  cent.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.35, 9), cMat, [-0.9, 1.15, 0.6]));
  cent.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.35, 9), cMat, [-0.75, 1.15, 0.6], [0, 0, Math.PI / 2]));
  root.add(cent);
  return { root };
}

// ------------------------------------------------------------- mitochondrion
function mitochondrion() {
  const rand = rng(11);
  const root = new THREE.Group();
  root.rotation.z = 0.15;
  const outer = mesh(new THREE.CapsuleGeometry(1.0, 2.6, 10, 32), glass('#E69F45', 0.35), null, [0, 0, Math.PI / 2]);
  outer.userData.clip = true;
  root.add(named('outer_membrane', outer));
  const ims = mesh(new THREE.CapsuleGeometry(0.93, 2.5, 10, 32), glass('#FBE3BE', 0.12), null, [0, 0, Math.PI / 2]);
  ims.userData.clip = true;
  root.add(named('intermembrane_space', ims));
  const inner = group('inner_membrane');
  const iMat = mat('#F4C27A', { side: THREE.DoubleSide });
  const shell = mesh(new THREE.CapsuleGeometry(0.85, 2.4, 10, 32), glass('#F4C27A', 0.3), null, [0, 0, Math.PI / 2]);
  shell.userData.clip = true;
  inner.add(shell);
  for (let i = 0; i < 9; i++) {
    const x = -1.6 + i * 0.4;
    const fold = mesh(new THREE.BoxGeometry(0.06, 1.1, 1.3), iMat, [x, (i % 2 ? 0.3 : -0.3), 0]);
    inner.add(fold);
  }
  root.add(inner);
  const matrix = mesh(new THREE.CapsuleGeometry(0.6, 2.0, 8, 24), glass('#C77A2A', 0.22), null, [0, 0, Math.PI / 2]);
  root.add(named('matrix', matrix));
  root.add(named('mito_dna', mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 40), mat('#3A5BC7'), [0.3, 0.05, 0.35], [0.4, 0.8, 0])));
  const rib = [];
  for (let i = 0; i < 30; i++) rib.push(new THREE.Vector3((rand() - 0.5) * 3, (rand() - 0.5) * 0.9, (rand() - 0.5) * 0.9));
  root.add(named('mito_ribosomes', instanced(new THREE.SphereGeometry(0.035, 6, 4), mat('#6B4E9B'), rib)));
  return { root };
}

// ------------------------------------------------------------------- atom
function atom_carbon() {
  const root = new THREE.Group();
  const nucleus = group('nucleus');
  const protons = group('protons'), neutrons = group('neutrons');
  const pMat = mat('#E5484D', { roughness: 0.3 }), nMat = mat('#9AA4B2', { roughness: 0.3 });
  const geo = new THREE.SphereGeometry(0.2, 20, 14);
  // Twelve balls packed on a small icosahedron's corners.
  const ico = new THREE.IcosahedronGeometry(0.24, 0).getAttribute('position');
  const seen = [];
  for (let i = 0; i < ico.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(ico, i);
    if (!seen.some(s => s.distanceTo(v) < 1e-3)) seen.push(v);
  }
  seen.slice(0, 12).forEach((v, i) => (i % 2 ? neutrons : protons).add(mesh(geo, i % 2 ? nMat : pMat, [v.x, v.y, v.z])));
  nucleus.add(protons, neutrons);
  root.add(nucleus);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#5B7BD5', transparent: true, opacity: 0.7 });
  const shellK = mesh(new THREE.TorusGeometry(1.4, 0.015, 6, 96), ringMat, null, [Math.PI / 2, 0, 0]);
  const shellL = mesh(new THREE.TorusGeometry(2.6, 0.015, 6, 128), ringMat.clone(), null, [Math.PI / 2, 0.35, 0]);
  shellL.material.color.set('#5BC0D5');
  // A fat invisible tube makes a thin ring easy to tap.
  shellK.add(proxy(new THREE.TorusGeometry(1.4, 0.12, 6, 48)));
  shellL.add(proxy(new THREE.TorusGeometry(2.6, 0.12, 6, 48)));
  root.add(named('shell_k', shellK), named('shell_l', shellL));
  const electrons = group('electrons');
  const eMat = new THREE.MeshBasicMaterial({ color: '#3DDCFF' });
  const eGeo = new THREE.SphereGeometry(0.11, 16, 12);
  const es = [];
  [[shellK, 2, 1.4, 1.2], [shellL, 4, 2.6, 0.7]].forEach(([ring, n, r, speed]) => {
    for (let i = 0; i < n; i++) {
      const e = mesh(eGeo, eMat);
      electrons.add(e);
      es.push({ e, ring, r, speed, phase: i * TAU / n });
    }
  });
  root.add(electrons);
  const tmp = new THREE.Vector3();
  return {
    root, animated: true,
    update(dt, t) {
      for (const s of es) {
        tmp.set(Math.cos(s.phase + t * s.speed) * s.r, Math.sin(s.phase + t * s.speed) * s.r, 0);
        s.ring.updateMatrix();
        tmp.applyMatrix4(s.ring.matrix);
        s.e.position.copy(tmp);
      }
    },
  };
}

// ------------------------------------------------------------- solar system
const PLANETS = [
  // id, colour, teaching radius, true radius (Earth = 1), orbit period (years)
  ['mercury', '#9C9C9C', 0.22, 0.383, 0.241],
  ['venus', '#E3BB76', 0.36, 0.949, 0.615],
  ['earth', '#3B7DD8', 0.38, 1.0, 1.0],
  ['mars', '#C1440E', 0.28, 0.532, 1.881],
  ['jupiter', '#C99E6A', 1.0, 11.21, 11.86],
  ['saturn', '#E3D199', 0.85, 9.45, 29.46],
  ['uranus', '#9FD8E0', 0.6, 4.01, 84.0],
  ['neptune', '#4166F5', 0.58, 3.88, 164.8],
];
function solar_system() {
  const root = new THREE.Group();
  const sunMat = new THREE.MeshBasicMaterial({ color: '#FDB813' });
  const sun = mesh(new THREE.SphereGeometry(1, 40, 28), sunMat);
  sun.add(new THREE.PointLight('#fff4d6', 2.2, 0, 0));
  root.add(named('sun', sun));
  const bodies = [], rings = [];
  const ringMat = new THREE.MeshBasicMaterial({ color: '#56648F', transparent: true, opacity: 0.45 });
  PLANETS.forEach(([id, colour, rTeach, rTrue, period], i) => {
    const p = named(id, mesh(new THREE.SphereGeometry(1, 32, 20), mat(colour, { roughness: 0.8 })));
    if (id === 'saturn') {
      const ring = mesh(new THREE.RingGeometry(1.3, 2.2, 48), mat('#d8c890', { side: THREE.DoubleSide, transparent: true, opacity: 0.8 }), null, [Math.PI / 2.3, 0, 0]);
      p.add(ring);
    }
    if (id === 'uranus') p.rotation.z = 1.7;
    root.add(p);
    const orbit = mesh(new THREE.RingGeometry(1, 1.0, 128), ringMat, null, [-Math.PI / 2, 0, 0]);
    root.add(orbit);
    rings.push(orbit);
    bodies.push({ p, rTeach, rTrue, period, phase: i * 1.7, orbit, index: i });
  });
  let mode = 'teaching', paused = false, clock = 0;
  function layout() {
    const sunR = mode === 'teaching' ? 1.6 : 109 * 0.12;
    sun.scale.setScalar(sunR);
    let d = sunR + 1.2;
    for (const b of bodies) {
      const r = mode === 'teaching' ? b.rTeach : b.rTrue * 0.12;
      b.p.scale.setScalar(Math.max(r, 0.02));
      d += Math.max(r * 2 + 0.6, mode === 'teaching' ? 1.3 : 0.9);
      b.dist = d;
      b.orbit.geometry.dispose();
      b.orbit.geometry = new THREE.RingGeometry(d - 0.015, d + 0.015, 160);
      d += r;
    }
  }
  layout();
  function place() {
    for (const b of bodies) {
      // Speeds in the true ratio of periods, compressed by a power so Neptune visibly moves.
      const a = b.phase + clock * 0.6 / Math.pow(b.period, 0.6);
      b.p.position.set(Math.cos(a) * b.dist, 0, -Math.sin(a) * b.dist);
    }
  }
  place();
  return {
    root, animated: true,
    update(dt) { if (!paused) { clock += dt; place(); } },
    onSelect(id) { paused = !!id && id !== 'sun'; },
    controls: [
      { id: 'scale', label: 'True sizes', active: false, toggle() { mode = mode === 'teaching' ? 'true' : 'teaching'; layout(); place(); this.active = mode === 'true'; return 'refit'; } },
      { id: 'pause', label: 'Pause orbits', active: false, toggle() { paused = !paused; this.active = paused; } },
    ],
  };
}

// --------------------------------------------------------------- water cycle
function flowParticles(count, geo, material, path, speed, seed = 3) {
  const rand = rng(seed);
  const m = new THREE.InstancedMesh(geo, material, count);
  const d = new THREE.Object3D();
  const state = Array.from({ length: count }, () => ({ u: rand(), j: new THREE.Vector3((rand() - .5), (rand() - .5), (rand() - .5)) }));
  return {
    mesh: m,
    update(dt) {
      state.forEach((s, i) => {
        s.u = (s.u + dt * speed) % 1;
        d.position.copy(path(s.u, s.j));
        d.updateMatrix();
        m.setMatrixAt(i, d.matrix);
      });
      m.instanceMatrix.needsUpdate = true;
    },
  };
}
function water_cycle() {
  const root = new THREE.Group();
  const flows = [];
  root.add(named('sun', mesh(new THREE.SphereGeometry(0.7, 32, 20), new THREE.MeshBasicMaterial({ color: '#FDB813' }), [-4.5, 4.2, -1])));
  const ocean = mesh(new THREE.BoxGeometry(5, 0.4, 4), mat('#2B6CB0', { roughness: 0.2, metalness: 0.2 }), [-3, -0.2, 0]);
  root.add(named('ocean', ocean));
  const land = mesh(new THREE.BoxGeometry(6, 0.6, 4), mat('#6B8E4E'), [2.5, -0.1, 0]);
  root.add(land);
  const mountain = mesh(new THREE.ConeGeometry(1.6, 2.8, 7), mat('#7A6A58'), [3.8, 1.6, -0.6]);
  mountain.add(mesh(new THREE.ConeGeometry(0.62, 1.0, 7), mat('#F7FAFC'), [0, 0.92, 0]));
  root.add(mountain);
  const dropGeo = new THREE.SphereGeometry(0.06, 6, 4);
  // evaporation: vapour rising off the sea
  const evap = group('evaporation');
  const ev = flowParticles(40, dropGeo, new THREE.MeshBasicMaterial({ color: '#90CDF4', transparent: true, opacity: 0.8 }),
    (u, j) => new THREE.Vector3(-4.2 + j.x * 3 + u * 1.5, 0.1 + u * 3.6, j.z * 3), 0.18);
  evap.add(ev.mesh, proxy(new THREE.CylinderGeometry(1.4, 1.4, 3.4, 12), [-3.2, 1.9, 0]));
  flows.push(ev); root.add(evap);
  // transpiration: a tree breathing vapour
  const tr = group('transpiration');
  tr.add(mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.9, 8), mat('#7B5134'), [0.9, 0.65, 0.9]));
  tr.add(mesh(new THREE.SphereGeometry(0.5, 16, 12), mat('#38A169'), [0.9, 1.3, 0.9]));
  const tp = flowParticles(12, dropGeo, new THREE.MeshBasicMaterial({ color: '#68D391' }),
    (u, j) => new THREE.Vector3(0.9 + j.x * 0.6, 1.6 + u * 2.0, 0.9 + j.z * 0.6), 0.2, 9);
  tr.add(tp.mesh); flows.push(tp); root.add(tr);
  // condensation: the cloud
  const cloud = group('condensation');
  const cMat = mat('#E2E8F0', { roughness: 1 });
  [[0, 0, 0, 0.8], [0.8, 0.1, 0.2, 0.65], [-0.8, -0.05, 0, 0.6], [0.3, 0.45, -0.1, 0.6], [1.5, -0.1, 0, 0.5]].forEach(([x, y, z, r]) =>
    cloud.add(mesh(new THREE.SphereGeometry(r, 18, 12), cMat, [x, y, z])));
  cloud.position.set(1.5, 4.4, 0);
  root.add(cloud);
  // precipitation: rain over the mountain
  const rain = group('precipitation');
  const rp = flowParticles(50, new THREE.CylinderGeometry(0.02, 0.02, 0.25, 4), new THREE.MeshBasicMaterial({ color: '#4299E1' }),
    (u, j) => new THREE.Vector3(2.4 + j.x * 2.4, 3.8 - u * 3.4, j.z * 2), 0.6, 5);
  rain.add(rp.mesh, proxy(new THREE.CylinderGeometry(1.2, 1.2, 3.2, 12), [2.4, 2.1, 0]));
  flows.push(rp); root.add(rain);
  // collection: a river back to the sea
  const coll = group('collection');
  const riverPath = new THREE.CatmullRomCurve3([new THREE.Vector3(3.5, 0.25, 0.4), new THREE.Vector3(2.4, 0.22, 1.2), new THREE.Vector3(1.0, 0.22, 0.2), new THREE.Vector3(-0.6, 0.05, 0.6)]);
  coll.add(mesh(new THREE.TubeGeometry(riverPath, 40, 0.16, 6), mat('#3182CE', { roughness: 0.2 })));
  const rv = flowParticles(16, dropGeo, new THREE.MeshBasicMaterial({ color: '#BEE3F8' }), u => riverPath.getPoint(u).add(new THREE.Vector3(0, 0.15, 0)), 0.25, 13);
  coll.add(rv.mesh); flows.push(rv); root.add(coll);
  return { root, animated: true, update(dt) { flows.forEach(f => f.update(dt)); } };
}

// ------------------------------------------------------------ photosynthesis
function molecule(parts) {
  const g = new THREE.Group();
  parts.forEach(([colour, r, x, y, z]) => g.add(mesh(new THREE.SphereGeometry(r, 12, 8), mat(colour), [x, y, z])));
  return g;
}
function photosynthesis() {
  const root = new THREE.Group();
  const anim = [];
  // leaf: a flattened ellipse with a midrib and a stem
  const leafShape = new THREE.Shape();
  leafShape.moveTo(-3, 0); leafShape.quadraticCurveTo(0, 2.2, 3, 0); leafShape.quadraticCurveTo(0, -2.2, -3, 0);
  const leaf = mesh(new THREE.ExtrudeGeometry(leafShape, { depth: 0.12, bevelEnabled: false }), mat('#2F9E44', { side: THREE.DoubleSide }), [0, 0, 0], [-Math.PI / 2, 0, 0]);
  leaf.add(mesh(new THREE.CylinderGeometry(0.04, 0.06, 6, 6), mat('#8FD694'), [0, 0, 0.14], [0, 0, Math.PI / 2]));
  root.add(named('leaf', leaf));
  const stem = mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.4, 8), mat('#5C940D'), [-3.3, -1.1, 0], [0, 0, 0.5]);
  root.add(stem);
  // stomata on the underside
  const sto = group('stomata');
  [[-1, -0.6], [0.2, 0.7], [1.3, -0.3]].forEach(([x, z]) => {
    const s = mesh(new THREE.TorusGeometry(0.14, 0.04, 6, 16), mat('#8CE99A'), [x, -0.03, z], [Math.PI / 2, 0, 0]);
    s.scale.set(1, 0.6, 1); sto.add(s);
  });
  root.add(sto);
  // a magnified cell with chloroplasts, floating above the leaf
  const chl = group('chloroplast');
  const cell = mesh(new THREE.BoxGeometry(1.8, 1.0, 1.0), glass('#B2F2BB', 0.25), [0, 0, 0]);
  chl.add(cell);
  const cGeo = new THREE.CapsuleGeometry(0.12, 0.28, 4, 10), cMat = mat('#37B24D');
  [[-0.6, 0.2, 0.2], [-0.2, -0.2, -0.25], [0.3, 0.25, 0.1], [0.6, -0.15, -0.1], [0.05, 0.05, 0.3]].forEach(p => chl.add(mesh(cGeo, cMat, p, [0, 0, 1.4])));
  chl.position.set(2.2, 2.1, -1.0);
  root.add(chl);
  const zoomLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(1.0, 0.1, -0.4), new THREE.Vector3(2.2, 1.6, -1.0)]), new THREE.LineDashedMaterial({ color: '#8CE99A', dashSize: 0.1, gapSize: 0.08 }));
  zoomLine.computeLineDistances();
  root.add(zoomLine);
  // sunlight rays
  const sun = group('sunlight');
  sun.add(mesh(new THREE.SphereGeometry(0.5, 24, 16), new THREE.MeshBasicMaterial({ color: '#FDE047' }), [-1.8, 4.5, -1.6]));
  const rayMat = new THREE.MeshBasicMaterial({ color: '#FDE047', transparent: true, opacity: 0.45 });
  [[-1.2, 0.2], [0, -0.5], [1.0, 0.6]].forEach(([x, z]) => {
    const from = new THREE.Vector3(-1.8, 4.5, -1.6), to = new THREE.Vector3(x, 0.15, z);
    const ray = mesh(new THREE.CylinderGeometry(0.03, 0.03, from.distanceTo(to), 5), rayMat);
    ray.position.copy(from).add(to).multiplyScalar(0.5);
    ray.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    sun.add(ray);
  });
  root.add(sun);
  // moving molecules: CO2 in from below-left, water up the stem, O2 out, glucose down the stem
  const mover = (id, make, path, speed, n) => {
    const g = group(id);
    const items = Array.from({ length: n }, (_, i) => { const m = make(); g.add(m); return { m, u: i / n }; });
    anim.push(dt => items.forEach(it => { it.u = (it.u + dt * speed) % 1; it.m.position.copy(path(it.u)); }));
    root.add(g);
    return g;
  };
  const co2 = () => molecule([['#495057', 0.1, 0, 0, 0], ['#FA5252', 0.08, 0.17, 0, 0], ['#FA5252', 0.08, -0.17, 0, 0]]);
  const h2o = () => molecule([['#FA5252', 0.09, 0, 0, 0], ['#F8F9FA', 0.06, 0.1, 0.07, 0], ['#F8F9FA', 0.06, -0.1, 0.07, 0]]);
  const o2 = () => molecule([['#FF6B6B', 0.09, 0.07, 0, 0], ['#FF6B6B', 0.09, -0.07, 0, 0]]);
  const glu = () => { const g = new THREE.Group(); g.add(mesh(new THREE.TorusGeometry(0.12, 0.04, 6, 6), mat('#F59F00'), null, [Math.PI / 2, 0, 0])); return g; };
  const lerp = (a, b, u) => new THREE.Vector3().lerpVectors(new THREE.Vector3(...a), new THREE.Vector3(...b), u);
  const c = mover('carbon_dioxide', co2, u => lerp([-2.5, -2.0, -0.6], [-1.0, -0.05, -0.6], u), 0.25, 4);
  c.add(proxy(new THREE.BoxGeometry(1.6, 2, 0.6), [-1.75, -1.0, -0.6]));
  const w = mover('water', h2o, u => lerp([-4.4, -2.3, 0], [-2.4, 0.1, 0], u), 0.22, 4);
  w.add(proxy(new THREE.BoxGeometry(2, 2.4, 0.6), [-3.4, -1.1, 0]));
  const o = mover('oxygen', o2, u => lerp([0.2, -0.05, 0.7], [3.4, -1.6, 1.2], u), 0.22, 4);
  o.add(proxy(new THREE.BoxGeometry(3.2, 1.6, 0.6), [1.8, -0.8, 0.95]));
  const g = mover('glucose', glu, u => lerp([-0.5, 0.2, 0], [-3.6, -1.6, 0], u), 0.15, 3);
  g.add(proxy(new THREE.BoxGeometry(3.2, 1.6, 0.5), [-2.0, -0.7, 0]));
  return { root, animated: true, overlay: '6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂', update(dt) { anim.forEach(f => f(dt)); } };
}

// --------------------------------------------------------------- blood cells
function biconcaveGeometry(r) {
  // Profile of a red cell: thick rim, thin dimpled middle, spun round its axis.
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const x = (i / 24) * r;
    const t = x / r;
    const h = 0.5 * r * Math.sqrt(Math.max(0, 1 - t * t)) * (0.21 + 2.0 * t * t - 1.12 * t * t * t * t);
    pts.push(new THREE.Vector2(x, h));
  }
  for (let i = 24; i >= 0; i--) pts.push(new THREE.Vector2(pts[i].x, -pts[i].y));
  return new THREE.LatheGeometry(pts, 32);
}
function blood_cells() {
  const rand = rng(21);
  const root = new THREE.Group();
  const L = 14, R = 3.2;
  const plasma = mesh(new THREE.CylinderGeometry(R, R, L, 40, 1, true), glass('#F6E3A1', 0.14, { side: THREE.BackSide }), null, [0, 0, Math.PI / 2]);
  root.add(named('plasma', plasma));
  const movers = [];
  const place = (g, count, make, speed) => {
    for (let i = 0; i < count; i++) {
      const m = make();
      const p = new THREE.Vector3((rand() - 0.5) * L, 0, 0);
      const a = rand() * TAU, rr = Math.sqrt(rand()) * (R - 0.9);
      p.y = Math.cos(a) * rr; p.z = Math.sin(a) * rr;
      m.position.copy(p);
      m.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      g.add(m);
      movers.push({ m, speed: speed * (0.8 + rand() * 0.4), spin: (rand() - 0.5) * 0.6 });
    }
    root.add(g);
  };
  // Sizes in micrometres x 0.1: red 7.5, white ~12, platelet ~2.5.
  const rbcGeo = biconcaveGeometry(0.375 * 2);
  place(group('red_blood_cell'), 16, () => mesh(rbcGeo, mat('#D7263D', { roughness: 0.4 })), 0.9);
  const wbcGeo = new THREE.IcosahedronGeometry(1.2 * 0.5 * 2, 3);
  const pos = wbcGeo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    v.multiplyScalar(1 + 0.06 * Math.sin(v.x * 9) * Math.cos(v.y * 8));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  wbcGeo.computeVertexNormals();
  place(group('white_blood_cell'), 2, () => {
    const g = new THREE.Group();
    g.add(mesh(wbcGeo, mat('#EDE7F6', { transparent: true, opacity: 0.75, roughness: 0.9 })));
    [[-0.3, 0, 0], [0.05, 0.25, 0.1], [0.32, -0.05, -0.1]].forEach(p => g.add(mesh(new THREE.SphereGeometry(0.28, 14, 10), mat('#6741D9'), p)));
    return g;
  }, 0.6);
  const pGeo = new THREE.DodecahedronGeometry(0.13, 0);
  place(group('platelets'), 10, () => { const m = mesh(pGeo, mat('#F4C430')); m.scale.set(1, 0.45, 0.8); return m; }, 1.0);
  return {
    root, animated: true,
    update(dt) {
      for (const s of movers) {
        s.m.position.x += dt * s.speed;
        if (s.m.position.x > L / 2) s.m.position.x -= L;
        s.m.rotation.y += dt * s.spin;
      }
    },
  };
}

// ----------------------------------------------------------- nuclear reactor
function pipe(points, radius, material) {
  return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 48, radius, 8), material);
}
function nuclear_reactor() {
  const root = new THREE.Group();
  const anim = [];
  // containment around the reactor side
  const cont = group('containment');
  const cMat = glass('#A0AEC0', 0.16);
  cont.add(mesh(new THREE.CylinderGeometry(3.2, 3.2, 4.4, 40, 1, true), cMat, [-2.4, 2.2, 0]));
  cont.add(mesh(new THREE.SphereGeometry(3.2, 40, 16, 0, TAU, 0, Math.PI / 2), cMat, [-2.4, 4.4, 0]));
  root.add(cont);
  root.add(mesh(new THREE.BoxGeometry(14, 0.2, 6), mat('#2D3748'), [0.5, -0.1, 0]));
  const vessel = mesh(new THREE.CapsuleGeometry(0.9, 1.8, 8, 24), glass('#718096', 0.35), [-3.6, 2.0, 0]);
  root.add(named('reactor_vessel', vessel));
  const core = group('fuel_core');
  const fuelMat = mat('#F6AD55', { emissive: '#FF7A00', emissiveIntensity: 0.6 });
  for (let i = -2; i <= 2; i++) for (let k = -1; k <= 1; k++)
    core.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6), fuelMat, [-3.6 + i * 0.2, 1.8, k * 0.25]));
  root.add(core);
  const rods = group('control_rods');
  const rodMat = mat('#1A202C', { metalness: 0.6, roughness: 0.3 });
  [-0.3, -0.1, 0.1, 0.3].forEach((x, i) => rods.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 6), rodMat, [-3.6 + x, 3.2, i % 2 ? 0.12 : -0.12])));
  root.add(rods);
  const hot = mat('#E53E3E'), cold = mat('#3182CE');
  const loop = group('primary_loop');
  loop.add(pipe([[-2.8, 2.4, 0], [-2.0, 2.8, 0], [-1.2, 2.8, 0], [-1.0, 2.6, 0]], 0.13, hot));
  loop.add(pipe([[-1.0, 1.2, 0], [-1.6, 1.0, 0], [-2.4, 1.2, 0], [-2.8, 1.6, 0]], 0.13, cold));
  root.add(loop);
  root.add(named('pressurizer', mesh(new THREE.CapsuleGeometry(0.28, 0.8, 6, 16), mat('#C53030'), [-1.9, 3.6, 0.9])));
  const sg = mesh(new THREE.CapsuleGeometry(0.55, 2.4, 8, 20), mat('#D69E2E', { metalness: 0.3 }), [-0.6, 2.2, 0]);
  root.add(named('steam_generator', sg));
  // steam to the turbine, water back
  const steamPipe = pipe([[-0.6, 3.9, 0], [0.4, 4.4, 0], [2.4, 4.4, 0], [3.0, 2.1, 0]], 0.12, mat('#E2E8F0'));
  const feedPipe = pipe([[3.4, 0.7, 0.6], [1.0, 0.6, 0.8], [-0.4, 0.8, 0.4], [-0.6, 1.0, 0]], 0.1, cold);
  root.add(steamPipe, feedPipe);
  const turbine = group('turbine');
  const tBody = mesh(new THREE.CylinderGeometry(0.75, 0.45, 2.0, 24), mat('#4A5568', { metalness: 0.5 }), [3.6, 2.0, 0], [0, 0, Math.PI / 2]);
  const blades = new THREE.Group();
  for (let i = 0; i < 8; i++) blades.add(mesh(new THREE.BoxGeometry(0.05, 1.3, 0.2), mat('#A0AEC0', { metalness: 0.7 }), [0, 0, 0], [i * Math.PI / 8, 0, 0]));
  blades.position.set(2.55, 2.0, 0);
  turbine.add(tBody, blades);
  root.add(turbine);
  root.add(named('generator', mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.3, 28), mat('#3182CE', { metalness: 0.4 }), [5.3, 2.0, 0], [0, 0, Math.PI / 2])));
  const shaft = mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.6, 8), mat('#718096'), [4.0, 2.0, 0], [0, 0, Math.PI / 2]);
  root.add(shaft);
  root.add(named('condenser', mesh(new THREE.BoxGeometry(1.8, 0.8, 1.4), mat('#63B3ED'), [3.6, 0.6, 0])));
  const towerPts = [];
  for (let i = 0; i <= 12; i++) { const y = i / 12 * 3.2; towerPts.push(new THREE.Vector2(0.75 + 0.35 * Math.pow((y - 2.2) / 2.2, 2), y)); }
  const tower = mesh(new THREE.LatheGeometry(towerPts, 32), mat('#CBD5E0', { side: THREE.DoubleSide }), [6.4, 0, -1.6]);
  root.add(named('cooling_tower', tower));
  const vapour = flowParticles(18, new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: '#EDF2F7', transparent: true, opacity: 0.55 }),
    (u, j) => new THREE.Vector3(6.4 + j.x * 0.8, 3.2 + u * 2.2, -1.6 + j.z * 0.8), 0.25, 17);
  root.add(vapour.mesh);
  anim.push(dt => vapour.update(dt));
  // primary water moving round, faster when the reactor is hotter
  const loopCurve = new THREE.CatmullRomCurve3([[-3.6, 2.6, 0], [-2.0, 2.8, 0], [-1.0, 2.6, 0], [-0.6, 1.6, 0], [-1.0, 1.2, 0], [-2.4, 1.2, 0], [-3.6, 1.4, 0]].map(p => new THREE.Vector3(...p)), true);
  let rodsDown = false, power = 1;
  const coolant = flowParticles(20, new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshBasicMaterial({ color: '#FED7D7' }), u => loopCurve.getPoint(u), 0.2, 23);
  root.add(coolant.mesh);
  anim.push(dt => {
    const target = rodsDown ? 0.15 : 1;
    power += (target - power) * Math.min(1, dt * 0.8);
    rods.position.y += ((rodsDown ? -1.1 : 0) - rods.position.y) * Math.min(1, dt * 2);
    fuelMat.emissiveIntensity = 0.15 + 0.6 * power;
    coolant.update(dt * power);
    blades.rotation.x += dt * 6 * power;
  });
  return {
    root, animated: true,
    update(dt) { anim.forEach(f => f(dt)); },
    controls: [{ id: 'rods', label: 'Lower control rods', active: false, toggle() { rodsDown = !rodsDown; this.active = rodsDown; this.label = rodsDown ? 'Raise control rods' : 'Lower control rods'; } }],
  };
}

// ---------------------------------------------------------------- globes
// A planet or moon from a NASA global map. Tilt and rings are facts about
// the body, keyed by the component id the manifest gives it.
const GLOBE = {
  earth: { tilt: 23.4, spin: 0.25 }, moon: { tilt: 6.7, spin: 0.05 }, mars: { tilt: 25.2, spin: 0.25 },
  venus: { tilt: 177.4, spin: -0.02 }, jupiter: { tilt: 3.1, spin: 0.6 }, saturn: { tilt: 26.7, spin: 0.55, rings: true },
  neptune: { tilt: 28.3, spin: 0.4 }, pluto: { tilt: 122.5, spin: 0.05 }, europa: { tilt: 0.1, spin: 0.1 },
};
function globe({ manifest, texture }) {
  const id = (manifest.components[0] || {}).id || 'planet';
  const facts = GLOBE[id] || { tilt: 0, spin: 0.2 };
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.rotation.z = THREE.MathUtils.degToRad(-facts.tilt);
  root.add(tilt);
  const body = named(id, mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 })));
  tilt.add(body);
  // The axis it spins on, faintly: tilt is part of the lesson (seasons).
  const axis = mesh(new THREE.CylinderGeometry(0.006, 0.006, 2.5, 6), new THREE.MeshBasicMaterial({ color: '#7fd9ef', transparent: true, opacity: 0.5 }));
  tilt.add(axis);
  if (facts.rings) {
    const ring = new THREE.RingGeometry(1.24, 2.3, 96, 4);
    const pos = ring.getAttribute('position'), colors = [];
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      const band = (Math.sin(r * 22) * 0.5 + 0.5) * 0.35 + (r > 1.95 && r < 2.0 ? -0.4 : 0.55);   // Cassini division
      colors.push(0.85 * band + 0.1, 0.78 * band + 0.08, 0.6 * band + 0.05);
    }
    ring.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const rings = named(id + '_rings', mesh(ring, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.85, roughness: 1 })));
    rings.rotation.x = -Math.PI / 2;
    tilt.add(rings);
  }
  return {
    root, animated: true,
    update(dt) { body.rotation.y += dt * facts.spin; },
    controls: [{ id: 'spin', label: 'Pause spin', active: false, toggle() { this.active = !this.active; this.label = this.active ? 'Spin' : 'Pause spin'; facts._saved = facts._saved ?? facts.spin; facts.spin = this.active ? 0 : facts._saved; } }],
  };
}

// ------------------------------------------------------------- black hole
// A soft round dot for star and gas particles (instead of square points).
let _dot = null;
function dotTexture() {
  if (_dot) return _dot;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.6)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  _dot = new THREE.CanvasTexture(c);
  return _dot;
}
function glowPoints(positions, colors, size) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ size, map: dotTexture(), vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
}
const additive = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false,
  blending: THREE.AdditiveBlending, side: THREE.DoubleSide });

function black_hole() {
  const rand = rng(31);
  const root = new THREE.Group();
  const tilt = new THREE.Group(); tilt.rotation.x = 0.18; root.add(tilt);
  // The event horizon: the boundary nothing comes back from. Pure black.
  const horizon = mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.MeshBasicMaterial({ color: '#000000' }));
  tilt.add(named('event_horizon', horizon));
  // Photon sphere: where light itself can circle the hole (1.5 x the horizon).
  const photon = mesh(new THREE.TorusGeometry(1.5, 0.025, 8, 128), additive('#ffe2a8', 0.9), null, [Math.PI / 2, 0, 0]);
  photon.add(proxy(new THREE.TorusGeometry(1.5, 0.15, 6, 48)));
  tilt.add(named('photon_sphere', photon));
  // Accretion disk: gas spiralling in, hottest (whitest) nearest the hole.
  const disk = group('accretion_disk');
  const inner = 3.0, outer = 8.0;       // the innermost stable orbit is 3x the horizon radius
  const ring = new THREE.RingGeometry(inner, outer, 160, 8);
  const rp = ring.getAttribute('position'), cols = [];
  const hot = new THREE.Color('#fff4d6'), warm = new THREE.Color('#ffa63d'), cool = new THREE.Color('#b8321e');
  for (let i = 0; i < rp.count; i++) {
    const r = Math.hypot(rp.getX(i), rp.getY(i)), u = (r - inner) / (outer - inner);
    const c = u < 0.35 ? hot.clone().lerp(warm, u / 0.35) : warm.clone().lerp(cool, (u - 0.35) / 0.65);
    cols.push(c.r * (1 - u * 0.6), c.g * (1 - u * 0.6), c.b * (1 - u * 0.6));
  }
  ring.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const diskMesh = mesh(ring, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false }), null, [-Math.PI / 2, 0, 0]);
  disk.add(diskMesh);
  // Clumps of gas, each orbiting at its own speed: faster closer in (Kepler).
  const n = 1400, pos = new Float32Array(n * 3), pc = [], orbit = [];
  for (let i = 0; i < n; i++) {
    const r = inner + Math.pow(rand(), 1.6) * (outer - inner), a = rand() * TAU, u = (r - inner) / (outer - inner);
    orbit.push({ r, a, w: 2.2 / Math.pow(r / inner, 1.5), y: (rand() - 0.5) * 0.08 * r / inner });
    const c = u < 0.35 ? hot.clone().lerp(warm, u / 0.35) : warm.clone().lerp(cool, (u - 0.35) / 0.65);
    pc.push(c.r, c.g, c.b);
  }
  const clumps = glowPoints(pos, pc, 0.22);
  disk.add(clumps);
  disk.add(proxy(new THREE.CylinderGeometry(outer, outer, 0.3, 48, 1)));
  tilt.add(disk);
  // Gravitational lensing: light from the far side of the disk bent up over
  // the hole and down under it. It always faces the viewer, as it does in the
  // real images, because it is light travelling towards YOU.
  const lens = group('lensed_light');
  const arc = new THREE.RingGeometry(1.75, 3.3, 128, 4);
  const ap = arc.getAttribute('position'), ac = [];
  for (let i = 0; i < ap.count; i++) {
    const r = Math.hypot(ap.getX(i), ap.getY(i)), u = (r - 1.75) / 1.55;
    const k = Math.exp(-Math.pow((u - 0.18) / 0.22, 2));
    ac.push(1.0 * k, 0.72 * k, 0.38 * k);
  }
  arc.setAttribute('color', new THREE.Float32BufferAttribute(ac, 3));
  lens.add(mesh(arc, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide })));
  lens.add(proxy(new THREE.RingGeometry(1.7, 3.3, 48)));
  root.add(lens);
  // Jets: some of the gas is flung out along the spin axis at nearly the speed of light.
  const jets = group('jets');
  const jetMat = additive('#7fb8ff', 0.28);
  [1, -1].forEach(sgn => {
    const cone = mesh(new THREE.ConeGeometry(0.5, 5.5, 24, 1, true), jetMat, [0, sgn * 3.6, 0], [sgn > 0 ? Math.PI : 0, 0, 0]);
    jets.add(cone);
  });
  const jn = 260, jpos = new Float32Array(jn * 3), jc = [], jstate = [];
  for (let i = 0; i < jn; i++) { jstate.push({ u: rand(), s: rand() < 0.5 ? 1 : -1, a: rand() * TAU, k: rand() }); jc.push(0.6, 0.8, 1); }
  const jetDots = glowPoints(jpos, jc, 0.16);
  jets.add(jetDots, proxy(new THREE.CylinderGeometry(0.6, 0.6, 12, 12)));
  tilt.add(jets);
  return {
    root, animated: true, faceCamera: [lens],
    update(dt) {
      const p = clumps.geometry.getAttribute('position');
      orbit.forEach((o, i) => { o.a += o.w * dt; p.setXYZ(i, Math.cos(o.a) * o.r, o.y, -Math.sin(o.a) * o.r); });
      p.needsUpdate = true;
      diskMesh.rotation.z += dt * 0.15;
      const q = jetDots.geometry.getAttribute('position');
      jstate.forEach((j, i) => { j.u = (j.u + dt * 0.35) % 1; const h = 1.1 + j.u * 5.5, w = 0.05 + j.u * 0.45 * j.k;
        q.setXYZ(i, Math.cos(j.a) * w, j.s * h, Math.sin(j.a) * w); });
      q.needsUpdate = true;
    },
  };
}

// --------------------------------------------------------- Milky Way galaxy
// Positions follow published maps of the Milky Way (a barred spiral, about
// 100,000 light years across); 1 unit = 5,000 light years.
function galaxy() {
  const rand = rng(77);
  const root = new THREE.Group();
  const spin = new THREE.Group(); root.add(spin);
  let paused = false;
  const gauss = () => (rand() + rand() + rand() - 1.5) / 1.5;
  // Central bulge: old yellowish stars, packed tight.
  const bp = [], bc = [];
  for (let i = 0; i < 2600; i++) {
    const v = randomInBall(rand, 1).multiplyScalar(1.6 * Math.pow(rand(), 0.7));
    bp.push(v.x, v.y * 0.55, v.z); const k = 0.7 + rand() * 0.3; bc.push(1 * k, 0.86 * k, 0.6 * k);
  }
  const bulge = group('central_bulge', [glowPoints(bp, bc, 0.16), proxy(new THREE.SphereGeometry(1.2, 16, 12))]);
  spin.add(bulge);
  // The bar: a long box of stars through the middle.
  const barp = [], barc = [];
  for (let i = 0; i < 1500; i++) { barp.push(gauss() * 2.6, gauss() * 0.15, gauss() * 0.55); barc.push(1, 0.82, 0.58); }
  const bar = group('central_bar', [glowPoints(barp, barc, 0.12), proxy(new THREE.BoxGeometry(5.2, 0.4, 1.0))]);
  bar.rotation.y = 0.45;
  spin.add(bar);
  // Spiral arms: two major arms and two minor ones, as logarithmic spirals.
  const ap = [], ac = [];
  const arms = [[0, 1.0, 2600], [Math.PI, 1.0, 2600], [Math.PI / 2, 0.55, 1200], [-Math.PI / 2, 0.55, 1200]];
  for (const [start, weight, count] of arms) {
    for (let i = 0; i < count; i++) {
      const t = Math.pow(rand(), 0.8);
      const r = 2.2 + t * 7.8, theta = start + Math.log(r / 2.2) / Math.tan(0.22) * 0.2 + 0.45;
      const spread = 0.35 + 0.5 * t;
      const x = Math.cos(theta) * r + gauss() * spread, z = Math.sin(theta) * r + gauss() * spread;
      ap.push(x, gauss() * 0.12, z);
      const pink = rand() < 0.06 * weight;          // glowing gas clouds where new stars form
      if (pink) ac.push(1, 0.45, 0.7); else { const k = 0.55 + rand() * 0.45; ac.push(0.7 * k, 0.82 * k, 1 * k); }
    }
  }
  // A thin scatter of stars between the arms.
  for (let i = 0; i < 1500; i++) { const r = 1.5 + Math.pow(rand(), 0.6) * 8.5, a = rand() * TAU; ap.push(Math.cos(a) * r, gauss() * 0.15, Math.sin(a) * r); ac.push(0.35, 0.38, 0.45); }
  const armGroup = group('spiral_arms', [glowPoints(ap, ac, 0.13)]);
  const armProxy = proxy(new THREE.CylinderGeometry(10, 10, 0.25, 48, 1, true));
  const armDisc = proxy(new THREE.RingGeometry(1.8, 10, 48)); armDisc.rotation.x = -Math.PI / 2;
  armGroup.add(armProxy, armDisc);
  spin.add(armGroup);
  // Sagittarius A*: the supermassive black hole at the very centre.
  const sgr = group('sagittarius_a', [mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: '#000' })),
    mesh(new THREE.TorusGeometry(0.16, 0.02, 6, 32), additive('#ffd28a', 0.9), null, [Math.PI / 2, 0, 0]),
    proxy(new THREE.SphereGeometry(0.35, 12, 8))]);
  sgr.position.y = 0.0;
  spin.add(sgr);
  // The Sun: about 26,000 light years out, between two arms (the Orion Spur).
  const sunAngle = 2.15, sunR = 26000 / 5000;
  const sun = group('sun', [mesh(new THREE.SphereGeometry(0.1, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffe066' })),
    mesh(new THREE.RingGeometry(0.17, 0.21, 32), additive('#ffe066', 0.9), null, [-Math.PI / 2, 0, 0]),
    proxy(new THREE.SphereGeometry(0.45, 12, 8))]);
  sun.position.set(Math.cos(sunAngle) * sunR, 0.05, Math.sin(sunAngle) * sunR);
  spin.add(sun);
  // The halo: a faint sphere of very old star clusters (globular clusters).
  const hp = [], hc = [];
  for (let i = 0; i < 160; i++) { const v = randomInBall(rand, 1).normalize().multiplyScalar(5 + rand() * 7); hp.push(v.x, v.y * 0.8, v.z); hc.push(1, 0.9, 0.7); }
  const halo = group('halo', [glowPoints(hp, hc, 0.28), mesh(new THREE.SphereGeometry(12, 32, 16), additive('#6d7fb8', 0.035))]);
  halo.traverse(o => { o.userData.noFit = true; });   // frame the disk, not its faint halo
  halo.children[1].material.side = THREE.BackSide;
  spin.add(halo);
  return {
    root, animated: true,
    // One turn of the Sun round the centre takes about 230 million years.
    update(dt) { if (!paused) spin.rotation.y -= dt * 0.04; },
    controls: [{ id: 'spin', label: 'Pause turning', active: false, toggle() { paused = !paused; this.active = paused; this.label = paused ? 'Turn' : 'Pause turning'; } }],
  };
}

export const BUILDERS = { black_hole, galaxy, globe, animal_cell, mitochondrion, atom_carbon, solar_system, water_cycle, photosynthesis, blood_cells, nuclear_reactor };
