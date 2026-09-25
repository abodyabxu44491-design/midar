// المدارس: قائمة قابلة للبحث، وصفحة احترافية لكل مدرسة:
// الروابط (الرابط ← نسخ ← فتح)، بيانات الدخول، الاشتراك والاستخدام، والإجراءات.
import { h, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { panel, empty, badge, btn, sub, toast, confirmAction, input, notice, linkRow, copyRow, stats, skeleton } from "/shared/js/ui.js";
import { fmtDate, fmtDateTime } from "/shared/js/format.js";
import { waLink } from "/shared/js/whatsapp.js";
import { SUB_STATUS, KIND, limitText } from "./sub-form.js";

const STATUS = { active: ["مفعّلة", ""], suspended: ["موقوفة", "red"], archived: ["مؤرشفة", "gray"] };

export default async function schools({ refresh }) {
  const list = await api("/api/owner/tenants");
  const root = h("div");
  if (!list.length) return panel("المدارس", null, empty("لا توجد مدارس. أضف أول مدرسة من تبويب «إضافة مدرسة»."));
  const q = input({ type: "search", placeholder: "ابحث باسم المدرسة أو رمزها" });
  const box = h("div");
  const draw = () => {
    const term = q.value.trim().toLowerCase();
    const rows = list.filter((x) => !term || x.name.toLowerCase().includes(term) || x.id.includes(term));
    mount(box, rows.length ? rows.map((x) => h("button", { type: "button", class: "school-row", onclick: () => schoolPage(x.id, root, () => refresh()) },
      h("div", {}, h("b", {}, x.name), " ", badge(...STATUS[x.status]), sub(`${x.id} — ${x.students} طالب — ${x.plan}${x.subscription_end ? ` — حتى ${fmtDate(x.subscription_end)}` : ""}`)),
      h("span", { class: "go", "aria-hidden": "true" }, "‹"))) : empty("لا توجد مدرسة مطابقة."));
  };
  q.addEventListener("input", draw);
  draw();
  mount(root, panel(`المدارس (${list.length})`, null, q, h("div", { class: "spaced" }), box));
  return root;
}

/* ---------- صفحة المدرسة ---------- */
async function schoolPage(id, root, back) {
  mount(root, skeleton(8));
  const d = await api(`/api/owner/tenants/${id}/overview`);
  const s = d.school, sub1 = d.subscription, L = d.links;
  const reload = () => schoolPage(id, root, back);
  const patch = (body, msg, ask) => async () => {
    if (ask && !confirmAction(ask)) return;
    await api(`/api/owner/tenants/${id}`, body, "PATCH");
    toast(msg); reload();
  };

  // كلمة المرور: لا تُعرض القديمة أبدًا (محفوظة ببصمة لا تُعكس). الجديدة تظهر مرة واحدة هنا.
  const pwBox = h("div");
  const issuePassword = async () => {
    if (!confirmAction(`إصدار كلمة مرور جديدة لمدير ${s.name}؟ ستتوقف كلمة المرور الحالية، وتُغلق جلساته المفتوحة.`)) return;
    const r = await api(`/api/owner/tenants/${id}/reset-admin`, {});
    const text = [`بيانات دخول ${s.name} على منصة مدار:`, `الرابط: ${L.staff.admin}`, `اسم المستخدم: ${r.credentials.username}`,
      `كلمة المرور المؤقتة: ${r.credentials.password}`, "سيطلب النظام تغيير كلمة المرور عند أول دخول."].join("\n");
    mount(pwBox,
      notice("كلمة المرور الجديدة تظهر الآن فقط. انسخها وأرسلها للمدرسة.", "warn"),
      copyRow("اسم المستخدم", r.credentials.username),
      copyRow("كلمة المرور المؤقتة", r.credentials.password, { note: "مؤقتة: يُطلب تغييرها عند أول دخول" }),
      h("div", { class: "row", style: "justify-content:flex-start" },
        h("a", { class: "btn whatsapp sm", href: `https://wa.me/?text=${encodeURIComponent(text)}`, target: "_blank", rel: "noopener" }, "إرسال عبر واتساب")));
  };

  const days = sub1?.days_left;
  mount(root,
    h("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:10px" },
      btn("رجوع للمدارس", back, "ghost sm"),
      h("div", { style: "text-align:end" }, h("h2", { style: "margin:0" }, s.name), sub(`${s.id} — أُنشئت ${fmtDate(s.created_at)}`))),
    stats([["الطلاب", sub1?.max_students ? `${s.students} / ${limitText(sub1.max_students)}` : s.students], ["المعلمون", s.teachers], ["الشعب", s.sections]]),

    panel("الاشتراك", badge(...STATUS[s.status]),
      sub1 ? [
        h("div", { class: "row", style: "flex-wrap:wrap;gap:18px" },
          h("div", {}, sub("الباقة"), h("b", {}, sub1.plan_name)),
          h("div", {}, sub("الحالة"), badge(...(SUB_STATUS[sub1.status] || [sub1.status, "gray"]))),
          h("div", {}, sub("النوع"), h("b", {}, KIND[sub1.kind])),
          h("div", {}, sub("البداية"), h("b", {}, fmtDate(sub1.starts_on))),
          h("div", {}, sub("النهاية"), h("b", {}, sub1.ends_on ? fmtDate(sub1.ends_on) : "بلا نهاية")),
          days != null && ["trial", "active"].includes(sub1.status) ? h("div", {}, sub("المتبقي"), h("b", {}, days >= 0 ? `${days} يوم` : "انتهى")) : null),
        sub1.kind === "trial" ? notice(`تجربة مجانية — التجارب المستخدمة لهذه المدرسة: ${sub1.trials}`, "warn") : null,
        sub("لإدارة الاشتراك (تجديد، ترقية، تمديد، إضافات) افتح تبويب «الاشتراكات»."),
      ] : notice("لا يوجد اشتراك لهذه المدرسة.", "warn")),

    panel("روابط المدرسة", null,
      h("h4", { class: "sec-title" }, "الصفحة العامة (لأولياء الأمور)"),
      linkRow("صفحة الطلاب وأولياء الأمور", L.public.home, { note: s.directory_code ? `رمز الصفحة: ${s.directory_code}` : null }),
      linkRow("قائمة الطلاب", L.public.students),
      h("h4", { class: "sec-title" }, "روابط الدخول (خاصة بالمنسوبين)"),
      linkRow("الإدارة", L.staff.admin), linkRow("المعلمون", L.staff.teacher), linkRow("المحاسب", L.staff.accountant),
      sub("روابط الدخول لا تظهر في الصفحة العامة للمدرسة.")),

    panel("بيانات الدخول", null,
      d.staff.length ? d.staff.map((u) => copyRow(`${u.role === "admin" ? "المدير" : "المحاسب"}: ${u.full_name}`, u.username,
        { note: [u.is_active ? null : "الحساب موقوف", u.must_change_password ? "لم يغيّر كلمة المرور المؤقتة بعد" : null,
          u.last_login_at ? `آخر دخول ${fmtDateTime(u.last_login_at)}` : "لم يدخل بعد"].filter(Boolean).join(" — ") })) : empty("لا توجد حسابات."),
      h("div", { class: "link-row" }, h("div", { class: "lr-text" }, h("b", {}, "كلمة المرور"),
        h("small", {}, "كلمات المرور محفوظة بتشفير لا يمكن عكسه، فلا يمكن لأحد عرضها — ولا حتى المالك. يمكنك إصدار كلمة مرور جديدة.")),
        h("div", { class: "lr-acts" }, btn("إصدار كلمة مرور جديدة", issuePassword, "secondary sm"))),
      pwBox),

    panel("الإجراءات", null, h("div", { class: "row", style: "justify-content:flex-start;flex-wrap:wrap" },
      s.status === "active"
        ? btn("إيقاف المدرسة", patch({ status: "suspended" }, "تم الإيقاف", `إيقاف ${s.name} يدويًا؟ سيُخرج جميع مستخدميها فورًا (البيانات لا تُحذف).`), "danger sm")
        : btn("تفعيل المدرسة", patch({ status: "active" }, "تم التفعيل"), "soft sm"),
      s.status !== "archived" ? btn("أرشفة", patch({ status: "archived" }, "تمت الأرشفة", `أرشفة ${s.name}؟`), "ghost sm") : null)));
  window.scrollTo({ top: 0 });
}
