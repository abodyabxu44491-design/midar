/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import { ownerNetwork, requireOwner } from "../../core/auth/guards.js";
import { env } from "../../config/env.js";
import auth from "./auth.js";
import tenants from "./tenants.js";
import { jobsRouter } from "../shared/jobs.routes.js";
import audit from "./audit.js";
import leads from "./leads.js";
import renewals from "./renewals.js";
import passwordRequests from "./password-requests.js";
import settings from "./settings.js";
import billing from "./billing.js";
import plans from "./plans.js";
import testimonials from "./testimonials.js";
import groups from "./groups.js";
import files from "./files.js";
import { subscriptions, requests } from "./subscriptions.js";
import danger from "./danger.js";
import sms from "./sms.js";

const r = Router();
r.use(ownerNetwork);
r.use(auth);
r.use(requireOwner);
r.get("/network", (req, res) => res.json({
  ip: req.ip, ips: req.ips, forwarded_for: req.get("x-forwarded-for") || null,
  trust_proxy: env.TRUST_PROXY, ip_allowlist_enabled: env.ownerIps.length > 0,
}));
r.use("/tenants", tenants);
r.use("/jobs", jobsRouter("owner"));
r.use("/leads", leads);
r.use("/renewals", renewals);
r.use("/password-requests", passwordRequests);
r.use("/settings", settings);
r.use("/billing", billing);
r.use("/", plans);
r.use("/subscriptions", subscriptions);
r.use("/requests", requests);
r.use("/testimonials", testimonials);
r.use("/groups", groups);
r.use("/files", files);
r.use("/sms", sms);
r.use("/audit", audit);
r.use("/danger", danger);
export default r;
