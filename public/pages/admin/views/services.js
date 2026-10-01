// الخدمات: النقل المدرسي، المكتبة، العهد والمخزون، العيادة المدرسية
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

/* ===================== النقل ===================== */
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

/* ===================== المكتبة ===================== */
async function library(nav) {
  const [booksList, loansList] = await Promise.all([api(`${S()}/library/books`), api(`${S()}/library/loans`)]);
  const { cls, st } = await studentPicker();
  const staff = (await api(`${A}/staff-affairs/attendance`).catch(() => ({ staff: [] }))).staff;
  const book = select([["", "اختر الكتاب"], ...booksList.map((b) => [b.id, `${b.title} (${b.copies - b.out} متاح)`])]);
  const who = select([["student", "طالب"], ...(staff.length ? [["staff", "موظف"]] : [])]);
  const staffSel = select(staff.map((s) => [s.staff_id, s.full_name]));
  const stF = h("div", { class: "row" }, field("الشعبة", cls), field("الطالب", st)), sfF = field("الموظف", staffSel);
  sfF.hidden = true;
  who.addEventListener("change", () => { stF.hidden = who.value !== "student"; sfF.hidden = who.value !== "staff"; });
  const bookForm = (b) => {
    const f = { title: input({ value: b?.title || "" }), author: input({ value: b?.author || "" }), isbn: input({ value: b?.isbn || "", class: "ltr" }),
      category: input({ value: b?.category || "" }), shelf: input({ value: b?.shelf || "" }), copies: input({ type: "number", min: 0, value: b?.copies ?? 1, class: "ltr" }) };
    const d = dialog(b ? "تعديل كتاب" : "كتاب جديد", h("div", {}, field("العنوان", f.title), h("div", { class: "row" }, field("المؤلف", f.author), field("ISBN", f.isbn)),
      h("div", { class: "row" }, field("التصنيف", f.category), field("الرف", f.shelf), field("عدد النسخ", f.copies))),
    [b ? btn("حذف", async () => { if (!confirmAction("حذف الكتاب؟")) return; await api(`${S()}/library/books/${b.id}`, undefined, "DELETE"); d.close(); nav.show(); }, "danger") : null,
      btn("حفظ", async () => {
        const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
        if (b) await api(`${S()}/library/books/${b.id}`, body, "PUT"); else await api(`${S()}/library/books`, body);
        d.close(); toast("تم الحفظ"); nav.show();
      })]);
  };
  const late = loansList.filter((l) => l.overdue).length;
  return [
    stats([["الكتب", booksList.length], ["النسخ", booksList.reduce((a, b) => a + b.copies, 0)], ["معار الآن", loansList.length], ["متأخر", late]]),
    panel("إعارة كتاب", null, field("الكتاب", book), field("المستعير", who), stF, sfF,
      btn("إعارة", async () => {
        if (!book.value) return toast("اختر الكتاب", true);
        const body = { book_id: Number(book.value), ...(who.value === "student" ? { student_id: Number(st.value) || null } : { staff_id: Number(staffSel.value) || null }) };
        const r = await api(`${S()}/library/loans`, body); toast(`أُعير حتى ${fmtDate(r.due_on)}`); nav.show();
      })),
    panel("المعار حاليًا", null, loansList.length ? loansList.map((l) => line(
      h("div", {}, h("b", {}, l.title), " ", l.overdue ? badge("متأخر", "red") : null, sub(`${l.student ? `${l.student} — ${l.class_name || ""}` : l.staff} — حتى ${fmtDate(l.due_on)}`)),
      btn("إرجاع", async () => { await api(`${S()}/library/loans/${l.id}/return`, {}); toast("أُرجع"); nav.show(); }, "ghost sm"))) : empty("لا توجد كتب معارة.")),
    panel("الكتب", btn("+ كتاب", () => bookForm(null), "sm"),
      booksList.length ? booksList.map((b) => line(h("div", {}, h("b", {}, b.title), sub([b.author, b.category, b.shelf ? `الرف ${b.shelf}` : null, `${b.copies - b.out} من ${b.copies} متاح`].filter(Boolean).join(" — "))),
        btn("تعديل", () => bookForm(b), "ghost sm"))) : empty("أضف كتب المكتبة.")),
    await libSettings(),
  ];
}
async function libSettings() {
  const s = (await api(`${A}/communication/features`)).library;
  const num = (k) => { const el = input({ type: "number", min: 1, value: s[k], class: "ltr" }); el.addEventListener("change", async () => { await api(`${A}/communication/features/library`, { [k]: Number(el.value) }, "PUT"); toast("تم الحفظ"); }); return el; };
  return panel("إعدادات الإعارة", null, h("div", { class: "row" }, field("مدة الإعارة (أيام)", num("loan_days")), field("أقصى عدد كتب للطالب", num("max_loans"))),
    sub("يصل تذكير لولي الأمر عند تأخر الإرجاع."));
}

/* ===================== المخزون ===================== */
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

/* ===================== العيادة ===================== */
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
