// التذكيرات التلقائية (تعمل كل ساعة، وكل تذكير يُرسل مرة واحدة فقط):
//   • قسط يستحق بعد N أيام، وقسط فات موعده ولم يُسدد (الأقساط وخصم الإخوة)
//   • كتاب تأخر إرجاعه (المكتبة)
//   • موعد ولي أمر غدًا (مواعيد أولياء الأمور)
import { transaction } from "../../core/db/pool.js";
import { notify, activeModules } from "./notify.service.js";
import { featureSettings } from "./feature-settings.service.js";

const localDay = (offset = 0) => new Date(Date.now() + offset * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Aden" });

// يسجل المفتاح؛ يعيد false إذا أُرسل سابقًا
const once = async (q, key) => (await q("INSERT INTO reminder_log (tenant_id, key) VALUES (app_tenant(), $1) ON CONFLICT DO NOTHING RETURNING key", [key])).length > 0;

export async function remindersFor(q) {
  const mods = await activeModules(q);
  const sent = { due: 0, overdue: 0, library: 0, meetings: 0, homework: 0 };
  // واجب يُسلَّم غدًا ولم يُسجَّل تسليمه بعد
  if (mods.homework !== false) {
    const tomorrow = localDay(1);
    const due = await q(`SELECT a.id, a.title, s.id AS student_id, sub.name AS subject FROM assignments a
      JOIN students s ON s.class_id = a.class_id AND s.archived_at IS NULL
      LEFT JOIN subjects sub ON sub.id = a.subject_id
      LEFT JOIN assignment_submissions x ON x.assignment_id = a.id AND x.student_id = s.id
      WHERE a.due_date = $1 AND COALESCE(x.submitted, false) = false`, [tomorrow]);
    for (const d of due) {
      if (!(await once(q, `hwdue:${d.id}:${d.student_id}`))) continue;
      await notify(q, { event: "homework_due", students: [d.student_id], title: `تذكير: واجب يُسلَّم غدًا`,
        body: `${d.title}${d.subject ? ` (${d.subject})` : ""} — موعد التسليم ${tomorrow}`, link: "homework" });
      sent.homework++;
    }
  }
  if (mods.fees && mods.installments) {
    const { reminder_days } = await featureSettings(q, "fees");
    if (reminder_days > 0) {
      const target = localDay(reminder_days);
      const due = await q(`SELECT i.id, i.student_id, i.title, i.amount - invoice_net_paid(i.id) AS remaining FROM invoices i
        WHERE i.status = 'open' AND i.due_date = $1 AND i.amount - invoice_net_paid(i.id) > 0`, [target]);
      for (const i of due) {
        if (!(await once(q, `due:${i.id}:${target}`))) continue;
        await notify(q, { event: "invoice", students: [i.student_id], title: `تذكير: قسط يستحق بعد ${reminder_days} ${reminder_days === 1 ? "يوم" : "أيام"}`,
          body: `${i.title} — المتبقي ${i.remaining} — يستحق ${target}`, link: "fees" });
        sent.due++;
      }
    }
    const yesterday = localDay(-1);
    const late = await q(`SELECT i.id, i.student_id, i.title, i.amount - invoice_net_paid(i.id) AS remaining FROM invoices i
      WHERE i.status = 'open' AND i.due_date = $1 AND i.amount - invoice_net_paid(i.id) > 0`, [yesterday]);
    for (const i of late) {
      if (!(await once(q, `overdue:${i.id}`))) continue;
      await notify(q, { event: "overdue", students: [i.student_id], title: "مبلغ متأخر: فات موعد سداد قسط", body: `${i.title} — المتبقي ${i.remaining}`, link: "fees" });
      sent.overdue++;
    }
  }
  if (mods.library) {
    const loans = await q(`SELECT l.id, l.student_id, b.title, l.due_on::text FROM library_loans l JOIN library_books b ON b.id = l.book_id
      WHERE l.returned_on IS NULL AND l.student_id IS NOT NULL AND l.due_on < $1`, [localDay()]);
    for (const l of loans) {
      if (!(await once(q, `loan:${l.id}`))) continue;
      await notify(q, { event: "library", students: [l.student_id], title: "تأخر إرجاع كتاب", body: `«${l.title}» — كان موعد إرجاعه ${l.due_on}` });
      sent.library++;
    }
  }
  if (mods.meetings) {
    const tomorrow = localDay(1);
    const rows = await q(`SELECT b.id, b.student_id, s.host_name, s.start_time::text, s.location, t.id AS teacher_id
      FROM meeting_bookings b JOIN meeting_slots s ON s.id = b.slot_id LEFT JOIN teachers t ON t.id = s.teacher_id
      WHERE b.status = 'booked' AND s.day = $1`, [tomorrow]);
    for (const b of rows) {
      if (!(await once(q, `meeting:${b.id}`))) continue;
      await notify(q, { event: "meeting", students: [b.student_id], title: "تذكير بموعدك غدًا",
        body: `مع ${b.host_name} الساعة ${b.start_time.slice(0, 5)}${b.location ? ` — ${b.location}` : ""}` });
      sent.meetings++;
    }
  }
  await q("DELETE FROM reminder_log WHERE created_at < now() - interval '400 days'");
  return sent;
}

/** كل المدارس الفعالة (من صيانة الخادم كل ساعة) */
export async function runReminders() {
  const tenants = await transaction({ platform: true, actor: "النظام" }, (q) => q("SELECT id FROM tenants WHERE status = 'active' AND emergency_locked_at IS NULL"));
  let total = 0;
  for (const t of tenants) {
    try {
      const r = await transaction({ tenantId: t.id, actor: "النظام" }, remindersFor);
      total += r.due + r.overdue + r.library + r.meetings + r.homework;
    } catch (e) { console.error(`[تذكيرات ${t.id}]`, e.message); }
  }
  return total;
}
