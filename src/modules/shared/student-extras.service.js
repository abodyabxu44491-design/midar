// بيانات الأقسام الجديدة في ملف الطالب: كل قسم يُضاف فقط إذا كان مفعّلًا (ومسموحًا لولي الأمر)
import { activeModules } from "./notify.service.js";
import { featureSettings } from "./feature-settings.service.js";
import * as behavior from "./behavior.service.js";
import * as certificates from "./certificates.service.js";
import * as onlineExams from "./online-exams.service.js";
import * as calendar from "./calendar.service.js";

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
  return out;
}
