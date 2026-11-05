-- Copyright (c) 2026 Midar. All rights reserved.
-- Proprietary and confidential. Unauthorized copying or distribution is prohibited.
--
-- The company that offers Midar, as the owner enters it in the panel. The public site, the legal pages and the
-- documents show only the fields that are filled in: nothing about registration or the legal entity is ever stated
-- until the owner writes it, so the platform cannot claim what is not true.
ALTER TABLE platform_settings
  ADD COLUMN company_name       text CHECK (company_name IS NULL OR char_length(company_name) BETWEEN 2 AND 120),
  ADD COLUMN company_name_en    text CHECK (company_name_en IS NULL OR char_length(company_name_en) BETWEEN 2 AND 120),
  ADD COLUMN company_legal_name text CHECK (company_legal_name IS NULL OR char_length(company_legal_name) BETWEEN 2 AND 200),
  ADD COLUMN company_reg_no     text CHECK (company_reg_no IS NULL OR char_length(company_reg_no) BETWEEN 2 AND 60),
  ADD COLUMN company_country    text CHECK (company_country IS NULL OR char_length(company_country) BETWEEN 2 AND 60),
  ADD COLUMN company_address    text CHECK (company_address IS NULL OR char_length(company_address) <= 300);
