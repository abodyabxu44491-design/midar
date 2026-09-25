// الإعدادات: يتم التحقق منها عند التشغيل، وأي خطأ يوقف الخادم قبل أن يبدأ
import fs from "node:fs";
import dotenv from "dotenv";
import { z } from "zod";

// التطوير المحلي: .env.local (لا يُرفع إلى Firebase ولا إلى Git)
// السيرفر الخاص: .env — وعلى Firebase تأتي القيم من Secret Manager و .env.<project>
dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: z.union([z.string().url(), z.literal("")]).optional().transform((v) => v || undefined),
  DATABASE_URL: z.string().startsWith("postgres"),
  // عند الاستضافة على Firebase: اسم اتصال Cloud SQL بصيغة project:region:instance
  CLOUD_SQL_INSTANCE: z.string().regex(/^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$/).optional().or(z.literal("")),
  MIGRATION_DATABASE_URL: z.string().startsWith("postgres").optional(),
  DATABASE_SSL: bool.default("false"),
  OWNER_PATH: z.string().regex(/^\/[A-Za-z0-9_-]{10,64}$/, "OWNER_PATH يجب أن يبدأ بـ / ويتكون من 10 أحرف على الأقل")
    .refine((v) => !/change/i.test(v), "غيّر OWNER_PATH إلى رابط سري خاص بك"),
  OWNER_USERNAME: z.string().min(3),
  OWNER_PASSWORD_HASH: z.string().startsWith("scrypt$", "أنشئ OWNER_PASSWORD_HASH بالأمر: npm run owner:password"),
  OWNER_TOTP_SECRET: z.string().regex(/^[A-Z2-7]{16,64}$/).optional().or(z.literal("")),
  OWNER_ALLOWED_IPS: z.string().default(""),
  COOKIE_SECURE: bool.default("true"),
  // separate = كوكي منفصل لكل دور (سيرفر خاص) | single = كوكي واحد باسم __session (مطلوب في Firebase Hosting)
  SESSION_COOKIE_MODE: z.enum(["separate", "single"]).default("separate"),
  // تحليلات Firebase في الصفحات العامة فقط
  FIREBASE_ANALYTICS: bool.default("false"),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("✗ إعدادات .env غير صحيحة:");
  for (const i of parsed.error.issues) console.error(`   - ${i.path.join(".")}: ${i.message}`);
  process.exit(1);
}

export const env = Object.freeze({
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === "production",
  ownerIps: parsed.data.OWNER_ALLOWED_IPS.split(",").map((s) => s.trim()).filter(Boolean),
});

// التحقق الثنائي لدخول المالك اختياري: الدخول باسم مستخدم وكلمة مرور ما لم يُضبط OWNER_TOTP_SECRET.
// لكنه في الإنتاج خط الدفاع الأخير عن لوحة المالك، فننبّه عند التشغيل بدونه.
if (env.isProd && !env.OWNER_TOTP_SECRET) {
  console.warn("⚠ لوحة المالك تعمل بدون تحقق ثنائي. لتفعيله: npm run owner:totp ثم ضع الناتج في OWNER_TOTP_SECRET.");
}

if (env.isProd && !env.COOKIE_SECURE) {
  console.error("✗ في وضع الإنتاج يجب أن تكون COOKIE_SECURE=true (مع HTTPS)");
  process.exit(1);
}// على Render/Firebase/nginx يمر كل الطلب عبر وكيل: بدون TRUST_PROXY يظهر كل الزوار بعنوان الوكيل نفسه،
// فتصبح حدود المحاولات (لكل عنوان) مشتركة بين كل المستخدمين وقد تمنع الجميع من الدخول.
if (parsed.data.NODE_ENV === "production" && parsed.data.TRUST_PROXY === 0) {
  console.warn("⚠ TRUST_PROXY=0 في وضع الإنتاج: كل الزوار سيظهرون بعنوان الوكيل نفسه. على Render ضع TRUST_PROXY=1.");
}
