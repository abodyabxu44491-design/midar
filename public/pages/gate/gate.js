// تطبيق الحارس عند البوابة: يفتح من الرابط الذي ترسله الإدارة، ثم يمسح بطاقات الطلاب بكاميرا الجوال.
//   1) الرابط (…/<المدرسة>/gate#p=<الجهاز>.<الرمز>) يُستخدم مرة واحدة: الجهاز يقترن ويأخذ سره، ثم يُمسح الرمز من الرابط.
//   2) بانتظار موافقة الإدارة ← بعد الموافقة تظهر شاشة المسح.
//   3) كل مسح له هوية فريدة. إن انقطع الاتصال يُحفظ على الجهاز ويُرسل تلقائيًا عند عودته (بلا تكرار).
import { h, mount } from "../shared/js/dom.js";
import { btn } from "../shared/js/ui.js";
import { icons } from "../shared/js/icons.js";
import { beep, startCamera } from "../shared/js/gate-scanner.js";

const VERSION = "gate-1";
const app = document.getElementById("app");
const school = decodeURIComponent(location.pathname.split("/")[1] || "").toLowerCase();
const CRED = `midar-gate:${school}`, QUEUE = `midar-gate-q:${school}`, LOG = `midar-gate-log:${school}`;
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ممتلئ */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* */ } },
};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

let cred = store.get(CRED, null);
let skew = null;            // فرق ساعة الجهاز عن الخادم (من آخر نبض ناجح)
let info = null;            // آخر نبض: المدرسة، البوابة، النافذة، العداد
let online = navigator.onLine;
let ui = null;              // عناصر شاشة المسح (تُبنى مرة واحدة)

/* ---------- الاتصال بالخادم ---------- */
async function call(path, body, timeout = 6000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(`/api/gate/${encodeURIComponent(school)}/${path}`, {
      method: "POST", signal: ctl.signal, cache: "no-store",
      headers: { "Content-Type": "application/json", ...(cred ? { "X-Gate-Device": cred.pid, "X-Gate-Secret": cred.secret } : {}) },
      body: JSON.stringify(body || {}),
    });
    let data = null;
    try { data = await res.json(); } catch { /* */ }
    return { status: res.status, data };
  } finally { clearTimeout(timer); }
}

/* ---------- شاشات بسيطة ---------- */
const brand = () => h("img", { class: "gt-logo", src: "/brand/logo.svg", alt: "مدار" });
function screen(icon, title, text, ...extra) {
  ui = null;
  mount(app, h("main", { class: "gt-screen" }, brand(),
    h("span", { class: "gt-big-ic" }, icon({ size: 44 })), h("h1", {}, title), text && h("p", {}, text), ...extra));
}
const noLink = () => screen(icons.link, "بوابة الحضور", "افتح على هذا الجوال الرابط الذي أرسلته لك إدارة المدرسة. الرابط يعمل مرة واحدة فقط.");
const revoked = () => { store.del(CRED); cred = null; screen(icons.lock, "أُلغي هذا الجهاز", "تواصل مع إدارة المدرسة لإرسال رابط جديد."); };

/* ---------- الاقتران من الرابط ---------- */
async function pairFromHash() {
  const m = location.hash.match(/#p=([A-Za-z0-9_-]{16,40})\.([A-Za-z0-9_-]{16,60})/);
  if (!m) return;
  history.replaceState(null, "", location.pathname);          // الرمز لا يبقى في الرابط ولا في السجل
  screen(icons.refresh, "جارٍ تجهيز الجهاز…", null);
  const prev = cred;
  cred = null;
  try {
    const r = await call("pair", { device: m[1], code: m[2], app_version: VERSION,
      info: { ua: navigator.userAgent.slice(0, 200), platform: (navigator.userAgentData?.platform || navigator.platform || "").slice(0, 60),
        screen: `${window.screen.width}x${window.screen.height}`, lang: navigator.language } });
    if (r.status !== 200) { cred = prev; throw new Error(r.data?.error || "تعذّر تجهيز الجهاز"); }
    cred = { pid: m[1], secret: r.data.secret };
    store.set(CRED, cred);
    store.del(QUEUE);
  } catch (e) {
    screen(icons.alert, "تعذّر فتح الرابط", e.message === "Failed to fetch" ? "تحقق من الاتصال بالإنترنت ثم افتح الرابط مرة أخرى." : e.message);
    throw e;
  }
}

/* ---------- النبض ---------- */
let pollTimer = null;
async function heartbeat() {
  clearTimeout(pollTimer);
  if (!cred) return noLink();
  const sent = Date.now();
  let r;
  try {
    r = await call("status", { client_ts: sent, app_version: VERSION, pending: queue().length });
    online = true;
  } catch {
    online = false;
    updateBar();
    pollTimer = setTimeout(heartbeat, 15_000);
    return;
  }
  const back = Date.now();
  if (r.status === 401) return revoked();
  if (r.status !== 200) { pollTimer = setTimeout(heartbeat, 20_000); return; }
  info = r.data;
  skew = Math.round(info.server_time - (sent + back) / 2);
  if (info.status === "pending") {
    screen(icons.clock, "بانتظار موافقة الإدارة", `هذا الجهاز (${info.device}) مسجل على ${info.gate}. اطلب من مدير المدرسة الموافقة عليه من «الحضور ← البوابة».`,
      h("p", { class: "gt-muted" }, "ستظهر شاشة المسح تلقائيًا بعد الموافقة."));
    pollTimer = setTimeout(heartbeat, 4000);
    return;
  }
  if (info.status === "disabled") {
    screen(icons.lock, "الجهاز موقوف مؤقتًا", "أوقفت الإدارة هذا الجهاز. سيعود للعمل عند إعادة تفعيله.");
    pollTimer = setTimeout(heartbeat, 15_000);
    return;
  }
  if (!ui) scanner();
  updateBar();
  flush();
  pollTimer = setTimeout(heartbeat, 30_000);
}

/* ---------- الطابور (المسحات أثناء انقطاع الاتصال) ---------- */
const queue = () => store.get(QUEUE, []);
let flushing = false;
async function flush() {
  if (flushing || !cred) return;
  const q = queue();
  if (!q.length) return;
  flushing = true;
  try {
    const r = await call("events", { events: q.slice(0, 200) }, 15_000);
    online = true;
    if (r.status === 401) return revoked();
    if (r.status === 200) {
      const done = new Set();
      for (const x of r.data.results) {
        if (x.retry) continue;
        done.add(x.event_id);
        if (!x.error) logResult(x);
      }
      store.set(QUEUE, queue().filter((e) => !done.has(e.event_id)));
    }
  } catch { online = false; } finally { flushing = false; updateBar(); }
}
setInterval(flush, 10_000);
window.addEventListener("online", () => { online = true; heartbeat(); });
window.addEventListener("offline", () => { online = false; updateBar(); });

/* ---------- السجل المحلي (آخر من مُسح) ---------- */
const todayKey = () => new Date(Date.now() + (skew || 0)).toLocaleDateString("en-CA");
function logs() { const l = store.get(LOG, { day: todayKey(), items: [] }); return l.day === todayKey() ? l : { day: todayKey(), items: [] }; }
function logResult(r) {
  const l = logs();
  const i = l.items.findIndex((x) => x.event_id === r.event_id);
  const item = { event_id: r.event_id, result: r.result, name: r.student?.name || null, cls: r.student?.class_name || null,
    time: r.time || null, minutes_late: r.minutes_late, message: r.message, offline: Boolean(r.offline), pending: Boolean(r.pending) };
  if (i >= 0) l.items[i] = item; else l.items.unshift(item);
  l.items = l.items.slice(0, 50);
  store.set(LOG, l);
  renderLog();
}

/* ---------- المسح ---------- */
const STATUS_LABEL = { permitted: "مستأذن", excused: "بعذر", trip: "رحلة", activity: "نشاط خارجي", present: "حاضر", late: "متأخر", absent: "غائب" };
function describe(r) {
  if (r.pending) return { kind: "saved", title: "حُفظ المسح", lines: ["لا يوجد اتصال الآن — سيُرسل تلقائيًا عند عودته"] };
  const who = [r.student?.name, r.student?.class_name].filter(Boolean);
  switch (r.result) {
    case "present": return { kind: "ok", title: "حاضر", lines: [...who, r.time] };
    case "late": return { kind: "late", title: `متأخر ${r.minutes_late ?? ""} دقيقة`.replace("  ", " "), lines: [...who, r.time] };
    case "duplicate": return { kind: "again", title: "مسجّل من قبل اليوم", lines: who };
    case "kept": return { kind: "info", title: `مسجّل: ${STATUS_LABEL[r.status] || ""}`, lines: who };
    default: return { kind: "err", title: r.message || "مرفوض", lines: who };
  }
}
function show(r) {
  if (!ui) return;
  const d = describe(r);
  beep(d.kind === "info" ? "again" : d.kind);
  mount(ui.result, h("div", { class: `gt-card ${d.kind}` },
    h("span", { class: "gt-card-ic" }, (d.kind === "err" ? icons.alert : d.kind === "saved" ? icons.clock : icons.check)({ size: 40 })),
    h("div", {}, h("b", { class: "gt-card-t" }, d.title), ...d.lines.map((l, i) => h(i === 0 && r.student ? "div" : "small", { class: i === 0 && r.student ? "gt-card-name" : "" }, l)))));
  clearTimeout(show.t);
  show.t = setTimeout(() => mount(ui.result), 4000);
}
async function scan(code) {
  const ev = { event_id: uuid(), code, client_ts: Date.now() };
  try {
    const r = await call("scan", ev, 5000);
    online = true;
    if (r.status === 401) return revoked();
    if (r.status === 403) { show({ result: "rejected", message: r.data?.error || "الجهاز غير مفعّل" }); return heartbeat(); }
    if (r.status === 200) { show(r.data); logResult(r.data); bump(r.data); return; }
    throw new Error("server");
  } catch {
    // بلا اتصال (أو خطأ مؤقت): يُحفظ بوقته وفرق الساعة، ويُرسل لاحقًا بنفس الهوية
    online = false;
    store.set(QUEUE, [...queue(), { ...ev, offline: true, ...(skew !== null ? { skew_ms: skew } : {}) }]);
    const r = { event_id: ev.event_id, pending: true, result: "pending" };
    show(r); logResult(r); updateBar();
  }
}
function bump(r) {
  if (!info || !["present", "late"].includes(r.result)) return;
  info.count_gate = (info.count_gate || 0) + 1;
  updateBar();
}

/* ---------- شاشة المسح ---------- */
const PHASE = {
  open: (w) => ["open", `الحضور مفتوح — يُحسب متأخرًا بعد ${w.late_after}`],
  before: (w) => ["wait", `تفتح البوابة الساعة ${w.open_at}`],
  closed: (w) => ["closed", `انتهى وقت تسجيل الحضور (${w.close_at})`],
  finalized: () => ["closed", "اعتُمد حضور اليوم"],
};
function scanner() {
  const video = h("video", { playsinline: true, muted: true, autoplay: true, "aria-label": "الكاميرا" });
  ui = {
    school: h("b", {}), gate: h("small", {}), clock: h("b", { class: "gt-clock", dir: "ltr" }),
    net: h("span", { class: "gt-net" }), count: h("b", {}, "0"), phase: h("div", { class: "gt-phase" }),
    result: h("div", { class: "gt-result", "aria-live": "assertive" }), log: h("div", { class: "gt-log" }), video, stop: null,
  };
  const startBtn = btn("ابدأ المسح", () => start(), "gt-start");
  const cam = h("div", { class: "gt-cam" }, video, h("span", { class: "gt-frame", "aria-hidden": "true" }), startBtn, ui.result);
  let lock = null;
  async function start() {
    beep("again");
    try {
      ui.stop = await startCamera(video, scan);
      startBtn.hidden = true;
      cam.classList.add("on");
      lock = await navigator.wakeLock?.request("screen").catch(() => null);
    } catch (e) { show({ result: "rejected", message: e.message }); }
  }
  const stop = () => { ui?.stop?.(); if (ui) ui.stop = null; lock?.release?.().catch(() => {}); lock = null; startBtn.hidden = false; cam.classList.remove("on"); };
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); else heartbeat(); });
  mount(app, h("div", { class: "gt-app" },
    h("header", { class: "gt-bar" },
      h("div", { class: "gt-who" }, ui.school, ui.gate),
      h("div", { class: "gt-side" }, ui.clock, ui.net)),
    ui.phase,
    cam,
    h("div", { class: "gt-stats" }, h("div", {}, ui.count, h("small", {}, "سجّلوا من هذه البوابة اليوم"))),
    h("h2", { class: "gt-h" }, "آخر من مُسح"), ui.log));
  renderLog();
}
function updateBar() {
  if (!ui || !info) return;
  ui.school.textContent = info.school || "";
  ui.gate.textContent = `${info.gate} — ${info.device}`;
  ui.count.textContent = String(info.count_gate ?? 0);
  const pending = queue().length;
  ui.net.className = `gt-net ${!online ? "off" : pending ? "sync" : "on"}`;
  ui.net.textContent = !online ? `بدون إنترنت${pending ? ` — ${pending} بانتظار الإرسال` : ""}` : pending ? `يزامن ${pending}` : "متصل";
  const [cls, text] = info.phase === "no_school" ? ["closed", info.no_school_reason || "لا يوجد دوام اليوم"]
    : (PHASE[info.phase] || PHASE.open)(info.window || {});
  ui.phase.className = `gt-phase ${cls}`;
  ui.phase.textContent = text;
}
function renderLog() {
  if (!ui) return;
  const items = logs().items;
  mount(ui.log, items.length ? items.map((x) => {
    const d = describe(x.pending ? { pending: true } : { ...x, student: x.name ? { name: x.name, class_name: x.cls } : null });
    return h("div", { class: `gt-row ${d.kind}` },
      h("div", {}, h("b", {}, x.name || d.title), x.cls && h("small", {}, x.cls)),
      h("span", { class: "gt-tag" }, x.name ? d.title : (x.time || "")), x.time && x.name && h("small", { class: "gt-time" }, x.time));
  }) : h("p", { class: "gt-muted" }, "لم يُمسح أحد بعد."));
}
setInterval(() => {
  if (ui) ui.clock.textContent = new Date(Date.now() + (skew || 0)).toLocaleTimeString("ar", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}, 1000);

/* ---------- البدء ---------- */
(async () => {
  try { await pairFromHash(); } catch { return; }
  if (!cred) return noLink();
  heartbeat();
})();
