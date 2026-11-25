// Run: node test/core.test.js
const assert = require("node:assert/strict");
const C = require("../public/core.js");

const pen = (pts, width = 4) => ({ tool: "pen", color: "#000", width, points: pts.map(([x, y]) => [x, y, 0.5]) });

// distance to a segment, including past its ends
assert.equal(C.distToSeg(5, 3, 0, 0, 10, 0), 3);
assert.equal(C.distToSeg(13, 4, 0, 0, 10, 0), 5);
assert.equal(C.distToSeg(1, 1, 2, 2, 2, 2), Math.SQRT2);

// eraser hits along a stroke, not just inside its box
const diag = pen([[0, 0], [100, 100]]);
assert.ok(C.hits(diag, 50, 52, 2));
assert.ok(!C.hits(diag, 90, 10, 5));
assert.ok(C.hits(pen([[10, 10]]), 12, 10, 1)); // a dot

const rect = { tool: "rect", color: "#000", width: 2, points: [[0, 0], [100, 50]] };
assert.ok(C.hits(rect, 100, 25, 1)); // on the right edge
assert.ok(!C.hits(rect, 50, 25, 5)); // the empty middle
const oval = { tool: "ellipse", color: "#000", width: 2, points: [[0, 0], [100, 50]] };
assert.ok(C.hits(oval, 50, 0, 2));
assert.ok(!C.hits(oval, 50, 25, 5));
const text = { tool: "text", color: "#000", x: 10, y: 10, size: 20, text: "hello" };
assert.ok(C.hits(text, 20, 20, 1));

assert.deepEqual(C.boundsOf([pen([[0, 0], [10, 20]], 2)]), { x0: -2, y0: -2, x1: 12, y1: 22 });
assert.equal(C.boundsOf([]), null);

// undo / redo keep the stacking order
const h = new C.History();
const [a, b, c, d] = [1, 2, 3, 4].map((n) => pen([[n, n]]));
[a, b, c, d].forEach((it) => h.add(it));
h.remove([b]);
h.remove([d]);
assert.deepEqual(h.items, [a, c]);
h.undo(); h.undo();
assert.deepEqual(h.items, [a, b, c, d]);
h.redo();
assert.deepEqual(h.items, [a, c, d]);

// one eraser drag is one undo step, whatever order the strokes were hit in
const g = new C.History();
const items = [1, 2, 3, 4, 5].map((n) => pen([[n, n]]));
items.forEach((it) => g.add(it));
const drag = {};
g.remove([items[3]], drag);
g.remove([items[0]], drag);
g.remove([items[4]], drag);
assert.deepEqual(g.items, [items[1], items[2]]);
assert.equal(g.done.length, 6);
g.undo();
assert.deepEqual(g.items, items);
g.redo();
assert.deepEqual(g.items, [items[1], items[2]]);

// clear is undoable, and new work drops the redo stack
h.clear();
assert.equal(h.items.length, 0);
h.undo();
assert.deepEqual(h.items, [a, c, d]);
h.add(b);
assert.equal(h.redo(), false);

// a board file is checked before it is drawn
const clean = C.sanitize({ items: [
  pen([[0, 0], [5, 5]]),
  { tool: "rect", color: "#f00", width: 2, points: [[0, 0]] }, // one corner only
  { tool: "script", color: "#000", width: 1, points: [[0, 0]] },
  { tool: "pen", color: "#000", width: -1, points: [[0, 0]] },
  { tool: "pen", color: "#000", width: 2, points: [[0, 0], ["x", 1], [NaN, 2], [3, 3]] },
  { tool: "text", color: "#000", x: 1, y: 2, size: 18, text: "hi" },
  { tool: "text", color: "#000", x: 1, y: 2, size: 0, text: "hi" },
  null,
] });
assert.equal(clean.length, 3);
assert.equal(clean[1].points.length, 2);
assert.deepEqual(C.sanitize("nonsense"), []);
assert.deepEqual(C.sanitize(null), []);

// the change counter moves on every change, undo and redo included
const v = new C.History();
v.add(a); v.add(b);
const v0 = v.version;
v.undo(); v.redo(); v.remove([a]);
assert.equal(v.version, v0 + 3);

// sticky notes and pictures are boxes: hit anywhere inside, kept by sanitize
const note = { tool: "sticky", color: "#fef3a0", x: 10, y: 20, w: 200, h: 100, text: "Hi", size: 20 };
assert.ok(C.hits(note, 100, 70, 1), "inside a note");
assert.ok(!C.hits(note, 300, 70, 1));
assert.deepEqual(C.bounds(note), { x0: 10, y0: 20, x1: 210, y1: 120 });
const pic = { tool: "image", color: "#000", x: 0, y: 0, w: 50, h: 40, src: "data:image/png;base64,AAAA" };
assert.equal(C.sanitize({ items: [note, pic, { ...pic, src: "javascript:alert(1)" }, { ...note, w: -1 }] }).length, 2,
  "bad picture source and a note with no size are dropped");

// moving is one undo step, and bounds follow the item
const m = new C.History([note]);
m.move([note], 5, 7);
assert.deepEqual([note.x, note.y], [15, 27]);
assert.equal(C.bounds(note).x0, 15, "box cache cleared on move");
m.undo();
assert.deepEqual([note.x, note.y], [10, 20]);
m.redo();
assert.deepEqual([note.x, note.y], [15, 27]);
const stroke = pen([[0, 0], [10, 10]]);
m.add(stroke);
m.move([stroke], 1, 1);
assert.deepEqual(stroke.points[1].slice(0, 2), [11, 11]);

// a note's text edited in place, undoable
const edited = { ...note, text: "Hello" };
m.replace(note, edited);
assert.equal(m.items[0].text, "Hello");
m.undo();
assert.equal(m.items[0], note);

// a mind map goes on as one step
const many = [pen([[0, 0], [1, 1]]), pen([[2, 2], [3, 3]])];
m.addMany(many);
assert.equal(m.items.length, 4);
m.undo();
assert.equal(m.items.length, 2);

// a whole board: pages, or an old single-page file
assert.deepEqual(C.sanitizeBoard({ items: [stroke] }).pages.length, 1);
const two = C.sanitizeBoard({ pages: [{ items: [stroke] }, { items: [] }], bg: "dots" });
assert.equal(two.pages.length, 2);
assert.equal(two.bg, "dots");
assert.equal(C.sanitizeBoard(null).pages.length, 1, "nothing at all is one empty page");

// swap: handwriting out, neat text in, as one undo step that keeps the stacking order
{
  const a = { tool: "pen", color: "#000", width: 2, points: [[0, 0, 0.5], [5, 5, 0.5]] };
  const b = { tool: "rect", color: "#000", width: 2, points: [[0, 0, 0.5], [9, 9, 0.5]] };
  const c = { tool: "pen", color: "#000", width: 2, points: [[1, 1, 0.5], [6, 6, 0.5]] };
  const t = { tool: "text", color: "#000", x: 0, y: 0, text: "Hi", size: 20 };
  const h = new C.History([a, b, c]);
  h.swap([a, c], [t]);
  assert.deepEqual(h.items, [b, t]);
  h.undo();
  assert.deepEqual(h.items, [a, b, c], "undo puts the strokes back where they were");
  h.redo();
  assert.deepEqual(h.items, [b, t]);
}
assert.equal(C.sanitizeBoard({ pages: [], paper: "chalk" }).paper, "chalk");

console.log("core: all checks pass");
