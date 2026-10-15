-- Teachers in control: published grades can be corrected (by the teacher when the school lets teachers approve
-- their own grades, or by the administration) through an explicit unlock set by the server for that save only;
-- any other change to a non-draft exam stays blocked. Each teacher can also have his own list of hidden sections.
CREATE OR REPLACE FUNCTION scores_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE e exams%ROWTYPE;
BEGIN
  SELECT * INTO e FROM exams WHERE id = COALESCE(NEW.exam_id, OLD.exam_id);
  IF e.status <> 'draft' AND COALESCE(current_setting('app.scores_unlock', true), '') <> 'on' THEN
    RAISE EXCEPTION 'الدرجات مقفلة لأن الاختبار أُرسل للاعتماد أو نُشر' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF NEW.score IS NOT NULL AND NEW.score > e.max_score THEN
      RAISE EXCEPTION 'الدرجة % أكبر من الدرجة القصوى %', NEW.score, e.max_score USING ERRCODE = 'P0001';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;

ALTER TABLE teachers ADD COLUMN IF NOT EXISTS hidden_sections text[];
