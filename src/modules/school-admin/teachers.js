// المعلمون وحساباتهم (حسابات منفصلة تمامًا عن الإدارة)
import { Router } from "express";
import { inTenant } from "../../core/db/pool.js";
import { handle, notFound, conflict } from "../../core/http/errors.js";
import { parse, t, z } from "../../core/http/validate.js";
import { hashPassword } from "../../core/auth/password.js";
import { newTempPassword } from "../../core/auth/codes.js";
import { clearLoginFailures } from "../../core/audit.js";

const r = Router();
const loadSchema = z.array(z.object({ class_id: t.id, subject_id: t.id })).max(200).default([]);
const createSchema = z.object({ name: t.name("اسم المعلم"), username: t.username, phone: t.phone, load: loadSchema });

async function setLoad(q, teacherId, load) {
  await q("DELETE FROM teacher_assignments WHERE teacher_id = $1", [teacherId]);
  for (const l of load) {
    // المفاتيح الأجنبية المركبة ترفض أي فصل أو مادة من مدرسة أخرى
    await q(`INSERT INTO teacher_assignments (tenant_id, teacher_id, class_id, subject_id)
             VALUES (app_tenant(), $1, $2, $3) ON CONFLICT DO NOTHING`, [teacherId, l.class_id, l.subject_id]);
  }
}

r.get("/", handle(async (req, res) => {
  res.json(await inTenant(req, async (q) => {
    const list = await q(`SELECT t.id, t.full_name AS name, t.phone, u.username, u.is_active, u.last_login_at
      FROM teachers t JOIN users u ON u.teacher_id = t.id ORDER BY t.id`);
    const load = await q(`SELECT a.teacher_id, a.class_id, a.subject_id, c.name AS class_name, s.name AS subject_name
      FROM teacher_assignments a JOIN classes c ON c.id = a.class_id JOIN subjects s ON s.id = a.subject_id`);
    return list.map((x) => ({ ...x, load: load.filter((l) => l.teacher_id === x.id) }));
  }));
}));

r.post("/", handle(async (req, res) => {
  const b = parse(createSchema, req.body);
  const password = newTempPassword();
  const hash = await hashPassword(password);
  const id = await inTenant(req, async (q) => {
    const [taken] = await q("SELECT 1 FROM users WHERE username = $1", [b.username]);
    if (taken) throw conflict("اسم المستخدم مستخدم داخل المدرسة");
    const [tch] = await q("INSERT INTO teachers (tenant_id, full_name, phone) VALUES (app_tenant(), $1, $2) RETURNING id", [b.name, b.phone]);
    await q(`INSERT INTO users (tenant_id, role, full_name, username, password_hash, teacher_id, must_change_password)
             VALUES (app_tenant(), 'teacher', $1, $2, $3, $4, true)`, [b.name, b.username, hash, tch.id]);
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
    const [u] = await q(`UPDATE users SET password_hash = $2, must_change_password = true, password_changed_at = now(), failed_logins = 0, locked_until = NULL
                         WHERE teacher_id = $1 RETURNING id, username`, [id, hash]);
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

export default r;
