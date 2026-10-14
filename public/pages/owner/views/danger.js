/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { dangerZone } from "/shared/js/danger-zone.js";

export default () => dangerZone({ base: "/api/owner/danger", scope: "owner" });
