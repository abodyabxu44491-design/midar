/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { badRequest, forbidden, notFound } from "../../core/http/errors.js";
import { parse, z } from "../../core/http/validate.js";
import { notify } from "./notify.service.js";

export const bodySchema = z.string().trim().min(1, "اكتب الرسالة").max(1000, "الرسالة طويلة (1000 حرف كحد أقصى)");
const PAGE = 60;
const PARENT_HOURLY = 20;

const FLAG = new RegExp([
  "مبلغ", "فلوس", "ريال", "دولار", "حوال", "تحويل", "رقم حساب", "حساب بنك", "آيبان", "ايبان", "كاش", "هدي[ةه]", "هدايا", "رشو", "مكاف[أا]",
  "درس خصوصي", "دروس خصوصي", "خصوصي", "بالبيت", "في البيت", "خارج المدرسة", "برا المدرسة", "واتس", "واتساب", "تلجرام", "تليجرام", "سناب",
  "رقمي", "رقمك", "جوالي", "جوالك", "اتصل بي", "كلمني", "ادفع", "دفعة", "عمولة", "نجاح مضمون", "ترفيع", "زيادة درج", "رفع الدرج",
  "[0-9٠-٩][0-9٠-٩ -]{6,}[0-9٠-٩]",
].join("|"), "i");
export const needsReview = (text) => FLAG.test(String(text || "").replace(/[\u064B-\u0652]/g, ""));

export async function teachersOfStudent(q, student) {
  if (!student.class_id) return [];
  return q(
    `SELECT t.id, t.full_name AS name, array_agg(DISTINCT sb.name ORDER BY sb.name) AS subjects,
            (t.chat_enabled AND th.closed_at IS NULL) AS can_send, (th.closed_at IS NOT NULL) AS closed,
            th.id AS thread_id, COALESCE(th.parent_unread, 0) AS unread, th.last_message_at, th.last_preview
       FROM teacher_assignments a
       JOIN teachers t ON t.id = a.teacher_id
       JOIN subjects sb ON sb.id = a.subject_id
       LEFT JOIN chat_threads th ON th.teacher_id = t.id AND th.student_id = $2
      WHERE a.class_id = $1
      GROUP BY t.id, th.id
      ORDER BY th.last_message_at DESC NULLS LAST, t.full_name`, [student.class_id, student.id]);
}

export async function teacherTeachesStudent(q, teacherId, studentId) {
  const [ok] = await q(
    `SELECT 1 FROM teacher_assignments a JOIN students s ON s.class_id = a.class_id
      WHERE a.teacher_id = $1 AND s.id = $2 AND s.archived_at IS NULL LIMIT 1`, [teacherId, studentId]);
  return Boolean(ok);
}

export async function threadMessages(q, threadId, before = null, { withFlags = false } = {}) {
  const rows = await q(
    `SELECT id, sender, sender_name, body, created_at${withFlags ? ", flagged" : ""} FROM chat_messages
      WHERE thread_id = $1 AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT ${PAGE}`, [threadId, before]);
  return { messages: rows.reverse(), more: rows.length === PAGE };
}

async function threadOf(q, studentId, teacherId) {
  const [th] = await q(
    `INSERT INTO chat_threads (tenant_id, student_id, teacher_id) VALUES (app_tenant(), $1, $2)
     ON CONFLICT (tenant_id, student_id, teacher_id) DO UPDATE SET student_id = EXCLUDED.student_id
     RETURNING *`, [studentId, teacherId]);
  return th;
}

export async function sendMessage(q, { studentId, teacherId, sender, senderName, body }) {
  const text = parse(bodySchema, body);
  if (!(await teacherTeachesStudent(q, teacherId, studentId))) throw forbidden("المراسلة متاحة مع معلمي فصل الطالب فقط");
  const [perm] = await q("SELECT chat_enabled FROM teachers WHERE id = $1", [teacherId]);
  if (!perm?.chat_enabled) {
    throw forbidden(sender === "teacher" ? "لم تفعّل إدارة المدرسة المراسلة لك بعد." : "المراسلة مع هذا المعلم غير مفعّلة من إدارة المدرسة.");
  }
  const th = await threadOf(q, studentId, teacherId);
  if (th.closed_at) throw forbidden("أغلقت إدارة المدرسة هذه المحادثة.");
  const flagged = needsReview(text);
  if (sender === "parent") {
    const [{ n }] = await q(`SELECT count(*)::int AS n FROM chat_messages WHERE thread_id = $1 AND sender = 'parent'
                               AND created_at > now() - interval '1 hour'`, [th.id]);
    if (n >= PARENT_HOURLY) throw badRequest("أرسلت رسائل كثيرة خلال ساعة. انتظر رد المعلم قليلًا.");
  }
  const [msg] = await q(
    `INSERT INTO chat_messages (tenant_id, thread_id, sender, sender_name, body, flagged) VALUES (app_tenant(), $1, $2, $3, $4, $5)
     RETURNING id, sender, sender_name, body, created_at`, [th.id, sender, senderName || null, text, flagged]);
  const preview = text.length > 90 ? `${text.slice(0, 90)}…` : text;
  await q(
    `UPDATE chat_threads SET last_message_at = now(), last_preview = $2,
            parent_unread = CASE WHEN $3 = 'teacher' THEN parent_unread + 1 ELSE 0 END,
            teacher_unread = CASE WHEN $3 = 'parent' THEN teacher_unread + 1 ELSE 0 END
      WHERE id = $1`, [th.id, preview, sender]);
  const [names] = await q(
    `SELECT s.full_name AS student, t.full_name AS teacher FROM students s, teachers t WHERE s.id = $1 AND t.id = $2`, [studentId, teacherId]);
  if (flagged) {
    await q("UPDATE chat_threads SET flagged_at = now() WHERE id = $1", [th.id]);
    const admins = (await q("SELECT id FROM users WHERE role = 'admin' AND is_active")).map((u) => u.id);
    if (admins.length) {
      await notify(q, { event: "chat_review", users: admins, title: "رسالة تحتاج مراجعة في مراسلة المعلمين",
        body: `${sender === "teacher" ? names.teacher : `ولي أمر ${names.student}`}: ${preview}`, link: "communication",
        dedupKey: `chat-flag-${th.id}`, dedupMinutes: 360 });
    }
  }
  if (sender === "teacher") {
    await notify(q, { event: "chat", students: [studentId], title: `رسالة من ${names.teacher}`, body: preview, link: "chat",
      dedupKey: `chat-p-${th.id}`, dedupMinutes: 10 });
  } else {
    const users = (await q("SELECT id FROM users WHERE teacher_id = $1 AND is_active", [teacherId])).map((u) => u.id);
    if (users.length) await notify(q, { event: "chat", users, title: `رسالة من ولي أمر ${names.student}`, body: preview, link: "chat",
      dedupKey: `chat-t-${th.id}`, dedupMinutes: 10 });
  }
  return { thread_id: th.id, message: msg };
}

export async function openThread(q, th, reader, before) {
  if (!before) await q(`UPDATE chat_threads SET ${reader === "parent" ? "parent_unread" : "teacher_unread"} = 0 WHERE id = $1`, [th.id]);
  return threadMessages(q, th.id, before);
}

export async function threadFor(q, { id, teacherId, studentId }) {
  const [th] = await q(
    `SELECT th.*, s.full_name AS student_name, c.name AS class_name, t.full_name AS teacher_name
       FROM chat_threads th JOIN students s ON s.id = th.student_id JOIN teachers t ON t.id = th.teacher_id
       LEFT JOIN classes c ON c.id = s.class_id
      WHERE ${id ? "th.id = $1" : "th.teacher_id = $1 AND th.student_id = $2"}`, id ? [id] : [teacherId, studentId]);
  if (!th) throw notFound("المحادثة غير موجودة");
  return th;
}
