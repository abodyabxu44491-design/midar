/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { api } from "../../shared/js/api.js";
import { h } from "../../shared/js/dom.js";
import { select, input } from "../../shared/js/ui.js";

export let A = "/api/admin";
export const setApiBase = (role) => { A = role === "accountant" ? "/api/accountant" : "/api/admin"; };
export const loadClasses = () => api(`${A}/structure/classes`);
export const loadSubjects = () => api(`${A}/structure/subjects`);
export const classOptions = (classes, emptyLabel) => [...(emptyLabel ? [["", emptyLabel]] : []), ...classes.map((c) => [c.id, c.name])];
export const directoryLink = (me) => `${location.origin}/${me.school.id}`;
export const staffLink = (me) => `${location.origin}/${me.school.id}/idara`;

export const optional = (promise, fallback) => promise.catch(() => fallback);

export function rememberField(key, el, { event = "input" } = {}) {
  const full = `midar_filter_${key}`;
  try {
    const saved = sessionStorage.getItem(full);
    if (saved !== null) { if (el.type === "checkbox") el.checked = saved === "1"; else el.value = saved; }
  } catch { /* ignore */ }
  el.addEventListener(event, () => {
    try { sessionStorage.setItem(full, el.type === "checkbox" ? (el.checked ? "1" : "0") : el.value); } catch { /* ignore */ }
  });
  return el;
}

export function countryField(countries, current, { onChange } = {}) {
  const known = countries.filter((c) => c.key !== "OTHER");
  const cur = String(current || "").trim();
  const match = known.find((c) => c.name === cur) || (!cur ? known.find((c) => c.key === "YE") : null);
  const sel = select([...known.map((c) => [c.key, c.name]), ["OTHER", "دولة أخرى…"]], { value: match ? match.key : "OTHER" });
  const other = input({ value: match ? "" : cur, placeholder: "اسم الدولة" });
  other.hidden = sel.value !== "OTHER";
  sel.addEventListener("change", () => { other.hidden = sel.value !== "OTHER"; if (!other.hidden) other.focus(); onChange?.(sel.value); });
  return {
    el: h("div", { class: "country-field" }, sel, other),
    key: () => sel.value,
    value: () => (sel.value === "OTHER" ? other.value.trim() || null : known.find((c) => c.key === sel.value)?.name || null),
  };
}
