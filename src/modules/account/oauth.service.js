/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Sign in with Google / Apple: authorization-code flow run on the server (PKCE for Google, form_post for Apple).
// The provider's ID token is verified against its published keys (issuer, audience, expiry, nonce), and the
// account is matched by the provider's stable subject id — never by the email text alone.
import crypto from "node:crypto";
import { transaction } from "../../core/db/pool.js";
import { AppError } from "../../core/http/errors.js";
import { logEvent } from "../../core/audit.js";
import { openSecret } from "../../core/auth/secret-box.js";
import { env } from "../../config/env.js";
import { startAccountSession, linkSetup, enterSchool, claimSchool } from "./account.service.js";

export const PROVIDER_AAD = (p) => `auth-provider:${p}`;
const STATE_MINUTES = 10;
const sha = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const platform = (fn) => transaction({ platform: true, actor: "النظام", ip: null }, fn);

const P = {
  google: {
    name: "Google",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    jwks: "https://www.googleapis.com/oauth2/v3/certs",
    issuers: ["https://accounts.google.com", "accounts.google.com"],
  },
  apple: {
    name: "Apple",
    authorize: "https://appleid.apple.com/auth/authorize",
    token: "https://appleid.apple.com/auth/token",
    jwks: "https://appleid.apple.com/auth/keys",
    issuers: ["https://appleid.apple.com"],
  },
};

// Network calls go through here so tests can stand in for the providers.
const realHttp = {
  async json(url, init) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError(502, "تعذر التحقق من الحساب لدى المزوّد. حاول مرة أخرى.", "oauth_failed");
    return body;
  },
};
let http = realHttp;
export const setOAuthHttp = (h) => { http = h || realHttp; jwksCache.clear(); };

export async function providerConfig(provider) {
  const [p] = await platform((q) => q("SELECT * FROM auth_providers WHERE provider = $1", [provider]));
  if (!p?.enabled || !p.client_id || !p.secret_sealed) return null;
  if (provider === "apple" && (!p.team_id || !p.key_id)) return null;
  return { ...p, secret: openSecret(p.secret_sealed, PROVIDER_AAD(provider)) };
}
export async function enabledProviders() {
  return { google: Boolean(await providerConfig("google")), apple: Boolean(await providerConfig("apple")) };
}

export const callbackUrl = (base, provider) => `${base}/api/account/oauth/${provider}/callback`;

// Step 1: remember state, nonce and PKCE verifier on the server; send the browser to the provider.
export async function begin(provider, { purpose, school = null, setup = null, accountId = null }, base) {
  const cfg = await providerConfig(provider);
  if (!cfg) throw new AppError(404, `الدخول عبر ${P[provider].name} غير مفعّل.`, "provider_off");
  const state = b64url(crypto.randomBytes(32));
  const nonce = b64url(crypto.randomBytes(24));
  const verifier = provider === "google" ? b64url(crypto.randomBytes(48)) : null;
  await platform(async (q) => {
    await q("DELETE FROM oauth_states WHERE expires_at < now()");
    await q(`INSERT INTO oauth_states (state_hash, provider, purpose, nonce, verifier, school, setup_token_hash, account_id, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(mins => $9))`,
    [sha(state), provider, purpose, nonce, verifier, school, setup ? sha(setup) : null, accountId, STATE_MINUTES]);
  });
  const u = new URL(P[provider].authorize);
  const params = { client_id: cfg.client_id, redirect_uri: callbackUrl(base, provider), response_type: "code", state, nonce };
  if (provider === "google") Object.assign(params, { scope: "openid email profile", code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()), code_challenge_method: "S256", prompt: "select_account" });
  else Object.assign(params, { scope: "name email", response_mode: "form_post" });
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

// Apple's client secret is a short-lived JWT signed with the team's key (ES256).
function appleClientSecret(cfg) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: cfg.key_id }));
  const body = b64url(JSON.stringify({ iss: cfg.team_id, iat: now, exp: now + 300, aud: "https://appleid.apple.com", sub: cfg.client_id }));
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key: cfg.secret, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64url(sig)}`;
}

const jwksCache = new Map();
async function keyFor(provider, kid) {
  const hit = jwksCache.get(provider);
  let keys = hit && Date.now() - hit.at < 3600_000 ? hit.keys : null;
  if (!keys || !keys.some((k) => k.kid === kid)) {
    keys = (await http.json(P[provider].jwks, { method: "GET" })).keys || [];
    jwksCache.set(provider, { at: Date.now(), keys });
  }
  const jwk = keys.find((k) => k.kid === kid);
  if (!jwk) throw new AppError(401, "تعذر التحقق من هوية الحساب.", "oauth_invalid");
  return crypto.createPublicKey({ key: jwk, format: "jwk" });
}

export async function verifyIdToken(provider, idToken, { audience, nonce }) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new AppError(401, "تعذر التحقق من هوية الحساب.", "oauth_invalid");
  const head = JSON.parse(Buffer.from(parts[0], "base64url").toString());
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  if (head.alg !== "RS256") throw new AppError(401, "تعذر التحقق من هوية الحساب.", "oauth_invalid");
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), await keyFor(provider, head.kid), Buffer.from(parts[2], "base64url"));
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!ok || !P[provider].issuers.includes(claims.iss) || !aud.includes(audience) || !(claims.exp > now - 60) || claims.nonce !== nonce || !claims.sub) {
    throw new AppError(401, "تعذر التحقق من هوية الحساب.", "oauth_invalid");
  }
  return claims;
}

// Step 2: the provider returns; the code is exchanged and the ID token verified, then the purpose is carried out.
// Returns where to send the browser (with a short result code the page understands, never a secret).
export async function finish(provider, { code, state, user }, req, res, base) {
  const fail = (why, st) => ({ redirect: backTo(st, `oauth=${why}`) });
  if (!code || !state) return fail("cancelled", null);
  const [st] = await platform((q) => q("DELETE FROM oauth_states WHERE state_hash = $1 AND provider = $2 RETURNING *", [sha(state), provider]));
  if (!st || new Date(st.expires_at) < new Date()) return fail("expired", st);
  const cfg = await providerConfig(provider);
  if (!cfg) return fail("off", st);
  let claims;
  try {
    const form = { client_id: cfg.client_id, code, grant_type: "authorization_code", redirect_uri: callbackUrl(base, provider) };
    if (provider === "google") Object.assign(form, { client_secret: cfg.secret, code_verifier: st.verifier });
    else form.client_secret = appleClientSecret(cfg);
    const tok = await http.json(P[provider].token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
    claims = await verifyIdToken(provider, tok.id_token, { audience: cfg.client_id, nonce: st.nonce });
  } catch { return fail("failed", st); }
  const verified = claims.email_verified === true || claims.email_verified === "true";
  const mail = verified && claims.email ? String(claims.email).toLowerCase() : null;
  let name = claims.name || null;
  if (!name && user) { try { const u = JSON.parse(user); name = [u?.name?.firstName, u?.name?.lastName].filter(Boolean).join(" ") || null; } catch { /* ignore */ } }

  const found = await platform((q) => q(
    `SELECT a.id, a.disabled_at FROM account_identities i JOIN accounts a ON a.id = i.account_id WHERE i.provider = $1 AND i.subject = $2`, [provider, claims.sub]));
  let accountId = found[0] && !found[0].disabled_at ? found[0].id : null;

  if (st.purpose === "link") {
    // Adding Google / Apple to the account that is signed in now.
    if (!st.account_id) return fail("expired", st);
    if (accountId && accountId !== st.account_id) return fail("taken", st);
    if (!accountId) {
      await platform(async (q) => {
        await q("INSERT INTO account_identities (account_id, provider, subject, email) VALUES ($1, $2, $3, $4) ON CONFLICT (account_id, provider) DO UPDATE SET subject = EXCLUDED.subject, email = EXCLUDED.email",
          [st.account_id, provider, claims.sub, mail]);
        const [a] = await q("SELECT email FROM accounts WHERE id = $1", [st.account_id]);
        await logEvent(q, { actor: a?.email || "مدير", action: `ربط ${P[provider].name} بحساب مدير` });
      });
    }
    return { redirect: backTo(st, "oauth=linked") };
  }

  if (!accountId) {
    if (st.purpose !== "setup" && st.purpose !== "claim") return fail("not_linked", st);
    // First time, from a setup link: a new account for this identity. An email already registered is not
    // merged on its text alone; the manager signs in to that account and links the provider from settings.
    if (!mail) return fail("no_email", st);
    const made = await platform(async (q) => {
      const [taken] = await q("SELECT 1 FROM accounts WHERE lower(email) = $1", [mail]);
      if (taken) return null;
      const [a] = await q(`INSERT INTO accounts (email, email_verified_at, full_name, last_login_at) VALUES ($1, now(), $2, now()) RETURNING id`, [mail, name]);
      await q("INSERT INTO account_identities (account_id, provider, subject, email) VALUES ($1, $2, $3, $4)", [a.id, provider, claims.sub, mail]);
      await logEvent(q, { actor: mail, action: `إنشاء حساب مدير عبر ${P[provider].name}` });
      return a.id;
    });
    if (!made) return fail("email_exists", st);
    accountId = made;
  }

  await platform(async (q) => {
    await q("UPDATE account_identities SET last_used_at = now() WHERE provider = $1 AND subject = $2", [provider, claims.sub]);
    await q("UPDATE accounts SET last_login_at = now() WHERE id = $1", [accountId]);
    await startAccountSession(q, req, res, accountId);
  });
  if (st.purpose === "setup" && st.setup_token_hash) {
    // The account is ready: link it to the school of the setup link and open the school.
    try { const r = await linkSetup(null, accountId, provider, req, res, { hash: st.setup_token_hash }); return { redirect: r.redirect }; }
    catch (e) { return { redirect: `/activate?resume=1&oauth=${e.status === 409 ? "linked_other" : "link_failed"}` }; }
  }
  if (st.purpose === "claim" && st.school) {
    // First entry from the school's login link: link the account if its email is the manager's, then open the school.
    try { const r = await claimSchool(accountId, st.school, provider, req, res); return { redirect: r.redirect }; }
    catch (e) { return { redirect: `/activate?school=${encodeURIComponent(st.school)}&oauth=${e.code === "email_mismatch" ? "claim_email" : e.status === 409 ? "claim_taken" : "claim_failed"}` }; }
  }
  if (st.school) {
    try { const r = await enterSchool(accountId, st.school, req, res, provider); return { redirect: r.redirect }; }
    catch { return { redirect: `/${encodeURIComponent(st.school)}/idara?account=1` }; }
  }
  return { redirect: "/account" };
}

// Where a provider round-trip lands when it cannot finish (or after linking from settings).
function backTo(st, query) {
  if (st?.purpose === "setup") return `/activate?resume=1&${query}`;
  if (st?.purpose === "claim" && st.school) return `/activate?school=${encodeURIComponent(st.school)}&${query}`;
  if (st?.purpose === "link" && st.school) return `/${encodeURIComponent(st.school)}/idara?role=admin&${query}#/settings`;
  if (st?.school) return `/${encodeURIComponent(st.school)}/idara?${query}`;
  return `/account?${query}`;
}

export { linkSetup };
export const publicBase = (req) => env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
