// The KG Workbook (kg_workbook.py): a notebook of ten pages in the classroom.
// Page content follows the device: five questions a page, answers next to
// the right one, never a nought, never the first letter of a word left out.

import { go } from "../nav.js";
import { at, confetti, h, pick, randint, shuffle, stage, toast } from "../ui.js";
import { kgContent, progress } from "../state.js";
import { speaker } from "../voice.js";

const QUESTIONS = 5;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];
const CRAYONS = [["Red", "#EF4444"], ["Orange", "#F97316"], ["Yellow", "#FACC15"], ["Green", "#22C55E"],
  ["Blue", "#3B82F6"], ["Purple", "#A855F7"], ["Pink", "#F472B6"], ["Brown", "#92400E"]];
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
// The word banks are kg_workbook's own, from data/kg.json (filled in by page()).
let COUNTERS = [], BODY_PARTS = [], BODY_USES = {}, BODY_NEAR = {}, SPELLING_TOPICS = {};
let MATCH_MODES = ["picture"], ALPHABET_WORDS = {};
const PAGES = [
  ["Match A B C", "Letters & pictures", "🍎", "#2563EB", "en_match"],
  ["अक्षर मिलाओ", "अक्षर और तस्वीर", "🦉", "#DB2777", "hi_match"],
  ["Add", "2 + 3 = ?", "🎈", "#059669", "add"],
  ["Take away", "5 - 2 = ?", "🐟", "#D97706", "take"],
  ["Colouring", "Fill in the colours", "🖍️", "#E11D48", "colour"],
  ["Days of the week", "Monday to Sunday", "📅", "#7C3AED", "days"],
  ["Months", "January to December", "🗓️", "#0EA5E9", "months"],
  ["Missing numbers", "1, 2, ?, 4", "🔢", "#4F46E5", "missing"],
  ["Body parts", "Eyes, ears, nose...", "👃", "#0D9488", "body"],
  ["Spell it", "Fill in the letters", "✏️", "#9333EA", "spell"],
];
const LINE_COLOURS = ["#EF4444", "#22C55E", "#3B82F6", "#A855F7", "#F97316"];
// The pills under the notebook.
const ROW4 = [[24, 186], [204, 366], [430, 596], [614, 776]];
const ROW3 = [[44, 204], [320, 480], [596, 756]];

const say = (text) => speaker.say(text);

// kg_workbook.fresh_sample: `count` items, steering away from the ones shown
// lately (half the pool by default), so a new page is not the page before it.
const recent = {};
export function freshSample(kind, pool, count, key = (item) => item, memory = null) {
  pool = [...pool];
  count = Math.min(count, pool.length);
  if (memory === null) memory = Math.max(0, Math.floor(pool.length / 2));
  const seen = (recent[kind] = recent[kind] || []);
  const fresh = shuffle(pool.filter((item) => !seen.includes(key(item))));
  const stale = pool.filter((item) => seen.includes(key(item)))
    .sort((a, b) => seen.indexOf(key(a)) - seen.indexOf(key(b)));
  const picked = [...fresh, ...stale].slice(0, count);
  for (const item of picked) {
    const k = key(item);
    if (seen.includes(k)) seen.splice(seen.indexOf(k), 1);
    seen.push(k);
  }
  if (memory) seen.splice(0, Math.max(0, seen.length - memory)); else seen.length = 0;
  return shuffle(picked);
}

// key -> [colour, picture]: the badge each page wears in its corner.
const PAGE_STYLE = () => Object.fromEntries(PAGES.map(([, , picture, colour, key]) => [key, [colour, picture]]));

// The page's colour and picture in a disc at the top left, so the child sees
// which page they are on without reading; and a row of dots at the top right
// for how far they have got (_wbk_page / _wbk_dots).
function decorate(screen, accent, badge) {
  if (!accent) return () => {};
  const disc = h("div", { class: "wb-badge", style: { background: accent } }, h("span", { text: badge || "" }));
  screen.appendChild(at(disc, 38, 22, 50, 50));
  const dots = h("div", { class: "wb-dots" });
  screen.appendChild(dots);
  return (done, current, total) => {
    dots.replaceChildren();
    const gap = 22;
    let x = 750 - (total - 1) * gap;
    for (let i = 0; i < total; i++, x += gap) {
      const d = h("div", { class: i < done ? "wb-dot done" : i === current ? "wb-dot now" : "wb-dot",
        text: i < done ? "✓" : "" });
      if (i === current && i >= done) d.style.background = accent;
      dots.appendChild(at(d, x - 9, 38, 18, 18));
    }
  };
}

// A burst of confetti out of (x, y) on the stage when an answer is right.
function cheer(x, y, count = 10, reach = 70) {
  const colours = ["#F59E0B", "#22C55E", "#3B82F6", "#EC4899", "#A855F7"];
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count + (Math.random() - 0.5) * 0.6;
    const r = randint(4, 7), far = (0.7 + Math.random() * 0.3) * reach;
    const bit = h("div", { class: "wb-bit", style: { background: colours[i % colours.length], width: `${2 * r}px`, height: `${2 * r}px` } });
    stage.appendChild(at(bit, x - r, y - r));
    bit.animate([{ transform: "translate(0,0) scale(1)", opacity: 1 },
      { transform: `translate(${Math.cos(angle) * far}px,${Math.sin(angle) * far + 30}px) scale(.4)`, opacity: 0.9 }],
    { duration: 420, easing: "cubic-bezier(.2,.7,.4,1)" }).onfinish = () => bit.remove();
  }
}

// A soft red ring where a wrong answer was tapped: "not that one", not "bad".
function oops(x, y) {
  const ring = h("div", { class: "wb-oops" });
  stage.appendChild(at(ring, x - 10, y - 10, 20, 20));
  ring.animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(5)", opacity: 0 }],
    { duration: 330 }).onfinish = () => ring.remove();
}

// The middle of an element, in stage coordinates.
function centre(el) {
  const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
  const k = 800 / s.width;
  return [(r.left + r.width / 2 - s.left) * k, (r.top + r.height / 2 - s.top) * k];
}

function notebook(title, sub, key = null) {
  const screen = h("div", { class: "screen bg-class" });
  stage.appendChild(screen);
  const paper = h("div", { class: "paper" });
  const rings = h("div", { class: "rings" });
  for (let i = 0; i < 10; i++) rings.appendChild(at(h("div", { class: "ring" }), 36 + i * 70, 0));
  paper.append(rings, h("div", { class: "paper-title", text: title }),
    h("div", { class: "paper-sub", text: sub || "" }), h("div", { class: "paper-rule" }));
  screen.appendChild(paper);
  const [accent, badge] = key ? (PAGE_STYLE()[key] || [key, null]) : [];
  const setProgress = decorate(screen, accent, badge);
  return { screen, paper, setProgress, setSub: (s) => { paper.querySelector(".paper-sub").textContent = s; } };
}

function pill(screen, [x0, x1], label, onclick, { primary = false, arrow = null } = {}) {
  const btn = h("button", { class: `paper-btn${primary ? " primary" : ""}`, onclick });
  if (arrow === "left") btn.appendChild(h("span", { class: "tri-left" }));
  btn.appendChild(h("span", { text: label.toUpperCase() }));
  if (arrow === "right") btn.appendChild(h("span", { class: "tri-right" }));
  screen.appendChild(at(btn, x0, 394, x1 - x0, 48));
  return btn;
}

function options(answer, low, high, count = 3) {
  const near = [];
  for (let n = answer - 3; n <= answer + 3; n++) if (n !== answer && n >= low && n <= high) near.push(n);
  const picks = [answer, ...shuffle(near).sort((a, b) => Math.abs(a - answer) - Math.abs(b - answer)).slice(0, count - 1)];
  return shuffle(picks);
}

function shake(el) {
  el.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" },
    { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 260 });
}

function pageDone(screen, topic, detail, score, outOf, again) {
  confetti();
  cheer(398, 170, 18, 180);
  setTimeout(() => cheer(250, 200), 450);
  setTimeout(() => cheer(546, 200), 800);
  speaker.stop();
  say("You finished the page!");
  say(score === outOf ? "Every one right. Brilliant!" : "Well done!");
  progress("workbook", topic, { detail, score, out_of: outOf });
  pill(screen, ROW3[1], "Do it again", again, { primary: true });
}

// ---------------------------------------------------------------------------
// The cover
// ---------------------------------------------------------------------------

export function cover() {
  const { screen, paper } = notebook("My Workbook", "Pick a page to do");
  decorate(screen, "#F97316", "📒");
  PAGES.forEach(([title, sub, emoji, colour, key], i) => {
    const tile = h("div", { class: "wb-tile", style: { background: colour } },
      h("div", { class: "disc", text: emoji }),
      h("div", { class: "t", text: title }),
      h("div", { class: "s", text: sub }));
    tile.addEventListener("click", () => go("wb-page", { key }));
    paper.appendChild(at(tile, 15 + (i % 5) * 148, 77 + Math.floor(i / 5) * 146));
  });
  pill(screen, ROW3[0], "Back", () => go("kg", {}), { arrow: "left" });
  say("Here is your workbook! Pick a page.");
}

export function page({ key, index = null }) {
  const pages = { en_match: () => match("en"), hi_match: () => match("hi"), add: () => sums(false),
    take: () => sums(true), colour: () => colouring(index), days: () => sequence(DAYS, [2, 4], "days"),
    months: () => sequence(MONTHS, [3, 5], "months"), missing: missingNumbers, body, spell: spellTopics };
  let leave = null, gone = false;
  kgContent().then((kg) => {
    if (gone) return;
    const wb = kg.workbook;
    COUNTERS = wb.counters; BODY_PARTS = wb.body_parts; BODY_USES = wb.body_uses; BODY_NEAR = wb.body_near;
    SPELLING_TOPICS = wb.spelling; MATCH_MODES = wb.match_modes; ALPHABET_WORDS = wb.alphabet_words;
    leave = pages[key]();
  }).catch((err) => toast(err.message));
  return () => { gone = true; if (typeof leave === "function") leave(); };
}

// ---------------------------------------------------------------------------
// Match A B C / अक्षर मिलाओ: tap a letter, then its picture.
// ---------------------------------------------------------------------------

function match(language) {
  kgContent().then((kg) => {
    // kg_workbook.match_set: M is monkey on one page and the moon on the next,
    // no two cards share a picture, and one page in four is big and small letters.
    const hindi = language === "hi";
    const mode = hindi ? "picture" : pick(MATCH_MODES);
    const case_ = mode === "case";
    let set;
    if (hindi) {
      set = freshSample("match_hi", kg.hindi.filter((e) => e.picture && !/\.png$/.test(e.picture)), 4, (e) => e.letter);
    } else {
      const byLetter = Object.fromEntries(kg.english.map((e) => [e.letter, e]));
      const used = new Set();
      set = freshSample("match_en", kg.english.map((e) => e.letter), 4).map((letter) => {
        const base = byLetter[letter];
        const choices = (ALPHABET_WORDS[letter] || []).filter(([, p]) => p && !used.has(p));
        if (case_ || !choices.length) return { ...base, word: letter.toLowerCase(), picture: "", spoken: letter.toLowerCase() };
        const [word, picture] = freshSample(`word_${letter}`, choices, 1, (o) => o[0])[0];
        used.add(picture);
        return { ...base, word, picture, spoken: word === base.word ? base.spoken : word };
      });
    }
    // Never the answers straight across: four flat lines would do the page.
    let right = shuffle(set);
    while (set.length > 1 && right.some((e, i) => e === set[i])) right = shuffle(set);
    const title = hindi ? "अक्षर मिलाओ" : case_ ? "Big and Small" : "Match the Letters";
    const { screen, paper, setProgress } = notebook(title, hindi ? "अक्षर को उसकी तस्वीर से जोड़ो"
      : case_ ? "Join each big letter to its small one" : "Join each letter to its picture",
    hindi ? "hi_match" : "en_match");
    setProgress(0, -1, set.length);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    Object.assign(svg.style, { position: "absolute", left: "0", top: "0", width: "762px", height: "372px", pointerEvents: "none" });
    paper.appendChild(svg);
    let picked = null;
    let done = 0;
    let misses = 0;
    const leftCards = set.map((e, i) => {
      const card = h("div", { class: "wb-card", text: hindi || case_ ? e.letter : `${e.letter} ${e.letter.toLowerCase()}`,
        style: { fontSize: "34px" } });
      card.addEventListener("click", () => {
        if (card.classList.contains("done")) return;
        leftCards.forEach((c) => c.classList.remove("picked"));
        card.classList.add("picked");
        picked = { e, card, i };
        speaker.stop();
        say(language === "hi" ? `${e.letter}।` : `${e.sound}.`);
      });
      paper.appendChild(at(card, 150, 76 + i * 72, 100, 62));
      return card;
    });
    right.forEach((e, j) => {
      const card = h("div", { class: "wb-card" });
      if (case_) {
        card.appendChild(h("span", { text: e.word, style: { font: "700 37px var(--font)", color: "#1E293B" } }));
      } else if (/\.png$/i.test(e.picture)) {
        card.appendChild(h("img", { src: `assets/kg/${e.picture.toLowerCase()}`, alt: e.word }));
      } else {
        card.appendChild(h("span", { text: e.picture, style: { fontSize: "40px" } }));
      }
      card.addEventListener("click", () => {
        if (card.classList.contains("done")) return;
        if (!picked) {
          speaker.stop();
          say(language === "hi" ? "पहले एक अक्षर चुनो।" : "Tap a letter first.");
          return;
        }
        if (picked.e.letter === e.letter) {
          const colour = LINE_COLOURS[done % LINE_COLOURS.length];
          picked.card.classList.remove("picked");
          picked.card.classList.add("done");
          card.classList.add("done");
          picked.card.style.borderColor = card.style.borderColor = colour;
          const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
          line.setAttribute("x1", 250); line.setAttribute("y1", 76 + picked.i * 72 + 31);
          line.setAttribute("x2", 510); line.setAttribute("y2", 76 + j * 72 + 31);
          line.setAttribute("stroke", colour); line.setAttribute("stroke-width", 5);
          line.setAttribute("stroke-linecap", "round");
          svg.appendChild(line);
          done += 1;
          setProgress(done, -1, set.length);
          cheer(...centre(card));
          // Once matched, the word appears with the picture: they have just
          // said it, so now they see it written.
          if (!hindi && !case_) card.appendChild(h("div", { class: "wb-word", text: e.word }));
          speaker.stop();
          say(hindi ? `${e.letter} से ${e.word}।` : case_ ? `Big ${e.sound}, small ${e.sound}!`
            : `${e.sound} for ${e.spoken || e.word}!`);
          picked = null;
          if (done === set.length) {
            pageDone(screen, hindi ? "Match letters (Hindi)" : case_ ? "Big and small letters" : "Match letters",
              `Matched ${set.map((x) => (hindi || case_ ? x.letter : `${x.letter}-${x.word}`)).join(", ")}`,
              Math.max(0, set.length - misses), set.length, () => go("wb-page", { key: language === "hi" ? "hi_match" : "en_match" }));
          }
        } else {
          misses += 1;
          card.classList.add("miss");
          setTimeout(() => card.classList.remove("miss"), 500);
          shake(card);
          oops(...centre(card));
          speaker.stop();
          say(hindi ? `यह ${e.word} है। यह ${picked.e.letter} से नहीं होता।`
            : case_ ? `That is small ${e.word}. Find small ${picked.e.sound}.`
              : `That is ${e.spoken || e.word}. Try another one.`);
        }
      });
      paper.appendChild(at(card, 510, 76 + j * 72, 100, 62));
    });
    pill(screen, ROW3[0], "Back", () => go("workbook"), { arrow: "left" });
    pill(screen, ROW3[2], "New letters", () => go("wb-page", { key: language === "hi" ? "hi_match" : "en_match" }), { arrow: "right" });
    say(hindi ? "हर अक्षर को उसकी तस्वीर से मिलाओ।" : case_ ? "Match each big letter with its small letter."
      : "Match each letter with its picture.");
  }).catch((err) => toast(err.message));
}

// ---------------------------------------------------------------------------
// Add / Take away
// ---------------------------------------------------------------------------

function sums(takeAway) {
  const seen = new Set();
  const questions = [];
  while (questions.length < QUESTIONS) {
    const a = takeAway ? randint(2, 9) : randint(1, 5);
    const b = takeAway ? randint(1, a - 1) : randint(1, 5);
    if (seen.has(`${a},${b}`)) continue;
    seen.add(`${a},${b}`);
    const [picture, one, many] = freshSample("counter", COUNTERS, 1, (c) => c[1])[0];
    const answer = takeAway ? a - b : a + b;
    questions.push({ a, b, answer, picture, one, many, options: options(answer, 1, takeAway ? 9 : 10) });
  }
  const title = takeAway ? "Take Away" : "Add Them Up";
  let index = 0;
  let score = 0;
  let firstTry = true;
  const { screen, paper, setSub, setProgress } = notebook(title, "", takeAway ? "take" : "add");
  const area = h("div");
  paper.appendChild(area);
  pill(screen, ROW3[0], "Back", () => go("workbook"), { arrow: "left" });
  pill(screen, ROW3[1], "Say it again", () => { speaker.stop(); ask(); }, { primary: true });
  const next = pill(screen, ROW3[2], "Next", () => { if (index < QUESTIONS - 1) { index += 1; draw(); } }, { arrow: "right" });

  function ask() {
    const q = questions[index];
    const word = (n) => NUMBER_WORDS[n] || String(n);
    if (takeAway) say(`There are ${word(q.a)} ${q.a === 1 ? q.one : q.many}. Take away ${word(q.b)}. How many are left?`);
    else say(`${word(q.a)} ${q.a === 1 ? q.one : q.many} and ${word(q.b)} more. How many altogether?`);
  }

  function draw() {
    const q = questions[index];
    firstTry = true;
    setSub(takeAway ? "How many are left?" : "How many altogether?");
    setProgress(index, index, QUESTIONS);
    area.replaceChildren();
    const size = (n) => (n <= 3 ? 46 : n <= 6 ? 36 : 28);
    const box1 = h("div", { class: "box" });
    for (let i = 0; i < q.a; i++) {
      const crossed = takeAway && i >= q.a - q.b;
      box1.appendChild(h("span", { text: q.picture, style: { fontSize: `${size(q.a)}px`, margin: "2px",
        opacity: crossed ? ".35" : "1", textDecoration: crossed ? "line-through" : "none" } }));
    }
    area.appendChild(at(box1, 22, 78, 241, 148));
    area.appendChild(at(h("div", { class: "sym", text: takeAway ? "−" : "+" }), 266, 128, 54));
    const box2 = h("div", { class: "box" });
    for (let i = 0; i < q.b; i++) {
      box2.appendChild(h("span", { text: takeAway ? "❌" : q.picture, style: { fontSize: `${size(q.b)}px`, margin: "2px" } }));
    }
    area.appendChild(at(box2, 322, 78, 241, 148));
    area.appendChild(at(h("div", { class: "sym", text: "=" }), 566, 128, 54));
    const answerBox = h("div", { class: "box", style: { font: "700 46px var(--font)", color: "#17408B" }, text: "?" });
    area.appendChild(at(answerBox, 622, 98, 121, 108));
    area.appendChild(at(h("div", { class: "sym", text: String(q.a), style: { fontSize: "26px" } }), 22, 234, 241));
    area.appendChild(at(h("div", { class: "sym", text: String(q.b), style: { fontSize: "26px" } }), 322, 234, 241));
    q.options.forEach((option, k) => {
      const btn = h("button", { class: "answer-btn", text: String(option) });
      btn.addEventListener("click", () => {
        if (answerBox.textContent !== "?") return;
        if (option === q.answer) {
          btn.classList.add("right");
          answerBox.textContent = String(q.answer);
          answerBox.style.borderColor = "#16A34A";
          setProgress(index + 1, index, QUESTIONS);
          cheer(...centre(answerBox));
          if (firstTry) score += 1;
          speaker.stop();
          say(`${pick(["Yes!", "That's right!", "Well done!"])} ${NUMBER_WORDS[q.answer] || q.answer}.`);
          if (index === QUESTIONS - 1) {
            pageDone(screen, takeAway ? "Take away" : "Add", `${score} of ${QUESTIONS} right first time`,
              score, QUESTIONS, () => go("wb-page", { key: takeAway ? "take" : "add" }));
          } else {
            setTimeout(() => { if (area.isConnected && questions[index] === q) { index += 1; draw(); } }, 1600);
          }
        } else {
          firstTry = false;
          btn.classList.add("wrong");
          shake(btn);
          oops(...centre(btn));
          speaker.stop();
          say("Not quite. Count them again.");
          setTimeout(() => btn.classList.remove("wrong"), 600);
        }
      });
      area.appendChild(at(btn, 166 + k * 154, 278, 120, 74));
    });
    next.disabled = index >= QUESTIONS - 1;
    ask();
  }
  draw();
}

// ---------------------------------------------------------------------------
// Days of the week / Months: fill the gaps in order.
// ---------------------------------------------------------------------------

function sequence(names, [low, high], key) {
  const holes = shuffle(names.map((_, i) => i)).slice(0, randint(low, high)).sort((a, b) => a - b);
  const tiles = shuffle(holes.map((i) => names[i]));
  const title = key === "days" ? "Days of the Week" : "Months of the Year";
  const { screen, paper, setProgress } = notebook(title, "Tap the missing ones in order", key);
  setProgress(0, 0, holes.length);
  let next = 0;
  let misses = 0;
  const perRow = names.length > 7 ? 6 : 7;
  const w = perRow === 7 ? 98 : 114;
  const slots = names.map((name, i) => {
    const hole = holes.includes(i);
    const slot = h("div", { class: `slot${hole ? "" : " fixed"}`, text: hole ? "?" : name,
      style: { fontSize: perRow === 7 ? "13px" : "14px" } });
    const row = Math.floor(i / perRow);
    paper.appendChild(at(slot, 14 + (i % perRow) * (w + 6), 84 + row * 66, w, 54));
    return slot;
  });
  const highlight = () => slots.forEach((s, i) => { s.style.boxShadow = i === holes[next] ? "0 0 0 3px #F59E0B" : ""; });
  highlight();
  tiles.forEach((name, k) => {
    const tile = h("button", { class: "answer-btn", text: name, style: { fontSize: "15px" } });
    tile.addEventListener("click", () => {
      if (next >= holes.length) return;
      if (name === names[holes[next]]) {
        slots[holes[next]].textContent = name;
        slots[holes[next]].classList.add("filled");
        cheer(...centre(slots[holes[next]]), 8, 50);
        tile.style.visibility = "hidden";
        next += 1;
        setProgress(next, next, holes.length);
        highlight();
        speaker.stop();
        say(`${name}!`);
        if (next === holes.length) {
          say("Well done! Let's say them all.");
          say(names.join(", ") + ".");
          pageDone(screen, title, `Filled in ${holes.map((i) => names[i]).join(", ")}`,
            Math.max(0, holes.length - misses), holes.length, () => go("wb-page", { key }));
        }
      } else {
        misses += 1;
        shake(tile);
        oops(...centre(tile));
        speaker.stop();
        const before = holes[next] > 0 ? names[holes[next] - 1] : null;
        say(before ? `Not that one. What comes after ${before}?` : `Not that one. What comes first?`);
      }
    });
    // Up to five tiles now, so they shrink to fit the page.
    const n = tiles.length, tw = Math.min(150, (700 - (n - 1) * 16) / n);
    paper.appendChild(at(tile, (762 - (n * tw + (n - 1) * 16)) / 2 + k * (tw + 16), perRow === 7 ? 200 : 240, tw, 56));
  });
  pill(screen, ROW3[0], "Back", () => go("workbook"), { arrow: "left" });
  pill(screen, ROW3[2], "New page", () => go("wb-page", { key }), { arrow: "right" });
  say(key === "days" ? "There are seven days in a week. Which ones are missing?"
    : "There are twelve months in a year. Which ones are missing?");
}

// ---------------------------------------------------------------------------
// Missing numbers
// ---------------------------------------------------------------------------

function missingNumbers() {
  const starts = shuffle(Array.from({ length: 15 }, (_, i) => i + 1)).slice(0, QUESTIONS);
  const questions = starts.map((start) => {
    const row = Array.from({ length: 6 }, (_, i) => start + i);
    const gap = randint(1, 4);
    return { row, gap, answer: row[gap], options: options(row[gap], 1, 20) };
  });
  let index = 0;
  let score = 0;
  const { screen, paper, setSub, setProgress } = notebook("Missing Numbers", "", "missing");
  const area = h("div");
  paper.appendChild(area);
  pill(screen, ROW3[0], "Back", () => go("workbook"), { arrow: "left" });
  pill(screen, ROW3[1], "Say it again", () => { speaker.stop(); say("Which number is missing?"); }, { primary: true });

  function draw() {
    const q = questions[index];
    let firstTry = true;
    setSub("Which number is missing?");
    setProgress(index, index, QUESTIONS);
    area.replaceChildren();
    const cells = q.row.map((n, i) => {
      const cell = h("div", { class: `slot${i === q.gap ? "" : " fixed"}`, text: i === q.gap ? "?" : String(n),
        style: { fontSize: "34px", color: "#17408B" } });
      area.appendChild(at(cell, 51 + i * 112, 96, 100, 90));
      return cell;
    });
    q.options.forEach((option, k) => {
      const btn = h("button", { class: "answer-btn", text: String(option) });
      btn.addEventListener("click", () => {
        if (cells[q.gap].textContent !== "?") return;
        if (option === q.answer) {
          btn.classList.add("right");
          cells[q.gap].textContent = String(q.answer);
          cells[q.gap].classList.add("filled");
          setProgress(index + 1, index, QUESTIONS);
          cheer(...centre(cells[q.gap]));
          if (firstTry) score += 1;
          speaker.stop();
          say(`Yes! ${q.row.join(", ")}.`);
          if (index === QUESTIONS - 1) {
            pageDone(screen, "Missing numbers", `${score} of ${QUESTIONS} right first time`, score, QUESTIONS,
              () => go("wb-page", { key: "missing" }));
          } else setTimeout(() => { if (area.isConnected) { index += 1; draw(); } }, 1700);
        } else {
          firstTry = false;
          btn.classList.add("wrong");
          shake(btn);
          oops(...centre(btn));
          speaker.stop();
          say(`Not quite. What comes after ${q.row[q.gap - 1]}?`);
          setTimeout(() => btn.classList.remove("wrong"), 600);
        }
      });
      area.appendChild(at(btn, 166 + k * 154, 236, 120, 74));
    });
    say("Which number is missing?");
  }
  draw();
}

// ---------------------------------------------------------------------------
// Body parts
// ---------------------------------------------------------------------------

function body() {
  const usable = BODY_PARTS.filter((p) => p[0] in BODY_USES);
  const used = freshSample("body_use", usable, 3, (p) => p[0]);
  const found = freshSample("body_find", BODY_PARTS.filter((p) => !used.includes(p)), 2, (p) => p[0]);
  const questions = shuffle([...used.map((p) => [p, "use"]), ...found.map((p) => [p, "find"])]).map(([part, mode]) => {
    // We bite with our teeth, but a child who taps the mouth is not wrong.
    const near = mode === "use" ? (BODY_NEAR[part[0]] || []) : [];
    const others = shuffle(BODY_PARTS.filter((p) => p !== part && !near.includes(p[0]))).slice(0, 3);
    return { part, mode, options: shuffle([...others, part]), use: mode === "use" ? pick(BODY_USES[part[0]]) : null };
  });
  let index = 0;
  let score = 0;
  const { screen, paper, setSub, setProgress } = notebook("My Body", "Tap the right picture", "body");
  const area = h("div");
  paper.appendChild(area);
  const prompt = (q) => (q.mode === "use" ? `What do we ${q.use} with?` : `Tap the ${q.part[0]}.`);
  pill(screen, ROW3[0], "Back", () => go("workbook"), { arrow: "left" });
  pill(screen, ROW3[1], "Say it again", () => { speaker.stop(); say(prompt(questions[index])); }, { primary: true });

  function draw() {
    const q = questions[index];
    let firstTry = true;
    let solved = false;
    setProgress(index, index, QUESTIONS);
    area.replaceChildren(at(h("div", { class: "sym", text: prompt(q),
      style: { fontSize: prompt(q).length < 26 ? "26px" : "22px" } }), 0, 80, 762));
    q.options.forEach((option, k) => {
      const card = h("div", { class: "wb-card", style: { flexDirection: "column" } },
        h("div", { text: option[1], style: { fontSize: "54px", lineHeight: "1.1" } }),
        q.mode === "use" ? h("div", { text: option[0], style: { font: "700 15px var(--font)" } }) : null);
      card.addEventListener("click", () => {
        if (solved) return;
        if (option === q.part) {
          solved = true;
          card.classList.add("done");
          setProgress(index + 1, index, QUESTIONS);
          cheer(...centre(card), 12, 90);
          if (firstTry) score += 1;
          speaker.stop();
          say(q.mode === "use" ? `Yes! We ${q.use} with our ${q.part[0]}.` : `Yes! That is the ${q.part[0]}.`);
          if (index === QUESTIONS - 1) {
            pageDone(screen, "Body parts", `${score} of ${QUESTIONS} right first time`, score, QUESTIONS,
              () => go("wb-page", { key: "body" }));
          } else setTimeout(() => { if (area.isConnected) { index += 1; draw(); } }, 1700);
        } else {
          firstTry = false;
          card.classList.add("miss");
          shake(card);
          oops(...centre(card));
          setTimeout(() => card.classList.remove("miss"), 500);
          speaker.stop();
          say(`That is the ${option[0]}. Try again.`);
        }
      });
      area.appendChild(at(card, 61 + k * 166, 140, 140, 150));
    });
    say(prompt(q));
  }
  draw();
}

// ---------------------------------------------------------------------------
// Spell it: pick a topic, then fill the missing letters.
// ---------------------------------------------------------------------------

function spellTopics() {
  const { screen, paper } = notebook("Spell It", "Pick what to spell", "spell");
  const width = 226, height = 132, gap = 16;
  Object.entries(SPELLING_TOPICS).forEach(([key, [title, emoji, colour, words]], i) => {
    const sample = key === "days" || key === "months" ? words[0][0] : pick(words)[0];
    const tile = h("div", { class: "wb-topic", style: { background: colour } },
      h("div", { class: "disc", text: emoji }), h("div", { class: "t", text: title,
        style: { fontSize: title.length < 9 ? "20px" : "16px" } }),
      h("div", { class: "s", text: `${cap(sample)}...` }));
    tile.addEventListener("click", () => spellPage(key));
    // Stage coordinates (kg_workbook show_wbk_spell_topics), less the paper's offset.
    paper.appendChild(at(tile, 398 - (3 * width + 2 * gap) / 2 + (i % 3) * (width + gap) - 18,
      92 + Math.floor(i / 3) * (height + gap) - 10, width, height));
  });
  pill(screen, ROW3[0], "Back", () => go("workbook"), { arrow: "left" });
  say("Let's spell some words!");
  say("Which one would you like?");
}

function spellPage(topic) {
  stage.replaceChildren();
  const words = freshSample(`spell_${topic}`, SPELLING_TOPICS[topic][3], QUESTIONS, (w) => w[0]);
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const questions = words.map(([word, picture]) => {
    const letters = word.toLowerCase();
    const gaps = letters.length <= 4 ? 1 : letters.length <= 6 ? 2 : 3;
    const holes = shuffle(Array.from({ length: letters.length - 1 }, (_, i) => i + 1)).slice(0, gaps).sort((a, b) => a - b);
    const spare = shuffle([...alphabet].filter((c) => !letters.includes(c))).slice(0, 2);
    return { word, picture, holes, tiles: shuffle([...holes.map((i) => letters[i]), ...spare]) };
  });
  let index = 0;
  let score = 0;
  const { screen, paper, setSub, setProgress } = notebook(`Spell It: ${SPELLING_TOPICS[topic][0]}`, "Fill in the missing letters");
  // This page wears its topic's own colour and picture (kg_workbook _wbk_spell_draw).
  const dots = decorate(screen, SPELLING_TOPICS[topic][2], SPELLING_TOPICS[topic][1]);
  const area = h("div");
  paper.appendChild(area);
  pill(screen, ROW3[0], "Back", () => go("wb-page", { key: "spell" }), { arrow: "left" });
  pill(screen, ROW3[1], "Say it again", () => { speaker.stop(); say(`${cap(questions[index].word)}.`); }, { primary: true });

  function draw() {
    const q = questions[index];
    const letters = q.word.toLowerCase();
    let next = 0;
    let firstTry = true;
    dots(index, index, QUESTIONS);
    area.replaceChildren();
    if (q.picture) area.appendChild(at(h("div", { text: q.picture, style: { fontSize: "70px", textAlign: "center" } }), 0, 74, 762));
    else {
      const names = topic === "days" ? DAYS : MONTHS;
      const pos = names.findIndex((n) => n.toLowerCase() === letters) + 1;
      const label = topic === "days" ? `Day ${pos} of the week` : `Month ${pos} of the year`;
      area.appendChild(at(h("div", { class: "sym", text: label, style: { fontSize: "22px" } }), 0, 96, 762));
    }
    const size = Math.min(56, Math.floor(620 / letters.length) - 6);
    const x0 = (762 - letters.length * (size + 6)) / 2;
    const cells = [...letters].map((ch, i) => {
      const hole = q.holes.includes(i);
      const cell = h("div", { class: `slot${hole ? "" : " fixed"}`, text: hole ? "" : (i === 0 ? ch.toUpperCase() : ch),
        style: { fontSize: "28px", color: "#17408B" } });
      area.appendChild(at(cell, x0 + i * (size + 6), 168, size, 56));
      return cell;
    });
    const mark = () => cells.forEach((c, i) => { c.style.boxShadow = i === q.holes[next] ? "0 0 0 3px #F59E0B" : ""; });
    mark();
    q.tiles.forEach((ch, k) => {
      const tile = h("button", { class: "answer-btn", text: ch, style: { fontSize: "28px" } });
      tile.addEventListener("click", () => {
        if (next >= q.holes.length) return;
        const want = letters[q.holes[next]];
        if (ch === want) {
          cells[q.holes[next]].textContent = ch;
          cells[q.holes[next]].classList.add("filled");
          cheer(...centre(cells[q.holes[next]]), 8, 45);
          tile.style.visibility = "hidden";
          next += 1;
          mark();
          if (next === q.holes.length) {
            dots(index + 1, index, QUESTIONS);
            if (firstTry) score += 1;
            speaker.stop();
            say(`${cap(q.word)}. ${[...letters].join(", ")}.`);
            if (index === QUESTIONS - 1) {
              pageDone(screen, `Spell it: ${SPELLING_TOPICS[topic][0]}`, `${score} of ${QUESTIONS} right first time`,
                score, QUESTIONS, () => spellPage(topic));
            } else setTimeout(() => { if (area.isConnected) { index += 1; draw(); } }, 1900);
          } else {
            speaker.stop();
            say(`${ch}.`);
          }
        } else {
          firstTry = false;
          shake(tile);
          oops(...centre(tile));
          speaker.stop();
          say("Not that one. Listen again.");
          say(`${cap(q.word)}.`);
        }
      });
      const n = q.tiles.length;
      area.appendChild(at(tile, (762 - n * 86) / 2 + k * 86, 252, 72, 64));
    });
    say(`${cap(q.word)}. Fill in the missing letters.`);
  }
  draw();
}

function cap(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// ---------------------------------------------------------------------------
// Colouring: tap a closed area to fill it, as kg_workbook.colouring_page does
// -- the areas are worked out once per picture, so a tap is instant.
// ---------------------------------------------------------------------------

let pictureList = null;

async function pictures() {
  if (!pictureList) pictureList = await fetch("assets/colouring/pictures.json").then((r) => r.json());
  return pictureList;
}

function colouring(index) {
  let alive = true;
  pictures().then((list) => {
    if (!alive) return;
    if (!list.length) return toast("The colouring pictures are missing.");
    if (index === null) index = freshSample("colouring", list.map((_, i) => i), 1)[0];
    index = ((index % list.length) + list.length) % list.length;
    const { name, file } = list[index];
    const { screen, paper } = notebook(`Colour the ${name}`, "Pick a crayon, then tap the picture", "colour");
    let crayon = 0;
    const used = new Set();

    const crayonEls = CRAYONS.map(([cname, colour], i) => {
      const el = h("div", { class: `crayon${i === 0 ? " on" : ""}`, title: cname, style: { background: colour } });
      el.addEventListener("click", () => {
        crayon = i;
        crayonEls.forEach((c, k) => c.classList.toggle("on", k === i));
        speaker.stop();
        say(`${cname}!`);
      });
      paper.appendChild(at(el, 21 + (i % 2) * 62, 76 + Math.floor(i / 2) * 70));
      return el;
    });
    paper.appendChild(at(h("div", { style: { background: "#E7D9B0" } }), 152, 80, 2, 280));

    // The picture area, 168..752 x 70..366 on the paper.
    const W = 584;
    const H = 292;
    const scale = 2;
    const canvas = h("canvas", { id: "colour-canvas" });
    canvas.width = W * scale;
    canvas.height = H * scale;
    at(canvas, 168, 72, W, H);
    paper.appendChild(canvas);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let page = null;

    const image = new Image();
    image.onload = () => {
      if (!alive) return;
      page = analyse(image, canvas.width, canvas.height);
      paint(ctx, page);
    };
    image.src = `assets/colouring/${file}`;

    canvas.addEventListener("pointerdown", (e) => {
      if (!page) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / rect.width * canvas.width);
      const y = Math.floor((e.clientY - rect.top) / rect.height * canvas.height);
      const label = labelNear(page, x, y);
      if (label === null || label === page.outside) return;
      page.fill[label] = hexToRgb(CRAYONS[crayon][1]);
      used.add(CRAYONS[crayon][0]);
      paint(ctx, page);
    });

    pill(screen, ROW4[0], "Back", () => go("workbook"), { arrow: "left" });
    pill(screen, ROW4[1], "Clear", () => {
      if (!page) return;
      page.fill = new Array(page.labels).fill(null);
      used.clear();
      paint(ctx, page);
    });
    pill(screen, ROW4[2], "I'm done", () => {
      speaker.stop();
      if (!used.size) {
        say("Your picture is still empty!");
        say("Pick a crayon and tap the picture.");
        return;
      }
      confetti();
      const colours = [...used].map((c) => c.toLowerCase());
      const list2 = colours.length > 1 ? `${colours.slice(0, -1).join(", ")} and ${colours.at(-1)}` : colours[0];
      say("What a beautiful picture!");
      say(`You used ${list2}.`);
      progress("workbook", "Colouring", { detail: `Coloured the ${name.toLowerCase()} with ${list2}` });
    }, { primary: true });
    pill(screen, ROW4[3], "Next picture", () => go("wb-page", { key: "colour",
      index: freshSample("colouring", list.map((_, i) => i).filter((i) => i !== index), 1)[0] }), { arrow: "right" });
    say(`Let's colour the ${name.toLowerCase()}!`);
    say("Pick a crayon, then tap the picture.");
  }).catch((err) => toast(err.message));
  return () => { alive = false; };
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// The picture as a label map: 1 on the lines, one number per closed area.
function analyse(image, width, height) {
  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  const octx = off.getContext("2d", { willReadFrequently: true });
  octx.fillStyle = "#fff";
  octx.fillRect(0, 0, width, height);
  const fit = Math.min((width - 8) / image.width, (height - 8) / image.height);
  const w = Math.round(image.width * fit);
  const hgt = Math.round(image.height * fit);
  octx.drawImage(image, Math.round((width - w) / 2), Math.round((height - hgt) / 2), w, hgt);
  const data = octx.getImageData(0, 0, width, height).data;
  const n = width * height;
  const grey = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) grey[i] = data[i * 4];
  // Lines thickened a pixel each way (a 3x3 minimum), which closes the
  // hairline gaps that would let one tap flood the whole page.
  const soft = new Uint8ClampedArray(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = 255;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const v = grey[yy * width + xx];
          if (v < m) m = v;
        }
      }
      soft[y * width + x] = m;
    }
  }
  const map = new Int32Array(n);
  for (let i = 0; i < n; i++) map[i] = soft[i] < 170 ? 1 : 0;
  let label = 2;
  const stack = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (map[start] !== 0) continue;
    let top = 0;
    stack[top++] = start;
    map[start] = label;
    while (top) {
      const p = stack[--top];
      const x = p % width;
      if (x > 0 && map[p - 1] === 0) { map[p - 1] = label; stack[top++] = p - 1; }
      if (x < width - 1 && map[p + 1] === 0) { map[p + 1] = label; stack[top++] = p + 1; }
      if (p >= width && map[p - width] === 0) { map[p - width] = label; stack[top++] = p - width; }
      if (p < n - width && map[p + width] === 0) { map[p + width] = label; stack[top++] = p + width; }
    }
    label += 1;
  }
  const corners = [map[0], map[width - 1], map[n - width], map[n - 1]];
  const counts = {};
  corners.forEach((c) => { counts[c] = (counts[c] || 0) + 1; });
  const outside = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
  return { width, height, map, soft, labels: label, outside, fill: new Array(label).fill(null),
    output: octx.createImageData(width, height) };
}

// A tap that lands on a line fills the nearest area instead.
function labelNear(page, x, y) {
  for (let r = 0; r <= 8; r += 2) {
    for (let dy = -r; dy <= r; dy += Math.max(1, r)) {
      for (let dx = -r; dx <= r; dx += Math.max(1, r)) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= page.width || yy >= page.height) continue;
        const l = page.map[yy * page.width + xx];
        if (l > 1) return l;
      }
    }
  }
  return null;
}

function paint(ctx, page) {
  const out = page.output.data;
  const { map, soft, fill } = page;
  for (let i = 0; i < map.length; i++) {
    const shade = soft[i] / 255;
    const c = fill[map[i]];
    const o = i * 4;
    if (c) {
      out[o] = c[0] * shade;
      out[o + 1] = c[1] * shade;
      out[o + 2] = c[2] * shade;
    } else {
      out[o] = out[o + 1] = out[o + 2] = soft[i];
    }
    out[o + 3] = 255;
  }
  ctx.putImageData(page.output, 0, 0);
}
