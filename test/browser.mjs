// Drives the real page in headless Chromium with touch, stylus and mouse input.
// Run: node --experimental-websocket test/browser.mjs [screenshot dir]
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { launch, pageUrl as page } from "./cdp.mjs";

// No server: this test is about the board itself, not the reading.
const downloads = mkdtempSync(join(tmpdir(), "wb-dl-"));
const b = await launch({ shots: process.argv[2] });
const { send, js, frame, touch, fingerLine, mouse, tapButton, shot, sleep, errors } = b;
const items = () => js("board.items.length");

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: page });
  await sleep(800);
  await tapButton("#panel-min"); // these checks are about drawing: the whole window for the board

  // one finger draws
  await fingerLine(100, 100, 400, 250);
  assert.equal(await items(), 1, "finger stroke");
  assert.equal(await js("board.items[0].tool"), "pen");

  // two fingers zoom and do not draw
  await touch("touchStart", [[400, 300], [500, 300]]);
  for (let i = 1; i <= 8; i++) await touch("touchMove", [[400 - i * 10, 300], [500 + i * 10, 300]]);
  await touch("touchEnd", []);
  await frame();
  assert.equal(await items(), 1, "pinch drew nothing");
  const s = await js("view.s");
  assert.ok(Math.abs(s - 2.6) < 0.01, "fingers 100px -> 260px apart zoom 2.6x, got " + s);
  await tapButton("#zoom"); // show everything
  assert.equal(await js("view.s"), 1, "fit caps at 100%");

  // toolbar by touch, then shapes with a mouse
  await tapButton('[data-tool="rect"]');
  await mouse("drag", 500, 100, 700, 220);
  await tapButton('[data-tool="arrow"]');
  await tapButton('[data-color="#d62828"]');
  await mouse("drag", 120, 400, 380, 330);
  assert.deepEqual(await js("board.items.map(i => i.tool)"), ["pen", "rect", "arrow"]);
  assert.equal(await js("board.items[2].color"), "#d62828");
  assert.equal(await js("opts.tool"), "arrow", "a colour keeps the shape tool");

  // a tap with the rectangle tool leaves nothing behind
  await tapButton('[data-tool="rect"]');
  await fingerLine(800, 400, 801, 401, 1);
  assert.equal(await items(), 3, "tiny shape dropped");

  // text: tap, type, tap away
  await tapButton('[data-tool="text"]');
  await touch("touchStart", [[600, 380]]);
  await touch("touchEnd", []);
  assert.equal(await js("!!document.getElementById('textbox')"), true, "text box opens");
  await send("Input.insertText", { text: "F = ma" });
  await touch("touchStart", [[850, 100]]);
  await touch("touchEnd", []);
  await frame();
  assert.equal(await js("board.items[3] && board.items[3].text"), "F = ma");
  assert.equal(await js("!!document.getElementById('textbox')"), false, "tap away only closes the text");

  // eraser swipe across the first stroke, then undo brings it back
  await tapButton('[data-tool="eraser"]');
  const [ex, ey] = await js(`(() => { const p = board.items[0].points, q = p[p.length >> 1];
    return [q[0] * view.s + view.x, q[1] * view.s + view.y]; })()`);
  await fingerLine(ex, ey - 30, ex, ey + 30, 2);
  assert.deepEqual(await js("board.items.map(i => i.tool)"), ["rect", "arrow", "text"], "eraser took the stroke");
  await tapButton("#undo");
  assert.equal(await items(), 4);

  // clear, undo
  await tapButton("#clear");
  assert.equal(await items(), 0);
  await tapButton("#undo");
  assert.equal(await items(), 4);

  // stylus: pressure is kept, and afterwards a finger moves the board
  await tapButton('[data-tool="pen"]');
  await mouse("drag", 100, 500, 300, 560, "pen");
  assert.equal(await js("board.items[4].pressure"), true, "stylus stroke has pressure");
  assert.equal(await js("board.items[4].points[1][2]"), 0.7);
  const x0 = await js("view.x");
  await fingerLine(600, 500, 700, 500);
  assert.equal(await items(), 5, "palm/finger did not draw after a stylus");
  assert.equal(await js("view.x"), x0 + 100, "finger panned");

  await tapButton('#shapes [data-tool="ellipse"]');
  assert.equal(await js("opts.tool"), "ellipse", "a shape picked from the Shapes panel");
  assert.equal(await js("document.getElementById('shape').classList.contains('on')"), true, "Shapes is lit while a shape is picked");
  await tapButton('#bar [data-tool="pen"]');
  assert.equal(await js("[...document.querySelectorAll('.fly')].every(f => f.hidden)"), true, "panels close after a pick");

  // background cycles, picture saves
  await tapButton("#bg");
  assert.equal(await js("opts.bg"), "grid");
  await tapButton("#png");
  await sleep(1500);
  assert.ok(readdirSync(downloads).some((f) => f.endsWith(".png")), "PNG downloaded: " + readdirSync(downloads));
  await shot("laptop");

  // kept across a reload
  await sleep(600); // autosave delay
  await send("Page.reload");
  await sleep(800);
  assert.equal(await items(), 5, "board survives reload");

  // a sticky note: tap to place, type, tap away; then the select tool drags it
  await tapButton('#rail [data-tool="sticky"]');
  await touch("touchStart", [[520, 330]]);
  await touch("touchEnd", []);
  await frame();
  assert.equal(await js("!!document.querySelector('.note-edit')"), true, "the note opens for typing");
  await send("Input.insertText", { text: "Big idea" });
  await touch("touchStart", [[880, 120]]);
  await touch("touchEnd", []);
  await frame();
  assert.deepEqual(await js("(({tool, text}) => ({tool, text}))(board.items.at(-1))"), { tool: "sticky", text: "Big idea" });
  assert.equal(await js("opts.tool"), "select", "after placing a note the select tool is on");
  const x0n = await js("board.items.at(-1).x");
  await fingerLine(520, 330, 620, 330, 6);
  const moved = await js("board.items.at(-1).x") - x0n;
  assert.ok(Math.abs(moved - 100 / (await js("view.s"))) < 1, "dragged by 100 screen px, moved " + moved);
  await tapButton("#undo");
  assert.equal(await js("board.items.at(-1).x"), x0n, "undo puts it back");
  assert.equal(await js("document.getElementById('selbar').hidden"), true, "undo drops the selection");

  // pages: add one (empty), go back to the first
  await tapButton("#page-add");
  assert.deepEqual(await js("[pages.length, pageNo, board.items.length]"), [2, 1, 0]);
  assert.equal(await js("document.getElementById('page-label').textContent"), "Page 2 / 2");
  await tapButton("#pagelist-items button");
  assert.deepEqual(await js("[pageNo, board.items.length]"), [0, 6]);

  // phone and smartboard sizes: no page scrollbars, toolbar inside the screen
  for (const [name, width, height, dpr, mobile] of [["phone", 390, 844, 3, true], ["small-laptop", 1000, 700, 1, false], ["smartboard", 1920, 1080, 1, false]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile });
    await sleep(300);
    await tapButton("#zoom");
    const fits = await js(`(() => { const r = document.getElementById('bar').getBoundingClientRect();
      return document.documentElement.scrollWidth <= innerWidth && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`);
    assert.ok(fits, name + " layout");
    // every bar button is really on screen, not scrolled out of the bar
    const hidden = await js(`[...document.querySelectorAll('#bar button')].filter(b => b.offsetParent).filter(b => { const r = b.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') !== b; }).map(b => b.id || b.dataset.tool || b.dataset.fly)`);
    assert.deepEqual(hidden, [], name + ": buttons out of reach");
    await tapButton("#bg"); // a panel open, for the screenshot

    assert.equal(await js("base.width"), width * dpr, name + " canvas is sharp");
    await shot(name);
  }

  assert.deepEqual(errors, [], "no errors in the page");
  console.log("browser: all checks pass");
} finally {
  await b.close();
  rmSync(downloads, { recursive: true, force: true });
}
