-- "تذكرني على هذا الجهاز": جلسة أطول (30 يومًا) بدل مهلة الخمول القصيرة الافتراضية.
-- idle_minutes = NULL يعني استخدام مهلة الخمول الافتراضية لهذا النوع من الجلسات كما هي اليوم.
ALTER TABLE sessions ADD COLUMN idle_minutes integer;
