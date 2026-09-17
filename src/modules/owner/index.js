// لوحة مالك المنصة — واجهة برمجية منفصلة ومسار كوكي منفصل
import { Router } from "express";
import { ownerNetwork, requireOwner } from "../../core/auth/guards.js";
import auth from "./auth.js";
import tenants from "./tenants.js";
import audit from "./audit.js";

const r = Router();
r.use(ownerNetwork);       // عنوان IP غير مسموح = "غير موجود"
r.use(auth);
r.use(requireOwner);
r.use("/tenants", tenants);
r.use("/audit", audit);
export default r;
