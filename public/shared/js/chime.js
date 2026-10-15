/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// The notification sound, the same on every page (staff apps, parent app, owner panel). Browsers only allow
// sound after the user has touched the page once, so the audio is unlocked on the first tap or key press.
let ctx = null, last = 0;
const KEY = "midar_sound_off";

function audio() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}
const unlock = () => { audio(); };
for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, unlock, { once: true, passive: true, capture: true });

export const soundOn = () => { try { return localStorage.getItem(KEY) !== "1"; } catch { return true; } };
export const setSound = (on) => { try { if (on) localStorage.removeItem(KEY); else localStorage.setItem(KEY, "1"); } catch { /* storage unavailable */ } };

// A short, soft two-note chime. Repeated calls within two seconds play once.
export function chime({ force = false } = {}) {
  const now = Date.now();
  if (!force && (now - last < 2000 || !soundOn())) return;
  last = now;
  const ac = audio();
  if (!ac) return;
  try {
    [[988, 0], [1319, 0.14]].forEach(([f, at]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "sine"; o.frequency.value = f;
      const t = ac.currentTime + at;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.5);
    });
  } catch { /* ignore */ }
  navigator.vibrate?.(120);
}

// A push that reaches an open page: the system notification may be silent while the page is in front,
// so the page plays the sound itself and tells the bells to refresh.
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.type !== "midar:push") return;
  if (!document.hidden) chime();
  document.dispatchEvent(new CustomEvent("midar:push", { detail: e.data }));
});
