// مدرسة عرض كاملة: مدارس بنين في عدن (الأساسي والثانوي) أنهت عامًا دراسيًا كاملًا بكل أقسام المنصة.
// npm run seed:showcase -- [رمز المدرسة]   — يطبع بيانات دخول المدير وعينات من المعلمين وأولياء الأمور.
// كلمات المرور عشوائية وتُطبع مرة واحدة فقط، ومتاحة أيضًا من زر «مدرسة عرض كاملة» في لوحة المالك.
import { closePool } from "../src/core/db/pool.js";
import { createShowcase } from "../src/modules/owner/tenants.js";

const id = process.argv[2] || "alrowad-aden";
const req = { actor: "سكربت مدرسة العرض", ip: null, protocol: "https", get: () => process.env.PUBLIC_HOST || "localhost" };
try {
  const t0 = Date.now();
  const r = await createShowcase(req, { id, name: "مدارس الرواد الأهلية للبنين", per_section: 24 });
  console.log(JSON.stringify({ seconds: Math.round((Date.now() - t0) / 1000), ...r }, null, 2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally { await closePool(); }
