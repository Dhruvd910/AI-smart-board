// Moving between screens. Each screen is a function that draws itself onto an
// empty stage and may return a cleanup function, run when the next one opens.

import { clear } from "./ui.js";
import { speaker, listener } from "./voice.js";

const screens = {};
let cleanup = null;
export let current = null;

export function register(name, render) {
  screens[name] = render;
}

export function go(name, ...args) {
  if (typeof cleanup === "function") {
    try { cleanup(); } catch (e) { console.error(e); }
  }
  cleanup = null;
  speaker.stop();
  listener.cancel();
  clear();
  current = name;
  cleanup = screens[name](...args);
}
