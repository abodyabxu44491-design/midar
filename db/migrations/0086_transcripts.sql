-- Official transcripts (كشف درجات رسمي): issued from approved results and kept like certificates — a serial
-- number, a verification code, a status, and a new version that replaces the previous one when results are
-- corrected (the previous stays in the record as «مستبدلة»).
ALTER TABLE certificates DROP CONSTRAINT certificates_kind_check;
ALTER TABLE certificates ADD CONSTRAINT certificates_kind_check CHECK (kind IN ('term', 'year', 'custom', 'course', 'attendance', 'transcript'));
