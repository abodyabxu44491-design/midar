// مراسلة أولياء الأمور من جهة المعلم: محادثاته مع أولياء أمور طلاب فصوله فقط
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, forbidden } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { sendMessage, threadFor, openThread, teacherTeachesStudent } from "../shared/chat.service.js";

const r = Router();

// المحادثات: الأحدث أولًا، مع عدد غير المقروء
r.get("/", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => {
    const threads = await q(
      `SELECT th.id, th.student_id, s.full_name AS student_name, c.name AS class_name, th.last_message_at, th.last_preview,
              th.teacher_unread AS unread
         FROM chat_threads th JOIN students s ON s.id = th.student_id LEFT JOIN classes c ON c.id = s.class_id
        WHERE th.teacher_id = $1 ORDER BY th.last_message_at DESC LIMIT 200`, [req.user.teacher_id]);
    return { threads, unread: threads.reduce((n, x) => n + x.unread, 0) };
  }));
}));

// بدء محادثة مع ولي أمر طالب من فصول المعلم
r.post("/start", handle(async (req, res) => {
  const b = parse(z.object({ student_id: t.id, text: z.string().max(2000) }), req.body);
  res.status(201).json(await inTenant(req, async (q) => {
    if (!(await teacherTeachesStudent(q, req.user.teacher_id, b.student_id))) throw forbidden("الطالب ليس في فصولك");
    return sendMessage(q, { studentId: b.student_id, teacherId: req.user.teacher_id, sender: "teacher", senderName: req.user.full_name, body: b.text });
  }));
}));

async function mine(q, req) {
  const th = await threadFor(q, { id: parse(t.id, req.params.id) });
  if (Number(th.teacher_id) !== Number(req.user.teacher_id)) throw forbidden("هذه المحادثة ليست لك");
  return th;
}

r.get("/:id", handle(async (req, res) => {
  const before = req.query.before ? parse(t.id, req.query.before) : null;
  res.json(await inTenant(req, async (q) => {
    const th = await mine(q, req);
    return { thread: { id: th.id, student_id: th.student_id, student_name: th.student_name, class_name: th.class_name },
      ...(await openThread(q, th, "teacher", before)) };
  }));
}));

r.post("/:id", handle(async (req, res) => {
  const b = parse(z.object({ text: z.string().max(2000) }), req.body);
  res.status(201).json(await inTenant(req, async (q) => {
    const th = await mine(q, req);
    return sendMessage(q, { studentId: th.student_id, teacherId: th.teacher_id, sender: "teacher", senderName: req.user.full_name, body: b.text });
  }));
}));

export default r;
