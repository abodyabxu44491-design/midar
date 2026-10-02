// تعريب سجل العمليات: أسماء الحقول وقيمها كما يفهمها مدير المدرسة، مع إخفاء الحقول التقنية
const FIELDS = {
  full_name: "الاسم", name: "الاسم", title: "العنوان", status: "الحالة", note: "ملاحظة", status_note: "سبب تغيير الحالة",
  class_id: "الشعبة", grade_id: "الصف", stage_id: "المرحلة", subject_id: "المادة", teacher_id: "المعلم", term_id: "الفصل الدراسي",
  exam_date: "تاريخ الاختبار", max_score: "الدرجة العظمى", score: "الدرجة", published_at: "تاريخ النشر",
  username: "اسم المستخدم", role: "الدور", is_active: "مفعّل", must_change_password: "يلزم تغيير كلمة المرور",
  locked_until: "مقفل حتى", failed_logins: "محاولات الدخول الخاطئة", last_login_at: "آخر دخول",
  can_approve_finance: "اعتماد المالية", can_manage_accounts: "إدارة الحسابات", can_manage_payroll: "إدارة الرواتب", can_danger_zone: "منطقة الحذر",
  gender: "الجنس", birth_date: "تاريخ الميلاد", guardian_phone: "جوال ولي الأمر", guardian_name: "اسم ولي الأمر", student_phone: "جوال الطالب",
  student_no: "رقم الطالب", phone: "الجوال", email: "البريد", address: "العنوان", city: "المدينة", country: "الدولة",
  sort_order: "الترتيب", amount: "المبلغ", price: "السعر", discount: "الخصم", currency: "العملة", base: "الراتب الأساسي",
  allowances: "البدلات", deductions: "الخصومات", advances: "السلف", bonus: "المكافأة", net: "الصافي", account_id: "الحساب",
  fees: "الرسوم", fees_enabled: "تفعيل الرسوم", approved_at: "تاريخ الاعتماد", day: "اليوم", excuse: "العذر", period: "الحصة",
  about: "نبذة عن المدرسة", access_mode: "طريقة الدخول للصفحة العامة", absence_alert_threshold: "حد تنبيه الغياب",
  allow_parent_excuses: "أعذار أولياء الأمور", school_type: "نوع المدرسة", sections_enabled: "الشعب", template: "القالب",
  body: "النص", starts_on: "يبدأ", ends_on: "ينتهي", kind: "النوع", category: "التصنيف", description: "الوصف",
  plan_name: "الباقة", max_students: "حد الطلاب", max_teachers: "حد المعلمين", billing_cycle: "دورة الفوترة", grace_days: "أيام السماح",
  attendance: "الحضور", exams: "الاختبارات", homework: "الواجبات", timetable: "الجدول", finance: "المالية", payroll: "الرواتب",
  reports: "التقارير", analytics: "الإحصاءات", announcements: "الإعلانات", messaging: "الرسائل", admissions: "القبول",
  transfers: "التحويلات", donations: "التبرعات", exam_papers: "أوراق الاختبارات", grade_components: "توزيع الدرجات",
};
const SHOW = { show_admissions: "القبول", show_announcements: "الإعلانات", show_class_counts: "أعداد الشعب", show_classes: "الشعب",
  show_contact: "التواصل", show_search: "البحث", show_student_names: "أسماء الطلاب", show_teachers: "المعلمين", show_timetable: "الجدول",
  show_teacher_photos: "صور المعلمين", public_fee_badges: "شارات الرسوم", profile_show_timetable: "الجدول في ملف الطالب",
  profile_show_teachers: "المعلمين في ملف الطالب", profile_show_homework: "الواجبات في ملف الطالب",
  profile_show_grades: "الدرجات في ملف الطالب", profile_show_attendance: "الحضور في ملف الطالب" };
for (const [k, v] of Object.entries(SHOW)) FIELDS[k] = `إظهار: ${v}`;

// حقول تقنية أو سرية لا معنى لعرضها
const HIDDEN = new Set(["id", "tenant_id", "updated_at", "created_at", "created_by", "version", "access_key", "photo_type", "photo",
  "password_hash", "initial_password_enc", "password_changed_at", "username_changed_at", "status_changed_at", "archived_at",
  "snapshot", "addons", "source_lead_id", "plan_id", "run_id", "entry_id", "staff_id", "approved_by", "setup_completed_at", "ended_at"]);

const VALUES = {
  active: "نشط", inactive: "غير نشط", transferred: "منقول", withdrawn: "منسحب", graduated: "متخرج", suspended: "موقوف", archived: "مؤرشف",
  draft: "مسودة", submitted: "مرفوع للإدارة", published: "منشور", approved: "معتمد", rejected: "مرفوض", pending: "قيد الانتظار",
  paid: "مدفوع", partial: "مدفوع جزئيًا", unpaid: "غير مدفوع", void: "ملغى", cancelled: "ملغى", open: "مفتوح", closed: "مغلق",
  present: "حاضر", absent: "غائب", late: "متأخر", excused: "بعذر", male: "ذكر", female: "أنثى",
  admin: "إدارة", teacher: "معلم", accountant: "محاسب", income: "إيراد", expense: "مصروف",
  trial: "تجربة", expired: "منتهي", monthly: "شهري", yearly: "سنوي", termly: "فصلي",
  basic: "الأساسية", pro: "الاحترافية", enterprise: "المؤسسات", code: "برمز", public: "عامة", private: "خاصة",
};

const fmt = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  if (v === true) return "نعم";
  if (v === false) return "لا";
  if (typeof v === "object") return Array.isArray(v) ? `${v.length} عنصر` : "تفاصيل";
  const s = String(v);
  if (VALUES[s]) return VALUES[s];
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 16).replace("T", " ");
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
};

// يحوّل تعديلًا خامًا إلى قائمة تغييرات مقروءة
export function describeChanges(oldData, newData) {
  return Object.keys(newData)
    .filter((k) => !HIDDEN.has(k) && JSON.stringify(oldData[k]) !== JSON.stringify(newData[k]))
    .map((k) => ({ field: FIELDS[k] || k.replace(/_/g, " "), from: fmt(oldData[k]), to: fmt(newData[k]) }));
}
export const valueLabel = fmt;
