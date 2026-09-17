// تحديد عدد المحاولات لمنع التخمين والإغراق
import rateLimit from "express-rate-limit";

// في بيئة الاختبار تُرفع الحدود حتى لا تتداخل مع الاختبارات الآلية
const factor = process.env.NODE_ENV === "test" ? 100 : 1;

const make = (windowMin, limit) => rateLimit({
  windowMs: windowMin * 60_000,
  limit: limit * factor,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.", code: "rate_limited" },
});

export const limits = {
  api: make(1, 180),          // عام
  login: make(15, 10),        // تسجيل الدخول
  studentKey: make(10, 20),   // إدخال معرّف الطالب
  payment: make(10, 20),      // الدفع
};
