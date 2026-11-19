// The 3D Explorer on the website: holo's viewer in a full-window frame, the
// "Visualize in 3D" match, and the voice commands that drive it.
//
// The matching and the commands are holo/catalog.py match / find_component
// and holo/bridge.py try_command, in JavaScript, over the catalogue that
// web/tools/build_holo.py exports.

import * as api from "./api.js";

let catalog = null;

export async function loadCatalog() {
  if (!catalog) {
    catalog = await fetch("holo/data/catalog.json").then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
  }
  return catalog;
}

const norm = (text) => " " + (text || "").toLowerCase().replace(/[^\p{L}\p{N}_ऀ-ॿ]+/gu, " ").trim() + " ";

function byId(id) {
  return (catalog || []).find((m) => m.model_id === id);
}

// Model ids whose title or aliases appear in the question, best first.
export function match(question) {
  const text = norm(question);
  const hits = [];
  for (const m of catalog || []) {
    if ((m.not_when || []).some((n) => text.includes(norm(n)))) continue;
    const names = [m.title.toLowerCase(), ...m.aliases];
    const best = Math.max(0, ...names.filter((n) => n && text.includes(norm(n))).map((n) => n.length));
    if (best) hits.push([best, m.model_id]);
  }
  if (!hits.length) return [];
  hits.sort((a, b) => b[0] - a[0]);
  return hits.filter(([len]) => len === hits[0][0]).map(([, id]) => id);
}

// The component or group a phrase names.
export function findComponent(model, words) {
  const text = norm(words);
  let best = [0, null];
  for (const c of model.components) {
    const names = [c.label.toLowerCase(), c.id.replace(/_/g, " "), ...c.aliases, ...(c.label_hi ? [c.label_hi] : [])];
    for (const name of names) {
      const n = norm(name);
      if (n.trim() && text.includes(n) && n.length > best[0]) best = [n.length, c.id];
      const stem = n.trim().slice(0, -2);
      if (stem.length >= 5 && new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text)
          && stem.length > best[0]) best = [stem.length, c.id];
    }
  }
  for (const group of model.groups || []) {
    for (const name of [group.replace(/_/g, " "), ...((model.group_aliases || {})[group] || [])]) {
      const n = norm(name);
      if (n.trim() && text.includes(n) && n.length > best[0]) best = [n.length, group];
    }
  }
  return best[1];
}

// holo/bridge.py show_instead_of_model3d: where Liza would open her own 3D
// view, the explorer opens instead when it has the thing -- one window, not
// two. {modelId, focus} or null.
export function insteadOfModel3d(payload) {
  const ids = match(payload || "");
  if (ids.length !== 1) return null;
  const m = byId(ids[0]);
  let focus = m.components && m.components.length ? findComponent(m, payload) : null;
  if (!(m.components || []).some((c) => c.id === focus)) focus = null;
  return { modelId: m.model_id, focus };
}

// "Visualize in 3D" for a question that names exactly one model.
export function offerFor(question, language = "en") {
  const ids = match(question);
  if (ids.length !== 1) return null;
  const m = byId(ids[0]);
  const hindi = language === "hi" || language === "hinglish";
  return { modelId: m.model_id, label: hindi ? "3D में देखो" : "Visualize in 3D",
    sub: (hindi && m.title_hi) || m.title };
}

// ---------------------------------------------------------------------------
// The viewer
// ---------------------------------------------------------------------------

let view = null;

export function isOpen() {
  return Boolean(view);
}

export function current() {
  return view;
}

// hooks: {close(), say(text), talk(what), ask(body) -> Promise<{answer}|{error}>}
export function open(modelId, { focus = null, language = "en", hooks }) {
  if (view) {
    view.load(modelId, focus);
    return view;
  }
  const frame = document.createElement("iframe");
  frame.className = "holo-frame";
  frame.title = "3D Explorer";
  frame.allow = "fullscreen";
  const query = new URLSearchParams({ model: modelId, lang: language === "hi" ? "hi" : "en" });
  if (focus) query.set("focus", focus);
  frame.src = `holo/web.html?${query}`;
  document.body.appendChild(frame);

  view = {
    modelId,
    language,
    state: { model_id: modelId, selected: null, hidden: [] },
    frame,
    app() { return frame.contentWindow && frame.contentWindow.__holo; },
    handle(event) {
      const app = this.app();
      if (app) app.handle(event);
      return Boolean(app && app.model);
    },
    send(action, componentId = null) {
      return this.handle({ type: "action", action, component_id: componentId });
    },
    load(id, focusId = null) {
      this.modelId = id;
      this.state = { model_id: id, selected: null, hidden: [] };
      this.handle({ type: "load", model_id: id, focus: focusId, language: this.language === "hi" ? "hi" : "en" });
    },
    caption(text, who) { this.handle({ type: "caption", text, who }); },
    lizaState(status) {
      this.handle({ type: "liza", state: status, speaking: status === "speaking", asleep: status === "sleeping" });
    },
    close() {
      frame.remove();
      window.lizaHolo = null;
      view = null;
    },
  };

  window.lizaHolo = {
    close: () => hooks.close(),
    say: (text) => hooks.say(text),
    talk: (what) => hooks.talk(what),
    state: (body) => {
      if (!view) return;
      view.modelId = body.model_id || view.modelId;
      view.state = { model_id: body.model_id, selected: body.selected || null,
        hidden: Array.isArray(body.hidden) ? body.hidden : [] };
    },
    ask: async (body) => {
      const result = await api.send("POST", "/api/holo/ask", { ...body, language: view ? view.language : "en" });
      if (result.answer) hooks.say(result.answer);
      return result;
    },
  };
  return view;
}

// ---------------------------------------------------------------------------
// Voice commands (holo/bridge.py try_command)
// ---------------------------------------------------------------------------

const RE_EXPLICIT = /\b(?:visuali[sz]e|visuali[sz]ation|explorer?|hologram|holographic|jarvis|interactive)\b|\b3d (?:explorer|viewer)\b|\bin 3d explorer\b|\bthree ?d explorer\b/i;
const RE_WANTS_3D = /\b(?:3d|3 d|3-d|three d|three-d|thri d)\b|थ्री डी|\b(?:show|open|display|dikhao)\b.*\bmodel\b|दिखाओ.*\bmodel\b/i;
const RE_CLOSE = /^(?:please )?(?:close|exit|quit|stop)(?: the)?(?: 3d| model| explorer| viewer| it| this)*$|\bback to (?:the )?(?:chat|conversation|liza|home screen)\b|बंद करो/i;
const RE_RESET = /\b(?:reset(?: the)?(?: view)?|home view|(?:back to|show) the (?:whole|complete|full|entire) (?:model|thing)|take me back to the (?:whole|complete|full) model|whole model)\b/i;
const RE_ZOOM_IN = /\bzoom (?:in|closer)\b|\bcloser\b|\bbigger\b/i;
const RE_ZOOM_OUT = /\bzoom (?:out|back)\b|\bfurther\b|\bsmaller\b/i;
const RE_FOCUS = /\b(?:show me|where is|where are|focus on|zoom in on|zoom into|go to|highlight|select|point to|find)\b|दिखाओ/i;
const RE_HIDE = /\b(?:hide|remove|take away)\b|छुपाओ|हटाओ/i;
const RE_SHOW = /\b(?:bring back|unhide|show the)\b/i;
const RE_ISOLATE = /\b(?:only|just|isolate)\b/i;
const RE_SHOW_ALL = /\b(?:show (?:all|everything)|everything back|all parts)\b/i;
const RE_LABELS = /\b(labels?|names)\b.*\b(on|off|show|hide)\b|\b(show|hide|turn (?:on|off))\b.*\b(labels?|names)\b/i;
const RE_CUT = /\b(?:cut (?:it )?open|cut ?away|see inside|look inside|inside it|outer layer|x-?ray)\b/i;
const RE_EXPLODE = /\b(?:pull (?:it )?apart|explode|take (?:it )?apart)\b/i;
const RE_TOGETHER = /\b(?:put (?:it )?back together|close it up)\b/i;
const RE_TOUR = /\b(?:tour|guide me|take me through|walk me through)\b/i;
const RE_NEXT = /^(?:next|next one|next step|aage|continue|go on)$|^आगे$/i;
const RE_PREV = /^(?:previous|back one|go back one|pichhe)$|^पीछे$/i;
const RE_STOP_TOUR = /\bstop (?:the )?tour\b/i;
const RE_ANIMATE = /\b(?:animate|play (?:the )?(?:animation|motion)|make it move)\b/i;
const RE_QUESTION = /^(?:what|why|how|which|who|when|does|do|is|are|can|tell|explain|compare)\b|^(?:क्या|क्यों|कैसे)/i;
const RE_POLITE = /^(?:hey |ok |okay |so )?(?:liza |lisa )?(?:please |can you |could you |will you |would you |do you have |have you got |is there |can i see |can i have |may i see )+/;
const RE_REQUEST = /^(?:hey |ok |okay |so )?(?:liza |lisa )?(?:please |can you |could you |will you |would you )+/;
const ACKS = { en: ["Okay!", "Here you go.", "Done."], hi: ["ठीक है!", "ये लो।", "हो गया।"] };

const hindi = (language) => language === "hi" || language === "hinglish";
const ack = (language, i = 0) => ACKS[hindi(language) ? "hi" : "en"][i % 3];
const the = (title) => {
  const t = title.replace(/\s*\([^)]*\)/g, "").trim();
  return t.toLowerCase().startsWith("the ") ? `the ${t.slice(4)}` : `the ${t}`;
};
const clean = (text) => (text || "").toLowerCase().replace(/[^\p{L}\p{N}_\s'\-ऀ-ॿ]/gu, " ").replace(/\s+/g, " ").trim();

// Handle `text` without the LLM when it is an explorer command. Returns
// {say, open?: {modelId, focus}} or null to let the conversation have it.
export function tryCommand(text, language = "en") {
  const words = clean(text);
  if (!words || !catalog) return null;
  const openNow = isOpen();
  const currentModel = openNow ? byId(view.modelId) : null;
  const ownPart = Boolean(currentModel && currentModel.components.length && findComponent(currentModel, words));
  const switching = openNow && !ownPart && /\b(?:open|switch to|show me|let'?s see)\b/.test(words);
  const polite = words.replace(RE_POLITE, "");
  const wants3d = !openNow && RE_WANTS_3D.test(words) && !RE_QUESTION.test(polite) && match(words).length === 1;

  if (RE_EXPLICIT.test(words) || switching || wants3d) {
    const ids = match(words).filter((id) => !(openNow && id === view.modelId));
    if (ids.length === 1) {
      const m = byId(ids[0]);
      const focus = m.components.length ? findComponent(m, words) : null;
      const title = (hindi(language) && m.title_hi) || m.title;
      return { open: { modelId: m.model_id, focus: m.components.some((c) => c.id === focus) ? focus : null },
        say: hindi(language) ? `${title} — 3D में खोल रही हूँ।` : `Opening ${the(title)} in 3D.` };
    }
    if (ids.length > 1) {
      return { say: `Which one would you like to see: ${ids.slice(0, 3).map((i) => byId(i).title).join(" or ")}?` };
    }
    if (RE_EXPLICIT.test(words) && !openNow) {
      return { say: hindi(language) ? "उसका 3D मॉडल अभी मेरे पास नहीं है। मैं समझा सकती हूँ।"
        : "I don't have a 3D model of that yet. I can explain it in words." };
    }
  }
  if (!openNow || !currentModel) return null;

  const send = (action, id = null) => view.send(action, id);
  const m = currentModel;
  if (RE_CLOSE.test(words)) {
    return { close: true, say: hindi(language) ? "ठीक है, वापस बात करते हैं।" : "Okay, back to our chat." };
  }
  const comp = m.components.length ? findComponent(m, words) : null;
  if (RE_QUESTION.test(words.replace(RE_REQUEST, ""))) return null;
  if (RE_NEXT.test(words)) return send("guided_next") ? { say: ack(language) } : null;
  if (RE_PREV.test(words)) return send("guided_prev") ? { say: ack(language) } : null;
  if (RE_STOP_TOUR.test(words)) return send("guided_stop") ? { say: ack(language) } : null;
  if (RE_TOUR.test(words)) {
    if (!m.has_tour) return { say: "This model has no tour yet, but you can tap any part." };
    return send("guided_start") ? { say: "Let's go!" } : null;
  }
  if (RE_SHOW_ALL.test(words)) return send("show_all") ? { say: ack(language) } : null;
  if (RE_RESET.test(words)) return send("reset_view") ? { say: ack(language) } : null;
  if (RE_LABELS.test(words)) {
    return send(/\b(off|hide)\b/.test(words) ? "hide_labels" : "show_labels") ? { say: ack(language) } : null;
  }
  if (RE_EXPLODE.test(words)) return send("explode_on") ? { say: ack(language) } : null;
  if (RE_TOGETHER.test(words)) return send("explode_off") ? { say: ack(language) } : null;
  if (RE_ANIMATE.test(words)) return send("play_animation") ? { say: ack(language) } : null;
  if (comp) {
    const c = m.components.find((x) => x.id === comp);
    if (c && c.nested_model && RE_CUT.test(words) && byId(c.nested_model)) {
      return { open: { modelId: c.nested_model, focus: null }, say: `Let's go inside the ${c.label}.` };
    }
    if (RE_HIDE.test(words)) return send("hide_component", comp) ? { say: ack(language, 2) } : null;
    if (RE_ISOLATE.test(words)) return send("isolate_component", comp) ? { say: ack(language, 1) } : null;
    if (RE_SHOW.test(words) && view.state.hidden.includes(comp)) {
      return send("show_component", comp) ? { say: ack(language) } : null;
    }
    if (RE_FOCUS.test(words) || RE_ZOOM_IN.test(words) || words.split(" ").length <= 3) {
      const label = c ? c.label : comp.replace(/_/g, " ");
      return send("focus_component", comp)
        ? { say: hindi(language) ? `ये देखो: ${label}।` : `Zooming in on ${the(label)}.` } : null;
    }
  }
  if (RE_CUT.test(words)) {
    if (m.cutaway) return send("cutaway_on") ? { say: ack(language) } : null;
    return { say: "This model can't be opened up, but you can hide parts to see behind them." };
  }
  if (RE_ZOOM_IN.test(words)) return send("zoom_in") ? { say: ack(language) } : null;
  if (RE_ZOOM_OUT.test(words)) return send("zoom_out") ? { say: ack(language) } : null;
  return null;
}
