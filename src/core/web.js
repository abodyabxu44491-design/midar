/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
//
//
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { APP_VERSION, PUBLIC_DIR } from "./version.js";

const PAGES = path.join(PUBLIC_DIR, "pages");
export const MOUNTS = {
  shared: path.join(PUBLIC_DIR, "shared"),
  admin: path.join(PAGES, "admin"),
  teacher: path.join(PAGES, "teacher"),
  accountant: path.join(PAGES, "accountant"),
  "school-page": path.join(PAGES, "school"),
  "staff-page": path.join(PAGES, "staff"),
  "home-page": path.join(PAGES, "home"),
  reset: path.join(PAGES, "reset"),
  "group-page": path.join(PAGES, "group"),
  verify: path.join(PAGES, "verify"),
  "legal-page": path.join(PAGES, "legal"),
  "gate-page": path.join(PAGES, "gate"),
};
const MOUNT_RE = new RegExp(`(src|href)="/(${Object.keys(MOUNTS).map((m) => m.replace("-", "\\-")).join("|")})/`, "g");

export function staticRoutes(app, { isProd }) {
  const immutable = { index: false, immutable: true, maxAge: "365d", fallthrough: true };
  const revalidate = { index: false, maxAge: 0, fallthrough: true };
  const current = express.Router();
  const stale = express.Router();
  for (const [mount, dir] of Object.entries(MOUNTS)) {
    current.use(`/${mount}`, express.static(dir, immutable));
    stale.use(`/${mount}`, express.static(dir, revalidate));
  }
  app.use("/v/:ver", (req, res, next) => (req.params.ver === APP_VERSION ? current : stale)(req, res, next));
  for (const [mount, dir] of Object.entries(MOUNTS)) app.use(`/${mount}`, express.static(dir, revalidate));
  app.use("/brand", express.static(path.join(PUBLIC_DIR, "brand"), { index: false, maxAge: isProd ? "1d" : 0 }));
}

const IMPORT_RE = /(?:^|\n)\s*import\s+(?:[^'"]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g;
function fileOfUrl(url) {
  const m = url.match(/^\/([a-z-]+)\/(.+)$/);
  return m && MOUNTS[m[1]] ? path.join(MOUNTS[m[1]], m[2]) : null;
}
export function moduleGraph(entryUrl, limit = 80) {
  const seen = new Set();
  const stack = [entryUrl];
  while (stack.length && seen.size < limit) {
    const url = stack.pop();
    if (seen.has(url)) continue;
    const file = fileOfUrl(url);
    if (!file || !fs.existsSync(file)) continue;
    seen.add(url);
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(IMPORT_RE)) stack.push(path.posix.join(path.posix.dirname(url), m[1]));
  }
  return [...seen];
}

let graphCache = null;
export function fullGraph(isProd) {
  if (isProd && graphCache) return graphCache;
  const graph = {};
  const walk = (dir, base) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) { if (name !== "vendor") walk(full, `${base}/${name}`); continue; }
      if (!name.endsWith(".js")) continue;
      const url = `${base}/${name}`;
      const deps = [...fs.readFileSync(full, "utf8").matchAll(IMPORT_RE)].map((m) => path.posix.join(path.posix.dirname(url), m[1]));
      if (deps.length) graph[url] = deps;
    }
  };
  for (const [mount, dir] of Object.entries(MOUNTS)) walk(dir, `/${mount}`);
  graphCache = graph;
  return graph;
}

const DYNAMIC_RE = /["'](\.{1,2}\/[^"'\s]+\.js)["']/g;
export function pageGraph(entries, isProd) {
  const graph = fullGraph(isProd);
  const seen = new Set();
  const stack = [...entries];
  while (stack.length) {
    const url = stack.pop();
    if (seen.has(url)) continue;
    seen.add(url);
    for (const d of graph[url] || []) stack.push(d);
    const file = fileOfUrl(url);
    if (file && fs.existsSync(file)) {
      for (const m of fs.readFileSync(file, "utf8").matchAll(DYNAMIC_RE)) stack.push(path.posix.join(path.posix.dirname(url), m[1]));
    }
  }
  return Object.fromEntries(Object.entries(graph).filter(([k]) => seen.has(k)));
}

const pageCache = new Map();
export function renderPage(file, { isProd }) {
  if (isProd && pageCache.has(file)) return pageCache.get(file);
  let html = fs.readFileSync(file, "utf8");
  const v = `/v/${APP_VERSION}`;
  const entries = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  const preload = entries.flatMap((e) => moduleGraph(e)).filter((u, i, a) => a.indexOf(u) === i)
    .map((u) => `<link rel="modulepreload" href="${v}${u}">`).join("\n  ");
  html = html.replace(MOUNT_RE, (all, attr, mount) => `${attr}="${v}/${mount}/`);
  const graph = JSON.stringify(pageGraph(entries, isProd)).replace(/</g, "\\u003c");
  const fonts = html.includes(`/shared/css/app.css"`) ? [
    `<link rel="preload" href="${v}/shared/css/fonts.css" as="style">`,
    ...["400", "700"].map((w) => `<link rel="preload" href="${v}/shared/fonts/ibm-plex-sans-arabic-arabic-${w}-normal.woff2" as="font" type="font/woff2" crossorigin>`),
  ].join("\n  ") : "";
  html = html.replace("</head>", `  <meta name="app-version" content="${APP_VERSION}">\n  ${fonts}\n  ${preload}\n  <script type="application/json" id="module-graph">${graph}</script>\n</head>`);
  if (isProd) pageCache.set(file, html);
  return html;
}
export const sendPage = (file, opts) => (req, res) =>
  res.set("Cache-Control", "no-cache").type("html").send(renderPage(file, opts));

export function serviceWorker() {
  const src = fs.readFileSync(path.join(PUBLIC_DIR, "sw.js"), "utf8").replace("__APP_VERSION__", APP_VERSION);
  return (req, res) => res.set("Cache-Control", "no-cache").type("application/javascript").send(src);
}
