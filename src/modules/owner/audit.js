// سجل عمليات المنصة
import { Router } from "express";
import { transaction } from "../../core/db/pool.js";
import { handle } from "../../core/http/errors.js";

const r = Router();
r.get("/", handle(async (req, res) => {
  res.json(await transaction({ platform: true, actor: req.actor, ip: req.ip }, (q) => q(
    `SELECT id, actor, action, table_name, record_id, host(ip) AS ip, created_at,
            CASE WHEN table_name = 'tenants' THEN new_data - 'directory_code' END AS details
       FROM audit_log WHERE tenant_id IS NULL ORDER BY id DESC LIMIT 200`)));
}));
export default r;
