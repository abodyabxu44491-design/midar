/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The currencies a school can work in: every Arab country's currency and the common international ones. One list
// for the server (validation) and the pages (pickers and amounts). A school picks its currency in settings and can
// change it; each finance account can hold its own currency with a conversion rate.
export const CURRENCIES = {
  YER: { name: "ريال يمني", symbol: "ر.ي" },
  SAR: { name: "ريال سعودي", symbol: "ر.س" },
  AED: { name: "درهم إماراتي", symbol: "د.إ" },
  KWD: { name: "دينار كويتي", symbol: "د.ك" },
  QAR: { name: "ريال قطري", symbol: "ر.ق" },
  OMR: { name: "ريال عُماني", symbol: "ر.ع" },
  BHD: { name: "دينار بحريني", symbol: "د.ب" },
  EGP: { name: "جنيه مصري", symbol: "ج.م" },
  JOD: { name: "دينار أردني", symbol: "د.أ" },
  IQD: { name: "دينار عراقي", symbol: "د.ع" },
  SYP: { name: "ليرة سورية", symbol: "ل.س" },
  LBP: { name: "ليرة لبنانية", symbol: "ل.ل" },
  SDG: { name: "جنيه سوداني", symbol: "ج.س" },
  LYD: { name: "دينار ليبي", symbol: "د.ل" },
  TND: { name: "دينار تونسي", symbol: "د.ت" },
  DZD: { name: "دينار جزائري", symbol: "د.ج" },
  MAD: { name: "درهم مغربي", symbol: "د.م" },
  MRU: { name: "أوقية موريتانية", symbol: "أ.م" },
  SOS: { name: "شلن صومالي", symbol: "ش.ص" },
  DJF: { name: "فرنك جيبوتي", symbol: "ف.ج" },
  KMF: { name: "فرنك قمري", symbol: "ف.ق" },
  ILS: { name: "شيكل", symbol: "₪" },
  USD: { name: "دولار أمريكي", symbol: "$" },
  EUR: { name: "يورو", symbol: "€" },
  GBP: { name: "جنيه إسترليني", symbol: "£" },
  TRY: { name: "ليرة تركية", symbol: "₺" },
  MYR: { name: "رينغيت ماليزي", symbol: "RM" },
};
export const CURRENCY_CODES = Object.keys(CURRENCIES);
export const currencyName = (code) => CURRENCIES[code]?.name || code;
// For pickers: [[code, name], ...] in the list's order (the most used first).
export const currencyOptions = () => CURRENCY_CODES.map((k) => [k, CURRENCIES[k].name]);
