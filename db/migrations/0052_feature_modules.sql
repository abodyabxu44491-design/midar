-- =====================================================================
-- مِدار | MIDAR — الترحيل 0052: أقسام جديدة، كل واحد يُشغَّل ويُوقف من إعدادات المدرسة
--   الإشعارات الفورية، الرسائل النصية، السلوك، الشهادات، الاختبارات الإلكترونية، حضور الموظفين وإجازاتهم،
--   حصص الانتظار، تحضير الدروس، التقويم المدرسي، الأقساط وخصم الإخوة، النقل المدرسي، المكتبة، العهد والمخزون،
--   العيادة، الاستبيانات، مواعيد أولياء الأمور، والمساعد الذكي.
--   • كلها ضمن الباقات القائمة واشتراكات المدارس الحالية (يستطيع المالك إزالة أي منها من أي باقة)
--   • كلها مفعّلة افتراضيًا، وتوقفها المدرسة من «الإعدادات ← أقسام المنصة»
-- =====================================================================

INSERT INTO features (key, name, description, category, kind, sort, requestable) VALUES
  ('notifications',   'الإشعارات الفورية',         'إشعار على جوال ولي الأمر والمعلم من التطبيق المثبّت',         'التواصل', 'module', 23, true),
  ('sms',             'الرسائل النصية',            'رسائل SMS تلقائية لأولياء الأمور برصيد رسائل',             'التواصل', 'module', 24, true),
  ('surveys',         'الاستبيانات',               'استبيانات لأولياء الأمور والمعلمين ونتائجها',              'التواصل', 'module', 25, true),
  ('meetings',        'مواعيد أولياء الأمور',      'حجز مواعيد مع المعلمين والإدارة',                          'التواصل', 'module', 26, true),
  ('calendar',        'التقويم المدرسي',           'الاختبارات والإجازات والفعاليات في تقويم واحد',            'أكاديمي', 'module', 17, true),
  ('behavior',        'السلوك والانضباط',          'المخالفات والإنجازات بالنقاط لكل طالب',                     'أكاديمي', 'module', 18, true),
  ('certificates',    'الشهادات الرسمية',          'شهادات الفصل والعام برمز تحقق',                            'أكاديمي', 'module', 19, true),
  ('online_exams',    'الاختبارات الإلكترونية',    'الطالب يحل من جواله والتصحيح تلقائي',                       'أكاديمي', 'module', 20, true),
  ('lesson_plans',    'تحضير الدروس',              'خطط المعلمين الأسبوعية واعتمادها',                         'أكاديمي', 'module', 21, true),
  ('staff_attendance','حضور الموظفين والإجازات',   'حضور المعلمين والموظفين وطلبات الإجازة وربطها بالرواتب',  'الموظفون', 'module', 40, true),
  ('substitutes',     'حصص الانتظار',              'معلم بديل لحصص المعلم الغائب',                             'الموظفون', 'module', 41, true),
  ('installments',    'الأقساط وخصم الإخوة',       'تقسيط الفواتير بتواريخ استحقاق وخصم تلقائي للإخوة',        'المالية', 'module', 35, true),
  ('transport',       'النقل المدرسي',             'الحافلات وخطوطها والطلاب وتنبيه الصعود والنزول',            'الخدمات', 'module', 60, true),
  ('library',         'المكتبة',                   'الكتب والإعارة والإرجاع',                                  'الخدمات', 'module', 61, true),
  ('inventory',       'العهد والمخزون',            'الأصناف والعهد المسلّمة للموظفين والطلاب',                  'الخدمات', 'module', 62, true),
  ('clinic',          'العيادة المدرسية',          'الملف الصحي وزيارات العيادة مع تنبيه ولي الأمر',            'الخدمات', 'module', 63, true),
  ('ai_assistant',    'المساعد الذكي',             'اسأل عن بيانات مدرستك واحصل على الإجابة فورًا',             'التشغيل', 'module', 18, true)
ON CONFLICT (key) DO NOTHING;

-- ضمن كل الباقات القائمة
INSERT INTO plan_features (plan_id, feature_key, sort)
SELECT p.id, f.key, f.sort FROM plans p CROSS JOIN features f
 WHERE f.key IN ('notifications', 'sms', 'surveys', 'meetings', 'calendar', 'behavior', 'certificates', 'online_exams', 'lesson_plans',
                 'staff_attendance', 'substitutes', 'installments', 'transport', 'library', 'inventory', 'clinic', 'ai_assistant')
ON CONFLICT DO NOTHING;

-- واشتراكات المدارس الحالية (اللقطة المحفوظة تحدد المشمول، فنضيف الجديد إليها)
UPDATE subscriptions s SET snapshot = jsonb_set(s.snapshot, '{features}', (s.snapshot -> 'features') || (
  SELECT COALESCE(jsonb_agg(k), '[]'::jsonb) FROM unnest(ARRAY['notifications', 'sms', 'surveys', 'meetings', 'calendar', 'behavior', 'certificates',
    'online_exams', 'lesson_plans', 'staff_attendance', 'substitutes', 'installments', 'transport', 'library', 'inventory', 'clinic', 'ai_assistant']) k
   WHERE NOT (s.snapshot -> 'features') ? k));

-- مفاتيح التشغيل داخل المدرسة
ALTER TABLE school_modules
  ADD COLUMN notifications    boolean NOT NULL DEFAULT true,
  ADD COLUMN sms              boolean NOT NULL DEFAULT true,
  ADD COLUMN surveys          boolean NOT NULL DEFAULT true,
  ADD COLUMN meetings         boolean NOT NULL DEFAULT true,
  ADD COLUMN calendar         boolean NOT NULL DEFAULT true,
  ADD COLUMN behavior         boolean NOT NULL DEFAULT true,
  ADD COLUMN certificates     boolean NOT NULL DEFAULT true,
  ADD COLUMN online_exams     boolean NOT NULL DEFAULT true,
  ADD COLUMN lesson_plans     boolean NOT NULL DEFAULT true,
  ADD COLUMN staff_attendance boolean NOT NULL DEFAULT true,
  ADD COLUMN substitutes      boolean NOT NULL DEFAULT true,
  ADD COLUMN installments     boolean NOT NULL DEFAULT true,
  ADD COLUMN transport        boolean NOT NULL DEFAULT true,
  ADD COLUMN library          boolean NOT NULL DEFAULT true,
  ADD COLUMN inventory        boolean NOT NULL DEFAULT true,
  ADD COLUMN clinic           boolean NOT NULL DEFAULT true,
  ADD COLUMN ai_assistant     boolean NOT NULL DEFAULT true,
  -- الاختبارات الإلكترونية تُبنى من مصمم الاختبارات وتنزل درجاتها في الاختبارات، والأقساط جزء من الرسوم، وحصص الانتظار من الجدول
  ADD CONSTRAINT online_exams_needs_papers CHECK (NOT online_exams OR (exam_papers AND exams)) NOT VALID,
  ADD CONSTRAINT installments_needs_fees CHECK (NOT installments OR fees) NOT VALID,
  ADD CONSTRAINT substitutes_needs_timetable CHECK (NOT substitutes OR timetable) NOT VALID;

-- المدارس التي أوقفت القسم الأساسي: يُوقف الفرعي الجديد معه
UPDATE school_modules SET online_exams = false WHERE NOT (exam_papers AND exams);
UPDATE school_modules SET installments = false WHERE NOT fees;
UPDATE school_modules SET substitutes = false WHERE NOT timetable;
ALTER TABLE school_modules VALIDATE CONSTRAINT online_exams_needs_papers;
ALTER TABLE school_modules VALIDATE CONSTRAINT installments_needs_fees;
ALTER TABLE school_modules VALIDATE CONSTRAINT substitutes_needs_timetable;
