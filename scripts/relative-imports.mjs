// تحويل الاستيراد المطلق (/shared/...) إلى نسبي (../../shared/...) حسب رابط كل ملف في المتصفح.
// الهدف: عندما تُخدم الملفات من /v/<الإصدار>/... تتبعها كل الاستيرادات الداخلية تلقائيًا (إبطال الكاش الصحيح).
// لوحة المالك مستثناة: رابطها سري ومتغير، وتُخدم دائمًا بإعادة تحقق (no-cache).
import fs from "node:fs";
import path from "node:path";

const MOUNTS = { shared: "public/shared", admin: "public/pages/admin", teacher: "public/pages/teacher", accountant: "public/pages/accountant",
  "school-page": "public/pages/school", "staff-page": "public/pages/staff", "home-page": "public/pages/home", reset: "public/pages/reset" };
const urlOf = (file) => {
  for (const [m, dir] of Object.entries(MOUNTS)) if (file.startsWith(dir + "/")) return `/${m}/${file.slice(dir.length + 1)}`;
  return null;
};
const walk = (d, out = []) => { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); if (fs.statSync(f).isDirectory()) { if (n !== "vendor") walk(f, out); } else if (f.endsWith(".js")) out.push(f); } return out; };
let changed = 0, files = 0;
for (const file of Object.values(MOUNTS).flatMap((d) => walk(d))) {
  const from = urlOf(file);
  const src = fs.readFileSync(file, "utf8");
  const out = src.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\/(shared|admin|teacher|accountant|school-page|staff-page|home-page|reset)\/[^"']+)\2/g,
    (all, pre, q, target) => {
      let rel = path.posix.relative(path.posix.dirname(from), target);
      if (!rel.startsWith(".")) rel = "./" + rel;
      changed++;
      return `${pre}${q}${rel}${q}`;
    });
  if (out !== src) { fs.writeFileSync(file, out); files++; }
}
console.log(`حُوّل ${changed} استيراد في ${files} ملف`);
