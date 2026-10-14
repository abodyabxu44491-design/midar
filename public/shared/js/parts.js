/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { h, mount } from "./dom.js";
import { empty, notice } from "./ui.js";

export function partsView(parts, render, { intro = null } = {}) {
  const keys = parts.map(([k]) => k);
  const [tab, want] = (location.hash.match(/^#\/([\w-]+)(?:\/([\w-]+))?/) || []).slice(1);
  let part = keys.includes(want) ? want : keys[0];
  const chips = h("div", { class: "xb-chips fin-parts", role: "tablist" });
  const box = h("div");
  const show = async (next = part) => {
    part = next;
    if (tab) history.replaceState(null, "", `#/${tab}/${part}`);
    mount(chips, parts.map(([k, label]) => h("button", { type: "button", role: "tab", "aria-selected": String(k === part),
      class: `xb-chip${k === part ? " on" : ""}`, onclick: () => show(k) }, label)));
    mount(box, empty("جارٍ التحميل…"));
    try { mount(box, await render(part, { show: () => show(part), go: show })); }
    catch (e) { mount(box, notice(e.message, "err")); }
  };
  show();
  return h("div", {}, intro, parts.length > 1 ? chips : null, box);
}
