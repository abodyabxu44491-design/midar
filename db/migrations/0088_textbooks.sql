-- Textbooks in the library: which grade and subject a book belongs to, which part (first, second, or a combined
-- volume), whether it is the government print or a private print, and an optional cover photo.
ALTER TABLE library_books
  ADD COLUMN grade_id   bigint,
  ADD COLUMN subject_id bigint,
  ADD COLUMN part       text CHECK (part IN ('first', 'second', 'combined')),
  ADD COLUMN source     text CHECK (source IN ('government', 'private')),
  ADD COLUMN has_cover  boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT library_books_grade FOREIGN KEY (tenant_id, grade_id) REFERENCES grades (tenant_id, id) ON DELETE SET NULL (grade_id),
  ADD CONSTRAINT library_books_subject FOREIGN KEY (tenant_id, subject_id) REFERENCES subjects (tenant_id, id) ON DELETE SET NULL (subject_id);
CREATE INDEX library_books_grade_idx ON library_books (tenant_id, grade_id);
-- One record per grade, subject and part, so adding stock again adds copies instead of a duplicate book.
CREATE UNIQUE INDEX library_books_textbook ON library_books (tenant_id, grade_id, subject_id, part)
  WHERE grade_id IS NOT NULL AND subject_id IS NOT NULL AND part IS NOT NULL;

CREATE TABLE library_book_covers (
  tenant_id  text NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  book_id    bigint NOT NULL,
  mime       text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 1572864),
  data       bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, book_id),
  FOREIGN KEY (tenant_id, book_id) REFERENCES library_books (tenant_id, id) ON DELETE CASCADE
);
ALTER TABLE library_book_covers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON library_book_covers USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON library_book_covers TO midar_app;
