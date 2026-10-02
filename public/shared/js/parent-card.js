// بطاقة ولي الأمر: تصميم واحد للطباعة والشاشة، مع إرسال كل بطاقة وحدها (واتساب، صورة، طباعة)
import { h } from "./dom.js";
import { btn, toast, docLogo } from "./ui.js";
import { waLink } from "./whatsapp.js";

/** البطاقة نفسها (تُطبع كما تظهر) */
export function parentCard(d, s) {
  return h("article", { class: "pc", "data-id": s.id },
    h("header", { class: "pc-head" },
      h("div", { class: "pc-school" }, docLogo("pc-logo"), h("div", {}, h("b", {}, d.school), h("small", {}, "بطاقة ولي الأمر"))),
      h("span", { class: "pc-tag" }, "مدار")),
    h("div", { class: "pc-body" },
      h("div", { class: "pc-info" },
        h("div", { class: "pc-name" }, s.name),
        h("div", { class: "pc-meta" },
          h("span", {}, h("small", {}, "الصف"), h("b", {}, s.class_name || "—")),
          s.student_no ? h("span", {}, h("small", {}, "رقم الطالب"), h("b", { class: "ltr" }, s.student_no)) : null,
          h("span", {}, h("small", {}, "ولي الأمر"), h("b", {}, s.guardian_name || "—"))),
        h("div", { class: "pc-key" }, h("small", {}, "معرّف الطالب"), h("b", { class: "ltr" }, s.access_key))),
      h("figure", { class: "pc-qr" }, h("img", { src: s.qr, alt: "رمز فتح ملف الطالب" }), h("figcaption", {}, "امسح الرمز"))),
    h("footer", { class: "pc-foot" },
      h("span", { class: "ltr" }, d.link.replace(/^https?:\/\//, "")),
      h("span", {}, "امسح الرمز أو افتح الرابط وأدخل المعرّف. لا تشارك المعرّف مع أحد.")));
}

const message = (d, s) => [
  `السلام عليكم ${s.guardian_name ? `أ. ${s.guardian_name}` : "ولي الأمر الكريم"}،`,
  `هذه بطاقة متابعة ابنكم ${s.name} في ${d.school}.`,
  "",
  `رابط ملف الطالب (يفتح مباشرة): ${s.link}`,
  `معرّف الطالب: ${s.access_key}`,
  "",
  "من الملف تتابعون الحضور والدرجات والواجبات والرسوم والإشعارات. يُرجى عدم مشاركة المعرّف.",
].join("\n");

/** أزرار البطاقة الواحدة (لا تظهر في الطباعة) */
export function cardActions(d, s, cardEl) {
  const wa = waLink(s.guardian_phone || "", message(d, s), d.country_code || "967");
  return h("div", { class: "pc-actions no-print" },
    wa ? h("a", { class: "btn sm", href: wa, target: "_blank", rel: "noopener" }, "إرسال واتساب")
      : h("span", { class: "sub" }, "لا يوجد جوال لولي الأمر"),
    btn("مشاركة صورة", () => shareImage(d, s), "soft sm"),
    btn("نسخ الرسالة", async () => { try { await navigator.clipboard.writeText(message(d, s)); toast("نُسخت الرسالة"); } catch { toast("تعذر النسخ", true); } }, "ghost sm"),
    btn("طباعة هذه البطاقة", () => printOne(cardEl), "ghost sm"));
}

/** البطاقة مع أزرارها */
export const cardWithActions = (d, s) => {
  const el = parentCard(d, s);
  return h("div", { class: "pc-wrap" }, el, cardActions(d, s, el));
};

function printOne(el) {
  el.classList.add("pc-printing");
  document.body.classList.add("pc-print-one");
  const done = () => { el.classList.remove("pc-printing"); document.body.classList.remove("pc-print-one"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
  setTimeout(done, 1500);
}

// صورة البطاقة (PNG) مرسومة على لوحة، تُشارك من الجوال مباشرة أو تُنزَّل
const loadImg = (src) => new Promise((ok) => { if (!src) return ok(null); const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
async function cardPng(d, s) {
  await document.fonts?.ready;
  const W = 1200, H = 720, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const font = (w, px) => `${w} ${px}px 'IBM Plex Sans Arabic', system-ui, sans-serif`;
  const rr = (x, y, w, hh, r) => { g.beginPath(); g.roundRect(x, y, w, hh, r); };
  g.fillStyle = "#ffffff"; rr(0, 0, W, H, 36); g.fill();
  g.fillStyle = "#0B7A75"; rr(0, 0, W, 150, [36, 36, 0, 0]); g.fill();
  g.direction = "rtl"; g.textAlign = "right"; g.fillStyle = "#ffffff";
  const logo = await loadImg(document.querySelector(".doc-school-logo")?.src);
  let right = W - 50;
  if (logo) { g.fillStyle = "#ffffff"; rr(right - 100, 25, 100, 100, 22); g.fill(); g.drawImage(logo, right - 92, 33, 84, 84); right -= 125; }
  g.fillStyle = "#ffffff"; g.font = font(700, 44); g.fillText(d.school, right, 78);
  g.font = font(500, 28); g.fillStyle = "#cfe7e6"; g.fillText("بطاقة ولي الأمر", right, 120);
  g.textAlign = "left"; g.font = font(700, 30); g.fillStyle = "#F0A53A"; g.fillText("مدار", 50, 90); g.textAlign = "right";
  g.fillStyle = "#14213d"; g.font = font(800, 56); g.fillText(s.name, W - 50, 240);
  const rows = [["الصف", s.class_name || "—"], ...(s.student_no ? [["رقم الطالب", s.student_no]] : []), ["ولي الأمر", s.guardian_name || "—"]];
  rows.forEach(([k, v], i) => { g.font = font(500, 26); g.fillStyle = "#6b7280"; g.fillText(k, W - 50, 305 + i * 58); g.font = font(700, 32); g.fillStyle = "#14213d"; g.fillText(v, W - 230, 305 + i * 58); });
  g.fillStyle = "#fff4d6"; rr(380, 470, W - 430, 110, 22); g.fill(); g.strokeStyle = "#F0A53A"; g.lineWidth = 3; g.setLineDash([10, 8]); g.stroke(); g.setLineDash([]);
  g.font = font(600, 28); g.fillStyle = "#7a5800"; g.fillText("معرّف الطالب", W - 80, 535);
  g.textAlign = "left"; g.font = `800 52px ui-monospace, Menlo, monospace`; g.fillStyle = "#14213d"; g.fillText(s.access_key, 410, 545);
  const qr = await loadImg(s.qr);
  if (qr) { g.fillStyle = "#ffffff"; g.drawImage(qr, 50, 190, 290, 290); g.textAlign = "center"; g.font = font(600, 24); g.fillStyle = "#6b7280"; g.fillText("امسح الرمز", 195, 515); }
  g.fillStyle = "#f3f5f7"; rr(0, H - 110, W, 110, [0, 0, 36, 36]); g.fill();
  g.textAlign = "center"; g.font = font(600, 28); g.fillStyle = "#0B7A75"; g.fillText(d.link.replace(/^https?:\/\//, ""), W / 2, H - 62);
  g.font = font(500, 22); g.fillStyle = "#6b7280"; g.fillText("امسح الرمز أو افتح الرابط وأدخل المعرّف — لا تشارك المعرّف مع أحد", W / 2, H - 28);
  return new Promise((ok) => c.toBlob(ok, "image/png"));
}

async function shareImage(d, s) {
  const blob = await cardPng(d, s);
  const file = new File([blob], `بطاقة-${s.name}.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text: message(d, s) }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = h("a", { href: URL.createObjectURL(blob), download: file.name });
  document.body.append(a); a.click(); a.remove();
  toast("نُزّلت صورة البطاقة — أرسلها لولي الأمر");
}
