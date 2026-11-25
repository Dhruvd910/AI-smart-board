// Sign in with Google, when the server has it on (GOOGLE_CLIENT_ID). Covers the
// board until the person is signed in and let in by an admin; adds Sign out and,
// for admins, Admin to the "…" menu.
// window.WB_AUTH: the signed-in, let-in person ({email, name, ...}), or null;
// app.js waits for it before opening their boards from the server.
let authDone;
window.WB_AUTH = new Promise((resolve) => { authDone = resolve; });
(async () => {
  const $ = (id) => document.getElementById(id);
  const get = (url, opts) => fetch(url, { credentials: "same-origin", ...opts }).then((r) => r.json());
  let me;
  try { me = await get("api/auth/me"); } catch (_) { return authDone(null); } // server unreachable: the board's own errors say so
  if (!me.enabled) return authDone(null);

  const words = {
    pending: "Thanks! An admin needs to let you in. Try again once they have.",
    blocked: "This account has been blocked. Ask the admin if that's a mistake.",
  };
  function show(text, other) {
    $("signin-words").textContent = text;
    $("signin-other").hidden = !other;
    $("signin").hidden = false;
  }
  $("signin-other").addEventListener("click", async () => {
    await get("api/auth/logout", { method: "POST" });
    location.reload();
  });

  if (me.signed_in && me.status === "active") {
    const first = (me.name || me.email).split(" ")[0];
    $("profile-pic").referrerPolicy = "no-referrer"; // Google's photos refuse other sites' referrers
    $("profile-pic").src = me.picture || "icon.svg";
    $("profile-name").textContent = first;
    $("pm-name").textContent = me.name || first;
    $("pm-email").textContent = me.email;
    $("pm-admin").hidden = !me.admin;
    $("profile").hidden = false;
    authDone(me);
    const menu = $("profile-menu"), btn = $("profile-btn");
    const toggle = (open) => { menu.hidden = !open; btn.setAttribute("aria-expanded", String(open)); };
    btn.addEventListener("click", (e) => { e.stopPropagation(); toggle(menu.hidden); });
    document.addEventListener("pointerdown", (e) => { if (!$("profile").contains(e.target)) toggle(false); });
    $("delete-me").addEventListener("click", async () => {
      if (!confirm("Delete your account? Your boards, history and class memberships are erased for good.")) return;
      if (prompt('Type DELETE to confirm') !== "DELETE") return;
      const r = await get("api/me/delete", { method: "POST" });
      if (!r.deleted) return alert(r.detail || "Couldn't delete it just now. Try again.");
      try { localStorage.clear(); } catch (_) { /* private mode */ }
      location.reload();
    });
    $("signout").addEventListener("click", async () => {
      await get("api/auth/logout", { method: "POST" });
      if (window.google) google.accounts.id.disableAutoSelect();
      location.reload();
    });
    return;
  }
  authDone(null);
  if (me.signed_in) return show(words[me.status] || "You can't use the board yet.", true);

  show("Sign in with your Google account to use the board.", false);
  const { client_id } = await get("api/auth/config");
  const gsi = document.createElement("script");
  gsi.src = "https://accounts.google.com/gsi/client";
  gsi.async = true;
  gsi.onload = () => {
    google.accounts.id.initialize({
      client_id,
      callback: async ({ credential }) => {
        const r = await fetch("api/auth/google", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential }),
        });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) return show(out.detail || "That sign-in didn't work. Try again.", false);
        if (out.status === "active") return location.reload();
        show(words[out.status] || "You can't use the board yet.", true);
      },
    });
    google.accounts.id.renderButton($("gbutton"), { theme: "outline", size: "large", shape: "pill", text: "signin_with" });
  };
  gsi.onerror = () => show("Couldn't load Google sign-in. Check the connection and reload.", false);
  document.head.append(gsi);
})();
