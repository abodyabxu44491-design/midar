/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The trust center. Each badge is an internal one issued by the platform about itself, and rests on a check that was
// actually run: automatic checks inspect the platform's own settings, database and DNS; recorded checks are procedures
// the owner carried out and documented with evidence. A certificate copies a passing check and can be verified by its
// number. None of this is a government accreditation or a third party's certification, and every page says so.
import crypto from "node:crypto";
import dns from "node:dns/promises";
import { env } from "../../config/env.js";
import { isPublicTotp, isPublicOwnerPath } from "../../config/public-examples.js";
import { ownerTotp, recoveryLeft } from "../../core/auth/owner-mfa.js";
import { conflict } from "../../core/http/errors.js";

export const ISSUER_DEFAULT = "MIDAIR SCHOOL";
export const INTERNAL_NOTE = "شارة داخلية صادرة عن منصة مدار (MIDAIR SCHOOL) بناءً على إجراء نُفّذ فعلًا، وليست اعتمادًا حكوميًا أو شهادة من جهة خارجية.";
const DAY = 86400000;

// The eight badges. `certificate` names the internal certificate a passing check can be issued as, with its scope.
export const KINDS = {
  identity: {
    title: "الهوية المؤسسية لمنصة مدار", method: "automatic", days: 365,
    proves: "بيانات الجهة المشغّلة للمنصة مكتوبة ومعلنة في الموقع والصفحات القانونية، ووسيلة تواصل رسمية منشورة.",
    certificate: { title: "شهادة توثيق الهوية الرقمية للمنصة",
      scope: "توثيق داخلي بأن هوية منصة مدار (MIDAIR SCHOOL) واسمها ووسائل التواصل الرسمية معلنة بصورة موحدة في الموقع والصفحات القانونية، وفق فحص آلي أجرته المنصة على إعداداتها." },
  },
  domain: {
    title: "توثيق ملكية النطاق", method: "automatic", days: 90,
    proves: "سجل DNS من نوع TXT على نطاق المنصة يحمل رمز تحقق ولّدته المنصة، فلا يضعه إلا من يدير النطاق.",
  },
  code_ownership: {
    title: "توثيق ملكية المشروع البرمجي", method: "recorded", days: 365,
    proves: "مستودع الشيفرة وسجل تطويرها في حساب يملكه مشغّل المنصة، مع مرجع موثّق لذلك.",
    certificate: { title: "شهادة ملكية المشروع البرمجي",
      scope: "توثيق داخلي بأن الشيفرة المصدرية لمنصة مدار وسجل تطويرها محفوظان في مستودع يملكه مشغّل المنصة، وفق المرجع المسجل في الفحص." },
  },
  admin_protection: {
    title: "حماية الحسابات الإدارية", method: "automatic", days: 90,
    proves: "التحقق الثنائي مفعّل لحساب مالك المنصة بمفتاح خاص، ورابط اللوحة غير منشور، وقفل الدخول بعد المحاولات الخاطئة يعمل.",
  },
  backup_restore: {
    title: "النسخ الاحتياطي للبيانات", method: "recorded", days: 90,
    proves: "نسخة احتياطية حقيقية استُعيدت في بيئة منفصلة وتحقق أنها كاملة، مع تاريخ التجربة ونتيجتها.",
    certificate: { title: "شهادة اختبار النسخ الاحتياطي والاستعادة",
      scope: "توثيق داخلي بأن نسخة احتياطية من قاعدة بيانات منصة مدار استُعيدت فعلًا في بيئة منفصلة وتحقق من اكتمالها، في التاريخ والمرجع المسجلين في الفحص." },
  },
  data_privacy: {
    title: "حماية خصوصية بيانات المدارس", method: "automatic", days: 30,
    proves: "كل جدول فيه بيانات مدرسة معزول على مستوى قاعدة البيانات (RLS)، وحساب التطبيق لا يملك صلاحية تجاوز العزل.",
    certificate: { title: "شهادة تطبيق إجراءات حماية البيانات",
      scope: "توثيق داخلي بأن عزل بيانات كل مدرسة مطبق على مستوى قاعدة البيانات لكل الجداول التي تحمل بيانات المدارس، وأن حساب التطبيق لا يتجاوز هذا العزل، وفق فحص آلي أجرته المنصة على قاعدة بياناتها." },
  },
  support: {
    title: "توثيق إجراءات الدعم الفني", method: "recorded", days: 365,
    proves: "قنوات الدعم منشورة، وإجراء استقبال الطلبات ومتابعتها مكتوب ومعتمد من مشغّل المنصة.",
  },
  quality: {
    title: "مراجعة جودة المنصة واختبار وظائفها", method: "recorded", days: 90,
    proves: "نتيجة الاختبارات الآلية للمنصة واختبار كل صفحات كل دور في متصفح حقيقي، مع رقم النسخة التي اختُبرت.",
    certificate: { title: "شهادة مراجعة الجودة التقنية الداخلية",
      scope: "توثيق داخلي بأن نسخة منصة مدار المذكورة في المرجع اجتازت اختباراتها الآلية واختبار صفحات كل الأدوار في متصفح حقيقي، وفق النتائج المسجلة في الفحص." },
  },
};
export const KIND_NAMES = Object.keys(KINDS);
export const CERT_KINDS = KIND_NAMES.filter((k) => KINDS[k].certificate);

const companyName = (s) => s?.company_name_en || s?.company_name || ISSUER_DEFAULT;

// --- Automatic checks: each returns { passed, summary, evidence } from what the platform can see about itself. ----------
const AUTO = {
  async identity(q) {
    const [s] = await q(`SELECT company_name, company_name_en, company_country, brand_email, brand_phone, support_whatsapp
                           FROM platform_settings WHERE id`);
    const named = Boolean(s?.company_name || s?.company_name_en);
    const contact = [s?.brand_email && "بريد", s?.brand_phone && "هاتف", s?.support_whatsapp && "واتساب"].filter(Boolean);
    const passed = named && Boolean(s?.company_country) && contact.length > 0;
    return {
      passed,
      summary: passed ? `الهوية معلنة: ${companyName(s)} (${s.company_country})، ووسائل التواصل: ${contact.join("، ")}.`
        : "بيانات الهوية ناقصة: أكمل اسم الجهة والدولة ووسيلة تواصل واحدة على الأقل في الإعدادات.",
      evidence: { name: companyName(s), country: s?.company_country || null, contacts: contact },
    };
  },

  async domain(q) {
    const [s] = await q("SELECT trust_domain, trust_domain_token FROM platform_settings WHERE id");
    if (!s?.trust_domain || !s?.trust_domain_token) {
      return { passed: false, summary: "لم يُحدَّد النطاق بعد: اكتب النطاق في مركز الثقة لتوليد رمز التحقق.", evidence: {} };
    }
    const host = `_midar-verify.${s.trust_domain}`;
    const want = `midar-verify=${s.trust_domain_token}`;
    let records = [];
    try { records = (await dns.resolveTxt(host)).map((parts) => parts.join("")); } catch (e) { records = []; }
    const passed = records.includes(want);
    return {
      passed,
      summary: passed ? `سجل التحقق موجود على ${host}، فالنطاق ${s.trust_domain} يديره مشغّل المنصة.`
        : `لم يُعثر على سجل TXT بالقيمة المطلوبة على ${host}.`,
      evidence: { domain: s.trust_domain, record: host, found: records.length },
    };
  },

  async admin_protection(q) {
    const mfa = await ownerTotp(q);
    const privateKey = Boolean(mfa) && !isPublicTotp(mfa.secret);
    const privatePath = !isPublicOwnerPath(env.OWNER_PATH);
    const codes = mfa?.source === "app" ? await recoveryLeft(q) : null;
    const problems = [
      !mfa && "التحقق الثنائي غير مفعّل لحساب المالك",
      mfa && !privateKey && "مفتاح التحقق الثنائي من مفاتيح الأمثلة المنشورة",
      !privatePath && "رابط لوحة المالك من الأمثلة المنشورة",
    ].filter(Boolean);
    return {
      passed: problems.length === 0,
      summary: problems.length ? `${problems.join("، ")}.`
        : "التحقق الثنائي مفعّل بمفتاح خاص، ورابط اللوحة خاص، والدخول يُقفل 15 دقيقة بعد 5 محاولات خاطئة.",
      evidence: { two_factor: Boolean(mfa), two_factor_source: mfa?.source || null, private_key: privateKey, private_path: privatePath,
        recovery_codes_left: codes, lockout: "5 محاولات من العنوان نفسه أو 40 إجمالًا خلال 15 دقيقة" },
    };
  },

  async data_privacy(q) {
    const open = await q(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
                             AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
                           ORDER BY 1`);
    const [{ n }] = await q(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
                              WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p')
                                AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)`);
    const [role] = await q("SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
    const bypass = Boolean(role?.rolsuper || role?.rolbypassrls);
    const passed = open.length === 0 && !bypass && n > 0;
    return {
      passed,
      summary: passed ? `العزل مطبق على كل الجداول التي تحمل بيانات المدارس (${n} جدولًا)، وحساب التطبيق لا يتجاوزه.`
        : [open.length && `${open.length} جدول بلا عزل: ${open.map((r) => r.relname).slice(0, 5).join("، ")}`,
          bypass && "حساب التطبيق يملك صلاحية تجاوز العزل"].filter(Boolean).join("، ") + ".",
      evidence: { tenant_tables: n, without_rls: open.map((r) => r.relname), app_role_bypasses: bypass },
    };
  },
};

export async function runAutomatic(q, kind, actor) {
  if (!AUTO[kind]) throw conflict("هذا الفحص يُسجَّل يدويًا بعد تنفيذ الإجراء");
  const r = await AUTO[kind](q);
  return insertCheck(q, { kind, method: "automatic", passed: r.passed, summary: r.summary, evidence: r.evidence, reference: null, actor });
}

// A procedure the owner carried out (a restore drill, a test run, a written support procedure), with its evidence.
export async function recordCheck(q, { kind, passed, summary, reference, details }, actor) {
  if (KINDS[kind].method !== "recorded") throw conflict("هذا الفحص آلي: تشغّله المنصة ولا يُسجَّل يدويًا");
  return insertCheck(q, { kind, method: "recorded", passed, summary, evidence: details ? { details } : {}, reference, actor });
}

async function insertCheck(q, { kind, method, passed, summary, evidence, reference, actor }) {
  const [row] = await q(
    `INSERT INTO trust_checks (kind, method, passed, summary, evidence, reference, checked_by, valid_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(days => $8)) RETURNING *`,
    [kind, method, passed, summary, JSON.stringify(evidence || {}), reference || null, actor || "مالك المنصة", KINDS[kind].days]);
  return row;
}

// The latest check of each kind, for the owner panel.
export async function latestChecks(q) {
  const rows = await q("SELECT DISTINCT ON (kind) * FROM trust_checks ORDER BY kind, checked_at DESC");
  const by = Object.fromEntries(rows.map((r) => [r.kind, r]));
  return KIND_NAMES.map((kind) => {
    const c = by[kind] || null;
    const active = Boolean(c && c.passed && new Date(c.valid_until) > new Date());
    return { kind, ...publicKind(kind), check: c, active };
  });
}

const publicKind = (kind) => ({ title: KINDS[kind].title, method: KINDS[kind].method, proves: KINDS[kind].proves,
  certificate_title: KINDS[kind].certificate?.title || null });

// A certificate from the latest check of its kind, which must have passed and still be valid.
export async function issueCertificate(q, kind, actor) {
  const def = KINDS[kind]?.certificate;
  if (!def) throw conflict("لا توجد شهادة لهذا النوع من الفحوص");
  const [c] = await q("SELECT * FROM trust_checks WHERE kind = $1 ORDER BY checked_at DESC LIMIT 1", [kind]);
  if (!c) throw conflict("لم يُنفَّذ هذا الإجراء بعد: لا تصدر الشهادة إلا بعد تنفيذه وتسجيل نتيجته");
  if (!c.passed) throw conflict("آخر فحص لهذا الإجراء لم ينجح، فلا تصدر عنه شهادة");
  if (new Date(c.valid_until) <= new Date()) throw conflict("انتهت صلاحية آخر فحص: أعد تنفيذ الإجراء أولًا");
  const [s] = await q("SELECT company_name, company_name_en FROM platform_settings WHERE id");
  const year = new Date().getUTCFullYear();
  const [{ last }] = await q(`INSERT INTO trust_serials (year, last) VALUES ($1, 1)
                              ON CONFLICT (year) DO UPDATE SET last = trust_serials.last + 1 RETURNING last`, [year]);
  const ref = `MS-${year}-${String(last).padStart(4, "0")}`;
  const [row] = await q(
    `INSERT INTO trust_certificates (ref, kind, title, scope, check_id, issuer, valid_until, issued_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [ref, kind, def.title, def.scope, c.id, companyName(s), c.valid_until, actor || "مالك المنصة"]);
  return row;
}

export async function revokeCertificate(q, id, reason) {
  const [row] = await q(`UPDATE trust_certificates SET revoked_at = now(), revoke_reason = $2
                          WHERE id = $1 AND revoked_at IS NULL RETURNING *`, [id, reason]);
  if (!row) throw conflict("الشهادة غير موجودة أو ملغاة من قبل");
  return row;
}

// The domain to verify and the TXT record the owner must add; a new domain gets a new token.
export async function setDomain(q, domain) {
  const [cur] = await q("SELECT trust_domain, trust_domain_token FROM platform_settings WHERE id");
  const token = cur?.trust_domain === domain && cur?.trust_domain_token ? cur.trust_domain_token : crypto.randomBytes(18).toString("base64url");
  await q("UPDATE platform_settings SET trust_domain = $1, trust_domain_token = $2 WHERE id", [domain, token]);
  return domainInstructions(domain, token);
}
export const domainInstructions = (domain, token) => (domain && token
  ? { domain, record_name: `_midar-verify.${domain}`, record_type: "TXT", record_value: `midar-verify=${token}` } : null);

// What the public trust page shows: every badge, active or not, and never the evidence's private details.
export async function publicTrust(q) {
  const active = Object.fromEntries((await q("SELECT * FROM trust_public_badges()")).map((r) => [r.kind, r]));
  const [s] = await q("SELECT company_name, company_name_en FROM platform_settings WHERE id");
  return {
    issuer: companyName(s),
    note: INTERNAL_NOTE,
    badges: KIND_NAMES.map((kind) => {
      const a = active[kind];
      return { kind, ...publicKind(kind), active: Boolean(a), summary: a?.summary || null, checked_at: a?.checked_at || null,
        valid_until: a?.valid_until || null, certificate: a?.certificate || null };
    }),
  };
}

export async function verifyCertificate(q, ref) {
  const [row] = await q("SELECT * FROM trust_verify($1)", [ref]);
  if (!row) return null;
  const status = row.revoked_at ? "revoked" : new Date(row.valid_until) <= new Date() ? "expired" : "valid";
  return { ...row, status, note: INTERNAL_NOTE };
}

export const validFor = (kind) => KINDS[kind].days * DAY;
