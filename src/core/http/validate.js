// التحقق من المدخلات بـ zod قبل وصولها لأي منطق
import { z } from "zod";
import { badRequest } from "./errors.js";

// أسماء الحقول بالعربية في رسائل الخطأ (المستخدم لا يرى أسماء داخلية مثل billing_cycle)
const FIELD_LABELS = {
  billing_cycle: "مدة الاشتراك", plan_id: "الباقة", months: "عدد الأشهر", kind: "نوع الطلب", school_name: "اسم المدرسة",
  contact_name: "اسم المسؤول", phone: "رقم الجوال", email: "البريد الإلكتروني", students_count: "عدد الطلاب", city: "المدينة",
  username: "اسم المستخدم", password: "كلمة المرور", school: "رمز المدرسة", name: "الاسم", class_id: "الفصل", subject_id: "المادة",
  amount: "المبلغ", date: "التاريخ", title: "العنوان", total_marks: "الدرجة النهائية", price: "السعر", feature_key: "الميزة",
  student_id: "الطالب", key: "معرّف الطالب", addon_keys: "المميزات الإضافية", note: "الملاحظات",
};
const fieldLabel = (path) => FIELD_LABELS[path[path.length - 1]] || (path.length ? "أحد الحقول" : "الطلب");

export const parse = (schema, data) => {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const i = r.error.issues[0];
    throw badRequest(i.message.startsWith("Expected") || i.message.startsWith("Invalid") || i.message.startsWith("String") || i.message.startsWith("Number")
      ? `قيمة غير صحيحة في: ${fieldLabel(i.path)}` : i.message);
  }
  return r.data;
};

// الحقول الاختيارية: غير المرسل يبقى undefined (لا يُمسح)، والفارغ يصبح null (مسح مقصود)
const keep = (v) => (v === undefined ? undefined : v || null);

// أنواع مشتركة
const trimmed = (min, max, label) => z.string({ required_error: `${label} مطلوب` }).trim()
  .min(min, `${label} قصير جدًا`).max(max, `${label} طويل جدًا`);
export const t = {
  name: (label = "الاسم") => trimmed(2, 120, label),
  shortText: (label, max = 120) => trimmed(2, max, label),
  optText: (max = 300) => z.string().trim().max(max).optional().nullable().transform(keep),
  phone: z.string().trim().regex(/^[0-9+ ]{0,20}$/, "رقم الجوال غير صحيح").optional().nullable().transform(keep),
  id: z.coerce.number().int().positive(),
  optId: z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional().transform((v) => (v === undefined ? undefined : v ? Number(v) : null)),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ غير صحيح"),
  optDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ غير صحيح"), z.literal(""), z.null()]).optional().transform(keep),
  money: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر").max(10_000_000).multipleOf(0.01, "المبلغ بحد أقصى رقمين بعد الفاصلة"),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, "اسم المستخدم: حروف إنجليزية وأرقام (3 أحرف على الأقل)"),
  password: z.string().min(10, "كلمة المرور 10 أحرف على الأقل").max(200)
    .regex(/[A-Za-z]/, "كلمة المرور تحتاج حرفًا إنجليزيًا").regex(/[0-9]/, "كلمة المرور تحتاج رقمًا"),
  idemKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/, "مفتاح العملية غير صالح"),
  studentKey: z.string().trim().toUpperCase().regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/, "معرّف الطالب غير صحيح"),
};
export { z };
