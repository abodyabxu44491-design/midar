// باب منسوبي المدرسة: المدير والمعلم يدخلان من هنا،
// والنظام يفتح لكل واحد لوحته حسب دوره في هذه المدرسة.
import { h, $, mount } from "../shared/js/dom.js";
import { offlineProfile } from "../shared/js/offline/sync.js";
import { api } from "../shared/js/api.js";
import { brandLogo, footer, field, input, select, textarea, btn, notice, sub, dialog, showInstallBar, passwordInput, preloadModule } from "../shared/js/ui.js";
import { icons } from "../shared/js/icons.js";
import { startAnalytics } from "../shared/js/analytics.js";


const app = $("#app");
const school = decodeURIComponent(location.pathname.split("/")[1] || "").toLowerCase();

// كل لوحة تُحمّل بعد معرفة دور الحساب فقط (صفحة الدخول لا تحمل كود اللوحات الثلاث)
const portal = (rel, fn) => async (...args) => {
  preloadModule(new URL(rel, import.meta.url).pathname);   // كل ملفات اللوحة معًا بالتوازي
  return (await import(rel))[fn](...args);
};
const open = {
  admin: portal("../admin/app.js", "startAdmin"),
  teacher: portal("../teacher/app.js", "startTeacher"),
  accountant: portal("../accountant/app.js", "startAccountant"),
};

// التطبيق المثبّت يتبع الدور: بعد معرفة دور الحساب يصبح رابط الصفحة وملف التطبيق لهذا الدور،
// فإذا ثبّت المدير التطبيق يفتح على الإدارة، والمعلم على بوابة المعلم، والمحاسب على المحاسب.
const urlRole = new URLSearchParams(location.search).get("role");
function setAppRole(role) {
  const u = new URL(location.href);
  if (u.searchParams.get("role") !== role) {
    u.searchParams.set("role", role);
    history.replaceState(history.state, "", u.pathname + u.search + u.hash);
  }
  const link = document.querySelector('link[rel="manifest"]');
  const href = `/${encodeURIComponent(school)}/app.webmanifest?as=${role}`;
  if (link && link.getAttribute("href") !== href) link.setAttribute("href", href);
  document.documentElement.dataset.app = { admin: "الإدارة", teacher: "المعلم", accountant: "المحاسب" }[role];
  document.querySelectorAll(".install-ic").forEach((b) => { b.title = `ثبّت تطبيق ${document.documentElement.dataset.app}`; b.setAttribute("aria-label", b.title); });
}
const enter = (role, ...args) => { setAppRole(role); return open[role](...args); };

async function start() {
  // لو كانت هناك جلسة سارية نفتح لوحتها مباشرة.
  // كوكي كل دور مقصور على مسار واجهته (/api/admin …)، فنسأل الدور الأخير أولًا (طلب واحد غالبًا)،
  // ثم بقية الأدوار معًا بالتوازي بدل واحد بعد الآخر.
  // تطبيق مثبّت لدور معيّن يفتح ذلك الدور فقط (لا يفتح لوحة دور آخر مسجل على الجهاز نفسه)
  const pinned = open[urlRole] ? urlRole : null;
  const last = pinned || sessionStorage.getItem("midar_role") || localStorage.getItem("midar_last_role");
  const roles = ["admin", "teacher", "accountant"];
  // الشبكة لا تستجيب (حتى لو قال المتصفح إنه متصل: واي فاي بلا إنترنت، أو الخادم غير متاح)
  let netDown = !navigator.onLine;
  const probe = (role) => api(`/api/${role}/me`).then(() => role, (e) => {
    if (e.code === "network" || e.code === "timeout") netDown = true;
    throw e;
  });
  let role = null;
  if (navigator.onLine) {
    if (last && open[last]) role = await probe(last).catch(() => null);
    if (!role && !pinned) role = await Promise.any(roles.filter((r) => r !== last).map(probe)).catch(() => null);
  }
  if (role) { sessionStorage.setItem("midar_role", role); localStorage.setItem("midar_last_role", role); return enter(role); }
  // بدون اتصال: المعلم يكمل عمله من بيانات جهازه (إن سبق تجهيزها خلال آخر 7 أيام)
  const profile = offlineProfile();
  if (netDown && (!pinned || pinned === "teacher") && profile?.role === "teacher" && profile.me?.school?.id === school && Date.now() - profile.savedAt < 7 * 86400000) {
    return enter("teacher", profile.me);
  }
  showLogin(netDown ? "لا يوجد اتصال بالإنترنت. سجّل الدخول مرة واحدة متصلًا لتجهيز العمل بدون اتصال." : undefined);
}

function showLogin(error) {
  const user = input({ class: "ltr", autocomplete: "username", placeholder: "اسم المستخدم", autocapitalize: "none", autocorrect: "off", spellcheck: false });
  const pass = passwordInput({ autocomplete: "current-password", placeholder: "كلمة المرور" });
  // البقاء مسجلًا هو الافتراضي: الجلسة تبقى حتى تسجيل الخروج (يمكن إلغاؤه على جهاز مشترك)
  const remember = h("input", { type: "checkbox", id: "remember-me", checked: true });
  // اختيار الدور: يوضّح للمستخدم أي لوحة سيدخلها (والنظام يتحقق من الدور الفعلي للحساب)
  const ROLES = [["admin", "الإداري", "الطلاب والفصول"], ["accountant", "المحاسب", "الرسوم والمالية"], ["teacher", "المعلم", "الدرجات والحضور"]];
  const fromLink = new URLSearchParams(location.search).get("role");   // رابط الدور من صفحة المدرسة
  let chosen = ["admin", "teacher", "accountant"].includes(fromLink) ? fromLink : (localStorage.getItem("midar_last_role") || "admin");
  const roleCards = h("div", { class: "role-cards", role: "radiogroup", "aria-label": "اختر دورك" });
  const drawRoles = () => {
    mount(roleCards, ROLES.map(([k, name, note]) => h("button", {
      type: "button", class: `role-card${chosen === k ? " on" : ""}`, role: "radio", "aria-checked": String(chosen === k),
      onclick: () => { chosen = k; drawRoles(); submit.textContent = `دخول ${name}`; user.focus(); },
    }, name, h("small", {}, note))));
  };
  const msg = h("div", {}, error ? notice(error, "err") : null);

  // قفل المحاولات الخاطئة: عد تنازلي واضح، وزر الدخول معطل حتى ينتهي (ويبقى بعد تحديث الصفحة)
  const lockKey = () => `midar_lock_${school}_${user.value.trim().toLowerCase()}`;
  let lockTimer = null;
  const runLock = (until) => {
    clearInterval(lockTimer);
    submit.disabled = true;
    const time = h("b", { class: "lock-time", dir: "ltr" });
    const bar = h("i");
    const total = Math.max(1, Math.round((until - Date.now()) / 1000));
    mount(msg, h("div", { class: "lock-box", role: "timer", "aria-live": "polite" },
      h("div", { class: "lock-title" }, "تم إيقاف الدخول مؤقتًا بسبب محاولات خاطئة متكررة"),
      h("div", { class: "lock-sub" }, "يمكنك المحاولة مرة أخرى بعد"), time, h("div", { class: "lock-bar" }, bar),
      h("div", { class: "lock-sub" }, "نسيت كلمة المرور؟ استخدم «نسيت كلمة المرور» بالأسفل.")));
    const tick = () => {
      const left = Math.ceil((until - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(lockTimer); lockTimer = null;
        sessionStorage.removeItem(lockKey());
        submit.disabled = false;
        return mount(msg, notice("انتهى الإيقاف. يمكنك المحاولة الآن.", ""));
      }
      submit.disabled = true;   // يبقى معطلًا طوال القفل (حتى لو أعاد غلاف الزر تفعيله بعد انتهاء الطلب)
      time.textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
      bar.style.width = `${Math.min(100, (left / total) * 100)}%`;
    };
    tick();
    lockTimer = setInterval(tick, 250);
  };
  // عند كتابة اسم مستخدم مقفول سابقًا (أو بعد تحديث الصفحة) يعود العد التنازلي
  const checkLock = () => {
    const until = Number(sessionStorage.getItem(lockKey()) || 0);
    if (until > Date.now()) runLock(until);
    else if (lockTimer) { clearInterval(lockTimer); lockTimer = null; submit.disabled = false; mount(msg); }
  };
  const submit = btn("تسجيل الدخول", async () => {
    // (زر btn يعطّل نفسه أثناء التنفيذ لمنع الضغط المزدوج، فلا نعتمد على disabled هنا بل على حالة القفل)
    if (lockTimer) return;
    mount(msg);
    try {
      if (!user.value.trim() || !pass.value) return mount(msg, notice("أدخل اسم المستخدم وكلمة المرور", "err"));
      const r = await api("/api/staff/login", { school, username: user.value.trim(), password: pass.value, remember: remember.checked });
      pass.value = "";
      sessionStorage.setItem("midar_role", r.role);
      localStorage.setItem("midar_last_role", r.role);
      localStorage.setItem("midar_school", school);
      mount(app, h("p", { class: "empty loading" }, "جارٍ فتح لوحتك…"));
      await enter(r.role);
    } catch (e) {
      if (e.code === "locked" && e.retryAfter) {
        const until = Date.now() + e.retryAfter * 1000;
        sessionStorage.setItem(lockKey(), String(until));
        return runLock(until);
      }
      mount(msg, notice(e.message, "err"));
    }
  }, "wide");
  for (const el of [user, pass.inputEl || pass]) el.addEventListener("keydown", (e) => e.key === "Enter" && submit.click());
  user.addEventListener("input", checkLock);
  setTimeout(checkLock, 0);
  drawRoles();
  submit.textContent = `دخول ${ROLES.find(([k]) => k === chosen)?.[1] || ""}`;

  mount(app,
    h("div", { class: "gate" }, h("div", { class: "gate-wrap" },

      // الجانب التعليمي (يختفي على الجوال)
      h("aside", { class: "gate-aside hide-sm" },
        brandLogo("hero-logo", true, "stacked"),
        h("h1", {}, "بوابة إدارة المدرسة"),
        h("p", {}, "كل ما تحتاجه لإدارة مدرستك في مكان واحد."),
        h("ul", { class: "gate-points" },
          h("li", {}, icons.users({ size: 18 }), "الطلاب والفصول والحضور"),
          h("li", {}, icons.calendar({ size: 18 }), "الجداول والاختبارات والدرجات"),
          h("li", {}, icons.money({ size: 18 }), "الرسوم والفواتير والتقارير"))),

      // نموذج الدخول
      h("section", { class: "gate-card" },
        h("div", { class: "show-sm", style: "margin-bottom:10px" }, brandLogo("hero-logo", true, "stacked")),
        h("h2", {}, "بوابة إدارة المدرسة"),
        h("p", { class: "gate-sub" }, "كل ما تحتاجه لإدارة مدرستك في مكان واحد"),

        field("اسم المستخدم", user),
        field("كلمة المرور", pass),

        h("div", { class: "gate-row" },
          h("label", {}, remember, h("span", {}, "ابقني مسجلًا")),
          h("button", { class: "gate-link", type: "button", onclick: () => requestDialog(school) }, "نسيت كلمة المرور؟")),

        msg, submit,

        h("div", { class: "gate-roles" },
          h("h3", {}, "اختر دورك في المدرسة"),
          roleCards,
          sub("يفتح النظام لوحة دورك الفعلي من حسابك تلقائيًا.")),

        h("div", { class: "gate-foot" },
          h("span", { class: "gate-badge" }, icons.lock({ size: 14 }), "وصول خاص وآمن"),
          h("div", { style: "margin-top:6px" }, "تحتاج مساعدة؟ تواصل مع إدارة المدرسة"))))));

  user.focus();
  startAnalytics("staff-login");
}

/* ---------- نسيت كلمة المرور ----------
   المعلم والمحاسب ← إدارة المدرسة تتحقق وترسل رابط التغيير
   مدير المدرسة    ← مالك المنصة يتحقق ويرسل رابط التغيير
   (المسار الفعلي يحدده الخادم من دور الحساب نفسه، لا من المسمى المكتوب هنا) */
function requestDialog(schoolCode) {
  const f = {
    full_name: input({ placeholder: "الاسم الكامل كما في السجلات" }),
    username: input({ class: "ltr", placeholder: "اسم المستخدم", autocapitalize: "none", autocorrect: "off", spellcheck: false }),
    phone: input({ class: "ltr", inputMode: "tel", placeholder: "رقم الجوال للتواصل" }),
    branch: input({ placeholder: "المدرسة أو الفرع (اختياري)" }),
    job_title: select([["teacher", "معلم"], ["accountant", "محاسب"], ["admin", "مدير المدرسة (الإدارة)"]], { value: localStorage.getItem("midar_last_role") || "teacher" }),
    contact_pref: select([["whatsapp", "واتساب"], ["phone", "اتصال هاتفي"], ["email", "بريد إلكتروني"]]),
    description: textarea({ rows: 3, placeholder: "اشرح سبب الطلب (مثلًا: نسيت كلمة المرور)" }),
  };
  const who = h("div");
  const drawWho = () => mount(who, notice(f.job_title.value === "admin"
    ? "طلبك يصل إلى إدارة المنصة. بعد التحقق من هويتك يُرسل لك رابط آمن لتغيير كلمة المرور."
    : "طلبك يصل إلى إدارة مدرستك. بعد التحقق من هويتك تُرسل لك رابطًا آمنًا لتغيير كلمة المرور.", "warn"));
  f.job_title.addEventListener("change", drawWho);
  drawWho();
  const msg = h("div");

  const d = dialog("نسيت كلمة المرور", h("div", {},
    h("div", { class: "row" }, field("أنا", f.job_title), field("وسيلة التواصل المفضلة", f.contact_pref)),
    who,
    field("الاسم الكامل", f.full_name),
    h("div", { class: "row" }, field("اسم المستخدم", f.username), field("رقم الجوال", f.phone)),
    field("المدرسة أو الفرع", f.branch),
    field("وصف المشكلة", f.description),
    msg),
  [btn("إرسال الطلب", async (e) => {
    const button = e.currentTarget;
    mount(msg);
    button.disabled = true;
    try {
      const r = await api(`/api/public/${encodeURIComponent(schoolCode)}/password-request`, {
        full_name: f.full_name.value, username: f.username.value, phone: f.phone.value,
        branch: f.branch.value || null, job_title: f.job_title.value,
        description: f.description.value, contact_pref: f.contact_pref.value,
      });
      mount(msg, notice(`تم استلام طلبك. رقم الطلب: ${r.ref}. ${f.job_title.value === "admin" ? "ستتواصل معك إدارة المنصة" : "ستتواصل معك إدارة المدرسة"} للتحقق من بياناتك ثم ترسل لك رابط التغيير.`, ""));
      for (const el of [f.full_name, f.username, f.phone, f.branch, f.description]) el.value = "";
    } catch (err) { mount(msg, notice(err.message, "err")); }
    button.disabled = false;
  }, "primary")]);
}

start();
showInstallBar();
