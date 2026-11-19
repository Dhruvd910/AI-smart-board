// "Who's learning today?", the new-student keyboard, and My progress.
// Positions are the device's (ui.py show_profile_picker / show_profile_setup).

import * as api from "../api.js";
import { go } from "../nav.js";
import { at, avatar, h, stage, toast } from "../ui.js";
import { forget, isKG, lastPicked, loadProfiles, remember, setProfile, state } from "../state.js";
import { speaker } from "../voice.js";
import * as account from "../account.js";

const COLS = [55, 292, 529];
const ROWS = [121, 217, 313];

export function picker({ editing = false } = {}) {
  const screen = h("div", { class: "screen bg-garden wash" });
  stage.appendChild(screen);

  screen.append(
    at(h("div", { class: "title", text: "Who's learning today?" }), 0, 22),
    at(h("div", { class: "subtitle", text: editing ? "Tap a student you added to change them."
      : "Tap your name, or add a new student." }), 0, 62),
  );

  const progressBtn = h("button", { class: "pill-btn", text: "Dashboard", onclick: () => {
    if (!state.profile) return toast("Pick a student first, then see their progress.");
    go("dashboard", { back: "picker" });
  } });
  screen.appendChild(at(progressBtn, 20, 20, 153, 37));
  if (state.profile) {
    screen.appendChild(at(h("button", { class: "pill-btn", text: "Close",
      onclick: () => openProfile(state.profile, false) }), 628, 20, 153, 37));
  }

  const list = h("div");
  screen.appendChild(list);
  const loading = at(h("div", { class: "subtitle", text: "Loading..." }), 0, 200);
  screen.appendChild(loading);

  screen.appendChild(at(h("button", { class: "pill-btn", text: "Sign out",
    onclick: () => account.leave().then(() => { setProfile(null); go("signin"); }) }), 470, 20, 140, 37));

  loadProfiles().then((profiles) => {
    loading.remove();
    // A new account: straight into adding its first student.
    if (!profiles.length) return go("setup", {});
    const last = state.profile ? state.profile.id : lastPicked();
    profiles.slice(0, 9).forEach((profile, i) => {
      const card = h("div", { class: `who-card${profile.id === last ? " current" : ""}` },
        h("img", { src: avatar(profile.avatar), alt: "" }),
        h("div", { class: "who-text" },
          h("div", { class: `who-name${isKG(profile) ? " kg" : ""}`, text: profile.name }),
          h("div", { class: "who-class", text: `Class ${profile.class}` })),
        profile.demo ? h("div", { class: "who-demo", text: "DEMO" }) : null,
        editing && !profile.demo ? h("button", { class: "who-edit", text: "Edit" }) : null);
      card.addEventListener("click", () => {
        if (editing) {
          if (profile.demo) return toast("The demo students cannot be changed.");
          return go("setup", { profile });
        }
        openProfile(profile, true);
      });
      list.appendChild(at(card, COLS[i % 3], ROWS[Math.floor(i / 3)]));
    });
  }).catch((err) => {
    // The backend lives on Liza's Raspberry Pi: when it is off, say so.
    loading.textContent = "Liza is offline right now: her Raspberry Pi is switched off "
      + "or not connected. Please try again in a little while.";
    loading.style.color = "#1E2233";
    loading.style.fontSize = "15px";
    screen.appendChild(at(h("button", { class: "pill-btn white", text: "Try again",
      onclick: () => go("picker") }), 330, 250, 140, 44));
    console.error(err);
  });

  screen.appendChild(at(h("button", { class: "pill-btn navy", text: "+  Add a student",
    style: { fontSize: "17px" }, onclick: () => go("setup", {}) }), 220, 397, 200, 49));
  screen.appendChild(at(h("button", { class: "pill-btn white", text: editing ? "Done" : "Edit",
    style: { fontSize: "16px" }, onclick: () => go("picker", { editing: !editing }) }), 445, 397, 132, 49));
}

// route_for_profile: Kindergarten to its own home, everyone else to Liza.
export function openProfile(profile, greet) {
  setProfile(profile);
  if (isKG(profile)) go("kg", { greet });
  else go("home", { greet });
}

// ---------------------------------------------------------------------------
// New student / edit student
// ---------------------------------------------------------------------------

const KEY_ROWS = ["ABCDEFGHIJ", "KLMNOPQRST", "UVWXYZ"];

export function setup({ profile = null } = {}) {
  const editing = Boolean(profile);
  let name = profile ? profile.name : "";
  let chosenClass = profile ? profile.class : "";
  let board = profile ? profile.board : null;

  const screen = h("div", { class: "screen bg-garden wash" });
  stage.appendChild(screen);
  screen.appendChild(h("div", { class: "glass" }));
  screen.append(
    at(h("div", { class: "title", text: editing ? "Edit student" : "New student" }), 0, 26),
    at(h("div", { class: "subtitle", text: "Type a name, then tap a class." }), 0, 62),
  );

  const input = h("input", { type: "text", placeholder: "Name", maxlength: "24",
    autocomplete: "off", spellcheck: "false", value: name });
  input.addEventListener("input", () => { name = input.value; refresh(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
  const box = h("div", { class: "name-box" }, input);
  screen.appendChild(box);

  const type = (ch) => {
    if (name.length >= 24) return;
    // A capital to start each word, small letters after, as a name is written.
    const startOfWord = !name || name.endsWith(" ");
    name += startOfWord ? ch : ch.toLowerCase();
    input.value = name;
    refresh();
  };

  KEY_ROWS.forEach((row, r) => {
    [...row].forEach((ch, i) => {
      screen.appendChild(at(h("button", { class: "key", text: ch, onclick: () => type(ch) }),
        40 + i * 72, 136 + r * 46, 69, 43));
    });
  });
  screen.appendChild(at(h("button", { class: "key small", text: "SPACE", onclick: () => {
    if (name && !name.endsWith(" ")) { name += " "; input.value = name; refresh(); }
  } }), 472, 228, 140, 43));
  screen.appendChild(at(h("button", { class: "key small soft", text: "DELETE", onclick: () => {
    name = name.slice(0, -1); input.value = name; refresh();
  } }), 616, 228, 141, 43));

  screen.appendChild(at(h("div", { class: "section-label", text: "CLASS" }), 40, 285));
  screen.appendChild(at(h("div", { class: "section-label", text: "BOARD (OPTIONAL)" }), 556, 285));
  const classKeys = [];
  const classes = state.classes.length ? state.classes : ["KG", ...Array.from({ length: 12 }, (_, i) => String(i + 1))];
  classes.forEach((value, i) => {
    const row = i < 7 ? 0 : 1;
    const col = i < 7 ? i : i - 7;
    const key = h("button", { class: "key", text: value, style: { fontSize: "16px" },
      onclick: () => { chosenClass = value; refresh(); } });
    classKeys.push([value, key]);
    screen.appendChild(at(key, 40 + col * 72, 306 + row * 52, 67, 47));
  });
  const boardKeys = [];
  (state.boards.length ? state.boards : ["CBSE", "ICSE", "State", "Other"]).forEach((value, i) => {
    const key = h("button", { class: "key small", text: value,
      onclick: () => { board = board === value ? null : value; refresh(); } });
    boardKeys.push([value, key]);
    screen.appendChild(at(key, 556 + (i % 2) * 112, 306 + Math.floor(i / 2) * 52, 105, 47));
  });

  const saveBtn = h("button", { class: "pill-btn navy", text: editing ? "Save" : "Save and start",
    style: { fontSize: "16px" }, onclick: save });
  screen.appendChild(at(saveBtn, 40, 407, 215, 48));
  screen.appendChild(at(h("button", { class: "pill-btn white", text: "Back",
    onclick: () => go("picker") }), 264, 407, 133, 48));
  if (editing) {
    let armed = false;
    const del = h("button", { class: "pill-btn", text: "Remove", style: { background: "#FFE4E6", color: "#BE123C" },
      onclick: async () => {
        if (!armed) {
          armed = true;
          del.textContent = "Tap again to remove";
          return;
        }
        try {
          await api.send("DELETE", `/api/profiles/${profile.id}`);
          forget(profile.id);
          if (state.profile && state.profile.id === profile.id) setProfile(null);
          go("picker");
        } catch (err) { toast(err.message); }
      } });
    screen.appendChild(at(del, 406, 407, 170, 48));
  }

  function refresh() {
    box.classList.toggle("empty", !name.trim());
    classKeys.forEach(([value, key]) => key.classList.toggle("on", value === chosenClass));
    boardKeys.forEach(([value, key]) => key.classList.toggle("on", value === board));
    saveBtn.disabled = !(name.trim() && chosenClass);
  }

  async function save() {
    if (!(name.trim() && chosenClass)) return;
    saveBtn.disabled = true;
    try {
      const body = { name: name.trim(), class: chosenClass, board };
      const saved = editing
        ? await api.send("PATCH", `/api/profiles/${profile.id}`, body)
        : await api.send("POST", "/api/profiles", body);
      remember(saved.id);
      openProfile(saved, true);
    } catch (err) {
      toast(err.message);
      saveBtn.disabled = false;
    }
  }

  refresh();
  if (!("ontouchstart" in window)) setTimeout(() => input.focus(), 50);
}

// ---------------------------------------------------------------------------
// My progress (ui.py show_progress)
// ---------------------------------------------------------------------------

const PROGRESS_KINDS = {
  story: ["Stories heard", "#B45309"], letters: ["Letters practised", "#2563EB"],
  spelling: ["Words spelled", "#7C3AED"], counting: ["Counting", "#059669"],
  order: ["Alphabet order", "#D97706"], test: ["Tests taken", "#0EA5E9"],
  workbook: ["Workbook pages", "#F97316"], lesson: ["Topics learned", "#0F766E"],
  retell: ["Topics re-told", "#BE185D"],
};

// ui.py _when: "today", "yesterday", "3 days ago".
export function when(value) {
  if (!value) return "";
  const then = new Date(value);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(then).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 60) { const weeks = Math.floor(days / 7); return weeks === 1 ? "a week ago" : `${weeks} weeks ago`; }
  return then.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

// Text centred on (x, y) at a Tk point size.
function t(parent, x, y, words, pt, { bold = false, colour = "#1E2233", width = null, anchor = "center" } = {}) {
  const el = h("div", { class: "kg-t", text: words });
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, color: colour,
    font: `${bold ? 700 : 400} ${Math.round(pt * 1.333)}px/1.25 var(--font)`,
    transform: anchor === "w" ? "translate(0,-50%)" : anchor === "e" ? "translate(-100%,-50%)" : "translate(-50%,-50%)",
    textAlign: anchor === "w" ? "left" : anchor === "e" ? "right" : "center",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    width: width ? `${width}px` : "auto" });
  parent.appendChild(el);
  return el;
}

function card(parent, x0, y0, x1, y1, radius = 14) {
  const el = h("div", { class: "pv-card" });
  Object.assign(el.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`,
    height: `${y1 - y0}px`, borderRadius: `${radius}px` });
  parent.appendChild(el);
  return el;
}

export function progress({ back = "home", userId = null } = {}) {
  const profile = (userId && userId !== (state.profile || {}).id
    ? state.profiles.find((p) => p.id === userId) : null) || state.profile;
  const screen = h("div", { class: "screen bg-garden wash" });
  stage.appendChild(screen);
  screen.appendChild(at(h("img", { src: "assets/ui/kg/glass_bg.png", alt: "", draggable: "false" }), 19, 20, 762, 441));
  t(screen, 400, 40, `${profile.name}'s progress`, 20, { bold: true });
  t(screen, 400, 68, "Everything you have been learning", 10, { colour: "#8891A8" });
  const done = h("button", { class: "pill-btn", text: back === "dashboard" ? "Back to dashboard" : "Done",
    style: { background: "#6366F1", color: "#fff", fontSize: "17px" },
    onclick: () => {
      if (back === "dashboard") go("dashboard", { userId: profile.id });
      else if (back === "picker") go("picker");
      else if (isKG(profile)) go("kg", {});
      else go("home", {});
    } });
  screen.appendChild(at(done, 290, 406, 220, 46));

  api.get(`/api/profiles/${profile.id}/progress`).then(({ progress: rows, totals }) => {
    if (!totals.length) {
      card(screen, 120, 150, 680, 280);
      const msg = t(screen, 400, 215, "Nothing here yet. Spell a word, hear a story or take a test, and it will show up here.",
        12, { colour: "#8891A8", width: 480 });
      msg.style.whiteSpace = "normal";
      return;
    }
    totals.slice(0, 5).forEach((row, i) => {
      const [label, colour] = PROGRESS_KINDS[row.kind] || [row.kind[0].toUpperCase() + row.kind.slice(1), "#475569"];
      const x0 = 34 + i * 147;
      card(screen, x0, 88, x0 + 135, 174);
      t(screen, x0 + 67, 118, String(row.kind === "test" ? row.times : row.different), 26, { bold: true, colour });
      t(screen, x0 + 67, 145, label, 9, { width: 124 });
      const noteText = row.available ? `${row.scored} of ${row.available} marks`
        : (row.times > row.different ? `${row.times} times` : "");
      t(screen, x0 + 67, 162, noteText, 8, { colour: "#8891A8", width: 124 });
    });
    if (rows.length) {
      card(screen, 34, 190, 766, 384);
      t(screen, 50, 208, "Lately", 10, { bold: true, colour: "#8891A8", anchor: "w" });
    }
    rows.slice(0, 6).forEach((row, i) => {
      const y = 232 + i * 25;
      const [, colour] = PROGRESS_KINDS[row.kind] || [row.kind, "#475569"];
      const dot = h("div", { class: "pv-dot" });
      Object.assign(dot.style, { left: "50px", top: `${y - 4}px`, background: colour });
      screen.appendChild(dot);
      t(screen, 70, y, row.topic, 10, { bold: true, anchor: "w", width: 210 });
      t(screen, 296, y, row.detail || "", 9, { colour: "#8891A8", anchor: "w", width: 370 });
      t(screen, 750, y, when(row.at), 9, { colour: "#8891A8", anchor: "e" });
    });
  }).catch((err) => toast(err.message));
  return () => speaker.stop();
}
