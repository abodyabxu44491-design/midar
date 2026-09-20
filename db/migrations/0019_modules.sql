-- =====================================================================
-- مِدار | MIDAR — الترحيل 0019: أقسام المنصة القابلة للتشغيل والإيقاف
--   كل مدرسة تُشغّل ما تحتاجه فقط، فتبقى اللوحة بسيطة بلا تبويبات لا تستخدمها.
--   الإيقاف يخفي القسم من الواجهة ويرفضه الخادم أيضًا (لا يكفي إخفاء الأزرار).
--   البيانات المسجّلة لا تُحذف عند الإيقاف، وتعود كما هي عند التشغيل.
-- =====================================================================

CREATE TABLE school_modules (
  tenant_id     text PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  attendance    boolean NOT NULL DEFAULT true,    -- الحضور والغياب
  timetable     boolean NOT NULL DEFAULT true,    -- الجدول الدراسي
  exams         boolean NOT NULL DEFAULT true,    -- الاختبارات والدرجات
  reports       boolean NOT NULL DEFAULT true,    -- كشوف الدرجات
  homework      boolean NOT NULL DEFAULT true,    -- الواجبات
  announcements boolean NOT NULL DEFAULT true,    -- التعاميم
  admissions    boolean NOT NULL DEFAULT true,    -- طلبات التسجيل
  analytics     boolean NOT NULL DEFAULT true,    -- التحليلات
  messaging     boolean NOT NULL DEFAULT true,    -- رسائل واتساب
  fees          boolean NOT NULL DEFAULT true,    -- الرسوم والفواتير
  finance       boolean NOT NULL DEFAULT true,    -- النظام المالي (الحسابات والحركات)
  donations     boolean NOT NULL DEFAULT false,   -- التبرعات
  payroll       boolean NOT NULL DEFAULT false,   -- الرواتب
  transfers     boolean NOT NULL DEFAULT true,    -- التحويل بين الحسابات
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- الأقسام الفرعية للمالية لا تعمل بدونها، وكشوف الدرجات لا تعمل بدون الاختبارات
  CHECK (finance OR NOT (donations OR payroll OR transfers)),
  CHECK (exams OR NOT reports)
);

CREATE TRIGGER school_modules_touch BEFORE UPDATE ON school_modules FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER school_modules_audit AFTER INSERT OR UPDATE OR DELETE ON school_modules FOR EACH ROW EXECUTE FUNCTION audit_row_change();

ALTER TABLE school_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_modules USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON school_modules TO midar_app;

-- المدارس القائمة: الأقسام التي فيها بيانات فعلية تبقى مفعّلة
INSERT INTO school_modules (tenant_id, donations, payroll)
SELECT t.id,
       EXISTS (SELECT 1 FROM donations d WHERE d.tenant_id = t.id),
       EXISTS (SELECT 1 FROM payroll_runs p WHERE p.tenant_id = t.id)
  FROM tenants t
ON CONFLICT DO NOTHING;
