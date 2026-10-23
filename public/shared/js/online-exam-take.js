/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "./dom.js";
import { btn, sub, toast, notice, textarea, input, field, confirmAction } from "./ui.js";
import { rich } from "./exam/math.js";

// A video-site link played inside the question (no cookies for YouTube).
export function embedUrl(url) {
  const yt = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/i.exec(url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0`;
  const vm = /vimeo\.com\/(?:video\/)?(\d{5,12})/i.exec(url);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  const gd = /drive\.google\.com\/file\/d\/([\w-]{10,80})/i.exec(url);
  if (gd) return `https://drive.google.com/file/d/${gd[1]}/preview`;
  return null;
}

// A photo of a written solution, made small enough to send quickly from a phone.
async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bitmap.width * scale); c.height = Math.round(bitmap.height * scale);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bitmap, 0, 0, c.width, c.height);
  const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.82));
  return blob;
}
const blobBase64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1]);
  r.onerror = rej;
  r.readAsDataURL(blob);
});

const RULE = (t) => h("li", {}, t);
const fmtMin = (n) => `${n} ${n >= 3 && n <= 10 ? "دقائق" : "دقيقة"}`;

/**
 * @param {{ call: (path:string, body?:object) => Promise<any>, fetchFile?: (path:string, body?:object) => Promise<Blob>, id: number,
 *   onExit: () => void, info?: any }} o
 */
export async function takeExam({ call, fetchFile, id, onExit, info }) {
  // Before the clock starts: what the exam is, its rules, and the entry code if the teacher set one.
  if (info && info.state === "open") {
    const st = info.settings || {};
    const wrap = h("div", { class: "oe-take" });
    const code = st.needs_code ? input({ class: "ltr oe-code", maxLength: 12, placeholder: "رمز الدخول", autocomplete: "off", "aria-label": "رمز الدخول" }) : null;
    const msg = h("div");
    const go = btn("ابدأ الاختبار الآن", async () => {
      if (code && !code.value.trim()) { code.focus(); return mount(msg, notice("اكتب رمز الدخول الذي أعطاك إياه المعلم", "warn")); }
      go.disabled = true;
      try { mount(wrap, await run(code ? code.value.trim() : undefined)); wrap.scrollIntoView({ behavior: "smooth" }); }
      catch (e) { go.disabled = false; mount(msg, notice(e.message, "err")); }
    }, "primary wide");
    mount(wrap, h("section", { class: "panel oe-start" },
      h("h2", {}, info.title), sub(info.subject || ""),
      h("div", { class: "oe-start-facts" },
        h("div", {}, h("b", {}, String(info.question_count ?? "—")), h("small", {}, "سؤال")),
        h("div", {}, h("b", {}, String(info.duration_min)), h("small", {}, "دقيقة")),
        h("div", {}, h("b", {}, String(info.max_score)), h("small", {}, "درجة"))),
      info.instructions ? notice(info.instructions, "") : null,
      h("h3", { class: "oe-start-h" }, "قبل أن تبدأ"),
      h("ul", { class: "oe-rules" },
        RULE(`يبدأ العدّاد (${fmtMin(info.duration_min)}) عند الضغط على «ابدأ» ولا يتوقف، ويُسلَّم الاختبار تلقائيًا عند انتهاء الوقت.`),
        RULE(st.layout === "one" ? "يظهر سؤال واحد في كل صفحة، وتنتقل بزر «التالي»." : st.layout === "section" ? "يظهر كل قسم في صفحة، وتنتقل بزر «التالي»." : "تظهر الأسئلة كلها في صفحة واحدة."),
        st.no_back ? RULE("لا يمكن الرجوع إلى صفحة بعد الانتقال منها، فراجع إجابتك قبل «التالي».") : RULE("يمكنك الرجوع لأي سؤال، وتعليم السؤال لتراجعه قبل التسليم."),
        RULE("إجاباتك تُحفظ تلقائيًا، وإن انقطع الاتصال تُحفظ على جهازك وتُرسل عند عودته."),
        st.max_leaves ? RULE(`الخروج من صفحة الاختبار يُسجَّل، وبعد ${st.max_leaves} ${st.max_leaves === 1 ? "مرة" : "مرات"} يُسلَّم اختبارك تلقائيًا.`)
          : RULE("الخروج من صفحة الاختبار إلى تطبيق آخر يُسجَّل ويراه المعلم.")),
      code ? field("رمز الدخول", code, "يعطيك إياه المعلم في الفصل") : null,
      msg, go,
      btn("رجوع", onExit, "ghost")));
    return wrap;
  }
  return run();

  async function run(accessCode) {
  const d = await call(`/student/online-exams/${id}/start`, accessCode ? { access_code: accessCode } : undefined);
  const st = d.settings || { layout: "all" };
  const LOCAL = `midar-oe-ans:${d.attempt_id}`;
  let local = null;
  try { local = JSON.parse(localStorage.getItem(LOCAL) || "null"); } catch { /* storage unavailable */ }
  const answers = { ...(d.answers || {}), ...(local?.answers || {}) };
  const flags = new Set(d.events?.flags || []);
  const offset = Date.now() - new Date(d.server_now).getTime();
  const deadline = new Date(d.deadline_at).getTime() + offset;
  const qs = d.content.sections.flatMap((s) => s.questions.map((q) => ({ ...q, section: s })));
  const number = new Map(qs.map((q, i) => [q.id, i + 1]));
  const pages = st.layout === "all" ? [qs] : st.layout === "section"
    ? d.content.sections.filter((s) => s.questions.length).map((s) => qs.filter((q) => q.section === s))
    : qs.map((q) => [q]);
  let page = Math.min(Number(d.events?.page) || 0, pages.length - 1);
  let maxPage = Math.max(page, Number(d.events?.max_page) || 0);
  let reviewing = false;
  let dirty = !!local, saving = false, finished = false;
  const warned = new Set();

  const root = h("div", { class: "oe-take" });
  const timer = h("b", { class: "oe-timer", role: "timer", "aria-live": "off" });
  const status = h("small", { class: "muted oe-status" });
  const progress = h("small", { class: "muted" });
  const bar = h("i");
  const keepLocal = () => { try { localStorage.setItem(LOCAL, JSON.stringify({ answers, at: Date.now() })); } catch { /* storage unavailable */ } };
  const changed = () => { dirty = true; keepLocal(); mount(status, "لم يُحفظ بعد"); drawProgress(); drawMap(); };
  const answered = (q) => {
    const a = answers[q.id];
    if (a === undefined || a === null || a === "") return false;
    if (Array.isArray(a)) return a.some((x) => x !== "" && x !== null && x !== undefined);
    if (typeof a === "object") return Object.keys(a).length > 0;
    return true;
  };
  const drawProgress = () => {
    const n = qs.filter(answered).length;
    mount(progress, `أجبت ${n} من ${qs.length}`);
    bar.style.width = `${Math.round((n / Math.max(1, qs.length)) * 100)}%`;
  };

  const save = async (force = false) => {
    if ((!dirty && !force) || saving || finished) return;
    saving = true;
    try {
      await call(`/student/online-exams/${id}/save`, { answers, page, flags: [...flags] });
      dirty = false; mount(status, "حُفظت إجاباتك");
      try { localStorage.removeItem(LOCAL); } catch { /* storage unavailable */ }
    } catch (e) { mount(status, navigator.onLine ? e.message : "غير متصل: إجاباتك محفوظة على جهازك وتُرسل عند عودة الاتصال"); }
    finally { saving = false; }
  };
  const done = (r, auto, why) => {
    finished = true;
    clearInterval(tick); clearInterval(autosave);
    document.removeEventListener("visibilitychange", onVisibility);
    try { localStorage.removeItem(LOCAL); } catch { /* storage unavailable */ }
    mount(root, h("section", { class: "panel oe-done" },
      h("h2", {}, why || (auto ? "انتهى الوقت وسُلّم الاختبار" : "سُلّم الاختبار")),
      r?.score !== null && r?.score !== undefined ? h("p", { class: "oe-score" }, `درجتك: ${r.score} من ${r.max_score}`)
        : r?.pending ? sub("ستظهر درجتك بعد تصحيح المعلم للأسئلة المقالية.") : sub("تظهر النتيجة حسب ما تحدده المدرسة."),
      btn("رجوع لملف الطالب", onExit)));
  };
  const submit = async (auto = false) => {
    if (finished) return;
    if (!auto) {
      const left = qs.filter((q) => !answered(q)).length;
      if (!confirmAction(left ? `بقي ${left} سؤال بلا إجابة. تسليم الاختبار الآن؟` : "تسليم الاختبار الآن؟ لا يمكن التعديل بعده.")) return;
    }
    finished = true;
    try { done(await call(`/student/online-exams/${id}/submit`, { answers, page, flags: [...flags] }), auto); }
    catch (e) { finished = false; toast(e.message, true); }
  };

  const tick = setInterval(() => {
    const left = Math.max(0, deadline - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    timer.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    timer.classList.toggle("low", left < 120000);
    for (const [mins, text] of [[5, "بقيت 5 دقائق على نهاية الاختبار"], [1, "بقيت دقيقة واحدة. راجع إجاباتك وسلّم"]]) {
      if (left <= mins * 60000 && left > (mins * 60000) - 5000 && !warned.has(mins)) { warned.add(mins); toast(text); }
    }
    if (left <= 0) submit(true);
  }, 500);
  const autosave = setInterval(() => save(), 15000);
  // Leaving the exam page is counted (and, past the teacher's limit, submits the exam).
  let away = false;
  const onVisibility = async () => {
    if (finished) return;
    if (document.hidden) { away = true; save(); return; }
    if (!away) return;
    away = false;
    try {
      const r = await call(`/student/online-exams/${id}/leave`);
      if (r.submitted) return done(r.result, true, "سُلّم الاختبار لأنك خرجت من صفحته أكثر من المسموح");
      toast(r.max ? `خرجت من صفحة الاختبار (${r.leaves} من ${r.max}). عند تجاوز الحد يُسلَّم تلقائيًا.` : `سُجّل خروجك من صفحة الاختبار (${r.leaves})`, true);
    } catch { /* offline: counted next time */ }
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", () => save(true));

  const imageCache = new Map();
  const loadImage = (imageId, img) => {
    const load = imageCache.get(imageId) || call(`/student/online-exams/${id}/image`, { image_id: imageId }).then((r) => r.src);
    imageCache.set(imageId, load);
    load.then((src) => { img.src = src; }).catch(() => {});
    return img;
  };
  const image = (q) => (q.image?.id ? loadImage(q.image.id, h("img", { class: "oe-img", alt: "", style: `max-width:${q.image.width || 60}%` })) : null);
  const optImage = (o) => (o.image?.id ? loadImage(o.image.id, h("img", { class: "oe-opt-img", alt: "" })) : null);

  // The question's sound or video. A limited number of plays is counted on this device.
  const playsKey = (q) => `midar-oe-plays:${d.attempt_id}:${q.id}`;
  const playsUsed = (q) => { try { return Number(localStorage.getItem(playsKey(q))) || 0; } catch { return 0; } };
  const media = (q) => {
    const m = q.media;
    if (!m) return null;
    if (m.url) {
      const src = embedUrl(m.url);
      return h("div", { class: "oe-media" }, src
        ? h("iframe", { src, title: "فيديو السؤال", allow: "encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true, loading: "lazy", referrerpolicy: "strict-origin-when-cross-origin" })
        : h("a", { href: m.url, target: "_blank", rel: "noopener" }, "فتح الفيديو"));
    }
    const el = h(m.kind === "video" ? "video" : "audio", { controls: true, preload: "none", playsinline: true, controlsList: "nodownload" });
    const left = h("small", { class: "muted oe-plays" });
    const paintLeft = () => { if (m.plays) left.textContent = `يمكنك التشغيل ${m.plays} ${m.plays === 1 ? "مرة" : "مرات"} — بقي ${Math.max(0, m.plays - playsUsed(q))}`; };
    let started = false;
    el.addEventListener("play", () => {
      if (started) return;
      if (m.plays && playsUsed(q) >= m.plays) { el.pause(); toast("انتهت مرات التشغيل المسموحة لهذا المقطع", true); return; }
      started = true;
      if (m.plays) { try { localStorage.setItem(playsKey(q), String(playsUsed(q) + 1)); } catch { /* ignore */ } paintLeft(); }
    });
    el.addEventListener("ended", () => { started = false; });
    if (fetchFile) {
      fetchFile(`/student/online-exams/${id}/media`, { media_id: m.id })
        .then((blob) => { el.src = URL.createObjectURL(blob); })
        .catch(() => { left.textContent = "تعذّر تحميل المقطع. تحقق من الاتصال ثم أعد فتح الاختبار."; });
    }
    paintLeft();
    return h("div", { class: "oe-media" }, el, left);
  };

  // Answering with a photo of the solution or a voice recording; the file is sent right away and kept with the attempt.
  const sendFile = async (q, blob, kind) => {
    const mime = (blob.type || (kind === "image" ? "image/jpeg" : "audio/webm")).split(";")[0];
    await call(`/student/online-exams/${id}/answer-file`, { question_id: q.id, mime, data: await blobBase64(blob) });
    answers[q.id] = { file: kind };
    changed(); save();
  };
  const savedFile = (q, kind, box) => {
    if (!fetchFile || !answers[q.id]?.file) return;
    fetchFile(`/student/online-exams/${id}/answer-file/view`, { question_id: q.id }).then((blob) => {
      const url = URL.createObjectURL(blob);
      box.replaceChildren(kind === "image" ? h("img", { src: url, alt: "صورة الحل" }) : h("audio", { src: url, controls: true }));
    }).catch(() => {});
  };
  const photoAnswer = (q) => {
    const shown = h("div");
    const note = h("small", { class: "muted" }, answers[q.id]?.file ? "رُفعت صورة الحل. يمكنك تغييرها." : "صوّر حلك على الورقة بوضوح ثم ارفعه.");
    const fileIn = h("input", { type: "file", accept: "image/*", capture: "environment", class: "hidden" });
    fileIn.addEventListener("change", async () => {
      const f = fileIn.files[0];
      fileIn.value = "";
      if (!f) return;
      try {
        note.textContent = "جارٍ رفع الصورة…";
        const blob = await shrinkPhoto(f);
        shown.replaceChildren(h("img", { src: URL.createObjectURL(blob), alt: "صورة الحل" }));
        await sendFile(q, blob, "image");
        note.textContent = "رُفعت صورة الحل. يمكنك تغييرها.";
      } catch (e) { note.textContent = e.message || "تعذّر رفع الصورة"; }
    });
    savedFile(q, "image", shown);
    return h("div", { class: "oe-file" }, shown, note, btn(answers[q.id]?.file ? "تغيير الصورة" : "تصوير الحل أو اختيار صورة", () => fileIn.click(), "ghost"), fileIn);
  };
  const voiceAnswer = (q) => {
    const MAX_SEC = 180;
    const shown = h("div");
    const time = h("span", { class: "oe-rec-time" });
    const note = h("small", { class: "muted" }, answers[q.id]?.file ? "حُفظ تسجيلك. يمكنك إعادة التسجيل." : `سجّل إجابتك بصوتك (حتى ${MAX_SEC / 60} دقائق).`);
    let rec = null, chunks = [], timer = null, secs = 0;
    const startBtn = btn("ابدأ التسجيل", () => start(), "");
    const stopBtn = btn("إيقاف وحفظ", () => rec?.stop(), "ghost");
    stopBtn.hidden = true;
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { note.textContent = "هذا المتصفح لا يدعم التسجيل الصوتي. افتح الاختبار من متصفح الجوال الحديث."; return; }
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch { note.textContent = "اسمح باستخدام الميكروفون من إعدادات المتصفح ثم أعد المحاولة."; return; }
      chunks = []; secs = 0;
      rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        clearInterval(timer); stream.getTracks().forEach((t) => t.stop());
        startBtn.hidden = false; stopBtn.hidden = true; startBtn.textContent = "إعادة التسجيل"; time.textContent = "";
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        shown.replaceChildren(h("audio", { src: URL.createObjectURL(blob), controls: true }));
        try { note.textContent = "جارٍ حفظ التسجيل…"; await sendFile(q, blob, "audio"); note.textContent = "حُفظ تسجيلك. يمكنك إعادة التسجيل."; }
        catch (e) { note.textContent = e.message || "تعذّر حفظ التسجيل"; }
      };
      rec.start(1000);
      startBtn.hidden = true; stopBtn.hidden = false;
      const paint = () => { time.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`; };
      paint();
      timer = setInterval(() => { secs++; paint(); if (secs >= MAX_SEC) rec.stop(); }, 1000);
    };
    savedFile(q, "audio", shown);
    return h("div", { class: "oe-file" }, shown, h("div", { class: "oe-rec" }, startBtn, stopBtn, time), note);
  };

  const withImages = (q) => (q.options || []).some((o) => o.image?.id);
  const control = (q) => {
    switch (q.type) {
      case "mcq": return h("div", { class: `oe-choices${withImages(q) ? " with-img" : ""}` }, (q.options || []).map((o) => h("label", {},
        h("input", { type: "radio", name: q.id, checked: answers[q.id] === o.id, onchange: () => { answers[q.id] = o.id; changed(); } }), optImage(o), h("span", {}, rich(o.text)))));
      case "multi": return h("div", { class: `oe-choices${withImages(q) ? " with-img" : ""}` }, (q.options || []).map((o) => h("label", {},
        h("input", { type: "checkbox", checked: (answers[q.id] || []).includes(o.id), onchange: (e) => {
          const set = new Set(answers[q.id] || []); e.target.checked ? set.add(o.id) : set.delete(o.id); answers[q.id] = [...set]; changed(); } }),
        optImage(o), h("span", {}, rich(o.text)))));
      case "truefalse": return h("div", { class: "oe-choices tf" }, [[true, "صح"], [false, "خطأ"]].map(([v, l]) => h("label", {},
        h("input", { type: "radio", name: q.id, checked: answers[q.id] === v, onchange: () => { answers[q.id] = v; changed(); } }), h("span", {}, l))));
      case "fill": {
        const cur = answers[q.id] || [];
        return h("div", { class: "oe-fill" }, Array.from({ length: q.blanks || 1 }, (_, i) => {
          const el = input({ value: cur[i] || "", placeholder: `الفراغ ${i + 1}` });
          el.addEventListener("input", () => { const a = [...(answers[q.id] || [])]; a[i] = el.value; answers[q.id] = a; changed(); });
          return el;
        }));
      }
      case "match": return h("div", { class: "oe-match" }, (q.left || []).map((l) => {
        const sel = h("select", {}, h("option", { value: "" }, "اختر…"), (q.right || []).map((r) => h("option", { value: r.id, selected: answers[q.id]?.[l.id] === r.id }, r.text)));
        sel.addEventListener("change", () => { answers[q.id] = { ...(answers[q.id] || {}), [l.id]: sel.value || undefined }; changed(); });
        return h("div", { class: "oe-match-row" }, h("span", {}, rich(l.text)), sel);
      }));
      case "order": {
        let order = answers[q.id] && answers[q.id].length === (q.items || []).length ? answers[q.id] : (q.items || []).map((x) => x.id);
        const box = h("ol", { class: "oe-order" });
        const draw = () => mount(box, order.map((oid, i) => h("li", {}, h("span", {}, (q.items || []).find((x) => x.id === oid)?.text || ""),
          h("span", { class: "oe-order-btns" },
            btn("أعلى", () => { if (i) { [order[i - 1], order[i]] = [order[i], order[i - 1]]; answers[q.id] = [...order]; changed(); draw(); } }, "ghost sm"),
            btn("أسفل", () => { if (i < order.length - 1) { [order[i + 1], order[i]] = [order[i], order[i + 1]]; answers[q.id] = [...order]; changed(); draw(); } }, "ghost sm")))));
        draw();
        return box;
      }
      default: {
        if (q.respond === "image") return photoAnswer(q);
        if (q.respond === "audio") return voiceAnswer(q);
        const t = textarea({ rows: q.type === "essay" ? 6 : 3, value: answers[q.id] || "", maxLength: 4000, placeholder: "اكتب إجابتك هنا" });
        t.addEventListener("input", () => { answers[q.id] = t.value; changed(); });
        return t;
      }
    }
  };

  const tableEl = (tb) => (tb?.rows?.length ? h("table", { class: "oe-table" }, tb.rows.map((row, ri) => h("tr", {},
    row.filter((c) => !c.hide).map((c) => h(tb.header && ri === 0 ? "th" : "td", { colspan: c.cs || 1, rowspan: c.rs || 1 }, c.t))))) : null);

  // One question card: number, marks, a flag to come back to it, the text, its media and the answer.
  const card = (q) => {
    const i = number.get(q.id);
    const flag = h("button", { type: "button", class: `oe-flag${flags.has(q.id) ? " on" : ""}`, "aria-pressed": String(flags.has(q.id)),
      onclick: () => { flags.has(q.id) ? flags.delete(q.id) : flags.add(q.id); flag.classList.toggle("on", flags.has(q.id));
        flag.setAttribute("aria-pressed", String(flags.has(q.id))); flag.textContent = flags.has(q.id) ? "معلَّم للمراجعة" : "علّمه للمراجعة"; drawMap(); save(true); } },
    flags.has(q.id) ? "معلَّم للمراجعة" : "علّمه للمراجعة");
    return h("article", { class: "oe-question", id: `oe-q-${q.id}` },
      h("div", { class: "oe-qhead" }, h("b", {}, `السؤال ${i}`), h("small", { class: "muted" }, `${q.marks} ${q.marks === 1 ? "درجة" : "درجات"}`), flag),
      q.image?.position === "before" ? image(q) : null,
      h("div", { class: "oe-qtext" }, rich(q.text, { blanks: q.type === "fill" })),
      media(q),
      tableEl(q.table),
      q.image && q.image.position !== "before" ? image(q) : null,
      control(q));
  };
  const sectionHead = (sec) => (sec.title || sec.instructions
    ? h("div", { class: "oe-section" }, sec.title ? h("h3", {}, sec.title) : null, sec.instructions ? sub(sec.instructions) : null) : null);

  // The map of all questions: answered, flagged, the current page; tap to jump (forward only when going back is off).
  const mapBox = h("div", { class: "oe-map", hidden: true });
  const pageOf = (q) => pages.findIndex((pg) => pg.includes(q));
  const canGo = (p) => !st.no_back || p >= page;
  const drawMap = () => {
    if (pages.length < 2) return;
    mount(mapBox, h("div", { class: "oe-map-grid" }, qs.map((q) => {
      const p = pageOf(q);
      return h("button", { type: "button", disabled: !canGo(p) || reviewing && st.no_back,
        class: `${answered(q) ? "done" : ""}${flags.has(q.id) ? " flag" : ""}${!reviewing && p === page ? " here" : ""}`,
        "aria-label": `السؤال ${number.get(q.id)}${answered(q) ? "، مُجاب" : ""}${flags.has(q.id) ? "، معلَّم" : ""}`,
        onclick: () => { mapBox.hidden = true; goto(p); } }, String(number.get(q.id)));
    })), h("div", { class: "oe-map-key" }, h("span", { class: "k done" }, "مُجاب"), h("span", { class: "k flag" }, "معلَّم"), h("span", { class: "k" }, "لم يُجب")));
  };
  const mapBtn = pages.length > 1 ? btn("الأسئلة", () => { mapBox.hidden = !mapBox.hidden; drawMap(); }, "ghost sm") : null;

  const body = h("div", { class: "oe-page" });
  const nav = h("div", { class: "oe-nav" });
  const goto = (p) => {
    if (finished) return;
    if (!canGo(p) && !reviewing) return;
    reviewing = false;
    page = Math.max(0, Math.min(p, pages.length - 1));
    maxPage = Math.max(maxPage, page);
    draw();
    save(true);
    root.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const review = () => {
    reviewing = true;
    maxPage = pages.length;
    const left = qs.filter((q) => !answered(q)), marked = qs.filter((q) => flags.has(q.id));
    const jump = (q) => h("button", { type: "button", class: "oe-jump", disabled: st.no_back, onclick: () => goto(pageOf(q)) }, `السؤال ${number.get(q.id)}`);
    mount(body, h("section", { class: "panel oe-review-page" },
      h("h2", {}, "مراجعة قبل التسليم"),
      h("div", { class: "oe-start-facts" },
        h("div", {}, h("b", {}, String(qs.length - left.length)), h("small", {}, "مُجاب")),
        h("div", { class: left.length ? "warn" : "" }, h("b", {}, String(left.length)), h("small", {}, "بلا إجابة")),
        h("div", {}, h("b", {}, String(marked.length)), h("small", {}, "معلَّم للمراجعة"))),
      left.length ? h("div", {}, h("b", {}, "أسئلة بلا إجابة"), h("div", { class: "oe-jumps" }, left.map(jump))) : notice("أجبت عن كل الأسئلة.", ""),
      marked.length ? h("div", {}, h("b", {}, "أسئلة علّمتها للمراجعة"), h("div", { class: "oe-jumps" }, marked.map(jump))) : null,
      st.no_back ? sub("الرجوع للأسئلة غير متاح في هذا الاختبار.") : sub("اضغط رقم السؤال للرجوع إليه."),
      h("div", { class: "oe-submit" }, btn("تسليم الاختبار", () => submit(false), "primary wide"))));
    mount(nav, !st.no_back ? btn("رجوع للأسئلة", () => goto(pages.length - 1), "ghost") : null);
    drawMap();
    save(true);
  };
  const draw = () => {
    const list = pages[page];
    let last = null;
    mount(body, page === 0 && d.instructions ? notice(d.instructions, "") : null, list.map((q) => {
      const head = q.section !== last && (st.layout !== "one" || q === list[0]) ? sectionHead(q.section) : null;
      last = q.section;
      return [head, card(q)];
    }));
    const isLast = page === pages.length - 1;
    mount(nav,
      pages.length > 1 ? h("span", { class: "oe-pageno" }, `${st.layout === "section" ? "القسم" : st.layout === "one" ? "السؤال" : "الصفحة"} ${page + 1} من ${pages.length}`) : null,
      h("div", { class: "oe-nav-btns" },
        page > 0 && !st.no_back ? btn("السابق", () => goto(page - 1), "ghost") : null,
        isLast ? btn(pages.length > 1 ? "مراجعة وتسليم" : "تسليم الاختبار", () => (pages.length > 1 ? review() : submit(false)), "primary")
          : btn("التالي", () => {
            if (st.no_back && list.some((q) => !answered(q)) && !confirmAction("في هذه الصفحة سؤال بلا إجابة، ولن تستطيع الرجوع إليها. الانتقال؟")) return;
            goto(page + 1);
          }, "primary")));
    drawMap();
  };

  // Text size for small screens and weak eyesight.
  let size = 1;
  const zoom = (dz) => { size = Math.min(1.4, Math.max(0.9, size + dz)); root.style.setProperty("--oe-scale", String(size)); };

  mount(root,
    h("div", { class: "oe-bar" },
      h("div", {}, h("b", {}, d.title), progress),
      h("div", { class: "oe-bar-side" }, status, timer)),
    h("div", { class: "oe-progress" }, bar),
    h("div", { class: "oe-tools" }, mapBtn, btn("أ+", () => zoom(0.1), "ghost sm"), btn("أ-", () => zoom(-0.1), "ghost sm")),
    mapBox,
    body, nav);
  drawProgress();
  if (dirty) save(true);
  if (maxPage >= pages.length) review(); else draw();
  return root;
  }
}
