import test from "node:test";
import assert from "node:assert/strict";

test("keeps actionable known 5xx errors and masks unknown server failures", async () => {
  const oldDocument = globalThis.document;
  const oldFetch = globalThis.fetch;
  globalThis.document = { querySelector: () => null };
  const { api } = await import(`../public/shared/js/api.js?test=${Date.now()}`);
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "تعذر إرسال البريد الآن. حاول بعد قليل.", code: "mail_failed" }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
    await assert.rejects(api("/api/account/login", { email: "test@example.invalid", password: "dummy" }),
      (error) => error.status === 503 && error.code === "mail_failed" && /إرسال البريد/.test(error.message));

    globalThis.fetch = async () => new Response(JSON.stringify({ error: "internal", code: "server", ref: "test-ref-123" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
    await assert.rejects(api("/api/account/login", { email: "test@example.invalid", password: "dummy" }), (error) =>
      error.status === 500 && error.code === "server" && error.ref === "test-ref-123"
      && /وضع الصيانة/.test(error.message) && !/internal/.test(error.message));
  } finally {
    globalThis.document = oldDocument;
    globalThis.fetch = oldFetch;
  }
});
