// Checks, from Node, what Midar's modules produce inside the Workers runtime (src/probe.js under wrangler dev).
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import webpush from "web-push";
import ece from "http_ece";
import { hashPassword } from "../../../src/core/auth/password.js";
import { createBox } from "../../../src/core/auth/secret-box.js";
import { buildXlsx } from "../../../src/core/xlsx.js";

const BASE = process.env.PROBE_URL || "http://127.0.0.1:8791";
const post = async (path, body) => (await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();

test("كلمات المرور: بصمة من Node تُقبل في Workers، والعكس، والكلمة الخاطئة تُرفض", async () => {
  const password = "كلمة-سر-تجريبية-٢٠٢٦";
  const r = await post("/password", { password, hash: await hashPassword(password) });
  assert.equal(r.ok, true);
  assert.equal(r.wrong, false);
  const { verifyPassword } = await import("../../../src/core/auth/password.js");
  assert.equal(await verifyPassword(password, r.made), true, "بصمة Workers تُقبل في Node");
  console.log(`  scrypt on Workers: ${r.hash_ms} ms`);
});

test("الأسرار المشفّرة: ما شُفّر في Node يُفتح في Workers، والعكس", async () => {
  const key = crypto.randomBytes(32).toString("hex");
  const box = createBox(key);
  const r = await post("/secret", { key, aad: "sms-gateway", sealed: box.seal("Bearer LAB-SECRET", "sms-gateway"), plain: "smtp-password" });
  assert.equal(r.opened, "Bearer LAB-SECRET");
  assert.equal(box.open(r.sealed, "sms-gateway"), "smtp-password");
});

test("حماية بوابة الرسائل (SSRF): العناوين المحلية والخاصة مرفوضة، والعامة مسموحة", async (t) => {
  const r = await post("/safe-url", { urls: ["https://example.com/send", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://[::1]/x", "http://example.com/x", "https://localhost/x", "https://169.254.169.254/latest"] });
  for (const [u, v] of Object.entries(r)) console.log(`  ${u} → ${v}`);
  for (const bad of ["https://127.0.0.1/x", "https://10.0.0.5/x", "https://[::1]/x", "http://example.com/x", "https://localhost/x", "https://169.254.169.254/latest"]) {
    assert.match(r[bad], /^refused/, bad);
  }
  // A public address needs DNS from inside the runtime (DNS-over-HTTPS to 1.1.1.1 on Workers). Where the network blocks
  // it (this sandbox), that half is checked on staging instead of reported as a pass or a failure here.
  const d = await post("/dns", { host: "example.com" });
  if (typeof d.doh_fetch !== "number") { t.skip(`DNS-over-HTTPS unreachable from this machine: ${JSON.stringify(d.doh_fetch)}`); return; }
  assert.equal(r["https://example.com/send"], "allowed");
});

test("إشعارات الجوال: الطلب المشفّر في Workers يفك تشفيره الجهاز ويحمل توقيع VAPID صحيحًا", async () => {
  const vapid = webpush.generateVAPIDKeys();
  const device = crypto.createECDH("prime256v1");
  device.generateKeys();
  const auth = crypto.randomBytes(16);
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/lab-device", keys: { p256dh: device.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
  const payload = JSON.stringify({ title: "غياب الطالب", body: "رسالة تجريبية", priority: 1 });
  const r = await post("/push-encrypt", { subscription, payload, vapid });
  assert.equal(r.headers["Content-Encoding"], "aes128gcm");
  const plain = ece.decrypt(Buffer.from(r.body, "base64"), { version: "aes128gcm", privateKey: device, authSecret: auth });
  assert.equal(plain.toString("utf8"), payload, "الجهاز يقرأ الرسالة كما أُرسلت");
  // VAPID: a JWT signed with ES256 by the server's private key, for the push service's origin.
  const [, jwt] = r.headers.Authorization.match(/^vapid t=([^,]+), k=/);
  const [h, p, s] = jwt.split(".");
  const pub = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: Buffer.from(vapid.publicKey, "base64url").subarray(1, 33).toString("base64url"), y: Buffer.from(vapid.publicKey, "base64url").subarray(33).toString("base64url") }, format: "jwk" });
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")), "توقيع VAPID صحيح");
  assert.equal(JSON.parse(Buffer.from(p, "base64url")).aud, "https://fcm.googleapis.com");
});

test("إشعارات الجوال عبر الشبكة: Workers يصل إلى خدمة الإشعارات ويقرأ ردها", async () => {
  const vapid = webpush.generateVAPIDKeys();
  const device = crypto.createECDH("prime256v1");
  device.generateKeys();
  const r = await post("/push-send", { vapid, subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/lab-invalid-device", keys: { p256dh: device.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") } } });
  console.log(`  push service answered: ${JSON.stringify(r).slice(0, 200)}`);
  assert.ok(Number(r.statusCode) >= 400, "رد حقيقي من خدمة الإشعارات (جهاز وهمي يُرفض)");
});

test("دخول Google وApple: توقيع RS256 بمفتاح JWK يُقبل، والمزوّر يُرفض", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "RS256", kid: "lab" }), body = b64({ sub: "123", aud: "midar", nonce: "n" });
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey).toString("base64url");
  const r = await post("/jwt", { token: `${head}.${body}.${sig}`, jwk: publicKey.export({ format: "jwk" }) });
  assert.equal(r.ok, true);
  assert.equal(r.forged, false);
});

test("مساعد الذكاء الاصطناعي: Workers يصل إلى Anthropic ويعيد رفض المفتاح الخاطئ بوضوح", async () => {
  const r = await post("/anthropic", {});
  console.log(`  anthropic answered: ${JSON.stringify(r).slice(0, 160)}`);
  assert.equal(r.statusCode, 401);
});

test("ملفات Excel: الملف المبني في Workers مطابق بايتًا ببايت لما يبنيه Node", async () => {
  const sheets = [{ name: "الطلاب", headers: ["الاسم", "الدرجة"], rows: [["طالب تجريبي", 95], ["طالبة تجريبية", 88]], widths: [30, 10] }];
  const r = await post("/xlsx", { sheets });
  const local = buildXlsx(sheets);
  assert.equal(r.size, local.length);
  assert.equal(r.sha256, crypto.createHash("sha256").update(local).digest("hex"));
});
