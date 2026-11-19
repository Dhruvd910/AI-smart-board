// The front door now: Sign in / Create account, and "check your email" until
// the address is verified. After that, the student picker -- or, for a new
// account with no students yet, the same add-a-student onboarding as before.

import * as account from "../account.js";
import { go } from "../nav.js";
import { at, h, stage, toast } from "../ui.js";

export function signin({ creating = false } = {}) {
  const screen = h("div", { class: "screen bg-garden wash" });
  stage.appendChild(screen);
  screen.append(
    at(h("div", { class: "title", text: creating ? "Create your account" : "Welcome to Liza" }), 0, 40),
    at(h("div", { class: "subtitle", text: creating ? "Then add the students who will learn with Liza."
      : "Sign in to see your students." }), 0, 82));
  const card = h("form", { class: "auth-card" });
  const email = h("input", { type: "email", placeholder: "Email", autocomplete: "email", required: true });
  const password = h("input", { type: "password", placeholder: creating ? "Password (6 or more letters)" : "Password",
    autocomplete: creating ? "new-password" : "current-password", required: true, minlength: "6" });
  const submit = h("button", { class: "pill-btn navy", type: "submit", text: creating ? "Create account" : "Sign in" });
  card.append(email, password, submit);
  screen.appendChild(at(card, 220, 130, 360, 200));

  card.addEventListener("submit", async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      if (creating) await account.signUp(email.value.trim(), password.value);
      else await account.signIn(email.value.trim(), password.value);
      go(account.verified() ? "picker" : "verify");
    } catch (err) {
      toast(account.why(err), 4000);
      submit.disabled = false;
    }
  });

  screen.appendChild(at(h("button", { class: "pill-btn white", text: creating ? "I have an account" : "Create an account",
    onclick: () => go("signin", { creating: !creating }) }), 220, 360, 175, 44));
  if (!creating) {
    screen.appendChild(at(h("button", { class: "pill-btn white", text: "Forgot password?", onclick: async () => {
      if (!email.value.trim()) return toast("Type your email first, then tap Forgot password.");
      try {
        await account.resetPassword(email.value.trim());
        toast("We sent you an email to set a new password.", 4000);
      } catch (err) { toast(account.why(err), 4000); }
    } }), 405, 360, 175, 44));
  }
  setTimeout(() => email.focus(), 50);
}

export function verify() {
  const screen = h("div", { class: "screen bg-garden wash" });
  stage.appendChild(screen);
  const who = account.user() ? account.user().email : "your email";
  screen.append(
    at(h("div", { class: "title", text: "Check your email" }), 0, 60),
    at(h("div", { class: "subtitle", text: `We sent a link to ${who}. Tap it, then come back here.` }), 0, 104));
  screen.append(
    at(h("button", { class: "pill-btn navy", text: "I've verified my email", onclick: async () => {
      if (await account.recheck()) go("picker");
      else toast("Not verified yet. Tap the link in the email first (check spam too).", 4000);
    } }), 270, 180, 260, 50),
    at(h("button", { class: "pill-btn white", text: "Send the email again", onclick: () =>
      account.resend().then(() => toast("Sent again.")).catch((err) => toast(account.why(err))) }), 270, 245, 260, 44),
    at(h("button", { class: "pill-btn white", text: "Use another account", onclick: () =>
      account.leave().then(() => go("signin")) }), 270, 300, 260, 44));
}
