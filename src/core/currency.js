// رموز العملات المدعومة (تطابق public/shared/js/format.js)
export const CURRENCY_SYMBOLS = { SAR: "ر.س", YER: "ر.ي", USD: "$" };
export const currencySymbol = (code) => CURRENCY_SYMBOLS[code] || code || "";
