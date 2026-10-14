/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
export async function logoId(q) {
  const [row] = await q(
    `SELECT COALESCE(p.logo_image_id, CASE WHEN s.show_logo THEN s.logo_image_id END) AS id
       FROM tenants t LEFT JOIN school_profile p ON p.tenant_id = t.id LEFT JOIN exam_paper_settings s ON s.tenant_id = t.id
      WHERE t.id = app_tenant()`);
  return row?.id ? Number(row.id) : null;
}
