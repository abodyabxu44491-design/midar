/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Home-page shortcuts the user chooses and orders (kept on this device). For the teacher they are always shown with
// sensible defaults; for the administration they are optional: nothing until the manager adds some, and removable.
import { h, mount } from "./dom.js";
import { icons } from "./icons.js";
import { dialog, btn, sub, toast } from "./ui.js";

const ICON = {
  attendance: "check", exams: "edit", chat: "message", students: "users", behavior: "star", homework: "book", timetable: "calendar",
  papers: "file", lessons: "clipboard", announcements: "megaphone", calendar: "calendar", meetings: "clock", surveys: "poll", me: "briefcase",
  account: "user", parents: "userPlus", admissions: "userPlus", teachers: "user", distribution: "shuffle", reports: "award", certificates: "award",
  sheets: "print", finance: "wallet", ledger: "bank", "money-requests": "clipboard", deposits: "book", staff: "briefcase", communication: "message",
  academic: "calendar", analytics: "chart", services: "box", subscription: "star", settings: "settings", audit: "history", ai: "sparkle",
};
const TONES = ["teal", "navy", "violet", "red", "amber", "teal"];
const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } };
const write = (key, v) => { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } };

/**
 * @param {object} o
 * @param {string} o.storeKey  where the choice is kept on this device
 * @param {Array<[string,string]>} o.sections  [key, label] of the sections this user can open
 * @param {(key: string) => void} o.go
 * @param {string[]} [o.defaults]  shown when nothing was chosen (empty = optional: an "add shortcuts" link instead)
 * @param {number} [o.max]
 * @param {object} [o.badges]  key -> element shown on that shortcut (an unread count, for example)
 */
export function shortcuts({ storeKey, sections, go, defaults = [], max = 4, badges = {} }) {
  const label = Object.fromEntries(sections);
  const optional = !defaults.length;
  const box = h("section", { class: "t-shortcuts" });
  const chosen = () => {
    const mine = read(storeKey);
    if (Array.isArray(mine)) return mine.filter((k) => label[k]).slice(0, max);
    return defaults.filter((k) => label[k]).slice(0, max);
  };
  const paint = () => {
    const list = chosen();
    if (!list.length) {
      mount(box, optional ? h("button", { type: "button", class: "sc-add", onclick: edit }, icons.plus({ size: 16 }), "إضافة اختصارات للأقسام التي تستخدمها كثيرًا") : null);
      return;
    }
    mount(box,
      h("div", { class: "t-sc-head" }, h("b", {}, "اختصاراتي"), h("button", { type: "button", class: "link", onclick: edit }, "تعديل")),
      h("div", { class: `quick-acts t-acts n${list.length}` }, list.map((key, i) => h("button", { type: "button", class: `quick-act ${TONES[i % TONES.length]}`, onclick: () => go(key) },
        h("span", { class: "qa-ic" }, icons[ICON[key] || "grid"]({ size: 20 }), badges[key] || null), label[key]))));
  };
  function edit() {
    let picked = chosen();
    const list = h("div", { class: "sc-list" });
    const draw = () => mount(list, sections.map(([key, text]) => {
      const n = picked.indexOf(key);
      return h("button", { type: "button", class: `sc-item${n >= 0 ? " on" : ""}`, "aria-pressed": String(n >= 0),
        onclick: () => {
          if (n >= 0) picked.splice(n, 1);
          else if (picked.length >= max) { toast(`الحد ${max} اختصارات. أزل واحدًا أولًا.`); return; }
          else picked.push(key);
          draw();
        } },
        h("span", { class: "sc-ic" }, icons[ICON[key] || "grid"]({ size: 18 })), h("span", { class: "sc-t" }, text),
        h("span", { class: "sc-n" }, n >= 0 ? String(n + 1) : ""));
    }));
    draw();
    const d = dialog("اختصارات الرئيسية", h("div", {},
      sub(`اختر حتى ${max} أقسام بالترتيب الذي تريده. الرقم يبين مكان الاختصار.${optional ? " الاختصارات اختيارية، ويمكنك إزالتها كلها." : ""}`), list), [
      btn("حفظ", () => {
        if (!optional && !picked.length) { toast("اختر اختصارًا واحدًا على الأقل", true); return; }
        write(storeKey, picked);
        d.close(); paint(); toast(picked.length ? "حُفظت الاختصارات" : "أُزيلت الاختصارات");
      }),
      optional ? btn("إزالة الكل", () => { picked = []; draw(); }, "ghost")
        : btn("الافتراضي", () => { picked = defaults.filter((k) => label[k]).slice(0, max); draw(); }, "ghost")]);
  }
  paint();
  return box;
}
