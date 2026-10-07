// تثبيت مدار كتطبيق حسب صاحبه: كل دور يثبّت تطبيقًا مستقلًا يفتح مباشرة على لوحته.
//   المالك ← لوحة المالك، المدير ← الإدارة، المعلم ← بوابة المعلم، المحاسب ← المحاسب،
//   ولي الأمر والزائر ← صفحة المدرسة العامة.
// لكل تطبيق معرّف (id) مختلف، فيمكن تثبيت أكثر من تطبيق على الجهاز نفسه (مثلًا معلم هو ولي أمر أيضًا).
import fs from "node:fs";
import path from "node:path";
import { PUBLIC_DIR } from "./version.js";
import { transaction } from "./db/pool.js";

const BASE = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "brand", "site.webmanifest"), "utf8"));
const COMMON = {
  lang: BASE.lang, dir: BASE.dir, display: "standalone", display_override: ["standalone", "minimal-ui"], orientation: "any",
  background_color: BASE.background_color, theme_color: BASE.theme_color, categories: BASE.categories,
  prefer_related_applications: false, icons: BASE.icons,
};

export const STAFF_ROLES = { admin: "الإدارة", teacher: "المعلم", accountant: "المحاسب" };
// نوع التطبيق من الطلب: as=admin|teacher|accountant|staff|parent
export const appKind = (v) => (v in STAFF_ROLES || v === "staff" || v === "parent" || v === "gate" ? v : "parent");

async function schoolName(id) {
  try {
    const [t] = await transaction({ platform: true }, (q) => q("SELECT name FROM tenants WHERE id = $1 AND status = 'active'", [id]));
    return t?.name || null;
  } catch { return null; }
}

export function manifestFor(kind, { school, name, ownerPath } = {}) {
  if (kind === "owner") {
    const root = `${ownerPath}/`;
    return { ...COMMON, id: root, start_url: root, scope: root, name: "مدار — لوحة المالك", short_name: "مالك مدار",
      description: "إدارة المدارس والاشتراكات والباقات على منصة مدار." };
  }
  const label = name || "مدار";
  if (kind === "gate") {
    const start = `/${school}/gate`;
    return { ...COMMON, id: start, start_url: start, scope: start, orientation: "portrait",
      name: `بوابة الحضور — ${label}`, short_name: "بوابة مدار", description: `جهاز بوابة الحضور في ${label}.` };
  }
  if (kind in STAFF_ROLES || kind === "staff") {
    const start = kind === "staff" ? `/${school}/idara` : `/${school}/idara?role=${kind}`;
    return { ...COMMON, id: start, start_url: start, scope: `/${school}/idara`,
      name: kind === "staff" ? `دخول منسوبي ${label}` : `${STAFF_ROLES[kind]} — ${label}`,
      short_name: kind === "staff" ? "مدار" : `مدار ${STAFF_ROLES[kind]}`,
      description: `${kind === "staff" ? "دخول منسوبي" : STAFF_ROLES[kind]} ${label} على منصة مدار.` };
  }
  const root = `/${school}`;
  return { ...COMMON, id: root, start_url: root, scope: root, name: label, short_name: label.length > 14 ? "مدار" : label,
    description: `صفحة ${label} للطلاب وأولياء الأمور على منصة مدار.` };
}

const send = (res, body) => res.set({ "Cache-Control": "no-cache", "Content-Type": "application/manifest+json; charset=utf-8" }).send(JSON.stringify(body));

export const ownerManifest = (ownerPath) => (req, res) => send(res, manifestFor("owner", { ownerPath }));

export const schoolManifest = () => async (req, res) => {
  const school = String(req.params.school).toLowerCase();
  send(res, manifestFor(appKind(String(req.query.as || "")), { school, name: await schoolName(school) }));
};

// صفحة HTML تشير لملف التطبيق المناسب لها (بدل ملف المنصة العام)
export const withManifest = (html, href) => html
  .replace('href="/brand/site.webmanifest"', `href="${href}"`)
  .replace(/\s*<meta name="apple-mobile-web-app-title" content="[^"]*">/, "");
