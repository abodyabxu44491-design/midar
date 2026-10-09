// مراسلة المعلمين: محادثة واحدة لكل (طالب، معلم). ولي الأمر يراسل المعلمين الذين يدرّسون فصل ابنه فقط،
// والمعلم يرد على أولياء أمور طلاب فصوله فقط. كل رسالة تُشعر الطرف الآخر (مركز الإشعارات + الجوال).
import { badRequest, forbidden, notFound } from "../../core/http/errors.js";
import { parse, z } from "../../core/http/validate.js";
import { notify } from "./notify.service.js";

export const bodySchema = z.string().trim().min(1, "اكتب الرسالة").max(1000, "الرسالة طويلة (1000 حرف كحد أقصى)");
const PAGE = 60;
const PARENT_HOURLY = 20;   // حد رسائل ولي الأمر في المحادثة الواحدة كل ساعة (منع الإزعاج)

// معلمو فصل الطالب ومواد كل معلم، مع حالة المحادثة إن وُجدت
export async function teachersOfStudent(q, student) {
  if (!student.class_id) return [];
  return q(
    `SELECT t.id, t.full_name AS name, array_agg(DISTINCT sb.name ORDER BY sb.name) AS subjects,
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

export async function threadMessages(q, threadId, before = null) {
  const rows = await q(
    `SELECT id, sender, sender_name, body, created_at FROM chat_messages
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

// إرسال رسالة من أحد الطرفين، وإشعار الطرف الآخر
export async function sendMessage(q, { studentId, teacherId, sender, senderName, body }) {
  const text = parse(bodySchema, body);
  if (!(await teacherTeachesStudent(q, teacherId, studentId))) throw forbidden("المراسلة متاحة مع معلمي فصل الطالب فقط");
  const th = await threadOf(q, studentId, teacherId);
  if (sender === "parent") {
    const [{ n }] = await q(`SELECT count(*)::int AS n FROM chat_messages WHERE thread_id = $1 AND sender = 'parent'
                               AND created_at > now() - interval '1 hour'`, [th.id]);
    if (n >= PARENT_HOURLY) throw badRequest("أرسلت رسائل كثيرة خلال ساعة. انتظر رد المعلم قليلًا.");
  }
  const [msg] = await q(
    `INSERT INTO chat_messages (tenant_id, thread_id, sender, sender_name, body) VALUES (app_tenant(), $1, $2, $3, $4)
     RETURNING id, sender, sender_name, body, created_at`, [th.id, sender, senderName || null, text]);
  const preview = text.length > 90 ? `${text.slice(0, 90)}…` : text;
  await q(
    `UPDATE chat_threads SET last_message_at = now(), last_preview = $2,
            parent_unread = CASE WHEN $3 = 'teacher' THEN parent_unread + 1 ELSE 0 END,
            teacher_unread = CASE WHEN $3 = 'parent' THEN teacher_unread + 1 ELSE 0 END
      WHERE id = $1`, [th.id, preview, sender]);
  const [names] = await q(
    `SELECT s.full_name AS student, t.full_name AS teacher FROM students s, teachers t WHERE s.id = $1 AND t.id = $2`, [studentId, teacherId]);
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

// قراءة محادثة: تصفير غير المقروء لصاحب القراءة
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
