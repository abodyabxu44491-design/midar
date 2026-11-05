-- Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.
--
-- A reduced image can now be in R2 (thumb_key) instead of the database (thumb, 0108). Its type goes with the image
-- wherever the image is: a type without an image, or an image without a type, stays refused.
ALTER TABLE exam_images DROP CONSTRAINT exam_images_thumb_pair;
ALTER TABLE exam_images ADD CONSTRAINT exam_images_thumb_pair
  CHECK ((thumb IS NULL AND thumb_key IS NULL) = (thumb_mime IS NULL) AND NOT (thumb IS NOT NULL AND thumb_key IS NOT NULL));
