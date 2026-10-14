/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { api } from "../../shared/js/api.js";
import { behaviorBoard } from "../../shared/js/behavior-board.js";
import { A } from "./common.js";

export default async function behavior() {
  const classes = await api(`${A}/structure/classes`);
  return behaviorBoard({ base: A, classes: classes.map((c) => ({ id: c.id, name: c.name })), admin: true });
}
