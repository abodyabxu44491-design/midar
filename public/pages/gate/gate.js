// تطبيق الحارس عند البوابة: يمسح بطاقات الطلاب بكاميرا أي جوال.
//   1) الربط بإحدى طريقتين:
//      - رمز الربط (6 أرقام) تُظهره الإدارة على شاشتها: يُكتب هنا، أو يُمسح QR فيفتح …/gate#j=<الرمز> وهو مكتوب.
//      - رابط خاص بجهاز واحد (…/<المدرسة>/gate#p=<الجهاز>.<الرمز>) يُستخدم مرة واحدة.
//      في الحالتين يأخذ الجهاز سره ويُمسح الرمز من الرابط.
//   2) بانتظار موافقة الإدارة ← بعد الموافقة تظهر شاشة المسح.
//   3) كل مسح له هوية فريدة. إن انقطع الاتصال يُحفظ على الجهاز ويُرسل تلقائيًا عند عودته (بلا تكرار).
import { h, mount } from "../shared/js/dom.js";
import { btn } from "../shared/js/ui.js";
import { icons } from "../shared/js/icons.js";
import { beep, startCamera } from "../shared/js/gate-scanner.js";

const VERSION = "gate-3";
const app = document.getElementById("app");
const school = decodeURIComponent(location.pathname.split("/")[1] || "").toLowerCase();
const CRED = `midar-gate:${school}`, QUEUE = `midar-gate-q:${school}`, LOG = `midar-gate-log:${school}`, ROSTER = `midar-gate-roster:${school}`;
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
let direction = "in";       // بوابة دخول وانصراف: اختيار الحارس
let roster = store.get(ROSTER, null);   // بصمات الرموز + الاسم والشعبة (للعمل بلا اتصال)
let geo = null;             // آخر موقع للجهاز (إن طلبت المدرسة التحقق من الموقع)

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
const revoked = () => { store.del(CRED); cred = null; joinScreen("أُلغي هذا الجهاز من الإدارة. اطلب رمز ربط جديدًا لإعادة تشغيله."); };
const deviceInfo = () => ({ ua: navigator.userAgent.slice(0, 200), platform: (navigator.userAgentData?.platform || navigator.platform || "").slice(0, 60),
  screen: `${window.screen.width}x${window.screen.height}`, lang: navigator.language });
const toDigits = (v) => v.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0)).replace(/\D/g, "");

/* ---------- ربط الجوال برمز الإدارة ---------- */
const NAME = `midar-gate-name:${school}`;
function joinScreen(note = null, prefill = "") {
  ui = null;
  const code = h("input", { class: "gt-code", inputMode: "numeric", autocomplete: "one-time-code", maxLength: 7, placeholder: "000000",
    "aria-label": "رمز الربط", value: prefill, dir: "ltr" });
  const name = h("input", { class: "gt-field", maxLength: 60, placeholder: "مثال: جوال الحارس أبو محمد", value: store.get(NAME, "") || "", "aria-label": "اسم الجوال" });
  const msg = h("p", { class: "gt-err", role: "alert" });
  code.addEventListener("input", () => {
    const v = toDigits(code.value).slice(0, 6);
    code.value = v.length > 3 ? `${v.slice(0, 3)} ${v.slice(3)}` : v;
    msg.textContent = "";
  });
  const go = btn("ربط الجوال", async () => {
    const digits = toDigits(code.value);
    if (digits.length !== 6) { msg.textContent = "اكتب الرمز كاملًا: 6 أرقام"; return code.focus(); }
    if (name.value.trim().length < 2) { msg.textContent = "اكتب اسمًا لهذا الجوال ليعرفه المدير"; return name.focus(); }
    go.disabled = true; go.textContent = "جارٍ الربط…";
    try {
      const r = await call("join", { code: digits, name: name.value.trim(), app_version: VERSION, info: deviceInfo() }, 10_000);
      if (r.status !== 200) throw new Error(r.data?.error || "تعذّر ربط الجوال");
      cred = { pid: r.data.device, secret: r.data.secret };
      store.set(CRED, cred); store.set(NAME, name.value.trim()); store.del(QUEUE);
      heartbeat();
    } catch (e) {
      msg.textContent = e.message === "Failed to fetch" || e.name === "AbortError" ? "لا يوجد اتصال بالإنترنت. تحقق منه ثم أعد المحاولة." : e.message;
      go.disabled = false; go.textContent = "ربط الجوال";
    }
  }, "gt-start");
  for (const el of [code, name]) el.addEventListener("keydown", (e) => e.key === "Enter" && go.click());
  mount(app, h("main", { class: "gt-screen gt-join" }, brand(),
    h("span", { class: "gt-big-ic" }, icons.link({ size: 40 })),
    h("h1", {}, "ربط هذا الجوال بالبوابة"),
    note ? h("p", { class: "gt-note" }, note) : null,
    h("p", {}, "اطلب من مدير المدرسة «رمز الربط» من: الحضور ← البوابة ← ربط جوال. اكتبه هنا، أو امسح رمز QR من شاشته بكاميرا الجوال."),
    h("label", { class: "gt-lbl" }, "رمز الربط", code),
    h("label", { class: "gt-lbl" }, "اسم هذا الجوال", name),
    msg, go,
    h("p", { class: "gt-muted" }, "بعد الربط يبقى الجوال جاهزًا للمسح دائمًا، حتى لو أُغلق التطبيق.")));
  (prefill ? name : code).focus();
}

/* ---------- الاقتران من الرابط ---------- */
async function pairFromHash() {
  const j = location.hash.match(/#j=(\d{6})/);
  if (j) {
    history.replaceState(null, "", location.pathname);
    if (!cred) { joinScreen(null, `${j[1].slice(0, 3)} ${j[1].slice(3)}`); throw new Error("join"); }
    return;
  }
  const m = location.hash.match(/#p=([A-Za-z0-9_-]{16,40})\.([A-Za-z0-9_-]{16,60})/);
  if (!m) return;
  history.replaceState(null, "", location.pathname);          // الرمز لا يبقى في الرابط ولا في السجل
  screen(icons.refresh, "جارٍ تجهيز الجهاز…", null);
  const prev = cred;
  cred = null;
  try {
    const r = await call("pair", { device: m[1], code: m[2], app_version: VERSION, info: deviceInfo() });
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
  if (!cred) return joinScreen();
  const sent = Date.now();
  let r;
  try {
    r = await call("status", { client_ts: sent, app_version: VERSION, pending: queue().length, ...(geo ? { geo } : {}) });
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
  if (info.direction === "out") direction = "out";
  else if (info.direction !== "both") direction = "in";
  if (info.want_location) locate();
  if (!roster || roster.version !== info.roster_version) loadRoster();
  updateBar();
  flush();
  pollTimer = setTimeout(heartbeat, 30_000);
}

/* ---------- قائمة الجهاز والموقع ---------- */
async function loadRoster() {
  try {
    const r = await call("roster", {}, 20_000);
    if (r.status === 200) { roster = r.data; store.set(ROSTER, roster); }
  } catch { /* تُعاد مع النبض التالي */ }
}
let locating = false;
function locate() {
  if (locating || !navigator.geolocation) return;
  locating = true;
  navigator.geolocation.getCurrentPosition(
    (p) => { geo = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }; locating = false; },
    () => { locating = false; }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 120_000 });
}
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
/** يعرف الطالب من البطاقة دون اتصال (بصمة الرمز في قائمة الجهاز) */
async function localLookup(code) {
  if (!roster?.students || !crypto.subtle) return null;
  let tok = String(code).trim();
  try { if (/^https?:\/\//i.test(tok)) tok = new URL(tok).pathname.split("/").filter(Boolean).pop() || ""; } catch { return null; }
  tok = tok.toUpperCase();
  if (!/^A1[0-9A-Z]{26}$/.test(tok)) return null;
  const h = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tok)));
  return roster.students.find((s) => s.h === h) || null;
}
/** الحالة المتوقعة محليًا (حاضر/متأخر) بساعة الخادم المصححة وأوقات مرحلة الطالب */
function localGuess(st) {
  const w = roster?.stage_hours?.find((x) => Number(x.stage_id) === Number(st.stage)) || info?.window;
  if (!w) return {};
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: info?.timezone || undefined, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(Date.now() + (skew || 0)));
  if (hm < w.open_at || hm > w.close_at) return { result: "rejected", message: hm < w.open_at ? "لم يبدأ وقت الحضور بعد" : "انتهى وقت تسجيل الحضور" };
  const late = hm > w.late_after;
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return late ? { result: "late", minutes_late: toMin(hm) - toMin(w.late_after) } : { result: "present" };
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
    time: r.time || null, minutes_late: r.minutes_late, message: r.message, offline: Boolean(r.offline), pending: Boolean(r.pending),
    sid: r.student?.id || null, guess: r.guess || null, direction: r.direction || "in" };
  if (i >= 0) l.items[i] = item; else l.items.unshift(item);
  l.items = l.items.slice(0, 50);
  store.set(LOG, l);
  renderLog();
}

/* ---------- المسح ---------- */
const STATUS_LABEL = { permitted: "مستأذن", excused: "بعذر", trip: "رحلة", activity: "نشاط خارجي", present: "حاضر", late: "متأخر", absent: "غائب" };
function describe(r) {
  const who = [r.student?.name, r.student?.class_name].filter(Boolean);
  if (r.pending) {
    const g = r.guess || {};
    const title = g.result === "late" ? `متأخر ${g.minutes_late} دقيقة` : g.result === "present" ? (r.direction === "out" ? "انصراف" : "حاضر")
      : g.result === "rejected" ? g.message : "حُفظ المسح";
    return { kind: g.result === "rejected" ? "err" : "saved", title, lines: [...who, "بدون اتصال — يُرسل تلقائيًا عند عودته"] };
  }
  switch (r.result) {
    case "present": return { kind: "ok", title: "حاضر", lines: [...who, r.time] };
    case "late": return { kind: "late", title: `متأخر ${r.minutes_late ?? ""} دقيقة`.replace("  ", " "), lines: [...who, r.time] };
    case "duplicate": return { kind: "again", title: r.direction === "out" ? "سُجّل انصرافه قبل قليل" : "مسجّل من قبل اليوم", lines: who };
    case "departed": return { kind: "ok", title: "انصراف", lines: [...who, r.time] };
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
async function scan(code, source = "qr") {
  const ev = { event_id: uuid(), code, client_ts: Date.now(), direction, source };
  const local = await localLookup(code).catch(() => null);
  try {
    if (!navigator.onLine) throw new Error("offline");
    const r = await call("scan", ev, 5000);
    online = true;
    if (r.status === 401) return revoked();
    if (r.status === 403) { show({ result: "rejected", message: r.data?.error || "الجهاز غير مفعّل" }); return heartbeat(); }
    if (r.status === 200) { show(r.data); logResult(r.data); bump(r.data); return; }
    throw new Error("server");
  } catch {
    // بلا اتصال (أو خطأ مؤقت): يعرف الطالب من قائمة الجهاز، ويحفظ المسح بوقته وفرق الساعة، ويُرسل لاحقًا بنفس الهوية
    online = false;
    const student = local ? { id: local.sid, name: local.name, class_name: local.cls } : null;
    const guess = local && direction === "in" ? localGuess(local) : local ? { result: "present" } : null;
    // نفس الطالب سُجّل اليوم على هذا الجهاز: لا يُكرر
    if (local && logs().items.some((x) => x.sid === local.sid && x.direction !== "out" && direction === "in"
        && ["present", "late"].includes(x.result === "pending" ? x.guess?.result : x.result))) {
      return show({ result: "duplicate", student });
    }
    if (!local && roster?.students) {
      return show({ result: "rejected", message: "بطاقة غير معروفة على هذا الجهاز" });
    }
    store.set(QUEUE, [...queue(), { ...ev, offline: true, ...(skew !== null ? { skew_ms: skew } : {}) }]);
    const r = { event_id: ev.event_id, pending: true, result: "pending", student, guess, direction };
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
    dir: h("div", { class: "gt-dir", hidden: true }), warn: h("div", { class: "gt-phase closed", hidden: true }), nfc: null,
  };
  const dirBtn = (k, label) => h("button", { type: "button", class: `gt-dir-b${direction === k ? " on" : ""}`, onclick: () => { direction = k; drawDir(); } }, label);
  const drawDir = () => mount(ui.dir, dirBtn("in", "دخول"), dirBtn("out", "انصراف"));
  drawDir();
  // قارئ NFC (أندرويد): نفس الرمز مكتوبًا على شريحة
  if ("NDEFReader" in window) {
    ui.nfc = btn("قراءة شرائح NFC", async () => {
      try {
        const reader = new window.NDEFReader();
        await reader.scan();
        ui.nfc.textContent = "NFC يعمل — قرّب الشريحة";
        ui.nfc.disabled = true;
        reader.onreading = (e) => {
          for (const rec of e.message.records) {
            if (["url", "text", "absolute-url"].includes(rec.recordType)) {
              const text = new TextDecoder(rec.encoding || "utf-8").decode(rec.data);
              if (text) { scan(text, "nfc"); break; }
            }
          }
        };
      } catch (e) { show({ result: "rejected", message: `تعذّر تشغيل NFC: ${e.message}` }); }
    }, "ghost sm gt-nfc");
  }
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
    ui.phase, ui.warn, ui.dir,
    cam,
    ui.nfc,
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
  ui.phase.textContent = direction === "out" && info.direction === "out" ? "بوابة انصراف" : text;
  ui.dir.hidden = info.direction !== "both";
  ui.warn.hidden = !info.place_warning;
  ui.warn.textContent = info.place_warning ? `${info.place_warning} — المسح يُعلَّم للمراجعة` : "";
}
function renderLog() {
  if (!ui) return;
  const items = logs().items;
  mount(ui.log, items.length ? items.map((x) => {
    const d = describe({ ...x, student: x.name ? { name: x.name, class_name: x.cls } : null });
    return h("div", { class: `gt-row ${d.kind}` },
      h("div", {}, h("b", {}, x.name || d.title), x.cls && h("small", {}, x.cls)),
      h("span", { class: "gt-tag" }, x.name ? d.title : (x.time || "")), x.time && x.name && h("small", { class: "gt-time" }, x.time),
      x.pending ? h("small", { class: "gt-time" }, "بانتظار الإرسال") : null);
  }) : h("p", { class: "gt-muted" }, "لم يُمسح أحد بعد."));
}
setInterval(() => {
  if (ui) ui.clock.textContent = new Date(Date.now() + (skew || 0)).toLocaleTimeString("ar", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}, 1000);

/* ---------- البدء ---------- */
(async () => {
  try { await pairFromHash(); } catch { return; }
  if (!cred) return joinScreen();
  heartbeat();
})();
