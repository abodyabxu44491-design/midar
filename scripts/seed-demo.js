// مدرسة تجريبية كاملة للعرض والتجربة: npm run seed:demo
// لا تستخدمه على قاعدة بيانات الإنتاج الحقيقية.
import { transaction, closePool } from "../src/core/db/pool.js";
import { hashPassword } from "../src/core/auth/password.js";
import * as students from "../src/modules/shared/students.service.js";
import * as finance from "../src/modules/shared/finance.service.js";

const ID = "demo";
const ctx = { tenantId: ID, actor: "إعداد تجريبي" };
const ADMIN_PW = "Demo-Admin-2026", TEACHER_PW = "Demo-Teacher-2026";

const exists = await transaction(ctx, async (q) => (await q("SELECT 1 FROM tenants WHERE id = $1", [ID])).length > 0);
if (exists) { console.log("المدرسة التجريبية موجودة من قبل."); await closePool(); process.exit(0); }

const [adminHash, teacherHash] = await Promise.all([hashPassword(ADMIN_PW), hashPassword(TEACHER_PW)]);

const keys = await transaction(ctx, async (q) => {
  await q("INSERT INTO tenants (id, name, plan, max_students, subscription_end, directory_code) VALUES ($1, $2, 'pro', 500, '2027-08-31', 'NOUR2626')",
    [ID, "مدارس النور الأهلية (تجريبية)"]);
  await q("INSERT INTO users (tenant_id, role, full_name, username, password_hash) VALUES ($1, 'admin', 'مدير المدرسة', 'admin', $2)", [ID, adminHash]);

  const cls = [];
  for (const n of ["الرابع - أ", "الخامس - ب"]) cls.push((await q("INSERT INTO classes (tenant_id, name) VALUES (app_tenant(), $1) RETURNING id", [n]))[0].id);
  const sub = [];
  for (const n of ["اللغة العربية", "الرياضيات", "العلوم"]) sub.push((await q("INSERT INTO subjects (tenant_id, name) VALUES (app_tenant(), $1) RETURNING id", [n]))[0].id);

  const [t] = await q("INSERT INTO teachers (tenant_id, full_name) VALUES (app_tenant(), 'أ. منى سعيد') RETURNING id");
  await q("INSERT INTO users (tenant_id, role, full_name, username, password_hash, teacher_id) VALUES (app_tenant(), 'teacher', 'أ. منى سعيد', 'mona', $1, $2)", [teacherHash, t.id]);
  for (const [c, s] of [[cls[0], sub[0]], [cls[0], sub[1]], [cls[1], sub[2]]])
    await q("INSERT INTO teacher_assignments (tenant_id, teacher_id, class_id, subject_id) VALUES (app_tenant(), $1, $2, $3)", [t.id, c, s]);

  const tenant = { max_students: 500 };
  const list = await students.create(q, tenant, [
    { name: "يوسف محمد علي", class_id: cls[0], guardian_name: "محمد علي", guardian_phone: "0500000001", fees_enabled: true },
    { name: "سلمى هشام عادل", class_id: cls[0], guardian_name: "هشام عادل", guardian_phone: "0500000002", fees_enabled: true },
    { name: "عمر طارق إبراهيم", class_id: cls[0], guardian_name: "طارق إبراهيم", guardian_phone: "0500000003", fees_enabled: false },
    { name: "ليان محمد علي", class_id: cls[1], guardian_name: "محمد علي", guardian_phone: "0500000001", fees_enabled: true },
    { name: "ريم خالد حسن", class_id: cls[1], guardian_name: "خالد حسن", guardian_phone: "0500000004", fees_enabled: false },
  ]);

  const [e] = await q("INSERT INTO exams (tenant_id, class_id, subject_id, title, exam_date, max_score, created_by) VALUES (app_tenant(), $1, $2, 'اختبار قصير 1', '2026-09-10', 20, 'أ. منى سعيد') RETURNING id", [cls[0], sub[1]]);
  await q("INSERT INTO scores (tenant_id, exam_id, student_id, score, updated_by) VALUES (app_tenant(), $1, $2, 18, 'أ. منى سعيد'), (app_tenant(), $1, $3, 15.5, 'أ. منى سعيد')", [e.id, list[0].id, list[1].id]);
  await q("UPDATE exams SET status = 'published' WHERE id = $1", [e.id]);

  await q("INSERT INTO attendance (tenant_id, student_id, day, status, recorded_by) VALUES (app_tenant(), $1, CURRENT_DATE - 1, 'present', 'إعداد'), (app_tenant(), $2, CURRENT_DATE - 1, 'absent', 'إعداد')", [list[0].id, list[1].id]);

  await finance.createInvoices(q, { target: "student", target_id: list[0].id, title: "رسوم الفصل الأول", amount: 6000, due_date: "2026-09-30" }, "إعداد");
  await finance.createInvoices(q, { target: "student", target_id: list[1].id, title: "رسوم الفصل الأول", amount: 6000, due_date: "2026-09-30" }, "إعداد");
  await finance.createInvoices(q, { target: "student", target_id: list[3].id, title: "رسوم الفصل الأول", amount: 6500, due_date: "2026-09-30" }, "إعداد");
  const [inv] = await q("SELECT id FROM invoices WHERE student_id = $1", [list[0].id]);
  await finance.recordPayment(q, { invoiceId: inv.id, amount: 6000, method: "cash", note: null, idempotencyKey: "seed-payment-1", actor: "إعداد" });

  await q("INSERT INTO announcements (tenant_id, title, body, created_by) VALUES (app_tenant(), 'اجتماع أولياء الأمور', 'يوم الخميس القادم الساعة 10 صباحًا في قاعة المدرسة.', 'الإدارة')");
  return list;
});

console.log("✓ تم إنشاء المدرسة التجريبية\n");
console.log("  صفحة الطلاب:  /s/demo       رمز الصفحة: NOUR2626");
console.log(`  الإدارة:      /admin        المدرسة: demo  المستخدم: admin  كلمة المرور: ${ADMIN_PW}`);
console.log(`  المعلم:       /teacher      المدرسة: demo  المستخدم: mona   كلمة المرور: ${TEACHER_PW}\n`);
console.log("  معرّفات الطلاب:");
for (const s of keys) console.log(`   ${s.access_key}   ${s.name}`);
await closePool();
