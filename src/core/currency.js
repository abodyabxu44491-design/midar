/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
export const CURRENCY_SYMBOLS = { SAR: "ر.س", YER: "ر.ي", USD: "$" };
export const currencySymbol = (code) => CURRENCY_SYMBOLS[code] || code || "";
