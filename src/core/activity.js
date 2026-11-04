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

// While nobody uses the platform, every background job runs in one shared short window, once per IDLE_PERIOD: the
// database wakes once for all of them instead of once per job (each wake keeps it awake for several minutes).
const IDLE_PERIOD = 2 * 60 * 60_000, WINDOW = 6 * 60_000;
let windowStart = 0;
const idleWindow = (now) => {
  if (now - windowStart >= IDLE_PERIOD) windowStart = now;
  return now - windowStart < WINDOW ? windowStart : null;
};

/** Wraps a periodic job: while active, on every tick (or every `activeEveryMs`); while idle, once per shared idle window. */
export function gated(fn, { activeWithinMs = 15 * 60_000, activeEveryMs = 0 } = {}) {
  let lastRun = 0;
  return () => {
    const now = Date.now();
    if (now - last < activeWithinMs) {
      if (now - lastRun < activeEveryMs) return undefined;
    } else {
      const start = idleWindow(now);
      if (start === null || lastRun >= start) return undefined;
    }
    lastRun = now;
    return fn();
  };
}
