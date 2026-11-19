// Shared by the browser tests: headless Chromium driven over its DevTools
// protocol (touch, stylus and mouse input), and the whiteboard's own server.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const pageUrl = "file://" + join(root, "public", "index.html");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The whiteboard's server with only the model scripted (test/fake_server.py).
export async function startFakeServer({ port }) {
  // No pipes to it: a server left running must not hold this process's output open.
  const proc = spawn(join(root, ".venv", "bin", "python"), [join(root, "test", "fake_server.py"), String(port)], { stdio: "ignore" });
  process.on("exit", () => proc.kill());
  for (let i = 0; i < 120; i++) {
    await sleep(250);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/status`)).ok) break; } catch {}
  }
  const script = (body) => fetch(`http://127.0.0.1:${port}/test/script`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const asked = async () => (await fetch(`http://127.0.0.1:${port}/test/asked`)).json();
  return { script, asked, close: () => proc.kill() };
}

export async function launch({ port = 9333, shots = null } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "wb-chrome-"));
  const chrome = spawn("chromium", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--window-size=1000,700",
    "--allow-file-access-from-files", // ES modules from file://
    "--enable-unsafe-swiftshader", // WebGL with no GPU
    "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0;
  const waiting = new Map();
  const errors = [];
  const handlers = {};
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    if (msg.method && handlers[msg.method]) handlers[msg.method](msg.params);
    if (msg.id && waiting.has(msg.id)) {
      const { res, rej } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    }
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push(JSON.stringify(msg.params.args));
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    waiting.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const js = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const frame = () => js("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
  const touch = (type, points) => send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });

  async function fingerPath(points) {
    await touch("touchStart", [points[0]]);
    for (const p of points.slice(1)) await touch("touchMove", [p]);
    await touch("touchEnd", []);
  }
  async function fingerLine(x0, y0, x1, y1, steps = 12) {
    const pts = [];
    for (let i = 0; i <= steps; i++) pts.push([x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]);
    await fingerPath(pts);
    await frame();
  }
  async function mouse(kind, x0, y0, x1, y1, pointerType = "mouse") {
    const base = { button: "left", pointerType, force: 0.7 };
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: y0, clickCount: 1, buttons: 1, ...base });
    for (let i = 1; i <= 10; i++) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + ((x1 - x0) * i) / 10, y: y0 + ((y1 - y0) * i) / 10, buttons: 1, ...base });
    }
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y: y1, clickCount: 1, buttons: 0, ...base });
    await frame();
  }
  async function tapButton(selector) {
    // A button in a closed panel: open the panel first, as a person would.
    const fly = await js(`(() => { const f = document.querySelector(${JSON.stringify(selector)}).closest('.fly'); return f && f.hidden ? f.id : null; })()`);
    if (fly) await tapButton(`[data-fly="${fly}"]`);
    const [x, y] = await js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    await touch("touchStart", [[x, y]]);
    await touch("touchEnd", []);
    await frame();
  }
  async function shot(name) {
    if (!shots) return;
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, name + ".png"), Buffer.from(data, "base64"));
  }
  // Chromium's network side doesn't run inside the tool sandbox these tests run
  // in, so pages are opened from file:// and the page's api/... calls are handed
  // to Node, which makes them against the real server at `origin`.
  async function routeApi(origin) {
    handlers["Runtime.bindingCalled"] = async ({ name, payload }) => {
      if (name !== "__wbFetch") return;
      const { id, url, method, body } = JSON.parse(payload);
      let status = 599, text = "";
      try {
        const r = await fetch(origin + "/api/" + url.split("/api/").pop().replace(/^api\//, ""), {
          method, body, headers: body ? { "Content-Type": "application/json" } : {} });
        status = r.status;
        text = await r.text();
      } catch (e) {
        text = JSON.stringify({ error: String(e) });
      }
      await send("Runtime.evaluate", { expression: `__wbReply(${JSON.stringify(id)}, ${status}, ${JSON.stringify(text)})` });
    };
    await send("Runtime.addBinding", { name: "__wbFetch" });
    // The main page only: a frame inside it (her 3D Explorer) has fetches of its own.
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `if (window === window.top) {
      const realFetch = window.fetch, waiting = {};
      window.__wbReply = (id, status, text) => { waiting[id](new Response(text, { status, headers: { "Content-Type": "application/json" } })); delete waiting[id]; };
      window.fetch = (url, opts = {}) => {
        url = String(url);
        if (!url.startsWith("api/") && !url.includes("/api/")) return realFetch(url, opts);
        const id = Math.random().toString(36).slice(2);
        return new Promise((resolve) => {
          waiting[id] = resolve;
          __wbFetch(JSON.stringify({ id, url, method: opts.method || "GET", body: opts.body || null }));
        });
      };
    }` });
  }
  async function close() {
    ws.close();
    const exited = new Promise((r) => chrome.once("exit", r));
    chrome.kill();
    await exited;
    // Chromium's helper processes can still be writing here for a moment: best effort.
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
  }
  return { routeApi, send, js, frame, touch, fingerPath, fingerLine, mouse, tapButton, shot, sleep, errors, close };
}
