// The story stage (kg_story_stage.py StoryStage): the characters act out each
// line on the board while Liza reads it. The plan -- which action, for whom,
// on which line -- is the device's own plan_story, worked out when
// data/kg.json is built; this draws it. Each action fills the time the line
// takes to say: it runs from when that line started playing to the end of its
// audio, so a fast or a slow reading stretches it to fit.

import { h } from "./ui.js";

// Animated characters (LottieFiles, chosen in tools/story_lottie.json): a
// character with one plays it instead of its picture. Loaded on first use.
const LOTTIE_PX = 84;                       // how tall an animated character stands
// Which way each animation faces as drawn; the stage mirrors it to face where
// it is going. Anything not listed faces the child and never turns.
const LOTTIE_FACES = { crow: "right", tortoise: "right", hare: "right", rabbit: "right", mouse: "left",
  boy: "right", sons: "right", hen: "left", cat: "right", cat2: "right", dog: "right", duck: "right",
  elephant: "right", father: "right", ant: "left" };
// Actions where the character's own animation plays; otherwise it holds still.
const MOVING = new Set(["walk", "run", "fly", "hop", "happy", "eat", "drink", "drop", "shake", "together",
  "look", "talk", "rise", "sparkle"]);
let lottieReady = null;
function loadLottie() {
  if (!lottieReady) {
    lottieReady = Promise.all([
      window.lottie ? Promise.resolve() : new Promise((resolve, reject) => {
        const tag = document.createElement("script");
        tag.src = "vendor/lottie_light.min.js";
        tag.onload = resolve; tag.onerror = reject;
        document.head.appendChild(tag);
      }),
      fetch("assets/lottie/crops.json").then((r) => r.json()),
    ]).then(([, crops]) => crops).catch(() => ({}));
  }
  return lottieReady;
}

const GROUND_Y = 252;
const STAGE_X0 = 222, STAGE_X1 = 596, STAGE_Y0 = 126;
const ACTOR_PX = 58;
const FX = { sleep: "💤", happy: "❤️", sparkle: "✨", think: "💭", talk: "💬", mystery: "❓", sad: "💧", shake: "💢" };

export class StoryStage {
  constructor(kg, story) {
    this.cast = kg.casts[story.cast] || null;
    this.plan = story.stage || null;
    this.sideOn = new Set(kg.side_on || []);
    this.segments = story.segments;
    this.layers = {};                       // key -> {el, anim, width}: kept from line to line
    this.crops = {};
    this.reset();
    if (this.cast) loadLottie().then((crops) => { this.crops = crops; });
  }

  // The animated character for `key`, made once and moved from screen to
  // screen as the board is redrawn line by line; null while loading or if none.
  layer(key) {
    if (this.layers[key] !== undefined) return this.layers[key];
    const crop = this.crops[key];
    if (!crop || !window.lottie) return null;
    const width = Math.round(LOTTIE_PX * crop[2] / crop[3]);
    const el = h("div", { class: "stage-actor" });
    Object.assign(el.style, { width: `${width}px`, height: `${LOTTIE_PX}px` });
    const anim = window.lottie.loadAnimation({ container: el, renderer: "svg", loop: true, autoplay: false,
      path: `assets/lottie/${key}.json`,
      rendererSettings: { viewBoxSize: crop.join(" "), preserveAspectRatio: "xMidYMax meet" } });
    this.layers[key] = { el, anim, width, playing: false };
    return this.layers[key];
  }

  // A fresh telling: everyone back in their places, the hidden ones off stage.
  reset() {
    this.x = {};
    this.seen = new Set();
    this.asleep = new Set();
    this.water = this.waterBase = 0.15;
    if (!this.cast) return;
    for (const [key, [, home]] of Object.entries(this.cast.actors)) this.x[key] = home;
    const hidden = this.cast.hidden || [];
    this.seen = new Set(Object.keys(this.cast.actors).filter((k) => !hidden.includes(k)));
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  // Draw the board for `beat` (-1 = the title) on `screen` and start its
  // action. audio: the element her voice is playing on, for the line's length.
  show(screen, beat, startedAt, audio) {
    this.stop();
    if (!this.cast || !this.plan) return;
    const canvas = h("canvas", { class: "stage-canvas" });
    canvas.width = 1600;
    canvas.height = 960;
    screen.appendChild(canvas);
    this.screen = screen;
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);
    const [action, actor, other, sky] = beat >= 0 && beat < this.plan.length ? this.plan[beat]
      : ["idle", this.cast.hero, null, this.plan[0] ? this.plan[0][3] : null];
    if (actor) {
      this.seen.add(actor);
      // Asleep stays asleep -- the hare snores through the tortoise walking
      // past -- until a line has them do something else.
      if (action === "sleep") this.asleep.add(actor);
      else if (action !== "idle" && action !== "mystery") this.asleep.delete(actor);
    }
    if (other && (action === "together" || action === "talk")) this.seen.add(other);
    const text = beat >= 0 && this.segments[beat] ? this.segments[beat][0] : "";
    const state = { beat, action, actor, other, from: { ...this.x }, facing: {}, start: startedAt || performance.now(),
      guess: Math.max(1.6, text.length / 13) * 1000, audio, sky: this.skyItems(sky), splash: null, dropDone: false };
    const loop = (now) => {
      if (!canvas.isConnected) return this.stop();
      this.frame(ctx, state, now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // 0..1 through this line, and seconds since it began.
  progress(state, now) {
    const elapsed = (now - state.start) / 1000;
    const a = state.audio;
    const length = a && Number.isFinite(a.duration) && a.duration > 0 ? a.duration * 1000 : state.guess;
    return [Math.max(0, Math.min(1, (now - state.start) / Math.max(400, length))), elapsed];
  }

  skyItems(sky) {
    const items = { kind: sky, bits: [] };
    const rand = (lo, hi) => lo + Math.random() * (hi - lo);
    if (sky === "night") for (let i = 0; i < 6; i++) items.bits.push([rand(STAGE_X0 + 10, STAGE_X1 - 60), rand(STAGE_Y0 + 4, STAGE_Y0 + 50)]);
    if (sky === "rain" || sky === "snow") for (let i = 0; i < 18; i++) items.bits.push([rand(STAGE_X0, STAGE_X1), rand(STAGE_Y0, GROUND_Y)]);
    return items;
  }

  frame(ctx, state, now) {
    const cast = this.cast;
    const [p, t] = this.progress(state, now);
    ctx.clearRect(0, 0, 800, 480);
    this.drawSky(ctx, state.sky, t);
    // The ground: a chalk line, and water where the story has a river.
    ctx.setLineDash([10, 4]);
    ctx.strokeStyle = "#C9D8C5"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(STAGE_X0, GROUND_Y + 2); ctx.lineTo(STAGE_X1, GROUND_Y + 2); ctx.stroke();
    ctx.setLineDash([]);
    if (cast.river) { ctx.fillStyle = "#60A5FA"; ctx.fillRect(STAGE_X0 + 120, GROUND_Y - 4, STAGE_X1 - STAGE_X0 - 240, 12); }
    if (cast.log) {
      ctx.strokeStyle = "#92400E"; ctx.lineWidth = 9; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(STAGE_X0 + 100, GROUND_Y); ctx.lineTo(STAGE_X1 - 100, GROUND_Y); ctx.stroke();
      ctx.lineCap = "butt";
      for (const x of [STAGE_X0 + 100, STAGE_X1 - 100]) dot(ctx, x, GROUND_Y, 5, "#B45309");
    }
    for (const [picture, x, y, px] of cast.props) emoji(ctx, picture, x, y, px);
    if (cast.water) {
      const [tx, ty] = cast.target;
      if (state.action === "drop" || state.action === "rise") {
        // Every stone raises the water a little, and "higher and higher" a lot.
        this.water = Math.max(this.water, Math.min(1, this.waterBase + (state.action === "drop" ? 0.12 : 0.4) * p));
      }
      ctx.fillStyle = "#38BDF8";
      ctx.fillRect(tx - 14, ty + 22 - 26 * this.water, 28, 26 * this.water);
      if (p >= 1) this.waterBase = this.water;
    }
    for (const [key, [picture]] of Object.entries(cast.actors)) {
      if (!this.seen.has(key)) continue;
      const x0 = state.from[key] ?? this.x[key];
      const [x, dy, facing] = this.motion(key, state, x0, p, t);
      this.x[key] = x;
      if (facing) state.facing[key] = facing;
      const live = this.layer(key);
      if (live) {
        // The animation itself, standing on the ground line where the picture would be.
        if (live.el.parentNode !== this.screen) this.screen.appendChild(live.el);
        const turn = LOTTIE_FACES[key] && state.facing[key] && state.facing[key] !== LOTTIE_FACES[key] ? -1 : 1;
        live.el.style.transform = `translate(${x - live.width / 2}px, ${GROUND_Y - LOTTIE_PX + 4 + dy}px) scaleX(${turn})`;
        const moving = key === state.actor && MOVING.has(state.action) && !this.asleep.has(key);
        if (moving !== live.playing) {
          live.playing = moving;
          if (moving) live.anim.play(); else live.anim.pause();
        }
        live.anim.setSpeed(state.action === "run" && key === state.actor ? 1.7 : 1);
      } else {
        const mirror = this.sideOn.has(picture) && state.facing[key] === "right";
        emoji(ctx, picture, x, GROUND_Y - ACTOR_PX / 2 + dy, ACTOR_PX, mirror);
      }
      if (this.asleep.has(key) && key !== state.actor) {
        const phase = (t * 0.5) % 1;
        emoji(ctx, "💤", x + 16 + 6 * Math.sin(phase * 6), GROUND_Y - ACTOR_PX - 10 - phase * 30, 20);
      }
    }
    this.drawFx(ctx, state, p, t);
  }

  // (x, dy, facing) for one actor: the one the line is about does the action;
  // everyone else breathes, so the board is never a still picture.
  motion(key, state, x0, p, t) {
    const cast = this.cast;
    const { action } = state;
    const home = cast.actors[key][1];
    const breathe = 2 * Math.sin(t * 2.4 + home);
    if (key !== state.actor) {
      if (this.asleep.has(key)) return [x0, 8 + 2 * Math.sin(t * 1.5), null];
      if (action === "together" && key === state.other) {
        const meet = (x0 + (this.x[state.actor] ?? x0)) / 2;
        return [x0 + (meet + 34 - x0) * Math.min(1, p * 1.6), breathe, null];
      }
      if (action === "fall" && key === state.other && cast.river) return fall(x0, p);
      return [x0, breathe, null];
    }
    const ease = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, p * 1.4));
    if (action === "walk" || action === "run") {
      // Away from the side they are nearest, so nobody marches off the board.
      let far = x0 < (STAGE_X0 + STAGE_X1) / 2 ? STAGE_X1 - 40 : STAGE_X0 + 40;
      if (cast.finish && action === "run" && key === "hare") far = Math.min(far, cast.finish - 70);
      if (cast.finish && action === "walk" && key === "tortoise") far = Math.min(STAGE_X1 - 40, x0 + 70);
      let span = far - x0;
      if (action === "walk") span = Math.max(-110, Math.min(110, span));
      const hop = Math.abs(Math.sin(t * (action === "run" ? 14 : 7))) * (action === "run" ? 9 : 4);
      return [x0 + span * ease, -hop, span > 0 ? "right" : "left"];
    }
    if (action === "fly") {
      const far = x0 < (STAGE_X0 + STAGE_X1) / 2 ? STAGE_X1 - 50 : STAGE_X0 + 50;
      const lift = Math.sin(Math.PI * ease) * 80 + Math.abs(Math.sin(t * 12)) * 5;
      return [x0 + (far - x0) * ease, -lift, far > x0 ? "right" : "left"];
    }
    if (action === "hop" || action === "happy") return [x0, -Math.abs(Math.sin(t * 7)) * 14, null];
    if (action === "shake") return [x0 + 5 * Math.sin(t * 40), 0, null];
    if (action === "sad") return [x0, 6 + breathe / 2, null];
    if (action === "sleep") return [x0, 8 + 2 * Math.sin(t * 1.5), null];
    if (action === "drink" || action === "eat") {
      const tx = (cast.target || [x0 + 60])[0];
      const stand = x0 < tx ? tx - 44 : tx + 44;
      const x = x0 + (stand - x0) * Math.min(1, p * 2.5);
      return [x, p > 0.35 ? Math.max(0, Math.sin(t * 9)) * 10 : 0, tx > x ? "right" : "left"];
    }
    if (action === "drop") {
      const tx = (cast.target || [x0 + 60])[0];
      const stand = x0 < tx ? tx - 50 : tx + 50;
      const x = x0 + (stand - x0) * Math.min(1, p * 3);
      return [x, -Math.abs(Math.sin(t * 5)) * 4, tx > x ? "right" : "left"];
    }
    if (action === "fall") return fall(x0, p);
    if (action === "together") {
      const meet = state.other ? (x0 + (this.x[state.other] ?? x0)) / 2 : x0;
      return [x0 + (meet - 34 - x0) * Math.min(1, p * 1.6), breathe, null];
    }
    if (action === "look") return [x0 + 8 * Math.sin(t * 3), breathe, null];
    if (action === "rise") return [x0, -Math.abs(Math.sin(t * 4)) * 6, null];
    return [x0, breathe, null];
  }

  drawFx(ctx, state, p, t) {
    const cast = this.cast;
    const { action } = state;
    const x = this.x[state.actor] ?? 300;
    const top = GROUND_Y - ACTOR_PX - 10;
    if (FX[action]) {
      const count = ["sleep", "happy", "sparkle", "sad"].includes(action) ? 3 : 1;
      for (let n = 0; n < count; n++) {
        const phase = (t * 0.6 + n / 3) % 1;
        let fx = x + 26, fy = top - 12 + 3 * Math.sin(t * 4);
        if (action === "sad") { fx = x - 22 + n * 22; fy = top + 20 + phase * 34; }      // tears fall
        else if (action === "sparkle") { fx = x + 30 * Math.cos(n * 2.1 + t * 2); fy = top + 6 + 18 * Math.sin(n * 2.1 + t * 2); }
        else if (count > 1) { fx = x + 14 + 10 * Math.sin(phase * 6 + n); fy = top - phase * 50; }
        emoji(ctx, FX[action], fx, fy, count > 1 ? 22 : 30);
      }
    }
    if (action === "drop" && cast.target && !state.dropDone) {
      const [tx, ty] = cast.target;
      const q = Math.max(0, Math.min(1, (p - 0.3) / 0.5));
      const sx = x + 20, sy = top + 24;
      if (q >= 1) { state.dropDone = true; state.splash = { x: tx, y: ty - 14, at: performance.now() }; }
      else emoji(ctx, cast.item || "⚪", sx + (tx - sx) * q, sy + (ty - 10 - sy) * q - Math.sin(Math.PI * q) * 40, 20);
    }
    if (action === "fall" && cast.river && p > 0.65 && !state.splash) state.splash = { x, y: GROUND_Y, at: performance.now() };
    if (state.splash) {
      // Three drops jumping out of the water, once.
      const n = (performance.now() - state.splash.at) / 40;
      if (n <= 10) for (let i = 0; i < 4; i++) {
        dot(ctx, state.splash.x + (i - 1.5) * 6 * n / 3, state.splash.y - 14 * n + 2.2 * n * n, 3, "#7DD3FC");
      }
    }
  }

  drawSky(ctx, sky, t) {
    if (sky.kind === "night") {
      ctx.fillStyle = "rgba(15,23,42,0.5)";
      ctx.fillRect(STAGE_X0 - 6, STAGE_Y0 - 4, STAGE_X1 - STAGE_X0 + 12, GROUND_Y - STAGE_Y0 + 4);
      emoji(ctx, "🌙", 566, 150, 30);
      ctx.font = "12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const [x, y] of sky.bits) { ctx.fillStyle = Math.sin(t * 3 + x) > 0 ? "#FDE68A" : "#64748B"; ctx.fillText("✦", x, y); }
    } else if (sky.kind === "sun") {
      ctx.strokeStyle = "#FDE68A"; ctx.lineWidth = 3;
      for (let n = 0; n < 8; n++) {
        const a = n * Math.PI / 4 + t * 0.6, r1 = 26 + 3 * Math.sin(t * 3 + n);
        ctx.beginPath(); ctx.moveTo(566 + 20 * Math.cos(a), 150 + 20 * Math.sin(a));
        ctx.lineTo(566 + r1 * Math.cos(a), 150 + r1 * Math.sin(a)); ctx.stroke();
      }
      emoji(ctx, "☀️", 566, 150, 30);
    } else if (sky.kind === "rain" || sky.kind === "snow") {
      const rain = sky.kind === "rain";
      for (const [x, y] of sky.bits) {
        const yy = STAGE_Y0 + ((y - STAGE_Y0 + t * (rain ? 160 : 30)) % (GROUND_Y - STAGE_Y0));
        const xx = x + (rain ? 0 : Math.sin(t + x) * 6);
        if (rain) {
          ctx.strokeStyle = "#BFDBFE"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx - 3, yy + 9); ctx.stroke();
        } else dot(ctx, xx, yy, 2, "#FFFFFF");
      }
    }
  }
}

function fall(x0, p) {
  const drop = p < 0.3 ? 0 : Math.min(1, (p - 0.3) / 0.4);
  return [x0, drop * drop * 40, null];
}

function dot(ctx, x, y, r, fill) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
}

// An emoji `px` tall, centred on (x, y); side-on animals face left, so one
// heading right is drawn mirrored.
function emoji(ctx, picture, x, y, px, mirror = false) {
  ctx.save();
  ctx.translate(x, y);
  if (mirror) ctx.scale(-1, 1);
  ctx.font = `${Math.round(px * 0.86)}px "Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji",sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#000";
  ctx.fillText(picture, 0, 0);
  ctx.restore();
}
