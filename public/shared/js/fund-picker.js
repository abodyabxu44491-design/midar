/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// "Which fund?" on every money screen: the usual fund for the payment method is pre-selected and stays
// visible, and follows the method until the user picks a fund by hand.
import { api } from "./api.js";
import { select, field } from "./ui.js";

const KIND = { cash: "صندوق نقدي", bank: "حساب بنكي", online: "محفظة إلكترونية", donations: "صندوق تبرعات", other: "أخرى" };

/**
 * @param {string} url  The funds endpoint (`${A}/finance/funds` or `${A}/ledger/funds`).
 * @param {{ label: string, method?: string, donation?: boolean, methodSelect?: HTMLSelectElement, hint?: string }} o
 */
export async function fundField(url, { label, method = "cash", donation = false, methodSelect = null, hint = null }) {
  const d = await api(url);
  const sel = select(d.funds.map((f) => [f.id, `${f.name} (${KIND[f.kind] || f.kind})`]));
  let chosenByHand = false;
  sel.addEventListener("change", () => { chosenByHand = true; });
  const follow = (m) => {
    if (chosenByHand) return;
    const id = donation ? d.defaults.donation : d.defaults[m];
    if (id && d.funds.some((f) => Number(f.id) === Number(id))) sel.value = String(id);
  };
  follow(methodSelect?.value || method);
  methodSelect?.addEventListener("change", () => follow(methodSelect.value));
  return {
    el: field(label, sel, hint || (d.funds.length ? null : "لا يوجد صندوق نشط. أنشئ صندوقًا من «الحسابات والصناديق».")),
    value: () => Number(sel.value) || null,
  };
}
