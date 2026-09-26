// تجهيز الملفات الثابتة لـ Firebase Hosting (الشعار والخطوط والأدوات المشتركة تُخدم من شبكة CDN)
// الصفحات نفسها تمر عبر الخادم حتى تبقى لوحة المالك على الرابط السري فقط.
import fs from "node:fs";

const out = "hosting-dist";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const dir of ["brand", "shared"]) fs.cpSync(`public/${dir}`, `${out}/${dir}`, { recursive: true });
fs.copyFileSync("public/brand/favicon.ico", `${out}/favicon.ico`);
console.log("✓ hosting-dist جاهز");
