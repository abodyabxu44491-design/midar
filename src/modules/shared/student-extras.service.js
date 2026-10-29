/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { activeModules } from "./notify.service.js";
import { featureSettings } from "./feature-settings.service.js";
import * as behavior from "./behavior.service.js";
import * as certificates from "./certificates.service.js";
import * as onlineExams from "./online-exams.service.js";
import * as calendar from "./calendar.service.js";
import * as services from "./services.service.js";
import * as engagement from "./engagement.service.js";
import * as quran from "./quran.service.js";
import * as uni from "./university.service.js";

export async function studentExtras(q, s, { admin = false } = {}) {
  const mods = await activeModules(q);
  const out = {};
  if (mods.behavior && (admin || (await featureSettings(q, "behavior")).show_parent)) {
    out.behavior = await behavior.forStudent(q, s.id);
  }
  const [{ org_type: engine }] = await q("SELECT org_type FROM tenants WHERE id = app_tenant()");
  if (engine === "university") out.transcript = await uni.transcript(q, s.id);
  if (mods.quran) {
    const qd = await quran.forParent(q, s.id);
    if (qd.membership || qd.records.length || qd.achievements.length) out.quran = qd;
  }
  if (mods.certificates) out.certificates = await certificates.forStudent(q, s.id);
  if (mods.online_exams && s.class_id) out.online_exams = await onlineExams.forStudent(q, s);
  if (mods.calendar) {
    const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 75 * 86400000).toISOString().slice(0, 10);
    out.calendar = await calendar.feed(q, { from, to }, { view: admin ? "admin" : "parent", classIds: s.class_id ? [Number(s.class_id)] : [0] });
  }
  if (mods.transport) { const tr = await services.transportOf(q, s.id); if (tr) out.transport = tr; }
  if (mods.library) { const l = await services.loansOf(q, s.id); if (l.length) out.library = l; }
  if (mods.clinic && (admin || (await featureSettings(q, "clinic")).show_parent_profile)) out.health = await services.healthOf(q, s.id);
  if (mods.surveys && !admin) { const sv = await engagement.availableFor(q, { student_id: s.id }); if (sv.length) out.surveys = sv; }
  if (mods.meetings && !admin && s.class_id) out.meetings = await engagement.slotsForStudent(q, s);
  return out;
}
