// The Transcribe Board's picture and buttons, laid out as ui.py lays them out:
// show_visual (VISUAL_BOX, a white rounded frame, the expand mark, the strip
// of pips under a staged diagram), _enlarge_visual (the same picture over the
// whole screen until tapped), show_offers (OFFER_ROW, two pills at most) and
// _match_step (the stage she is talking about lights up).

import { at, h } from "./ui.js";
import { LiveGraph } from "./graphcard.js";
import { Model3DView } from "./model3d.js";
import { GeoLab } from "./geolab.js";

const BOARD_X0 = 454, BOARD_Y0 = 109, BOARD_X1 = 783, BOARD_Y1 = 375;
const VISUAL_BOX = [BOARD_X0 + 10, BOARD_Y0 + 56, BOARD_X1 - 10, BOARD_Y1 - 26];
const OFFER_ROW = [BOARD_X0 + 14, BOARD_Y1 - 50, BOARD_X1 - 44, BOARD_Y1 - 14];
const STEP_STRIP_H = 22;
const BIG_STEP_STRIP_H = 40;
const STOPWORDS = new Set(["the", "and", "for", "with", "into", "from", "then", "that", "this",
  "are", "its", "was", "has", "have", "your", "you", "they", "them", "their", "out", "off", "of"]);

export class BoardVisual {
  // screen: the home screen element; onOffer(offer): a button was tapped.
  constructor(screen, { onOffer, onAsk }) {
    this.screen = screen;
    this.onOffer = onOffer;
    this.onAsk = onAsk;
    this.geo = null;             // the geometry lab's figure (GeoLab)
    this.visual = null;          // {kind, title, steps, image}
    this.offers = [];
    this.current = -1;
    this.layer = h("div", { class: "bv-layer" });
    this.offerLayer = h("div", { class: "bv-layer" });
    this.big = null;
    screen.append(this.layer, this.offerLayer);
  }

  // What the page tells her is on the screen (device state ON_BOARD / BUTTONS).
  state() {
    return {
      visual: this.visual ? { kind: this.visual.kind, steps: this.visual.steps,
        title: this.graph ? this.graph.describe() : this.geo ? this.geo.describe() : this.visual.title } : null,
      offers: this.offers.map((o) => ({ label: o.label, kind: o.kind, payload: o.payload })),
      // The geometry lab: what GEOMETRY tells her, and what her question picks.
      geometry: this.geo ? this.geo.state() : null,
      lab: true,
    };
  }

  show(visual, { enlarge = false } = {}) {
    // The geometry lab (ui.py show_geometry / geometry_pick): the same figure
    // up already only points, so the student's turned cube stays as it is.
    if (visual.geometry && this.geo && this.geo.title === visual.geometry.title) {
      this.geo.point(visual.geometry.picks.length ? visual.geometry.picks : null);
      return;
    }
    this.dropGeometry();
    this.closeModel3d();
    this.visual = visual;
    this.graph = visual.graph ? new LiveGraph(visual.graph) : null;
    this.current = -1;
    this.still = null;
    if (visual.geometry) {
      this.geo = new GeoLab(this.screen, visual.geometry, { onAsk: (q) => this.onAsk && this.onAsk(q) });
    }
    this.draw();
    // A 3D model opens full screen straight away (ui.py show_model3d): it is
    // asked for in order to be turned round. So does the geometry lab.
    if (enlarge || visual.scene) this.enlarge();
    if (this.geo) this.geo.open();
  }

  // Her question named parts of the figure (assistant.ai_loop): picked.
  geometryPick(picks) {
    if (this.geo) this.geo.point(picks);
  }

  // What she and they say, along the lab's bottom edge (_geo_set_caption).
  caption(text, who) {
    if (this.geo) this.geo.setCaption(text, who);
  }

  dropGeometry() {
    if (this.geo) this.geo.drop();
    this.geo = null;
  }

  clear() {
    this.dropGeometry();
    this.closeModel3d();
    this.visual = null;
    this.current = -1;
    this.layer.replaceChildren();
    this.shrink();
    this.draw();
  }

  setOffers(offers) {
    this.offers = (offers || []).slice(0, 3);
    this.drawOffers();
    this.draw();
  }

  draw() {
    this.layer.replaceChildren();
    const v = this.visual;
    if (!v) return;
    let [x0, y0, x1, y1] = VISUAL_BOX;
    if (this.offers.length) y1 = OFFER_ROW[1] - 8;
    if (v.scene) {
      this.drawModel3d(VISUAL_BOX);
      return;
    }
    if (this.geo) {
      this.geo.drawSmall(this.layer, VISUAL_BOX);
      return;
    }
    if (this.graph) {
      // A formula is a live graph with sliders, not a picture (show_graph).
      this.layer.appendChild(at(h("div", { class: "bv-backing" }), x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8));
      this.graph.draw(this.layer, [x0, y0, x1, y1], "small", { onEnlarge: () => this.enlarge() });
      return;
    }
    const strip = v.steps && v.steps.length ? STEP_STRIP_H : 0;
    // A white backing over the whole box: the words under it are the last
    // question's, and the picture is now what the board is about.
    this.layer.appendChild(at(h("div", { class: "bv-backing" }), x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8));
    const frame = h("div", { class: "bv-frame" });
    const image = h("img", { src: v.image, alt: v.title || v.kind, draggable: "false" });
    frame.appendChild(image);
    frame.appendChild(h("div", { class: "bv-expand", html: expandIcon() }));
    frame.addEventListener("click", () => this.enlarge());
    this.layer.appendChild(at(frame, x0, y0, x1 - x0, y1 - y0 - strip));
    if (strip) {
      this.stripSmall = this.stepStrip(true);
      this.layer.appendChild(at(this.stripSmall.el, x0, y1 - strip, x1 - x0, strip));
    }
  }

  // The board's still of the 3D model: dark glass, a "3D" badge, the expand
  // mark; a tap opens it full screen again (ui.py show_model3d).
  drawModel3d([x0, y0, x1, y1]) {
    const frame = h("div", { class: "m3-board" });
    if (this.still) frame.appendChild(h("img", { src: this.still, alt: "", draggable: "false" }));
    else frame.appendChild(h("div", { class: "m3-board-wait", text: "Building the 3D model\u2026" }));
    frame.appendChild(at(h("div", { class: "m3-badge", text: "3D" }), 8, 8, 36, 22));
    frame.appendChild(h("div", { class: "bv-expand", html: expandIcon() }));
    frame.addEventListener("click", () => this.enlarge());
    this.layer.appendChild(at(frame, x0, y0, x1 - x0, y1 - y0));
  }

  openModel3d() {
    const view = new Model3DView(this.screen, this.visual.scene, {
      onClose: (still) => {
        if (this.model3d !== view) return;
        this.model3d = null;
        this.still = still || this.visual?.scene?.still || null;
        this.draw();
      },
      onSetting: (take) => {
        // ON_BOARD: she should know the angle is now 60, not 45.
        if (take.title && this.visual) this.visual.title = take.title;
      },
    });
    this.model3d = view;
    view.open();
  }

  applySettings(settings) {
    if (this.model3d) this.model3d.applySettings(settings);
  }

  closeModel3d() {
    // Its onClose forgets it and puts the still on the board.
    if (this.model3d) this.model3d.close();
  }

  bigOpen() {
    return !!(this.big || this.model3d || (this.geo && this.geo.big));
  }

  stepStrip(small) {
    const el = h("div", { class: `bv-strip${small ? " small" : ""}` });
    const pips = this.visual.steps.map(() => h("span", { class: "bv-pip" }));
    const name = h("span", { class: "bv-step-name" });
    el.append(...pips, name);
    const view = { el, pips, name };
    this.paintStrip(view);
    return view;
  }

  paintStrip(view) {
    if (!view || !this.visual) return;
    view.pips.forEach((p, i) => p.classList.toggle("on", i === this.current));
    const labels = this.visual.steps;
    view.name.textContent = this.current >= 0 && this.current < labels.length
      ? `${this.current + 1}. ${labels[this.current]}` : "";
  }

  // _match_step: light the stage the line she is speaking belongs to; ties
  // go to the stage after the current one, because explanations run forwards.
  matchStep(line) {
    const labels = (this.visual && this.visual.steps) || [];
    if (!labels.length || !line) return;
    const spoken = line.toLowerCase();
    const hits = labels.map((label, i) => (hit(label, spoken) ? i : -1)).filter((i) => i >= 0);
    if (!hits.length) return;
    const wanted = this.current + 1;
    const best = hits.reduce((a, b) => {
      const da = Math.abs(a - wanted), db = Math.abs(b - wanted);
      return db < da || (db === da && b > a) ? b : a;
    });
    if (best !== this.current) {
      this.current = best;
      this.paintStrip(this.stripSmall);
      this.paintStrip(this.stripBig);
    }
  }

  enlarge() {
    if (!this.visual) return;
    this.shrink();
    if (this.geo) {
      this.geo.open();
      return;
    }
    if (this.visual.scene) {
      if (!this.model3d) this.openModel3d();
      return;
    }
    if (this.graph) {
      const big = h("div", { class: "bv-big gc-big" });
      big.addEventListener("click", (e) => { if (e.target === big) this.shrink(); });
      this.graph.draw(big, [16, 16, 784, 464], "big", { onClose: () => this.shrink() });
      this.screen.appendChild(big);
      this.big = big;
      return;
    }
    const strip = this.visual.steps && this.visual.steps.length ? BIG_STEP_STRIP_H : 0;
    const big = h("div", { class: "bv-big" });
    big.appendChild(at(h("img", { src: this.visual.image, alt: "", class: "bv-big-img", draggable: "false" }),
      20, 14, 760, 480 - 54 - strip));
    if (strip) {
      this.stripBig = this.stepStrip(false);
      big.appendChild(at(this.stripBig.el, 0, 480 - 30 - strip, 800, strip));
    }
    big.appendChild(at(h("div", { class: "bv-big-hint", text: "tap anywhere to close" }), 0, 480 - 24, 800, 16));
    big.appendChild(at(h("div", { class: "bv-close", html: "✕" }), 800 - 40, 12, 28, 28));
    big.addEventListener("click", () => this.shrink());
    this.screen.appendChild(big);
    this.big = big;
  }

  shrink() {
    if (this.model3d) this.closeModel3d();
    if (this.geo) this.geo.close();
    if (this.big) this.big.remove();
    this.big = null;
    this.stripBig = null;
  }

  drawOffers() {
    this.offerLayer.replaceChildren();
    const offers = this.offers.slice(0, 2);
    if (!offers.length) return;
    let [x0, y0, x1, y1] = OFFER_ROW;
    if (offers.length > 1) x1 = BOARD_X1 - 14;
    this.offerLayer.appendChild(at(h("div", { class: "bv-offer-strip" }), x0 - 6, y0 - 6, x1 - x0 + 10, y1 - y0 + 11));
    const gap = 8;
    const width = (x1 - x0 - gap * (offers.length - 1)) / offers.length;
    offers.forEach((offer, i) => {
      const compact = offers.length > 1;
      const pill = h("button", { class: `bv-offer${compact ? " compact" : ""}` },
        h("span", { class: "bv-play" }),
        h("span", { class: "bv-offer-words" },
          h("b", { text: offer.label }),
          offer.sub ? h("small", { text: offer.sub }) : null));
      pill.addEventListener("click", () => this.onOffer(offer));
      this.offerLayer.appendChild(at(pill, x0 + i * (width + gap), y0, width, y1 - y0));
    });
  }
}

function hit(label, spoken) {
  const low = label.toLowerCase();
  if (spoken.includes(low)) return true;
  return (low.match(/[a-z]+/g) || []).some((w) => w.length >= 3 && !STOPWORDS.has(w) && spoken.includes(w));
}

function expandIcon() {
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B3F8F" stroke-width="2.4"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
}

// "Yes, show me", "the second one", "show the reaction": which button that
// means, or null when it is anything more -- actions.offer_asked_for.
const YES = new Set(["yes", "yeah", "yep", "yup", "ok", "okay", "sure", "haan", "han", "haa", "ha",
  "हाँ", "हां", "जी", "हम्म", "please", "plz", "go", "ahead", "course", "of", "obviously",
  "definitely", "alright", "fine"]);
const SHOW = new Set(["show", "open", "play", "run", "start", "see", "dikhao", "dikha", "chalao",
  "दिखाओ", "दिखा", "दिखाइए", "चलाओ", "खोलो", "देखना", "देखूँ"]);
const FILL = new Set(["me", "it", "that", "this", "the", "a", "do", "dena", "दो", "दे", "दीजिए", "liza",
  "lisa", "hey", "now", "can", "you", "i", "want", "to", "would", "like", "let's",
  "lets", "us", "one", "wala", "वाला", "वो", "ये", "मुझे", "करो", "please", "just",
  "first", "second", "third", "1st", "2nd", "3rd", "pehla", "dusra", "पहला", "दूसरा"]);
const WHICH = { model3d: ["3d", "model", "simulation", "simulate", "सिमुलेशन"],
  graph: ["graph", "plot", "ग्राफ"], reaction: ["reaction", "chemical", "equation", "अभिक्रिया"],
  molecule: ["molecule", "structure", "अणु"], picture: ["picture", "photo", "image", "तस्वीर"],
  steps: ["diagram", "steps", "process", "चित्र"], cycle: ["cycle", "diagram", "चक्र"],
  shape: ["shape", "figure", "drawing", "आकृति"], solution: ["working", "solution", "steps", "हल"] };
const ORDINALS = { first: 0, "1st": 0, pehla: 0, "पहला": 0, second: 1, "2nd": 1, dusra: 1, "दूसरा": 1,
  third: 2, "3rd": 2 };

export function offerAskedFor(text, offers) {
  const words = ((text || "").toLowerCase().match(/[\p{L}\p{N}'ऀ-ॿ]+/gu) || []);
  if (!offers.length || !words.length || words.length > 9) return null;
  const known = new Set([...YES, ...SHOW, ...FILL, ...Object.keys(ORDINALS), ...Object.values(WHICH).flat()]);
  if (words.some((w) => !known.has(w)) || !words.some((w) => YES.has(w) || SHOW.has(w))) return null;
  for (const w of words) if (w in ORDINALS && ORDINALS[w] < offers.length) return ORDINALS[w];
  for (let i = 0; i < offers.length; i++) {
    if (words.some((w) => (WHICH[offers[i].kind] || []).includes(w))) return i;
  }
  return offers.length === 1 ? 0 : null;
}
