/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { Router } from "express";
import directory from "./directory.js";
import site from "./site.js";
import profile from "./profile.js";
import payments from "./payments.js";
import leads from "./leads.js";
import admissions from "./admissions.js";
import password from "./password.js";
import inbox from "./inbox.js";
import onlineExams from "./online-exams.js";
import engagement from "./engagement.js";
import { verifyRouter, schoolRouter as certificatesRouter } from "./certificates.js";
import { pushPublicKey } from "../shared/notify.service.js";
import demo from "./demo.js";
import parent from "./parent.js";
import chat from "./chat.js";
import { publicDemoGuard } from "../shared/demo.service.js";

const r = Router();
r.use("/leads", leads);
r.use("/demo", demo);
r.get("/push-key", (req, res) => res.set("Cache-Control", "no-cache").json({ key: pushPublicKey() }));
r.use("/", verifyRouter);
r.use("/:school", publicDemoGuard);
r.use("/", password);
r.use("/:school", parent);
r.use("/:school", directory);
r.use("/:school", site);
r.use("/:school", profile);
r.use("/:school", payments);
r.use("/:school", admissions);
r.use("/:school", inbox);
r.use("/:school", onlineExams);
r.use("/:school", engagement);
r.use("/:school", chat);
r.use("/:school", certificatesRouter);
export default r;
