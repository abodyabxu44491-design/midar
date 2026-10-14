/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
const KEY = "midar_recent_schools";
const ROLE = { parent: "الطلاب وأولياء الأمور", admin: "الإدارة", teacher: "المعلم", accountant: "المحاسب" };
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };

export function rememberSchool({ id, name, role }) {
  if (!id) return;
  const url = role === "parent" ? `/${id}` : `/${id}/idara?role=${role}`;
  const list = read().filter((x) => !(x.id === id && x.role === role));
  list.unshift({ id, name: name || id, role, url, at: Date.now() });
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 6))); } catch { /* ignore */ }
}
export const recentSchools = () => read().map((x) => ({ ...x, roleName: ROLE[x.role] || "" }));
export function forgetSchool(id, role) {
  try { localStorage.setItem(KEY, JSON.stringify(read().filter((x) => !(x.id === id && x.role === role)))); } catch { /* ignore */ }
}
