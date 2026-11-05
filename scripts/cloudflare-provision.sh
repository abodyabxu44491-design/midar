#!/usr/bin/env bash
# Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
# Proprietary and confidential. Unauthorized copying or distribution is prohibited.
#
# Creates the Cloudflare resources for one environment and deploys the Worker (docs/cloudflare/DEPLOY-RUNBOOK.md).
# Free-plan resources only; it never buys a plan. Run it again safely: existing resources are reused.
#
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID   the account (token: Workers Scripts, Hyperdrive, KV, Queues: Edit)
#   DATABASE_URL_FOR_HYPERDRIVE                   PostgreSQL address for this environment, application role (midar_app)
#   ENV=staging|production                        default staging
#
# Secrets are not handled here; set them with `npx wrangler secret put NAME --env <env>` (list in the runbook).
set -euo pipefail
ENV="${ENV:-staging}"
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}" "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
: "${DATABASE_URL_FOR_HYPERDRIVE:?set DATABASE_URL_FOR_HYPERDRIVE}"
SFX=$([ "$ENV" = production ] && echo "" || echo "-$ENV")
W="npx wrangler"
ENVFLAG=$([ "$ENV" = production ] && echo "" || echo "--env $ENV")

echo "== $ENV: Hyperdrive"
HD_ID=$($W hyperdrive list 2>/dev/null | awk -v n="midar$SFX" '$0 ~ n {for (i=1;i<=NF;i++) if ($i ~ /^[0-9a-f]{32}$/) print $i}' | head -1)
if [ -z "$HD_ID" ]; then
  HD_ID=$($W hyperdrive create "midar$SFX" --connection-string="$DATABASE_URL_FOR_HYPERDRIVE" | grep -oE '[0-9a-f]{32}' | head -1)
fi
echo "   $HD_ID"

echo "== $ENV: KV (last activity)"
KV_ID=$($W kv namespace list | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const n=JSON.parse(s).find(x=>x.title===process.argv[1]);console.log(n?n.id:"")})' "midar-state$SFX")
[ -n "$KV_ID" ] || KV_ID=$($W kv namespace create "midar-state$SFX" | grep -oE '[0-9a-f]{32}' | head -1)
echo "   $KV_ID"

echo "== $ENV: R2 bucket (files)"
if ! $W r2 bucket create "midar-files$SFX" 2>/tmp/r2.err; then
  grep -qi "already exists" /tmp/r2.err && echo "   midar-files$SFX exists" || { cat /tmp/r2.err; echo "✗ R2 غير مفعّل في الحساب: فعّله من لوحة Cloudflare (R2 Object Storage) ثم أعد التشغيل"; exit 1; }
fi

echo "== $ENV: Queues"
for q in "midar-jobs$SFX" "midar-jobs$SFX-dlq"; do $W queues create "$q" 2>/dev/null || echo "   $q exists"; done

echo "== $ENV: write ids into wrangler.jsonc"
node - "$ENV" "$HD_ID" "$KV_ID" <<'EOF'
const fs = require("fs");
const [env, hd, kv] = process.argv.slice(2);
let s = fs.readFileSync("wrangler.jsonc", "utf8");
// The production block comes first in the file, the staging block inside "env": { "staging": … }.
const at = env === "production" ? 0 : s.indexOf('"staging"');
const head = s.slice(0, at), tail = s.slice(at);
const set = (txt, binding, id) => txt.replace(new RegExp(`("binding": "${binding}", "id": ")[0-9a-f]{32}(")`), `$1${id}$2`);
fs.writeFileSync("wrangler.jsonc", head + set(set(tail, "HYPERDRIVE", hd), "STATE", kv));
EOF

echo "== $ENV: build and deploy"
npm run workers:build
$W deploy $ENVFLAG
echo "✓ deployed ($ENV). Next: secrets (runbook section 3), then npm run migrate against this database."
