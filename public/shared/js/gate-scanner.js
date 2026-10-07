// بوابة الحضور: المناوب يمسح رمز QR في بطاقة الطالب بكاميرا الجوال أو الجهاز اللوحي،
// فيُسجَّل حضوره (أو تأخره بعد وقت التأخر) ويصل ولي أمره إشعار فوري.
// القراءة: BarcodeDetector المدمج في المتصفح إن وُجد (أندرويد)، وإلا jsQR (آيفون وغيره).
import { h, mount } from "./dom.js";
import { api } from "./api.js";
import { btn, input, sub, notice, toast } from "./ui.js";
import { icons } from "./icons.js";

const STATUS = { present: ["تم تسجيل الحضور", "ok"], late: ["تم تسجيل الحضور: متأخر", "late"] };

/** صوت قصير للنتيجة (نجاح، تأخر، خطأ) — يعمل بعد أول ضغطة من المستخدم */
let ac;
function beep(kind) {
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    const tones = { ok: [880, 1320], late: [660, 660], err: [220, 180], again: [990] }[kind] || [880];
    tones.forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.0001, ac.currentTime + i * 0.13);
      g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + i * 0.13 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + i * 0.13 + 0.12);
      o.connect(g).connect(ac.destination); o.start(ac.currentTime + i * 0.13); o.stop(ac.currentTime + i * 0.13 + 0.14);
    });
  } catch { /* بلا صوت */ }
  navigator.vibrate?.(kind === "err" ? [80, 60, 80] : 60);
}

async function makeReader() {
  if ("BarcodeDetector" in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes("qr_code")) {
        const det = new window.BarcodeDetector({ formats: ["qr_code"] });
        return async (video) => (await det.detect(video))[0]?.rawValue || null;
      }
    } catch { /* نجرب jsQR */ }
  }
  const jsQR = (await import("../vendor/jsqr/jsqr.mjs")).default;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    const w = video.videoWidth, hgt = video.videoHeight;
    if (!w || !hgt) return null;
    const scale = Math.min(1, 640 / Math.max(w, hgt));
    canvas.width = Math.round(w * scale); canvas.height = Math.round(hgt * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data || null;
  };
}

/**
 * @param {string} base مثل /api/admin أو /api/teacher
 */
export function gateScanner(base) {
  const video = h("video", { playsinline: true, muted: true, autoplay: true, "aria-label": "الكاميرا" });
  const frame = h("div", { class: "gscan-cam", hidden: true }, video, h("span", { class: "gscan-line", "aria-hidden": "true" }));
  const result = h("div", { class: "gscan-result", "aria-live": "assertive" });
  const counter = h("b", {}, "0");
  const recent = h("div", { class: "gscan-recent" });
  const key = input({ placeholder: "أو اكتب معرّف الطالب: ABCD-1234", dir: "ltr", maxLength: 9, autocomplete: "off" });
  let stream = null, timer = null, busy = false, lastCode = "", lastAt = 0;

  const show = (kind, title, lines = []) => {
    mount(result, h("div", { class: `gscan-card ${kind}` },
      h("span", { class: "gc-ic" }, (kind === "err" ? icons.alert : icons.check)({ size: 34 })),
      h("div", {}, h("b", {}, title), ...lines.map((l) => h("div", {}, l)))));
  };
  const refresh = async () => {
    try {
      const d = await api(`${base}/attendance/gate`);
      counter.textContent = String(d.count);
      mount(recent, d.recent.map((r) => h("div", { class: `gscan-row s-${r.status}` }, h("b", {}, r.name),
        h("small", {}, [r.class_name, new Date(r.created_at).toLocaleTimeString("ar", { hour: "numeric", minute: "2-digit" })].filter(Boolean).join(" · ")))));
    } catch { /* بدون اتصال */ }
  };
  const submit = async (code) => {
    if (busy) return;
    busy = true;
    try {
      const r = await api(`${base}/attendance/gate`, { code });
      if (r.already) {
        beep("again");
        show("again", "مسجّل من قبل اليوم", [r.student.name, r.student.class_name].filter(Boolean));
      } else {
        const [title, kind] = STATUS[r.status];
        beep(kind);
        show(kind, title, [h("span", { class: "gc-name" }, r.student.name), r.student.class_name, r.time, "وصل إشعار لولي الأمر"].filter(Boolean));
      }
      refresh();
    } catch (e) {
      beep("err");
      show("err", e.message);
    } finally { busy = false; }
  };
  const loop = (read) => {
    timer = setTimeout(async () => {
      if (!stream) return;
      try {
        const code = await read(video);
        const now = Date.now();
        // نفس البطاقة أمام الكاميرا: مرة كل 5 ثوانٍ فقط
        if (code && (code !== lastCode || now - lastAt > 5000)) { lastCode = code; lastAt = now; await submit(code); }
      } catch { /* إطار غير صالح */ }
      loop(read);
    }, 220);
  };
  const stop = () => {
    clearTimeout(timer); timer = null;
    stream?.getTracks().forEach((t) => t.stop()); stream = null;
    frame.hidden = true;
    mount(startBox, startBtn);
  };
  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return toast("الكاميرا غير متاحة في هذا المتصفح. اكتب المعرّف بدلًا منها.", true);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
    } catch {
      return toast("لم يُسمح باستخدام الكاميرا. اسمح بها من إعدادات المتصفح للموقع.", true);
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    frame.hidden = false;
    mount(startBox, btn("إيقاف الكاميرا", stop, "ghost"));
    beep("again");
    loop(await makeReader());
  };
  const startBtn = btn("تشغيل الكاميرا والمسح", start);
  const startBox = h("div", { class: "row" }, startBtn);
  key.addEventListener("keydown", (e) => { if (e.key === "Enter" && key.value.trim()) { submit(key.value.trim()); key.value = ""; } });
  // إيقاف الكاميرا عند مغادرة الصفحة أو إخفائها
  document.addEventListener("visibilitychange", () => { if (document.hidden && stream) stop(); });
  const watch = new MutationObserver(() => { if (!box.isConnected && stream) { stop(); watch.disconnect(); } });
  setTimeout(() => watch.observe(document.body, { childList: true, subtree: true }), 0);

  const box = h("div", { class: "gscan" },
    h("div", { class: "gscan-head" }, h("div", {}, h("h2", {}, "بوابة الحضور"),
      sub("امسح رمز QR في بطاقة الطالب عند وصوله: يُسجَّل حضوره ويصل ولي أمره إشعار فوري.")),
      h("div", { class: "gscan-count" }, counter, h("small", {}, "سُجّلوا اليوم"))),
    startBox, frame, result,
    h("div", { class: "row" }, key, btn("تسجيل", () => { if (key.value.trim()) { submit(key.value.trim()); key.value = ""; } }, "ghost")),
    h("h3", { class: "sec-title" }, "آخر من وصل"), recent);
  refresh();
  return box;
}

/** إعدادات البوابة (للإدارة): وقت التأخر، والسماح للمعلمين بالمسح */
export async function gateSettings(base) {
  const all = await api(`${base}/communication/features`);
  const g = all.gate;
  const late = input({ type: "time", value: g.late_after });
  const teacher = h("input", { type: "checkbox", checked: g.teacher_can_scan });
  return h("div", { class: "panel" }, h("h2", {}, "إعدادات البوابة"),
    h("div", { class: "row" },
      h("label", { class: "f" }, h("span", {}, "يُحسب متأخرًا بعد الساعة"), late),
      h("label", { class: "check" }, teacher, h("span", {}, "المعلم المناوب يستطيع المسح من جواله"))),
    btn("حفظ", async () => {
      await api(`${base}/communication/features/gate`, { late_after: late.value, teacher_can_scan: teacher.checked }, "PUT");
      toast("تم الحفظ");
    }, "sm"),
    notice("اطبع بطاقات الطلاب من «أوراق للطباعة»، أو من ملف الطالب «بطاقة ولي الأمر». نفس رمز البطاقة يفتح ملف الطالب لولي الأمر، ويُمسح عند البوابة للحضور.", ""));
}
