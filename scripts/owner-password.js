// إنشاء بصمة كلمة مرور المالك: npm run owner:password
import readline from "node:readline/promises";
import { hashPassword } from "../src/core/auth/password.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pw = process.argv[2] || (await rl.question("اكتب كلمة مرور المالك (12 حرفًا على الأقل): "));
rl.close();
if (pw.length < 12) { console.error("✗ كلمة المرور قصيرة"); process.exit(1); }
console.log("\nضع هذا السطر في ملف .env:\n");
console.log(`OWNER_PASSWORD_HASH=${await hashPassword(pw)}\n`);
