/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Input checks keep their meaning: an update touches only the fields sent, a default runs through its field's rules,
// and a missing field says which one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z, t, parse, patch, optional } from "../src/core/http/validate.js";
import { settingsSchema as instituteSettings } from "../src/modules/shared/institute.service.js";

const schema = z.object({
  name: t.name(),
  color: z.enum(["red", "blue"]).prefault("red"),
  notify: z.enum(["true", "false"]).transform((v) => v === "true").prefault("false"),
  tags: z.array(z.string()).max(3).prefault([]),
});

test("التعديل لا يملأ الحقول غير المرسلة بقيمها الافتراضية", () => {
  assert.deepEqual(parse(patch(schema), {}), {});
  assert.deepEqual(parse(patch(schema), { color: "blue" }), { color: "blue" });
  assert.deepEqual(parse(patch(schema, { name: true }), { name: "سالم" }), { name: "سالم", color: "red", notify: false, tags: [] });
  assert.deepEqual(parse(z.object({ tags: optional(schema.shape.tags) }), {}), {});
});

test("القيمة الافتراضية تمر بقواعد الحقل", () => {
  assert.deepEqual(parse(schema, { name: "سالم" }), { name: "سالم", color: "red", notify: false, tags: [] });
});

test("الحقل الناقص يُسمّى، والرسالة العربية المخصصة تبقى", () => {
  assert.throws(() => parse(z.object({ amount: z.number() }), {}), /حقل مطلوب: المبلغ/);
  assert.throws(() => parse(z.object({ status: z.enum(["a", "b"]) }), {}), /حقل مطلوب: الحالة/);
  assert.throws(() => parse(z.object({ title: t.shortText("العنوان") }), {}), /العنوان مطلوب/);
  assert.throws(() => parse(z.object({ amount: z.number() }), { amount: "x" }), /قيمة غير صحيحة في: المبلغ/);
});

test("مصطلحات المعهد: يكفي إرسال بعضها", () => {
  assert.deepEqual(parse(instituteSettings, { terms: { course: "مقرر" } }).terms, { course: "مقرر" });
});
