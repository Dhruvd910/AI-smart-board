// The progress dashboard (dashboard.py): headline tiles, the last fourteen
// days as stacked bars, a donut of what they do most, rings towards each goal,
// and an A-to-Z for a KG child or a five-week calendar for an older one.
// Drawn on one canvas at the device's own coordinates; the chips and buttons
// on top are ordinary buttons.

import * as api from "../api.js";
import { go } from "../nav.js";
import { at, h, stage, toast } from "../ui.js";
import { isKG, loadProfiles, state } from "../state.js";
import { speaker } from "../voice.js";

const INK = "#1E293B", INK_SOFT = "#64748B", CARD = "#FFFFFF", CARD_EDGE = "#E2E8F0";
const TRACK = "#EEF2F7", ACCENT = "#4F46E5";
const DAY_LETTERS = "MTWTFSS";

// ui.py KG_PROGRESS_KINDS
const KINDS = {
  story: ["Stories heard", "#B45309"], letters: ["Letters practised", "#2563EB"],
  spelling: ["Words spelled", "#7C3AED"], counting: ["Counting", "#059669"],
  order: ["Alphabet order", "#D97706"], test: ["Tests taken", "#0EA5E9"],
  workbook: ["Workbook pages", "#F97316"], lesson: ["Topics learned", "#0F766E"],
  retell: ["Topics re-told", "#BE185D"],
};
const kind = (k) => KINDS[k] || [k[0].toUpperCase() + k.slice(1), "#64748B"];

// dashboard.GOALS; the letters and stories are the real size of the set.
function goals(sizes = {}) {
  return {
    letters: ["Letters", sizes.letters || 26],
    spelling: ["Words", 30],
    story: ["Stories", sizes.story || 16],
    workbook: ["Workbook", 10], counting: ["Counting", 5], order: ["ABC order", 5],
    test: ["Tests", 10], lesson: ["Topics", 20], retell: ["Re-tells", 10],
  };
}
const KG_RINGS = ["letters", "spelling", "story", "workbook"];
const SCHOOL_RINGS = ["lesson", "retell", "test", "story"];

// Dates as "YYYY-MM-DD" strings, counted from the server's today (Indian time).
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (iso) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;   // Monday 0
const shortDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB",
  { day: "2-digit", month: "short", timeZone: "UTC" });

// dashboard.streak: days in a row ending today, or ending yesterday.
export function streak(daysDone, today) {
  let day = daysDone.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (daysDone.has(day)) { count += 1; day = addDays(day, -1); }
  return count;
}

export function dashboard({ userId = null, back = null } = {}) {
  const screen = h("div", { class: "screen bg-garden wash" });
  stage.appendChild(screen);
  screen.appendChild(at(h("img", { src: "assets/ui/kg/glass_bg.png", alt: "", draggable: "false" }), 19, 20, 762, 441));
  const canvas = h("canvas", { class: "dash-canvas" });
  canvas.width = 1600;
  canvas.height = 960;
  screen.appendChild(at(canvas, 0, 0, 800, 480));
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);
  const font = getComputedStyle(document.body).fontFamily;
  const back_ = back || (isKG(state.profile) ? "kg" : "home");
  let shown = null;

  const recent = h("button", { class: "pill-btn dash-btn", text: "Recent activity",
    onclick: () => go("progress", { back: "dashboard", userId: shown && shown.id }) });
  const done = h("button", { class: "pill-btn dash-btn primary", text: "Done", onclick: () => go(back_, {}) });
  screen.append(at(recent, 470, 428, 150, 34), at(done, 632, 428, 134, 34));

  loadProfiles().catch(() => [])
    .then(async (people) => {
      const pid = userId || (state.profile && state.profile.id) || (people[0] && people[0].id);
      shown = people.find((p) => p.id === pid) || state.profile;
      if (!shown) return;
      const data = await api.get(`/api/profiles/${shown.id}/progress`);
      draw(ctx, font, shown, data, goals(data.goals));
      chips(screen, people, shown.id, back_);
    })
    .catch((err) => toast(err.message));
  return () => speaker.stop();
}

// A chip per student, top right: tapping one shows theirs.
function chips(screen, people, current, back) {
  if (people.length < 2) return;
  const list = people.slice(0, 5);
  const width = 86, gap = 6;
  let x = 766 - list.length * width - (list.length - 1) * gap;
  for (const p of list) {
    const mine = p.id === current;
    const chip = h("button", { class: `pill-btn dash-chip${mine ? " primary" : ""}`, text: (p.name || "?").slice(0, 9),
      onclick: mine ? null : () => go("dashboard", { userId: p.id, back }) });
    screen.appendChild(at(chip, x, 34, width, 28));
    x += width + gap;
  }
}

function draw(ctx, font, person, data, goalsFor) {
  const totals = data.totals || [];
  const daily = data.daily || {};
  const today = data.today || new Date().toISOString().slice(0, 10);
  const kg = isKG(person);
  const text = (x, y, words, pt, { bold = false, fill = INK, anchor = "center", maxWidth } = {}) => {
    ctx.font = `${bold ? 700 : 400} ${Math.round(pt * 1.333)}px ${font}`;
    ctx.fillStyle = fill;
    ctx.textAlign = anchor === "w" ? "left" : anchor === "e" ? "right" : "center";
    ctx.textBaseline = "middle";
    ctx.fillText(words, x, y, maxWidth);
  };
  const round = (x0, y0, x1, y1, r, fill, stroke, width = 1) => {
    ctx.beginPath();
    ctx.roundRect(x0, y0, x1 - x0, y1 - y0, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  };
  const oval = (cx, cy, r, fill) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
  const panel = (x0, y0, x1, y1, title) => {
    round(x0 + 1, y0 + 3, x1 + 1, y1 + 3, 14, "#D9DEEA");
    round(x0, y0, x1, y1, 14, CARD, CARD_EDGE);
    text(x0 + 14, y0 + 15, title, 9, { bold: true, fill: INK_SOFT, anchor: "w" });
  };

  text(44, 44, `${person.name}'s dashboard`, 18, { bold: true, anchor: "w" });
  text(44, 68, kg ? "Kindergarten" : `Class ${person.class || ""}`.trim(), 9, { fill: INK_SOFT, anchor: "w" });

  // ----- headline tiles -----
  const daysDone = new Set(Object.entries(daily).filter(([, k]) => sum(k)).map(([d]) => d));
  const best = Math.max(0, ...Object.values(daily).map(sum));
  const total = totals.reduce((n, r) => n + (r.times || 0), 0);
  const run = streak(daysDone, today);
  const tiles = [["🔥", run, run === 1 ? "day streak" : "days in a row", "#F97316"],
    ["⭐", total, "things done", "#EAB308"], ["📅", daysDone.size, "days active (5 wks)", "#0EA5E9"],
    ["🏆", best, "on the best day", "#22C55E"]];
  tiles.forEach(([emoji, number, label, colour], i) => {
    const x = 30 + i * (176 + 9);
    round(x, 80, x + 176, 120, 12, CARD, CARD_EDGE);
    oval(x + 22, 100, 14, colour);
    text(x + 22, 101, emoji, 11);
    text(x + 46, 100, String(number), 16, { bold: true, anchor: "w" });
    text(x + 54 + 11 * String(number).length, 101, label, 8, { fill: INK_SOFT, anchor: "w" });
  });

  // ----- the last fourteen days -----
  {
    const [x0, y0, x1, y1] = [30, 130, 402, 284];
    panel(x0, y0, x1, y1, "LAST 14 DAYS");
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
    const counts = days.map((d) => daily[d] || {});
    const peak = Math.max(0, ...counts.map(sum));
    const base = y1 - 26, top = y0 + 34;
    if (!peak) {
      const last = totals.map((r) => r.last_seen).filter(Boolean).sort().pop();
      text((x0 + x1) / 2, (top + base) / 2 - 8, "Nothing in the last two weeks", 10, { fill: INK_SOFT });
      text((x0 + x1) / 2, (top + base) / 2 + 12, last ? `Last time: ${shortDate(last.slice(0, 10)).replace(/^0/, "")}`
        : "Pick an activity to get started!", 9, { bold: true, fill: ACCENT });
    }
    const scale = (base - top) / Math.max(peak, 1);
    const slot = (x1 - x0 - 40) / 14;
    if (peak) {
      ctx.setLineDash([3, 3]);
      line(ctx, x0 + 30, top, x1 - 10, top, TRACK);
      ctx.setLineDash([]);
      text(x0 + 24, top, String(peak), 7, { fill: INK_SOFT, anchor: "e" });
    }
    line(ctx, x0 + 30, base, x1 - 10, base, CARD_EDGE);
    days.forEach((day, i) => {
      const cx = x0 + 36 + slot * i + slot / 2, bw = slot * 0.62;
      let y = base;
      for (const [k, n] of Object.entries(counts[i]).sort(([a], [b]) => a.localeCompare(b))) {
        const hgt = n * scale;
        ctx.fillStyle = kind(k)[1];
        ctx.fillRect(cx - bw / 2, y - hgt, bw, hgt);
        y -= hgt;
      }
      if (!sum(counts[i])) oval(cx, base - 2, 2, CARD_EDGE);
      const isToday = day === today;
      text(cx, base + 12, isToday ? "●" : DAY_LETTERS[weekday(day)], 7,
        { bold: isToday, fill: isToday ? ACCENT : INK_SOFT });
    });
  }

  // ----- what they do most -----
  {
    const [x0, y0, x1] = [414, 130, 770];
    panel(x0, y0, x1, 284, "WHAT YOU DO MOST");
    const rows = totals.filter((r) => r.times).sort((a, b) => b.times - a.times);
    const all = rows.reduce((n, r) => n + r.times, 0);
    const cx = x0 + 82, cy = y0 + 88, r = 56;
    if (!all) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = TRACK; ctx.lineWidth = 18; ctx.stroke();
      text(cx, cy, "0", 16, { bold: true, fill: INK_SOFT });
      text(x0 + 240, cy - 9, "Start an activity", 9, { fill: INK_SOFT });
      text(x0 + 240, cy + 9, "and it shows here", 9, { fill: INK_SOFT });
    } else {
      let start = -Math.PI / 2;
      for (const row of rows) {
        const extent = (Math.PI * 2 * row.times) / all;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, start, start + extent); ctx.closePath();
        ctx.fillStyle = kind(row.kind)[1]; ctx.fill();
        if (rows.length > 1) { ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 2; ctx.stroke(); }
        start += extent;
      }
      oval(cx, cy, r * 0.58, CARD);
      text(cx, cy - 6, String(all), 15, { bold: true });
      text(cx, cy + 12, "in all", 7, { fill: INK_SOFT });
      let ly = y0 + 40;
      const lx = x0 + 166;
      for (const row of rows.slice(0, 5)) {
        const [label, colour] = kind(row.kind);
        round(lx, ly - 6, lx + 12, ly + 6, 4, colour);
        text(lx + 20, ly, label, 9, { anchor: "w" });
        text(x1 - 14, ly, String(row.times), 9, { bold: true, anchor: "e" });
        ly += 21;
      }
      const other = rows.slice(5).reduce((n, r) => n + r.times, 0);
      if (other) {
        text(lx + 20, ly, "Other", 9, { fill: INK_SOFT, anchor: "w" });
        text(x1 - 14, ly, String(other), 9, { fill: INK_SOFT, anchor: "e" });
      }
    }
  }

  // ----- goals -----
  {
    const [x0, y0, x1] = [30, 294, 402];
    panel(x0, y0, x1, 420, "GOALS");
    const byKind = Object.fromEntries(totals.map((r) => [r.kind, r]));
    const order = [...totals].sort((a, b) => (b.times || 0) - (a.times || 0)).map((r) => r.kind).filter((k) => k in goalsFor);
    for (const k of kg ? KG_RINGS : SCHOOL_RINGS) if (!order.includes(k)) order.push(k);
    const slot = (x1 - x0 - 16) / 4;
    order.slice(0, 4).forEach((k, i) => {
      const [label, goal] = goalsFor[k];
      const row = byKind[k] || {};
      const have = (k === "test" ? row.times : row.different) || 0;
      const colour = kind(k)[1];
      const cx = x0 + 8 + slot * i + slot / 2, cy = y0 + 64, r = 30;
      ctx.lineWidth = 9;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = TRACK; ctx.stroke();
      const share = goal ? Math.min(1, have / goal) : 0;
      if (share > 0) {
        ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * share);
        ctx.strokeStyle = colour; ctx.stroke();
      }
      text(cx, cy, String(have), 13, { bold: true });
      text(cx, cy + 44, label, 9, { bold: true });
      text(cx, cy + 58, share < 1 ? `of ${goal}` : "all done!", 7, { fill: share < 1 ? INK_SOFT : colour });
    });
  }

  if (kg) letters(ctx, text, round, data.letters || []);
  else calendar(ctx, text, round, oval, daily, today);
}

// A to Z, lit for every letter practised; brighter the more often.
function letters(ctx, text, round, rows) {
  const [x0, y0, x1, y1] = [414, 294, 770, 420];
  round(x0 + 1, y0 + 3, x1 + 1, y1 + 3, 14, "#D9DEEA");
  round(x0, y0, x1, y1, 14, CARD, CARD_EDGE);
  text(x0 + 14, y0 + 15, "MY A TO Z", 9, { bold: true, fill: INK_SOFT, anchor: "w" });
  const times = {};
  for (const row of rows) {
    const topic = (row.topic || "").trim();
    if (/^[A-Za-z]$/.test(topic)) times[topic.toUpperCase()] = (times[topic.toUpperCase()] || 0) + (row.times || 1);
  }
  text(x1 - 14, y0 + 15, `${Object.keys(times).length} of 26`, 9, { bold: true, fill: ACCENT, anchor: "e" });
  const size = 22, gap = 4;
  [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].forEach((letter, i) => {
    const x = x0 + 14 + (i % 13) * (size + gap), y = y0 + 36 + Math.floor(i / 13) * (size + 14);
    const n = times[letter] || 0;
    round(x, y, x + size, y + size + 6, 6, !n ? "#F1F5F9" : n === 1 ? "#A5B4FC" : n < 4 ? "#818CF8" : ACCENT);
    text(x + size / 2, y + (size + 6) / 2, letter, 10, { bold: true, fill: n > 1 ? "#FFFFFF" : n ? INK : "#94A3B8" });
  });
  scaleKey(text, round, x0 + 14, y1 - 16, ["#F1F5F9", "#A5B4FC", "#818CF8", ACCENT], "not yet", "lots");
}

// Five weeks, Monday to Sunday, darker on busier days.
function calendar(ctx, text, round, oval, daily, today) {
  const [x0, y0, x1, y1] = [414, 294, 770, 420];
  round(x0 + 1, y0 + 3, x1 + 1, y1 + 3, 14, "#D9DEEA");
  round(x0, y0, x1, y1, 14, CARD, CARD_EDGE);
  text(x0 + 14, y0 + 15, "LAST 5 WEEKS", 9, { bold: true, fill: INK_SOFT, anchor: "w" });
  const monday = addDays(today, -weekday(today));
  const first = addDays(monday, -28);
  const size = 13, gap = 3, gx = x0 + 60;
  [...DAY_LETTERS].forEach((l, d) => text(gx + d * (size + gap) + size / 2, y0 + 32, l, 7, { fill: INK_SOFT }));
  for (let week = 0; week < 5; week++) {
    const y = y0 + 40 + week * (size + gap);
    const start = addDays(first, week * 7);
    text(gx - 8, y + size / 2, shortDate(start), 7, { fill: INK_SOFT, anchor: "e" });
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, d);
      const n = sum(daily[day] || {});
      const fill = day > today ? null : !n ? "#F1F5F9" : n === 1 ? "#BBF7D0" : n < 4 ? "#4ADE80" : "#16A34A";
      const x = gx + d * (size + gap);
      round(x, y, x + size, y + size, 4, fill, day === today ? ACCENT : null, 2);
    }
  }
  const month = {};
  for (const kinds of Object.values(daily)) for (const [k, n] of Object.entries(kinds)) month[k] = (month[k] || 0) + n;
  const tx = gx + 7 * (size + gap) + 18;
  let ty = y0 + 42;
  if (!Object.keys(month).length) text(tx, ty + 30, "Nothing yet", 9, { fill: INK_SOFT, anchor: "w" });
  for (const [k, n] of Object.entries(month).sort((a, b) => b[1] - a[1]).slice(0, 4)) {
    const [label, colour] = kind(k);
    oval(tx + 4, ty, 4, colour);
    text(tx + 14, ty, `${label}: ${n}`, 8, { anchor: "w", maxWidth: x1 - tx - 30 });
    ty += 19;
  }
  scaleKey(text, round, tx, y1 - 16, ["#F1F5F9", "#BBF7D0", "#4ADE80", "#16A34A"], "quiet", "busy");
}

function scaleKey(text, round, x, y, colours, low, high) {
  text(x, y, low, 7, { fill: INK_SOFT, anchor: "w" });
  x += 8 + 5 * low.length;
  for (const colour of colours) { round(x, y - 5, x + 10, y + 5, 3, colour); x += 13; }
  text(x + 4, y, high, 7, { fill: INK_SOFT, anchor: "w" });
}

function line(ctx, x0, y0, x1, y1, colour) {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
  ctx.strokeStyle = colour; ctx.lineWidth = 1; ctx.stroke();
}

function sum(kinds) {
  return Object.values(kinds || {}).reduce((a, b) => a + b, 0);
}
