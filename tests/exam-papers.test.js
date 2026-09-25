// اختبارات مصمم الاختبارات الورقية: الصلاحيات، العزل، القفل بعد الاعتماد، بنك الأسئلة، النماذج، ونموذج الإجابة
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";
import { transaction } from "../src/core/db/pool.js";
import { buildVersion, answerKey, totals, checkPaper, newQuestion, stripAnswers } from "../public/shared/js/exam/engine.js";

let srv, owner, A, B;
const s = {};
const P = "/api/teacher/papers";
const AP = "/api/admin/papers";

async function makeSchool(name) {
  const id = `x-${uid()}`;
  const r = await owner.post("/api/owner/tenants", { id, name, max_students: 50 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const admin = client(srv.base);
  assert.equal((await admin.post("/api/staff/login", { school: id, username: "admin", password: r.data.credentials.password })).status, 200);
  return { id, admin };
}
async function teacher(school, username, load) {
  const r = await school.admin.post("/api/admin/teachers", { name: `معلم ${username}`, username, load });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const c = client(srv.base);
  assert.equal((await c.post("/api/staff/login", { school: school.id, username, password: r.data.credentials.password })).status, 200);
  return c;
}

// سؤال اختيار من متعدد مكتمل
const mcq = (text, marks = 1, correctIndex = 0) => {
  const q = newQuestion("mcq", marks);
  q.text = text;
  q.options.forEach((o, i) => { o.text = `خيار ${i + 1}`; });
  q.correct = [q.options[correctIndex].id];
  return q;
};
const section = (id, title, questions) => ({ id, title, instructions: "", questions });

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  const code = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code })).status, 200);
  A = await makeSchool("مدرسة الاختبارات أ");
  B = await makeSchool("مدرسة الاختبارات ب");
  s.c1 = (await A.admin.post("/api/admin/structure/classes", { name: "الثالث - أ" })).data.id;
  s.c2 = (await A.admin.post("/api/admin/structure/classes", { name: "الرابع - أ" })).data.id;
  s.math = (await A.admin.post("/api/admin/structure/subjects", { name: "الرياضيات" })).data.id;
  s.sci = (await A.admin.post("/api/admin/structure/subjects", { name: "العلوم" })).data.id;
  s.t1 = await teacher(A, `m${uid()}`, [{ class_id: s.c1, subject_id: s.math }]);
  s.t2 = await teacher(A, `n${uid()}`, [{ class_id: s.c2, subject_id: s.math }, { class_id: s.c2, subject_id: s.sci }]);
  await A.admin.post("/api/admin/students", { name: "أحمد علي", class_id: s.c1 });
  await A.admin.post("/api/admin/students", { name: "بدر سالم", class_id: s.c1 });
});

after(async () => { await srv.close(); await endPool(); });

test("المحرك: المجموع، النماذج الثابتة بالبذرة، ونموذج الإجابة يتبع ترتيب كل نموذج", () => {
  const qs = Array.from({ length: 8 }, (_, i) => mcq(`س${i + 1}`, i < 4 ? 1 : 2, i % 4));
  const paper = { seed: 12345, shuffle_questions: true, shuffle_options: true, content: { sections: [section("s_a1b2", "أ", qs)] } };
  assert.equal(totals(paper.content).total, 12);
  const a = buildVersion(paper, 0);
  assert.deepEqual(a.sections[0].questions.map((q) => q.text), qs.map((q) => q.text), "النموذج A يحافظ على ترتيب المعلم");
  const b1 = buildVersion(paper, 1), b2 = buildVersion(paper, 1);
  assert.deepEqual(b1.sections[0].questions.map((q) => q.id), b2.sections[0].questions.map((q) => q.id), "النموذج B ثابت في كل طباعة");
  assert.notDeepEqual(b1.sections[0].questions.map((q) => q.id), qs.map((q) => q.id), "النموذج B مختلف الترتيب");
  // الإجابة الصحيحة في B تشير لنفس نص الخيار الصحيح رغم خلط الخيارات
  const keyB = answerKey(paper, 1);
  for (const [i, q] of b1.sections[0].questions.entries()) {
    const orig = qs.find((x) => x.id === q.id);
    const rightText = orig.options.find((o) => o.id === orig.correct[0]).text;
    assert.ok(keyB.sections[0].rows[i].answer.endsWith(rightText), `السؤال ${i + 1} في النموذج B`);
  }
  // التوصيل: العمود الثاني لا يُطبع بترتيب الحل
  const m = newQuestion("match"); m.pairs.forEach((p, i) => { p.left = `ل${i}`; p.right = `ر${i}`; });
  const v = buildVersion({ seed: 9, content: { sections: [section("s_m", "", [m])] } }, 0);
  assert.notDeepEqual(v.sections[0].questions[0].rightOrder, m.pairs.map((p) => p.id));
  assert.ok(!JSON.stringify(stripAnswers({ sections: [section("s_x", "", [mcq("x")])] })).includes("correct"));
  const chk = checkPaper({ total_marks: 20, content: paper.content });
  assert.ok(chk.issues.some((i) => i.text.includes("لا تساوي")), "تنبيه عند اختلاف الدرجة النهائية عن المجموع");
});

test("المعلم ينشئ اختبارًا لمادته فقط، والحفظ التلقائي يحسب المجموع ويرفض النسخة القديمة", async () => {
  const bad = await s.t1.post(P, { title: "اختبار علوم", subject_id: s.sci, class_id: s.c1 });
  assert.equal(bad.status, 403, "مادة غير مسندة");
  const ctx = await s.t1.get(`${P}/context`);
  assert.equal(ctx.status, 200);
  assert.equal(ctx.data.load.length, 1, "بيانات المعلم تُعبأ من إسناده");
  assert.ok(ctx.data.types.defaults.includes("اختبار نهائي"));

  const r = await s.t1.post(P, { title: "اختبار الفصل الأول", subject_id: s.math, class_id: s.c1, exam_type: "اختبار نهاية الفصل", total_marks: 5 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  s.paper = r.data.id;
  const got = await s.t1.get(`${P}/${s.paper}`);
  assert.equal(got.data.status, "draft");
  assert.ok(got.data.term_id, "الفصل الدراسي الحالي يُربط تلقائيًا");

  const content = { sections: [section("s_one1", "القسم الأول", [mcq("كم 2+2؟", 1, 1), mcq("كم 3+3؟", 2, 2)]), section("s_two2", "القسم الثاني", [mcq("كم 5+5؟", 2)])] };
  const save = await s.t1.put(`${P}/${s.paper}`, { version: got.data.version, content });
  assert.equal(save.status, 200, JSON.stringify(save.data));
  assert.equal(save.data.computed_marks, 5);
  assert.equal(save.data.question_count, 3);
  assert.equal(save.data.check.blocking, false);
  const stale = await s.t1.put(`${P}/${s.paper}`, { version: got.data.version, meta: { title: "قديم" } });
  assert.equal(stale.status, 409, "نسخة قديمة من نافذة أخرى تُرفض");
  s.version = save.data.version;

  const mismatch = await s.t1.put(`${P}/${s.paper}`, { version: s.version, meta: { total_marks: 10 } });
  assert.ok(mismatch.data.check.issues.some((i) => i.text.includes("لا تساوي")));
  const fix = await s.t1.put(`${P}/${s.paper}`, { version: mismatch.data.version, meta: { total_marks: 5 } });
  s.version = fix.data.version;
});

test("العزل: معلم آخر ومدرسة أخرى لا يصلان للاختبار ولا لنموذج إجابته", async () => {
  assert.equal((await s.t2.get(`${P}/${s.paper}`)).status, 404);
  assert.equal((await s.t2.get(`${P}/${s.paper}/answer-key`)).status, 404);
  assert.equal((await s.t2.put(`${P}/${s.paper}`, { version: s.version, meta: { title: "تخريب" } })).status, 404);
  assert.equal((await B.admin.get(`${AP}/${s.paper}`)).status, 404);
  assert.equal((await B.admin.get(`${AP}/${s.paper}/answer-key`)).status, 404);
  const list = await s.t2.get(P);
  assert.ok(!list.data.some((p) => p.id === s.paper), "لا يظهر في قائمة معلم آخر");
  // لا يوجد أي مسار عام لأوراق الاختبارات
  assert.equal((await fetch(`${srv.base}/api/public/${A.id}/papers/${s.paper}`)).status, 404);
});

test("الاعتماد يقفل الاختبار (في الخادم وفي قاعدة البيانات)، وإعادة الفتح تفكّه", async () => {
  const pre = await s.t1.post(`${P}/${s.paper}/status`, { action: "printed" });
  assert.equal(pre.status, 403, "لا طباعة رسمية قبل الاعتماد");
  const ap = await s.t1.post(`${P}/${s.paper}/status`, { action: "approve" });
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  const cur = await s.t1.get(`${P}/${s.paper}`);
  assert.equal(cur.data.perms.edit, false);
  assert.equal(cur.data.perms.print, true);
  const edit = await s.t1.put(`${P}/${s.paper}`, { version: cur.data.version, meta: { title: "تعديل بعد الاعتماد" } });
  assert.equal(edit.status, 403);
  // حتى لو تجاوز أحد الكود: القاعدة ترفض تغيير محتوى اختبار معتمد
  await assert.rejects(transaction({ tenantId: A.id }, (q) => q("UPDATE exam_papers SET title = 'x' WHERE id = $1", [s.paper])), /مقفل/);
  assert.equal((await s.t1.del(`${P}/${s.paper}`)).status, 403, "المعتمد لا يُحذف");

  assert.equal((await s.t1.post(`${P}/${s.paper}/status`, { action: "printed" })).data.status, "printed");
  assert.equal((await s.t1.post(`${P}/${s.paper}/status`, { action: "reopen" })).data.status, "draft");
  assert.equal((await s.t1.post(`${P}/${s.paper}/status`, { action: "archive" })).data.status, "archived");
  assert.equal((await s.t1.post(`${P}/${s.paper}/status`, { action: "unarchive" })).data.status, "draft");
});

test("سياسة المدرسة: اعتماد الإدارة، وصلاحية نموذج الإجابة منفصلة", async () => {
  await A.admin.put("/api/admin/papers-settings", { require_approval: true, teacher_answer_keys: false });
  const blocked = await s.t1.post(`${P}/${s.paper}/status`, { action: "approve" });
  assert.equal(blocked.status, 403, "المعلم لا يعتمد عند اشتراط اعتماد الإدارة");
  assert.equal((await s.t1.post(`${P}/${s.paper}/status`, { action: "ready" })).data.status, "ready");
  const pending = await A.admin.get(`${AP}?status=ready`);
  assert.ok(pending.data.some((p) => p.id === s.paper), "يظهر للإدارة بانتظار الاعتماد");
  assert.equal((await A.admin.post(`${AP}/${s.paper}/status`, { action: "approve" })).data.status, "approved");
  assert.equal((await s.t1.post(`${P}/${s.paper}/status`, { action: "reopen" })).status, 403, "إعادة الفتح للإدارة");

  assert.equal((await s.t1.get(`${P}/${s.paper}/answer-key`)).status, 403, "المعلم لا يرى نموذج الإجابة عند إيقافه");
  const key = await A.admin.get(`${AP}/${s.paper}/answer-key`);
  assert.equal(key.status, 200);
  assert.equal(key.data.sections[0].rows[0].answer, "(ب) خيار 2");
  const keyB = await A.admin.get(`${AP}/${s.paper}/answer-key?v=3`);
  assert.equal(keyB.data.code, "A", "لا يوجد نموذج D في اختبار بنموذج واحد");

  assert.equal((await A.admin.post(`${AP}/${s.paper}/status`, { action: "reopen" })).data.status, "draft");
  await A.admin.put("/api/admin/papers-settings", { require_approval: false, teacher_answer_keys: true });
  assert.equal((await s.t1.get(`${P}/${s.paper}/answer-key`)).status, 200);
});

test("لا يُعتمد اختبار ناقص، والمسودة تُحذف", async () => {
  const r = await s.t1.post(P, { title: "مسودة فارغة", subject_id: s.math, class_id: s.c1 });
  const ap = await s.t1.post(`${P}/${r.data.id}/status`, { action: "approve" });
  assert.equal(ap.status, 400);
  assert.match(ap.data.error, /بلا أسئلة/);
  assert.equal((await s.t1.del(`${P}/${r.data.id}`)).status, 200);
});

test("بنك الأسئلة: الملكية، المشاركة، السحب حسب النوع والصعوبة، والإنشاء منه", async () => {
  const add = (c, body) => c.post(`${P}/bank`, { subject_id: s.math, unit: "الجمع", lesson: "الدرس 1", marks: 1, ...body });
  for (const d of ["easy", "medium", "hard", "easy"]) {
    const q = mcq(`سؤال ${d}`); delete q.id;
    assert.equal((await add(s.t1, { ...q, difficulty: d })).status, 201);
  }
  const tf = await add(s.t1, { type: "truefalse", text: "الأرض كروية", correct: true, is_shared: true });
  assert.equal(tf.status, 201, JSON.stringify(tf.data));
  assert.equal((await add(s.t1, { type: "truefalse", text: "علوم", correct: true, subject_id: s.sci })).status, 403, "مادة غير مسندة");

  const seen = await s.t2.get(`${P}/bank`);
  assert.deepEqual(seen.data.map((q) => q.text), ["الأرض كروية"], "المعلم الآخر يرى المشترك فقط");
  assert.equal((await s.t2.put(`${P}/bank/${tf.data.id}`, { text: "تعديل" })).status, 403, "لا يعدّل سؤال غيره");

  const pick = await s.t1.post(`${P}/bank/pick`, { subject_id: s.math, spec: [{ type: "mcq", count: 3 }, { type: "fill", count: 2 }], difficulty: "mixed" });
  assert.equal(pick.status, 200, JSON.stringify(pick.data));
  assert.equal(pick.data.questions.length, 3);
  assert.deepEqual(new Set(pick.data.questions.map((q) => q.difficulty)), new Set(["easy", "medium", "hard"]), "المختلط يوزع على المستويات");
  assert.deepEqual(pick.data.shortages, [{ type: "fill", wanted: 2, found: 0 }]);

  const fb = await s.t1.post(`${P}/from-bank`, { subject_id: s.math, class_id: s.c1, total_marks: 10,
    spec: [{ type: "mcq", count: 3 }, { type: "truefalse", count: 1 }, { type: "essay", count: 1 }] });
  assert.equal(fb.status, 201, JSON.stringify(fb.data));
  assert.equal(fb.data.from_bank, 4);
  assert.equal(fb.data.filled, 1, "النقص يُكمل بسؤال فارغ");
  const made = await s.t1.get(`${P}/${fb.data.id}`);
  assert.equal(made.data.content.sections.length, 3);
  assert.equal(made.data.computed_marks, 10, "الدرجات موزعة على المجموع المطلوب");
  assert.match(made.data.content.sections[0].title, /السؤال الأول/);
  s.fromBank = fb.data.id;

  const quick = await s.t1.post(`${P}/quick`, { subject_id: s.math, class_id: s.c1, total_marks: 20, count: 10 });
  assert.equal(quick.status, 201, JSON.stringify(quick.data));
  const qp = await s.t1.get(`${P}/${quick.data.id}`);
  assert.equal(qp.data.question_count, 10);
  assert.equal(qp.data.computed_marks, 20);

  // مسار الإدارة: ترى كل أسئلة المدرسة وإحصاءاتها وتسحب منها
  const ab = await A.admin.get(`${AP}/bank`);
  assert.equal(ab.status, 200, JSON.stringify(ab.data));
  assert.equal(ab.data.length, 5);
  assert.equal((await A.admin.get(`${AP}/bank/${tf.data.id}`)).status, 200);
  assert.equal((await A.admin.get(`${AP}/bank/units?subject_id=${s.math}`)).status, 200);
  const as = await A.admin.get(`${AP}/stats`);
  assert.equal(as.status, 200, JSON.stringify(as.data));
  assert.equal(as.data.bank.total, 5);
  assert.equal((await A.admin.post(`${AP}/bank/pick`, { subject_id: s.math, spec: [{ type: "mcq", count: 2 }] })).data.questions.length, 2);
  assert.equal((await A.admin.get(`${AP}/context`)).status, 200);
  assert.equal((await B.admin.get(`${AP}/bank`)).data.length, 0, "مدرسة أخرى لا ترى البنك");

  const stats = await s.t1.get(`${P}/stats`);
  assert.equal(stats.data.bank.total, 5);
  assert.ok(stats.data.papers.total >= 3);
});

test("النسخ والقوالب والتصدير والاستيراد", async () => {
  const cp = await s.t1.post(`${P}/${s.paper}/copy`, { title: "نسخة العام القادم", total_marks: 10 });
  assert.equal(cp.status, 201, JSON.stringify(cp.data));
  const c = await s.t1.get(`${P}/${cp.data.id}`);
  assert.equal(c.data.status, "draft");
  assert.equal(c.data.computed_marks, 10, "الدرجات أعيد توزيعها");
  const orig = await s.t1.get(`${P}/${s.paper}`);
  assert.notEqual(c.data.content.sections[0].questions[0].id, orig.data.content.sections[0].questions[0].id, "معرّفات جديدة للنسخة");

  const tpl = await s.t1.post(`${P}/${s.paper}/template`, { name: "رياضيات ثالث — الفصل الأول" });
  assert.equal(tpl.status, 201);
  const tlist = await s.t1.get(`${P}?templates=1`);
  assert.deepEqual(tlist.data.map((p) => p.template_name), ["رياضيات ثالث — الفصل الأول"]);
  assert.ok(!(await s.t1.get(P)).data.some((p) => p.id === tpl.data.id), "القالب لا يظهر مع الاختبارات");
  assert.equal((await s.t1.post(`${P}/${tpl.data.id}/status`, { action: "approve" })).status, 400, "القالب لا يُعتمد");
  const use = await s.t1.post(`${P}/${tpl.data.id}/copy`, { title: "من القالب" });
  assert.equal(use.status, 201);

  const exp = await s.t1.get(`${P}/${s.paper}/export`);
  assert.equal(exp.data.midar_exam, 1);
  const imp = await s.t2.post(`${P}/import`, { subject_id: s.math, class_id: s.c2, data: exp.data });
  assert.equal(imp.status, 201, JSON.stringify(imp.data));
  const bad = await s.t2.post(`${P}/import`, { subject_id: s.math, data: { title: "x" } });
  assert.equal(bad.status, 400);
});

test("الصور: المحتوى المزيف يُرفض، وصورة مدرسة أخرى لا تُستخدم", async () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64");
  assert.equal((await s.t1.post(`${P}/images`, { mime: "image/png", data: Buffer.from("not an image at all!!").toString("base64") })).status, 400);
  const img = await s.t1.post(`${P}/images`, { mime: "image/png", data: png });
  assert.equal(img.status, 201, JSON.stringify(img.data));
  const other = await B.admin.post(`${AP}/images`, { mime: "image/png", data: png });
  assert.equal(other.status, 201);
  const res = await fetch(`${srv.base}${P}/images/${img.data.id}`, { headers: { Cookie: [...s.t1.jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
  assert.equal(res.headers.get("content-type"), "image/png");

  const p = await s.t1.get(`${P}/${s.fromBank}`);
  const content = structuredClone(p.data.content);
  content.sections[0].questions[0].image = { id: img.data.id, width: 50, align: "center", position: "after" };
  content.sections[0].questions[1].image = { id: other.data.id, width: 50, align: "center", position: "after" };
  const save = await s.t1.put(`${P}/${s.fromBank}`, { version: p.data.version, content });
  assert.equal(save.status, 200, JSON.stringify(save.data));
  const after = await s.t1.get(`${P}/${s.fromBank}`);
  assert.equal(after.data.content.sections[0].questions[0].image.id, img.data.id);
  assert.equal(after.data.content.sections[0].questions[1].image, null, "صورة المدرسة الأخرى أُزيلت");
});

test("كشف الشعبة للطباعة بالأسماء لا يكشف معرّفات الطلاب", async () => {
  const r = await s.t1.get(`${P}/${s.paper}/roster`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.map((x) => x.name), ["أحمد علي", "بدر سالم"]);
  assert.ok(!JSON.stringify(r.data).match(/[A-Z2-9]{4}-[A-Z2-9]{4}/), "لا معرّف سري");
});

test("إيقاف القسم يرفضه الخادم، والبيانات تعود عند التشغيل", async () => {
  await A.admin.put("/api/admin/settings/modules", { exam_papers: false });
  assert.equal((await s.t1.get(P)).status, 404);
  assert.equal((await A.admin.get(AP)).status, 404);
  await A.admin.put("/api/admin/settings/modules", { exam_papers: true });
  assert.ok((await s.t1.get(P)).data.some((p) => p.id === s.paper));
});
