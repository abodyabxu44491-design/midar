// بطاقة الحضور: رمز QR يُمسح عند بوابة المدرسة. نفس التصميم للإدارة (طباعة شعبة كاملة) ولولي الأمر (بطاقة ابنه).
// الطباعة: ورقة A4 فيها البطاقات بمقاس بطاقة الهوية (8.6 × 5.4 سم)، تُقص وتُغلَّف.
import { h } from "./dom.js";

/** البطاقة الواحدة */
export const attendanceCard = (school, c) => h("article", { class: "ac" },
  h("div", { class: "ac-info" },
    h("small", { class: "ac-school" }, school),
    h("span", { class: "ac-kind" }, "بطاقة الحضور"),
    h("b", { class: "ac-name" }, c.name),
    h("span", { class: "ac-class" }, c.class_name || ""),
    h("small", { class: "ac-foot" }, `تُمسح عند بوابة المدرسة · إصدار ${c.version}`)),
  h("img", { class: "ac-qr", src: c.qr_img, alt: `رمز حضور ${c.name}` }));

/** طباعة بطاقات (واحدة أو شعبة كاملة) دون باقي الصفحة */
export function printCards(school, list) {
  const sheet = h("div", { class: "ac-sheet" }, list.map((c) => attendanceCard(school, c)));
  document.body.append(sheet);
  document.body.classList.add("ac-printing");
  const done = () => { sheet.remove(); document.body.classList.remove("ac-printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  // انتظار تحميل صور الرموز قبل فتح نافذة الطباعة
  Promise.all([...sheet.querySelectorAll("img")].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))))
    .then(() => { window.print(); setTimeout(() => { if (document.body.contains(sheet) && !matchMedia("print").matches) done(); }, 2000); });
}
