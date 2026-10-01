// قالب الشهادة للطباعة: صفحة A4 لكل شهادة، فيها الشعار والنتيجة والتوقيع ورمز QR للتحقق
import { h } from "./dom.js";
import { docLogo } from "./ui.js";
import { fmtDate } from "./format.js";

export function certificateEl(c) {
  const d = c.data;
  const result = d.result ? h("div", { class: `cert-result ${d.passed ? "pass" : "fail"}` }, `النتيجة: ${d.result}`) : null;
  return h("article", { class: `cert${c.revoked_at ? " revoked" : ""}` },
    h("div", { class: "cert-top" }, h("div", { class: "cert-school" }, d.school), docLogo("print-logo")),
    h("h2", { class: "cert-title" }, c.title),
    d.scope ? h("div", { class: "cert-scope" }, d.scope) : null,
    h("p", { class: "cert-intro" }, "تشهد إدارة المدرسة بأن الطالب ", h("b", {}, d.student.name),
      d.student.class_name ? [" من ", h("b", {}, d.student.class_name)] : null,
      d.body ? [" ", d.body] : " قد حصل على النتيجة الموضحة أدناه."),
    d.subjects?.length ? h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "المادة"), h("th", {}, "الدرجة"), h("th", {}, "من"), h("th", {}, "النسبة"), h("th", {}, "التقدير"))),
      h("tbody", {}, d.subjects.map((s) => h("tr", {}, h("td", {}, s.subject), h("td", {}, s.score), h("td", {}, s.max),
        h("td", {}, s.percent === null ? "—" : `${s.percent}%`), h("td", {}, s.grade)))),
      d.summary ? h("tfoot", {}, h("tr", {}, h("th", {}, "المجموع"), h("th", {}, d.summary.total), h("th", {}, d.summary.max),
        h("th", {}, d.summary.percent === null ? "—" : `${d.summary.percent}%`), h("th", {}, d.summary.grade))) : null) : null,
    result,
    d.rank ? h("div", { class: "cert-scope" }, `الترتيب في الشعبة: ${d.rank.position} من ${d.rank.of}`) : null,
    d.attendance?.recorded ? h("div", { class: "cert-scope" }, `الحضور: ${d.attendance.rate ?? "—"}% — أيام الغياب ${d.attendance.absent}`) : null,
    d.footer_note ? h("div", { class: "cert-scope" }, d.footer_note) : null,
    h("div", { class: "cert-foot" },
      h("div", { class: "cert-qr" }, h("img", { src: c.qr, alt: "رمز التحقق" }), "امسح للتحقق", h("div", { class: "ltr" }, c.code)),
      h("div", { class: "cert-scope" }, `تاريخ الإصدار: ${fmtDate(c.issued_at)}`),
      h("div", { class: "cert-sign" }, h("div", {}, d.signer?.title || "مدير المدرسة"), h("div", { class: "line-sign" }, d.signer?.name || " "))));
}

export const certificatesSheet = (list) => h("div", { class: "cert-sheet" }, list.map(certificateEl));
