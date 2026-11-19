// What this browser remembers. Only conveniences live here -- which profiles
// it made and who was last picked. The profiles themselves, and everything
// they say and score, are on the server.

import * as api from "./api.js";

function read(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) { /* private window: nothing is remembered, which is fine */ }
}

export const state = {
  profile: null,             // the student using it now
  profiles: [],
  classes: [],
  boards: [],
  mode: read("liza.mode", "TUTOR"),
  kg: null,                  // kg_content, fetched once
};

export function ownIds() {
  return read("liza.own", []);
}

export function remember(profileId) {
  const ids = ownIds().filter((id) => id !== profileId);
  ids.push(profileId);
  write("liza.own", ids.slice(-20));
}

export function forget(profileId) {
  write("liza.own", ownIds().filter((id) => id !== profileId));
}

export function lastPicked() {
  return read("liza.last", null);
}

export function setProfile(profile) {
  state.profile = profile;
  if (profile) write("liza.last", profile.id);
}

export function setMode(mode) {
  state.mode = mode;
  write("liza.mode", mode);
}

export async function loadProfiles() {
  // The signed-in account's students (the server knows whose they are).
  const data = await api.get("/api/profiles");
  state.profiles = data.profiles;
  state.classes = data.classes;
  state.boards = data.boards;
  return state.profiles;
}

// The KG content ships with the pages (data/kg.json, from tools/build_kg.py),
// so the KG screens open at once; the server's copy is the fallback.
export async function kgContent() {
  if (!state.kg) {
    state.kg = await fetch("data/kg.json").then((r) => (r.ok ? r.json() : Promise.reject()))
      .catch(() => api.get("/api/kg"));
  }
  return state.kg;
}

export function isKG(profile) {
  return (profile && String(profile.class).toUpperCase() === "KG");
}

export function progress(kind, topic, extra = {}) {
  if (!state.profile) return;
  api.send("POST", "/api/progress", { profile_id: state.profile.id, kind, topic, ...extra })
    .catch(() => {});
}
