/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import crypto from "node:crypto";
console.log(`CREDENTIAL_KEY=${crypto.randomBytes(32).toString("hex")}`);
console.log("احفظه في مكان آمن منفصل عن نسخ قاعدة البيانات. فقدانه يعني أن بيانات الدخول الأولية المحفوظة لا تُقرأ (وتبقى الحسابات تعمل).");
