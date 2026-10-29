-- =====================================================================
-- مِدار | MIDAR — الترحيل 0106: الأقسام الافتراضية للجامعة
--   الجامعة الجديدة تبدأ بالأقسام التي تناسبها فقط (الرسوم والمالية والتواصل والإشعارات والشهادات والتقويم)،
--   بدل أقسام المدرسة (الحضور اليومي، الواجبات، الجدول المدرسي...). لا يتغير شيء لأي مؤسسة قائمة.
-- =====================================================================
UPDATE org_types SET default_features = ARRAY(SELECT key FROM features WHERE is_active AND key IN
  ('fees', 'finance', 'transfers', 'installments', 'announcements', 'notifications', 'sms', 'messaging', 'certificates', 'calendar', 'surveys', 'staff_attendance')
  ORDER BY sort), version = version + 1
 WHERE key = 'university' AND cardinality(default_features) = 0;
