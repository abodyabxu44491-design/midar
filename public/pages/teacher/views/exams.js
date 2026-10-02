// إنشاء الاختبارات وإدخال الدرجات وإرسالها للاعتماد
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, btn, empty, badge, line, sub, toast, notice, confirmAction } from "../../shared/js/ui.js";
import { EXAM, fmtDate, today } from "../../shared/js/format.js";
import { getSync } from "../../shared/js/offline/sync.js";
import { localExam, localScoreRows, saveScoresLocal, examSynced } from "../offline.js";

const T = "/api/teacher/exams";

export default async function exams({ me, refresh }) {
  if (!me.load.length) return empty("لا توجد مواد مسندة لك.");
  // القائمة من الخادم، وعند انقطاع الاتصال من الجهاز (مسودات الاختبارات المحفوظة محليًا)
  let list, offline = false;
  try { list = await api(T); } catch (e) {
    if (e.code !== "network" && e.code !== "timeout") throw e;
    const sy = getSync();
    const load = sy ? await sy.db.all("load") : [];
    const nameOf = (c, s2) => load.find((l) => Number(l.class_id) === Number(c) && Number(l.subject_id) === Number(s2)) || {};
    list = sy ? (await sy.db.all("exams")).map((e) => ({ ...e, class_name: nameOf(e.class_id, e.subject_id).class_name, subject_name: nameOf(e.class_id, e.subject_id).subject_name, graded: "—" })) : [];
    offline = true;
  }
  const pair = select(me.load.map((l) => [`${l.class_id}:${l.subject_id}`, `${l.class_name} — ${l.subject_name}`]));
  const title = input({ placeholder: "مثال: اختبار شهري، مشاركة الأسبوع الثالث" });
  const date = input({ type: "date", value: today() });
  const max = input({ type: "number", value: 20, min: 0.25, step: "0.25" });
  // نوع الدرجة من «توزيع الدرجات» الذي حددته الإدارة لصف هذا الفصل
  const kind = select([]);
  const kindField = field("نوع الدرجة", kind, "يُحسب في نتيجة الشهادة حسب وزنه");
  kindField.hidden = true;
  let autoTitle = "";
  const loadKinds = async () => {
    const [class_id] = pair.value.split(":");
    let comps = [];
    try { comps = await api(`${T}/components?class_id=${class_id}`); } catch { comps = []; }
    mount(kind, comps.map((c) => h("option", { value: c.id }, `${c.name} — ${Number(c.weight)}%`)));
    const def = comps.find((c) => c.is_default) || comps[0];
    if (def) kind.value = String(def.id);
    kindField.hidden = !comps.length;
    kind.comps = comps;
    syncTitle();
  };
  const syncTitle = () => {
    const c = (kind.comps || []).find((x) => String(x.id) === kind.value);
    if (c && (!title.value || title.value === autoTitle)) { autoTitle = c.name; title.value = c.name; }
  };
  pair.addEventListener("change", loadKinds);
  kind.addEventListener("change", syncTitle);
  if (!offline) queueMicrotask(loadKinds);
  return [
    panel("رصد درجات جديد", null,
      sub("كل أنواع الدرجات من هنا: اختبار، مشاركة، واجبات، مشروع… اختر النوع ثم أدخل درجات الطلاب."),
      h("div", { class: "row" }, field("الفصل والمادة", pair), kindField),
      h("div", { class: "row" }, field("العنوان", title), field("الدرجة القصوى", max)),
      field("التاريخ", date),
      btn("إنشاء", async () => {
        const [class_id, subject_id] = pair.value.split(":");
        await api(T, { class_id, subject_id, title: title.value, exam_date: date.value || null, max_score: max.value,
          component_id: !kindField.hidden && kind.value ? Number(kind.value) : undefined });
        toast("تم الإنشاء، أدخل الدرجات"); refresh();
      })),
    offline ? notice("غير متصل: تظهر الاختبارات المحفوظة على جهازك. يمكنك إدخال الدرجات الآن وتُرسل تلقائيًا عند عودة الاتصال.", "warn") : null,
    panel("درجاتي المرصودة", null, list.length ? list.map((e) => examRow(e, refresh)) : empty("لم ترصد درجات بعد.")),
  ];
}

function examRow(e, refresh) {
  const box = h("div", { class: "hidden", style: "background:var(--bg);border-radius:8px;padding:10px;margin-top:8px;width:100%" });
  const toggle = btn(e.status === "draft" ? "إدخال الدرجات" : "عرض الدرجات", async () => {
    if (!box.classList.contains("hidden")) return box.classList.add("hidden");
    // الدرجات من الجهاز أولًا إن كان الاختبار محفوظًا محليًا (يعمل بدون إنترنت)، وإلا من الخادم
    const local = await localExam(e.id);
    const rows = local ? await localScoreRows(local) : await api(`${T}/${e.id}/scores`);
    const locked = e.status !== "draft";
    const inputs = rows.map((r) => [r.id, input({ type: "number", min: 0, max: e.max_score, step: "0.25", value: r.score ?? "",
      disabled: locked, style: "width:90px", "aria-label": `درجة ${r.name}` })]);
    const collect = () => {
      const out = {};
      for (const [id, el] of inputs) {
        const v = el.value.trim();
        if (v !== "" && (Number(v) < 0 || Number(v) > e.max_score)) throw new Error(`درجة غير صحيحة: ${v} (القصوى ${e.max_score})`);
        out[id] = v === "" ? null : Number(v);
      }
      return out;
    };
    mount(box,
      locked ? notice("الدرجات مقفلة بعد الإرسال حتى تُرجعها الإدارة.", "warn") : null,
      rows.length ? rows.map((r, i) => line(h("span", {}, r.name, r.pending ? h("span", { class: "pending-dot" }, "بانتظار المزامنة") : null), inputs[i][1])) : empty("لا يوجد طلاب في الفصل."),
      !locked && h("div", { class: "row spaced", style: "justify-content:flex-start" },
        btn("حفظ مسودة", async () => {
          if (local) {
            const n = await saveScoresLocal(local, collect());
            toast(n ? (navigator.onLine ? `حُفظت ${n} درجة على الجهاز وتتم المزامنة` : `حُفظت ${n} درجة على الجهاز — تُرسل عند عودة الاتصال`) : "لا تغييرات");
          } else { const r = await api(`${T}/${e.id}/scores`, { scores: collect() }, "PUT"); toast(`تم حفظ ${r.saved} درجة`); }
        }, "soft sm"),
        btn("حفظ وإرسال للاعتماد", async () => {
          const scores = collect();
          const missing = Object.values(scores).filter((v) => v === null).length;
          if (!confirmAction(missing ? `هناك ${missing} طالب بدون درجة. إرسال للاعتماد؟` : "إرسال الدرجات للإدارة؟ لن تستطيع تعديلها بعد ذلك.")) return;
          // الإرسال للاعتماد يحتاج اتصالًا: كل الدرجات يجب أن تصل الخادم أولًا
          if (!navigator.onLine) return toast("الإرسال للاعتماد يحتاج اتصالًا. درجاتك محفوظة على الجهاز، أرسلها عند عودة الاتصال.", true);
          if (local) {
            await saveScoresLocal(local, scores);
            if (!(await examSynced(e.id))) return toast("لم تكتمل مزامنة الدرجات بعد (أو يوجد تعارض). راجع مؤشر المزامنة ثم أعد المحاولة.", true);
          } else await api(`${T}/${e.id}/scores`, { scores }, "PUT");
          await api(`${T}/${e.id}/submit`, {});
          toast("تم الإرسال للإدارة"); refresh();
        }, "sm")));
    box.classList.remove("hidden");
  }, "ghost sm");
  return line(
    h("div", {}, h("b", {}, e.title), " ", e.component_name ? badge(e.component_name, "gray") : null, " ", badge(...EXAM[e.status]),
      sub(`${e.class_name} — ${e.subject_name} — ${fmtDate(e.exam_date)} — من ${e.max_score} — أُدخلت ${e.graded}`)),
    toggle, box);
}
