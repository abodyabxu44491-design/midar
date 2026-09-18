-- =====================================================================
-- مِدار | MIDAR — الترحيل 0004: إعدادات صفحة المدرسة العامة
--
-- كل عنصر في الصفحة العامة اختياري، وإدارة المدرسة هي من تقرر ما يظهر:
--   الدخول برمز أو بدون رمز، عرض الصفوف، عرض أسماء الطلاب، البحث،
--   جدول معلمي الصف، عدد الطلاب، الإعلانات، وحالة السداد.
-- القيم الافتراضية هي الأكثر تحفظًا.
-- =====================================================================

CREATE TABLE school_public_settings (
  tenant_id              text PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  access_mode            text NOT NULL DEFAULT 'code' CHECK (access_mode IN ('code', 'open')),
  show_classes           boolean NOT NULL DEFAULT true,
  show_student_names     boolean NOT NULL DEFAULT true,
  show_search            boolean NOT NULL DEFAULT true,
  show_teachers          boolean NOT NULL DEFAULT true,
  show_class_counts      boolean NOT NULL DEFAULT true,
  show_announcements     boolean NOT NULL DEFAULT true,
  -- إظهار حالة السداد بجانب اسم الطالب في القائمة العامة (افتراضيًا موقوف)
  public_fee_badges      boolean NOT NULL DEFAULT false,
  profile_show_grades    boolean NOT NULL DEFAULT true,
  profile_show_attendance boolean NOT NULL DEFAULT true,
  profile_show_teachers  boolean NOT NULL DEFAULT true,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- البحث لا يُعطل والأسماء مخفية والصفوف مخفية معًا، وإلا صارت الصفحة بلا فائدة
  CHECK (show_search OR (show_classes AND show_student_names))
);

CREATE TRIGGER school_public_settings_touch BEFORE UPDATE ON school_public_settings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER school_public_settings_audit AFTER INSERT OR UPDATE OR DELETE ON school_public_settings
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();

ALTER TABLE school_public_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_public_settings
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

GRANT SELECT, INSERT, UPDATE ON school_public_settings TO midar_app;

-- صف إعدادات لكل مدرسة قائمة
INSERT INTO school_public_settings (tenant_id) SELECT id FROM tenants ON CONFLICT DO NOTHING;

-- وصف مختصر لكل خيار (يظهر للمطورين عند قراءة الجدول)
COMMENT ON COLUMN school_public_settings.access_mode IS 'code = الصفحة تحتاج رمزًا، open = مفتوحة لمن يعرف الرابط';
COMMENT ON COLUMN school_public_settings.public_fee_badges IS 'إظهار مسدد/لم يسدد بجانب الاسم للجميع — يكشف وضع الأسرة المالية';
