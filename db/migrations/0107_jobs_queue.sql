-- Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.
--
-- Long jobs (imports) run outside the request on Cloudflare Workers, through a queue (src/core/jobs.js):
--   input          what the job needs, so another instance can run it; cleared when the job ends
--   claimed_at     set when a worker starts it; a job claimed once is never run again (no duplicate import after a crash)
--   secret_sealed  the one-time result shown to the person who started it (new teachers' passwords), encrypted with
--                  the platform key and removed on first read or after secret_until
ALTER TABLE jobs
  ADD COLUMN input jsonb,
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN secret_sealed text CHECK (secret_sealed IS NULL OR char_length(secret_sealed) <= 2000000),
  ADD COLUMN secret_until timestamptz;
