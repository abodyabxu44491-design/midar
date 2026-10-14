/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { firebaseConfig } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
let started = false;

export async function startAnalytics(pageName) {
  if (started) return;
  started = true;
  try {
    const site = await fetch("/api/analytics-config").then((r) => r.json());
    if (!site.analytics) return;
    const { initializeApp } = await import(`${SDK}/firebase-app.js`);
    const { initializeAnalytics, isSupported, logEvent } = await import(`${SDK}/firebase-analytics.js`);
    if (!(await isSupported())) return;
    const app = initializeApp(firebaseConfig);
    const analytics = initializeAnalytics(app, { config: { send_page_view: false } });
    logEvent(analytics, "page_view", { page_title: pageName, page_location: `${location.origin}/${pageName}`, page_path: `/${pageName}` });
  } catch {
  }
}
