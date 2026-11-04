/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Reads the emails the app really sent, from the local Mailpit catcher (nothing leaves the machine).
import { MAILPIT } from "./env.mjs";

const get = async (path) => {
  const r = await fetch(MAILPIT.api + path);
  if (!r.ok) throw new Error(`Mailpit ${path}: ${r.status}`);
  return r.json();
};

// The six-digit code in the newest email to this address that arrived after `since`, waiting up to 15 seconds.
export async function waitForCode(to, { since = 0, timeout = 15_000 } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const list = await get(`/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=5`);
    for (const m of list.messages || []) {
      if (new Date(m.Created).getTime() < since) continue;
      const full = await get(`/api/v1/message/${m.ID}`);
      const code = String(full.Text || "").match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await new Promise((r) => { setTimeout(r, 300); });
  }
  throw new Error(`No code emailed to ${to} within ${timeout} ms`);
}
