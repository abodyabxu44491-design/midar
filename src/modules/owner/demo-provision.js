// تجهيز مدرسة العرض التجريبي تلقائيًا مرة واحدة على المنصة (أول تشغيل بعد النشر)،
// حتى يعمل «جرّب الآن» في الصفحة الرئيسية بلا أي خطوة يدوية. يُعطَّل بـ DEMO_AUTO=false.
import { transaction } from "../../core/db/pool.js";
import { createTenant } from "./tenants.js";
import { buildShowcase } from "../shared/showcase-school.service.js";
import { forgetDemoCache } from "../shared/demo.service.js";

const ID = "midar-demo";
const ACTOR = "تجهيز العرض التجريبي";
const platform = (fn) => transaction({ platform: true, actor: ACTOR }, fn);

export async function ensureDemoSchool({ log = console.log } = {}) {
  const [s] = await platform((q) => q("SELECT demo_provisioned_at FROM platform_settings WHERE id"));
  if (!s || s.demo_provisioned_at) return null;
  const done = (q, id) => q("UPDATE platform_settings SET demo_provisioned_at = now() WHERE id")
    .then(() => id && q("UPDATE tenants SET is_demo = (id = $1) WHERE is_demo OR id = $1", [id]));

  // المالك اختار مدرسة عرض بنفسه: لا شيء نفعله
  const [chosen] = await platform((q) => q("SELECT id FROM tenants WHERE is_demo LIMIT 1"));
  if (chosen) { await platform((q) => done(q)); return chosen.id; }

  const [t] = await platform((q) => q("SELECT id, (SELECT count(*) FROM students st WHERE st.tenant_id = t.id)::int AS students FROM tenants t WHERE id = $1", [ID]));
  if (!t) {
    log("[العرض التجريبي] إنشاء مدرسة العرض…");
    await createTenant({ actor: ACTOR, ip: null }, { id: ID, name: "مدارس الرواد الأهلية للبنين", admin_name: "أ. عبدالله محمد باوزير",
      plan: "enterprise", max_students: 2000, currency: "YER" });
  }
  // بناء البيانات في معاملة واحدة: لو انقطع التشغيل في منتصفه لا يبقى نصفها، ويُكمل في التشغيل التالي
  if (!t || !t.students) {
    const t0 = Date.now();
    await buildShowcase(ID, { actor: ACTOR, perSection: 20 });
    log(`[العرض التجريبي] بُنيت مدرسة العرض في ${Math.round((Date.now() - t0) / 1000)} ثانية`);
  }
  await platform((q) => done(q, ID));
  forgetDemoCache();
  log("[العرض التجريبي] مُفعَّل: «جرّب الآن» يعمل في الصفحة الرئيسية");
  return ID;
}
