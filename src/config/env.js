/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import fs from "node:fs";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: fs.existsSync(".env.local") ? ".env.local" : ".env" });

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Pasted values often carry a space, a line break or a trailing slash; any of them breaks every link built
  // from it (Google rejects a redirect address that contains a space).
  PUBLIC_URL: z.preprocess((v) => (typeof v === "string" ? v.replace(/\s+/g, "").replace(/\/+$/, "") : v),
    z.union([z.string().url(), z.literal("")]).optional()).transform((v) => v || undefined),
  ANDROID_PACKAGE: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/).optional().or(z.literal("")).transform((v) => v || undefined),
  ANDROID_SHA256: z.string().optional().transform((v) => (v || "").split(",").map((x) => x.trim().toUpperCase()).filter((x) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(x))),
  DATABASE_URL: z.string().startsWith("postgres"),
  MIGRATION_DATABASE_URL: z.string().startsWith("postgres").optional(),
  DATABASE_SSL: bool.default("false"),
  OWNER_PATH: z.string().regex(/^\/[A-Za-z0-9_-]{10,64}$/, "OWNER_PATH يجب أن يبدأ بـ / ويتكون من 10 أحرف على الأقل")
    .refine((v) => !/change/i.test(v), "غيّر OWNER_PATH إلى رابط سري خاص بك"),
  OWNER_USERNAME: z.string().min(3),
  OWNER_PASSWORD_HASH: z.string().startsWith("scrypt$", "أنشئ OWNER_PASSWORD_HASH بالأمر: npm run owner:password"),
  OWNER_TOTP_SECRET: z.string().regex(/^[A-Z2-7]{16,64}$/).optional().or(z.literal("")),
  OWNER_ALLOWED_IPS: z.string().default(""),
  // Where high-severity security alerts are emailed (through the platform mail gateway). Optional.
  OWNER_ALERT_EMAIL: z.string().trim().email().optional().or(z.literal("")),
  CREDENTIAL_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "CREDENTIAL_KEY يجب أن يكون 64 خانة hex (npm run credential:key)").optional().or(z.literal("")),
  VAPID_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/).optional().or(z.literal("")),
  VAPID_PRIVATE_KEY: z.string().regex(/^[A-Za-z0-9_-]{40,50}$/).optional().or(z.literal("")),
  ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-").optional().or(z.literal("")),
  AI_MODEL: z.string().regex(/^claude-[a-z0-9.-]+$/).optional().or(z.literal("")),
  COOKIE_SECURE: bool.default("true"),
  SESSION_COOKIE_MODE: z.enum(["separate", "single"]).default("separate"),
  // Rollback switch: lets school managers sign in with username and password again (the old way).
  ADMIN_LEGACY_LOGIN: bool.default("false"),
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

if (env.isProd && !env.OWNER_TOTP_SECRET) {
  console.warn("ℹ OWNER_TOTP_SECRET غير مضبوط: سيُطلب من المالك تفعيل التحقق الثنائي من شاشة الدخول قبل أي جلسة.");
}

if (env.isProd && !env.COOKIE_SECURE) {
  console.error("✗ في وضع الإنتاج يجب أن تكون COOKIE_SECURE=true (مع HTTPS)");
  process.exit(1);
}
if (parsed.data.NODE_ENV === "production" && parsed.data.TRUST_PROXY === 0) {
  console.warn("⚠ TRUST_PROXY=0 في وضع الإنتاج: كل الزوار سيظهرون بعنوان الوكيل نفسه. على Render ضع TRUST_PROXY=1.");
}
