/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, textarea, btn, empty, badge, line, sub, toast, notice, switchBtn, confirmAction, dialog } from "../../shared/js/ui.js";
import { fmtDate, fmtDateTime } from "../../shared/js/format.js";
import { partsView } from "../../shared/js/parts.js";
import { certificateSheet, printCertificateSheet } from "../../shared/js/cert-render.js";
import { resultsApproval } from "../../shared/js/results-approval.js";
import { designsView, designPicker } from "../../shared/js/cert-designer.js";
import { A } from "./common.js";

const KIND = { term: "نتيجة فصل", year: "إتمام عام", custom: "مخصصة" };
const STATE = { issued: ["سارية", "green"], revoked: ["ملغاة", "red"], replaced: ["مستبدلة", "gray"] };

export default async function certificates(ctx = {}) {
  const [classes, academic] = await Promise.all([api(`${A}/structure/classes`), api(`${A}/academic`)]);
  if (!classes.length) return notice("أنشئ الشعب أولًا من الهيكل الأكاديمي.", "warn");
  const canApprove = (ctx.me?.admin_scope || "full") === "full";
  const store = (k, v) => { try { sessionStorage.setItem(k, String(v)); } catch { /* storage unavailable */ } };
  const read = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
  let classId = Number(read("midar_cert_class")) || classes[0].id;
  if (!classes.some((c) => c.id === classId)) classId = classes[0].id;
  const terms = academic.terms.filter((t) => t.year_id === academic.current?.year_id);
  let kind = read("midar_cert_kind") === "year" ? "year" : "term";
  let termId = Number(read("midar_cert_term")) || academic.current?.term_id || terms[0]?.id || null;
  if (!terms.some((t) => t.id === termId)) termId = academic.current?.term_id || terms[0]?.id || null;
  const classPick = (on) => {
    const s = select(classes.map((c) => [c.id, c.name]), { value: classId });
    s.addEventListener("change", () => { classId = Number(s.value); store("midar_cert_class", classId); on(); });
    return field("الشعبة", s);
  };
  // Class, then term result or year result (and which term).
  const scopePick = (on) => {
    const k = select([["term", "نتيجة الفصل الدراسي"], ["year", "نتيجة العام الدراسي"]], { value: kind });
    const t = select(terms.map((x) => [x.id, x.name]), { value: termId });
    const tf = field("الفصل الدراسي", t);
    tf.hidden = kind !== "term";
    k.addEventListener("change", () => { kind = k.value; store("midar_cert_kind", kind); on(); });
    t.addEventListener("change", () => { termId = Number(t.value); store("midar_cert_term", termId); on(); });
    return h("div", { class: "row" }, classPick(on), field("النطاق", k), tf);
  };
  const keyQ = () => `class_id=${classId}&scope=${kind}${kind === "term" && termId ? `&term_id=${termId}` : ""}`;
  const keyB = () => ({ class_id: classId, scope: kind, ...(kind === "term" && termId ? { term_id: termId } : {}) });

  return partsView([["results", "اعتماد النتائج"], ["issue", "إصدار"], ["issued", "الشهادات الصادرة"], ["custom", "شهادة مخصصة"], ["designs", "التصاميم"], ["settings", "الإعدادات"]], async (part, nav) => {
    if (part === "results") return resultsView(nav);
    if (part === "designs") return panel("تصاميم الشهادات", null, await designsView({ base: `${A}/certificates` }));
    if (part === "issue") return issueView(nav);
    if (part === "issued") return issuedView(nav);
    if (part === "custom") return customView(nav);
    return settingsView();
  });

  function resultsView(nav) {
    const table = (r) => h("div", { class: "table-wrap" }, h("table", { class: "grid" },
      h("thead", {}, h("tr", {}, h("th", {}, "الطالب"), h("th", {}, "المواد"), h("th", {}, "النسبة"), h("th", {}, "الترتيب"), h("th", {}, "النتيجة"))),
      h("tbody", {}, r.students.map((s) => h("tr", {}, h("td", {}, s.name), h("td", {}, String(s.subjects)),
        h("td", {}, s.percent === null ? "—" : `${s.percent}%`), h("td", {}, s.rank ? String(s.rank) : "—"),
        h("td", {}, s.subjects ? badge(s.result, s.passed ? "green" : "red") : badge("لا درجات منشورة", "gray")))))));
    return [panel("اعتماد النتائج قبل إصدار الشهادات", null,
      sub("تُراجع النتائج وتُعتمد داخليًا، ثم تصدر الشهادات منها فقط. أي تعديل في الدرجات بعد الاعتماد يعيدها للمراجعة تلقائيًا."),
      scopePick(() => nav.show())),
    resultsApproval({
      load: () => api(`${A}/certificates/results?${keyQ()}`),
      act: (step, body = {}) => api(`${A}/certificates/results/${step}`, { ...keyB(), ...body }),
      studentsTable: table, onIssue: () => nav.go("issue"),
    })];
  }

  async function issueView(nav) {
    const out = h("div");
    const picker = await designPicker(`${A}/certificates`, kind);
    const body = () => ({ class_id: classId, kind, term_id: kind === "term" ? termId : null, template_id: picker.value() });
    const p = await api(`${A}/certificates/issue`, { ...body(), dry_run: true });
    const ready = p.students.filter((s) => s.subjects);
    const approved = p.status === "approved";
    mount(out,
      sub(`${p.title} — حد النجاح ${p.pass_mark}% في كل مادة. ${ready.length} من ${p.students.length} طالب لهم درجات منشورة.`),
      approved ? notice("النتائج معتمدة داخليًا. ستصدر الشهادات بالأرقام المعتمدة نفسها، ولكل شهادة رقم تسلسلي ورمز تحقق.", "")
        : notice(h("span", {}, `حالة النتائج: ${p.status_label}. لا تصدر الشهادات إلا من نتائج معتمدة. `,
          h("button", { type: "button", class: "au-link", onclick: () => nav.go("results") }, "اذهب إلى «اعتماد النتائج»")), "warn"),
      p.students.length ? h("div", { class: "table-wrap" }, h("table", { class: "grid" },
        h("thead", {}, h("tr", {}, h("th", {}, "الطالب"), h("th", {}, "النسبة"), h("th", {}, "النتيجة"))),
        h("tbody", {}, p.students.map((s) => h("tr", {}, h("td", {}, s.name), h("td", {}, s.percent === null ? "—" : `${s.percent}%`),
          h("td", {}, s.subjects ? badge(s.result, s.passed ? "green" : "red") : badge("لا درجات منشورة", "gray"))))))) : empty("لا يوجد طلاب."),
      approved && ready.length && canApprove ? btn(`إصدار ${ready.length} شهادة`, async (e) => {
        if (!confirmAction("إصدار الشهادات من النتائج المعتمدة؟ الشهادة السابقة لنفس النطاق تصبح «مستبدلة» وتبقى في السجل، ويصل إشعار لأولياء الأمور.")) return;
        e.currentTarget.disabled = true;
        try {
          const r = await api(`${A}/certificates/issue`, body());
          toast(`صدرت ${r.issued} شهادة`);
          await printIds(r.ids, out);
        } catch (err) { toast(err.message, true); nav.show(); }
      }) : approved && !canApprove ? notice("إصدار الشهادات لإدارة المدرسة العامة.", "") : null);
    return panel("إصدار شهادات لشعبة", null, scopePick(() => nav.show()),
      field("تصميم الشهادة", picker.el, "يُطبَّق على كل شهادات هذا الإصدار. عدّل التصاميم من «التصاميم»."), out);
  }

  async function printIds(ids, box) {
    const list = await api(`${A}/certificates/print`, { ids });
    mount(box, h("div", { class: "toolbar" }, btn("طباعة / حفظ PDF", () => printCertificateSheet(list)), sub(`${list.length} شهادة — صفحة A4 لكل شهادة`)), certificateSheet(list));
  }

  async function historyOf(r) {
    const rows = await api(`${A}/certificates/${r.id}/history`);
    const L = { issued: "إصدار", revoked: "إلغاء", replaced: "استبدال", printed: "طباعة" };
    dialog(`سجل الشهادة ${r.serial}`, h("ol", { class: "ra-log" }, rows.map((x) => h("li", {}, h("b", {}, L[x.action] || x.action),
      h("span", {}, ` — ${x.actor}`), h("small", {}, fmtDateTime(x.created_at)), x.reason ? h("div", { class: "sub" }, x.reason) : null))));
  }

  async function issuedView(nav) {
    const rows = await api(`${A}/certificates?class_id=${classId}`);
    const valid = rows.filter((r) => r.status === "issued");
    const out = h("div");
    const ask = (title) => { const v = prompt(title); return v && v.trim().length >= 2 ? v.trim() : null; };
    return [panel("الشهادات الصادرة", valid.length ? btn("طباعة كل السارية", () => printIds(valid.map((r) => r.id), out), "ghost sm") : null,
      classPick(() => nav.show()),
      rows.length ? rows.map((r) => line(
        h("div", {}, h("b", {}, r.student), " ", badge(KIND[r.kind] || r.title), " ", badge(...STATE[r.status]),
          sub(h("span", {}, "رقم ", h("bdi", { dir: "ltr" }, r.serial), ` — ${r.title} — ${fmtDate(r.issued_at)}${r.result ? ` — ${r.result}` : ""}`)),
          r.status === "replaced" ? sub(h("span", {}, "استُبدلت بالشهادة ", h("bdi", { dir: "ltr" }, r.replaced_by_serial || "—"), r.revoke_reason ? ` — ${r.revoke_reason}` : "")) : null,
          r.status === "revoked" && r.revoke_reason ? sub(`سبب الإلغاء: ${r.revoke_reason}${r.revoked_by ? ` — ${r.revoked_by}` : ""}`) : null),
        h("div", { class: "row", style: "flex:none;gap:6px;flex-wrap:wrap" },
          btn("طباعة", () => printIds([r.id], out), "ghost sm"),
          btn("السجل", () => historyOf(r), "ghost sm"),
          r.status === "issued" && canApprove ? btn("استبدال", async () => {
            const reason = ask("سبب إصدار شهادة بديلة (تبقى الحالية في السجل «مستبدلة»):");
            if (!reason) return;
            try { const x = await api(`${A}/certificates/${r.id}/replace`, { reason }); toast("صدرت الشهادة البديلة"); await printIds(x.ids, out); }
            catch (e) { toast(e.message, true); }
          }, "ghost sm") : null,
          r.status === "issued" && canApprove ? btn("إلغاء", async () => {
            const reason = ask("سبب إلغاء الشهادة:");
            if (!reason) return;
            try { await api(`${A}/certificates/${r.id}/revoke`, { reason }); toast("أُلغيت. التحقق منها يظهر «ملغاة»."); nav.show(); }
            catch (e) { toast(e.message, true); }
          }, "ghost sm") : null))) : empty("لم تصدر شهادات لهذه الشعبة بعد.")), out];
  }

  async function customView(nav) {
    const students = await api(`${A}/students?class_id=${classId}`);
    const picker = await designPicker(`${A}/certificates`, "custom");
    const st = select(students.map((s) => [s.id, s.full_name || s.name]));
    const title = input({ value: "شهادة تقدير", maxLength: 120 });
    const text = textarea({ rows: 3, maxLength: 600, value: "تقديرًا لتفوقه وحسن سيرته وسلوكه، متمنين له دوام التوفيق والنجاح." });
    const out = h("div");
    return [panel("شهادة مخصصة لطالب", null,
      h("div", { class: "row" }, classPick(() => nav.show()), field("الطالب", st)),
      field("عنوان الشهادة", title), field("نص الشهادة", text, "يظهر مكان الحقل {{body}} في التصميم"), field("تصميم الشهادة", picker.el),
      canApprove ? null : notice("إصدار الشهادات لإدارة المدرسة العامة.", ""),
      canApprove && btn("إصدار وطباعة", async () => {
        if (!st.value) return toast("اختر الطالب", true);
        const r = await api(`${A}/certificates/custom`, { student_id: Number(st.value), title: title.value.trim(), body: text.value.trim(), template_id: picker.value() });
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
