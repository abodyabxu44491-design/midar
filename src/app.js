/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import express from "express";
import { probeWatch } from "./core/http/probe-watch.js";
import compression from "compression";
import { staticRoutes, sendPage, renderPage, serviceWorker } from "./core/web.js";
import { ownerManifest, schoolManifest, withManifest, appKind } from "./core/manifest.js";
import { APP_VERSION, APP_RELEASE, BUILD_HASH, STARTED_AT } from "./core/version.js";
import { perfMiddleware } from "./core/perf.js";
import { siteData } from "./modules/shared/plans-public.service.js";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import { securityHeaders, noIndex, sameOrigin, noStore, INDEXABLE } from "./core/http/security.js";
import { errorHandler, notFound } from "./core/http/errors.js";
import { limits } from "./core/rate-limit.js";
import { ownerNetwork } from "./core/auth/guards.js";
import { healthCheck, transaction } from "./core/db/pool.js";
import { handle } from "./core/http/errors.js";
import { isSchoolCode } from "./core/reserved.js";
import { baseUrl } from "./core/links.js";
import { SEO_PAGES, renderSeoPage, homeLd, ldScripts } from "./core/seo-pages.js";
import ownerApi from "./modules/owner/index.js";
import groupApi from "./modules/group/index.js";
import adminApi from "./modules/school-admin/index.js";
import teacherApi from "./modules/teacher/index.js";
import accountantApi from "./modules/accountant/index.js";
import publicApi from "./modules/public/index.js";
import gateApi from "./modules/gate/index.js";
import { accountRouter, appleCallback } from "./modules/account/routes.js";
import { markActive } from "./core/activity.js";
import { staffLoginRouter } from "./modules/shared/staff-auth.js";

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const pages = path.join(WEB, "pages");

export function createApp() {
  const app = express();
  app.set("trust proxy", env.TRUST_PROXY);
  app.disable("x-powered-by");
  app.use(perfMiddleware, securityHeaders, noIndex);
  app.use(compression({ threshold: 1024 }));
  const canonical = env.PUBLIC_URL ? new URL(env.PUBLIC_URL) : null;
  app.use((req, res, next) => {
    if (!canonical || !(req.method === "GET" || req.method === "HEAD") || !INDEXABLE.has(req.path)) return next();
    const host = req.hostname;
    if (host === canonical.hostname || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return next();
    res.redirect(301, `${canonical.origin}${req.originalUrl}`);
  });

  app.get("/healthz", (req, res) => res.json({ ok: true }));
  // Real use of the platform (not health checks) keeps the background work running at full pace.
  app.use("/api", (req, res, next) => { markActive(); next(); });

  app.get("/healthz/db", limits.health, async (req, res) => {
    try { await healthCheck(); res.json({ ok: true, db: true }); }
    catch { res.status(503).json({ ok: false, db: false }); }
  });

  app.get("/api/version", (req, res) => res.set("Cache-Control", "no-store").json({ version: APP_VERSION, release: APP_RELEASE, build: BUILD_HASH, started_at: STARTED_AT }));
  app.get("/api/analytics-config", (req, res) => res.set("Cache-Control", "public, max-age=3600").json({ analytics: env.FIREBASE_ANALYTICS || null }));
  app.get("/api/site", limits.site, handle(async (req, res) => {
    const s = await siteData();
    res.set("Cache-Control", "no-store").json({ analytics: env.FIREBASE_ANALYTICS, ...s });
  }));
  const api = express.Router();
  const smallJson = express.json({ limit: "512kb" });
  const uploadJson = express.json({ limit: "4mb" });
  // Sound and video for exam questions (up to 10 MB), and a student's photo or voice answer (up to 5 MB), as base64.
  const mediaJson = express.json({ limit: "15mb" });
  const isMediaUpload = (req) => req.method === "POST" && (/^\/(admin|teacher)\/papers\/media$/.test(req.path)
    || /^\/public\/[^/]+\/student\/online-exams\/\d+\/answer-file$/.test(req.path));
  const isUpload = (req) => (req.method === "POST" && (
      /^\/(admin|accountant)\/ledger\/entries\/\d+\/attachments$/.test(req.path)
      || /^\/(admin|teacher)\/papers\/images$/.test(req.path)
      || req.path === "/admin/papers-settings/logo"
      || req.path === "/admin/setup/logo"
      || /^\/admin\/(certificates|institute)\/designs\/assets$/.test(req.path)
      || /^\/admin\/students\/\d+\/photo$/.test(req.path)
      || /^\/admin\/services\/library\/books\/\d+\/cover$/.test(req.path)
      || /^\/admin\/teachers\/\d+\/photo$/.test(req.path)
      || /^\/(admin|teacher)\/papers\/import$/.test(req.path)))
    || (req.method === "PUT" && /^\/(admin|teacher)\/papers\/\d+$/.test(req.path));
  app.post("/api/account/oauth/apple/callback", limits.login, express.urlencoded({ extended: false, limit: "16kb" }), cookieParser(), noStore, appleCallback);
  api.use((req, res, next) => { res.set("X-App-Version", APP_VERSION); next(); });
  api.use(limits.api, noStore, (req, res, next) => (isMediaUpload(req) ? mediaJson : isUpload(req) ? uploadJson : smallJson)(req, res, next), cookieParser(), sameOrigin);
  api.use(probeWatch);
  api.use("/owner", ownerApi);
  api.use("/admin", adminApi);
  api.use("/teacher", teacherApi);
  api.use("/accountant", accountantApi);
  api.use("/public", publicApi);
  api.use("/gate", gateApi);
  api.use("/group", groupApi);
  api.use("/staff", staffLoginRouter());
  api.use("/account", accountRouter());
  api.use((req, res, next) => next(notFound("المسار غير موجود")));
  app.use("/api", api);

  staticRoutes(app, { isProd: env.isProd });
  app.get("/favicon.ico", (req, res) => res.set("Cache-Control", "public, max-age=86400").sendFile(path.join(WEB, "brand", "favicon.ico")));
  app.get("/sw.js", serviceWorker());

  const file = (...p) => path.join(pages, ...p);
  const send = (...p) => sendPage(file(...p), { isProd: env.isProd });

  app.get(`${env.OWNER_PATH}/app.webmanifest`, ownerNetwork, ownerManifest(env.OWNER_PATH));
  app.use(env.OWNER_PATH, ownerNetwork, express.static(file("owner"), { index: "index.html", redirect: true }));
  app.get("/reset", send("reset", "index.html"));
  app.get("/group", send("group", "index.html"));
  app.get("/activate", send("activate", "index.html"));
  app.get("/account", send("activate", "index.html"));
  app.get("/reset/", send("reset", "index.html"));
  const withOrigin = (...p) => (req, res) => res.set("Cache-Control", "no-cache").type("html")
    .send(renderPage(file(...p), { isProd: env.isProd }).replaceAll("__ORIGIN__", baseUrl(req)));
  const seoLinks = JSON.stringify(SEO_PAGES.map((p) => [p.slug, p.nav])).replace(/</g, "\\u003c");
  app.get("/", handle(async (req, res) => {
    let site = {};
    try { site = await siteData(); } catch { /* ignore */ }
    res.set("Cache-Control", "no-cache").type("html").send(renderPage(file("home", "index.html"), { isProd: env.isProd })
      .replaceAll("__ORIGIN__", baseUrl(req))
      .replace("<!--LD-->", `${ldScripts(homeLd(baseUrl(req), site))}\n  <script type="application/json" id="seo-links">${seoLinks}</script>`));
  }));
  for (const page of SEO_PAGES) {
    app.get(`/${page.slug}`, (req, res) => res.set("Cache-Control", "no-cache").type("html").send(renderSeoPage(page, baseUrl(req))));
  }
  app.get("/privacy", withOrigin("legal", "privacy.html"));
  app.get("/terms", withOrigin("legal", "terms.html"));
  app.get("/subscription-policy", withOrigin("legal", "subscription.html"));
  app.get("/robots.txt", (req, res) => res.set("Cache-Control", "public, max-age=3600").type("text/plain").send([
    "User-agent: *", "Allow: /$", "Allow: /privacy", "Allow: /terms", "Allow: /subscription-policy", "Allow: /brand/", "Allow: /v/", "Allow: /shared/",
    "Allow: /home-page/", "Allow: /legal-page/", "Allow: /api/site", ...SEO_PAGES.map((p) => `Allow: /${p.slug}$`),
    "Disallow: /", "", `Sitemap: ${baseUrl(req)}/sitemap.xml`, ""].join("\n")));
  app.get("/sitemap.xml", (req, res) => res.set("Cache-Control", "public, max-age=3600").type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
      [["/", "1.0"], ...SEO_PAGES.map((p) => [`/${p.slug}`, "0.8"]), ["/privacy", "0.3"], ["/terms", "0.3"], ["/subscription-policy", "0.3"]]
        .map(([u, p]) => `  <url><loc>${baseUrl(req)}${u}</loc><lastmod>${STARTED_AT.slice(0, 10)}</lastmod><priority>${p}</priority></url>`).join("\n")
    }\n</urlset>\n`));
  app.get("/.well-known/assetlinks.json", (req, res) => res.set("Cache-Control", "public, max-age=3600").json(
    env.ANDROID_PACKAGE && env.ANDROID_SHA256.length ? [{ relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: env.ANDROID_PACKAGE, sha256_cert_fingerprints: env.ANDROID_SHA256 } }] : []));
  app.get("/verify/:code", send("verify", "index.html"));
  app.get("/q/:school/:token", send("gate", "card.html"));

  const school = (handler) => (req, res, next) =>
    (isSchoolCode(req.params.school) ? handler(req, res) : next());
  const appPage = (as, ...p) => (req, res) => res.set("Cache-Control", "no-cache").type("html").send(withManifest(
    renderPage(file(...p), { isProd: env.isProd }), `/${req.params.school.toLowerCase()}/app.webmanifest?as=${as(req)}`));
  const staffAs = (req) => { const r = appKind(String(req.query.role || "")); return r === "parent" || r === "gate" ? "staff" : r; };
  app.get("/:school/app.webmanifest", school(schoolManifest()));
  app.get("/:school", school(appPage(() => "parent", "school", "index.html")));
  app.get("/:school/student", school(appPage(() => "parent", "school", "student.html")));
  app.get("/:school/idara", school(appPage(staffAs, "staff", "index.html")));
  app.get("/:school/gate", school(appPage(() => "gate", "gate", "index.html")));

  app.use((req, res) => res.status(404).sendFile(path.join(pages, "404.html")));
  app.use(errorHandler);
  return app;
}
