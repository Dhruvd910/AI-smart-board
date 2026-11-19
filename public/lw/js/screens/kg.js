// The Kindergarten side, ported from ui.py's KG screens: the same layout on
// the same 800x480 classroom, the same words said in the same tones, and the
// same marking (kg_content's own functions, on the server). Sizes are Tk
// points as ui.py gives them; PT turns them into pixels.

import * as api from "../api.js";
import { Mascot } from "../mascot.js";
import { go } from "../nav.js";
import { at, confetti, h, pick, shuffle, stage, toast } from "../ui.js";
import { kgContent, progress, state } from "../state.js";
import { StoryStage } from "../storystage.js";
import { listener, speaker } from "../voice.js";

const KG = "assets/ui/kg/";
const PT = 1.333;
const BOARD_MID = 409;
const CHALK = "#F3F7F0", CHALK_DIM = "#E8F2E5", CHALK_WARM = "#FDE68A";
const CHALK_YELLOW = "#FDEBA8", CHALK_BLUE = "#DCEBFB";
const CLASS_BLUE = "#17408B", CLASS_INK = "#1D4ED8", COUNT_GREEN = "#065F46";
const ROW_Y0 = 394, ROW_Y1 = 442;
const ROW3 = [[44, 204], [320, 480], [596, 756]];
const ROW4 = [[24, 186], [204, 366], [430, 596], [614, 776]];
const ASK_BOX = [24, 198, 172, 246];
const ASK_BOX_STORY = [204, 394, 366, 442];
// ui.py KG_CARD_TONE: the chalk voices as ink on the caption card.
const CARD_TONE = {
  excited: ["#B45309", 17], amazed: ["#B45309", 16], proud: ["#B45309", 16], encouraging: ["#B45309", 15],
  curious: ["#1D4ED8", 15], storyteller: ["#1E293B", 15], warm: ["#B45309", 15], gentle: ["#1E293B", 14],
  sad: ["#1D4ED8", 14], mysterious: ["#4338CA", 14],
};
const CHALK_TONE = {
  excited: [CHALK_YELLOW, 17], amazed: [CHALK_YELLOW, 16], proud: [CHALK_YELLOW, 16],
  encouraging: [CHALK_YELLOW, 15], curious: [CHALK_BLUE, 15], storyteller: [CHALK, 15],
  warm: [CHALK_YELLOW, 15], gentle: [CHALK, 14], sad: [CHALK_BLUE, 14], mysterious: [CHALK_BLUE, 14],
};
const STORY_COLOURS = ["#B45309", "#1D4ED8", "#047857", "#BE185D", "#6D28D9", "#0F766E", "#B91C1C", "#0E7490"];
const SEEN_WORDS = new Set();
const SEEN_STORIES = new Set();

// ---------------------------------------------------------------------------
// Drawing helpers (ui.py _overlay_text, _overlay_button, _kg_class_button ...)
// ---------------------------------------------------------------------------

// Text centred on (x, y), as Tk's create_text draws it.
function text(parent, x, y, words, pt, { bold = false, colour = "#1E2233", width = null,
  maxLines = 0, anchor = "center" } = {}) {
  const el = h("div", { class: "kg-t", text: words });
  Object.assign(el.style, {
    left: `${x}px`, top: `${y}px`, font: `${bold ? 700 : 400} ${Math.round(pt * PT)}px/1.25 var(--font)`,
    color: colour, width: width ? `${width}px` : "auto",
    transform: anchor === "w" ? "translate(0,-50%)" : anchor === "e" ? "translate(-100%,-50%)" : "translate(-50%,-50%)",
    textAlign: anchor === "w" ? "left" : anchor === "e" ? "right" : "center",
    whiteSpace: width ? "normal" : "nowrap",
  });
  if (maxLines) {
    Object.assign(el.style, { display: "-webkit-box", WebkitLineClamp: String(maxLines),
      WebkitBoxOrient: "vertical", overflow: "hidden" });
  }
  parent.appendChild(el);
  return el;
}

function button(parent, [x0, y0, x1, y1], label, onclick, { fill = "#6366F1", ink = "#FFFFFF",
  radius = 12, pt = 13, sub = null, labelFrac = null, subFrac = 0.68, wrap = false, labelDx = 0 } = {}) {
  const el = h("button", { class: "kg-btn2", onclick });
  Object.assign(el.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px`,
    background: fill, borderRadius: `${radius}px` });
  const height = y1 - y0;
  const labelY = labelFrac !== null ? height * labelFrac : (sub ? height * 0.36 : height / 2);
  text(el, (x1 - x0) / 2 + labelDx, labelY, label, pt, { bold: true, colour: ink,
    width: wrap ? (x1 - x0) - 20 - 2 * Math.abs(labelDx) : null });
  if (sub) text(el, (x1 - x0) / 2 + labelDx, height * subFrac, sub, 8, { colour: ink });
  parent.appendChild(el);
  return el;
}

// One pill on the classroom floor (_kg_class_button): navy on white, or white
// on navy for the one that carries the lesson on.
function floor(parent, [x0, x1], label, onclick, { primary = false, arrow = null, pt = 12 } = {}) {
  const ink = primary ? "#FFFFFF" : CLASS_INK;
  const el = button(parent, [x0, ROW_Y0, x1, ROW_Y1], label.toUpperCase(), onclick,
    { fill: primary ? CLASS_BLUE : "#FFFFFF", ink, radius: (ROW_Y1 - ROW_Y0) / 2, pt });
  el.classList.add("kg-floor");
  if (arrow) {
    const tri = h("span", { class: `kg-tri ${arrow}` });
    tri.style.setProperty("--ink", ink);
    tri.style[arrow === "left" ? "left" : "right"] = "18px";
    el.appendChild(tri);
  }
  return el;
}

function glassCard(parent, [x0, y0, x1, y1], radius = 22) {
  const card = h("div", { class: "kg-glass" });
  Object.assign(card.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`,
    height: `${y1 - y0}px`, borderRadius: `${radius}px` });
  parent.appendChild(card);
  return card;
}

function roundRect(parent, [x0, y0, x1, y1], radius, fill, outline = null, width = 1) {
  const el = h("div", { class: "kg-rr" });
  Object.assign(el.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`,
    height: `${y1 - y0}px`, borderRadius: `${radius}px`, background: fill,
    boxSizing: "border-box", border: outline ? `${width}px solid ${outline}` : "none" });
  parent.appendChild(el);
  return el;
}

// _place_emoji: an emoji or a picture file, centred, `size` pixels.
function emoji(parent, picture, x, y, size) {
  if (!picture) return null;
  let el;
  if (/\.(png|jpe?g|webp|gif)$/i.test(picture)) {
    el = h("img", { src: `assets/kg/${picture.toLowerCase()}`, alt: "", draggable: "false" });
    el.onerror = () => { el.style.visibility = "hidden"; };
    Object.assign(el.style, { width: `${size}px`, height: `${size}px`, objectFit: "contain" });
  } else {
    el = h("div", { text: picture });
    Object.assign(el.style, { fontSize: `${Math.round(size * 0.86)}px`, lineHeight: "1" });
  }
  el.classList.add("kg-emoji2");
  Object.assign(el.style, { left: `${x}px`, top: `${y}px` });
  parent.appendChild(el);
  return el;
}

function ring(parent, x, y, half, colour) {
  const el = h("div", { class: "kg-ring" });
  Object.assign(el.style, { left: `${x - half}px`, top: `${y - half}px`, width: `${half * 2}px`,
    height: `${half * 2}px`, borderColor: colour });
  parent.appendChild(el);
  return el;
}

// _kg_board_row_x: a row of cards centred on the BOARD (409), not the screen.
const rowX = (count, width, gap = 12) => BOARD_MID - (count * width + (count - 1) * gap) / 2;

// A lesson in the classroom, its heading chalked on the board.
function classroom(title, subtitle, { mascot = false } = {}) {
  const screen = h("div", { class: "screen bg-class" });
  stage.appendChild(screen);
  text(screen, BOARD_MID, 90, title, 19, { bold: true, colour: CHALK });
  if (subtitle) text(screen, BOARD_MID, 114, subtitle, 10, { colour: CHALK_DIM });
  const m = mascot ? new Mascot(screen, { left: 199, top: 132, width: 187, height: 250 }) : null;
  return { screen, mascot: m };
}

// ---------------------------------------------------------------------------
// Speaking and listening (kg.kg_say_many, _kg_after_speaking, kg_request_listen)
// ---------------------------------------------------------------------------

let screenSeq = 0;           // a new screen makes every pending callback stale
function newScreen() {
  screenSeq += 1;
  listener.cancel();
  return screenSeq;
}
const stale = (token) => token !== screenSeq;

function sayMany(lines, mascot = null) {
  speaker.stop();
  if (mascot) {
    speaker.onStart = () => mascot.set("speaking");
    speaker.onIdle = () => mascot.set("idle");
  }
  for (const [line, tone] of lines) speaker.say(line, null, tone || "");
}
const say = (line, tone, mascot) => sayMany([[line, tone]], mascot);

function afterSpeaking(token, callback, settleMs = 400) {
  speaker.finished().then(() => setTimeout(() => { if (!stale(token)) callback(); }, settleMs));
}

// One utterance, transcribed: "" when nothing was said.
async function hear({ startS = 8, phraseS = 8, endS = 1.4, language = "en", seed = "" } = {}) {
  listener.prime();
  let blob = null;
  try {
    blob = await listener.listen({ startTimeoutMs: startS * 1000, endSilenceMs: endS * 1000,
      maxMs: (startS + phraseS) * 1000 });
  } catch (_) {
    toast("Allow the microphone so Liza can hear you.", 4000);
    return "";
  }
  if (!blob) return "";
  try {
    const heard = await api.transcribe(blob, language, undefined, seed);
    return heard.text || "";
  } catch (_) {
    return "";
  }
}

const check = (fn, ...args) => api.send("POST", "/api/kg/check", { fn, args });

function note(kind, topic, extra = {}) {
  progress(kind, topic, extra);
}

// The "Ask me" button (_kg_ask_button / _kg_ask / kg_handle_doubt): the child
// stops the lesson to ask something of their own. A second tap stops her.
const doubtHistory = [];
function askButton(screen, box, mascot) {
  let asking = false;
  let el = null;
  const draw = () => {
    if (el) el.remove();
    const roomy = (box[3] - box[1]) >= 80;
    el = asking
      ? button(screen, box, "Listening", toggle, { fill: "#FEF3C7", ink: "#92400E", pt: 13,
        radius: roomy ? 12 : (box[3] - box[1]) / 2 })
      : button(screen, box, "Ask me", toggle, { fill: "#F59E0B", pt: 14,
        radius: roomy ? 12 : (box[3] - box[1]) / 2 });
  };
  const toggle = async () => {
    listener.prime();
    if (asking) {
      asking = false; listener.cancel(); speaker.stop(); draw();
      if (mascot) mascot.set("idle");
      return;
    }
    asking = true; speaker.stop(); draw();
    if (mascot) mascot.set("listening");
    const token = screenSeq;
    say("Yes? What would you like to ask me?", "curious");
    await speaker.finished();
    if (stale(token) || !asking) return;
    const question = await hear({ startS: 3, phraseS: 14, endS: 1.4, language: "" });
    if (stale(token) || !asking) return;
    asking = false; draw();
    if (!question.trim()) {
      say("I did not quite catch that. Ask me again whenever you like.", "gentle", mascot);
      return;
    }
    if (mascot) mascot.set("thinking");
    let answer = "";
    try {
      answer = (await api.send("POST", "/api/kg/ask", { profile_id: state.profile.id, question,
        history: doubtHistory })).answer || "";
    } catch (_) { answer = ""; }
    if (stale(token)) return;
    if (!answer) { say("I am not sure about that one. Let us try again in a moment.", "gentle", mascot); return; }
    doubtHistory.push({ role: "user", content: question }, { role: "assistant", content: answer });
    doubtHistory.splice(0, Math.max(0, doubtHistory.length - 12));
    say(answer, "warm", mascot);
  };
  draw();
}

// ---------------------------------------------------------------------------
// KG home
// ---------------------------------------------------------------------------

export function home({ greet = false } = {}) {
  newScreen();
  const profile = state.profile;
  const screen = h("div", { class: "screen bg-garden wash" });
  stage.appendChild(screen);
  screen.appendChild(h("div", { class: "glass" }));
  screen.append(
    at(h("div", { class: "title", text: `Hello ${profile.name}!` }), 0, 25),
    at(h("div", { class: "subtitle", text: "What would you like to do?" }), 0, 62),
  );
  const tiles = [
    ["learn_to_epell.png", () => go("kg-spell")],
    ["eng_alp.png", () => go("kg-alphabet", { language: "en" })],
    ["hindi_alp.png", () => go("kg-alphabet", { language: "hi" })],
    ["numbers.png", () => go("kg-numbers", {})],
    ["order.png", () => go("kg-order")],
    ["story.png", () => go("kg-stories")],
  ];
  tiles.forEach(([file, open], i) => {
    const tile = h("div", { class: "kg-tile tap" }, h("img", { src: KG + file, alt: "" }));
    tile.addEventListener("click", open);
    screen.appendChild(at(tile, [31, 281, 531][i % 3], i < 3 ? 91 : 247));
  });
  const buttons = [
    ["Test yourself", "See what you have learned", "#0EA5E9", "#fff", 30, 195, () => go("kg-test")],
    ["Workbook", "Match, add, colour and more", "#F97316", "#fff", 236, 195, () => go("workbook")],
    ["My dashboard", null, "#4F46E5", "#fff", 446, 161, () => go("dashboard", { back: "kg" })],
    ["Switch user", null, "#E8EAF6", "#1E2233", 622, 149, () => go("picker")],
  ];
  for (const [label, sub, bg, ink, x, w, onclick] of buttons) {
    const btn = h("button", { class: "pill-btn", onclick, style: { background: bg, color: ink, fontSize: sub ? "17px" : "15px" } },
      label, sub ? h("small", { text: sub }) : null);
    screen.appendChild(at(btn, x, 406, w, 52));
  }
  if (greet) say(`Hello ${profile.name}! What would you like to do?`, "warm");
}

// ---------------------------------------------------------------------------
// Alphabets (show_kg_alphabet)
// ---------------------------------------------------------------------------

export function alphabet({ language = "en", index = 0 } = {}) {
  const token = newScreen();
  kgContent().then((kg) => {
    if (stale(token)) return;
    const bank = language === "hi" ? kg.hindi : kg.english;
    index = Math.max(0, Math.min(index, bank.length - 1));
    const entry = bank[index];
    const { screen, mascot } = classroom(language === "hi" ? "हिंदी अक्षर" : "English Alphabets",
      `${index + 1} of ${bank.length}`, { mascot: true });
    note("letters", entry.letter, {
      detail: `${language === "hi" ? "हिंदी" : "English"} letter ${entry.letter}, as in ${entry.word}` });
    askButton(screen, ASK_BOX, mascot);
    const card = [405, 140, 780, 336];
    glassCard(screen, card);
    const hasPicture = Boolean(entry.picture);
    const mid = (card[0] + card[2]) / 2;
    const letterX = hasPicture ? card[0] + 92 : mid;
    text(screen, letterX, entry.roman ? 206 : 214, entry.letter, 56, { bold: true, colour: CLASS_BLUE });
    if (entry.roman) text(screen, letterX, 252, `(${entry.roman})`, 10, { colour: "#3F5C8C" });
    if (hasPicture) emoji(screen, entry.picture, card[0] + 268, 210, 116);
    roundRect(screen, [card[0] + 30, 281, card[2] - 30, 284], 1, "#FFFFFF");
    text(screen, mid, 308, entry.word.toUpperCase(), 19, { bold: true, colour: CLASS_BLUE });

    const sayIt = () => {
      if (language === "hi") sayMany([[`${entry.letter}।`, "curious"], [`${entry.letter} से ${entry.word}।`, "warm"]], mascot);
      else sayMany([[`${entry.sound}.`, "curious"], [`${entry.sound} for ${entry.spoken || entry.word}.`, "warm"]], mascot);
    };
    floor(screen, ROW4[0], "Back", () => go("kg", {}), { arrow: "left" });
    if (index > 0) floor(screen, ROW4[1], "Previous", () => go("kg-alphabet", { language, index: index - 1 }));
    floor(screen, ROW4[2], "Say it again", sayIt, { primary: true });
    if (index < bank.length - 1) floor(screen, ROW4[3], "Next", () => go("kg-alphabet", { language, index: index + 1 }), { arrow: "right" });
    else floor(screen, ROW4[3], "Start again", () => go("kg-alphabet", { language, index: 0 }), { arrow: "right", pt: 11 });
    sayIt();
  }).catch((err) => toast(err.message));
}

// ---------------------------------------------------------------------------
// Counting (show_kg_counting)
// ---------------------------------------------------------------------------

export function numbers({ value = 1, grew = false } = {}) {
  const token = newScreen();
  kgContent().then((kg) => {
    if (stale(token)) return;
    const max = kg.count_max;
    const n = Math.max(1, Math.min(value, max));
    grew = Boolean(grew) && n > 1;
    const name = (k) => kg.number_names[k] || String(k);
    const english = name(n);
    const { screen, mascot } = classroom("Counting", `${n} of ${max}`, { mascot: true });
    if (n % 5 === 0) note("counting", `Counted to ${n}`, { detail: `Counted all the way up to ${english.toLowerCase()}` });
    askButton(screen, ASK_BOX, mascot);
    const perRow = n <= 10 ? 5 : 7;
    const size = n <= 10 ? 38 : 28;
    const gap = n <= 10 ? 9 : 6;
    const rows = n <= 20 ? Math.ceil(n / perRow) : 0;
    const applesTop = grew ? 274 : 258;
    const cardLow = rows ? applesTop + rows * size + (rows - 1) * 7 + 16 : 276;
    const card = [400, 140, 784, Math.min(388, cardLow)];
    glassCard(screen, card);
    const mid = (card[0] + card[2]) / 2;
    text(screen, mid, 186, String(n), 50, { bold: true, colour: COUNT_GREEN });
    text(screen, mid, 232, english, 18, { bold: true, colour: COUNT_GREEN });
    if (grew) text(screen, mid, 260, `${n - 1}   and 1 more   makes   ${n}`, 12, { bold: true, colour: "#92400E" });
    let index = 0;
    for (let r = 0; r < rows; r++) {
      const count = Math.min(perRow, n - r * perRow);
      const total = count * size + (count - 1) * gap;
      let x = mid - total / 2 + size / 2;
      const y = applesTop + size / 2 + r * (size + 7);
      for (let k = 0; k < count; k++) {
        index += 1;
        if (grew && index === n) ring(screen, x, y, size / 2 + 5, "#B45309");
        emoji(screen, kg.count_emoji, x, y, size);
        x += size + gap;
      }
    }
    const sayIt = () => sayNumber(n, grew, name, mascot);
    floor(screen, ROW4[0], "Back", () => go("kg", {}), { arrow: "left" });
    if (n > 1) floor(screen, ROW4[1], "Previous", () => go("kg-numbers", { value: n - 1 }));
    floor(screen, ROW4[2], "Say it again", sayIt, { primary: true });
    if (n >= max) floor(screen, ROW4[3], "Start again", () => go("kg-numbers", { value: 1 }), { arrow: "right", pt: 11 });
    else floor(screen, ROW4[3], "Next", () => (n % kg.count_block === 0
      ? milestone(n, name) : go("kg-numbers", { value: n + 1, grew: true })), { arrow: "right" });
    sayIt();
  }).catch((err) => toast(err.message));
}

function sayNumber(n, grew, name, mascot) {
  const english = name(n).toLowerCase();
  if (n === 1) return sayMany([["One.", "excited"], ["Here is one apple.", "warm"], ["Just one!", "curious"]], mascot);
  if (!grew) {
    const lines = [[`${english[0].toUpperCase()}${english.slice(1)}.`, "excited"]];
    if (n <= 20) lines.push([`There are ${english} apples.`, "warm"]);
    return sayMany(lines, mascot);
  }
  const previous = name(n - 1).toLowerCase();
  const cap = `${previous[0].toUpperCase()}${previous.slice(1)}`;
  if (n <= 20) {
    const was = n - 1 === 1 ? "was" : "were";
    const thing = n - 1 === 1 ? "apple" : "apples";
    return sayMany([[`There ${was} ${previous} ${thing}.`, "curious"], ["Now we add one more apple.", "encouraging"],
      [`${cap}, and one more, makes ${english}.`, "storyteller"], [`So now there are ${english} apples!`, "excited"]], mascot);
  }
  return sayMany([[`We had ${previous}.`, "curious"], ["And one more.", "encouraging"],
    [`${cap}, and one more, makes ${english}.`, "excited"]], mascot);
}

function milestone(n, name) {
  newScreen();
  stage.replaceChildren();
  const { screen } = classroom(`You counted to ${n}!`, "Shall we keep going?");
  text(screen, BOARD_MID, 162, "⭐", 46, { bold: true, colour: CHALK_WARM });
  text(screen, BOARD_MID, 220, `That is all the way to ${name(n).toLowerCase()}.`, 13, { colour: CHALK, width: 366 });
  floor(screen, ROW4[1], "That's enough", () => go("kg", {}), { arrow: "left", pt: 11 });
  floor(screen, ROW4[2], "Yes, keep going!", () => go("kg-numbers", { value: n + 1, grew: true }), { primary: true, pt: 11 });
  sayMany([[`Wow! You counted all the way to ${n}!`, "excited"], ["Shall we keep going?", "curious"]]);
}

// ---------------------------------------------------------------------------
// A to Z (show_kg_order)
// ---------------------------------------------------------------------------

export function order() {
  kgContent().then((kg) => {
    const letters = kg.english.map((e) => e.letter);
    const start = Math.floor(Math.random() * (letters.length - 5 + 1));
    const target = letters.slice(start, start + 5);
    let pool = [...target];
    for (let i = 0; i < 10; i++) { pool = shuffle(pool); if (pool.join() !== target.join()) break; }
    const sound = (c) => (kg.english.find((e) => e.letter === c) || {}).sound || c;
    const run = { target, pool, picked: [], done: false };
    const token = newScreen();
    const draw = () => {
      stage.replaceChildren();
      const { screen } = classroom("A to Z", "Tap the letters in the right order");
      let x = rowX(target.length, 66);
      target.forEach((_, i) => {
        roundRect(screen, [x, 128, x + 66, 184], 12, "#FFFFFF");
        text(screen, x + 33, 156, run.picked[i] || "", 26, { bold: true, colour: CLASS_BLUE });
        x += 66 + 12;
      });
      if (run.done) {
        text(screen, BOARD_MID, 218, "Perfect!  A to Z!", 17, { bold: true, colour: CHALK_WARM });
      } else {
        const remaining = run.pool.filter((c) => !run.picked.includes(c));
        let tx = rowX(remaining.length, 58);
        for (const letter of remaining) {
          button(screen, [tx, 196, tx + 58, 244], letter, () => tap(letter), { fill: "#FFFFFF", ink: CLASS_INK, radius: 12, pt: 22 });
          tx += 58 + 12;
        }
      }
      floor(screen, ROW3[0], "Back", () => go("kg", {}), { arrow: "left" });
      floor(screen, ROW3[1], "Start over", () => { run.picked = []; run.done = false; draw(); }, { primary: true });
      floor(screen, ROW3[2], "New letters", () => go("kg-order"), { arrow: "right" });
    };
    const tap = (letter) => {
      const expected = target[run.picked.length];
      if (letter !== expected) {
        sayMany([["Not that one.", "gentle"], [run.picked.length
          ? `After ${sound(run.picked[run.picked.length - 1])}, comes ${sound(expected)}.`
          : `${sound(expected)} comes first.`, "curious"]]);
        return;
      }
      run.picked.push(letter);
      if (run.picked.length < target.length) { draw(); say(`${sound(letter)}.`, "curious"); return; }
      run.done = true;
      note("order", target.join(""), { detail: "Put the letters in order", score: 1, out_of: 1 });
      draw();
      confetti();
      sayMany([[pick(kg.praise.en), "proud"], [target.map(sound).join(" ") + ".", "excited"]]);
      afterSpeaking(token, () => go("kg-order"), 900);
    };
    draw();
    sayMany([["Put the letters in order!", "encouraging"], ["Tap them from A to Z.", "curious"]]);
  }).catch((err) => toast(err.message));
}

// ---------------------------------------------------------------------------
// Spell a word: SAY the letters, then WRITE them (show_kg_spelling)
// ---------------------------------------------------------------------------

export function spell() {
  const token = newScreen();
  kgContent().then(async (kg) => {
    if (stale(token)) return;
    const choices = kg.spelling.filter((w) => !SEEN_WORDS.has(w.word));
    const entry = pick(choices.length ? choices : kg.spelling);
    SEEN_WORDS.add(entry.word);
    if (SEEN_WORDS.size >= kg.spelling.length) SEEN_WORDS.clear();
    const word = entry.word;
    const spoken = async (w) => (await check("spell_out_spoken", w).catch(() => ({ text: w.split("").join(", ") }))).text;
    const run = { stage: "say", typed: "", feedback: "", heard: "", listening: false, tries: 0, unheard: 0 };

    const draw = () => {
      if (stale(token)) return;
      stage.replaceChildren();
      const subtitle = run.stage === "say"
        ? (run.listening ? (run.tries ? "Listening... say the letters again" : "Listening... say the letters") : entry.hint)
        : `Now write it:  ${entry.hint}`;
      const { screen } = classroom("Spell a Word", subtitle);
      if (run.stage === "say") {
        const upper = word.toUpperCase();
        text(screen, BOARD_MID, 152, upper, 36, { bold: true, colour: CHALK });
        text(screen, BOARD_MID, 194, upper.split("").join("  "), 14, { bold: true, colour: CHALK_DIM });
        if (run.listening) text(screen, BOARD_MID, 226, "I'm listening...", 14, { bold: true, colour: CHALK_WARM });
        else if (run.feedback) text(screen, BOARD_MID, 226, run.feedback, 14, { bold: true, colour: CHALK_WARM });
        if (run.heard) text(screen, BOARD_MID, 250, `I heard:  ${run.heard.split("").join("  ")}`, 10, { colour: CHALK_DIM });
        floor(screen, ROW3[0], "Back", () => go("kg", {}), { arrow: "left" });
        floor(screen, ROW3[1], "Write it", toWriting, { primary: true });
        floor(screen, ROW3[2], "Say it again", repeatWord, { arrow: "right" });
        return;
      }
      let x = rowX(word.length, 62);
      for (let i = 0; i < word.length; i++) {
        roundRect(screen, [x, 140, x + 62, 198], 12, "#FFFFFF");
        text(screen, x + 31, 169, (run.typed[i] || "").toUpperCase(), 24, { bold: true, colour: CLASS_BLUE });
        x += 62 + 12;
      }
      if (run.feedback) text(screen, BOARD_MID, 226, run.feedback, 14, { bold: true, colour: CHALK_WARM });
      ["ABCDEFGHIJKLM", "NOPQRSTUVWXYZ"].forEach((row, r) => {
        const width = 54, gap = 4;
        let kx = (800 - (row.length * width + (row.length - 1) * gap)) / 2;
        for (const letter of row) {
          button(screen, [kx, 276 + r * 56, kx + width, 326 + r * 56], letter, () => typeLetter(letter),
            { fill: "#FFFFFF", ink: CLASS_INK, radius: 10, pt: 16 });
          kx += width + gap;
        }
      });
      floor(screen, ROW4[0], "Back", () => go("kg", {}), { arrow: "left" });
      floor(screen, ROW4[1], "Undo", () => { run.typed = run.typed.slice(0, -1); run.feedback = ""; draw(); });
      floor(screen, ROW4[2], "Say it again", () => say(`${word}. ${entry.hint}.`), { primary: true });
      floor(screen, ROW4[3], "Next word", () => go("kg-spell"), { arrow: "right", pt: 11 });
    };

    const listen = async () => {
      if (stale(token) || run.stage !== "say") return;
      run.listening = true; draw();
      const heard = await hear({ startS: 10, phraseS: 22, endS: 2.2, language: "en", seed: "letters" });
      if (stale(token) || run.stage !== "say") return;
      run.listening = false;
      judge(heard);
    };
    const listenAgain = () => afterSpeaking(token, listen);

    const judge = async (heard) => {
      const { verdict, letters } = await check("heard_spelling", heard, word);
      if (stale(token) || run.stage !== "say") return;
      run.heard = (letters || "").toUpperCase();
      const toWrite = () => setTimeout(() => { if (!stale(token)) toWriting(); }, 300);
      if (verdict === "correct") {
        const praise = pick(kg.praise.en);
        run.feedback = praise; draw();
        sayMany([[praise, "proud"], ["Now write it.", "encouraging"]]);
        return toWrite();
      }
      if (verdict === "unclear") {
        run.unheard += 1;
        if (run.unheard >= 3) {
          run.feedback = "Let's write it together."; draw();
          sayMany([["Let's write it together.", "warm"], [`${word} is ${await spoken(word)}`, "curious"], ["Now you write it.", "encouraging"]]);
          return toWrite();
        }
        run.feedback = "I didn't hear you. Have another go!"; draw();
        sayMany([["I didn't quite catch that.", "gentle"], [`The word is ${word}.`, "warm"], ["Say the letters for me.", "encouraging"]]);
        return listenAgain();
      }
      run.unheard = 0;
      run.tries += 1;
      const tries = run.tries;
      if (verdict === "near" && tries >= 2) {
        const praise = pick(kg.praise.en);
        run.feedback = praise; draw();
        sayMany([[praise, "proud"], ["Now write it.", "encouraging"]]);
        return toWrite();
      }
      if (verdict === "said_the_word" && tries === 1) {
        run.feedback = "Yes! Now the letters."; draw();
        sayMany([[`Yes, the word is ${word}.`, "warm"], ["Now say the letters, one by one.", "encouraging"]]);
      } else if (verdict === "jumbled") {
        run.feedback = "Right letters, wrong order! Try again."; draw();
        sayMany([["Ooh, so close!", "encouraging"], [`You said ${await spoken(letters)}`, "gentle"],
          ["You have all the right letters, but they are in a different order.", "gentle"],
          [`Listen. ${word} is ${await spoken(word)}`, "curious"], ["Now you say it.", "encouraging"]]);
      } else if (tries === 1) {
        const nudge = pick(kg.praise.encourage);
        run.feedback = `${nudge} Try again.`; draw();
        sayMany([[nudge, "encouraging"], [`You said ${await spoken(letters)}`, "gentle"],
          [`But ${word} is ${await spoken(word)}`, "curious"], ["Now you say it.", "encouraging"]]);
      } else if (tries === 2) {
        run.feedback = "Say it after me!"; draw();
        sayMany([["Not yet. Let me help you.", "gentle"], [`Look at the letters on the screen. ${word}.`, "curious"],
          [await spoken(word), "storyteller"], ["Now you say it, just like that.", "encouraging"]]);
      } else {
        run.feedback = "Let's say it together!"; draw();
        sayMany([["Let's say it together.", "warm"], [`${word}.`, "excited"], [await spoken(word), "storyteller"],
          ["Your turn. Say the letters.", "encouraging"]]);
      }
      listenAgain();
    };

    const repeatWord = () => {
      sayMany([[`${word}.`, "excited"], [`${entry.hint}.`, "gentle"], ["Say the letters out loud.", "curious"]]);
      listenAgain();
    };
    const toWriting = () => {
      if (stale(token)) return;
      listener.cancel();
      run.stage = "write"; run.typed = ""; draw();
    };
    const typeLetter = async (letter) => {
      if (run.typed.length >= word.length) return;
      run.typed += letter.toLowerCase();
      if (run.typed.length < word.length) { run.feedback = ""; draw(); return; }
      if (run.typed === word) {
        const praise = pick(kg.praise.en);
        note("spelling", word, { detail: `Spelled ${word} correctly`, score: 1, out_of: 1 });
        run.feedback = praise; draw();
        confetti();
        say(`${praise} ${word}. ${await spoken(word)}`);
        afterSpeaking(token, () => go("kg-spell"), 900);
      } else {
        const nudge = pick(kg.praise.encourage);
        note("spelling", word, { detail: `Still learning to spell ${word}`, score: 0, out_of: 1 });
        run.feedback = nudge; run.typed = ""; draw();
        say(`${nudge} ${word} is spelled ${await spoken(word)}. Now you try. ${word}.`);
      }
    };

    draw();
    sayMany([["Spell this word.", "encouraging"], [`${word}.`, "excited"], [`${entry.hint}.`, "gentle"],
      ["Say the letters out loud.", "curious"]]);
    afterSpeaking(token, listen);
  }).catch((err) => toast(err.message));
}

// ---------------------------------------------------------------------------
// Story time (show_kg_story_picker / _list / show_kg_story)
// ---------------------------------------------------------------------------

function bookGlyph(parent, cx, cy) {
  const svg = `<svg width="190" height="64" viewBox="-95 -30 190 64" style="position:absolute;left:${cx - 95}px;top:${cy - 30}px;pointer-events:none">
    <polygon points="0,-26 -88,-16 -88,30 0,22" fill="#fff"/><polygon points="0,-26 88,-16 88,30 0,22" fill="#fff"/>
    ${[0, 1, 2].map((r) => `<line x1="-14" y1="${-6 + r * 11}" x2="-72" y2="${-6 + r * 11}" stroke="#F59E0B" stroke-width="3" stroke-linecap="round"/><line x1="14" y1="${-6 + r * 11}" x2="72" y2="${-6 + r * 11}" stroke="#F59E0B" stroke-width="3" stroke-linecap="round"/>`).join("")}
    <line x1="0" y1="-26" x2="0" y2="22" stroke="#F59E0B" stroke-width="3" stroke-linecap="round"/></svg>`;
  parent.insertAdjacentHTML("beforeend", svg);
}

export function stories() {
  newScreen();
  const { screen } = classroom("Story Time", "Which language would you like?");
  const en = button(screen, [110, 226, 390, 378], "English", () => go("kg-story-list", { language: "en" }),
    { fill: "#B45309", pt: 20, radius: 18, sub: "A story in English", labelFrac: 0.68, subFrac: 0.86 });
  bookGlyph(en, 140, 46);
  const hi = button(screen, [410, 226, 690, 378], "हिंदी", () => go("kg-story-list", { language: "hi" }),
    { fill: "#BE185D", pt: 22, radius: 18, sub: "हिंदी में कहानी", labelFrac: 0.68, subFrac: 0.86 });
  bookGlyph(hi, 140, 46);
  floor(screen, ROW3[1], "Back", () => go("kg", {}), { arrow: "left" });
  sayMany([["Would you like a story in English,", "curious"], ["या हिंदी में?", "curious"]]);
}

// A cartoon of each story, played in YouTube's own player (embedding is what
// YouTube allows; nothing is downloaded). Chosen for being animated, 2-7
// minutes, and allowing embedding. A story not here is read by Liza instead.
const STORY_VIDEOS = {
  "The Thirsty Crow": "xkutv64_pWc", "The Lion and the Mouse": "k14YDC1Kn-o",
  "The Ant and the Grasshopper": "_svBrlehmMo", "The Tortoise and the Hare": "GfsGU4L7iTw",
  "The Boy Who Cried Wolf": "q1LZVr8_ptc", "The Little Red Hen": "ZzCBY5bL7vo",
  "The Elephant and the Friends": "04oB8Cz2TxI", "The Two Goats": "jvI1DDxtboo",
  "प्यासा कौआ": "YHpRyQH5dX8", "शेर और चूहा": "DktjJGQXgiY", "कछुआ और खरगोश": "MXRWXXj4alk",
  "चींटी और टिड्डा": "0qSWWZVmlk8", "एकता में बल": "cUeqWwC0_p0", "लालची कुत्ता": "vVmI4uPXw04",
  "सोने के अंडे": "u9FsgT97pjs", "दो बिल्लियाँ और बंदर": "-EkOahAiMGM",
};
let youtube = null;
// YouTube's player script, fetched once -- from the story list already, so a
// tap on a title starts the video without waiting for it.
function youtubeApi() {
  if (!youtube) {
    youtube = new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      tag.onerror = () => { youtube = null; reject(new Error("YouTube did not load")); };
      document.head.appendChild(tag);
    });
  }
  return youtube;
}

export function storyList({ language = "en", page = 0 } = {}) {
  const token = newScreen();
  youtubeApi().catch(() => {});
  kgContent().then((kg) => {
    if (stale(token)) return;
    const titles = kg.stories[language].map((s) => s.title);
    const perPage = 8;
    const pages = Math.max(1, Math.ceil(titles.length / perPage));
    page = ((page % pages) + pages) % pages;
    const showing = titles.slice(page * perPage, (page + 1) * perPage);
    const hindi = language === "hi";
    const { screen } = classroom(hindi ? "कौन सी कहानी?" : "Which story?",
      hindi ? "जो सुननी है उस पर उँगली रखो" : "Tap the one you want");
    showing.forEach((title, i) => {
      const x0 = 40 + (i % 2) * 375;
      const y0 = 150 + Math.floor(i / 2) * 58;
      const colour = STORY_COLOURS[(page * perPage + i) % STORY_COLOURS.length];
      const el = button(screen, [x0, y0, x0 + 345, y0 + 50], title, () => go("kg-story", { language, title }),
        { fill: colour, pt: 14, radius: 14, wrap: true, labelDx: 18 });
      const dot = h("div", { class: "kg-num" });
      Object.assign(dot.style, { left: "8px", top: "11px" });
      el.appendChild(dot);
      text(dot, 14, 14, String(page * perPage + i + 1), 13, { bold: true, colour });
    });
    floor(screen, ROW4[0], "Back", () => go("kg-stories"), { arrow: "left" });
    askButton(screen, ASK_BOX_STORY, null);
    floor(screen, ROW4[2], "Surprise me", () => go("kg-story", { language }), { primary: true, pt: 11 });
    const readTitles = () => sayMany([[hindi ? "मेरे पास ये कहानियाँ हैं।" : "Here are the stories I know.", "warm"],
      ...showing.map((t, i) => [`${i + 1}. ${t}.`, "curious"]),
      [hindi ? "जो सुननी है उसे दबाओ।" : "Tap the one you would like.", "gentle"]]);
    if (pages > 1) floor(screen, ROW4[3], "More stories", () => go("kg-story-list", { language, page: page + 1 }), { arrow: "right", pt: 11 });
    else floor(screen, ROW4[3], "Read titles", readTitles, { pt: 11 });
    // Only asked, as on the device: the titles are read only when "Read titles" is tapped.
    say(hindi ? "कौन सी कहानी सुनोगे?" : "Which story would you like?", "curious");
  }).catch((err) => toast(err.message));
}

export function story({ language = "en", title = null } = {}) {
  const token = newScreen();
  kgContent().then((kg) => {
    if (stale(token)) return;
    const all = kg.stories[language];
    let tale = title ? all.find((s) => s.title === title) : null;
    if (!tale) {
      const fresh = all.filter((s) => !SEEN_STORIES.has(s.title));
      tale = pick(fresh.length ? fresh : all);
    }
    SEEN_STORIES.add(tale.title);
    if (SEEN_STORIES.size >= all.length) SEEN_STORIES.clear();
    const segments = tale.segments;
    const last = segments.length + 1;           // 0 = title, 1..n = beats, n+1 = question
    let line = -1;
    let asked = false;
    let lineStarted = 0;
    // The characters act each line out on the board while it is read.
    const acting = new StoryStage(kg, tale);

    const draw = () => {
      if (stale(token)) return;
      stage.replaceChildren();
      const { screen } = classroom(tale.title, asked ? "What do you think?" : "Listen to the story");
      if (asked) {
        text(screen, BOARD_MID, 186, tale.question, 16, { bold: true, colour: CHALK, width: 366 });
        button(screen, [209, 278, 397, 362], "YES", () => answer(true), { fill: "#0F766E", pt: 20, radius: 20 });
        button(screen, [421, 278, 609, 362], "NO", () => answer(false), { fill: "#BE123C", pt: 20, radius: 20 });
      } else {
        const beat = line - 1;
        // The board is the stage; the words are on a card on the wall below it
        // (ui.py _draw_kg_story since the story stage).
        acting.show(screen, beat, lineStarted, speaker.audio);
        roundRect(screen, [214, 280, 608, 386], 16, "#C9B98F");
        roundRect(screen, [212, 276, 606, 382], 16, "#FFFDF5", "#E7D9B0", 2);
        const previous = segments[beat - 1];
        if (previous) text(screen, BOARD_MID, 292, previous[0], 9, { colour: "#94A3B8", width: 370, maxLines: 1 });
        let [words, tone] = segments[beat] || [tale.title, "storyteller"];
        const [colour, pt] = CARD_TONE[tone] || ["#1E293B", 15];
        text(screen, BOARD_MID, 328, words, pt - 1, { bold: true, colour, width: 372 });
        if (segments.length) {
          const gap = Math.min(12, 360 / Math.max(segments.length, 1));
          let x = BOARD_MID - gap * (segments.length - 1) / 2;
          segments.forEach((_, i) => {
            const done = i <= beat;
            const r = done ? 3.5 : 2.5;
            roundRect(screen, [x - r, 370 - r, x + r, 370 + r], r, done ? "#F59E0B" : "#E2D6B5");
            x += gap;
          });
        }
      }
      floor(screen, ROW4[0], "All stories", () => go("kg-story-list", { language }), { arrow: "left", pt: 11 });
      askButton(screen, ASK_BOX_STORY, null);
      floor(screen, ROW4[2], "Read again", narrate, { primary: true });
      floor(screen, ROW4[3], "Next story", () => go("kg-story", { language }), { arrow: "right", pt: 11 });
    };

    // The captions follow her voice: each line lights as it starts playing.
    function narrate() {
      asked = false; line = -1;
      speaker.stop();
      acting.reset();
      const lines = [[`${tale.title}.`, "storyteller"], ...segments, [tale.question, "curious"]];
      let started = 0;
      speaker.onStart = () => {
        if (stale(token)) return;
        line = started; started += 1;
        lineStarted = performance.now();
        asked = line >= last;
        draw();
      };
      speaker.onIdle = () => {};
      for (const [words, tone] of lines) speaker.say(words, null, tone);
      draw();
    }

    async function answer(saidYes) {
      const correct = saidYes === tale.answer;
      note("story", tale.title, { detail: correct ? "Listened, and answered the question correctly" : "Listened to the whole story" });
      speaker.onStart = () => {};
      if (correct) {
        confetti();
        say(pick(language === "hi" ? kg.praise.story_hi : kg.praise.story), "proud");
      } else {
        const verdict = (await check("story_verdict", tale.title, language).catch(() => ({ text: "" }))).text;
        say(verdict || (language === "hi" ? "कोई बात नहीं।" : "Not quite."), "gentle");
      }
      asked = false; line = segments.length;
      draw();
    }

    // The cartoon when there is one; Liza reads the story if it will not play.
    const videoId = STORY_VIDEOS[tale.title];
    if (videoId) watch(videoId); else narrate();

    function watch(id) {
      speaker.stop();
      stage.replaceChildren();
      const { screen } = classroom(tale.title, language === "hi" ? "कहानी देखो" : "Watch the story");
      const frame = h("div", { class: "story-video" });
      const holder = h("div");
      frame.appendChild(holder);
      screen.appendChild(at(frame, 40, 16, 720, 370));
      let player = null;
      const fallBack = () => { if (!stale(token) && !asked) narrate(); };
      floor(screen, ROW4[0], "All stories", () => go("kg-story-list", { language }), { arrow: "left", pt: 11 });
      askButton(screen, ASK_BOX_STORY, null);
      floor(screen, ROW4[2], "Watch again", () => { if (player) { player.seekTo(0, true); player.playVideo(); } }, { primary: true });
      floor(screen, ROW4[3], "Next story", () => go("kg-story", { language }), { arrow: "right", pt: 11 });
      youtubeApi().then((YT) => {
        if (stale(token)) return;
        player = new YT.Player(holder, {
          videoId: id, width: "100%", height: "100%", host: "https://www.youtube-nocookie.com",
          playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1, controls: 1 },
          events: {
            onReady: (e) => e.target.playVideo(),
            onError: fallBack,
            onStateChange: (e) => {
              // At the end, her question, as after she reads one.
              if (e.data === YT.PlayerState.ENDED && !stale(token)) {
                asked = true; line = last;
                draw();
                say(tale.question, "curious");
              }
            },
          },
        });
      }).catch(fallBack);
    }
  }).catch((err) => toast(err.message));
}

// ---------------------------------------------------------------------------
// Test yourself (show_kg_test_picker / start_kg_test): spoken answers
// ---------------------------------------------------------------------------

export function test() {
  newScreen();
  const { screen } = classroom("Test yourself", "What would you like to be tested on?");
  [["A B C", "English letters", "#1D4ED8", "en"], ["क ख ग", "हिंदी अक्षर", "#BE185D", "hi"],
    ["1 2 3", "Counting", "#047857", "count"]].forEach(([label, sub, colour, kind], i) => {
    const x0 = 35 + i * 250;
    const el = button(screen, [x0, 226, x0 + 230, 378], label, () => runTest(kind),
      { fill: colour, pt: 22, radius: 18, sub, labelFrac: 0.62, subFrac: 0.84 });
    text(el, 115, 42, label.split(" ")[0], 26, { bold: true, colour: "#FFFFFF" });
  });
  floor(screen, ROW3[1], "Back", () => go("kg", {}), { arrow: "left" });
  say("What would you like to be tested on?", "curious");
}

async function runTest(kind) {
  const token = newScreen();
  const kg = await kgContent();
  let questions = [];
  try { questions = (await api.get(`/api/kg/test?kind=${kind}`)).questions; } catch (err) { return toast(err.message); }
  if (stale(token)) return;
  const name = (k) => kg.number_names[k] || String(k);
  const praiseFor = (k) => (k === "count" ? kg.praise.count : k === "hi" ? kg.praise.hi : kg.praise.en);
  const stepPrompt = (step, spoken) => (step < 0
    ? (spoken ? "Now, if we take one apple away, how many will be left?" : "Take one away!  How many now?")
    : (spoken ? "Now, if we add one more apple, how many will there be?" : "And one more!  How many now?"));
  const run = { at: 0, score: 0, stage: "name", note: "", listening: false };
  const q = () => questions[Math.min(run.at, questions.length - 1)];

  const draw = () => {
    if (stale(token)) return;
    stage.replaceChildren();
    const question = q();
    const { screen } = classroom(`Question ${run.at + 1} of ${questions.length}`, null);
    if (question.kind === "count") {
      const second = run.stage === "spell";
      const step = question.step || 1;
      const n = second && step > 0 ? question.value + 1 : question.value;
      const marked = second ? n : 0;
      const size = n <= 7 ? 44 : n <= 10 ? 33 : 30;
      const gap = n <= 7 ? 10 : 6;
      const rows = [];
      for (let r = 0; r < Math.ceil(n / 10); r++) rows.push(Math.min(10, n - r * 10));
      const pitch = size + 6;
      const top = 190 - (rows.length - 1) * pitch / 2;
      let index = 0;
      rows.forEach((count, r) => {
        let x = BOARD_MID - (count * size + (count - 1) * gap) / 2 + size / 2;
        const y = top + r * pitch;
        for (let k = 0; k < count; k++) {
          index += 1;
          if (index === marked && step > 0) ring(screen, x, y, size / 2 + 5, "#F59E0B");
          emoji(screen, kg.count_emoji, x, y, size);
          if (index === marked && step < 0) {
            ring(screen, x, y, size / 2 + 5, "#E11D48");
            const cross = h("div", { class: "kg-cross" });
            Object.assign(cross.style, { left: `${x - size / 2}px`, top: `${y - 2}px`, width: `${size}px` });
            screen.appendChild(cross);
          }
          x += size + gap;
        }
      });
    } else {
      emoji(screen, question.picture, BOARD_MID, 188, 112);
    }
    const prompt = run.stage === "name"
      ? ({ count: "Count them out loud.  How many?", hi: "यह क्या है?" }[question.kind] || "What is this?")
      : ({ count: stepPrompt(question.step || 1, false), hi: "किस अक्षर से शुरू होता है?" }[question.kind] || "Now spell it");
    const status = run.listening || run.note;
    glassCard(screen, [150, 276, 650, status ? 352 : 326], 18);
    text(screen, 400, 300, prompt, 16, { bold: true, colour: CLASS_BLUE });
    if (run.listening) text(screen, 400, 332, "I'm listening...", 13, { bold: true, colour: "#92400E" });
    else if (run.note) text(screen, 400, 332, run.note, 13, { bold: true, colour: CLASS_BLUE });
    roundRect(screen, ASK_BOX, 24, "#FFFFFF");
    text(screen, (ASK_BOX[0] + ASK_BOX[2]) / 2, (ASK_BOX[1] + ASK_BOX[3]) / 2, `Score ${run.score}`, 12, { bold: true, colour: CLASS_INK });
    floor(screen, ROW3[0], "Stop", () => go("kg", {}), { arrow: "left" });
    floor(screen, ROW3[1], "Say again", repeat, { primary: true });
    floor(screen, ROW3[2], "Skip", () => { listener.cancel(); run.at += 1; askQuestion(); }, { arrow: "right" });
  };

  const budget = (k, spelling) => (k === "count" ? [12, 45, 3] : spelling && k === "en" ? [10, 22, 2.2] : [8, 8, 1.4]);
  const listen = async () => {
    if (stale(token)) return;
    run.listening = true; draw();
    const question = q();
    const spelling = run.stage === "spell";
    const [startS, phraseS, endS] = budget(question.kind, spelling);
    const heard = await hear({ startS, phraseS, endS, language: question.kind === "hi" ? "hi" : "en",
      seed: spelling && question.kind === "en" ? "letters" : "" });
    if (stale(token)) return;
    run.listening = false;
    judge(heard);
  };

  const askQuestion = () => {
    if (run.at >= questions.length) return finish();
    run.stage = "name"; run.note = ""; run.listening = false;
    draw();
    const question = q();
    if (question.kind === "count") sayMany([["Count the apples out loud.", "encouraging"], ["How many are there?", "curious"]]);
    else if (question.kind === "hi") sayMany([["यह क्या है?", "curious"]]);
    else sayMany([["What is this?", "curious"]]);
    afterSpeaking(token, listen);
  };

  const repeat = () => {
    const question = q();
    const words = run.stage === "name"
      ? ({ count: "Count the apples out loud. How many are there?", hi: "यह क्या है?" }[question.kind] || "What is this?")
      : ({ count: stepPrompt(question.step || 1, true), hi: "यह किस अक्षर से शुरू होता है?" }[question.kind] || "Now spell it.");
    listener.cancel();
    say(words, "curious");
    afterSpeaking(token, listen);
  };

  const judge = async (heard) => {
    const question = q();
    const k = question.kind;
    if (run.stage === "name") {
      let right, answer;
      if (k === "count") { right = (await check("number_matches", heard, question.value)).right; answer = name(question.value); }
      else { right = (await check("matches_answer", heard, question.word)).right; answer = question.word; }
      if (stale(token)) return;
      let lines;
      if (right && k === "hi") { run.score += 1; run.note = `Yes! ${answer}`; lines = [[pick(praiseFor(k)), "proud"], [`यह ${answer} है।`, "warm"]]; }
      else if (right) { run.score += 1; run.note = `Yes! ${answer}`; lines = [[pick(praiseFor(k)), "proud"], [`It is ${answer}.`, "warm"]]; }
      else if (k === "hi") { run.note = `It is ${answer}`; lines = [["कोई बात नहीं।", "gentle"], [`${heard.trim() ? `तुमने कहा, ${heard}। ` : ""}यह ${answer} है।`, "curious"]]; }
      else { run.note = `It is ${answer}`; lines = [["Not quite.", "gentle"], [`${heard.trim() ? `You said ${heard}. ` : ""}This is ${answer}.`, "curious"]]; }
      run.stage = "spell";
      draw();
      lines.push([{ count: stepPrompt(question.step || 1, true), hi: "यह किस अक्षर से शुरू होता है?" }[k] || `Now spell ${answer}.`, "encouraging"]);
      sayMany(lines);
      afterSpeaking(token, listen);
      return;
    }
    let right, answer, said;
    if (k === "count") {
      const wanted = question.value + (question.step || 1);
      right = (await check("number_matches", heard, wanted)).right; answer = name(wanted); said = answer;
    } else if (k === "hi") {
      right = (heard || "").includes(question.letter); answer = question.letter; said = answer;
    } else {
      const target = (await check("spelling_target", question.word)).text;
      right = (await check("heard_spelling", heard, target)).verdict === "correct";
      answer = (await check("spell_out", question.word)).text;
      said = (await check("spell_out_spoken", question.word)).text;
    }
    if (stale(token)) return;
    let lines;
    if (right) { run.score += 1; run.note = "Correct!"; lines = [[pick(praiseFor(k)), "proud"]]; }
    else if (k === "hi") { run.note = `It is ${answer}`; lines = [["कोई बात नहीं।", "gentle"], [`यह ${answer} से शुरू होता है।`, "curious"]]; }
    else { run.note = `It is ${answer}`; lines = [["Not quite.", "gentle"], [`It is ${said}`, "curious"]]; }
    draw();
    sayMany(lines);
    afterSpeaking(token, () => { run.at += 1; askQuestion(); }, 700);
  };

  const finish = () => {
    newScreen();
    stage.replaceChildren();
    const total = questions.length * 2;
    const share = total ? run.score / total : 0;
    const { screen } = classroom("All done!", `You scored ${run.score} out of ${total}`);
    emoji(screen, share >= 0.8 ? "🌟" : "👏", BOARD_MID, 166, 84);
    const [message, tone] = share >= 0.8 ? ["Brilliant! You really know these.", "excited"]
      : share >= 0.5 ? ["Well done! Keep practising.", "encouraging"] : ["Good try! Let's learn some more together.", "warm"];
    text(screen, BOARD_MID, 230, message, 15, { bold: true, colour: CHALK, width: 366 });
    floor(screen, ROW4[1], "Back", () => go("kg", {}), { arrow: "left" });
    floor(screen, ROW4[2], "Try again", () => runTest(kind), { primary: true });
    if (share >= 0.8) confetti();
    sayMany([[`You scored ${run.score} out of ${total}!`, "excited"], [message, tone]]);
    note("test", { en: "English letters", hi: "हिंदी अक्षर", count: "Counting" }[kind], { score: run.score, out_of: total });
  };

  askQuestion();
}
