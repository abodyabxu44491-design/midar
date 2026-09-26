// تجهيز الملفات الثابتة لـ Firebase Hosting (شبكة CDN).
//   /v/<الإصدار>/shared/...  ← نسخة بالإصدار بكاش دائم (الرابط يتغير مع كل نشر، فلا يبقى ملف قديم)
//   /shared/...              ← نسخة بلا إصدار بإعادة تحقق (للوحة المالك والروابط القديمة)
// الصفحات نفسها تمر عبر الخادم (بلا كاش) حتى تشير دائمًا للإصدار الحالي، وتبقى لوحة المالك على الرابط السري فقط.
// الإصدار يُحسب بنفس خوارزمية الخادم ومن نفس الملفات، فيتطابق الرابط الذي يكتبه الخادم مع الملفات المنشورة.
import fs from "node:fs";
import { APP_VERSION } from "../src/core/version.js";

const out = "hosting-dist";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const dir of ["brand", "shared"]) fs.cpSync(`public/${dir}`, `${out}/${dir}`, { recursive: true });
fs.cpSync("public/shared", `${out}/v/${APP_VERSION}/shared`, { recursive: true });
fs.copyFileSync("public/brand/favicon.ico", `${out}/favicon.ico`);
console.log(`✓ hosting-dist جاهز — الإصدار ${APP_VERSION}`);
