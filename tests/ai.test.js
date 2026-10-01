// المساعد الذكي: حلقة الأدوات بعميل بديل (بدون شبكة)، عزل المدارس، أخطاء المدخلات، السجل، والإيقاف وعدم الجاهزية
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, readySchool, endPool } from "./helpers.js";
import { transaction } from "../src/core/db/pool.js";
import { setAiClient, _tools } from "../src/modules/shared/ai.service.js";

let srv, A, B, requests;

// عميل بديل: الجولة الأولى يطلب أدوات، والثانية يجيب بنص يتضمن ما رجع من الأدوات
function fakeClient(plan) {
  requests = [];
  return { beta: { messages: { create: async (body) => {
    requests.push(structuredClone(body));
    return plan(body, requests.length);
  } } } };
}
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

before(async () => {
  srv = await startServer();
  A = await readySchool(srv.base, { prefix: "ai", students: 3 });
  B = await readySchool(srv.base, { prefix: "aj", students: 1 });
});
after(async () => { setAiClient(null); await srv.close(); await endPool(); });

test("بدون مفتاح: المساعد غير جاهز ويرفض السؤال برسالة واضحة", async () => {
  setAiClient(null);
  const st = (await A.admin.get("/api/admin/ai")).data;
  assert.equal(st.ready, false);
  assert.equal(st.source, null);
  assert.ok(st.reports.length >= 6, "التقارير المجانية متاحة بلا مفتاح");
  const r = await A.admin.post("/api/admin/ai/ask", { question: "كم عدد الطلاب؟" });
  assert.equal(r.status, 503);
  assert.match(r.data.error, /مفتاح/);
});

test("حلقة الأدوات: ينفذ الأدوات داخل المدرسة ويعيد النتائج ويسجل السؤال", async () => {
  let seen;
  setAiClient(fakeClient((body, n) => {
    if (n === 1) return { stop_reason: "tool_use", usage, content: [
      { type: "thinking", thinking: "", signature: "sig" },
      toolUse("t1", "school_overview", {}), toolUse("t2", "student_lookup", { name: A.students[0].name.split(" ")[0] }),
      toolUse("t3", "attendance_report", { from: "not-a-date" }), toolUse("t4", "drop_tables", {})] };
    seen = body.messages.at(-1).content;
    return { stop_reason: "end_turn", usage, content: [{ type: "text", text: "في المدرسة 3 طلاب." }] };
  }));
  assert.equal((await A.admin.get("/api/admin/ai")).data.ready, true);
  const r = await A.admin.post("/api/admin/ai/ask", { question: "كم عدد الطلاب؟" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.answer, "في المدرسة 3 طلاب.");
  assert.deepEqual(r.data.tools.sort(), ["attendance_report", "drop_tables", "school_overview", "student_lookup"]);

  // شكل الطلب: النموذج، التخزين المؤقت، التفكير، الأدوات، والسياق
  const first = requests[0];
  assert.equal(first.model, "claude-opus-5-5");
  assert.deepEqual(first.cache_control, { type: "ephemeral" });
  assert.deepEqual(first.thinking, { type: "adaptive" });
  assert.equal(first.tools.length, _tools.TOOLS.length);
  assert.match(first.messages[0].content[0].text, /تاريخ اليوم/);
  // الجولة الثانية تعيد محتوى المساعد كما هو (بما فيه كتلة التفكير) ثم كل النتائج في رسالة واحدة
  assert.equal(requests[1].messages[1].content[0].type, "thinking");
  assert.equal(seen.length, 4);
  const byId = Object.fromEntries(seen.map((x) => [x.tool_use_id, x]));
  const overview = JSON.parse(byId.t1.content);
  assert.equal(overview.students, 3, "بيانات مدرسة A فقط");
  const found = JSON.parse(byId.t2.content);
  assert.ok(Array.isArray(found) && found.length >= 1);
  assert.equal(found[0].id, undefined, "لا معرفات داخلية");
  assert.equal(JSON.stringify(found).includes(A.students[0].code || "@@"), false);
  assert.equal(byId.t3.is_error, true);
  assert.equal(byId.t4.is_error, true);

  // السجل
  const log = (await A.admin.get("/api/admin/ai")).data;
  assert.equal(log.ready, true);
  assert.equal(log.recent[0].question, "كم عدد الطلاب؟");
  assert.equal((await B.admin.get("/api/admin/ai")).data.recent.length, 0, "سجل مدرسة B منفصل");
});

test("مدرسة B لا ترى بيانات A عبر الأدوات", async () => {
  await A.admin.post("/api/admin/students", { name: "زياد فريد المنفرد", class_id: A.c1.id });
  let seen;
  setAiClient(fakeClient((body, n) => {
    if (n === 1) return { stop_reason: "tool_use", usage, content: [toolUse("x", "student_lookup", { name: "المنفرد" })] };
    seen = JSON.parse(body.messages.at(-1).content[0].content);
    return { stop_reason: "end_turn", usage, content: [{ type: "text", text: "لا يوجد." }] };
  }));
  assert.equal((await B.admin.post("/api/admin/ai/ask", { question: "ابحث عن طالب" })).status, 200);
  assert.deepEqual(seen, { found: 0 });
  setAiClient(fakeClient((body, n) => n === 1 ? { stop_reason: "tool_use", usage, content: [toolUse("x", "student_lookup", { name: "المنفرد" })] }
    : (seen = JSON.parse(body.messages.at(-1).content[0].content), { stop_reason: "end_turn", usage, content: [{ type: "text", text: "-" }] })));
  await A.admin.post("/api/admin/ai/ask", { question: "ابحث عن طالب" });
  assert.equal(seen[0].student, "زياد فريد المنفرد");
});

test("كل الأدوات تعمل على بيانات حقيقية دون أخطاء", async () => {
  const names = _tools.TOOLS.map((t) => t.name);
  let results;
  setAiClient(fakeClient((body, n) => {
    if (n === 1) return { stop_reason: "tool_use", usage, content: names.map((name, i) =>
      toolUse(`k${i}`, name, name === "student_lookup" ? { name: "طالب" } : {})) };
    results = body.messages.at(-1).content;
    return { stop_reason: "end_turn", usage, content: [{ type: "text", text: "تم" }] };
  }));
  assert.equal((await A.admin.post("/api/admin/ai/ask", { question: "تقرير شامل" })).status, 200);
  for (const r of results) assert.notEqual(r.is_error, true, r.content);
});

test("الرفض والتاريخ والتحقق والإيقاف والصلاحية", async () => {
  setAiClient(fakeClient(() => ({ stop_reason: "refusal", usage, content: [] })));
  const r = await A.admin.post("/api/admin/ai/ask", { question: "سؤال", history: [{ q: "قبل", a: "جواب" }] });
  assert.equal(r.status, 200);
  assert.match(r.data.answer, /لا أستطيع/);
  assert.equal(requests[0].messages[0].content, "قبل");
  assert.equal(requests[0].messages[1].role, "assistant");
  assert.equal((await A.admin.post("/api/admin/ai/ask", { question: "" })).status, 400);
  assert.equal((await A.teacher.post("/api/admin/ai/ask", { question: "كم؟" })).status >= 401, true);
  await A.admin.put("/api/admin/settings/modules", { ai_assistant: false });
  assert.equal((await A.admin.post("/api/admin/ai/ask", { question: "كم؟" })).status, 404);
  await A.admin.put("/api/admin/settings/modules", { ai_assistant: true });
});

test("التقارير الذكية المجانية: كلها تعمل بلا مفتاح ولا شبكة، وتحترم الأقسام والعزل", async () => {
  setAiClient(null);
  const { reports } = (await A.admin.get("/api/admin/ai")).data;
  for (const rep of reports) {
    const r = await A.admin.post(`/api/admin/ai/report/${rep.key}`, rep.params.includes("name") ? { name: "المنفرد" } : {});
    assert.equal(r.status, 200, `${rep.key}: ${JSON.stringify(r.data)}`);
    assert.ok(Array.isArray(r.data.lines) && r.data.lines.length, rep.key);
    assert.ok(Array.isArray(r.data.tables) && Array.isArray(r.data.tips), rep.key);
  }
  const ov = (await A.admin.post("/api/admin/ai/report/overview", {})).data;
  assert.match(ov.lines[0], /\*\*4\*\* طالبًا/, "أعداد مدرسة A فقط (3 + المنفرد)");
  const st = (await B.admin.post("/api/admin/ai/report/student", { name: "المنفرد" })).data;
  assert.match(st.lines[0], /لم أجد/, "B لا ترى طالب A");
  assert.equal((await A.admin.post("/api/admin/ai/report/nope", {})).status, 404);
  await A.admin.put("/api/admin/settings/modules", { behavior: false });
  assert.equal((await A.admin.get("/api/admin/ai")).data.reports.some((x) => x.key === "behavior"), false);
  assert.equal((await A.admin.post("/api/admin/ai/report/behavior", {})).status, 404);
  await A.admin.put("/api/admin/settings/modules", { behavior: true });
  assert.equal((await A.teacher.post("/api/admin/ai/report/overview", {})).status >= 401, true);
});

test("مفتاح المدرسة: يُتحقق منه، يُحفظ مشفّرًا، لا يُعاد ولا يُسجَّل، ويُستخدم للأسئلة", async () => {
  const KEY = "sk-ant-api03-SchoolTestKey_1234567890abcdWXYZ";
  let checked = 0;
  setAiClient({ models: { retrieve: async () => { checked++; return { id: "m" }; } },
    beta: { messages: { create: async () => ({ stop_reason: "end_turn", usage, content: [{ type: "text", text: "تم" }] }) } } });
  assert.equal((await A.admin.put("/api/admin/ai/key", { key: "abc" })).status, 400);
  const r = await A.admin.put("/api/admin/ai/key", { key: KEY });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(checked, 1);
  assert.equal(r.data.source, "school");
  assert.equal(r.data.key_hint, "WXYZ");
  const st = await A.admin.get("/api/admin/ai");
  assert.equal(JSON.stringify(st.data).includes(KEY), false, "المفتاح لا يعود للواجهة");
  const row = await transaction({ tenantId: A.id }, async (q) => (await q("SELECT key_sealed FROM school_ai"))[0]);
  assert.equal(row.key_sealed.includes("SchoolTestKey"), false, "محفوظ مشفّرًا");
  const leaked = await transaction({ platform: true }, async (q) => (await q("SELECT count(*)::int AS n FROM audit_log WHERE action ILIKE '%SchoolTestKey%' OR new_data::text ILIKE '%SchoolTestKey%'"))[0].n);
  assert.equal(leaked, 0, "لا أثر للمفتاح في السجل");
  const a = await A.admin.post("/api/admin/ai/ask", { question: "سؤال" });
  assert.equal(a.data.source, "school");
  assert.equal((await B.admin.get("/api/admin/ai")).data.source, "platform", "مفتاح A لا يخص B");
  assert.equal((await A.admin.del("/api/admin/ai/key")).data.source, "platform");
});
