/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// A live check, made by the visitor's own browser when the page opens. It asks the platform only (/healthz), not the
// database, so opening this page never wakes the database.
const box = document.querySelector("[data-status]");
const ver = document.querySelector("[data-version]");

async function check() {
  const t0 = performance.now();
  try {
    const r = await fetch("/healthz", { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const ms = Math.round(performance.now() - t0);
    box.className = "status-box ok";
    box.textContent = `المنصة تعمل بشكل طبيعي (استجابت خلال ${ms} مللي ثانية).`;
  } catch {
    box.className = "status-box down";
    box.textContent = "تعذّر الوصول إلى المنصة الآن. قد يكون السبب اتصالك أو صيانة قصيرة.";
  }
  try {
    const v = await (await fetch("/api/version", { cache: "no-store" })).json();
    if (v.version) ver.textContent = `الإصدار الحالي: ${v.version}`;
  } catch { /* the version line is optional */ }
}
check();
