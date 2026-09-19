// التنسيقات المشتركة
export const CURRENCIES = {
  SAR: { name: "ريال سعودي", symbol: "ر.س" },
  YER: { name: "ريال يمني", symbol: "ر.ي" },
  USD: { name: "دولار أمريكي", symbol: "$" },
};

// عملة المدرسة الحالية (تُضبط عند فتح اللوحة)
let currentCurrency = "SAR";
export const setCurrency = (code) => { if (CURRENCIES[code]) currentCurrency = code; };
export const getCurrency = () => currentCurrency;

/** تنسيق مبلغ. يمكن تمرير عملة مختلفة للحسابات ذات العملة الخاصة. */
export const money = (n, code) => {
  const c = CURRENCIES[code || currentCurrency] || CURRENCIES.SAR;
  const value = Number(n || 0).toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${value} ${c.symbol}`;
};
export const fmtDate = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00` : d)
  .toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", year: "numeric" }) : "");
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString("ar-SA-u-ca-gregory-nu-latn", { dateStyle: "medium", timeStyle: "short" }) : "");
export const fmtDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long" });
export const today = () => new Date().toLocaleDateString("en-CA");

export const ATTENDANCE = {
  present: ["حاضر", "#0B7A75"], absent: ["غائب", "#B8412F"], late: ["متأخر", "#A86A00"], excused: ["غياب بعذر", "#6B5B95"],
};
export const EXAM = { draft: ["مسودة", "gray"], pending: ["بانتظار الاعتماد", "amber"], published: ["منشورة", ""] };
export const METHODS = { cash: "نقدًا", transfer: "تحويل بنكي", card: "شبكة / بطاقة", online: "دفع إلكتروني" };

export function csv(filename, rows) {
  const data = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
