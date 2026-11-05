// The Worker forwards first and signs what it posts the same way the platform checks it (HMAC-SHA256 of the body).
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import worker, { textOf } from "./index.js";

const RAW = [
  "From: Sara Ahmed <sara@example.org>", "To: support@midarschool.com", "Subject: =?UTF-8?B?2YXYtNmD2YTYqSDZgdmKINin2YTYr9iu2YjZhA==?=",
  "Message-ID: <abc123@example.org>", "Content-Type: text/plain; charset=utf-8", "", "لا أستطيع الدخول إلى حساب المدرسة.", "",
].join("\r\n");

test("يحوّل الرسالة إلى البريد أولًا، ثم يرسلها للمنصة بتوقيع صحيح", async () => {
  const calls = [];
  let posted;
  globalThis.fetch = async (url, init) => { posted = { url, init }; return new Response(JSON.stringify({ id: 1 }), { status: 200 }); };
  const message = {
    to: "support@midarschool.com", from: "sara@example.org", headers: new Headers(),
    raw: new Response(RAW).body, forward: async (to) => calls.push(["forward", to]),
  };
  const waits = [];
  await worker.email(message, { FORWARD_TO: "owner@gmail.test", PLATFORM_URL: "https://midar.test/", INBOUND_EMAIL_SECRET: "s".repeat(40) },
    { waitUntil: (p) => waits.push(p) });
  assert.deepEqual(calls, [["forward", "owner@gmail.test"]]);
  await Promise.all(waits);
  assert.equal(posted.url, "https://midar.test/api/inbound/email");
  const body = JSON.parse(posted.init.body);
  assert.equal(body.subject, "مشكلة في الدخول");
  assert.match(body.text, /لا أستطيع الدخول/);
  assert.equal(body.from, "sara@example.org");
  assert.equal(body.from_name, "Sara Ahmed");
  assert.equal(body.message_id, "<abc123@example.org>");
  const want = crypto.createHmac("sha256", "s".repeat(40)).update(posted.init.body).digest("hex");
  assert.equal(posted.init.headers["x-midar-signature"], `sha256=${want}`);
});

test("دون إعداد المنصة يكتفي بالتحويل إلى البريد", async () => {
  const calls = [];
  globalThis.fetch = async () => { throw new Error("should not post"); };
  await worker.email({ to: "info@x", from: "a@b.c", headers: new Headers(), raw: new Response(RAW).body, forward: async (t) => calls.push(t) },
    { FORWARD_TO: "owner@gmail.test" }, { waitUntil: () => assert.fail("no post") });
  assert.deepEqual(calls, ["owner@gmail.test"]);
});

test("نص HTML يُقرأ بلا وسوم", () => {
  assert.equal(textOf({ html: "<p>مرحبا</p><p>شكرًا&nbsp;لكم</p>" }), "مرحبا\n\nشكرًا لكم");
});
