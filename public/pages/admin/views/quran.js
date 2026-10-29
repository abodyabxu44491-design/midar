/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { quranBoard } from "../../shared/js/quran-board.js";
import { A } from "./common.js";

export default async function quran() {
  return quranBoard({ base: A, admin: true });
}
