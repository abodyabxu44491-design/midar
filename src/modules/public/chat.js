// مراسلة المعلمين من جهة ولي الأمر (بمعرّف الطالب أو حساب ولي الأمر). كل طلب يتحقق من الطالب داخل مدرسته.
import { Router } from "express";
import { handle, notFound } from "../../core/http/errors.js";
import { limits } from "../../core/rate-limit.js";
import { parse, t, z } from "../../core/http/validate.js";
import { inSchool, verifyStudent } from "./context.js";
import { activeModules } from "../shared/notify.service.js";
import { teachersOfStudent, sendMessage, threadFor, openThread, teacherTeachesStudent } from "../shared/chat.service.js";

const r = Router({ mergeParams: true });

// الطالب + التأكد أن القسم مفعّل في المدرسة
async function student(req, q, tenant) {
  if (!(await activeModules(q)).chat) throw notFound("المراسلة غير متاحة في هذه المدرسة");
  return verifyStudent(req, tenant, q, req.body);
}

r.post("/student/chat", limits.studentKey, handle(async (req, res) => {
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await student(req, q, tenant);
    return { teachers: await teachersOfStudent(q, s) };
  }));
}));

const threadSchema = z.object({ teacher_id: t.id, before: t.optId });
r.post("/student/chat/thread", limits.studentKey, handle(async (req, res) => {
  const b = parse(threadSchema, req.body);
  res.json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await student(req, q, tenant);
    if (!(await teacherTeachesStudent(q, b.teacher_id, s.id))) throw notFound("المعلم غير موجود");
    const th = await threadFor(q, { teacherId: b.teacher_id, studentId: s.id }).catch(() => null);
    return th ? openThread(q, th, "parent", b.before) : { messages: [], more: false };
  }));
}));

const sendSchema = z.object({ teacher_id: t.id, text: z.string().max(2000) });
r.post("/student/chat/send", limits.studentKey, handle(async (req, res) => {
  const b = parse(sendSchema, req.body);
  res.status(201).json(await inSchool(req, "ولي أمر", async (q, tenant) => {
    const s = await student(req, q, tenant);
    return sendMessage(q, { studentId: s.id, teacherId: b.teacher_id, sender: "parent", senderName: `ولي أمر ${s.full_name}`, body: b.text });
  }));
}));

export default r;
