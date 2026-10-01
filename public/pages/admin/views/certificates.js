// الشهادات الرسمية: إصدار شهادات الفصل أو العام لشعبة كاملة بنتيجتها، وشهادات مخصصة، وطباعة برمز تحقق QR
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, textarea, btn, empty, badge, line, sub, toast, notice, switchBtn, confirmAction } from "../../shared/js/ui.js";
import { fmtDate } from "../../shared/js/format.js";
import { partsView } from "../../shared/js/parts.js";
import { certificatesSheet } from "../../shared/js/certificate.js";
import { A } from "./common.js";

const KIND = { term: "نتيجة فصل", year: "إتمام عام", custom: "مخصصة" };

export default async function certificates() {
  const [classes, academic] = await Promise.all([api(`${A}/structure/classes`), api(`${A}/academic`)]);
  if (!classes.length) return notice("أنشئ الشعب أولًا من الهيكل الأكاديمي.", "warn");
  let classId = Number(sessionStorage.getItem("midar_cert_class")) || classes[0].id;
  if (!classes.some((c) => c.id === classId)) classId = classes[0].id;
  const classPick = (on) => {
    const s = select(classes.map((c) => [c.id, c.name]), { value: classId });
    s.addEventListener("change", () => { classId = Number(s.value); try { sessionStorage.setItem("midar_cert_class", String(classId)); } catch { /* */ } on(); });
    return field("الشعبة", s);
  };
  return partsView([["issue", "إصدار"], ["issued", "الشهادات الصادرة"], ["custom", "شهادة مخصصة"], ["settings", "الإعدادات"]], async (part, nav) => {
    if (part === "issue") return issueView(nav);
    if (part === "issued") return issuedView(nav);
    if (part === "custom") return customView(nav);
    return settingsView();
  });

  async function issueView(nav) {
    const kind = select([["term", "شهادة نتيجة الفصل الدراسي"], ["year", "شهادة إتمام العام الدراسي"]]);
    const terms = academic.terms.filter((t) => t.year_id === academic.current?.year_id);
    const term = select(terms.map((t) => [t.id, t.name]), { value: academic.current?.term_id });
    const termField = field("الفصل الدراسي", term);
    const out = h("div");
    const body = () => ({ class_id: classId, kind: kind.value, term_id: kind.value === "term" ? Number(term.value) || null : null });
    const preview = async () => {
      termField.hidden = kind.value !== "term";
      mount(out, empty("جارٍ حساب النتائج…"));
      const p = await api(`${A}/certificates/issue`, { ...body(), dry_run: true });
      const ready = p.students.filter((s) => s.subjects);
      mount(out,
        sub(`${p.title} — حد النجاح ${p.pass_mark}% في كل مادة. ${ready.length} من ${p.students.length} طالب لهم درجات منشورة.`),
        p.students.length ? h("div", { class: "table-wrap" }, h("table", { class: "grid" },
          h("thead", {}, h("tr", {}, h("th", {}, "الطالب"), h("th", {}, "النسبة"), h("th", {}, "النتيجة"))),
          h("tbody", {}, p.students.map((s) => h("tr", {}, h("td", {}, s.name), h("td", {}, s.percent === null ? "—" : `${s.percent}%`),
            h("td", {}, s.subjects ? badge(s.result, s.passed ? "" : "red") : badge("لا درجات منشورة", "gray"))))))) : empty("لا يوجد طلاب."),
        ready.length ? btn(`إصدار ${ready.length} شهادة`, async () => {
          if (!confirmAction("إصدار الشهادات؟ تُلغى أي شهادة سابقة لنفس الفصل وتُستبدل بالجديدة، ويصل إشعار لأولياء الأمور.")) return;
          const r = await api(`${A}/certificates/issue`, body());
          toast(`صدرت ${r.issued} شهادة`);
          await printIds(r.ids, out);
        }) : notice("انشر درجات الاختبارات أولًا (الاختبارات ← اعتماد ونشر).", "warn"));
    };
    kind.addEventListener("change", preview);
    term.addEventListener("change", preview);
    preview();
    return panel("إصدار شهادات لشعبة", null, h("div", { class: "row" }, classPick(() => nav.show()), field("نوع الشهادة", kind), termField), out);
  }

  async function printIds(ids, box) {
    const list = await api(`${A}/certificates/print`, { ids });
    mount(box, h("div", { class: "toolbar" }, btn("طباعة", () => window.print()), sub(`${list.length} شهادة — صفحة لكل شهادة`)), certificatesSheet(list));
  }

  async function issuedView(nav) {
    const rows = await api(`${A}/certificates?class_id=${classId}`);
    const valid = rows.filter((r) => !r.revoked_at);
    const out = h("div");
    return [panel("الشهادات الصادرة", valid.length ? btn("طباعة كل السارية", () => printIds(valid.map((r) => r.id), out), "ghost sm") : null,
      classPick(() => nav.show()),
      rows.length ? rows.map((r) => line(
        h("div", {}, h("b", {}, r.student), " ", badge(KIND[r.kind]), r.revoked_at ? badge("ملغاة", "red") : null,
          sub(`${r.title} — ${fmtDate(r.issued_at)} — رمز ${r.code}${r.result ? ` — ${r.result}` : ""}`),
          r.revoked_at && r.revoke_reason ? sub(`سبب الإلغاء: ${r.revoke_reason}`) : null),
        h("div", { class: "row", style: "flex:none;gap:6px" },
          btn("طباعة", () => printIds([r.id], out), "ghost sm"),
          r.revoked_at ? null : btn("إلغاء", async () => {
            const reason = prompt("سبب إلغاء الشهادة:");
            if (!reason || reason.trim().length < 2) return;
            await api(`${A}/certificates/${r.id}/revoke`, { reason: reason.trim() }); toast("أُلغيت. التحقق منها يظهر «ملغاة»."); nav.show();
          }, "ghost sm")))) : empty("لم تصدر شهادات لهذه الشعبة بعد.")), out];
  }

  async function customView(nav) {
    const students = await api(`${A}/students?class_id=${classId}`);
    const st = select(students.map((s) => [s.id, s.full_name || s.name]));
    const title = input({ value: "شهادة تقدير", maxLength: 120 });
    const text = textarea({ rows: 3, maxLength: 600, value: "تقديرًا لتفوقه وحسن سيرته وسلوكه، متمنين له دوام التوفيق والنجاح." });
    const out = h("div");
    return [panel("شهادة مخصصة لطالب", null,
      h("div", { class: "row" }, classPick(() => nav.show()), field("الطالب", st)),
      field("عنوان الشهادة", title), field("نص الشهادة", text, "يأتي بعد «تشهد إدارة المدرسة بأن الطالب … من …»"),
      btn("إصدار وطباعة", async () => {
        if (!st.value) return toast("اختر الطالب", true);
        const r = await api(`${A}/certificates/custom`, { student_id: Number(st.value), title: title.value.trim(), body: text.value.trim() });
        toast("صدرت الشهادة"); await printIds([r.id], out);
      })), out];
  }

  async function settingsView() {
    const s = (await api(`${A}/communication/features`)).certificates;
    const save = async (patch) => { Object.assign(s, await api(`${A}/communication/features/certificates`, patch, "PUT")); toast("تم الحفظ"); return true; };
    const f = (key, el) => { el.addEventListener("change", () => save({ [key]: el.type === "number" ? Number(el.value) : el.value })); return el; };
    return panel("إعدادات الشهادات", null,
      h("div", { class: "row" },
        field("حد النجاح في كل مادة (%)", f("pass_mark", input({ type: "number", min: 0, max: 100, value: s.pass_mark, class: "ltr" }))),
        field("صفة الموقّع", f("signer_title", input({ value: s.signer_title, maxLength: 60 }))),
        field("اسم الموقّع", f("signer_name", input({ value: s.signer_name, maxLength: 80, placeholder: "يظهر تحت التوقيع" })))),
      field("ملاحظة أسفل الشهادة", f("footer_note", input({ value: s.footer_note, maxLength: 200, placeholder: "اختياري" }))),
      line(h("div", {}, h("b", {}, "إظهار ترتيب الطالب في الشعبة")), switchBtn(s.show_rank, "إظهار الترتيب", (v) => save({ show_rank: v }))));
  }
}
