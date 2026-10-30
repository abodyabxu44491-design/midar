/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, textarea, btn, empty, badge, line, sub, stats, toast, notice, switchBtn, dialog, confirmAction } from "../../shared/js/ui.js";
import { fmtDate, fmtDateTime, money, today } from "../../shared/js/format.js";
import { partsView } from "../../shared/js/parts.js";
import { A } from "./common.js";

const S = () => `${A}/services`;
const DIR = { both: "ذهابًا وإيابًا", to_school: "إلى المدرسة فقط", from_school: "من المدرسة فقط" };
const EV = [["boarded", "صعد"], ["arrived", "وصل المدرسة"], ["left", "غادر المدرسة"], ["dropped", "نزل عند محطته"], ["absent", "لم يحضر"]];
const MOVE = { in: "إضافة للمخزون", out: "صرف", custody: "تسليم عهدة", return: "إرجاع عهدة", adjust: "جرد (الكمية الفعلية)" };

async function studentPicker() {
  const classes = await api(`${A}/structure/classes`);
  const cls = select([["", "اختر الشعبة"], ...classes.map((c) => [c.id, c.name])]);
  const st = select([["", "اختر الطالب"]]);
  cls.addEventListener("change", async () => {
    mount(st, h("option", { value: "" }, "اختر الطالب"));
    if (!cls.value) return;
    const list = await api(`${A}/students?class_id=${cls.value}&fields=basic&limit=500`);
    st.append(...list.map((x) => h("option", { value: x.id }, x.name || x.full_name)));
  });
  return { cls, st, classes };
}

export default async function services({ me }) {
  const m = me.modules || {};
  const parts = [];
  if (m.transport) parts.push(["transport", "النقل المدرسي"]);
  if (m.library) parts.push(["library", "المكتبة"]);
  if (m.inventory) parts.push(["inventory", "العهد والمخزون"]);
  if (m.clinic) parts.push(["clinic", "العيادة"]);
  return partsView(parts, (p, nav) => ({ transport, library, inventory, clinic })[p](nav));
}

async function transport(nav) {
  const list = await api(`${S()}/transport`);
  const busForm = (b) => {
    const f = { name: input({ value: b?.name || "" }), plate: input({ value: b?.plate || "", class: "ltr" }), driver_name: input({ value: b?.driver_name || "" }),
      driver_phone: input({ value: b?.driver_phone || "", class: "ltr", inputMode: "tel" }), supervisor: input({ value: b?.supervisor || "" }),
      capacity: input({ type: "number", min: 1, value: b?.capacity ?? "", class: "ltr" }), fee: input({ type: "number", min: 0, value: b?.fee ?? "", class: "ltr" }),
      route: textarea({ rows: 2, value: b?.route || "", placeholder: "المحطات بالترتيب" }) };
    const d = dialog(b ? `تعديل ${b.name}` : "حافلة أو خط جديد", h("div", {},
      h("div", { class: "row" }, field("الاسم أو الخط", f.name), field("رقم اللوحة", f.plate)),
      h("div", { class: "row" }, field("السائق", f.driver_name), field("جوال السائق", f.driver_phone)),
      h("div", { class: "row" }, field("المشرف", f.supervisor), field("السعة", f.capacity), field("رسوم النقل", f.fee, "للطالب في الفصل")), field("خط السير", f.route)),
    [btn("حفظ", async () => {
      const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
      if (b) await api(`${S()}/transport/${b.id}`, body, "PUT"); else await api(`${S()}/transport`, body);
      d.close(); toast("تم الحفظ"); nav.show();
    })]);
  };
  const busView = async (b) => {
    const riders = await api(`${S()}/transport/${b.id}/riders`);
    const dayEvents = await api(`${S()}/transport/${b.id}/day?day=${today()}`);
    const { cls, st } = await studentPicker();
    const stop = input({ placeholder: "المحطة" }), time = input({ placeholder: "وقت المرور", class: "ltr" });
    const dir = select(Object.entries(DIR));
    const chosen = new Set();
    const evBox = h("div");
    const drawEvents = () => mount(evBox, riders.length ? [
      h("div", { class: "spaced", style: "justify-content:flex-start;flex-wrap:wrap;gap:6px" }, EV.map(([k, label]) => btn(label, async () => {
        if (!chosen.size) return toast("حدد الطلاب أولًا", true);
        const r = await api(`${S()}/transport/${b.id}/events`, { kind: k, student_ids: [...chosen] });
        toast(`سُجّل لـ ${r.recorded} وأُشعر أولياء أمورهم`); body(b);
      }, "sm"))),
      h("div", { class: "beh-pick" }, riders.map((r) => {
        const done = dayEvents.filter((e) => Number(e.student_id) === Number(r.student_id)).map((e) => EV.find(([k]) => k === e.kind)?.[1]).join("، ");
        return h("label", {}, h("input", { type: "checkbox", onchange: (e) => (e.target.checked ? chosen.add(r.student_id) : chosen.delete(r.student_id)) }),
          h("span", {}, r.name, h("small", { class: "sub" }, ` ${r.stop || ""}${done ? ` — ${done}` : ""}`)));
      }))] : empty("لا يوجد ركاب بعد."));
    drawEvents();
    return [
      h("div", { class: "toolbar" }, btn("رجوع", () => nav.show(), "ghost sm"), btn("تعديل", () => busForm(b), "ghost sm"),
        b.fee ? btn(`إصدار فواتير النقل (${money(b.fee)})`, async () => {
          if (!confirmAction(`إصدار فاتورة ${money(b.fee)} لكل ركاب ${b.name}؟`)) return;
          const r = await api(`${S()}/transport/${b.id}/bill`, {}); toast(`أُصدرت ${r.invoices} فاتورة`);
        }, "ghost sm") : null, btn("طباعة الكشف", () => window.print(), "ghost sm")),
      panel(`${b.name} — اليوم`, null, sub("حدد الطلاب ثم اضغط الحدث، ويصل إشعار لولي أمر كل طالب."), evBox),
      panel(`الركاب (${riders.length}${b.capacity ? ` من ${b.capacity}` : ""})`, null,
        riders.map((r) => line(h("div", {}, h("b", {}, r.name), sub([r.class_name, r.stop, DIR[r.direction], r.pickup_time].filter(Boolean).join(" — "))),
          btn("إزالة", async () => { await api(`${S()}/transport/riders/${r.student_id}`, undefined, "DELETE"); body(b); }, "ghost sm"))),
        h("h3", { class: "sec-title" }, "إضافة طالب"),
        h("div", { class: "row" }, field("الشعبة", cls), field("الطالب", st)), h("div", { class: "row" }, field("المحطة", stop), field("الاتجاه", dir), field("الوقت", time)),
        btn("إضافة للحافلة", async () => {
          if (!st.value) return toast("اختر الطالب", true);
          await api(`${S()}/transport/${b.id}/riders`, { student_ids: [Number(st.value)], stop: stop.value.trim() || null, direction: dir.value, pickup_time: time.value.trim() || null });
          toast("أُضيف"); body(b);
        })),
    ];
  };
  const root = h("div");
  const body = async (b) => mount(root, await busView(b));
  mount(root, panel("الحافلات وخطوط النقل", btn("+ حافلة", () => busForm(null), "sm"),
    list.length ? list.map((b) => line(h("div", {}, h("b", {}, b.name), " ", b.is_active ? null : badge("موقوفة", "gray"),
      sub([b.driver_name ? `السائق ${b.driver_name}` : null, `${b.riders}${b.capacity ? ` / ${b.capacity}` : ""} طالب`, b.fee ? money(b.fee) : null].filter(Boolean).join(" — "))),
      btn("فتح", () => body(b), "sm"))) : empty("أضف أول حافلة أو خط نقل."),
    line(h("div", {}, h("b", {}, "إشعار ولي الأمر بالصعود والنزول")), await setSwitch("transport", "notify_parent"))));
  return root;
}

async function setSwitch(section, key) {
  const s = (await api(`${A}/communication/features`))[section];
  return switchBtn(s[key], key, async (v) => { await api(`${A}/communication/features/${section}`, { [key]: v }, "PUT"); toast("تم الحفظ"); return true; });
}

// Reads a chosen cover photo as a data URL (the page allows data: images), scaled to a sensible size.
async function coverData(file) {
  const src = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("تعذر قراءة الصورة")); i.src = src; });
  const k = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.86);
  return { mime: "image/jpeg", data: url.split(",")[1], url };
}

async function library(nav) {
  const [booksList, loansList, meta] = await Promise.all([api(`${S()}/library/books`), api(`${S()}/library/loans`), api(`${S()}/library/meta`)]);
  const { cls, st } = await studentPicker();
  const staff = (await api(`${A}/staff-affairs/attendance`).catch(() => ({ staff: [] }))).staff;
  const book = select([["", "اختر الكتاب"], ...booksList.map((b) => [b.id, `${b.title} (${b.copies - b.out} متاح)`])]);
  const who = select([["student", "طالب"], ...(staff.length ? [["staff", "موظف"]] : [])]);
  const staffSel = select(staff.map((s) => [s.staff_id, s.full_name]));
  const stF = h("div", { class: "row" }, field("الشعبة", cls), field("الطالب", st)), sfF = field("الموظف", staffSel);
  sfF.hidden = true;
  who.addEventListener("change", () => { stF.hidden = who.value !== "student"; sfF.hidden = who.value !== "staff"; });
  const gradeName = (id) => meta.grades.find((g) => Number(g.id) === Number(id))?.name || "";
  const subjectsOf = (gradeId) => {
    const g = meta.grades.find((x) => Number(x.id) === Number(gradeId));
    return g?.subjects?.length ? g.subjects : meta.subjects;
  };
  const seg = (options, value, onPick) => {
    const box = h("div", { class: "lb-seg" });
    let cur = value;
    const paint = () => mount(box, options.map(([v, l]) => h("button", { type: "button", class: cur === v ? "on" : "", onclick: () => { cur = v; paint(); onPick(v); } }, l)));
    paint();
    return { el: box, value: () => cur };
  };

  const bookForm = (b) => {
    const isText = b ? Boolean(b.grade_id) : meta.grades.length > 0;
    const kind = seg([["text", "كتاب مدرسي (منهج)"], ["general", "كتاب عام"]], isText ? "text" : "general", () => sync());
    const grade = select([["", "اختر الصف"], ...meta.grades.map((g) => [g.id, `${g.name}${g.stage ? ` — ${g.stage}` : ""}`])], { value: b?.grade_id ?? "" });
    const subject = select([["", "اختر المادة"]]);
    let part = b?.part || "first";
    const partSeg = seg(Object.entries(meta.parts), part, (v) => { part = v; autoTitle(); });
    const source = seg(Object.entries(meta.sources), b?.source || "government", () => {});
    const f = { title: input({ value: b?.title || "" }), author: input({ value: b?.author || "", placeholder: "اختياري" }), isbn: input({ value: b?.isbn || "", class: "ltr", placeholder: "اختياري" }),
      category: input({ value: b?.category || "", placeholder: "مثال: قصص، مراجع" }), shelf: input({ value: b?.shelf || "", placeholder: "مثال: أ-3" }),
      copies: input({ type: "number", min: 0, value: b?.copies ?? 1, class: "ltr" }) };
    let titleByHand = Boolean(b);
    f.title.addEventListener("input", () => { titleByHand = true; });
    const fillSubjects = () => {
      const list = subjectsOf(grade.value);
      mount(subject, h("option", { value: "" }, "اختر المادة"), list.map((x) => h("option", { value: x.id }, x.name)));
      if (b?.subject_id && list.some((x) => Number(x.id) === Number(b.subject_id))) subject.value = String(b.subject_id);
    };
    const autoTitle = () => {
      if (titleByHand || kind.value() !== "text" || !grade.value || !subject.value) return;
      f.title.value = `${subject.selectedOptions[0].textContent} — ${meta.parts[part]} — ${gradeName(grade.value)}`;
    };
    grade.addEventListener("change", () => { fillSubjects(); autoTitle(); });
    subject.addEventListener("change", autoTitle);
    fillSubjects();
    const textBox = h("div", {}, h("div", { class: "row" }, field("الصف", grade), field("المادة", subject)), field("الجزء", partSeg.el));
    const generalBox = field("التصنيف", f.category);
    const sync = () => { textBox.hidden = kind.value() !== "text"; generalBox.hidden = kind.value() === "text"; autoTitle(); };
    sync();
    // Cover photo: chosen now, uploaded after saving.
    let cover = null;
    const preview = h("div", { class: "lb-cover" }, b?.has_cover ? h("img", { src: `${S()}/library/books/${b.id}/cover`, alt: "الغلاف" }) : h("span", {}, "لا توجد صورة"));
    const fileIn = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true });
    fileIn.addEventListener("change", async () => {
      const file = fileIn.files?.[0];
      if (!file) return;
      try { cover = await coverData(file); mount(preview, h("img", { src: cover.url, alt: "الغلاف" })); } catch (e) { toast(e.message, true); }
    });
    const d = dialog(b ? "تعديل كتاب" : "إضافة كتاب للمخزون", h("div", { class: "lb-form" },
      kind.el, textBox,
      field("عنوان الكتاب", f.title, isText ? "يُكتب تلقائيًا من الصف والمادة والجزء، ويمكنك تعديله" : null),
      generalBox,
      field("الطبعة", source.el),
      h("div", { class: "row" }, field("عدد النسخ", f.copies), field("رقم الرف", f.shelf)),
      h("div", { class: "row" }, field("المؤلف / الجهة", f.author), field("ردمك (الرقم الدولي)", f.isbn)),
      h("div", { class: "lb-cover-row" }, preview, h("div", {}, h("b", {}, "صورة الغلاف"), sub("اختيارية — تساعد على التعرف على الكتاب بسرعة."),
        btn(b?.has_cover || cover ? "تغيير الصورة" : "إرفاق صورة الغلاف", () => fileIn.click(), "ghost sm"), fileIn))),
    [b ? btn("حذف", async () => { if (!confirmAction("حذف الكتاب؟")) return; await api(`${S()}/library/books/${b.id}`, undefined, "DELETE"); d.close(); nav.show(); }, "danger") : null,
      btn("حفظ", async () => {
        const text = kind.value() === "text";
        if (text && (!grade.value || !subject.value)) return toast("اختر الصف والمادة", true);
        const body = { title: f.title.value, author: f.author.value, isbn: f.isbn.value, shelf: f.shelf.value, copies: f.copies.value,
          category: text ? "كتاب مدرسي" : f.category.value, source: source.value(),
          grade_id: text ? Number(grade.value) : null, subject_id: text ? Number(subject.value) : null, part: text ? part : null };
        const saved = b ? await api(`${S()}/library/books/${b.id}`, body, "PUT") : await api(`${S()}/library/books`, body);
        if (cover) await api(`${S()}/library/books/${saved.id || b.id}/cover`, { mime: cover.mime, data: cover.data });
        d.close(); toast("تم الحفظ"); nav.show();
      })]);
    d.classList.add("dialog-lg");
  };

  // A whole grade's textbooks at once: its subjects are listed with their parts and copies.
  const gradeForm = () => {
    const grade = select([["", "اختر الصف"], ...meta.grades.map((g) => [g.id, `${g.name}${g.stage ? ` — ${g.stage}` : ""}`])]);
    const copies = input({ type: "number", min: 1, value: 30, class: "ltr" });
    const shelf = input({ placeholder: "اختياري" });
    const source = seg(Object.entries(meta.sources), "government", () => {});
    const rows = h("div", { class: "lb-grade" });
    let items = [];
    const draw = () => {
      const list = subjectsOf(grade.value);
      if (!grade.value) return mount(rows, sub("اختر الصف لتظهر مواده."));
      items = list.map((x) => ({ subject: x, on: input({ type: "checkbox", checked: true }), parts: select([["two", "جزءان (الأول والثاني)"], ["first", "الجزء الأول فقط"], ["second", "الجزء الثاني فقط"], ["combined", "جزء مشترك (مجلد واحد)"]]),
        copies: input({ type: "number", min: 1, value: copies.value, class: "ltr" }) }));
      mount(rows, items.map((it) => h("div", { class: "lb-grade-row" }, h("label", { class: "lb-check" }, it.on, h("b", {}, it.subject.name)), it.parts, it.copies)));
    };
    grade.addEventListener("change", draw);
    copies.addEventListener("change", () => items.forEach((it) => { it.copies.value = copies.value; }));
    draw();
    const d = dialog("إضافة كتب صف كامل", h("div", { class: "lb-form" },
      sub("اختر الصف فتظهر مواده. حدد لكل مادة أجزاءها وعدد النسخ. الكتاب الموجود مسبقًا تُضاف نسخه إلى رصيده."),
      h("div", { class: "row" }, field("الصف", grade), field("عدد النسخ لكل كتاب", copies), field("رقم الرف", shelf)),
      field("الطبعة", source.el), rows),
    [btn("إضافة للمخزون", async () => {
      const chosen = items.filter((it) => it.on.checked);
      if (!chosen.length) return toast("اختر مادة واحدة على الأقل", true);
      const list = chosen.flatMap((it) => (it.parts.value === "two" ? ["first", "second"] : [it.parts.value]).map((p) => ({ subject_id: Number(it.subject.id), part: p, copies: Number(it.copies.value) || 1 })));
      const r = await api(`${S()}/library/books/grade`, { grade_id: Number(grade.value), source: source.value(), shelf: shelf.value, items: list });
      d.close(); toast(`أُضيف ${r.added} كتابًا${r.increased ? `، وزيدت نسخ ${r.increased} موجودة` : ""}`); nav.show();
    })]);
    d.classList.add("dialog-lg");
  };

  const filter = select([["", "كل الصفوف"], ...meta.grades.map((g) => [g.id, g.name]), ["none", "كتب عامة"]]);
  const search = input({ placeholder: "ابحث بالعنوان أو المؤلف أو الرف", type: "search" });
  const listBox = h("div");
  const paintList = () => {
    const term = search.value.trim();
    const shown = booksList.filter((b) => (!filter.value || (filter.value === "none" ? !b.grade_id : Number(b.grade_id) === Number(filter.value)))
      && (!term || [b.title, b.author, b.shelf].some((v) => String(v || "").includes(term))));
    mount(listBox, shown.length ? shown.map((b) => h("div", { class: "lb-item" },
      b.has_cover ? h("img", { class: "lb-thumb", src: `${S()}/library/books/${b.id}/cover`, alt: "", loading: "lazy" }) : h("span", { class: "lb-thumb none" }, "كتاب"),
      h("div", { class: "lb-info" }, h("b", {}, b.title),
        h("div", { class: "lb-tags" }, b.grade ? badge(b.grade, "") : null, b.part ? badge(meta.parts[b.part], "gray") : null,
          b.source ? badge(meta.sources[b.source], b.source === "government" ? "green" : "amber") : null, b.shelf ? badge(`الرف ${b.shelf}`, "gray") : null),
        sub([b.author, `${b.copies - b.out} متاح من ${b.copies}`, b.out ? `${b.out} معار` : null].filter(Boolean).join(" — "))),
      btn("تعديل", () => bookForm(b), "ghost sm"))) : empty(booksList.length ? "لا توجد كتب بهذا البحث." : "أضف كتب المخزون: كتابًا كتابًا، أو كتب صف كامل دفعة واحدة."));
  };
  filter.addEventListener("change", paintList);
  search.addEventListener("input", paintList);
  paintList();
  const late = loansList.filter((l) => l.overdue).length;
  return [
    stats([["الكتب", booksList.length], ["النسخ", booksList.reduce((a, b) => a + b.copies, 0)], ["معار الآن", loansList.length], ["متأخر", late]]),
    panel("مخزون الكتب", h("div", { class: "row", style: "flex:none;gap:6px" }, meta.grades.length ? btn("+ كتب صف كامل", gradeForm, "ghost sm") : null, btn("+ كتاب", () => bookForm(null), "sm")),
      h("div", { class: "row" }, field("الصف", filter), field("بحث", search)), listBox),
    panel("إعارة كتاب", null, field("الكتاب", book), field("المستعير", who), stF, sfF,
      btn("إعارة", async () => {
        if (!book.value) return toast("اختر الكتاب", true);
        const body = { book_id: Number(book.value), ...(who.value === "student" ? { student_id: Number(st.value) || null } : { staff_id: Number(staffSel.value) || null }) };
        const r = await api(`${S()}/library/loans`, body); toast(`أُعير حتى ${fmtDate(r.due_on)}`); nav.show();
      })),
    panel("المعار حاليًا", null, loansList.length ? loansList.map((l) => line(
      h("div", {}, h("b", {}, l.title), " ", l.overdue ? badge("متأخر", "red") : null, sub(`${l.student ? `${l.student} — ${l.class_name || ""}` : l.staff} — حتى ${fmtDate(l.due_on)}`)),
      btn("إرجاع", async () => { await api(`${S()}/library/loans/${l.id}/return`, {}); toast("أُرجع"); nav.show(); }, "ghost sm"))) : empty("لا توجد كتب معارة.")),
    await libSettings(),
  ];
}
async function libSettings() {
  const s = (await api(`${A}/communication/features`)).library;
  const num = (k) => { const el = input({ type: "number", min: 1, value: s[k], class: "ltr" }); el.addEventListener("change", async () => { await api(`${A}/communication/features/library`, { [k]: Number(el.value) }, "PUT"); toast("تم الحفظ"); }); return el; };
  return panel("إعدادات الإعارة", null, h("div", { class: "row" }, field("مدة الإعارة (أيام)", num("loan_days")), field("أقصى عدد كتب للطالب", num("max_loans"))),
    sub("يصل تذكير لولي الأمر عند تأخر الإرجاع."));
}

async function inventory(nav) {
  const [list, custody, staffBoard] = await Promise.all([api(`${S()}/inventory/items`), api(`${S()}/inventory/custody`), api(`${A}/staff-affairs/attendance`).catch(() => ({ staff: [] }))]);
  const staff = staffBoard.staff;
  const itemForm = (it) => {
    const f = { name: input({ value: it?.name || "" }), category: input({ value: it?.category || "" }), unit: input({ value: it?.unit || "قطعة" }),
      min_quantity: input({ type: "number", min: 0, value: it?.min_quantity ?? 0, class: "ltr" }), location: input({ value: it?.location || "" }) };
    const d = dialog(it ? "تعديل صنف" : "صنف جديد", h("div", {}, field("الاسم", f.name), h("div", { class: "row" }, field("التصنيف", f.category), field("الوحدة", f.unit)),
      h("div", { class: "row" }, field("حد التنبيه", f.min_quantity, "يظهر الصنف أولًا إذا نزل عنه"), field("المكان", f.location))),
    [btn("حفظ", async () => {
      const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
      if (it) await api(`${S()}/inventory/items/${it.id}`, body, "PUT"); else await api(`${S()}/inventory/items`, body);
      d.close(); toast("تم الحفظ"); nav.show();
    })]);
  };
  const moveForm = (it) => {
    const kind = select(Object.entries(MOVE)), qty = input({ type: "number", min: 0.01, step: "0.01", class: "ltr" });
    const who = select([["", "—"], ...staff.map((s) => [s.staff_id, s.full_name])]), note = input({ placeholder: "ملاحظة" });
    const d = dialog(`${it.name} — المتوفر ${it.quantity} ${it.unit}`, h("div", {}, h("div", { class: "row" }, field("العملية", kind), field("الكمية", qty)),
      field("الموظف (للعهدة)", who), field("ملاحظة", note)),
    [btn("تسجيل", async () => {
      const r = await api(`${S()}/inventory/items/${it.id}/move`, { kind: kind.value, qty: Number(qty.value), staff_id: who.value ? Number(who.value) : null, note: note.value.trim() || null });
      d.close(); toast(`الكمية الآن ${r.quantity}`); nav.show();
    })]);
  };
  const low = list.filter((i) => Number(i.min_quantity) > 0 && Number(i.quantity) <= Number(i.min_quantity));
  return [
    low.length ? notice(`أصناف وصلت حد التنبيه: ${low.map((i) => i.name).join("، ")}`, "warn") : null,
    panel("الأصناف", btn("+ صنف", () => itemForm(null), "sm"),
      list.length ? list.map((i) => line(h("div", {}, h("b", {}, i.name), " ", low.includes(i) ? badge("منخفض", "amber") : null,
        sub([`المتوفر ${Number(i.quantity)} ${i.unit}`, Number(i.in_custody) ? `في العهد ${Number(i.in_custody)}` : null, i.category, i.location].filter(Boolean).join(" — "))),
        h("div", { class: "row", style: "flex:none;gap:6px" }, btn("حركة", () => moveForm(i), "sm"), btn("تعديل", () => itemForm(i), "ghost sm")))) : empty("أضف أصناف المخزون والعهد.")),
    panel("العهد لدى الموظفين", null, custody.length ? custody.map((c) => line(h("span", {}, c.full_name), h("b", {}, `${c.item}: ${Number(c.qty)} ${c.unit}`))) : empty("لا عهد مسلّمة.")),
  ];
}

async function clinic(nav) {
  const [list, pick] = await Promise.all([api(`${S()}/clinic/visits`), studentPicker()]);
  const { cls, st } = pick;
  const complaint = input({ placeholder: "الشكوى" }), action = input({ placeholder: "الإجراء" });
  const temp = input({ type: "number", step: "0.1", min: 30, max: 45, placeholder: "الحرارة", class: "ltr" });
  const home = h("input", { type: "checkbox" }), notifyBox = h("input", { type: "checkbox", checked: true });
  const profileBox = h("div");
  st.addEventListener("change", async () => {
    if (!st.value) return mount(profileBox);
    const p = await api(`${S()}/clinic/students/${st.value}`);
    mount(profileBox, healthEditor(Number(st.value), p.profile));
  });
  return [
    panel("زيارة العيادة", null, h("div", { class: "row" }, field("الشعبة", cls), field("الطالب", st)), profileBox,
      h("div", { class: "row" }, field("الشكوى", complaint), field("الإجراء", action), field("الحرارة", temp)),
      h("label", { class: "check-line" }, home, "يحتاج المغادرة للمنزل (إشعار عاجل)"),
      h("label", { class: "check-line" }, notifyBox, "إشعار ولي الأمر"),
      btn("تسجيل الزيارة", async () => {
        if (!st.value) return toast("اختر الطالب", true);
        await api(`${S()}/clinic/visits`, { student_id: Number(st.value), complaint: complaint.value.trim(), action: action.value.trim() || null,
          temperature: temp.value || null, sent_home: home.checked, notify_parent: notifyBox.checked });
        toast("سُجّلت الزيارة"); nav.show();
      })),
    panel("آخر الزيارات", null, list.length ? list.map((v) => line(
      h("div", {}, h("b", {}, `${v.student} — ${v.complaint}`), " ", v.sent_home ? badge("غادر للمنزل", "amber") : null,
        sub([v.class_name, fmtDateTime(v.visited_at), v.action, v.temperature ? `${v.temperature}°` : null].filter(Boolean).join(" — "))))) : empty("لا توجد زيارات.")),
    panel("الإعدادات", null,
      line(h("div", {}, h("b", {}, "إشعار ولي الأمر بالزيارة")), await setSwitch("clinic", "notify_parent")),
      line(h("div", {}, h("b", {}, "الملف الصحي والزيارات في صفحة ولي الأمر")), await setSwitch("clinic", "show_parent_profile"))),
  ];
}

function healthEditor(studentId, p) {
  const f = { blood_type: select([["", "فصيلة الدم"], ...["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((x) => [x, x])], { value: p?.blood_type || "" }),
    allergies: input({ value: p?.allergies || "", placeholder: "الحساسية" }), chronic: input({ value: p?.chronic || "", placeholder: "أمراض مزمنة" }),
    medications: input({ value: p?.medications || "", placeholder: "أدوية" }), emergency_phone: input({ value: p?.emergency_phone || "", class: "ltr", placeholder: "جوال الطوارئ" }) };
  return h("details", { class: "panel", open: Boolean(p?.allergies || p?.chronic) }, h("summary", { style: "cursor:pointer" }, h("b", {}, "الملف الصحي"),
    p?.allergies ? badge(`حساسية: ${p.allergies}`, "red") : null),
    h("div", { class: "row" }, field("الفصيلة", f.blood_type), field("الحساسية", f.allergies), field("مزمن", f.chronic)),
    h("div", { class: "row" }, field("الأدوية", f.medications), field("جوال الطوارئ", f.emergency_phone)),
    btn("حفظ الملف الصحي", async () => {
      await api(`${S()}/clinic/students/${studentId}`, Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value || null])), "PUT"); toast("حُفظ");
    }, "ghost sm"));
}
