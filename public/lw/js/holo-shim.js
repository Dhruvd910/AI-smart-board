// Runs inside the 3D Explorer (holo/web.html), before its app.js.
//
// On the device the viewer talks to holo's loopback server. On the website
// there is none, so this answers the same /api/ calls itself: manifests and
// model files from the static data/ folder, and everything to do with Liza
// (Ask Liza, the tour's narration, the Talk button, Back) by handing it to
// the page around the viewer, window.parent.lizaHolo (explorer.js).
// The viewer's own files are holo/viewer, unchanged.
(function () {
  "use strict";
  const params = new URLSearchParams(location.search);
  const MODEL = params.get("model");
  const FOCUS = params.get("focus");
  const LANG = params.get("lang") || "en";
  const host = window.parent !== window ? window.parent.lizaHolo : null;
  const realFetch = window.fetch.bind(window);
  const apiRoot = new URL("api/", location.href).pathname;
  const manifests = {};
  let sentFirstLoad = false;

  function json(body, status) {
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: status || 200, headers: { "Content-Type": "application/json" } }));
  }

  async function manifest(id) {
    if (!manifests[id]) {
      const r = await realFetch(`data/${id}.json`);
      if (!r.ok) throw new Error("unknown model");
      manifests[id] = await r.json();
    }
    return manifests[id];
  }
  window.lizaManifest = manifest;

  window.fetch = async function (input, init) {
    init = init || {};
    const isRequest = typeof Request !== "undefined" && input instanceof Request;
    const url = new URL(isRequest ? input.url : String(input), location.href);
    if (!url.pathname.startsWith(apiRoot)) return realFetch(input, init);
    const route = url.pathname.slice(apiRoot.length);
    let body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch (_) { body = {}; }
    let m;

    if ((m = route.match(/^model\/([a-z0-9_]{1,64})$/))) {
      try { return json(await manifest(m[1])); } catch (_) { return json({ error: "I don't know that model" }, 404); }
    }
    if ((m = route.match(/^model\/([a-z0-9_]{1,64})\/file$/))) {
      const man = await manifest(m[1]);
      return realFetch(`data/${man.file}`);
    }
    if (/^model\/[a-z0-9_]{1,64}\/(prepare|progress)$/.test(route)) return json({ ok: true, got: 0, size: 0 });
    if (route === "events") {
      // The first ask gets the model to open; after that the page drives the
      // viewer directly (window.__holo.handle), so the wait never ends.
      if (!sentFirstLoad && MODEL) {
        sentFirstLoad = true;
        return json({ events: [{ type: "load", model_id: MODEL, focus: FOCUS || null, language: LANG }], seq: 1 });
      }
      await new Promise(() => {});
    }
    if (route === "catalog") {
      const models = await realFetch("data/catalog.json").then((r) => r.json());
      return json({ models: models.map((x) => ({ ...x, status: "cached" })) });
    }
    if (route === "close") { if (host) host.close(); return json({ ok: true }); }
    if (route === "state") { if (host) host.state(body); return json({ ok: true }); }
    if (route === "liza") { if (host) host.talk(body.do); return json({ ok: true }); }
    if (route === "narrate") {
      try {
        const man = await manifest(body.model_id);
        const step = (man.guided || [])[body.step];
        if (host && step) host.say((LANG === "hi" && step.say_hi) || step.say);
      } catch (_) { /* no narration, the tour still works */ }
      return json({ ok: true });
    }
    if (route === "ask") {
      if (!host) return json({ error: "Liza is not connected." });
      try { return json(await host.ask(body)); } catch (_) {
        return json({ error: "I couldn't reach the AI just now. The model still works." });
      }
    }
    if (route === "report") {
      if (body.kind === "js_error") console.warn("[3D Explorer]", body.error);
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  };
})();
