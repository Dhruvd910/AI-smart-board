// The microphone and the speaker.
//
// On the device these are two USB dongles and a voice detector in speech.py.
// Here the browser does both, and it brings one thing the device never had:
// echo cancelling on the microphone, so she does not hear herself.

import * as api from "./api.js";

// ---------------------------------------------------------------------------
// Speaking
// ---------------------------------------------------------------------------

const DEVANAGARI = /[ऀ-ॿ]/;

class Speaker {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.queue = [];          // {text, language, blob: Promise<Blob|null>}
    this.playing = null;
    this.session = 0;
    this.controller = new AbortController();
    this.onStart = () => {};
    this.onEnd = () => {};
    this.onIdle = () => {};
    this.unlocked = false;
    this.cache = new Map();     // "language|text" -> her voice, already fetched
  }

  // Browsers only let a page make sound after a tap. Called from the first one.
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    try {
      this.audio.src = "data:audio/mpeg;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAACcQCA";
      this.audio.play().catch(() => {});
    } catch (_) { /* nothing to unlock */ }
    if (window.speechSynthesis) window.speechSynthesis.getVoices();
  }

  get busy() {
    return Boolean(this.playing) || this.queue.length > 0;
  }

  // tone: a KG delivery from kg.KG_EMOTIONS ("excited", "gentle", ...).
  say(text, language, tone = "") {
    text = (text || "").trim();
    if (!text) return;
    language = language || (DEVANAGARI.test(text) ? "hi" : "en");
    const session = this.session;
    const item = { text, language, tone, session, blob: null };
    this.queue.push(item);
    this._fetchAhead();
    if (!this.playing) this._next();
  }

  // Her voice for the next few lines only. A story queues a dozen lines at
  // once; asking Cartesia for all of them together got some refused, and
  // those were read by the browser's voice instead -- the voice changed in
  // the middle of the story. Two at a time is Cartesia's own limit on this
  // plan ("Current limit: 2"), and still keeps ahead of the speaker.
  _fetchAhead() {
    const pending = [this.playing, ...this.queue].filter(Boolean);
    let inFlight = pending.filter((i) => i.blob && !i.settled).length;
    for (const item of this.queue) {
      if (inFlight >= 2) break;
      if (item.blob) continue;
      item.blob = this._voice(item).finally(() => {
        item.settled = true;
        this._fetchAhead();
      });
      inFlight += 1;
    }
  }

  async _voice(item) {
    const key = `${item.language}|${item.tone || ""}|${item.text}`;
    if (this.cache.has(key)) return this.cache.get(key);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (item.session !== this.session) return null;
      const blob = await api.tts(item.text, item.language, this.controller.signal, item.tone).catch(() => null);
      if (blob) {
        this.cache.set(key, blob);
        if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value);
        return blob;
      }
      // Refused (busy): wait a moment and ask again before giving up on
      // her own voice.
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
    return null;
  }

  // A promise that resolves once everything queued so far has been said.
  finished() {
    if (!this.busy) return Promise.resolve();
    return new Promise((resolve) => {
      const previous = this.onIdle;
      this.onIdle = () => {
        this.onIdle = previous;
        previous();
        resolve();
      };
    });
  }

  stop() {
    this.session += 1;
    this.controller.abort();
    this.controller = new AbortController();
    this.queue = [];
    const was = this.playing;
    this.playing = null;
    try { this.audio.pause(); } catch (_) { /* already stopped */ }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (was) this.onEnd(was);
    this.onIdle();
  }

  async _next() {
    const item = this.queue.shift();
    if (!item) {
      this.playing = null;
      this.onIdle();
      return;
    }
    this.playing = item;
    if (!item.blob) this._fetchAhead();
    const blob = await (item.blob || this._voice(item));
    if (item.session !== this.session) return;
    this.onStart(item);
    try {
      if (blob) await this._playBlob(blob, item);
      else await this._browserVoice(item);
    } catch (_) {
      // A line that will not play is skipped, not the whole answer.
    }
    if (item.session !== this.session) return;
    this.onEnd(item);
    this._next();
  }

  _playBlob(blob, item) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const done = () => {
        URL.revokeObjectURL(url);
        this.audio.onended = this.audio.onerror = this.audio.onpause = null;
        resolve();
      };
      this.audio.onended = done;
      this.audio.onerror = done;
      this.audio.onpause = () => { if (item.session !== this.session) done(); };
      this.audio.src = url;
      this.audio.play().catch(done);
    });
  }

  // Her own voice is unavailable (no credits, offline): the browser's, so the
  // demo still talks.
  _browserVoice(item) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) return resolve();
      const utterance = new SpeechSynthesisUtterance(item.text);
      const wanted = item.language === "hi" ? "hi" : "en";
      const voices = window.speechSynthesis.getVoices();
      utterance.voice = voices.find((v) => v.lang.startsWith(wanted + "-IN"))
        || voices.find((v) => v.lang.startsWith(wanted)) || null;
      utterance.lang = utterance.voice ? utterance.voice.lang : (wanted === "hi" ? "hi-IN" : "en-IN");
      utterance.rate = 1.02;
      utterance.onend = utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  }
}

export const speaker = new Speaker();

// ---------------------------------------------------------------------------
// Listening
// ---------------------------------------------------------------------------

class Listener {
  constructor() {
    this.stream = null;
    this.context = null;
    this.recorder = null;
    this.active = null;
    this.onLevel = () => {};
  }

  get supported() {
    return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  // Call FIRST THING in the tap handler, before any await. Browsers only let
  // a page start audio during a tap; the permission prompt that getUserMedia
  // shows ends that window, and an AudioContext started after it stays
  // suspended -- the level meter then reads silence and she never hears you.
  prime() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    if (!this.context || this.context.state === "closed") this.context = new Context();
    if (this.context.state === "suspended") this.context.resume().catch(() => {});
  }

  async open() {
    this.prime();
    if (!(this.stream && this.stream.active)) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      this.source = null;
    }
    if (!this.source || this.source.context !== this.context) {
      this.source = this.context.createMediaStreamSource(this.stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.source.connect(this.analyser);
      this.samples = new Float32Array(this.analyser.fftSize);
    }
  }

  // Let the browser's microphone light go off when she is not on screen.
  release() {
    this.cancel();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.context) this.context.close().catch(() => {});
    this.stream = null;
    this.context = null;
    this.source = null;
  }

  level() {
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (let i = 0; i < this.samples.length; i++) sum += this.samples[i] * this.samples[i];
    return Math.sqrt(sum / this.samples.length);
  }

  // Record one utterance. Resolves to a Blob, or null when nobody spoke or it
  // was cancelled. endSilenceMs is how long a pause ends it: short for a
  // question, long for a RE-TELL recitation.
  async listen({ startTimeoutMs = 8000, endSilenceMs = 1300, maxMs = 20000 } = {}) {
    await this.open();
    if (this.context.state === "suspended") await this.context.resume().catch(() => {});
    this.cancel();
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
      .find((m) => MediaRecorder.isTypeSupported(m)) || "";
    const recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    return new Promise((resolve) => {
      const started = performance.now();
      const quiet = [];          // the first moments, to learn the room's level
      let floor = 0.003;
      let heardAt = 0;
      let lastLoud = 0;
      let keep = true;
      let forced = false;        // they tapped "done": keep it even if the meter missed it
      let silentReads = 0;       // exact zeros: the meter is not working at all
      let blind = false;
      const session = { finish: null };
      this.active = session;

      const finish = (keepAudio, byTap = false) => {
        if (!this.active || this.active !== session) return;
        this.active = null;
        keep = keepAudio;
        forced = byTap;
        clearInterval(timer);
        this.onLevel(0);
        if (recorder.state !== "inactive") recorder.stop();
        else resolve(null);
      };
      session.finish = finish;

      recorder.onstop = () => {
        if (!keep || !chunks.length || !(heardAt || forced || blind)) return resolve(null);
        resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
      };

      const timer = setInterval(() => {
        const now = performance.now();
        const rms = this.context.state === "running" ? this.level() : 0;
        if (rms === 0) silentReads += 1;
        // A meter that reads exactly nothing for 1.5 s is not hearing the
        // microphone (a suspended audio context, or a browser that does not
        // feed it). Then record a fixed stretch instead of judging silence,
        // and let Whisper decide whether anything was said.
        if (!blind && !heardAt && silentReads >= 30) {
          blind = true;
          this.onLevel(0.5);
        }
        if (blind) {
          if (now - started > Math.min(maxMs, 7000)) finish(true);
          return;
        }
        if (now - started < 300) {
          quiet.push(rms);
          return;
        }
        if (quiet.length) {
          // The middle of the opening readings, not the loudest: someone who
          // starts talking at once must not raise the bar above their voice.
          quiet.sort((a, b) => a - b);
          floor = Math.max(floor, quiet[Math.floor(quiet.length / 2)]);
          quiet.length = 0;
        }
        const threshold = Math.max(0.008, floor * 3);
        const loud = rms > threshold;
        this.onLevel(Math.min(1, rms / (threshold * 3)));
        if (loud) {
          lastLoud = now;
          if (!heardAt) heardAt = now;
        } else if (!heardAt) {
          floor = floor * 0.97 + rms * 0.03;
        }
        if (!heardAt && now - started > startTimeoutMs) finish(false);
        else if (heardAt && now - lastLoud > endSilenceMs) finish(true);
        else if (now - started > maxMs) finish(true);
      }, 50);

      recorder.start(250);
    });
  }

  // Finish now and keep what was said (the student tapped "done").
  finishNow() {
    if (this.active) this.active.finish(true, true);
  }

  cancel() {
    if (this.active) this.active.finish(false);
  }

  get listening() {
    return Boolean(this.active);
  }
}

export const listener = new Listener();
