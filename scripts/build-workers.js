/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Prepares what the Cloudflare Workers build needs, in dist/workers (not committed):
//   assets/    public files laid out at the URLs the Node server serves them on (/shared/…, /admin/…, /v/<version>/…,
//              /brand/…), so Cloudflare serves them directly without running the Worker. HTML pages are left out:
//              the Worker renders them and adds the security headers.
//   vfs.js     the files the app reads with node:fs (pages, scripts, package.json), served by workers/fs-shim.js.
//   build.json the version and build time, computed here once instead of on every new Worker instance.
import fs from "node:fs";
import path from "node:path";
import { computeBuildHash, PUBLIC_DIR } from "../src/core/version.js";
import { MOUNTS } from "../src/core/web.js";

const ROOT = path.resolve(path.dirname(PUBLIC_DIR));
const OUT = path.join(ROOT, "dist", "workers");
const ASSETS = path.join(OUT, "assets");

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const hash = computeBuildHash();
const version = `${pkg.version}-${hash}`;
const builtAt = new Date().toISOString();

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(ASSETS, { recursive: true });

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const full = path.join(dir, d.name);
  return d.isDirectory() ? walk(full) : [full];
});
const copyTree = (src, dest, keep = () => true) => {
  for (const file of walk(src)) {
    if (!keep(file)) continue;
    const to = path.join(dest, path.relative(src, file));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(file, to);
  }
};
const notHtml = (f) => !f.endsWith(".html");

for (const [mount, dir] of Object.entries(MOUNTS)) {
  copyTree(dir, path.join(ASSETS, mount), notHtml);
  copyTree(dir, path.join(ASSETS, "v", version, mount), notHtml);
}
copyTree(path.join(PUBLIC_DIR, "brand"), path.join(ASSETS, "brand"), notHtml);

// The same headers the Node server sets on these files (core/http/security.js and core/web.js).
fs.writeFileSync(path.join(ASSETS, "_headers"), [
  "/*",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: same-origin",
  "  Cross-Origin-Resource-Policy: same-origin",
  "  Cache-Control: public, max-age=0, must-revalidate",
  `/v/${version}/*`,
  "  ! Cache-Control",
  "  Cache-Control: public, max-age=31536000, immutable",
  "/brand/*",
  "  ! Cache-Control",
  "  Cache-Control: public, max-age=86400",
  "",
].join("\n"));

// Binary files (fonts, images) are served from assets/ and stay out of the bundle, which keeps the Worker quick to
// start. The exceptions are the ones the Worker itself sends: the owner panel (behind its secret path and address
// check, so never a public asset) and /favicon.ico.
const TEXT = /\.(html|js|mjs|css|json|webmanifest|svg|txt|md)$|LICENSE$/;
const WORKER_BINARY = (key) => key.startsWith("public/pages/owner/") || key === "public/brand/favicon.ico";
const vfs = {};
for (const file of walk(PUBLIC_DIR)) {
  const key = path.relative(ROOT, file).split(path.sep).join("/");
  const text = TEXT.test(file);
  if (!text && !WORKER_BINARY(key)) continue;
  const buf = fs.readFileSync(file);
  vfs[key] = text ? ["t", buf.toString("utf8")] : ["b", buf.toString("base64")];
}
vfs["package.json"] = ["t", fs.readFileSync(path.join(ROOT, "package.json"), "utf8")];
fs.writeFileSync(path.join(OUT, "vfs.js"), `export default ${JSON.stringify(vfs)};\n`);
fs.writeFileSync(path.join(OUT, "build.json"), JSON.stringify({ version, hash, builtAt }, null, 2));

const size = (p) => walk(p).reduce((n, f) => n + fs.statSync(f).size, 0);
console.log(`✓ ${version}`);
console.log(`  assets: ${(size(ASSETS) / 1e6).toFixed(2)} MB, vfs: ${(fs.statSync(path.join(OUT, "vfs.js")).size / 1e6).toFixed(2)} MB`);
