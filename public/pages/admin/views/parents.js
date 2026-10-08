// أولياء الأمور (الإدارة): حساب واحد لكل ولي أمر مرتبط بكل أبنائه.
//   - إنشاء الحسابات تلقائيًا من أرقام الجوال المسجلة (حساب لكل رقم، مرتبط بكل طلابه، بلا تكرار)
//   - فتح الحساب: الأبناء المرتبطون (إضافة/فك)، صلة القرابة، صلاحية الرسوم، كلمة المرور المؤقتة، الإيقاف
//   - طلبات الربط من أولياء الأمور، وإعدادات التفعيل الذاتي والربط
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, btn, empty, notice, sub, toast, dialog, badge, switchBtn, confirmAction, keyText, line } from "../../shared/js/ui.js";
import { fmtDateTime } from "../../shared/js/format.js";
import { waLink } from "../../shared/js/whatsapp.js";
import { A } from "./common.js";

const R = () => `${A}/parents`;
const RELATION = [["father", "الأب"], ["mother", "الأم"], ["guardian", "ولي الأمر"], ["other", "آخر"]];
const REL = Object.fromEntries(RELATION);

export default async function parents({ me }) {
  const box = h("div", { class: "parents-admin" });
  let search = "";
  const parentLink = `${location.origin}/${me.school.id}`;
  const message = (c) => [`السلام عليكم ${c.name || ""}،`, `حساب ولي الأمر في ${me.school.name} لمتابعة كل أبنائكم من مكان واحد:`,
    parentLink, `اسم الدخول: ${c.phone}`, `كلمة المرور المؤقتة: ${c.password}`, "غيّروا كلمة المرور بعد أول دخول."].join("\n");
  const credsDialog = (title, list) => dialog(title, h("div", {},
    notice("سلّم كل ولي أمر بياناته. كلمة المرور المؤقتة تظهر أيضًا في ملفه حتى يغيّرها.", "warn"),
    h("div", { class: "pa-creds" }, list.map((c) => h("div", { class: "pa-cred" },
      h("div", {}, h("b", {}, c.name || "ولي الأمر"), h("small", { class: "sub" }, `${c.children ? `${c.children} من الأبناء · ` : ""}`, h("bdi", { dir: "ltr" }, c.phone))),
      keyText(c.password),
      waLink(c.phone, message(c), me.school.country_code || "967")
        ? h("a", { class: "btn sm", href: waLink(c.phone, message(c), me.school.country_code || "967"), target: "_blank", rel: "noopener" }, "واتساب") : null)))),
  [btn("نسخ الكل", async () => { await navigator.clipboard.writeText(list.map(message).join("\n\n")); toast("تم النسخ"); }, "ghost")]);

  async function draw() {
    const [list, reqs, settings] = await Promise.all([api(`${R()}?search=${encodeURIComponent(search)}`), api(`${R()}/requests`), api(`${R()}/settings`)]);
    const q = input({ value: search, placeholder: "بحث بالاسم أو الجوال أو اسم الابن", maxLength: 60 });
    let t;
    q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { search = q.value.trim(); draw(); }, 350); });
    const total = list.length, active = list.filter((p) => p.has_password && !p.must_change_password).length;
    mount(box,
      panel("أولياء الأمور", h("div", { class: "row" }, btn("+ حساب ولي أمر", () => editDialog(null), "sm"),
        btn("إنشاء الحسابات من أرقام الجوال", async () => {
          if (!confirmAction("يُنشأ حساب لكل رقم جوال ولي أمر مسجل، ويُربط بكل الطلاب المسجلين بنفس الرقم. الحسابات الموجودة تُكمَّل فقط. متابعة؟")) return;
          try {
            const r = await api(`${R()}/auto-create`, {});
            toast(`أُنشئ ${r.created} حساب، ورُبط ${r.linked} طالب`);
            if (r.credentials.length) credsDialog("بيانات الحسابات الجديدة", r.credentials);
            draw();
          } catch (e) { toast(e.message, true); }
        }, "ghost sm")),
      sub("حساب واحد لولي الأمر يرى منه كل أبنائه بدون معرّف لكل ابن. الطالب الواحد يمكن ربطه بأكثر من ولي أمر (الأب والأم)."),
      h("div", { class: "row" }, badge(`${total} حساب`, "gray"), badge(`${active} فعّلوا حساباتهم`, "")),
      q,
      list.length ? h("div", { class: "pa-list" }, list.map((p) => h("button", { type: "button", class: "pa-row", onclick: () => openParent(p.id) },
        h("div", { class: "pa-main" }, h("b", {}, p.name), h("small", { class: "sub" }, h("bdi", { dir: "ltr" }, p.phone || p.email), p.source === "self" ? " · سجّل بنفسه" : "",
          p.last_login_at ? ` · آخر دخول ${fmtDateTime(p.last_login_at)}` : p.has_password ? "" : " · لم يُفعَّل")),
        h("div", { class: "pa-kids" }, p.children.map((k) => h("span", { class: `pa-kid${k.active ? "" : " old"}` }, k.name.split(" ")[0]))),
        p.status === "disabled" ? badge("موقوف", "red") : p.must_change_password ? badge("كلمة مؤقتة", "amber") : null)))
        : empty(search ? "لا نتائج." : "لا توجد حسابات بعد. اضغط «إنشاء الحسابات من أرقام الجوال».")),
      reqs.length ? panel(`طلبات ربط الأبناء (${reqs.length})`, null, reqs.map((r) => line(
        h("div", {}, h("b", {}, `${r.parent_name} ← ${r.student_name}`),
          sub(`${r.class_name || ""} · الحساب ${r.phone || r.email || ""}${r.guardian_phone ? ` · جوال ولي الأمر المسجل ${r.guardian_phone}` : ""}${r.note ? ` · ${r.note}` : ""}`),
          r.guardian_phone && r.guardian_phone !== r.phone ? h("small", { class: "danger-text" }, "الجوال لا يطابق المسجل للطالب — تحقق قبل الموافقة") : null),
        h("div", { class: "row" },
          btn("موافقة", async () => { await api(`${R()}/requests/${r.id}`, { approve: true }); toast("رُبط الطالب"); draw(); }, "sm"),
          btn("رفض", async () => { await api(`${R()}/requests/${r.id}`, { approve: false }); draw(); }, "ghost sm"))))) : null,
      settingsPanel(settings));
  }

  function settingsPanel(s) {
    const rows = [["self_activation", "التفعيل الذاتي", "ولي الأمر يفعّل حسابه بنفسه بجواله المسجل + معرّف أحد أبنائه (ويستعيد كلمة المرور بنفس الطريقة)."],
      ["auto_link_siblings", "ربط الإخوة تلقائيًا", "عند التفعيل الذاتي يُربط كل الطلاب المسجلين بنفس جوال ولي الأمر."],
      ["link_by_key", "إضافة ابن بمعرّفه مباشرة", "إن أُوقف، يصير كل طلب إضافة بانتظار موافقتك."],
      ["allow_requests", "طلبات الربط برقم الطالب", "لمن لا يملك المعرّف: يرسل رقم الطالب واسمه، وتراجعه أنت."],
      ["show_inactive", "إظهار الأبناء السابقين", "المنقولون والمتخرجون يظهرون كسجل سابق (بلا فتح للملف)."]];
    return panel("إعدادات حسابات أولياء الأمور", null, rows.map(([k, label, hint]) => h("div", { class: "line" },
      h("div", {}, h("b", {}, label), sub(hint)),
      switchBtn(Boolean(s[k]), label, async () => {
        try { await api(`${R()}/settings`, { [k]: !s[k] }, "PUT"); s[k] = !s[k]; toast("حُفظ"); return true; } catch (e) { toast(e.message, true); return false; }
      }))));
  }

  function editDialog(p, onDone) {
    const name = input({ value: p?.name || "", maxLength: 120 });
    const phone = input({ value: p?.phone || "", type: "tel", dir: "ltr" });
    const email = input({ value: p?.email || "", type: "email", dir: "ltr" });
    const d = dialog(p ? "تعديل بيانات ولي الأمر" : "حساب ولي أمر جديد", h("div", {},
      field("الاسم", name), field("رقم الجوال", phone), field("البريد الإلكتروني", email, "يكفي أحدهما للدخول"),
      p ? null : sub("بعد الإنشاء افتح الحساب وأضف الأبناء.")),
    [btn("حفظ", async () => {
      try {
        const body = { name: name.value.trim(), phone: phone.value.trim() || null, email: email.value.trim() || null };
        if (p) { await api(`${R()}/${p.id}`, body, "PATCH"); d.close(); toast("حُفظ"); onDone?.(); return; }
        const r = await api(R(), body);
        d.close();
        credsDialog("بيانات الدخول", [{ name: body.name, ...r.credentials }]);
        draw(); openParent(r.id);
      } catch (e) { toast(e.message, true); }
    })]);
    name.focus();
  }

  async function openParent(id) {
    const p = await api(`${R()}/${id}`);
    const body = h("div");
    const reopen = () => { d.close(); openParent(id); draw(); };
    const kidRow = (k) => h("div", { class: "line" },
      h("div", {}, h("b", {}, k.name), " ", k.active ? null : badge("غير مقيد", "gray"),
        sub(`${k.class_name || ""} · ${REL[k.relation]}${k.can_view_fees ? "" : " · بلا رسوم"}`)),
      h("div", { class: "row" },
        btn(k.can_view_fees ? "إخفاء الرسوم" : "إظهار الرسوم", async () => {
          await api(`${R()}/${id}/link`, { student_id: k.id, can_view_fees: !k.can_view_fees }); reopen();
        }, "ghost sm"),
        btn("فك الارتباط", async () => {
          if (!confirmAction(`فك ارتباط ${k.name} بهذا الحساب؟ لن يراه ولي الأمر بعد الآن (ويبقى السجل).`)) return;
          await api(`${R()}/${id}/unlink`, { student_id: k.id }); toast("فُك الارتباط"); reopen();
        }, "danger sm")));
    // إضافة ابن: بحث في الطلاب
    const find = input({ placeholder: "ابحث عن طالب بالاسم أو المعرّف", maxLength: 60 });
    const rel = select(RELATION);
    const results = h("div", { class: "pa-results" });
    let t;
    find.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const v = find.value.trim();
        if (v.length < 2) return mount(results);
        const r = await api(`${A}/students?q=${encodeURIComponent(v)}&limit=10&fields=basic`).catch(() => null);
        const rows = (r?.students || r?.items || r || []).slice?.(0, 10) || [];
        mount(results, rows.length ? rows.map((s) => h("button", { type: "button", class: "pa-pick", onclick: async () => {
          try { await api(`${R()}/${id}/link`, { student_id: s.id, relation: rel.value }); toast(`أُضيف ${s.full_name || s.name}`); reopen(); } catch (e) { toast(e.message, true); }
        } }, h("b", {}, s.full_name || s.name), h("small", { class: "sub" }, s.class_name || ""))) : sub("لا نتائج."));
      }, 300);
    });
    mount(body,
      p.phone ? line(h("span", { class: "sub" }, "الجوال"), h("bdi", { dir: "ltr" }, p.phone)) : null,
      p.email ? line(h("span", { class: "sub" }, "البريد"), h("bdi", { dir: "ltr" }, p.email)) : null,
      line(h("span", { class: "sub" }, "الحالة"), p.status === "disabled" ? badge("موقوف", "red") : badge("فعال")),
      line(h("span", { class: "sub" }, "آخر دخول"), h("span", {}, p.last_login_at ? fmtDateTime(p.last_login_at) : "لم يدخل بعد")),
      p.initial_password ? line(h("span", { class: "sub" }, "كلمة المرور المؤقتة"), keyText(p.initial_password)) : null,
      h("h3", { class: "sec-title" }, `الأبناء (${p.children.length})`),
      p.children.length ? p.children.map(kidRow) : empty("لا يوجد أبناء مرتبطون."),
      h("h3", { class: "sec-title" }, "إضافة ابن"),
      h("div", { class: "row" }, find, rel), results,
      p.history.length ? [h("h3", { class: "sec-title" }, "ارتباطات سابقة"),
        p.history.map((x) => sub(`${x.name} — فُك ${fmtDateTime(x.removed_at)}${x.removed_by ? ` (${x.removed_by})` : ""}`))] : null);
    const d = dialog(p.name, body, [
      btn("تعديل البيانات", () => { d.close(); editDialog(p, () => openParent(id)); }, "ghost"),
      btn("كلمة مرور جديدة", async () => {
        if (!confirmAction("تُنشأ كلمة مرور مؤقتة جديدة، ويخرج ولي الأمر من كل أجهزته. متابعة؟")) return;
        const r = await api(`${R()}/${id}/reset-password`, {});
        d.close(); credsDialog("كلمة المرور الجديدة", [{ name: p.name, ...r }]);
      }, "ghost"),
      btn(p.status === "disabled" ? "تفعيل الحساب" : "إيقاف الحساب", async () => {
        await api(`${R()}/${id}/${p.status === "disabled" ? "enable" : "disable"}`, {}); reopen();
      }, p.status === "disabled" ? "" : "danger"),
    ]);
  }

  await draw();
  return box;
}

/** أولياء أمور الطالب (في ملف الطالب عند الإدارة) */
export async function studentParents(studentId) {
  const list = await api(`${A}/parents/of-student/${studentId}`).catch(() => []);
  return list.length ? list.map((p) => line(h("span", {}, `${p.name} (${REL[p.relation]})`), h("bdi", { dir: "ltr" }, p.phone || p.email)))
    : sub("لا يوجد حساب ولي أمر مرتبط بهذا الطالب.");
}
