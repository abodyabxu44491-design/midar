// الواجهة العامة للطلاب وأولياء الأمور
//  - directory: الفصول وأسماء الطلاب (برمز الصفحة)
//  - profile:   ملف الطالب الكامل (بمعرّف الطالب)
//  - payments:  الدفع من ملف الطالب
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
import { publicDemoGuard } from "../shared/demo.service.js";

const r = Router();
r.use("/leads", leads);          // ليست تابعة لمدرسة معينة
r.use("/demo", demo);            // الدخول للعرض التجريبي من الصفحة الرئيسية
r.get("/push-key", (req, res) => res.set("Cache-Control", "no-cache").json({ key: pushPublicKey() }));   // المفتاح العام للإشعار الفوري
r.use("/", verifyRouter);        // /verify/:code التحقق من الشهادات
// مدرسة العرض التجريبي: للقراءة فقط (قبل كل مسارات المدرسة، ومنها طلب استعادة كلمة المرور)
r.use("/:school", publicDemoGuard);
r.use("/", password);            // قبل مسارات المدرسة حتى لا تُفهم كرمز مدرسة
r.use("/:school", parent);         // حساب ولي الأمر الموحّد
r.use("/:school", directory);
r.use("/:school", site);            // الموقع المصغّر: الرئيسية، المراحل والصفوف، الشعب، البحث بالمعرّف
r.use("/:school", profile);
r.use("/:school", payments);
r.use("/:school", admissions);
r.use("/:school", inbox);
r.use("/:school", onlineExams);
r.use("/:school", engagement);
r.use("/:school", certificatesRouter);
export default r;
