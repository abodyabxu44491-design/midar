/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Long jobs described by data only, so any instance can run them: in the request's process on Node, or from the
// queue on Workers (src/core/jobs.js). Each handler gets the stored input and a progress callback.
import { transaction } from "./db/pool.js";

export const JOB_HANDLERS = {
  async import_students({ tenantId, actor, ip, tenant, rows, gradeMap, includeDuplicates }, { progress }) {
    const studentsImport = await import("../modules/shared/import-students.service.js");
    return { summary: await transaction({ tenantId, actor, ip }, (q) => studentsImport.commit(q, tenant, rows,
      { gradeMap, includeDuplicates, onProgress: (n, total) => progress(n, total) })) };
  },
  async import_teachers({ tenantId, actor, ip, rows, gradeMap, maxTeachers }, { progress }) {
    const teachersImport = await import("../modules/shared/import-teachers.service.js");
    const { credentials, ...summary } = await transaction({ tenantId, actor, ip }, (q) => teachersImport.commit(q, tenantId, rows,
      { gradeMap, maxTeachers, onProgress: (n, total) => progress(n, total) }));
    return { summary, secret: { credentials } };
  },
};
