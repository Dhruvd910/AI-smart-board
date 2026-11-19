// Run: node test/live.test.mjs — the maths behind live.js (no browser).
import assert from "node:assert/strict";
import { projectile, keyPoints, keyPointsLine, dimsFor, payloadFor } from "../public/live.js";

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

// Projectile: matches Liza's engine capture (u=20, 45°, g=9.81): T 2.88 s, R 40.77 m, H 10.19 m.
const p = projectile(20, 45, 9.81, 0);
near(p.T, 2.88, 0.005); near(p.range, 40.77, 0.005); near(p.maxHeight, 10.19, 0.005);
near(p.at(p.T).y, 0, 1e-9);
near(p.at(p.tPeak).vy, 0, 1e-9);
// From a height, straight across: T = sqrt(2h/g).
const ledge = projectile(10, 0, 9.8, 19.6);
near(ledge.T, 2); near(ledge.range, 20); near(ledge.maxHeight, 19.6);
// Straight up: R = 0, H = u²/2g.
const up = projectile(10, 90, 10, 0);
near(up.range, 0, 1e-9); near(up.maxHeight, 5); near(up.T, 2);

// Key points of y = x² − 3 sampled on [-5, 5] (not hitting the roots or vertex exactly).
const xs = Array.from({ length: 301 }, (_, i) => -5.01 + i * 10.02 / 300);
const k = keyPoints(xs.map((x) => [x, x * x - 3]));
assert.equal(k.roots.length, 2);
near(k.roots[0], -Math.sqrt(3), 2e-3); near(k.roots[1], Math.sqrt(3), 2e-3);
assert.equal(k.turns.length, 1);
near(k.turns[0][0], 0, 1e-9); near(k.turns[0][1], -3, 1e-9); // exact for a quadratic
near(k.yInt, -3, 2e-3);
// Holes in a curve (1/x) are not roots.
assert.equal(keyPoints([[-1, -1], [-0.5, -2], [0, null], [0.5, 2], [1, 1]]).roots.length, 0);
assert.match(keyPointsLine([{ label: "y = x^2 - 3", points: xs.map((x) => [x, x * x - 3]) }]), /roots x = -1.73, 1.73 · vertex \(0, -3\) · y-intercept -3/);

// Solid sizes round-trip through Liza's geometry words.
const c = dimsFor("Cuboid; length = 6 cm; breadth = 4 cm; height = 3 cm");
assert.deepEqual(c.dims.map((d) => d.value), [6, 4, 3]);
c.dims[2].value = 5.5;
assert.equal(payloadFor(c), "Cuboid; length = 6 cm; breadth = 4 cm; height = 5.5 cm");
assert.deepEqual(dimsFor("Cuboid 8 x 2 x 3").dims.map((d) => d.value), [8, 2, 3]);
assert.deepEqual(dimsFor("Cube; side = 5").dims.map((d) => d.value), [5]);
assert.deepEqual(dimsFor("Cylinder; r = 2; h = 7").dims.map((d) => d.value), [2, 7]);
assert.equal(dimsFor("Triangle; AB = 3"), null);
console.log("live.js maths ok");
