-- =====================================================================
-- مِدار | MIDAR — الترحيل 0098: الصوت والفيديو في الاختبارات، وإجابات الطالب بصورة أو تسجيل صوتي
--   exam_media: مقطع صوتي أو فيديو قصير يرفعه المعلم لسؤال (حتى 10 ميجا). الفيديو الطويل يُضاف برابط فقط.
--   online_answer_files: صورة حل يرفعها الطالب أو تسجيله الصوتي في الاختبار الإلكتروني (ملف واحد لكل سؤال).
--   جدولان جديدان فقط، ولا يتغير أي جدول قائم.
-- =====================================================================
CREATE TABLE exam_media (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind        text NOT NULL CHECK (kind IN ('audio', 'video')),
  teacher_id  bigint,                            -- NULL = رفعته الإدارة
  mime        text NOT NULL CHECK (mime IN ('audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/webm', 'audio/wav', 'video/mp4', 'video/webm')),
  size_bytes  integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  data        bytea NOT NULL,
  name        text CHECK (name IS NULL OR char_length(name) <= 150),
  uploaded_by text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = split_part(mime, '/', 1)),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE SET NULL (teacher_id)
);
CREATE INDEX exam_media_teacher ON exam_media (tenant_id, teacher_id) WHERE teacher_id IS NOT NULL;
ALTER TABLE exam_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exam_media USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, DELETE ON exam_media TO midar_app;

CREATE TABLE online_answer_files (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  attempt_id   bigint NOT NULL,
  question_id  text NOT NULL CHECK (question_id ~ '^[a-z]_[a-z0-9]{3,20}$'),
  kind         text NOT NULL CHECK (kind IN ('image', 'audio')),
  mime         text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav')),
  size_bytes   integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  data         bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = split_part(mime, '/', 1)),
  UNIQUE (attempt_id, question_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, attempt_id) REFERENCES online_attempts (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX online_answer_files_attempt ON online_answer_files (tenant_id, attempt_id);
ALTER TABLE online_answer_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON online_answer_files USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON online_answer_files TO midar_app;
