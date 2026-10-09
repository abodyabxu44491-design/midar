-- التسجيل الذاتي الفوري: المدرسة تسجّل من الصفحة الرئيسية فتُنشأ مدرستها وتجربتها فورًا وتأخذ بيانات الدخول،
-- بدل انتظار مراجعة المالك. يتحكم فيه المالك (مغلق افتراضيًا)، مع حد يومي للمنصة كلها ضد الإغراق.
ALTER TABLE platform_settings
  ADD COLUMN instant_trial boolean NOT NULL DEFAULT false,
  ADD COLUMN instant_trial_daily_cap int NOT NULL DEFAULT 20 CHECK (instant_trial_daily_cap BETWEEN 1 AND 500);

-- لتمييز الطلبات التي أنشأت مدرستها تلقائيًا في لوحة المالك
ALTER TABLE leads ADD COLUMN instant boolean NOT NULL DEFAULT false;
