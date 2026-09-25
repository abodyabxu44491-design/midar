// المعاينة والطباعة: تُعرض الورقة تمامًا كما ستُطبع (نفس محرك الصفحات)، ولا يُرسل أمر الطباعة
// إلا بزر صريح وبعد الاعتماد. نموذج الإجابة يُجلب من الخادم بصلاحيته المستقلة.
import { h, mount } from "../dom.js";
import { api } from "../api.js";
import { btn, notice, toast, confirmAction, select, empty } from "../ui.js";
import { icons } from "../icons.js";
import { buildVersion, checkPaper, VERSION_CODES, withLayoutDefaults } from "./engine.js";
import { paperBlocks, answerKeyBlocks } from "./render.js";
import { paginate, personalize, printPages } from "./paginate.js";
import { loadMath, paperNeedsMath } from "./math.js";

export const imageUrlFor = (base) => (id) => `${base}/images/${id}`;
export const logoUrlFor = (base, settings, layout) =>
  (settings?.show_logo && settings?.logo_image_id && withLayoutDefaults(layout).show_logo ? `${base}/images/${settings.logo_image_id}` : null);

/**
 * paper: الاختبار كما يعيده الخادم (مع perms)
 * ctx: { base, school, settings, onChanged(status) }
 */
export async function previewPanel(paper, ctx) {
  const { base } = ctx;
  const perms = paper.perms;
  const official = paper.status === "approved" || paper.status === "printed";
  const views = [];
  for (let i = 0; i < paper.versions; i++) views.push([`v${i}`, paper.versions > 1 ? `ورقة الطالب — نموذج ${VERSION_CODES[i]}` : "ورقة الطالب"]);
  if (paper.versions > 1) views.push(["all", "جميع النماذج"]);
  if (perms.answer_key) {
    for (let i = 0; i < paper.versions; i++) views.push([`k${i}`, paper.versions > 1 ? `نموذج الإجابة — ${VERSION_CODES[i]}` : "نموذج الإجابة"]);
    views.push(["both", "الاختبار ونموذج الإجابة معًا"]);
  }
  const view = select(views, { value: "v0", "aria-label": "ما تريد معاينته" });

  // خيارات الطباعة لهذه المرة فقط (لا تغيّر تصميم الاختبار المحفوظ)
  const L0 = withLayoutDefaults(paper.layout);
  const opts = { color: L0.color, show_logo: L0.show_logo, show_marks: L0.show_marks, page_numbers: L0.page_numbers, show_version: L0.show_version };
  const optLabels = { color: "ملوّن", show_logo: "الشعار", show_marks: "الدرجات", page_numbers: "ترقيم الصفحات", show_version: "رقم النموذج" };
  const optBox = h("div", { class: "xb-toggles" }, Object.entries(optLabels).map(([k, l]) =>
    h("label", {}, h("input", { type: "checkbox", checked: opts[k], onchange: (e) => { opts[k] = e.target.checked; render(); } }), l)));
  const perStudent = h("input", { type: "checkbox", disabled: !paper.class_id });
  perStudent.addEventListener("change", () => render());

  const stage = h("div", { class: "xv-stage" });
  const zoomBox = h("div", { class: "xv-zoom" });
  stage.append(zoomBox);
  const counter = h("span", { class: "xv-pg" }, "");
  const status = h("div");
  let pages = [];
  let zoom = 1;
  let roster = null;
  let rendering = null;

  const layout = () => ({ ...paper.layout, ...opts });
  const logo = () => logoUrlFor(base, ctx.settings, layout());

  async function studentPages(index) {
    const version = buildVersion(paper, index);
    const { blocks, running } = paperBlocks({ paper, version, layout: layout(), school: ctx.school, logoUrl: logo(), imageUrl: imageUrlFor(base) });
    return paginate(zoomBox, { blocks, running, layout: layout(), watermark: official ? null : "مسودة — للمعاينة فقط" });
  }
  async function keyPages(index) {
    const key = await api(`${base}/${paper.id}/answer-key?v=${index}`);
    const { blocks, running } = answerKeyBlocks({ paper, key, layout: layout(), school: ctx.school, logoUrl: logo() });
    return paginate(zoomBox, { blocks, running, layout: layout(), watermark: official ? null : "مسودة — للمعاينة فقط" });
  }

  async function render() {
    const run = Symbol("render");
    rendering = run;
    mount(zoomBox, empty("جارٍ تجهيز الصفحات…"));
    zoomBox.style.zoom = "1";
    try {
      if (paperNeedsMath(paper.content)) await loadMath();
      zoomBox.replaceChildren();
      const v = view.value;
      let out = [];
      if (v.startsWith("v") || v === "all") {
        const indexes = v === "all" ? [...Array(paper.versions).keys()] : [Number(v.slice(1))];
        const byVersion = [];
        for (const i of indexes) byVersion[i] = await studentPages(i);
        if (perStudent.checked) {
          roster ??= await api(`${base}/${paper.id}/roster`);
          if (!roster.length) throw new Error("لا يوجد طلاب في هذه الشعبة");
          for (const p of byVersion.flat()) p.remove();
          // توزيع النماذج على الطلاب بالتناوب (A ثم B ثم C…)، أو النموذج المختار للجميع
          roster.forEach((st, n) => {
            const i = v === "all" ? indexes[n % indexes.length] : indexes[0];
            const copy = personalize(byVersion[i], st);
            zoomBox.append(...copy);
            out.push(...copy);
          });
        } else out = byVersion.flat();
      } else if (v.startsWith("k")) {
        out = await keyPages(Number(v.slice(1)));
      } else if (v === "both") {
        for (let i = 0; i < paper.versions; i++) out.push(...(await studentPages(i)));
        for (let i = 0; i < paper.versions; i++) out.push(...(await keyPages(i)));
      }
      if (rendering !== run) return;
      pages = out;
      fit();
      counter.textContent = `${pages.length} صفحة`;
    } catch (e) {
      mount(zoomBox, notice(e.message, "err"));
      pages = [];
    }
  }

  const fit = () => {
    if (!pages.length) return;
    const pw = pages[0].offsetWidth;
    const avail = stage.clientWidth - 16;
    if (zoom === "fit" || (zoom === 1 && pw > avail)) zoom = Math.max(0.3, Math.min(1, avail / pw));
    zoomBox.style.zoom = String(zoom);
  };
  const setZoom = (z) => { zoom = Math.max(0.3, Math.min(2, Math.round(z * 10) / 10)); zoomBox.style.zoom = String(zoom); };
  const current = () => {
    const top = stage.getBoundingClientRect().top;
    let idx = 0;
    pages.forEach((p, i) => { if (p.getBoundingClientRect().top - top < stage.clientHeight / 2) idx = i; });
    return idx;
  };
  const go = (d) => {
    if (!pages.length) return;
    const i = Math.max(0, Math.min(pages.length - 1, current() + d));
    stage.scrollTo({ top: pages[i].offsetTop * zoom - 8, behavior: "smooth" });
    counter.textContent = `صفحة ${i + 1} من ${pages.length}`;
  };
  stage.addEventListener("scroll", () => { if (pages.length) counter.textContent = `صفحة ${current() + 1} من ${pages.length}`; });
  view.addEventListener("change", render);

  const iconBtn = (icon, label, fn) => h("button", { type: "button", class: "btn ghost sm", "aria-label": label, title: label, onclick: fn }, icon);

  // الطباعة: ورقة الطالب تُعلَّم «تمت طباعته» بعد تأكيد المعلم
  async function doPrint(markPrinted = true) {
    if (!pages.length) return;
    await printPages(pages, layout());
    const v = view.value;
    if (markPrinted && (v.startsWith("v") || v === "all" || v === "both") && confirmAction("هل تمت طباعة الاختبار؟ سيُسجَّل الاختبار «تمت طباعته».")) {
      const r = await api(`${base}/${paper.id}/status`, { action: "printed" });
      paper.status = r.status;
      toast("سُجّلت الطباعة");
      ctx.onChanged?.(r.status);
    }
  }
  // كل نموذج في ملف مستقل: نافذة طباعة لكل نموذج بالترتيب
  async function printSeparately() {
    const keep = view.value;
    for (let i = 0; i < paper.versions; i++) {
      view.value = `v${i}`;
      await render();
      toast(`نموذج ${VERSION_CODES[i]}: اختر الطابعة أو «حفظ PDF» باسم النموذج`);
      await printPages(pages, layout());
    }
    view.value = keep;
    await render();
    if (confirmAction("هل تمت طباعة كل النماذج؟")) {
      const r = await api(`${base}/${paper.id}/status`, { action: "printed" });
      paper.status = r.status; ctx.onChanged?.(r.status);
    }
  }

  function actions() {
    const check = checkPaper(paper);
    const row = [];
    if (official && perms.print) {
      row.push(btn("طباعة", () => doPrint(), ""));
      row.push(btn("حفظ PDF", async () => {
        toast("في نافذة الطباعة اختر «حفظ بتنسيق PDF» كوجهة");
        await doPrint(false);
      }, "soft"));
      if (paper.versions > 1) row.push(btn("طباعة النماذج منفصلة", printSeparately, "ghost"));
    } else if (perms.approve) {
      row.push(btn("اعتماد والطباعة", async () => {
        if (check.blocking) return toast(check.issues.find((i) => i.level === "error").text, true);
        const warns = check.issues.filter((i) => i.level === "warn");
        if (!confirmAction(`${warns.length ? `تنبيهات:\n- ${warns.map((w) => w.text).join("\n- ")}\n\n` : ""}اعتماد الاختبار؟ لن يُعدَّل بعد الاعتماد إلا بإعادة فتحه.`)) return;
        const r = await api(`${base}/${paper.id}/status`, { action: "approve" });
        paper.status = r.status;
        ctx.onChanged?.(r.status, { reload: true, thenPrint: true });
      }));
    } else if (perms.submit) {
      row.push(btn("إرسال للإدارة للاعتماد", async () => {
        const r = await api(`${base}/${paper.id}/status`, { action: "ready" });
        paper.status = r.status; toast("أُرسل للاعتماد"); ctx.onChanged?.(r.status, { reload: true });
      }));
    }
    return row;
  }

  const hint = official ? null : notice(paper.status === "ready" && !perms.approve
    ? "الاختبار بانتظار اعتماد الإدارة. المعاينة متاحة، والطباعة الرسمية بعد الاعتماد."
    : "هذه معاينة. الطباعة الرسمية بعد اعتماد الاختبار (الاعتماد يقفل الاختبار من التعديل).", "warn");

  const bar = h("div", { class: "xv-bar" },
    h("div", { class: "row2" }, view,
      paper.class_id ? h("label", { class: "row", style: "align-items:center;gap:6px;flex:none;font-size:14px" }, perStudent,
        paper.versions > 1 ? "أوراق بأسماء الطلاب (النماذج بالتناوب)" : "أوراق بأسماء طلاب الشعبة") : null,
      h("span", { style: "flex:1" }),
      iconBtn(icons.up({ size: 16 }), "الصفحة السابقة", () => go(-1)), counter, iconBtn(icons.down({ size: 16 }), "الصفحة التالية", () => go(1)),
      iconBtn(h("b", {}, "−"), "تصغير", () => setZoom(zoom - 0.1)), iconBtn(h("b", {}, "+"), "تكبير", () => setZoom(zoom + 0.1)),
      btn("ملء العرض", () => { zoom = "fit"; fit(); }, "ghost sm")),
    h("details", {}, h("summary", { class: "small", style: "cursor:pointer" }, "خيارات الطباعة لهذه المرة"), optBox),
    status, h("div", { class: "row2" }, actions()));

  const root = h("div", { class: "xv" }, bar, hint, stage);
  // الرسم بعد إضافة اللوحة للصفحة (القياس يحتاج عناصر ظاهرة)
  queueMicrotask(async () => { await waitConnected(root); await render(); if (ctx.autoPrint && official && perms.print) doPrint(); });
  return root;
}

function waitConnected(el) {
  return new Promise((res) => {
    const tick = () => (el.isConnected && el.offsetWidth ? res() : requestAnimationFrame(tick));
    tick();
  });
}
