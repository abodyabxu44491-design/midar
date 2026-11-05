/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Refuses any tracked file that holds a real key or password (run in CI before tests, and before every commit:
// `npm run check:secrets`). Secrets belong in the environment's settings (Render, Cloudflare, GitHub), never in the
// repository. With `--history` it scans every commit, so a key that was committed and later removed is still caught.
import { execFileSync } from "node:child_process";

const PATTERNS = [
  ["مفتاح Anthropic", /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/],
  ["مفتاح OpenAI", /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/],
  ["مفتاح AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["رمز GitHub", /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/],
  ["رمز Slack", /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
  ["مفتاح SendGrid", /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ["مفتاح Resend", /\bre_[A-Za-z0-9]{24,}/],
  ["كلمة مرور Neon", /\bnpg_[A-Za-z0-9]{10,}/],
  ["رمز Cloudflare", /\b(?:cf|CF)_?[A-Za-z0-9_-]{0,4}(?:token|TOKEN)\s*[=:]\s*['"][A-Za-z0-9_-]{40}['"]/],
  ["مفتاح خاص", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----\s*\n\s*[A-Za-z0-9+/=]{40,}/],
  ["رابط قاعدة بيانات بكلمة مرور", /postgres(?:ql)?:\/\/[^\s:'"`/@]+:([^\s@'"`$]{8,})@(?!127\.0\.0\.1|localhost|ep-xxxx)[^\s'"`]+/],
];

// Values that look like secrets but are public test fixtures or placeholders.
const ALLOWED = [/ci-(?:app|owner)-pass/, /CHANGE_ME/, /كلمة-/, /sk-ant-api03-SchoolTestKey/, /restore-test/];

// Binary files and generated lock data are skipped; everything else that git tracks is read.
const SKIP = /\.(png|jpe?g|webp|ico|ttf|woff2?|pdf|xlsx)$|^package-lock\.json$/;

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 30 });

function scan(text, where) {
  const found = [];
  text.split("\n").forEach((line, i) => {
    for (const [name, re] of PATTERNS) {
      const m = line.match(re);
      if (m && !ALLOWED.some((a) => a.test(m[0]))) found.push(`${where}:${i + 1}  ${name}`);
    }
  });
  return found;
}

const history = process.argv.includes("--history");
let found = [];
if (history) {
  // Only added lines matter: a removed line was added by an earlier commit and is reported there.
  const log = git("log", "--all", "-p", "--no-color", "--format=commit %h", "--", ".", ":(exclude)package-lock.json");
  let commit = "", file = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("commit ")) commit = line.slice(7);
    else if (line.startsWith("+++ b/")) file = line.slice(6);
    else if (line.startsWith("+") && !line.startsWith("+++") && !SKIP.test(file)) found.push(...scan(line.slice(1), `${commit} ${file}`));
  }
} else {
  for (const file of git("ls-files", "-z").split("\0").filter((f) => f && !SKIP.test(f))) {
    let text;
    try { text = git("show", `:${file}`); } catch { continue; }
    found.push(...scan(text, file));
  }
}

if (found.length) {
  console.error(`✗ ${found.length} قيمة تشبه سرًا حقيقيًا. انقلها إلى إعدادات البيئة، ثم أبطل المفتاح وغيّره:`);
  for (const f of new Set(found)) console.error("  " + f);
  process.exit(1);
}
console.log(`✓ لا أسرار في ${history ? "سجل Git كاملًا" : "الملفات المتتبعة"}`);
