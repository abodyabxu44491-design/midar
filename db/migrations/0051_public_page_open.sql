-- صفحة المدرسة العامة مفتوحة للجميع بلا رمز.
-- ملف الطالب نفسه يبقى محميًا بمعرّف الطالب الخاص به، وما يظهر في الصفحة تتحكم به المدرسة من إعداداتها.
UPDATE school_public_settings SET access_mode = 'open' WHERE access_mode <> 'open';
ALTER TABLE school_public_settings ALTER COLUMN access_mode SET DEFAULT 'open';
COMMENT ON COLUMN school_public_settings.access_mode IS 'مُهمل: الصفحة مفتوحة دائمًا (منذ 0051)';
