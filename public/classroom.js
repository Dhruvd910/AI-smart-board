// Classroom mode (classroom.py). A teacher starts a class and shares a code; each
// student's board goes to the teacher as a small picture every few seconds, the
// teacher's question comes back to every student, and the teacher can show their
// own board to the class. Plain polling: one request every few seconds each.
// Uses app.js's board, toast, toggleFly, closeFly and window.Board.

const $ = (id) => document.getElementById(id);
const STUDENT_EVERY = 4000, TEACHER_EVERY = 4000;
let me = null;                 // the signed-in person (auth.js)
let joined = null;             // {code, title}: the class this student is in
let teaching = null;           // {code, title}: the class this teacher has open
let lastTask = 0, lastSent = "", lastSentAt = 0, teacherShot = "", showTimer = 0;

async function call(method, url, body) {
  const r = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(out.detail || "Something went wrong."), { status: r.status });
  return out;
}

// What this board looks like now, small; "" when nothing has changed since the last send.
function snapshot(force = false) {
  const key = window.Board ? Board.key + "|" + board.version + "|" + board.items.length : "";
  if (!force && key === lastSent && Date.now() - lastSentAt < 30000) return undefined;
  lastSent = key;
  lastSentAt = Date.now();
  return Board.snapshot();
}

// ------------------------------------------------------------------ the student
async function join(code) {
  try {
    const c = await call("POST", "api/classes/join", { code: code.trim().toUpperCase() });
    if (c.own) return openTeaching(c);
    joined = c;
    try { localStorage.setItem("whiteboard.class", JSON.stringify(c)); } catch (_) { /* private mode */ }
    $("classbar-title").textContent = c.title;
    $("classbar").hidden = false;
    closeFly();
    toast(`You joined ${c.title}. Your teacher can see your board.`);
    lastSent = "";
    checkin();
  } catch (err) {
    toast(err.message);
  }
}

function leave(message) {
  if (joined) call("POST", `api/classes/${joined.code}/leave`).catch(() => {});
  joined = null;
  try { localStorage.removeItem("whiteboard.class"); } catch (_) { /* private mode */ }
  $("classbar").hidden = true;
  $("bigview").hidden = true;
  if (message) toast(message);
}

async function checkin() {
  if (!joined) return;
  const code = joined.code;
  try {
    const image = snapshot();
    const s = await call("POST", `api/classes/${code}/me`, image === undefined ? {} : { image });
    if (!joined || joined.code !== code) return;
    if (s.ended) return leave("Your teacher ended the class.");
    $("classbar-teacher").hidden = !s.showing;
    if (s.task && s.task_at > lastTask) {
      lastTask = s.task_at;
      fromTeacher(s.task);
    }
    if (!$("bigview").hidden && $("bigview").dataset.who === "teacher" && s.snap_at) showTeacher(s.snap_at);
  } catch (err) {
    if (err.status === 404 || err.status === 403) return leave("You're no longer in that class.");
  }
  setTimeout(checkin, STUDENT_EVERY);
}

// The teacher's question: in Liza's chat, so it stays where the student works.
function fromTeacher(text) {
  const chat = $("chat");
  const m = document.createElement("div");
  m.className = "msg teacher";
  m.innerHTML = "<b>From your teacher</b>";
  m.append(document.createElement("br"), text);
  chat.append(m);
  chat.hidden = false;
  $("welcome").hidden = true;
  $("panel-back").hidden = false;
  if ($("panel").hidden) $("panel-open").click();
  m.scrollIntoView({ block: "nearest" });
  toast("New question from your teacher");
}

function showTeacher(at = Date.now()) {
  $("bv-title").textContent = "Teacher's board";
  $("bigview").dataset.who = "teacher";
  $("bv-img").src = `api/classes/${joined.code}/teacher?t=${at}`;
  $("bigview").hidden = false;
}

// ------------------------------------------------------------------ the teacher
function openTeaching(c) {
  teaching = c;
  closeFly();
  $("cr-title").textContent = c.title;
  $("cr-code").textContent = c.code;
  $("cr-show").checked = false;
  $("classroom").hidden = false;
  $("cr-grid").replaceChildren();
  watch();
}

async function watch() {
  if (!teaching || $("classroom").hidden) return;
  const code = teaching.code;
  try {
    const v = await call("GET", `api/classes/${code}`);
    if (!teaching || teaching.code !== code) return;
    const on = v.students.filter((s) => s.online).length;
    $("cr-count").textContent = v.students.length
      ? `${v.students.length} joined · ${on} online now`
      : `Nobody yet. Students open this site, tap Class and type ${code}, or use the join link.`;
    drawTiles(v.students);
  } catch (err) {
    toast(err.message);
  }
  setTimeout(watch, TEACHER_EVERY);
}

function drawTiles(students) {
  const grid = $("cr-grid");
  const tiles = new Map([...grid.children].map((t) => [t.dataset.email, t]));
  const keep = new Set();
  for (const s of students) {
    keep.add(s.email);
    let t = tiles.get(s.email);
    if (!t) {
      t = document.createElement("button");
      t.className = "tile";
      t.dataset.email = s.email;
      t.innerHTML = '<div class="shot"><img alt=""><span class="empty">Empty board</span></div><div class="who"><i></i><b></b></div>';
      t.addEventListener("click", () => {
        $("bv-title").textContent = t.querySelector("b").textContent;
        $("bigview").dataset.who = s.email;
        $("bv-img").src = t.querySelector("img").src;
        $("bigview").hidden = false;
      });
      grid.append(t);
    }
    t.querySelector("b").textContent = s.name || s.email;
    t.querySelector("i").className = s.online ? "on" : "";
    const img = t.querySelector("img");
    const src = `api/classes/${teaching.code}/snap/${encodeURIComponent(s.email)}?t=${s.snap_at || 0}`;
    img.hidden = !s.snap_at;
    t.querySelector(".empty").hidden = !!s.snap_at;
    if (s.snap_at && img.getAttribute("src") !== src) {
      img.src = src;
      if ($("bigview").dataset.who === s.email && !$("bigview").hidden) $("bv-img").src = src;
    }
  }
  for (const [email, t] of tiles) if (!keep.has(email)) t.remove();
}

// "Show my board to the class": the teacher's page, sent while it changes.
function showMine() {
  clearTimeout(showTimer);
  if (!teaching) return;
  const code = teaching.code;
  if (!$("cr-show").checked) {
    call("POST", `api/classes/${code}/show`, { image: null }).catch(() => {});
    return;
  }
  const shot = Board.snapshot() || "";
  if (shot !== teacherShot) {
    teacherShot = shot;
    call("POST", `api/classes/${code}/show`, { image: shot || null }).catch((err) => toast(err.message));
  }
  showTimer = setTimeout(showMine, 3000);
}

// ------------------------------------------------------------------ the Class button
async function openClassFly() {
  if (!me) return toast("Sign in to use classes.");
  if (joined) return toast(`You're in ${joined.title}. Tap Leave on the bar to leave it.`);
  $("class-teach").hidden = !me.teacher;
  if (me.teacher) {
    const list = await call("GET", "api/classes/mine").catch(() => []);
    $("class-mine").replaceChildren(...list.slice(0, 4).map((c) => {
      const b = document.createElement("button");
      b.className = "wide";
      b.textContent = `Open ${c.title} (${c.code})`;
      b.addEventListener("click", () => openTeaching(c));
      return b;
    }));
  }
  toggleFly("classfly", $("class-btn"));
}

$("class-btn").addEventListener("click", openClassFly);
$("class-join").addEventListener("click", () => join($("class-code").value));
$("class-code").addEventListener("keydown", (e) => { if (e.key === "Enter") join($("class-code").value); });
$("class-start").addEventListener("click", async () => {
  try {
    openTeaching(await call("POST", "api/classes", { title: $("class-title").value }));
  } catch (err) {
    toast(err.message);
  }
});
$("classbar-leave").addEventListener("click", () => leave("You left the class."));
$("classbar-teacher").addEventListener("click", () => showTeacher());
$("bv-close").addEventListener("click", () => { $("bigview").hidden = true; });
$("cr-close").addEventListener("click", () => { $("classroom").hidden = true; toast("The class is still on. Tap Class to open it again."); });
$("cr-show").addEventListener("change", () => { teacherShot = ""; showMine(); });
$("cr-link").addEventListener("click", async (e) => {
  e.preventDefault();
  const link = location.origin + location.pathname + "?class=" + teaching.code;
  try { await navigator.clipboard.writeText(link); toast("Join link copied"); } catch (_) { prompt("Join link:", link); }
});
$("cr-task").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("cr-task-text").value.trim();
  if (!text) return;
  try {
    await call("POST", `api/classes/${teaching.code}/task`, { text });
    $("cr-task-text").value = "";
    toast("Sent to every student");
  } catch (err) {
    toast(err.message);
  }
});
$("cr-end").addEventListener("click", async () => {
  if (!confirm("End this class? Students will be sent out of it.")) return;
  await call("POST", `api/classes/${teaching.code}/end`).catch((err) => toast(err.message));
  $("cr-show").checked = false;
  teaching = null;
  $("classroom").hidden = true;
  toast("Class ended");
});

// Signed in: a ?class= link joins; a class joined before a reload is joined again.
(async () => {
  me = window.WB_AUTH ? await window.WB_AUTH : null;
  if (!me) return;
  const code = new URLSearchParams(location.search).get("class");
  if (code) {
    history.replaceState(null, "", location.pathname);
    return join(code);
  }
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("whiteboard.class")); } catch (_) { /* nothing saved */ }
  if (saved && saved.code) join(saved.code);
})();

window.Classroom = { join, leave, state: () => ({ joined, teaching }) };
