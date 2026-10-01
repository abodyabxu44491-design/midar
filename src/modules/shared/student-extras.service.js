// بيانات الأقسام الجديدة في ملف الطالب: كل قسم يُضاف فقط إذا كان مفعّلًا (ومسموحًا لولي الأمر)
import { activeModules } from "./notify.service.js";
import { featureSettings } from "./feature-settings.service.js";
import * as behavior from "./behavior.service.js";
import * as certificates from "./certificates.service.js";
import * as onlineExams from "./online-exams.service.js";
import * as calendar from "./calendar.service.js";
import * as services from "./services.service.js";
import * as engagement from "./engagement.service.js";

export async function studentExtras(q, s, { admin = false } = {}) {
  const mods = await activeModules(q);
  const out = {};
  if (mods.behavior && (admin || (await featureSettings(q, "behavior")).show_parent)) {
    out.behavior = await behavior.forStudent(q, s.id);
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
