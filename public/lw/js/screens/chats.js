// "<name>'s chats" (ui.py show_chat_history): the conversations on the left,
// newest first and grouped by day, the one tapped open on the right. A chat
// is a run of turns with no gap longer than half an hour (chatlog.py).

import * as api from "../api.js";
import { at, h, toast } from "../ui.js";

const NEW_CHAT_AFTER_MS = 30 * 60 * 1000;

function conversations(turns) {
  const chats = [];
  let current = null;
  let last = null;
  for (const turn of turns) {
    const at = new Date(turn.at);
    const text = (turn.content || "").trim();
    if (!text) continue;
    if (!current || at - last > NEW_CHAT_AFTER_MS) {
      current = { start: at, turns: [] };
      chats.push(current);
    }
    current.turns.push({ role: turn.role, text, at });
    last = at;
  }
  for (const chat of chats) {
    const first = chat.turns.find((t) => t.role === "user");
    chat.title = (first || chat.turns[0]).text.replace(/\s+/g, " ");
  }
  return chats.reverse();
}

const time = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
function day(d) {
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function openChats(screen, profile, onClose) {
  const overlay = h("div", { class: "screen bg-garden wash ch-overlay" });
  overlay.style.zIndex = "30";
  screen.appendChild(overlay);
  overlay.appendChild(at(h("div", { class: "title", text: `${profile.name}'s chats` }), 0, 25));
  overlay.appendChild(at(h("div", { class: "subtitle", text: "Newest first. Tap a chat to read it." }), 0, 62));
  const close = h("button", { class: "pill-btn", text: "Close", style: { background: "#6366F1", color: "#fff", fontSize: "16px" },
    onclick: () => { overlay.remove(); if (onClose) onClose(); } });
  overlay.appendChild(at(close, 676, 22, 104, 40));
  const list = at(h("div", { class: "ch-pane" }), 16, 88, 274, 378);
  const read = at(h("div", { class: "ch-pane ch-read" }), 302, 88, 482, 378);
  overlay.append(list, read);

  api.get(`/api/profiles/${profile.id}/history`).then(({ turns }) => {
    const chats = conversations(turns);
    if (!chats.length) {
      list.remove(); read.remove();
      overlay.appendChild(at(h("div", { class: "ch-empty", text: "No chats yet. Tap SPEAK and ask anything!" }), 160, 260, 480));
      return;
    }
    let lastDay = null;
    const rows = [];
    chats.forEach((chat, i) => {
      const d = day(chat.start);
      if (d !== lastDay) { list.appendChild(h("div", { class: "ch-day", text: d.toUpperCase() })); lastDay = d; }
      const questions = chat.turns.filter((t) => t.role === "user").length;
      const row = h("div", { class: "ch-row" },
        h("div", { class: "ch-title", text: chat.title }),
        h("div", { class: "ch-meta", text: time(chat.start) + (questions ? `  ·  ${questions} question${questions > 1 ? "s" : ""}` : "") }));
      row.addEventListener("click", () => openChat(i));
      list.appendChild(row);
      rows.push(row);
    });
    const openChat = (i) => {
      rows.forEach((r, k) => r.classList.toggle("on", k === i));
      const chat = chats[i];
      const start = chat.start;
      const today = new Date().toDateString() === start.toDateString();
      read.replaceChildren(h("div", { class: "ch-heading", text: today ? `${day(start)}, ${time(start)}`
        : `${start.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).replace(/,/g, "")}, ${time(start)}` }));
      for (const turn of chat.turns) {
        const mine = turn.role === "user";
        read.appendChild(h("div", { class: `ch-msg ${mine ? "mine" : "hers"}` },
          h("div", { class: "ch-bubble", text: turn.text }),
          h("div", { class: "ch-who", text: `${mine ? "You" : "Liza"}  ·  ${time(turn.at)}` })));
      }
      read.scrollTop = 0;
    };
    openChat(0);
  }).catch((err) => toast(err.message));
}
