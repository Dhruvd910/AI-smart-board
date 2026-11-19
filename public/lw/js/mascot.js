// Liza herself: the animations ui.py plays, from one sprite sheet each. Going
// to sleep and waking up play their own clip once on the way, as on the device
// (ui.py _animate, MASCOT_ONCE): she pulls up a chair, dozes, gets up again.

const FRAME_MS = 60;            // ui.py FRAME_MS
const STATES = ["idle", "listening", "thinking", "speaking", "goto_sleep", "sleeping", "wake_up"];

let sheetsInfo = null;
const sheets = {};
let loading = null;

function load() {
  if (loading) return loading;
  loading = fetch("assets/mascot/sheets.json")
    .then((r) => r.json())
    .then((info) => {
      sheetsInfo = info;
      return Promise.all(STATES.filter((s) => info[s]).map((s) => new Promise((resolve) => {
        const image = new Image();
        image.onload = () => { sheets[s] = image; resolve(); };
        image.onerror = resolve;
        image.src = `assets/mascot/${s}.webp`;
      })));
    })
    .catch(() => {});
  return loading;
}

export class Mascot {
  // width x height on the 800x480 stage; the frames are drawn at twice that
  // for sharp screens.
  constructor(parent, { left, top, width = 187, height = 250 }) {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "mascot";
    Object.assign(this.canvas.style, {
      left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
    });
    this.canvas.width = width * 2;
    this.canvas.height = height * 2;
    this.ctx = this.canvas.getContext("2d");
    parent.appendChild(this.canvas);
    this.state = "idle";        // the clip playing
    this.target = "idle";       // the state's own clip, after any transition
    this.frame = 0;
    this.last = 0;
    this.running = true;
    load().then(() => requestAnimationFrame((t) => this.tick(t)));
  }

  set(state) {
    const next = STATES.includes(state) ? state : "idle";
    if (next === this.target) return;
    const before = this.target;
    this.target = next;
    // Into sleep and out of it go through their own clips first.
    this.state = next === "sleeping" ? "goto_sleep" : before === "sleeping" ? "wake_up" : next;
    this.frame = 0;
  }

  tick(time) {
    if (!this.running) return;
    if (!this.canvas.isConnected) {
      this.running = false;
      return;
    }
    if (time - this.last >= FRAME_MS) {
      this.last = time;
      this.draw();
    }
    requestAnimationFrame((t) => this.tick(t));
  }

  draw() {
    let info = sheetsInfo && sheetsInfo[this.state];
    if (sheetsInfo && !info && this.state !== this.target) {
      // A transition clip that is missing is skipped, not waited on.
      this.state = this.target;
      this.frame = 0;
      info = sheetsInfo[this.state];
    }
    const image = sheets[this.state];
    if (!info || !image) return;
    const i = this.frame % info.frames;
    this.frame += 1;
    if ("then" in info && this.frame >= info.frames) {
      // A transition has played once: on to what it leads to.
      this.state = info.then || this.target;
      this.frame = 0;
    }
    const sx = (i % info.cols) * info.w;
    const sy = Math.floor(i / info.cols) * info.h;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(image, sx, sy, info.w, info.h, 0, 0, this.canvas.width, this.canvas.height);
  }

  stop() {
    this.running = false;
  }
}
