// تشفير كلمات المرور المؤقتة (AES-256-GCM). المفتاح في متغير بيئة خارج قاعدة البيانات، فلا تكفي نسخة القاعدة وحدها لقراءتها.
// الصيغة: v1.<iv>.<tag>.<ciphertext> (base64url). AAD = رمز المدرسة، فلا يصلح صف منقول لمدرسة أخرى.
import crypto from "node:crypto";

const parseKey = (hex) => (typeof hex === "string" && /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, "hex") : null);

/** createBox(hexKey) — للاختبارات؛ الاستخدام العادي عبر seal/open/enabled */
export function createBox(hexKey) {
  const key = parseKey(hexKey);
  const b64 = (b) => b.toString("base64url");
  return {
    enabled: () => Boolean(key),
    seal(plain, aad) {
      if (!key) return null;
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv("aes-256-gcm", key, iv);
      c.setAAD(Buffer.from(String(aad)));
      const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
      return `v1.${b64(iv)}.${b64(c.getAuthTag())}.${b64(ct)}`;
    },
    open(blob, aad) {
      if (!key || !blob) return null;
      const [v, iv, tag, ct] = String(blob).split(".");
      if (v !== "v1" || !iv || !tag || !ct) return null;
      try {
        const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
        d.setAAD(Buffer.from(String(aad)));
        d.setAuthTag(Buffer.from(tag, "base64url"));
        return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
      } catch { return null; }   // مفتاح خاطئ أو بيانات معبوث بها
    },
  };
}

// المفتاح: CREDENTIAL_KEY إن ضُبط، وإلا يُشتق (HKDF) من سر الاتصال بقاعدة البيانات DATABASE_URL.
// السر في إعدادات الخادم لا داخل القاعدة، فنسخة القاعدة وحدها لا تكشف كلمات المرور، والميزة تعمل دون إعداد يدوي.
// تغيير كلمة مرور قاعدة البيانات (أو المفتاح) يجعل النسخ القديمة غير مقروءة فقط: تبقى الحسابات تعمل وتُنشأ كلمة مؤقتة جديدة.
function resolveKey(env = process.env) {
  if (parseKey(env.CREDENTIAL_KEY)) return env.CREDENTIAL_KEY;
  if (!env.DATABASE_URL) return null;
  return Buffer.from(crypto.hkdfSync("sha256", env.DATABASE_URL, "midar", "initial-credentials-v1", 32)).toString("hex");
}
export const keySource = (env = process.env) => (parseKey(env.CREDENTIAL_KEY) ? "CREDENTIAL_KEY" : env.DATABASE_URL ? "derived" : "none");
const box = createBox(resolveKey());
export const credentialsEnabled = box.enabled;
export const sealCredential = box.seal;
export const openCredential = box.open;
