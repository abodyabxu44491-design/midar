// المعلمون وحساباتهم (حسابات منفصلة تمامًا عن الإدارة)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound, conflict, badRequest } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { hashPassword } from "../../core/auth/password.js";
import { newTempPassword } from "../../core/auth/codes.js";
import { clearLoginFailures, logEvent } from "../../core/audit.js";
import { sealCredential } from "../../core/auth/secret-box.js";
import * as file from "../shared/teacher-file.service.js";

const r = Router();
const loadSchema = z.array(z.object({ class_id: t.id, subject_id: t.id })).max(200).default([]);
// ملف المعلم: الرقم الوظيفي والهوية والبريد والتخصص والقسم — كلها اختيارية
const profileFields = {
  employee_no: t.optText(30),
  national_id: z.string().trim().regex(/^[0-9]{5,20}$/, "رقم الهوية أرقام فقط").optional().or(z.literal("")).transform((v) => v || null),
  email: z.string().trim().email("البريد غير صحيح").optional().or(z.literal("")).transform((v) => v || null),
  specialty: t.optText(60),
  department: t.optText(60),
  short_name: t.optText(60),
  job_title: t.optText(80),
  qualification: t.optText(120),
  address: t.optText(200),
  emergency_name: t.optText(120),
  emergency_phone: t.phone,
  gender: z.union([z.enum(["male", "female"]), z.literal(""), z.null()]).optional().transform((v) => v || null),
  employment_type: z.union([z.enum(["full_time", "part_time", "contract", "volunteer"]), z.literal(""), z.null()]).optional().transform((v) => v || null),
  birth_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ غير صحيح"), z.literal(""), z.null()]).optional().transform((v) => v || null),
  hire_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ غير صحيح"), z.literal(""), z.null()]).optional().transform((v) => v || null),
};
const EXTRA = ["short_name", "gender", "birth_date", "job_title", "qualification", "hire_date", "employment_type", "address", "emergency_name", "emergency_phone"];
const photoSchema = z.object({ data_url: z.string().max(220_000, "الصورة كبيرة").regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "صيغة الصورة غير مدعومة") });
const createSchema = z.object({ name: t.name("اسم المعلم"), username: t.username, phone: t.phone, load: loadSchema, ...profileFields });
const updateSchema = z.object({ name: t.name("اسم المعلم").optional(), phone: t.phone, load: loadSchema.optional(), ...profileFields });

async function setLoad(q, teacherId, load) {
  // لا يتكرر الإسناد نفسه (مادة + فصل) حتى لو أُرسل مرتين
  const seen = new Set();
  load = load.filter((l) => { const k = `${l.class_id}:${l.subject_id}`; if (seen.has(k)) return false; seen.add(k); return true; });
  await q("DELETE FROM teacher_assignments WHERE teacher_id = $1", [teacherId]);
  for (const l of load) {
    // المفاتيح الأجنبية المركبة ترفض أي فصل أو مادة من مدرسة أخرى
    await q(`INSERT INTO teacher_assignments (tenant_id, teacher_id, class_id, subject_id)
             VALUES (app_tenant(), $1, $2, $3) ON CONFLICT DO NOTHING`, [teacherId, l.class_id, l.subject_id]);
  }
}

r.get("/", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => {
    const list = await q(`SELECT t.id, t.full_name AS name, t.phone, t.employee_no, t.national_id, t.email,
             t.specialty, t.department, t.job_title, t.employment_type, (t.photo IS NOT NULL) AS has_photo, t.updated_at,
             u.username, u.is_active, u.last_login_at, u.must_change_password, u.password_changed_at, u.created_at AS account_created_at,
             u.username_changed_at, (u.locked_until IS NOT NULL AND u.locked_until > now()) AS locked
      FROM teachers t JOIN users u ON u.teacher_id = t.id ORDER BY t.id`);
    const load = await q(`SELECT a.teacher_id, a.class_id, a.subject_id, c.name AS class_name, s.name AS subject_name
      FROM teacher_assignments a JOIN classes c ON c.id = a.class_id JOIN subjects s ON s.id = a.subject_id`);
    return list.map(({ must_change_password, password_changed_at, account_created_at, username_changed_at, locked, ...x }) => ({
      ...x,
      account_state: file.accountStatus({ is_active: x.is_active, locked, must_change_password, last_login_at: x.last_login_at,
        password_changed_at, created_at: account_created_at, username_changed_at }),
      load: load.filter((l) => l.teacher_id === x.id),
    }));
  }));
}));

r.post("/", handle(async (req, res) => {
  const b = parse(createSchema, req.body);
  const password = newTempPassword();
  const hash = await hashPassword(password);
  const id = await inTenant(req, async (q) => {
    const [taken] = await q("SELECT 1 FROM users WHERE username = $1", [b.username]);
    if (taken) throw conflict("اسم المستخدم مستخدم داخل المدرسة");
    const limit = req.subscription?.max_teachers;
    if (limit && (await q("SELECT count(*)::int AS n FROM teachers"))[0].n >= limit) {
      throw badRequest(`وصلت لحد المعلمين في باقتك (${limit} معلم). اطلب الترقية من صفحة «اشتراكي».`);
    }
    await file.ensureUniqueEmployeeNo(q, b.employee_no);
    const [tch] = await q(
      `INSERT INTO teachers (tenant_id, full_name, phone, employee_no, national_id, email, specialty, department,
                             short_name, gender, birth_date, job_title, qualification, hire_date, employment_type, address, emergency_name, emergency_phone)
       VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
      [b.name, b.phone, b.employee_no ?? null, b.national_id ?? null, b.email ?? null, b.specialty ?? null, b.department ?? null,
       ...EXTRA.map((k) => b[k] ?? null)]);
    await q(`INSERT INTO users (tenant_id, role, full_name, username, password_hash, teacher_id, must_change_password, initial_password_enc)
             VALUES (app_tenant(), 'teacher', $1, $2, $3, $4, true, $5)`, [b.name, b.username, hash, tch.id, sealCredential(password, req.tenantId)]);
    await setLoad(q, tch.id, b.load);
    return tch.id;
  });
  res.status(201).json({ id, credentials: { school: req.tenantId, username: b.username, password } });
}));

r.put("/:id/load", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const load = parse(loadSchema, req.body?.load);
  await inTenant(req, async (q) => {
    const [x] = await q("SELECT id FROM teachers WHERE id = $1", [id]);
    if (!x) throw notFound("المعلم غير موجود");
    await setLoad(q, id, load);
  });
  res.json({ ok: true });
}));

r.post("/:id/reset-password", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const password = newTempPassword();
  const hash = await hashPassword(password);
  const username = await inTenant(req, async (q) => {
    const [u] = await q(`UPDATE users SET password_hash = $2, must_change_password = true, password_changed_at = now(), failed_logins = 0, locked_until = NULL,
                                initial_password_enc = $3
                         WHERE teacher_id = $1 RETURNING id, username`, [id, hash, sealCredential(password, req.tenantId)]);
    if (!u) throw notFound("المعلم غير موجود");
    await q("DELETE FROM sessions WHERE user_id = $1", [u.id]);
    await clearLoginFailures(q, req.tenantId, u.username);
    return u.username;
  });
  res.json({ credentials: { school: req.tenantId, username, password } });
}));

r.patch("/:id/active", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const { active } = parse(z.object({ active: z.boolean() }), req.body);
  await inTenant(req, async (q) => {
    const [u] = await q("UPDATE users SET is_active = $2 WHERE teacher_id = $1 RETURNING id", [id, active]);
    if (!u) throw notFound("المعلم غير موجود");
    if (!active) await q("DELETE FROM sessions WHERE user_id = $1", [u.id]);
  });
  res.json({ ok: true });
}));

// الحذف مسموح فقط إن لم يكن له سجل؛ غير ذلك استخدم الإيقاف
r.delete("/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  await inTenant(req, async (q) => {
    await q("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE teacher_id = $1)", [id]);
    const rows = await q("DELETE FROM teachers WHERE id = $1 RETURNING id", [id]);
    if (!rows.length) throw notFound("المعلم غير موجود");
  });
  res.json({ ok: true });
}));

// تعديل ملف المعلم وإسناده
r.patch("/:id", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(updateSchema, req.body);
  await inTenant(req, async (q) => {
    const [cur] = await q("SELECT * FROM teachers WHERE id = $1", [id]);
    if (!cur) throw notFound("المعلم غير موجود");
    if (b.load && Object.keys(req.body).length === 1) { await setLoad(q, id, b.load); return; }   // تعديل الإسناد وحده لا يمس البيانات
    await file.ensureUniqueEmployeeNo(q, b.employee_no, id);
    // الحقول الجديدة: ما لم يُرسل يبقى كما هو (لا تُمسح بيانات المدارس الحالية بطلب قديم)
    const pick = (k) => (req.body[k] === undefined ? cur[k] : b[k] ?? null);
    await q(
      `UPDATE teachers SET full_name = COALESCE($2, full_name), phone = $3, employee_no = $4,
          national_id = $5, email = $6, specialty = $7, department = $8,
          short_name = $9, gender = $10, birth_date = $11, job_title = $12, qualification = $13, hire_date = $14,
          employment_type = $15, address = $16, emergency_name = $17, emergency_phone = $18
        WHERE id = $1`,
      [id, b.name ?? null, b.phone ?? null, b.employee_no ?? null, b.national_id ?? null,
       b.email ?? null, b.specialty ?? null, b.department ?? null, ...EXTRA.map(pick)]);
    if (b.name) await q("UPDATE users SET full_name = $2 WHERE teacher_id = $1", [id, b.name]);
    if (b.load) await setLoad(q, id, b.load);
  });
  res.json({ ok: true });
}));

/**
 * توزيع المعلمين: حفظ إسناد عدة خلايا (شعبة × مادة ← معلم) دفعة واحدة.
 * teacher_id فارغ = إزالة الإسناد من هذه الخلية.
 */
const matrixSchema = z.object({
  items: z.array(z.object({ class_id: t.id, subject_id: t.id, teacher_id: t.optId })).min(1).max(2000),
});

r.post("/assignments/bulk", handle(async (req, res) => {
  const b = parse(matrixSchema, req.body);
  res.json(await inTenant(req, async (q) => {
    let saved = 0;
    for (const item of b.items) {
      await q("DELETE FROM teacher_assignments WHERE class_id = $1 AND subject_id = $2", [item.class_id, item.subject_id]);
      if (item.teacher_id) {
        await q(
          `INSERT INTO teacher_assignments (tenant_id, teacher_id, class_id, subject_id)
           VALUES (app_tenant(), $1, $2, $3) ON CONFLICT DO NOTHING`,
          [item.teacher_id, item.class_id, item.subject_id]);
      }
      saved++;
    }
    return { saved };
  }));
}));

// ملف المعلم الكامل (للإدارة فقط: الموجّه مقيّد بدور المدير). لا يعيد أي سر: لا كلمة مرور ولا hash.
r.get("/:id/file", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  res.json(await inTenant(req, (q) => file.fullProfile(q, id)));
}));

r.get("/:id/photo", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const p = await inTenant(req, (q) => file.getPhoto(q, id));
  res.set({ "Content-Type": p.photo_type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox" }).send(p.photo);
}));
r.put("/:id/photo", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const b = parse(photoSchema, req.body);
  await inTenant(req, (q) => file.setPhoto(q, id, b.data_url));
  res.json({ ok: true });
}));
r.delete("/:id/photo", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  await inTenant(req, (q) => file.removePhoto(q, id));
  res.json({ ok: true });
}));

// عرض بيانات الدخول الأولية: POST (لا يُخزَّن ولا يُجلب مسبقًا)، بطلب صريح، ويُسجَّل كل عرض في سجل النشاط
r.post("/:id/initial-credentials", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const out = await inTenant(req, async (q) => {
    const c = await file.revealInitialCredentials(q, id, req.tenantId);
    await logEvent(q, { tenantId: req.tenantId, actor: `${req.user?.role || "admin"}:${req.user?.username || req.user?.id}`,
      action: `عرض بيانات الدخول الأولية للمعلم ${c.username}` });
    return c;
  });
  res.set("Cache-Control", "no-store").json(out);
}));

r.patch("/:id/username", handle(async (req, res) => {
  const id = parse(t.id, req.params.id);
  const { username } = parse(z.object({ username: t.username }), req.body);
  res.json(await inTenant(req, (q) => file.changeUsername(q, id, username)));
}));

export default r;
