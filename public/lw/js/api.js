// Every call to the backend goes through here, with the signed-in account's
// token. A 401 means signed out: the app shows the sign-in screen.
import { token } from "./account.js";

const BASE = (window.LIZA_CONFIG && window.LIZA_CONFIG.apiBase || "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(url, init = {}) {
  const t = await token();
  const response = await fetch(url, t ? { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` } } : init);
  if (response.status === 401) window.dispatchEvent(new Event("liza:signed-out"));
  return response;
}

async function fail(response) {
  let message = `Something went wrong (${response.status}).`;
  try {
    const body = await response.json();
    message = body.error || body.detail || message;
  } catch (_) { /* not JSON */ }
  throw new ApiError(message, response.status);
}

export async function get(path) {
  const response = await call(BASE + path);
  if (!response.ok) await fail(response);
  return response.json();
}

export async function send(method, path, body) {
  const response = await call(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) await fail(response);
  return response.json();
}

// One conversation turn. Calls onEvent for each line of the NDJSON stream:
// heard, sentence, status, report, done.
export async function turn({ profileId, mode, text, audio, retell, heardLanguage, board, photo,
  boardPhoto, boardAsk, screen, boardStrokes, signal }, onEvent) {
  const form = new FormData();
  // Pictures as files: a form field over 1 MB is refused by the server.
  if (photo) form.append("photo", photo, "camera.jpg");
  if (boardPhoto) form.append("board_photo", boardPhoto, "board.png");
  if (boardAsk) form.append("board_ask", boardAsk);
  if (screen) form.append("screen", JSON.stringify(screen));
  if (boardStrokes) form.append("board_strokes", JSON.stringify(boardStrokes));
  form.append("profile_id", profileId);
  form.append("mode", mode);
  if (retell) form.append("retell", retell);
  if (heardLanguage) form.append("heard_language", heardLanguage);
  if (board) form.append("board", JSON.stringify(board));
  if (audio) form.append("audio", audio, audio.type.includes("mp4") ? "speech.mp4" : "speech.webm");
  else form.append("text", text || "");
  const response = await call(BASE + "/api/turn", { method: "POST", body: form, signal });
  if (!response.ok) await fail(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}

export async function transcribe(audio, language, signal, seed = "") {
  const form = new FormData();
  form.append("audio", audio, audio.type.includes("mp4") ? "speech.mp4" : "speech.webm");
  if (language) form.append("language", language);
  if (seed) form.append("seed", seed);
  const response = await call(BASE + "/api/transcribe", { method: "POST", body: form, signal });
  if (!response.ok) await fail(response);
  return response.json();
}

// MP3 bytes of her voice, or null when the server says to use the browser's.
// A GET, so the same line (a letter, a number, a story) is cached at Vercel's
// edge after the first visitor asks for it, and comes back at once after that.
export async function tts(text, language, signal, tone = "") {
  const query = new URLSearchParams({ t: text, l: language || "" });
  if (tone) query.set("tone", tone);
  const response = await fetch(`${BASE}/api/tts?${query}`, { signal });
  if (response.status === 503 || response.status === 429) return null;
  if (!response.ok) await fail(response);
  return response.blob();
}
