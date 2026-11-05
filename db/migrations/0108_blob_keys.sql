-- Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.
--
-- File contents can live in Cloudflare R2 instead of the database (src/core/blobs.js). The row stays here, under the
-- same row-level security, and holds the object's key; the key always starts with the school's id (t/<tenant>/...).
-- A row has its bytes in `data` (as before, and wherever R2 is not available) or a key, never neither.
-- Personal photos (students, teachers) stay in the database for now: small, and read in many queries.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attachments', 'exam_images', 'certificate_assets', 'library_book_covers', 'exam_media',
                           'online_answer_files', 'tenant_backups'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN blob_key text CHECK (blob_key IS NULL OR blob_key ~ ''^t/[A-Za-z0-9_-]+/[a-z-]+/[0-9a-f-]{36}$'')', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN data DROP NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (data IS NOT NULL OR blob_key IS NOT NULL)', t, t || '_content');
  END LOOP;
END $$;

-- The reduced image shown in exam papers.
ALTER TABLE exam_images
  ADD COLUMN thumb_key text CHECK (thumb_key IS NULL OR thumb_key ~ '^t/[A-Za-z0-9_-]+/[a-z-]+/[0-9a-f-]{36}$');
