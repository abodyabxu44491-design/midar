// صفحة طلاب المدرسة: الفصول والأسماء. الضغط على الاسم يطلب معرّف الطالب.
import { h, $, mount } from "/shared/js/dom.js";
import { api } from "/shared/js/api.js";
import { topbar, footer, field, input, btn, empty, notice, dialog, line, sub } from "/shared/js/ui.js";
import { fmtDate } from "/shared/js/format.js";

const app = $("#app");
const school = decodeURIComponent(location.pathname.split("/")[1] || "").toLowerCase();
const P = `/api/public/${encodeURIComponent(school)}`;
const ACCESS = `midar_access_${school}`;

async function start() {
  const access = sessionStorage.getItem(ACCESS);
  if (!access) return askAccess();
  try { show(await api(`${P}/directory`, { access })); }
  catch (e) {
    sessionStorage.removeItem(ACCESS);
    if (e.status === 404) return mount(app, topbar({}), h("main", {}, notice("المدرسة غير موجودة أو غير متاحة حاليًا.", "err"), h("a", { href: "/" }, "الرجوع")), footer());
    askAccess(e.message);
  }
}

function askAccess(error) {
  const code = input({ class: "ltr", placeholder: "رمز الصفحة", autocomplete: "off" });
  const msg = h("div", {}, error ? notice(error, "err") : null);
  const go = btn("دخول", async () => {
    try {
      const r = await api(`${P}/open`, { access: code.value });
      sessionStorage.setItem(ACCESS, code.value.trim().toUpperCase());
      localStorage.setItem("midar_school", school);
      document.title = `مِدار — ${r.school}`;
      start();
    } catch (e) { mount(msg, notice(e.message, "err")); }
  }, "wide");
  code.addEventListener("keydown", (e) => e.key === "Enter" && go.click());
  mount(app, topbar({ subtitle: "صفحة الطلاب وأولياء الأمور" }),
    h("main", {}, h("div", { class: "auth-card", style: "margin-top:24px" },
      h("h2", {}, "أدخل رمز صفحة المدرسة"),
      sub("الرمز تعطيه إدارة المدرسة لأولياء الأمور والطلاب."),
      field("رمز الصفحة", code), msg, go)),
    footer());
  code.focus();
}

function show(data) {
  const q = input({ placeholder: "ابحث عن اسم طالب", type: "search" });
  const list = h("div");
  const draw = () => {
    const term = q.value.trim();
    const groups = [...data.classes, ...(data.unassigned.length ? [{ id: 0, name: "طلاب بدون فصل", students: data.unassigned }] : [])]
      .map((c) => ({ ...c, students: c.students.filter((s) => s.name.includes(term)) }))
      .filter((c) => !term || c.students.length);
    mount(list, groups.length ? groups.map((c) => h("section", { class: "class-card" },
      h("h3", {}, h("span", {}, c.name), h("span", { class: "small" }, `${c.students.length} طالب`)),
      c.students.length
        ? h("ul", { class: "names" }, c.students.map((s) => h("li", {}, h("button", { type: "button", onclick: () => askKey(s) }, s.name))))
        : h("p", { class: "empty", style: "padding:0 16px" }, "لا يوجد طلاب."))) : empty("لا توجد نتائج."));
  };
  q.addEventListener("input", draw);
  document.title = `مِدار — ${data.school.name}`;
  mount(app,
    topbar({ school: data.school.name, subtitle: "الفصول والطلاب", onLogout: () => { sessionStorage.removeItem(ACCESS); location.href = `/${encodeURIComponent(school)}`; } }),
    h("main", {},
      data.announcements.length ? h("section", { class: "panel" }, h("h2", {}, "إعلانات المدرسة"),
        data.announcements.map((a) => line(h("div", {}, h("b", {}, a.title), h("div", {}, a.body), sub(fmtDate(a.created_at)))))) : null,
      notice("اضغط على اسم الطالب ثم أدخل معرّفه لفتح صفحته الكاملة ودفع الرسوم."),
      h("div", { style: "margin-bottom:12px" }, q),
      list),
    footer());
  draw();
}

function askKey(student) {
  const key = input({ class: "ltr", placeholder: "XXXX-XXXX", autocomplete: "off", maxLength: 9 });
  const msg = h("div");
  const open = btn("فتح الملف", async () => {
    try {
      await api(`${P}/student`, { student_id: student.id, key: key.value });
      sessionStorage.setItem(`midar_student_${school}`, JSON.stringify({ id: student.id, key: key.value.trim().toUpperCase() }));
      location.href = `/${encodeURIComponent(school)}/student`;
    } catch (e) { mount(msg, notice(e.message, "err")); }
  });
  key.addEventListener("keydown", (e) => e.key === "Enter" && open.click());
  dialog(student.name, h("div", {},
    sub("أدخل معرّف الطالب. تجده في البطاقة التي سلّمتها لك إدارة المدرسة."),
    field("معرّف الطالب", key), msg), [open]);
  key.focus();
}

start();
