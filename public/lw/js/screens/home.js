// The home screen: Liza, the three modes, the Transcribe Board, and the
// SPEAK / STOP / SLEEP buttons. Every position is ui.py's.

import * as api from "../api.js";
import * as explorer from "../explorer.js";
import { Mascot } from "../mascot.js";
import { go } from "../nav.js";
import { at, avatar, h, img, stage, toast } from "../ui.js";
import { setMode, state } from "../state.js";
import { listener, speaker } from "../voice.js";
import { Camera } from "../camera.js";
import { BoardVisual, offerAskedFor } from "../boardvisual.js";
import { openWhiteboard } from "./whiteboard.js";
import { openChats } from "./chats.js";

const UI = "assets/ui/home/";

const MODES = ["TUTOR", "CO-TELL", "RE-TELL"];
const MODE_ART = { "TUTOR": "tutor.png", "CO-TELL": "co_tell.png", "RE-TELL": "re_tell.png" };
const MODE_ACCENTS = { "TUTOR": "#7C3AED", "CO-TELL": "#14B8A6", "RE-TELL": "#F59E0B" };
const MODE_BLURBS = { "TUTOR": "Ask anything", "CO-TELL": "Talk it through", "RE-TELL": "You teach me" };
const MODE_INTROS = {
  "TUTOR": "You are in tutor mode. Ask me anything from your studies.",
  "CO-TELL": "You are in co-tell mode. Name a topic and we will work through it together.",
  "RE-TELL": "You are in re-tell mode. Teach me what you have learned. "
    + "I will listen without interrupting, and when you finish I will tell you how you did.",
};
const STATE_STYLE = {
  idle: ["Tap to speak", "#4C6FFF"],
  sleeping: ["Sleeping", "#8B5CF6"],
  listening: ["Listening", "#14B8A6"],
  thinking: ["Thinking", "#F59E0B"],
  speaking: ["Speaking", "#EC4899"],
  error: ["Something's wrong", "#F43F5E"],
};
const MASCOT_FOR_STATE = { idle: "idle", sleeping: "sleeping", error: "idle",
  listening: "listening", thinking: "thinking", speaking: "speaking" };
const WEATHER_EMOJI = { "01": "☀️", "02": "🌤️", "03": "⛅", "04": "☁️", "09": "🌧️",
  "10": "🌦️", "11": "⛈️", "13": "❄️", "50": "🌫️" };

// A RE-TELL question about the verdict within this long is answered as a
// follow-up, as on the device (RETELL_FOLLOWUP_WINDOW_S).
const RETELL_FOLLOWUP_MS = 120000;
const DEVANAGARI = /[\u0900-\u097F]/;

export function render({ greet = false, ask = "", model = "" } = {}) {
  const profile = state.profile;
  const screen = h("div", { class: "screen bg-garden" });
  stage.appendChild(screen);

  let mode = MODES.includes(state.mode) ? state.mode : "TUTOR";
  let status = "idle";
  let turnController = null;
  let turnFromVoice = false;
  let lastVerdictAt = 0;
  let stopped = false;
  let alive = true;
  const timers = [];

  // ----- top row -----
  const chatBtn = img(UI + "chat.png", 17, 17, 62, 62, "card-img tap");
  chatBtn.title = "Chats";
  chatBtn.addEventListener("click", () => showChats());
  screen.appendChild(chatBtn);

  // Clock and weather (99..303).
  screen.appendChild(img(UI + "weather_bg.png", 99, 17, 204, 62));
  const time = at(h("div", { class: "clock-time abs" }), 107, 21);
  const date = at(h("div", { class: "clock-line abs" }), 107, 49);
  const place = at(h("div", { class: "clock-line abs" }), 107, 61);
  const split = at(h("div", { class: "abs", style: { background: "rgba(16,31,49,.25)" } }), 200, 25, 1, 46);
  const temp = at(h("div", { class: "weather-temp abs" }), 206, 21, 92);
  const cond = at(h("div", { class: "weather-line abs" }), 202, 49, 100);
  const range = at(h("div", { class: "weather-line abs" }), 202, 61, 100);
  screen.append(time, date, place, split, temp, cond, range);
  const tick = () => {
    const now = new Date();
    const [hm, ampm] = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).split(" ");
    time.replaceChildren(hm, h("small", { text: ampm }));
    date.textContent = now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  };
  tick();
  timers.push(setInterval(tick, 10000));
  temp.style.textAlign = "center";
  api.get("/api/weather").then((w) => {
    if (!alive) return;
    place.textContent = w.available ? `${w.city} • Humidity ${w.humidity}%` : (w.city || "");
    if (w.available) {
      temp.textContent = `${WEATHER_EMOJI[(w.icon || "").slice(0, 2)] || "🌡️"} ${w.temp}°`;
      cond.textContent = w.summary;
      range.innerHTML = `<span style="color:#DC2626">↑</span>${w.max}°  <span style="color:#1D4ED8">↓</span>${w.min}°`;
    } else {
      temp.textContent = "🌤️";
      cond.textContent = "Liza web";
    }
  }).catch(() => {});

  // Who is using her (322..526). A tap goes to the picker.
  const who = h("div", { class: "abs tap", style: { left: "322px", top: "17px", width: "204px", height: "62px" } },
    img(UI + "profile_bg.png", 0, 0, 204, 62),
    img(avatar(profile.avatar), 8, 6, 50, 50, "card-img"),
    at(h("div", { class: "who-chip-name abs", text: profile.name }), 66, 12, 130),
    at(h("div", { class: "who-chip-class abs", text: `Class ${profile.class}` }), 66, 34, 130));
  who.querySelector("img:nth-child(2)").style.borderRadius = "50%";
  who.addEventListener("click", () => go("picker"));
  screen.appendChild(who);

  // Music (541..745). There is no music library on the web.
  const music = h("div", { class: "abs", style: { left: "541px", top: "17px", width: "204px", height: "62px" } },
    img(UI + "music_bg.png", 0, 0, 204, 62),
    at(h("div", { class: "music-btn", html: svgPrev() }), 46, 8),
    at(h("div", { class: "music-btn", html: `<div style="width:26px;height:26px;border-radius:50%;background:#2E1F8F;display:flex;align-items:center;justify-content:center">${svgPause()}</div>` }), 89, 8),
    at(h("div", { class: "music-btn", html: svgNext() }), 136, 8),
    at(h("div", { class: "music-title abs", text: "Nothing playing" }), 10, 40, 92),
    at(h("div", { class: "music-track" }), 104, 47, 90),
    at(h("div", { class: "music-knob" }), 102, 44));
  music.addEventListener("click", () => toast("Music plays on the Liza device."));
  screen.appendChild(music);

  // ----- state pill over her head -----
  const pill = h("div", { class: "state-pill" });
  pill.style.left = "292px";
  screen.appendChild(pill);

  // ----- the three modes (14..173 x 124..363) -----
  screen.appendChild(img(UI + "mode_bg.png", 14, 124, 159, 239));
  const modesTitle = h("div", { class: "modes-title" });
  screen.appendChild(modesTitle);
  const modeCards = {};
  MODES.forEach((m, i) => {
    const card = h("div", { class: "mode-card" },
      h("img", { src: UI + MODE_ART[m], alt: m }),
      h("div", { class: "blurb-cover" }),
      h("div", { class: "blurb", text: MODE_BLURBS[m] }),
      h("div", { class: "check", html: '<svg width="9" height="9" viewBox="0 0 10 10"><path d="M1.5 5.2l2.3 2.3L8.5 2.6" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' }));
    card.style.setProperty("--accent", MODE_ACCENTS[m]);
    card.addEventListener("click", () => chooseMode(m, true));
    modeCards[m] = at(card, 21, 159 + i * 66);
    screen.appendChild(card);
  });

  // ----- Liza -----
  const mascot = new Mascot(screen, { left: 199, top: 132, width: 187, height: 250 });
  mascot.canvas.classList.add("tap");
  mascot.canvas.addEventListener("click", () => speakTapped());
  const zs = h("div");
  screen.appendChild(zs);

  // ----- the Transcribe Board (454..783 x 109..375) -----
  screen.appendChild(img(UI + "transcribe_board.png", 454, 109, 329, 266));
  // The device's two corners: the camera on the left, the full-screen board
  // on the right. Typing (for a hall too loud to talk in) sits beside the camera.
  const camBtn = at(h("div", { class: "board-icon", title: "Camera",
    html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h3l2-3h8l2 3h3v11H3z"/><circle cx="12" cy="13" r="3.6"/></svg>' }), 467, 120);
  const typeBtn = at(h("div", { class: "board-icon", title: "Type a question",
    html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M9 13h6"/></svg>' }), 503, 120);
  const expandBtn = at(h("div", { class: "board-icon", title: "Whiteboard",
    html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>' }), 740, 120);
  screen.append(camBtn, typeBtn, expandBtn);
  const board = h("div", { class: "board-text" });
  screen.appendChild(board);
  const camBox = h("div", { class: "cam-box" });
  screen.appendChild(camBox);
  const camera = new Camera();
  const typeRow = h("div", { class: "type-row" });
  const typeInput = h("input", { type: "text", placeholder: "Type your question...", maxlength: "600" });
  const typeSend = h("button", { text: "Ask" });
  typeRow.append(typeInput, typeSend);
  screen.appendChild(typeRow);
  // The board's picture and the buttons under it (show_visual / show_offers).
  const visual = new BoardVisual(screen, { onOffer: (offer) => takeOffer(offer),
    // The geometry lab's Ask Liza: its question, as if asked (ui.py _geo_ask).
    onAsk: (question) => { interrupt(); runTurn({ text: question }); } });
  camBtn.addEventListener("click", () => toggleCamera());
  typeBtn.addEventListener("click", () => toggleTyping());
  expandBtn.addEventListener("click", () => openBoard());
  typeSend.addEventListener("click", () => sendTyped());
  typeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendTyped(); });

  // ----- the buttons (y 397, x 169 / 328 / 489) -----
  const speakBtn = h("div", { class: "big-btn" }, h("img", { src: UI + "speak_button.png", alt: "Speak" }));
  const stopBtn = h("div", { class: "big-btn" }, h("img", { src: UI + "stop_button.png", alt: "Stop" }));
  const sleepBtn = h("div", { class: "big-btn" }, h("img", { src: UI + "sleep_button.png", alt: "Sleep" }));
  screen.append(at(speakBtn, 169, 397), at(stopBtn, 328, 397), at(sleepBtn, 489, 397));
  speakBtn.addEventListener("click", () => speakTapped());
  stopBtn.addEventListener("click", () => stopTapped());
  sleepBtn.addEventListener("click", () => sleepTapped());

  // Exit: two taps, as on the device. Here it goes back to the picker.
  const exitBtn = h("img", { src: UI + "exit.png", class: "exit-btn", alt: "Exit" });
  screen.appendChild(exitBtn);
  let exitArmed = 0;
  exitBtn.addEventListener("click", () => {
    if (Date.now() - exitArmed < 3000) return go("picker");
    exitArmed = Date.now();
    const note = h("div", { class: "exit-confirm", text: "Tap again to switch student" });
    screen.appendChild(note);
    setTimeout(() => note.remove(), 3000);
  });

  // ----- the board's contents -----
  let lizaLine = null;
  const sentences = [];

  function boardReset(placeholder) {
    board.replaceChildren();
    sentences.length = 0;
    lizaLine = null;
    if (placeholder) {
      board.append(h("div", { class: "board-label", text: "You said:" }),
        h("div", { class: "board-line", text: placeholder }));
    }
  }

  function boardUser(text) {
    visual.caption(text, "user");
    board.replaceChildren(h("div", { class: "board-label", text: "You said:" }),
      h("div", { class: "board-line user", text }));
    sentences.length = 0;
    lizaLine = null;
  }

  function boardLiza(text) {
    visual.caption(text, "liza");
    if (!lizaLine) {
      board.appendChild(h("div", { class: "board-label liza", text: "Liza:" }));
      lizaLine = h("div", { class: "board-line liza" });
      board.appendChild(lizaLine);
    }
    const span = h("span", { text: (sentences.length ? " " : "") + text });
    sentences.push({ text, span });
    lizaLine.appendChild(span);
    board.scrollTop = board.scrollHeight;
  }

  function boardStatus(text) {
    board.appendChild(h("div", { class: "board-status", text }));
    board.scrollTop = board.scrollHeight;
  }

  function boardReport(r) {
    const rows = [
      ...r.strong.map((s) => h("div", { class: "row good" }, h("b", { text: "✓ " }), s)),
      ...r.weak.map((s) => h("div", { class: "row weak" }, h("b", { text: "✗ " }), s)),
      r.focus ? h("div", { class: "row focus" }, h("b", { text: "Focus: " }), r.focus) : null,
    ];
    board.appendChild(h("div", { class: "report" },
      h("h4", {}, h("span", { text: r.topic }), h("span", { class: "score", text: r.score || "" })),
      r.before ? h("div", { class: "row" }, `Last time: ${r.before}`) : null,
      ...rows));
    board.scrollTop = board.scrollHeight;
  }

  speaker.onStart = (item) => {
    if (!alive) return;
    setStatus("speaking");
    sentences.forEach((s) => s.span.classList.toggle("lit", s.text === item.text));
    visual.matchStep(item.text);
  };
  speaker.onEnd = () => {
    sentences.forEach((s) => s.span.classList.remove("lit"));
  };
  speaker.onIdle = () => {};
  // A ring round "Listening" that grows with their voice: proof she hears.
  listener.onLevel = (v) => {
    pill.style.boxShadow = v > 0 ? `0 0 0 ${2 + Math.round(v * 7)}px rgba(20,184,166,.45)` : "none";
  };

  // ----- state -----
  function setStatus(next) {
    status = next;
    const [label, colour] = STATE_STYLE[next] || STATE_STYLE.idle;
    pill.textContent = label;
    pill.style.color = colour;
    mascot.set(MASCOT_FOR_STATE[next] || "idle");
    const view = explorer.current();
    if (view) view.lizaState(next);
    speakBtn.classList.toggle("dim", next === "listening");
    zs.replaceChildren();
    if (next === "sleeping") {
      [0, 0.8, 1.6].forEach((delay, i) => {
        const z = at(h("div", { class: "sleep-z", text: "z" }), 330 + i * 12, 150 - i * 14);
        z.style.animationDelay = `${delay}s`;
        z.style.fontSize = `${16 + i * 5}px`;
        zs.appendChild(z);
      });
    }
  }

  function chooseMode(m, announce) {
    mode = m;
    setMode(m);
    modesTitle.textContent = `${m} MODE`;
    MODES.forEach((x) => modeCards[x].classList.toggle("on", x === m));
    if (announce) {
      interrupt();
      boardReset();
      board.append(h("div", { class: "board-label liza", text: "Liza:" }),
        h("div", { class: "board-line liza", text: MODE_INTROS[m] }));
      speaker.say(MODE_INTROS[m]);
    }
  }

  function interrupt() {
    stopped = true;
    if (turnController) turnController.abort();
    turnController = null;
    listener.cancel();
    speaker.stop();
    setStatus("idle");
  }

  // ----- conversation -----
  async function speakTapped() {
    // Before anything else, while the tap still counts: see voice.js prime().
    listener.prime();
    if (status === "listening") {
      // A second tap while listening means "I'm done".
      listener.finishNow();
      return;
    }
    interrupt();
    await listen(false);
  }

  async function listen(followUp) {
    if (!alive) return;
    if (!window.isSecureContext) {
      // http:// pages get no microphone at all, whatever the person allows.
      toast("The microphone only works on the https:// address of this website.", 6000);
      toggleTyping(true);
      return;
    }
    if (!listener.supported) {
      toast("This browser cannot use the microphone. Type your question instead.");
      toggleTyping(true);
      return;
    }
    stopped = false;
    setStatus("listening");
    if (!followUp) boardReset(mode === "RE-TELL"
      ? "I'm listening. Teach me the topic, and tap SPEAK again when you finish."
      : "I'm listening...");
    let blob = null;
    try {
      blob = await listener.listen(mode === "RE-TELL"
        ? { startTimeoutMs: 10000, endSilenceMs: 4000, maxMs: 120000 }
        : { startTimeoutMs: followUp ? 6000 : 8000, endSilenceMs: 900, maxMs: 25000 });
    } catch (err) {
      console.error(err);
      setStatus("idle");
      const why = err && err.name;
      toast(why === "NotFoundError" || why === "OverconstrainedError"
        ? "No microphone found on this device. Plug one in, or type your question."
        : why === "NotReadableError" || why === "AbortError"
          ? "Another app (Zoom, Teams, Meet) is using the microphone. Close it and tap SPEAK again, or type."
          : why === "NotAllowedError" || why === "SecurityError"
            ? "The microphone is blocked. Allow it from the icon in the address bar, then tap SPEAK."
            : `The microphone did not start (${why || "unknown error"}). Reload the page and tap SPEAK again.`,
      7000);
      toggleTyping(true);
      return;
    }
    if (!alive || stopped) return;
    if (!blob) {
      setStatus("idle");
      // Said, not just reset: a silent reset looks like the microphone is
      // not there at all.
      if (!followUp) {
        boardReset();
        boardStatus("I couldn't hear anything. Check the microphone chosen in the address bar, speak a little louder, and tap SPEAK again.");
      }
      return;
    }
    await runTurn({ audio: blob, fromVoice: true });
  }

  // One question, typed or spoken. A spoken one goes up as audio in the same
  // request that answers it (one round trip, not two); if the words that
  // come back are a 3D Explorer command, the answer is dropped and the
  // command carried out instead.
  async function runTurn({ text = "", audio = null, fromVoice = false }) {
    turnFromVoice = fromVoice;
    stopped = false;
    setStatus("thinking");
    boardUser(text || "...");
    if (text) {
      // "Yes, show me" to a button on the board: take it, no need to ask her.
      const which = offerAskedFor(text, visual.offers);
      if (which !== null) return takeOffer(visual.offers[which], true);
      const holo = explorer.current();
      if (holo) holo.caption(text, "you");
      if (mode !== "RE-TELL") {
        await explorer.loadCatalog();
        const command = explorer.tryCommand(text, DEVANAGARI.test(text) ? "hi" : "en");
        if (command) return applyCommand(command);
      }
    }

    const offersBefore = visual.offers;
    let takeWhich = null;
    visual.setOffers([]);
    const controller = new AbortController();
    turnController = controller;
    let retell = "";
    if (mode === "RE-TELL") retell = Date.now() - lastVerdictAt < RETELL_FOLLOWUP_MS ? "auto" : "evaluate";
    let heardNothing = false;
    let language = "en";
    let command = null;
    const holo = explorer.current();
    // The camera is on: what it sees right now goes with the question.
    const photo = camera.on ? await camera.frame() : null;
    try {
      const shown = { ...visual.state(), camera: camera.on };
      await api.turn({ profileId: profile.id, mode, text, audio, retell, photo, screen: shown,
        board: holo ? holo.state : null, signal: controller.signal }, (ev) => {
        if (controller !== turnController) return;
        if (ev.type === "heard") {
          if (!ev.text) { heardNothing = true; return; }
          language = ev.language || "en";
          if (audio) {
            text = ev.text;
            boardUser(text);
            const view = explorer.current();
            if (view) view.caption(text, "you");
            takeWhich = offerAskedFor(text, offersBefore);
            if (takeWhich !== null) { controller.abort(); return; }
            if (mode !== "RE-TELL") {
              command = explorer.tryCommand(text, DEVANAGARI.test(text) ? "hi" : "en");
              if (command) controller.abort();
            }
          }
        } else if (ev.type === "sentence") {
          speaker.say(ev.text);
          boardLiza(ev.text);
          camera.caption(ev.text);
          const view = explorer.current();
          if (view) view.caption(ev.text, "liza");
        } else if (ev.type === "status") {
          boardStatus(ev.text);
        } else if (ev.type === "marked") {
          lastVerdictAt = Date.now();
        } else if (ev.type === "visual") {
          showVisual(ev);
        } else if (ev.type === "offers") {
          visual.setOffers(ev.offers);
        } else if (ev.type === "geometry_pick") {
          visual.geometryPick(ev.picks);
        } else if (ev.type === "do") {
          doAction(ev.action, ev.param);
        }
      });
    } catch (err) {
      if (err.name === "AbortError") {
        if (takeWhich !== null && controller === turnController) {
          turnController = null;
          visual.setOffers(offersBefore);
          return takeOffer(offersBefore[takeWhich], true);
        }
        if (command && controller === turnController) {
          turnController = null;
          return applyCommand(command);
        }
        return;
      }
      console.error(err);
      setStatus("error");
      boardStatus(err.message || "Something went wrong.");
      setTimeout(() => { if (status === "error") setStatus("idle"); }, 3000);
      return;
    }
    if (controller !== turnController) return;
    turnController = null;
    if (heardNothing) {
      setStatus("idle");
      boardReset("I didn't catch that. Tap SPEAK and try again.");
      return;
    }
    // "Visualize in 3D" when the question named something the explorer has
    // (holo/bridge.py after_reply).
    if (!explorer.isOpen() && mode !== "RE-TELL") {
      const holoOffer = explorer.offerFor(text, language);
      if (holoOffer && !visual.offers.some((o) => o.kind === "holo")) {
        // holo/bridge.py keep_offer: the explorer's button goes first.
        visual.setOffers([{ kind: "holo", payload: holoOffer.modelId, label: holoOffer.label,
          sub: holoOffer.sub, language }, ...visual.offers].slice(0, 3));
      }
    }
    await afterSpeaking();
  }

  async function afterSpeaking() {
    await speaker.finished();
    if (!alive || stopped || status === "sleeping") return;
    // As on the device, she listens again for a follow-up after a spoken
    // question -- but not in RE-TELL, where the next thing is a new recitation.
    if (turnFromVoice && mode !== "RE-TELL") await listen(true);
    else setStatus("idle");
  }

  // ----- the 3D Explorer -----
  async function applyCommand(command) {
    const hindi = DEVANAGARI.test(command.say);
    if (command.close) closeExplorer();
    if (command.open) openExplorer(command.open.modelId, command.open.focus, hindi ? "hi" : "en");
    boardLiza(command.say);
    speaker.say(command.say);
    const view = explorer.current();
    if (view) view.caption(command.say, "liza");
    await afterSpeaking();
  }

  function openExplorer(modelId, focus = null, language = "en") {
    explorer.open(modelId, {
      focus,
      language,
      hooks: {
        close: () => { interrupt(); closeExplorer(); },
        say: (line) => speaker.say(line),
        talk: (what) => (what === "stop" ? stopTapped() : speakTapped()),
      },
    });
    const view = explorer.current();
    // Her button in the viewer follows her state once the viewer is up.
    setTimeout(() => { if (explorer.current() === view) view.lizaState(status); }, 1500);
  }

  function closeExplorer() {
    const view = explorer.current();
    if (view) view.close();
  }

  // ----- the board's picture, buttons and her screen actions -----
  function showVisual(v) {
    // The trial 3D Explorer has this one (the heart, a cell): it opens
    // instead of her own 3D view (actions._show_model3d).
    if (v.scene && v.payload) {
      const instead = explorer.insteadOfModel3d(v.payload);
      if (instead) {
        openExplorer(instead.modelId, instead.focus, DEVANAGARI.test(v.payload) ? "hi" : "en");
        return;
      }
    }
    // A picture going on the board takes the camera's place (camera.stop_live).
    if (camera.on) stopCamera();
    visual.show(v, { enlarge: false });
  }

  // For trying the screen from the browser's console: #...&debug in the link.
  if (/(^|&)debug(&|$)/.test(location.hash.slice(1))) window.lizaDebug = { showVisual, takeOffer, visual, runTurn };

  // A button on the board, tapped or answered with "yes": actions.run_offer.
  async function takeOffer(offer, spoken = false) {
    if (!offer) return;
    if (offer.kind === "holo") {
      interrupt();
      openExplorer(offer.payload, null, offer.language === "hi" ? "hi" : "en");
      return;
    }
    if (spoken) {
      setStatus("thinking");
    }
    try {
      const done = await api.send("POST", "/api/visual", { kind: offer.kind, payload: offer.payload, lab: true,
        language: DEVANAGARI.test(offer.label || "") ? "hi" : "en" });
      if (done.visual) showVisual({ type: "visual", ...done.visual });
      if (done.visual && done.visual.scene && (offer.settings || []).length) visual.applySettings(offer.settings);
      if (done.offers) visual.setOffers(done.offers);
      if (done.say) { speaker.say(done.say); boardLiza(done.say); }
    } catch (err) {
      toast(err.message || "That did not come out right.");
    }
    if (spoken) await afterSpeaking();
  }

  // Her action tags that are the screen's to carry out (actions.execute_action).
  function doAction(name, param) {
    if (name === "hide_visual") visual.clear();
    else if (name === "enlarge_visual") visual.enlarge();
    else if (name === "shrink_visual") visual.shrink();
    else if (name === "ui_mode") {
      const wanted = (param || "").toUpperCase().replace(/[^A-Z-]/g, "").replace(/^CO-?TELL$/, "CO-TELL")
        .replace(/^RE-?TELL$/, "RE-TELL");
      if (MODES.includes(wanted)) chooseMode(wanted, false);
    } else if (name === "sleep") {
      // After her goodnight has been said, as on the device.
      speaker.finished().then(() => { if (alive) { stopped = true; listener.cancel(); setStatus("sleeping"); } });
    } else if (name === "board_open") openBoard();
    else if (name === "board_close") closeBoard();
    else if (name === "camera_off") { if (camera.on) stopCamera(); }
    else if (name === "look") { if (!camera.on) toggleCamera(true); }
  }

  function stopTapped() {
    const wasListening = status === "listening";
    interrupt();
    if (wasListening) boardReset("Stopped. Tap SPEAK when you are ready.");
  }

  function sleepTapped() {
    interrupt();
    setStatus("sleeping");
    boardReset();
    const line = "Okay, I'll take a little nap. Tap SPEAK when you need me.";
    board.append(h("div", { class: "board-label liza", text: "Liza:" }),
      h("div", { class: "board-line liza", text: line }));
    speaker.say(line);
    speaker.onStart = () => {};
    speaker.finished().then(() => { if (alive) installSpeakerHooks(); });
  }

  function installSpeakerHooks() {
    speaker.onStart = (item) => {
      if (!alive) return;
      setStatus("speaking");
      sentences.forEach((s) => s.span.classList.toggle("lit", s.text === item.text));
      visual.matchStep(item.text);
    };
  }

  function toggleTyping(force) {
    const on = force === undefined ? !typeRow.classList.contains("on") : force;
    typeRow.classList.toggle("on", on);
    typeBtn.classList.toggle("on", on);
    board.style.height = on ? "166px" : "196px";
    camBox.classList.toggle("short", on);
    if (on) setTimeout(() => typeInput.focus(), 30);
  }

  function sendTyped() {
    const text = typeInput.value.trim();
    if (!text) return;
    typeInput.value = "";
    interrupt();
    runTurn({ text });
  }

  // ----- the camera -----
  function stopCamera() {
    camera.stop();
    camBtn.classList.remove("on");
    board.style.visibility = "";
  }

  async function toggleCamera(quiet = false) {
    if (camera.on) {
      stopCamera();
      return;
    }
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      toast("This browser cannot use a camera.");
      return;
    }
    try {
      await camera.start(camBox);
    } catch (err) {
      const why = err && err.name;
      toast(why === "NotFoundError" ? "No camera found on this device."
        : why === "NotReadableError" ? "Another app is using the camera. Close it and try again."
          : "The camera is blocked. Allow it from the icon in the address bar.", 5000);
      return;
    }
    camBtn.classList.add("on");
    board.style.visibility = "hidden";
    // The live view takes the board, as on the device.
    visual.clear();
    if (quiet) return;
    const line = "My camera is on. Hold something up and ask me about it.";
    camera.caption(line);
    speaker.say(line);
  }

  // ----- the full-screen whiteboard -----
  let closeWhiteboard = null;
  function openBoard() {
    interrupt();
    // The board open full screen: a picture she puts up opens over it, big
    // (ui.py show_visual enlarges while the board is open).
    closeWhiteboard = openWhiteboard({ screen, profile, mode: () => mode,
      // A worked solution stays small: its steps go beside the writing
      // instead (actions._show_solution passes enlarge=False).
      onVisual: (v) => {
        // A 3D model opens over the board (or the explorer opens instead).
        if (v.scene) {
          showVisual(v);
          if ((v.settings || []).length) visual.applySettings(v.settings);
          return;
        }
        visual.show(v);
        if (v.kind !== "solution") visual.enlarge();
      },
      onDo: (name, param) => doAction(name, param) });
  }
  function closeBoard() {
    if (closeWhiteboard) closeWhiteboard();
    closeWhiteboard = null;
  }

  // ----- the chats: the device's two-pane screen (chats.js) -----
  function showChats() {
    interrupt();
    openChats(screen, profile);
  }

  // ----- start -----
  chooseMode(mode, false);
  setStatus("idle");
  boardReset("Tap SPEAK or type your question to begin.");
  if (greet) {
    const hello = `Hi ${profile.name}! Tap speak and ask me anything.`;
    boardReset();
    board.append(h("div", { class: "board-label liza", text: "Liza:" }),
      h("div", { class: "board-line liza", text: hello }));
    speaker.say(hello);
  }
  // #open=home&profile=...&ask=... asks one question as soon as she is up.
  if (ask) setTimeout(() => { if (alive) runTurn({ text: ask }); }, 600);
  // ...&model=heart_bp3d_v1 opens the 3D Explorer on it.
  explorer.loadCatalog();
  if (model) setTimeout(() => { if (alive) openExplorer(model); }, 300);

  return () => {
    alive = false;
    closeExplorer();
    if (turnController) turnController.abort();
    timers.forEach(clearInterval);
    speaker.onStart = speaker.onEnd = speaker.onIdle = () => {};
    listener.onLevel = () => {};
    camera.stop();
    listener.release();
    mascot.stop();
  };
}

function svgPrev() {
  return '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="2" width="2" height="10" fill="#2E1F8F"/><path d="M12 2v10L4 7z" fill="#2E1F8F"/></svg>';
}
function svgNext() {
  return '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="11" y="2" width="2" height="10" fill="#2E1F8F"/><path d="M2 2v10l8-5z" fill="#2E1F8F"/></svg>';
}
function svgPause() {
  return '<svg width="10" height="12" viewBox="0 0 10 12"><rect x="1" y="1" width="3" height="10" fill="#fff"/><rect x="6" y="1" width="3" height="10" fill="#fff"/></svg>';
}
