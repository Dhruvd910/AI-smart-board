// The live camera on the Transcribe Board (camera.py on the device): while it
// is on, the board shows what it sees, and each question carries a picture of
// that moment, so "what is this?" or "read this page" is about what they hold
// up. The picture goes only with the question it was taken for.

import { h } from "./ui.js";

export class Camera {
  constructor() {
    this.stream = null;
    this.video = null;
    this.box = null;
    this.captionEl = null;
    this.facing = "user";
    this.cameras = 0;
  }

  get on() {
    return Boolean(this.stream);
  }

  // Shows the live view in `box` (a positioned element on the board).
  async start(box) {
    this.box = box;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: this.facing, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    try {
      this.cameras = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === "videoinput").length;
    } catch (_) { this.cameras = 1; }
    this.video = h("video", { autoplay: true, playsinline: true, muted: true, class: "cam-video" });
    this.video.muted = true;
    this.video.srcObject = this.stream;
    // The front camera is shown as a mirror, as people expect; the picture
    // sent with a question is not mirrored, so writing reads the right way.
    this.video.classList.toggle("mirror", this.facing === "user");
    this.captionEl = h("div", { class: "cam-caption" });
    box.replaceChildren(this.video, this.captionEl);
    if (this.cameras > 1) {
      box.appendChild(h("button", { class: "cam-flip", title: "Switch camera", text: "⟲",
        onclick: () => this.flip() }));
    }
    box.classList.add("on");
    await this.video.play().catch(() => {});
  }

  async flip() {
    if (!this.box) return;
    const box = this.box;
    this.facing = this.facing === "user" ? "environment" : "user";
    this.stop();
    await this.start(box).catch(() => {});
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.box) {
      this.box.classList.remove("on");
      this.box.replaceChildren();
    }
    this.video = null;
    this.captionEl = null;
  }

  // What she says, along the bottom of the live view.
  caption(text) {
    if (!this.captionEl) return;
    this.captionEl.textContent = text;
    this.captionEl.classList.add("show");
  }

  // A JPEG of this moment, at most 1024 px on its longest side.
  async frame() {
    const v = this.video;
    if (!v || !v.videoWidth) return null;
    const scale = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  }
}
