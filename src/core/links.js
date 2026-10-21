/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { env } from "../config/env.js";

export const baseUrl = (req) => (env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

export function schoolLinks(req, schoolId) {
  const b = `${baseUrl(req)}/${encodeURIComponent(schoolId)}`;
  return {
    public: { home: b, students: `${b}#/students` },
    // The link sent to a school is its code only: the login page opens on the manager's tab by default.
    staff: { admin: `${b}/idara`, teacher: `${b}/idara?role=teacher`, accountant: `${b}/idara?role=accountant` },
  };
}
