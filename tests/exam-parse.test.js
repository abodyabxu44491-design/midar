// لصق الأسئلة: التعرف على الأنواع والخيارات والإجابات من نص ملصوق، وقبول الخادم للناتج كما هو
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuestions } from "../public/shared/js/exam/parse.js";
import { checkPaper } from "../public/shared/js/exam/engine.js";
import { contentSchema } from "../src/modules/shared/exam-papers.service.js";

const SAMPLE = `السؤال الأول: اختر الإجابة الصحيحة
1- عاصمة المملكة العربية السعودية هي:
أ) الرياض *
ب) جدة
ج) مكة
٢) أكبر كوكب في المجموعة الشمسية (2 درجة)
أ- المريخ
ب- المشتري
الإجابة: ب
3. الماء يتكون من؟ أ) هيدروجين وأكسجين ب) نيتروجين ج) كربون

السؤال الثاني: ضع كلمة صح أو خطأ
1- الشمس نجم (صح)
2- القمر كوكب (خطأ)
3- الأرض مسطحة (   )

السؤال الثالث: أكمل الفراغات
1- يتكون الماء من ........ و ........ (هيدروجين، أكسجين)

السؤال الرابع: صل العمود (أ) بما يناسبه من العمود (ب)
الماء = H2O
الملح = NaCl

السؤال الخامس: أجب عما يلي
1- عرّف التمثيل الضوئي
الإجابة: عملية يصنع فيها النبات غذاءه`;

test("لصق الأسئلة: الأقسام والأنواع والإجابات الصحيحة والدرجات", () => {
  const r = parseQuestions(SAMPLE, { marks: 1 });
  assert.equal(r.count, 9);
  assert.deepEqual(r.sections.map((s) => s.title.split(":")[0]), ["السؤال الأول", "السؤال الثاني", "السؤال الثالث", "السؤال الرابع", "السؤال الخامس"]);
  const [mcq, tf, fill, match, short] = r.sections.map((s) => s.questions);

  assert.deepEqual(mcq.map((q) => q.type), ["mcq", "mcq", "mcq"]);
  const correctText = (q) => q.options.filter((o) => q.correct.includes(o.id)).map((o) => o.text);
  assert.deepEqual(correctText(mcq[0]), ["الرياض"], "النجمة تحدد الإجابة ولا تبقى في النص");
  assert.deepEqual(correctText(mcq[1]), ["المشتري"], "سطر «الإجابة: ب»");
  assert.equal(mcq[1].marks, 2, "(2 درجة) في آخر السؤال");
  assert.equal(mcq[1].text, "أكبر كوكب في المجموعة الشمسية");
  assert.deepEqual(mcq[2].options.map((o) => o.text), ["هيدروجين وأكسجين", "نيتروجين", "كربون"], "خيارات في سطر واحد");

  assert.deepEqual(tf.map((q) => [q.type, q.text, q.correct]), [
    ["truefalse", "الشمس نجم", true], ["truefalse", "القمر كوكب", false], ["truefalse", "الأرض مسطحة", null]]);

  assert.equal(fill[0].type, "fill");
  assert.equal(fill[0].text, "يتكون الماء من ________ و ________");
  assert.deepEqual(fill[0].answers, ["هيدروجين", "أكسجين"]);

  assert.equal(match.length, 1);
  assert.deepEqual(match[0].pairs.map((p) => [p.left, p.right]), [["الماء", "H2O"], ["الملح", "NaCl"]]);

  assert.equal(short[0].type, "short");
  assert.equal(short[0].answer, "عملية يصنع فيها النبات غذاءه");
});

test("لصق الأسئلة: نص بلا ترقيم (سطر لكل سؤال) وعنوان «اختر الإجابة الصحيحة» لا يُفهم صح/خطأ", () => {
  const r = parseQuestions("ما عاصمة فرنسا؟\nالشمس تشرق من الغرب (خطأ)\nالرقم 7 عدد ____ (أولي)");
  assert.deepEqual(r.sections[0].questions.map((q) => q.type), ["short", "truefalse", "fill"]);
  const r2 = parseQuestions("السؤال الأول: اختر الإجابة الصحيحة\n1- ما لون السماء؟");
  assert.equal(r2.sections[0].questions[0].type, "short");
  assert.equal(parseQuestions("").count, 0);
});

test("لصق الأسئلة: الناتج يقبله مخطط الخادم، ولا تنبيهات حرجة للأسئلة المكتملة", () => {
  const r = parseQuestions(SAMPLE);
  const content = { sections: r.sections.map((s, i) => ({ id: `s_paste${i}`, title: s.title, instructions: "", questions: s.questions })) };
  const parsed = contentSchema.parse(content);
  assert.equal(parsed.sections.flatMap((s) => s.questions).length, 9);
  const issues = checkPaper({ content, total_marks: null }).issues;
  assert.ok(!issues.some((i) => i.level === "error"), JSON.stringify(issues));
  assert.deepEqual(issues.map((i) => i.text), ["السؤال 3: حدد الإجابة الصحيحة", "السؤال 6: حدد صح أو خطأ"], "تنبيه للأسئلة التي لم تُكتب إجابتها فقط");
});
