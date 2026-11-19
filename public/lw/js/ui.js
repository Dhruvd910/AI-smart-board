// Small DOM helpers shared by every screen.

export const stage = document.getElementById("stage");

// h("div", {class: "x", style: {...}, onclick}, child, "text", ...)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "style") Object.assign(el.style, value);
    else if (key === "text") el.textContent = value;
    else if (key === "html") el.innerHTML = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

// Absolute position on the 800x480 stage.
export function at(el, x, y, w, hgt) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  if (w !== undefined) el.style.width = `${w}px`;
  if (hgt !== undefined) el.style.height = `${hgt}px`;
  // Set inline rather than read from the stylesheet: an element not yet in
  // the page has no computed style to read.
  if (!el.style.position) el.style.position = "absolute";
  return el;
}

export function img(src, x, y, w, hgt, cls = "card-img") {
  const el = h("img", { src, class: cls, alt: "", draggable: "false" });
  return at(el, x, y, w, hgt);
}

export function clear() {
  stage.replaceChildren();
}

let toastTimer = null;
export function toast(message, ms = 2600) {
  stage.querySelectorAll(".toast").forEach((t) => t.remove());
  const el = h("div", { class: "toast", text: message });
  stage.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 350);
  }, ms);
}

export function confetti(count = 70) {
  const colours = ["#EF4444", "#F97316", "#FACC15", "#22C55E", "#3B82F6", "#A855F7", "#F472B6"];
  for (let i = 0; i < count; i++) {
    const piece = h("div", { class: "confetti" });
    piece.style.left = `${Math.random() * stage.offsetWidth}px`;
    piece.style.top = "-20px";
    piece.style.background = colours[i % colours.length];
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    stage.appendChild(piece);
    const fall = stage.offsetHeight - 100 + Math.random() * 160;
    const drift = (Math.random() - 0.5) * 160;
    piece.animate([
      { transform: `translate(0,0) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${drift}px, ${fall + 60}px) rotate(${720 * Math.random()}deg)`, opacity: 0.9 },
    ], { duration: 1600 + Math.random() * 1200, easing: "cubic-bezier(.2,.6,.4,1)", fill: "forwards" })
      .onfinish = () => piece.remove();
  }
}

export function avatar(n) {
  return `assets/ui/profile/profile_${String(n || 1).padStart(2, "0")}.png`;
}

export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function randint(low, high) {
  return low + Math.floor(Math.random() * (high - low + 1));
}

// Fill the window. The layout stays 800x480 (the device's screen); the stage
// grows to the window's shape around it, so a wide or tall screen gets more
// garden instead of black bars, and the whole thing is scaled to fit.
export function fitStage() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.max(800, Math.round(480 * vw / vh));
  const h = Math.max(480, Math.round(800 * vh / vw));
  const set = (name, value) => stage.style.setProperty(name, value);
  set("--w", `${w}px`);
  set("--h", `${h}px`);
  set("--padx", `${(w - 800) / 2}px`);
  set("--pady", `${(h - 480) / 2}px`);
  set("--fadex", w > 800 ? "40px" : "0px");
  set("--fadey", h > 480 ? "40px" : "0px");
  stage.style.transform = `scale(${Math.min(vw / w, vh / h)})`;
}
