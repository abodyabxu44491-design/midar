-- مراسلة المعلمين: محادثة بين ولي أمر الطالب وكل معلم يدرّس فصله، داخل المنصة بدل الواتساب الشخصي.
-- محادثة واحدة لكل (طالب، معلم)، ورسائلها نصية. والمدرسة تستطيع إيقاف القسم من الإعدادات.
CREATE TABLE chat_threads (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id      bigint NOT NULL,
  teacher_id      bigint NOT NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_preview    text,
  parent_unread   int NOT NULL DEFAULT 0,
  teacher_unread  int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, student_id, teacher_id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, teacher_id) REFERENCES teachers (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX chat_threads_teacher ON chat_threads (tenant_id, teacher_id, last_message_at DESC);
CREATE INDEX chat_threads_student ON chat_threads (tenant_id, student_id);

CREATE TABLE chat_messages (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  thread_id   bigint NOT NULL,
  sender      text NOT NULL CHECK (sender IN ('parent', 'teacher')),
  sender_name text,
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, thread_id) REFERENCES chat_threads (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX chat_messages_thread ON chat_messages (tenant_id, thread_id, id DESC);

ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON chat_threads USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON chat_messages USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_threads, chat_messages TO midar_app;

-- القسم: مشمول في كل الباقات واشتراكات المدارس الحالية، ومفعّل افتراضيًا (تستطيع المدرسة إيقافه)
INSERT INTO features (key, name, description, category, kind, sort, requestable) VALUES
  ('chat', 'مراسلة المعلمين', 'محادثة بين ولي الأمر ومعلمي ابنه داخل التطبيق', 'التواصل', 'module', 27, false)
ON CONFLICT (key) DO NOTHING;
INSERT INTO plan_features (plan_id, feature_key, sort)
SELECT p.id, 'chat', 27 FROM plans p ON CONFLICT DO NOTHING;
UPDATE subscriptions s SET snapshot = jsonb_set(s.snapshot, '{features}', (s.snapshot -> 'features') || '["chat"]'::jsonb)
 WHERE NOT (s.snapshot -> 'features') ? 'chat';
ALTER TABLE school_modules ADD COLUMN chat boolean NOT NULL DEFAULT true;
