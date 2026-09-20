// لوحة مالك المنصة — واجهة برمجية منفصلة ومسار كوكي منفصل
import { Router } from "express";
import { ownerNetwork, requireOwner } from "../../core/auth/guards.js";
import { env } from "../../config/env.js";
import auth from "./auth.js";
import tenants from "./tenants.js";
import audit from "./audit.js";
import leads from "./leads.js";
import settings from "./settings.js";
import billing from "./billing.js";

const r = Router();
r.use(ownerNetwork);       // عنوان IP غير مسموح = "غير موجود"
r.use(auth);
r.use(requireOwner);
// للتحقق من TRUST_PROXY في الإنتاج: عنوان IP الذي يراه الخادم يجب أن يكون عنوانك أنت، لا عنوان بنية Google.
// افتح /api/owner/network وأنت مسجل الدخول وقارن req.ip مع عنوانك الحقيقي.
r.get("/network", (req, res) => res.json({
  ip: req.ip, ips: req.ips, forwarded_for: req.get("x-forwarded-for") || null,
  trust_proxy: env.TRUST_PROXY, ip_allowlist_enabled: env.ownerIps.length > 0,
}));
r.use("/tenants", tenants);
r.use("/leads", leads);
r.use("/settings", settings);
r.use("/billing", billing);
r.use("/audit", audit);
export default r;
