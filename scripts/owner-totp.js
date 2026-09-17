// إنشاء رمز التحقق الثنائي للمالك: npm run owner:totp
import { newTotpSecret, totpUri } from "../src/core/auth/totp.js";

const secret = newTotpSecret();
console.log("\n1) ضع هذا السطر في ملف .env:");
console.log(`   OWNER_TOTP_SECRET=${secret}`);
console.log("\n2) أضف الحساب في تطبيق Google Authenticator أو Microsoft Authenticator:");
console.log(`   المفتاح: ${secret}`);
console.log(`   أو الرابط: ${totpUri(secret)}\n`);
