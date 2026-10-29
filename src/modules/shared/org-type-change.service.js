/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { transaction } from "../../core/db/pool.js";
import { badRequest, notFound } from "../../core/http/errors.js";
import { ENGINES, LIVE_ENGINES, TERM_KEYS } from "./org-types.service.js";
import { MODULES, getModules, setAllModules, typeModules } from "./modules.service.js";
import { addEvent } from "./school-files.service.js";

// Changing an institution's type never deletes anything. Between engines (school and institute) the data of the engine it
// leaves stays in place, hidden, and comes back if the institution is moved back. The owner sees all of this before applying.
const ENGINE_DATA = {
  school: [["stages", "المراحل"], ["grades", "الصفوف"], ["classes", "الشعب"], ["subjects", "المواد"], ["timetable_slots", "حصص الجدول"],
    ["exams", "الاختبارات"], ["assignments", "الواجبات"], ["attendance", "سجلات الحضور اليومي"]],
  institute: [["programs", "البرامج"], ["courses", "الدورات"], ["course_groups", "المجموعات"], ["enrollments", "التسجيلات"],
    ["training_sessions", "الجلسات"], ["assessments", "التقييمات"]],
};
const NAME = Object.fromEntries(MODULES.map((m) => [m.key, m.name]));

const inSchool = (ctx, id, fn) => transaction({ tenantId: id, actor: ctx.actor, ip: ctx.ip }, fn);

async function load(id, toKey) {
  return transaction({ platform: true }, async (q) => {
    const [cur] = await q(`SELECT t.id, t.name, t.org_type, t.org_type_key, o.name AS type_name, o.terms
                             FROM tenants t JOIN org_types o ON o.key = t.org_type_key WHERE t.id = $1`, [id]);
    if (!cur) throw notFound("المؤسسة غير موجودة");
    const [to] = await q("SELECT key, name, engine, status, terms, default_features FROM org_types WHERE key = $1", [toKey]);
    if (!to) throw notFound("النوع غير موجود");
    return { cur, to };
  });
}

export async function impactOf(ctx, id, toKey, { applySections = false } = {}) {
  const { cur, to } = await load(id, toKey);
  const blockers = [];
  if (to.status === "disabled") blockers.push(`نوع «${to.name}» موقوف`);
  if (!LIVE_ENGINES.includes(to.engine)) blockers.push(`المحرك ${ENGINES[to.engine]} قيد التطوير، ولا تُنقل إليه مؤسسة بعد`);
  const engineChange = to.engine !== cur.org_type;
  const data = await inSchool(ctx, id, async (q) => {
    const count = async (list) => {
      const out = [];
      for (const [table, label] of list) out.push({ label, count: (await q(`SELECT count(*)::int AS n FROM ${table}`))[0].n });
      return out.filter((x) => x.count);
    };
    const [{ students, teachers }] = await q(`SELECT (SELECT count(*)::int FROM students) AS students, (SELECT count(*)::int FROM teachers) AS teachers`);
    const [profile] = await q("SELECT setup_completed_at FROM school_profile WHERE tenant_id = app_tenant()");
    return {
      hidden: engineChange && LIVE_ENGINES.includes(to.engine) ? await count(ENGINE_DATA[cur.org_type] || []) : [],
      returning: engineChange && ENGINE_DATA[to.engine] ? await count(ENGINE_DATA[to.engine]) : [],
      students, teachers, setupDone: Boolean(profile?.setup_completed_at), modules: await getModules(q),
    };
  });
  const next = typeModules(to.default_features);
  const sections = applySections ? {
    turn_on: MODULES.filter((m) => next[m.key] && !data.modules[m.key]).map((m) => NAME[m.key]),
    turn_off: MODULES.filter((m) => !next[m.key] && data.modules[m.key]).map((m) => NAME[m.key]),
  } : null;
  const word = (o, k) => o?.[k] || TERM_KEYS[k];
  const terms = Object.keys(TERM_KEYS).filter((k) => word(cur.terms, k) !== word(to.terms, k))
    .map((k) => ({ from: word(cur.terms, k), to: word(to.terms, k) }));
  const notes = [];
  if (engineChange) {
    notes.push(`تتغير طريقة التنظيم من ${ENGINES[cur.org_type]} إلى ${ENGINES[to.engine]}: تتغير لوحة الإدارة وتبويباتها عند الدخول التالي.`);
    notes.push(`سجلات الطلاب أو المتدربين (${data.students}) والمعلمين أو المدربين (${data.teachers}) تبقى كما هي في الطريقتين.`);
    if (to.engine === "school" && !data.setupDone) notes.push("سيظهر للمدير معالج إعداد المدرسة (المراحل والصفوف) في أول دخول.");
  }
  return {
    from: { key: cur.org_type_key, name: cur.type_name, engine: cur.org_type, engine_name: ENGINES[cur.org_type] },
    to: { key: to.key, name: to.name, engine: to.engine, engine_name: ENGINES[to.engine] },
    same: to.key === cur.org_type_key, engine_change: engineChange, blockers, hidden: data.hidden, returning: data.returning,
    sections, terms, notes, deleted: 0,
  };
}

export async function applyChange(ctx, id, b) {
  const impact = await impactOf(ctx, id, b.org_type_key, { applySections: b.apply_sections });
  if (impact.same) return { ok: true, changed: false, impact };
  if (impact.blockers.length) throw badRequest(impact.blockers.join("، "));
  if (impact.engine_change && b.confirm !== id) throw badRequest("تغيير طريقة التنظيم يحتاج تأكيدًا: اكتب رمز المؤسسة كما هو");
  await inSchool(ctx, id, async (q) => {
    await q("UPDATE tenants SET org_type = $2, org_type_key = $3 WHERE id = $1", [id, impact.to.engine, impact.to.key]);
    if (impact.to.engine === "institute") await q("INSERT INTO institute_settings (tenant_id) VALUES (app_tenant()) ON CONFLICT DO NOTHING");
    // The school kind its profile records follows the new type (a Quran school, a public school...).
    const [type] = await q("SELECT engine, settings FROM org_types WHERE key = $1", [impact.to.key]);
    if (type.engine === "school" && type.settings?.school_type) {
      await q(`INSERT INTO school_profile (tenant_id, school_type) VALUES (app_tenant(), $1)
               ON CONFLICT (tenant_id) DO UPDATE SET school_type = EXCLUDED.school_type`, [type.settings.school_type]);
    }
    if (b.apply_sections) {
      const [to] = await q("SELECT default_features FROM org_types WHERE key = $1", [impact.to.key]);
      await setAllModules(q, typeModules(to.default_features));
    }
  });
  await transaction({ platform: true, actor: ctx.actor, ip: ctx.ip }, async (q) => {
    await q(`INSERT INTO org_type_changes (tenant, from_key, to_key, from_engine, to_engine, reason, impact, actor)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, impact.from.key, impact.to.key, impact.from.engine, impact.to.engine, b.reason ?? null,
       { hidden: impact.hidden, sections: impact.sections, terms: impact.terms }, ctx.actor]);
    await addEvent(q, id, { kind: "account", body: `تغيّر نوع المؤسسة من «${impact.from.name}» إلى «${impact.to.name}»`
      + `${impact.engine_change ? ` (من ${impact.from.engine_name} إلى ${impact.to.engine_name})` : ""}${b.reason ? `: ${b.reason}` : ""}` }, ctx.actor);
  });
  return { ok: true, changed: true, from: impact.from.key, to: impact.to.key, impact };
}

export async function changesOf(id) {
  return transaction({ platform: true }, (q) => q("SELECT * FROM org_type_changes WHERE tenant = $1 ORDER BY id DESC LIMIT 50", [id]));
}
