/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import fs from "node:fs";

export const state = () => JSON.parse(fs.readFileSync(new URL("../.state.json", import.meta.url)));
