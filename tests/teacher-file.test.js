// ملف المعلم: حالة حساب الدخول، سجل النشاط، تغيير اسم المستخدم، وعدم تسريب أي سر. بلا قاعدة بيانات.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accountStatus, describeAudit, changeUsername, account, fullProfile, ensureUniqueEmployeeNo } from "../src/modules/shared/teacher-file.service.js";

const T0 = "2026-09-01T08:00:00Z";
const base = { is_active: true, locked: false, must_change_password: true, last_login_at: null, password_changed_at: T0, created_at: T0, username_changed_at: null };

test("حساب جديد لم يدخل صاحبه: لم يتم تفعيله", () => {
  assert.equal(accountStatus(base), "not_activated");
});
test("دخل بالكلمة المؤقتة ولم يغيّرها: الأولية ما زالت مستخدمة", () => {
  assert.equal(accountStatus({ ...base, last_login_at: "2026-09-02T08:00:00Z" }), "initial");
});
test("غيّر كلمة المرور: تختفي حالة الأولية", () => {
  const u = { ...base, must_change_password: false, password_changed_at: "2026-09-02T09:00:00Z", last_login_at: "2026-09-02T09:00:00Z" };
  assert.equal(accountStatus(u), "password_changed");
});
test("غيّر اسم المستخدم فقط، ثم الاثنين", () => {
  assert.equal(accountStatus({ ...base, username_changed_at: T0, last_login_at: "2026-09-02T08:00:00Z" }), "username_changed");
  assert.equal(accountStatus({ ...base, must_change_password: false, password_changed_at: "2026-09-02T09:00:00Z", username_changed_at: T0 }), "credentials_changed");
});
test("الإيقاف والقفل لهما الأولوية", () => {
  assert.equal(accountStatus({ ...base, is_active: false, must_change_password: false }), "inactive");
  assert.equal(accountStatus({ ...base, locked: true }), "locked");
});
test("إعادة التعيين بعد تغيير كلمة المرور تعيد الحالة إلى مؤقتة", () => {
  const u = { ...base, must_change_password: true, password_changed_at: "2026-09-10T08:00:00Z", last_login_at: "2026-09-05T08:00:00Z" };
  assert.equal(accountStatus(u), "not_activated");
});

test("describeAudit: إسناد وتغيير اسم مستخدم وإعادة تعيين", () => {
  const names = { class: (i) => ({ 1: "الأول - أ" })[i], subject: (i) => ({ 5: "رياضيات" })[i] };
  assert.match(describeAudit({ table_name: "teacher_assignments", action: "insert", new_data: { class_id: 1, subject_id: 5 } }, names).text, /رياضيات — الأول - أ/);
  assert.match(describeAudit({ table_name: "teacher_assignments", action: "delete", old_data: { class_id: 1, subject_id: 5 } }, names).text, /إزالة إسناد/);
  assert.match(describeAudit({ table_name: "users", action: "update", old_data: { username: "a1" }, new_data: { username: "b2" } }).text, /من a1 إلى b2/);
  assert.match(describeAudit({ table_name: "users", action: "update", old_data: { username: "a", must_change_password: false }, new_data: { username: "a", must_change_password: true } }).text, /إعادة تعيين/);
  assert.match(describeAudit({ table_name: "users", action: "update", old_data: { username: "a", must_change_password: true }, new_data: { username: "a", must_change_password: false } }).text, /غيّر المعلم كلمة المرور/);
});
test("describeAudit: رقم الهوية يُذكر تغيّره دون عرض قيمته", () => {
  const r = describeAudit({ table_name: "teachers", action: "update", old_data: { national_id: "111", phone: "1" }, new_data: { national_id: "222", phone: "1" } });
  assert.match(r.text, /رقم الهوية/);
  assert.equal(r.changes.length, 0);
});
test("describeAudit: تحديثات لا معنى لها تُتجاهل (آخر دخول)", () => {
  assert.equal(describeAudit({ table_name: "users", action: "update", old_data: { username: "a", last_login_at: 1 }, new_data: { username: "a", last_login_at: 2 } }), null);
});

function fakeDb(users = [{ id: 7, username: "t1" }]) {
  const writes = [];
  const q = async (sql, p) => {
    if (/^\s*(UPDATE|DELETE|INSERT)/i.test(sql)) { writes.push({ sql: sql.replace(/\s+/g, " "), p }); return []; }
    if (sql.includes("FROM users WHERE teacher_id") && sql.includes("username, is_active")) {
      return [{ id: 7, username: "t1", is_active: true, must_change_password: true, last_login_at: null, password_changed_at: T0, created_at: T0,
        username_changed_at: null, locked: false, locked_until: null, failed_logins: 0 }];
    }
    if (sql.includes("SELECT id, username FROM users WHERE teacher_id")) return users;
    if (sql.includes("username = $1 AND id <> $2")) return q.taken ? [{ 1: 1 }] : [];
    if (sql.includes("FROM teachers t WHERE t.id")) return [{ id: 1, name: "محمد", has_photo: false }];
    if (sql.includes("FROM classes") && !sql.includes("JOIN")) return [{ id: 1, name: "الأول - أ" }];
    if (sql.includes("FROM subjects") && !sql.includes("JOIN")) return [{ id: 5, name: "رياضيات" }];
    if (sql.includes("FROM teacher_assignments a JOIN")) return [{ class_id: 1, subject_id: 5, class_name: "الأول - أ", subject_name: "رياضيات" }];
    if (sql.includes("FROM audit_log")) return [{ id: 1, actor: "admin:x", action: "insert", table_name: "teacher_assignments", old_data: null, new_data: { class_id: 1, subject_id: 5 }, created_at: T0 }];
    if (sql.includes("employee_no = $1")) return q.dupEmp ? [{ full_name: "سعد" }] : [];
    return [];
  };
  return { q, writes };
}

test("changeUsername: يسجل الوقت ويُنهي الجلسات ويمنع التكرار", async () => {
  const { q, writes } = fakeDb();
  const r = await changeUsername(q, 1, "newname");
  assert.deepEqual(r, { changed: true, from: "t1" });
  assert.ok(writes.some((w) => w.sql.includes("username_changed_at = now()")));
  assert.ok(writes.some((w) => w.sql.startsWith("DELETE FROM sessions")));
  const taken = fakeDb(); taken.q.taken = true;
  await assert.rejects(changeUsername(taken.q, 1, "other"), /مستخدم داخل المدرسة/);
  assert.equal((await changeUsername(fakeDb().q, 1, "t1")).changed, false);
});

test("account/fullProfile لا تعيد أي سر (لا hash ولا كلمة مرور)", async () => {
  const { q } = fakeDb();
  const acc = await account(q, 1);
  assert.equal(acc.state, "not_activated");
  assert.equal(acc.initial_password_active, true);
  const full = await fullProfile(q, 1);
  const dump = JSON.stringify(full);
  assert.ok(!/password_hash|scrypt\$|"password"/.test(dump));
  assert.equal(full.summary.subjects, 1);
  assert.match(full.activity[0].text, /إسناد مادة: رياضيات — الأول - أ/);
});

test("الرقم الوظيفي المكرر يُرفض", async () => {
  const d = fakeDb(); d.q.dupEmp = true;
  await assert.rejects(ensureUniqueEmployeeNo(d.q, "100"), /مستخدم للمعلم سعد/);
  await ensureUniqueEmployeeNo(fakeDb().q, "100");
  await ensureUniqueEmployeeNo(d.q, null);
});
