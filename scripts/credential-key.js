// يولّد مفتاح CREDENTIAL_KEY (احفظه في متغيرات البيئة ونسخة احتياطية منفصلة عن قاعدة البيانات)
import crypto from "node:crypto";
console.log(`CREDENTIAL_KEY=${crypto.randomBytes(32).toString("hex")}`);
console.log("احفظه في مكان آمن منفصل عن نسخ قاعدة البيانات. فقدانه يعني أن بيانات الدخول الأولية المحفوظة لا تُقرأ (وتبقى الحسابات تعمل).");
