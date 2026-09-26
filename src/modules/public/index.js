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

const r = Router();
r.use("/leads", leads);          // ليست تابعة لمدرسة معينة
r.use("/", password);            // قبل مسارات المدرسة حتى لا تُفهم كرمز مدرسة
r.use("/:school", directory);
r.use("/:school", site);            // الموقع المصغّر: الرئيسية، المراحل والصفوف، الشعب، البحث بالمعرّف
r.use("/:school", profile);
r.use("/:school", payments);
r.use("/:school", admissions);
export default r;
