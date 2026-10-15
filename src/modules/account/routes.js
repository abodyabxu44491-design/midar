/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// /api/account — school managers' Midar accounts (setup link, sign-up, sign-in, recovery, Google / Apple).
import { Router } from "express";
import { handle, unauthorized } from "../../core/http/errors.js";
import { parse, z } from "../../core/http/validate.js";
import { limits } from "../../core/rate-limit.js";
import { readSession, destroySession } from "../../core/auth/sessions.js";
import { mailReady } from "../shared/mail.service.js";
import * as acct from "./account.service.js";
import * as oauth from "./oauth.service.js";

const accountOf = async (req) => (await readSession(req, "account"))?.account_id || null;
const requireAccount = async (req) => {
  const id = await accountOf(req);
  if (!id) throw unauthorized("سجّل الدخول بحسابك أولًا.");
  return id;
};
const provider = z.enum(["google", "apple"]);

export function accountRouter() {
  const r = Router();

  // Which sign-in methods are available right now (Google / Apple stay hidden until configured).
  r.get("/config", handle(async (req, res) => res.json({ email: await mailReady(), ...(await oauth.enabledProviders()) })));

  r.get("/me", handle(async (req, res) => res.json(await acct.me(await requireAccount(req)))));
  r.post("/logout", handle(async (req, res) => { await destroySession(req, res, "account"); res.json({ ok: true }); }));
  r.post("/logout-all", handle(async (req, res) => {
    const id = await requireAccount(req);
    await acct.signOutEverywhere(id, req);
    await destroySession(req, res, "account");
    res.json({ ok: true });
  }));

  // Setup link: what it is for, and linking the signed-in account to its school.
  r.post("/setup", limits.login, handle(async (req, res) => {
    const b = parse(acct.schemas.setup, req.body);
    res.json(await acct.setupInfo(b.token, await accountOf(req)));
  }));
  r.post("/setup/link", limits.login, handle(async (req, res) => {
    const b = parse(acct.schemas.setup.extend({ via: z.enum(["email", "google", "apple", "password"]).default("password") }), req.body);
    res.json(await acct.linkSetup(b.token, await requireAccount(req), b.via, req, res));
  }));

  // First entry from the school's own login link: whether the school still needs its manager, then linking.
  r.get("/claim", handle(async (req, res) => {
    const { school } = parse(z.object({ school: acct.schemas.enter.shape.school }), req.query);
    res.json(await acct.claimInfo(school));
  }));
  r.post("/claim", limits.login, handle(async (req, res) => {
    const b = parse(acct.schemas.enter.extend({ via: z.enum(["email", "google", "apple", "password"]).default("email") }), req.body);
    res.json(await acct.claimSchool(await requireAccount(req), b.school, b.via, req, res));
  }));

  // Email accounts.
  r.post("/signup", limits.login, handle(async (req, res) => res.json(await acct.signupStart(parse(acct.schemas.signup, req.body), req.ip))));
  r.post("/signup/verify", limits.login, handle(async (req, res) => res.json(await acct.signupVerify(parse(acct.schemas.verify, req.body), req, res))));
  r.post("/login", limits.staffLoginNet, limits.staffLogin, handle(async (req, res) => res.json(await acct.login(parse(acct.schemas.login, req.body), req, res))));
  r.post("/reset", limits.login, handle(async (req, res) => res.json(await acct.resetStart(parse(acct.schemas.resetStart, req.body), req.ip))));
  r.post("/reset/verify", limits.login, handle(async (req, res) => res.json(await acct.resetVerify(parse(acct.schemas.verify, req.body)))));
  r.post("/reset/finish", limits.login, handle(async (req, res) => res.json(await acct.resetFinish(parse(acct.schemas.resetFinish, req.body), req, res))));

  // Opening a school the account manages (the server checks the stored link every time).
  r.post("/enter", limits.login, handle(async (req, res) => {
    const b = parse(acct.schemas.enter, req.body);
    res.json(await acct.enterSchool(await requireAccount(req), b.school, req, res));
  }));

  // Account settings.
  r.post("/password", limits.login, handle(async (req, res) => res.json(await acct.changePassword(await requireAccount(req), parse(acct.schemas.password, req.body), req))));
  r.post("/identities/:provider/remove", handle(async (req, res) => res.json(await acct.unlinkProvider(await requireAccount(req), parse(provider, req.params.provider), req))));

  // Google / Apple: start (a navigation, so a GET), and Google's return. Apple returns by POST (see appleCallback).
  r.get("/oauth/:provider/start", limits.login, handle(async (req, res) => {
    const p = parse(provider, req.params.provider);
    const q = parse(z.object({
      purpose: z.enum(["login", "setup", "link", "claim"]).default("login"),
      school: acct.schemas.enter.shape.school.optional(),
      setup: acct.schemas.setup.shape.token.optional(),
    }), req.query);
    const accountId = q.purpose === "link" ? await requireAccount(req) : null;
    if (q.purpose === "setup" && !q.setup) throw unauthorized("رابط الإعداد مطلوب.");
    if (q.purpose === "claim" && !q.school) throw unauthorized("رابط المدرسة مطلوب.");
    res.redirect(303, await oauth.begin(p, { purpose: q.purpose, school: q.school || null, setup: q.setup || null, accountId }, oauth.publicBase(req)));
  }));
  r.get("/oauth/google/callback", limits.login, handle(async (req, res) => {
    const out = await oauth.finish("google", { code: req.query.code, state: req.query.state }, req, res, oauth.publicBase(req));
    res.redirect(303, out.redirect);
  }));
  return r;
}

// Apple posts its answer from appleid.apple.com (form_post); the one-time state stored on our side is what
// ties it to the request we started, so this route sits outside the same-origin JSON rule.
export const appleCallback = handle(async (req, res) => {
  const b = req.body || {};
  const out = await oauth.finish("apple", { code: b.code, state: b.state, user: b.user }, req, res, oauth.publicBase(req));
  res.redirect(303, out.redirect);
});
