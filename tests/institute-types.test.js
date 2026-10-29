/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, ownerPassword, endPool, uid, setupAdmin } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";
import { writeCertificate } from "../src/modules/shared/certificates.service.js";

let srv, owner;
const I = "/api/admin/institute";

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
});
after(async () => { await srv.close(); await endPool(); });

async function make(key, name) {
  const id = `it-${uid()}`;
  const r = await owner.post("/api/owner/tenants", { id, name, org_type_key: key });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const [u] = await transaction({ tenantId: id }, (q) => q("SELECT full_name FROM users WHERE role = 'admin'"));
  const admin = await setupAdmin(client(srv.base), r.data.setup.url);
  await transaction({ tenantId: id }, (q) => q("UPDATE users SET must_change_password = false"));
  return { id, admin, managerName: u.full_name };
}

test("المعهد التدريبي كما كان تمامًا: متدرب ومدرب ومعهد ومدير المعهد", async () => {
  const { admin, managerName } = await make("training_institute", "معهد المهارات");
  const meta = (await admin.get(`${I}/meta`)).data;
  assert.equal(meta.settings.terms.trainee, "متدرب");
  assert.equal(meta.settings.terms.trainer, "مدرب");
  assert.equal(meta.settings.terms.org, "المعهد");
  assert.equal(meta.labels.staff_roles.director, "مدير المعهد");
  assert.equal(managerName, "مدير المعهد");
  const me = (await admin.get("/api/admin/me")).data;
  assert.equal(me.terms.student, "متدرب");
  assert.equal(me.terms.teacher, "مدرب");
});

test("المركز التعليمي بكلمات نوعه في كل مكان، والمؤسسة تعدّل فوقها، وصفحة التحقق تقول «المركز»", async () => {
  const { id, admin, managerName } = await make("learning_center", "مركز النجاح");
  let meta = (await admin.get(`${I}/meta`)).data;
  assert.equal(meta.settings.terms.trainee, "دارس");
  assert.equal(meta.settings.terms.trainees, "الدارسون");
  assert.equal(meta.settings.terms.trainer, "معلم");
  assert.equal(meta.settings.terms.org, "المركز");
  assert.equal(meta.settings.terms.course, "دورة", "ما لم يغيره النوع يبقى كلمة المحرك");
  assert.equal(meta.labels.staff_roles.director, "مدير المركز");
  assert.equal(managerName, "مدير المركز");
  assert.equal((await admin.get("/api/admin/me")).data.terms.student, "دارس");

  // The centre's own word over its type's, seen by both the institute screens and /me; its type's word again is not stored.
  assert.equal((await admin.put(`${I}/settings`, { terms: { trainee: "منتسب", course: "مقرر" } })).status, 200);
  meta = (await admin.get(`${I}/meta`)).data;
  assert.equal(meta.settings.terms.trainee, "منتسب");
  assert.equal(meta.settings.terms.trainees, "الدارسون");
  const me = (await admin.get("/api/admin/me")).data;
  assert.equal(me.terms.student, "منتسب");
  assert.equal(me.terms.course, "مقرر");
  assert.equal((await admin.put(`${I}/settings`, { terms: { trainee: "دارس", course: "مقرر" } })).status, 200);
  const [s] = await transaction({ tenantId: id }, (q) => q("SELECT terms FROM institute_settings"));
  assert.deepEqual(s.terms, { course: "مقرر" }, "لا يُخزن إلا ما يخالف كلمات النوع");

  const tr = await admin.post(`${I}/trainees`, { name: "سارة علي" });
  assert.equal(tr.status, 201, JSON.stringify(tr.data));
  const cert = await transaction({ tenantId: id }, (q) => writeCertificate(q, { studentId: tr.data.id, kind: "custom", title: "شهادة شكر وتقدير",
    data: { student: { name: "سارة علي" } }, actor: "اختبار" }));
  const v = (await client(srv.base).get(`/api/public/verify/${cert.code}`)).data;
  assert.equal(v.org_type, "institute");
  assert.equal(v.org_word, "المركز");
});

test("المدرسة لا ترى كلمات المعاهد في إعدادات مصطلحاتها، ولا تتغير صفحة التحقق لشهاداتها", async () => {
  const { admin } = await make("private_school", "مدرسة الأمل");
  const t = (await admin.get("/api/admin/settings/terms")).data;
  const keys = t.keys.map((k) => k.key);
  assert.ok(keys.includes("subject") && !keys.includes("course") && !keys.includes("org"));
  const types = (await owner.get("/api/owner/org-types")).data;
  assert.ok(types.engine_terms.institute.some((k) => k.key === "course" && k.name === "دورة"));
  assert.ok(types.engine_terms.institute.some((k) => k.key === "student" && k.name === "متدرب"));
});
