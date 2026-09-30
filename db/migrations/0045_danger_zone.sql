-- =====================================================================
-- مِدار | MIDAR — الترحيل 0045: منطقة الحذر
--   عمليات استثنائية على بيانات المدرسة (إعادة تهيئة، أرشفة، نسخ احتياطي واستعادة، حذف بيانات، حذف المدرسة،
--   إيقاف الجلسات، إعادة ضبط الحسابات، القفل الطارئ). الاشتراكات والباقات والفواتير خارج هذا القسم نهائيًا.
--
--   لا تنفيذ مباشر: كل عملية سجل في danger_operations يمر بمراحل (مخطط ← نسخة احتياطية ← موافقة ← منفذ)،
--   والجزء المدمّر ينفذه دالتان SECURITY DEFINER لا تعملان إلا على عملية «موافق عليها» برمزها وقبل انتهاء صلاحيتها.
--   التطبيق يتصل بدور محدود (midar_app) لا يستطيع تعطيل حمايات الجداول (الدفعات والطلاب الثابتة...)،
--   والدالتان (مملوكتان لمالك الجداول) تعطلانها داخل المعاملة فقط ثم تعيدانها.
-- =====================================================================

ALTER TABLE tenants
  ADD COLUMN emergency_locked_at timestamptz,
  ADD COLUMN emergency_reason text CHECK (emergency_reason IS NULL OR char_length(emergency_reason) <= 300);

-- صلاحية «منطقة الحذر» للمدير: للمدير الأول في كل مدرسة، ويمنحها لغيره من إدارة المستخدمين
ALTER TABLE users ADD COLUMN can_danger_zone boolean NOT NULL DEFAULT false;
UPDATE users u SET can_danger_zone = true
 WHERE u.role = 'admin' AND u.id = (SELECT min(id) FROM users x WHERE x.tenant_id = u.tenant_id AND x.role = 'admin');

CREATE TABLE danger_operations (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     text NOT NULL,                 -- بلا مفتاح أجنبي: السجل يبقى بعد حذف المدرسة
  tenant_name   text NOT NULL,
  scope         text NOT NULL CHECK (scope IN ('owner', 'admin')),
  op            text NOT NULL CHECK (char_length(op) <= 40),
  params        jsonb NOT NULL DEFAULT '{}',
  impact        jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'approved', 'executed', 'failed', 'cancelled')),
  token_hash    text NOT NULL CHECK (char_length(token_hash) = 64),
  backup_id     bigint,
  requested_by  text NOT NULL,
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  approved_at   timestamptz,
  executed_at   timestamptz,
  result        jsonb,
  error         text
);
CREATE INDEX danger_operations_tenant ON danger_operations (tenant_id, id DESC);
CREATE TRIGGER danger_operations_audit AFTER INSERT OR UPDATE ON danger_operations FOR EACH ROW EXECUTE FUNCTION audit_row_change();
ALTER TABLE danger_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY danger_scope ON danger_operations
  USING (tenant_id = app_tenant() OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = app_tenant() OR current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT, UPDATE ON danger_operations TO midar_app;

-- النسخ الاحتياطية: لقطة كاملة لبيانات المدرسة (مضغوطة) مع بصمة للتحقق من سلامتها
CREATE TABLE tenant_backups (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      text NOT NULL,                -- بلا مفتاح أجنبي: تبقى النسخة بعد حذف المدرسة لاستعادتها
  tenant_name    text NOT NULL,
  reason         text NOT NULL CHECK (char_length(reason) <= 200),
  created_by     text NOT NULL,
  scope          text NOT NULL CHECK (scope IN ('owner', 'admin', 'system')),
  schema_version text NOT NULL,
  tables         jsonb NOT NULL,               -- عدد الصفوف لكل جدول
  size_bytes     integer NOT NULL,
  sha256         text NOT NULL CHECK (char_length(sha256) = 64),
  data           bytea NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenant_backups_tenant ON tenant_backups (tenant_id, id DESC);
ALTER TABLE tenant_backups ENABLE ROW LEVEL SECURITY;
CREATE POLICY backups_scope ON tenant_backups
  USING (tenant_id = app_tenant() OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = app_tenant() OR current_setting('app.platform', true) = 'on');
GRANT SELECT, INSERT, DELETE ON tenant_backups TO midar_app;

/* ---------- جداول بيانات المدرسة وترتيبها ----------
   كل جدول فيه tenant_id، مع عمقه في شجرة المفاتيح الأجنبية (الأب قبل الابن عند الإدخال، والعكس عند الحذف).
   kind: data = بيانات المدرسة (تُنسخ وتُستعاد) | transient = جلسات ومزامنة (تُحذف ولا تُنسخ)
         | billing = الاشتراكات والفوترة (لا تمسها منطقة الحذر إلا عند حذف المدرسة نهائيًا) | log = السجلات (لا تُمس أبدًا) */
CREATE FUNCTION danger_tables() RETURNS TABLE (name text, depth int, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE t AS (
    SELECT c.table_name::text AS name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND c.table_name NOT IN ('danger_operations', 'tenant_backups')
  ), fk AS (
    SELECT DISTINCT k.conrelid::regclass::text AS child, k.confrelid::regclass::text AS parent
      FROM pg_constraint k WHERE k.contype = 'f' AND k.connamespace = 'public'::regnamespace
       AND k.conrelid <> k.confrelid
       AND k.conrelid::regclass::text IN (SELECT name FROM t) AND k.confrelid::regclass::text IN (SELECT name FROM t)
  ), d AS (
    SELECT name, 0 AS depth FROM t
    UNION ALL
    SELECT fk.child, d.depth + 1 FROM d JOIN fk ON fk.parent = d.name WHERE d.depth < 50
  )
  SELECT name, max(depth)::int,
         CASE WHEN name IN ('audit_log', 'security_events') THEN 'log'
              WHEN name IN ('sessions', 'sync_changes', 'sync_devices', 'sync_operations', 'password_requests') THEN 'transient'
              WHEN name IN ('subscriptions', 'subscription_events', 'subscription_invoices', 'tenant_prices', 'renewal_requests', 'leads') THEN 'billing'
              ELSE 'data' END
    FROM d GROUP BY name;
$$;

-- لقطة كاملة لبيانات المدرسة (جداول data فقط): { "table": [rows...] }
CREATE FUNCTION danger_export(tid text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; out jsonb := '{}'; rows jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = tid) THEN RAISE EXCEPTION 'المدرسة غير موجودة' USING ERRCODE = 'P0002'; END IF;
  FOR r IN SELECT name FROM danger_tables() WHERE kind = 'data' ORDER BY depth, name LOOP
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x)), ''[]'') FROM %I x WHERE tenant_id = $1', r.name) INTO rows USING tid;
    out := out || jsonb_build_object(r.name, rows);
  END LOOP;
  RETURN out;
END $$;

-- التحقق من العملية: موجودة، للمدرسة نفسها، موافق عليها، بالرمز نفسه، ولم تنتهِ صلاحيتها
CREATE FUNCTION danger_check(op_id bigint, tok text, tid text, want_op text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM danger_operations
    WHERE id = op_id AND tenant_id = tid AND op = want_op AND status = 'approved' AND token_hash = tok AND expires_at > now()
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'العملية غير معتمدة أو انتهت صلاحيتها' USING ERRCODE = '42501'; END IF;
END $$;

/* الحذف: قائمة جداول (تُتحقق كلها من القائمة المسموحة) بترتيب آمن، مع تعطيل حمايات الجداول داخل المعاملة فقط.
   keep_admins: يبقي حسابات المدير (إعادة المدرسة لوضع البداية). whole_school: حذف نهائي يشمل الاشتراكات وسجل المدرسة. */
CREATE FUNCTION danger_delete(op_id bigint, tok text, tid text, want_op text, tbls text[], keep_admins boolean DEFAULT false, whole_school boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n bigint; out jsonb := '{}';
BEGIN
  PERFORM danger_check(op_id, tok, tid, want_op);
  IF EXISTS (SELECT 1 FROM unnest(tbls) x WHERE x NOT IN (
       SELECT name FROM danger_tables() WHERE kind IN ('data', 'transient') OR (whole_school AND kind = 'billing'))) THEN
    RAISE EXCEPTION 'جدول غير مسموح في منطقة الحذر' USING ERRCODE = '42501';
  END IF;
  IF whole_school THEN UPDATE tenants SET subscription_id = NULL WHERE id = tid; END IF;
  FOR r IN SELECT d.name FROM danger_tables() d WHERE d.name = ANY (tbls) ORDER BY d.depth DESC, d.name LOOP
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', r.name);
    IF r.name = 'users' AND keep_admins THEN
      EXECUTE 'DELETE FROM users WHERE tenant_id = $1 AND role <> ''admin''' USING tid;
    ELSE
      EXECUTE format('DELETE FROM %I WHERE tenant_id = $1', r.name) USING tid;
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', r.name);
    IF n > 0 THEN out := out || jsonb_build_object(r.name, n); END IF;
  END LOOP;
  IF whole_school THEN
    ALTER TABLE tenants DISABLE TRIGGER USER;
    DELETE FROM tenants WHERE id = tid;
    ALTER TABLE tenants ENABLE TRIGGER USER;
  END IF;
  RETURN out;
END $$;

/* الاستعادة: تحذف بيانات المدرسة الحالية (data + transient) ثم تُدخل بيانات النسخة بترتيب الآباء أولًا.
   الأعمدة المضافة بعد النسخة تأخذ قيمها الافتراضية، والمحذوفة تُتجاهل. المعرّفات الأصلية تبقى كما هي. */
CREATE FUNCTION danger_restore(op_id bigint, tok text, tid text, want_op text, data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; cols text; n bigint; out jsonb := '{}'; rows jsonb;
BEGIN
  PERFORM danger_check(op_id, tok, tid, want_op);
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = tid) THEN RAISE EXCEPTION 'المدرسة غير موجودة' USING ERRCODE = 'P0002'; END IF;
  FOR r IN SELECT name FROM danger_tables() WHERE kind IN ('data', 'transient') ORDER BY depth DESC, name LOOP
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', r.name);
    EXECUTE format('DELETE FROM %I WHERE tenant_id = $1', r.name) USING tid;
    EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', r.name);
  END LOOP;
  FOR r IN SELECT name FROM danger_tables() WHERE kind = 'data' ORDER BY depth, name LOOP
    rows := data -> r.name;
    CONTINUE WHEN rows IS NULL OR jsonb_array_length(rows) = 0;
    -- أعمدة الجدول الحالية الموجودة في النسخة (بلا الأعمدة المحسوبة)
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO cols
      FROM pg_attribute a
     WHERE a.attrelid = r.name::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
       AND rows -> 0 ? a.attname;
    CONTINUE WHEN cols IS NULL;
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', r.name);
    EXECUTE format('INSERT INTO %I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_recordset(NULL::%I, $1) WHERE tenant_id = $2',
                   r.name, cols, cols, r.name) USING rows, tid;
    GET DIAGNOSTICS n = ROW_COUNT;
    EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', r.name);
    out := out || jsonb_build_object(r.name, n);
  END LOOP;
  RETURN out;
END $$;

-- إصدار قاعدة البيانات يُكتب في كل نسخة احتياطية (جدول الترحيلات غير متاح لدور التطبيق)
CREATE FUNCTION danger_schema_version() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT max(filename) FROM schema_migrations $$;

REVOKE ALL ON FUNCTION danger_schema_version(), danger_tables(), danger_export(text), danger_check(bigint, text, text, text),
  danger_delete(bigint, text, text, text, text[], boolean, boolean), danger_restore(bigint, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION danger_schema_version(), danger_tables(), danger_export(text),
  danger_delete(bigint, text, text, text, text[], boolean, boolean), danger_restore(bigint, text, text, text, jsonb) TO midar_app;
