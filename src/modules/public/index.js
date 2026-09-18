// الواجهة العامة للطلاب وأولياء الأمور
//  - directory: الفصول وأسماء الطلاب (برمز الصفحة)
//  - profile:   ملف الطالب الكامل (بمعرّف الطالب)
//  - payments:  الدفع من ملف الطالب
import { Router } from "express";
import directory from "./directory.js";
import profile from "./profile.js";
import payments from "./payments.js";
import leads from "./leads.js";

const r = Router();
r.use("/leads", leads);          // ليست تابعة لمدرسة معينة
r.use("/:school", directory);
r.use("/:school", profile);
r.use("/:school", payments);
export default r;
