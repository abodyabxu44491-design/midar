/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PUBLIC_DIR = path.join(ROOT, "public");

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function computeBuildHash(dir = PUBLIC_DIR) {
  const h = crypto.createHash("sha256");
  for (const file of walk(dir)) {
    h.update(path.relative(dir, file).split(path.sep).join("/"));
    h.update("\0");
    h.update(fs.readFileSync(file));
  }
  return h.digest("hex").slice(0, 10);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
export const APP_RELEASE = pkg.version;
export const BUILD_HASH = computeBuildHash();
export const APP_VERSION = `${APP_RELEASE}-${BUILD_HASH}`;
export const STARTED_AT = new Date().toISOString();
