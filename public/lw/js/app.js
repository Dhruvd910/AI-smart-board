// Liza on the web. Opens on "Who's learning today?", as asked: there is no
// sign-in, and the device's own picker is the front door.

import { fitStage, stage } from "./ui.js";
import { speaker } from "./voice.js";
import { go, register } from "./nav.js";
import { loadProfiles, setProfile } from "./state.js";
import * as profiles from "./screens/profiles.js";
import * as signin from "./screens/signin.js";
import * as account from "./account.js";
import * as home from "./screens/home.js";
import * as kg from "./screens/kg.js";
import * as workbook from "./screens/workbook.js";
import * as dash from "./screens/dashboard.js";

register("signin", signin.signin);
register("verify", signin.verify);
register("picker", profiles.picker);
register("setup", profiles.setup);
register("progress", profiles.progress);
register("dashboard", dash.dashboard);
register("home", home.render);
register("kg", kg.home);
register("kg-alphabet", kg.alphabet);
register("kg-numbers", kg.numbers);
register("kg-order", kg.order);
register("kg-spell", kg.spell);
register("kg-stories", kg.stories);
register("kg-story-list", kg.storyList);
register("kg-story", kg.story);
register("kg-test", kg.test);
register("workbook", workbook.cover);
register("wb-page", workbook.page);

fitStage();
window.addEventListener("resize", fitStage);
// The first tap anywhere is what lets the page make sound.
stage.addEventListener("pointerdown", () => speaker.unlock(), { capture: true });

// A link straight to a screen, for showing one part at a demo:
//   #open=home&profile=demo-6     #open=kg&profile=demo-kg
//   #open=workbook&profile=demo-kg     #open=wb-page&key=colour&profile=demo-kg
async function openFromLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  const screen = params.get("open");
  if (!screen) return false;
  const profiles = await loadProfiles().catch(() => []);
  const profile = profiles.find((p) => p.id === params.get("profile"));
  if (!profile) return false;
  setProfile(profile);
  const args = Object.fromEntries(params.entries());
  delete args.open;
  delete args.profile;
  if (args.index) args.index = Number(args.index);
  go(screen, args);
  return true;
}

// Signed in and verified: on to the students; otherwise the front door.
window.addEventListener("liza:signed-out", () => go("signin"));
account.ready.then(() => {
  if (!account.user()) return go("signin");
  if (!account.verified()) return go("verify");
  openFromLink().then((opened) => { if (!opened) go("picker"); });
});
