/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { badRequest } from "../../core/http/errors.js";
import { z } from "../../core/http/validate.js";

// Institution types: one platform, many kinds of institution. A type picks an engine (how learning is organised)
// and carries its own terms, default sections and settings; the owner manages the list.
export const ENGINES = { school: "مدرسي", institute: "تدريبي", university: "جامعي" };
export const STATUSES = { available: "متاح", beta: "تجريبي", planned: "قيد التطوير", disabled: "موقوف" };
// Engines an institution can be created on (by the owner), and engines that may be offered to the public. The university
// engine runs for the owner's trials only until it is complete: its types cannot be made available or beta.
export const LIVE_ENGINES = ["school", "institute", "university"];
export const PUBLIC_ENGINES = ["school", "institute"];
export const PUBLIC_STATUSES = ["available", "beta"];
// The one place that decides which engine an institution runs on (its tenants row, as loaded with the session).
export const engineOf = (tenant) => (ENGINES[tenant?.org_type] ? tenant.org_type : "school");
export const isUniversity = (tenant) => engineOf(tenant) === "university";
export const isInstitute = (tenant) => engineOf(tenant) === "institute";
export const typeKey = z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, "نوع المؤسسة غير صحيح");

// The words a type (and then each institution) may rename. Screens adopt them gradually; a missing one keeps the platform's word.
export const TERM_KEYS = {
  org: "المدرسة", student: "طالب", students: "الطلاب", teacher: "معلم", teachers: "المعلمون", class: "شعبة", classes: "الشعب",
  grade: "صف", grades: "الصفوف", subject: "مادة", subjects: "المواد", guardian: "ولي الأمر", guardians: "أولياء الأمور",
  course: "دورة", courses: "الدورات", program: "برنامج تدريبي", programs: "البرامج التدريبية", group: "مجموعة", groups: "المجموعات",
  session: "جلسة", sessions: "الجلسات",
};
// The words each engine uses; the owner's editor and the institution's settings show only these.
export const ENGINE_TERMS = {
  school: ["student", "students", "teacher", "teachers", "class", "classes", "grade", "grades", "subject", "subjects", "guardian", "guardians"],
  institute: ["org", "student", "students", "teacher", "teachers", "course", "courses", "program", "programs", "group", "groups", "session", "sessions"],
};
ENGINE_TERMS.university = ["org", "student", "students", "teacher", "teachers", "course", "courses", "program", "programs"];
// What an institute calls things when neither its type nor the institute changed them.
const ENGINE_DEFAULTS = {
  institute: { org: "المعهد", student: "متدرب", students: "المتدربون", teacher: "مدرب", teachers: "المدربون" },
  university: { org: "الجامعة", teacher: "عضو هيئة التدريس", teachers: "هيئة التدريس", course: "مقرر", courses: "المقررات", program: "برنامج", programs: "البرامج" },
};
export const engineDefaults = (engine) => ({ ...TERM_KEYS, ...(ENGINE_DEFAULTS[engine] || {}) });
// The institute screens name trainees and trainers with their own keys; the general words map onto them.
export const INSTITUTE_KEY = { student: "trainee", students: "trainees", teacher: "trainer", teachers: "trainers" };
const GENERAL_KEY = Object.fromEntries(Object.entries(INSTITUTE_KEY).map(([g, i]) => [i, g]));
export const toGeneral = (terms) => Object.fromEntries(Object.entries(terms || {}).map(([k, v]) => [GENERAL_KEY[k] || k, v]));
export const toInstitute = (terms) => Object.fromEntries(Object.entries(terms || {}).map(([k, v]) => [INSTITUTE_KEY[k] || k, v]));
export const termsSchema = z.partialRecord(z.enum(Object.keys(TERM_KEYS)), z.string().trim().max(40)).optional()
  .transform((v) => v && Object.fromEntries(Object.entries(v).filter(([, x]) => x)));

const pick = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => TERM_KEYS[k] && typeof v === "string" && v));
// An institution's words: the platform's (for its engine), then its type's, then its own changes; an institute's own
// settings page is one more layer on top. Read inside the institution's scope.
export async function termsLayers(q) {
  const [row] = await q(`SELECT t.org_type AS engine, o.terms AS type_terms, tt.terms AS own, i.terms AS institute
                           FROM tenants t JOIN org_types o ON o.key = t.org_type_key LEFT JOIN tenant_terms tt ON tt.tenant_id = t.id
                           LEFT JOIN institute_settings i ON i.tenant_id = t.id WHERE t.id = app_tenant()`);
  const engine = row?.engine || "school";
  const base = { ...engineDefaults(engine), ...pick(row?.type_terms), ...pick(row?.own) };
  return { engine, base, terms: engine === "institute" ? { ...base, ...pick(toGeneral(row?.institute)) } : base };
}
export const termsOf = async (q) => (await termsLayers(q)).terms;

// The request form used fixed values before the types list; those requests still read correctly.
const LEGACY = { private: "private_school", public: "public_school", international: "international_school", institute: "training_institute", other: "other" };
export const fromLegacy = (v) => (v ? LEGACY[v] || v : null);

export async function publicTypes(q) {
  return q(`SELECT key, name, description, engine, status FROM org_types
             WHERE status = ANY($1) AND engine = ANY($2) ORDER BY sort, key`, [PUBLIC_STATUSES, PUBLIC_ENGINES]);
}

export async function allTypes(q) {
  return q("SELECT key, name, engine, status FROM org_types ORDER BY sort, key");
}

// The type a new institution gets: the one asked for, or the base type of its engine. Only types on an engine the
// platform runs today, and not switched off, can be used.
export async function resolveType(q, key, orgType) {
  const k = key || (orgType === "institute" ? "training_institute" : "private_school");
  const [t] = await q("SELECT key, name, engine, status, terms FROM org_types WHERE key = $1", [k]);
  if (!t) throw badRequest("نوع المؤسسة غير موجود");
  if (t.status === "disabled") throw badRequest(`نوع «${t.name}» موقوف حاليًا`);
  if (!LIVE_ENGINES.includes(t.engine)) throw badRequest(`نوع «${t.name}» قيد التطوير ولا يمكن إنشاء مؤسسة منه بعد`);
  if (orgType && orgType !== t.engine) throw badRequest("نوع المؤسسة لا يناسب طريقة التنظيم المختارة");
  return t;
}
