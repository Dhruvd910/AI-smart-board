// The board without a screen: items, hit-testing, undo history and file checks.
// No DOM in here, so `node test/core.test.js` can check it.
(function (root) {
  "use strict";

  var TOOLS = ["pen", "hl", "line", "arrow", "rect", "ellipse", "text", "sticky", "image"];
  // Sticky notes and pictures are boxes: {x, y, w, h}, plus text or a data: URL.
  var BOXES = ["sticky", "image"];
  var isBox = function (item) { return BOXES.indexOf(item.tool) >= 0; };

  function distToSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    var x = ax + t * dx - px, y = ay + t * dy - py;
    return Math.sqrt(x * x + y * y);
  }

  // Rough text box: the canvas measures properly when drawing, this only has to
  // be big enough for erasing and for culling off-screen items.
  function textBox(item) {
    var lines = item.text.split("\n");
    var longest = Math.max.apply(null, lines.map(function (l) { return l.length; }));
    return { w: Math.max(1, longest) * item.size * 0.62, h: lines.length * item.size * 1.25 };
  }

  // The outline an item is drawn along, as [[x, y], ...] in board coordinates.
  function outline(item) {
    var p = item.points;
    if (isBox(item)) {
      return [[item.x, item.y], [item.x + item.w, item.y], [item.x + item.w, item.y + item.h], [item.x, item.y + item.h], [item.x, item.y]];
    }
    if (item.tool === "pen" || item.tool === "hl" || item.tool === "line" || item.tool === "arrow") return p;
    var a = p[0], b = p[1];
    if (item.tool === "rect") return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [a[0], a[1]]];
    if (item.tool === "ellipse") {
      var cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2;
      var out = [];
      for (var i = 0; i <= 48; i++) {
        var t = (i / 48) * Math.PI * 2;
        out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
      }
      return out;
    }
    return [];
  }

  var boxCache = typeof WeakMap === "function" ? new WeakMap() : null;

  function bounds(item) {
    var b = boxCache && boxCache.get(item);
    if (b) return b;
    if (isBox(item)) {
      b = { x0: item.x, y0: item.y, x1: item.x + item.w, y1: item.y + item.h };
    } else if (item.tool === "text") {
      var tb = textBox(item);
      b = { x0: item.x, y0: item.y, x1: item.x + tb.w, y1: item.y + tb.h };
    } else {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      item.points.forEach(function (q) {
        if (q[0] < x0) x0 = q[0];
        if (q[0] > x1) x1 = q[0];
        if (q[1] < y0) y0 = q[1];
        if (q[1] > y1) y1 = q[1];
      });
      // Half the line width, more for pressure and an arrow's head.
      var pad = item.width * (item.tool === "arrow" ? 5 : 1);
      b = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    }
    if (boxCache) boxCache.set(item, b);
    return b;
  }

  // Moves an item in place (a drag with the select tool).
  function shift(item, dx, dy) {
    if (isBox(item) || item.tool === "text") { item.x += dx; item.y += dy; }
    else item.points.forEach(function (q) { q[0] += dx; q[1] += dy; });
    if (boxCache) boxCache.delete(item);
  }

  function boundsOf(items) {
    if (!items.length) return null;
    var out = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    items.forEach(function (it) {
      var b = bounds(it);
      out.x0 = Math.min(out.x0, b.x0); out.y0 = Math.min(out.y0, b.y0);
      out.x1 = Math.max(out.x1, b.x1); out.y1 = Math.max(out.y1, b.y1);
    });
    return out;
  }

  // Whether a circle of radius r at (x, y) touches the item: the eraser's test.
  function hits(item, x, y, r) {
    var b = bounds(item);
    if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) return false;
    if (item.tool === "text" || isBox(item)) return true;
    var reach = r + item.width / 2;
    var line = outline(item);
    if (line.length === 1) return Math.hypot(line[0][0] - x, line[0][1] - y) <= reach;
    for (var i = 1; i < line.length; i++) {
      if (distToSeg(x, y, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]) <= reach) return true;
    }
    return false;
  }

  // Everything on the board plus undo/redo. Each step is {add: [items]} or
  // {removed: [[index, item], ...]}; indexes keep the stacking order on undo.
  function History(items) {
    this.items = items || [];
    this.done = [];
    this.undone = [];
    this.version = 0; // goes up on every change, so the board knows when to read again
  }

  History.prototype.add = function (item) {
    this.items.push(item);
    this.version++;
    this.done.push({ add: [item] });
    this.undone = [];
  };

  // `group` merges every removal of one eraser drag into a single undo step.
  History.prototype.remove = function (list, group) {
    var self = this;
    var last = this.done[this.done.length - 1];
    if (group && last && last.group === group) {
      // Put the drag's earlier removals back, then take them out again with these.
      this.done.pop();
      this._apply(last, true);
      list = last.removed.map(function (e) { return e[1]; }).concat(list);
    }
    var removed = list.map(function (it) { return [self.items.indexOf(it), it]; })
      .filter(function (e) { return e[0] >= 0; })
      .sort(function (a, b) { return a[0] - b[0]; });
    if (!removed.length) return;
    this._apply({ removed: removed }, false);
    this.done.push({ removed: removed, group: group });
    this.undone = [];
  };

  // Several items as one undo step (a mind map, a pasted group).
  History.prototype.addMany = function (list) {
    if (!list.length) return;
    this._apply({ add: list }, false);
    this.done.push({ add: list });
    this.undone = [];
  };

  // A drag of the select tool: one undo step however far it went.
  History.prototype.move = function (list, dx, dy) {
    if (!list.length || (!dx && !dy)) return;
    this._apply({ moved: list, dx: dx, dy: dy }, false);
    this.done.push({ moved: list, dx: dx, dy: dy });
    this.undone = [];
  };

  // One item swapped for another in its place (a sticky note's text edited).
  History.prototype.replace = function (old, item) {
    var i = this.items.indexOf(old);
    if (i < 0) return;
    var step = { replaced: [i, old, item] };
    this._apply(step, false);
    this.done.push(step);
    this.undone = [];
  };

  History.prototype.clear = function () {
    this.remove(this.items.slice());
  };

  History.prototype.undo = function () {
    var step = this.done.pop();
    if (!step) return false;
    this._apply(step, true);
    this.undone.push(step);
    return true;
  };

  History.prototype.redo = function () {
    var step = this.undone.pop();
    if (!step) return false;
    this._apply(step, false);
    this.done.push(step);
    return true;
  };

  History.prototype._apply = function (step, backwards) {
    var items = this.items;
    this.version++;
    if (step.moved) {
      var k = backwards ? -1 : 1;
      step.moved.forEach(function (it) { shift(it, k * step.dx, k * step.dy); });
    } else if (step.replaced) {
      items[step.replaced[0]] = step.replaced[backwards ? 1 : 2];
    } else if (step.add) {
      if (backwards) step.add.forEach(function (it) { items.splice(items.indexOf(it), 1); });
      else step.add.forEach(function (it) { items.push(it); });
    } else if (backwards) {
      step.removed.forEach(function (e) { items.splice(e[0], 0, e[1]); });
    } else {
      step.removed.slice().reverse().forEach(function (e) { items.splice(e[0], 1); });
    }
  };

  function isNum(n) { return typeof n === "number" && isFinite(n); }

  // A board file comes from the user's disk: keep only well-formed items, so a
  // broken or foreign file can't crash drawing.
  function sanitize(data) {
    var list = data && Array.isArray(data.items) ? data.items : [];
    var out = [];
    list.forEach(function (it) {
      if (!it || TOOLS.indexOf(it.tool) < 0 || typeof it.color !== "string" || it.color.length > 40) return;
      if (isBox(it)) {
        if (![it.x, it.y, it.w, it.h].every(isNum) || it.w <= 0 || it.h <= 0) return;
        var box = { tool: it.tool, color: it.color, x: it.x, y: it.y, w: it.w, h: it.h };
        if (it.tool === "sticky") {
          box.text = typeof it.text === "string" ? it.text.slice(0, 5000) : "";
          box.size = isNum(it.size) && it.size > 0 ? it.size : 20;
        } else {
          if (typeof it.src !== "string" || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(it.src) || it.src.length > 4e6) return;
          box.src = it.src;
        }
        out.push(box);
        return;
      }
      if (it.tool === "text") {
        if (typeof it.text !== "string" || !isNum(it.x) || !isNum(it.y) || !isNum(it.size) || it.size <= 0) return;
        out.push({ tool: "text", color: it.color, x: it.x, y: it.y, size: it.size, text: it.text.slice(0, 5000) });
        return;
      }
      if (!isNum(it.width) || it.width <= 0 || !Array.isArray(it.points)) return;
      var pts = it.points.filter(function (q) {
        return Array.isArray(q) && isNum(q[0]) && isNum(q[1]);
      }).map(function (q) { return [q[0], q[1], isNum(q[2]) ? q[2] : 0.5]; });
      var need = it.tool === "pen" || it.tool === "hl" ? 1 : 2;
      if (pts.length < need) return;
      out.push({ tool: it.tool, color: it.color, width: it.width, pressure: !!it.pressure, points: pts });
    });
    return out;
  }

  // A whole board: {pages: [{items}], bg}. An old one-page file ({items}) is one page.
  function sanitizeBoard(data) {
    var pages = data && Array.isArray(data.pages) ? data.pages : [data];
    pages = pages.slice(0, 50).map(function (pg) { return sanitize(pg); });
    if (!pages.length) pages = [[]];
    return { pages: pages, bg: data && typeof data.bg === "string" ? data.bg : null };
  }

  var api = { TOOLS: TOOLS, distToSeg: distToSeg, outline: outline, bounds: bounds, boundsOf: boundsOf,
    hits: hits, History: History, sanitize: sanitize, sanitizeBoard: sanitizeBoard, textBox: textBox,
    shift: shift, isBox: isBox };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BoardCore = api;
})(this);
