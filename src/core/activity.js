/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Every background query wakes the database. A database that sleeps when idle and is billed (or capped) by the time
// it is awake must be allowed to sleep at night: background work runs on every tick while people use the platform,
// and only now and then when nobody does.
let last = Date.now();
export const markActive = () => { last = Date.now(); };
export const idleMs = () => Date.now() - last;

/** Wraps a periodic job: every tick while active, at most once per `idleEveryMs` while idle. */
export function gated(fn, { activeWithinMs = 15 * 60_000, idleEveryMs = 60 * 60_000 } = {}) {
  let lastRun = 0;
  return () => {
    const now = Date.now();
    if (now - last >= activeWithinMs && now - lastRun < idleEveryMs) return undefined;
    lastRun = now;
    return fn();
  };
}
