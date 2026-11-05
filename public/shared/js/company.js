/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// How the company behind Midar is named on public pages. Built only from what the owner entered in the panel
// (/api/site → company): a registration or legal entity is never mentioned unless it was filled in.

// "مدار — منتج MIDAIR SCHOOL" or plain "مدار — منصة إدارة المدارس" when no company is set.
export function productLine(company) {
  const name = company?.name_en || company?.name;
  return name ? `مدار — منتج ${name}` : "مدار — منصة إدارة المدارس";
}

// The operator sentence for the legal pages, or null when nothing is set:
// "تقدّم خدمة مدار MIDAIR SCHOOL (الاسم القانوني)، سجل تجاري رقم 123، اليمن. العنوان: …"
export function operatorLine(company) {
  if (!company) return null;
  const name = company.name_en || company.name;
  const legal = company.legal_name && company.legal_name !== name ? company.legal_name : null;
  const who = name && legal ? `${name} (${legal})` : name || legal;
  if (!who) return null;
  const parts = [`تقدّم خدمة مدار ${who}`];
  if (company.reg_no) parts.push(`سجل تجاري رقم ${company.reg_no}`);
  if (company.country) parts.push(company.country);
  return parts.join("، ") + "." + (company.address ? ` العنوان: ${company.address}.` : "");
}
