// عرض «ملف الطالب» الكامل: مصدر واحد تستخدمه صفحة ولي الأمر ونافذة الإدارة.
// الفرق الوحيد: الإدارة ترى كل الأقسام بلا معرّف دخول، وولي الأمر يرى ما تفعّله المدرسة ويستطيع الدفع.
import { h, mount } from "./dom.js";
import { empty, badge, line, sub, teacherCards, btn, dialog, field, textarea, toast } from "./ui.js";
import { money, fmtDate, fmtDay, ATTENDANCE } from "./format.js";
import { attendanceCard, printCards } from "./attendance-card.js";
import { alertCard } from "./student-alerts.js";
import { icons } from "./icons.js";
import { timetableGrid } from "./timetable.js";
import { featureSections } from "./student-file-features.js";

export const section = (title, ...kids) => h("section", { class: "panel" }, h("h2", {}, title), ...kids);
export const info = (label, value, cls = "") => line(h("span", { class: "sub" }, label), h("b", { class: cls }, value || "—"));
export const gradeLine = (g) => line(
  h("div", {}, h("b", {}, g.subject), sub(`${g.component && g.component !== g.title ? `${g.component} — ` : ""}${g.title}${g.exam_date ? ` — ${fmtDate(g.exam_date)}` : ""}`)),
  h("b", {}, `${g.score} / ${g.max_score}`));
const GENDER = { male: "ذكر", female: "أنثى" };

/** عرض الرسوم للقراءة فقط (الإدارة). ولي الأمر يمرّر دالته الخاصة التي فيها زر الدفع. */
export function feesReadOnly(f, compact = false) {
  const open = f.invoices.filter((i) => i.status === "open");
  return section("الرسوم والسداد",
    line(h("span", {}, "الحالة"), f.status === "paid" ? badge("مسدد الرسوم") : f.status === "unpaid" ? badge("لم يسدد بعد", "red") : badge("لا توجد رسوم", "gray")),
    line(h("span", {}, "الإجمالي"), h("b", {}, money(f.total))),
    line(h("span", {}, "المدفوع"), h("b", {}, money(f.paid))),
    line(h("span", {}, "المتبقي"), h("b", { class: f.remaining > 0 ? "danger-text" : "" }, money(f.remaining))),
    compact ? null : [h("h3", { class: "sec-title" }, "الفواتير"),
      open.length ? open.map((i) => line(h("div", {}, h("b", {}, i.title),
        sub(`فاتورة #${i.id} — ${money(i.amount)} — المتبقي ${money(Math.round((i.amount - i.paid) * 100) / 100)}${i.due_date ? ` — تستحق ${fmtDate(i.due_date)}` : ""}`))))
        : empty("لا توجد فواتير.")]);
}

/**
 * @param {object} d بيانات الملف من الخادم
 * @param {{fees?: (f, compact) => Node, toolbar?: Node|Node[], photo?: string|null}} opts
 * @returns {{ el: HTMLElement, open: (key:string)=>void }}
 */
export function studentFile(d, { fees = feesReadOnly, toolbar = null, photo = null, scrollTop = false, actions = {}, extra = [] } = {}) {
  const s = d.student, f = d.fees;
  const avg = d.grades_percent !== undefined && d.grades_percent !== null ? Math.round(d.grades_percent)
    : d.grades.length ? Math.round(d.grades.reduce((a, g) => a + (g.score / g.max_score) * 100, 0) / d.grades.length) : null;
  const count = (st) => d.attendance.filter((a) => a.status === st).length;
  const alerts = d.alerts || [];
  const unread = alerts.filter((a) => a.for_parent && !a.acknowledged_at).length;
  const recorded = d.attendance.length;
  // الغياب بعذر لا يُحسب على الطالب
  const counted = recorded - count("excused");
  const rate = counted > 0 ? Math.round(((count("present") + count("late")) / counted) * 100) : null;
  // التنبيهات أعلى الملف: غياب بلغ الحد، وتنبيهات لم يطّلع عليها ولي الأمر
  const banners = () => [
    d.absence_warning ? h("div", { class: "sub-banner warn", role: "alert" }, icons.alert({ size: 20 }),
      h("div", {}, h("b", {}, "تنبيه غياب"),
        h("small", {}, `غاب الطالب ${d.absence_warning.absent} ${d.absence_warning.absent >= 3 && d.absence_warning.absent <= 10 ? "أيام" : "يومًا"} بلا عذر خلال آخر 30 يومًا.`)),
      btn("عرض الأيام", () => open("attendance"), "ghost sm")) : null,
    !d.admin && unread ? h("div", { class: "sub-banner trial" }, icons.megaphone({ size: 20 }),
      h("div", {}, h("b", {}, unread === 1 ? "تنبيه جديد من المدرسة" : `${unread} تنبيهات جديدة من المدرسة`),
        h("small", {}, alerts.find((a) => !a.acknowledged_at)?.title || "")),
      btn("عرض", () => open("alerts"), "ghost sm")) : null,
  ];

  const sections = [
    { key: "overview", name: "نظرة عامة", note: "البيانات والملخص" },
    ...(d.settings.profile_show_grades ? [{ key: "grades", name: "الدرجات", note: d.academic?.term_name || "" }] : []),
    ...(d.settings.profile_show_attendance ? [{ key: "attendance", name: "الحضور والغياب", note: `${count("absent")} غياب` }] : []),
    ...(alerts.length || actions.addAlert ? [{ key: "alerts", name: "التنبيهات والملاحظات", note: unread && !d.admin ? `${unread} جديد` : `${alerts.length}` }] : []),
    ...(d.homework?.length ? [{ key: "homework", name: "الواجبات", note: `${d.homework.length} واجب` }] : []),
    ...(d.timetable?.length ? [{ key: "timetable", name: "الجدول الدراسي", note: "حصص الأسبوع" }] : []),
    ...(f ? [{ key: "fees", name: "الرسوم والسداد", note: f.status === "unpaid" ? money(f.remaining) : "مسدد" }] : []),
    ...(d.settings.profile_show_teachers && d.teachers.length ? [{ key: "teachers", name: "المعلمون والمواد", note: "" }] : []),
    ...(d.announcements.length ? [{ key: "news", name: "التعاميم", note: `${d.announcements.length}` }] : []),
    // أقسام إضافية (الإشعارات، السلوك، الصحة، النقل، الاختبارات الإلكترونية، الشهادات…) كل منها يأتي بعرضه
    ...featureSections(d, actions),
    ...extra.map(({ key, name, note }) => ({ key, name, note })),
  ];

  const views = {
    overview: () => [
      banners(),
      section("البيانات الأساسية",
        info("اسم الطالب", s.name),
        d.admin ? info("رقم الطالب", s.student_no) : null,
        info("الفصل", s.class_name),
        d.admin ? [info("تاريخ الميلاد", s.birth_date ? fmtDate(s.birth_date) : ""), info("الجنس", GENDER[s.gender]), info("جوال الطالب", s.student_phone, "ltr")] : null,
        info("ولي الأمر", s.guardian_name), info("جوال ولي الأمر", s.guardian_phone, "ltr"), info("تاريخ التسجيل", fmtDate(s.since)),
        ...(d.custom || []).map((c) => info(c.label, c.value))),
      d.settings.profile_show_grades && d.grades.length ? section("آخر الدرجات", d.grades.slice(0, 4).map(gradeLine)) : null,
      f ? fees(f, true) : null,
    ],
    grades: () => section(d.academic?.term_name ? `الدرجات — ${d.academic.term_name}` : "الدرجات",
      d.grades.length ? d.grades.map(gradeLine) : empty("لم تُنشر درجات بعد.")),
    attendance: () => attendanceView(),
    alerts: () => section("التنبيهات والملاحظات",
      actions.addAlert ? h("div", { class: "row spaced", style: "justify-content:flex-start" }, btn("+ إضافة تنبيه", () => actions.addAlert(() => open("alerts")), "sm")) : null,
      alerts.length ? h("div", { class: "sa-list" }, alerts.map((a) => alertCard(a, {
        staff: d.admin, onAck: actions.ack || null,
        onDelete: actions.deleteAlert ? () => actions.deleteAlert(a, () => { alerts.splice(alerts.indexOf(a), 1); open("alerts"); }) : null,
      }))) : empty("لا توجد تنبيهات.")),
    homework: () => section("الواجبات", d.homework.map((w) => line(
      h("div", {}, h("b", {}, w.title), " ", w.submitted ? badge("سُلّم") : badge("لم يُسلّم", "amber"),
        sub(`${w.subject}${w.teacher ? ` — ${w.teacher}` : ""}${w.due_date ? ` — التسليم ${fmtDate(w.due_date)}` : ""}`),
        w.details ? sub(w.details) : null)))),
    timetable: () => section("الجدول الدراسي",
      timetableGrid(d.timetable, { cell: (day, p2, sl) => (sl
        ? [h("b", { class: "small" }, sl.subject), sl.teacher ? h("div", { class: "small muted" }, sl.teacher) : null]
        : h("span", { class: "muted" }, "—")) })),
    fees: () => fees(f, false),
    teachers: () => section("المعلمون والمواد", teacherCards(d.teachers)),
    news: () => section("التعاميم", d.announcements.map((a) => line(
      h("div", {}, h("b", {}, a.title), sub(fmtDate(a.created_at)), a.body ? sub(a.body) : null)))),
    ...Object.fromEntries(featureSections(d, actions).map((x) => [x.key, x.view])),
    ...Object.fromEntries(extra.map((x) => [x.key, () => x.view({ reopen: () => open(x.key, true) })])),
  };

  // الحضور: ملخص، ونسبة، وتصفية، وسبب كل غياب أو تأخر، وإرسال عذر من ولي الأمر
  let attFilter = "absences";
  function attendanceView() {
    const FILTERS = [["absences", "الغياب والتأخر"], ["absent", "غياب"], ["late", "تأخر"], ["excused", "بعذر"], ["all", "كل الأيام"]];
    const rows = d.attendance.filter((a) => attFilter === "all" ? true : attFilter === "absences" ? a.status !== "present" : a.status === attFilter);
    const canExcuse = !d.admin && actions.excuse && d.settings.allow_parent_excuses;
    const STATE = { pending: ["عذرك قيد المراجعة", "amber"], accepted: ["قُبل العذر", ""], rejected: ["لم يُقبل العذر", "red"] };
    return section("الحضور والغياب",
      banners()[0],
      d.has_gate && actions.attendanceCard ? h("div", { class: "row spaced", style: "justify-content:flex-start" },
        btn("بطاقة الحضور (QR)", () => cardDialog(), "soft sm"), sub("تُمسح عند بوابة المدرسة فيُسجَّل الحضور ويصلك إشعار.")) : null,
      h("div", { class: "kpis inline att-inline" },
        h("div", { class: "s-present" }, h("b", {}, count("present")), "حاضر"), h("div", { class: "s-absent" }, h("b", {}, count("absent")), "غائب"),
        h("div", { class: "s-late" }, h("b", {}, count("late")), "متأخر"), h("div", { class: "s-excused" }, h("b", {}, count("excused")), "بعذر"),
        h("div", { class: "s-rate" }, h("b", {}, rate === null ? "—" : `${rate}%`), "نسبة الحضور")),
      monthly(),
      h("div", { class: "xb-chips" }, FILTERS.map(([k, label]) => h("button", { type: "button", class: `xb-chip${k === attFilter ? " on" : ""}`,
        onclick: () => { attFilter = k; open("attendance", true); } }, label))),
      canExcuse && d.attendance.some((a) => a.can_excuse && !a.parent_excuse_state) ? sub("تستطيع إرسال عذر عن أي غياب أو تأخر خلال آخر 30 يومًا، وتراجعه الإدارة.") : null,
      rows.length ? h("div", { class: "att-days" }, rows.map((a) => h("div", { class: `att-day-row s-${a.status}` },
        h("div", { class: "att-day-main" },
          h("b", {}, fmtDay(a.day)),
          a.first_in_at ? h("small", {}, `حضر من ${a.gate_name || "البوابة"} ${new Date(a.first_in_at).toLocaleTimeString("ar", { hour: "numeric", minute: "2-digit" })}${a.minutes_late ? ` — متأخر ${a.minutes_late} دقيقة` : ""}`) : null,
          a.excuse ? h("small", {}, `السبب: ${a.excuse}`) : null,
          a.parent_excuse && a.parent_excuse_state !== "accepted" ? h("small", {}, `عذر ولي الأمر: ${a.parent_excuse}`) : null),
        h("div", { class: "att-day-side" },
          h("span", { class: `stu-today s-${a.status}` }, ATTENDANCE[a.status]?.[0] || a.status),
          a.parent_excuse_state ? badge(STATE[a.parent_excuse_state][0], STATE[a.parent_excuse_state][1]) : null,
          canExcuse && a.can_excuse && a.parent_excuse_state !== "pending"
            ? btn(a.parent_excuse_state === "rejected" ? "إعادة إرسال عذر" : "إرسال عذر", () => excuseDialog(a), "ghost sm") : null))))
        : empty(recorded ? "لا توجد أيام بهذا التصنيف." : "لا توجد سجلات حضور بعد."));
  }
  // إحصاءات كل شهر: أيام الحضور، الغياب، التأخر، النسبة، ومتوسط التأخر بالدقائق
  function monthly() {
    const by = new Map();
    for (const a of d.attendance) {
      const m = a.day.slice(0, 7);
      if (!by.has(m)) by.set(m, { present: 0, late: 0, absent: 0, excused: 0, other: 0, lateMin: [] });
      const x = by.get(m);
      if (a.status in x && a.status !== "other") x[a.status]++; else x.other++;
      if (a.status === "late" && a.minutes_late) x.lateMin.push(a.minutes_late);
    }
    if (by.size < 1) return null;
    const name = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString("ar", { month: "long", year: "numeric" });
    return h("div", { class: "table-wrap att-monthly" }, h("table", { class: "grid" },
      h("thead", {}, h("tr", {}, ["الشهر", "حضور", "غياب", "تأخر", "متوسط التأخر", "نسبة الحضور"].map((t) => h("th", {}, t)))),
      h("tbody", {}, [...by].sort((a, b) => b[0].localeCompare(a[0])).map(([m, x]) => {
        const base = x.present + x.late + x.absent;
        return h("tr", {}, h("td", {}, name(m)), h("td", {}, x.present + x.late), h("td", {}, x.absent), h("td", {}, x.late),
          h("td", {}, x.lateMin.length ? `${Math.round(x.lateMin.reduce((n, v) => n + v, 0) / x.lateMin.length)} د` : "—"),
          h("td", {}, base ? `${Math.round(((x.present + x.late) / base) * 100)}%` : "—"));
      }))));
  }
  async function cardDialog() {
    try {
      const c = await actions.attendanceCard();
      dialog("بطاقة الحضور", h("div", { class: "ac-preview" }, attendanceCard(c.school, c),
        sub("اطبعها وغلّفها، أو اعرضها من الجوال عند البوابة. إذا فُقدت اطلب من المدرسة إيقافها وإصدار بطاقة جديدة.")),
      [btn("طباعة البطاقة", () => printCards(c.school, [c]))]);
    } catch (e) { toast(e.message, true); }
  }
  function excuseDialog(a) {
    const text = textarea({ rows: 3, maxLength: 300, placeholder: "مثال: كان مريضًا ومعه تقرير طبي" });
    const dd = dialog(`عذر ${ATTENDANCE[a.status]?.[0] || ""} يوم ${fmtDay(a.day)}`, h("div", {},
      field("العذر", text), sub("يصل للإدارة لمراجعته، وإذا قُبل يتحول الغياب إلى «غياب بعذر».")),
    [btn("إرسال العذر", async () => {
      if (text.value.trim().length < 3) return toast("اكتب العذر", true);
      try {
        await actions.excuse(a.day, text.value.trim());
        Object.assign(a, { parent_excuse: text.value.trim(), parent_excuse_state: "pending" });
        dd.close(); toast("أُرسل العذر للإدارة"); open("attendance", true);
      } catch (e) { toast(e.message, true); }
    })]);
    text.focus();
  }

  const body = h("div", { class: "profile-body" });
  const nav = h("nav", { class: "profile-nav" });
  const open = (key, stay = false) => {
    nav.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.k === key));
    mount(body, views[key]());
    if (scrollTop && !stay) window.scrollTo({ top: 0, behavior: "smooth" });
  };
  mount(nav, sections.map((sec) => h("button", { type: "button", "data-k": sec.key, onclick: () => open(sec.key) },
    h("span", {}, sec.name), sec.note ? h("small", {}, sec.note) : null)));

  const avatar = d.admin
    ? (photo ? h("img", { class: "s-photo lg", src: photo, alt: "" }) : h("span", { class: "s-photo lg ph", "aria-hidden": "true" }, [...s.name][0] || "؟"))
    : null;
  const el = h("div", { class: "student-file" },
    toolbar,
    h("div", { class: "profile-head" },
      h("div", { class: "ph-row" }, avatar, h("div", {},
        h("h1", {}, s.name),
        h("div", { style: "opacity:.85" }, [s.class_name, d.admin && s.student_no ? `رقم ${s.student_no}` : null].filter(Boolean).join(" — ")))),
      h("div", { class: "kpis" },
        d.settings.profile_show_grades ? h("div", {}, h("b", {}, avg === null ? "—" : `${avg}%`), "متوسط الدرجات") : null,
        d.settings.profile_show_attendance ? h("div", {}, h("b", {}, count("absent")), "أيام الغياب") : null,
        d.settings.profile_show_attendance ? h("div", {}, h("b", {}, count("late")), "مرات التأخر") : null,
        d.settings.profile_show_attendance && rate !== null ? h("div", {}, h("b", {}, `${rate}%`), "نسبة الحضور") : null,
        f ? h("div", {}, h("b", {}, f.status === "paid" ? "مسدد" : f.status === "unpaid" ? money(f.remaining) : "—"),
          f.status === "unpaid" ? "رسوم متبقية" : "حالة الرسوم") : null)),
    h("div", { class: "profile-layout" }, nav, body));
  const first = scrollTop;
  open("overview");
  void first;
  return { el, open };
}
