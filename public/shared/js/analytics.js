// تحليلات Firebase — تعمل في الصفحات العامة وصفحات الدخول فقط
// لا تُحمَّل أبدًا في صفحات بيانات الطلاب أو لوحات الإدارة، حفاظًا على خصوصية الطلاب.
import { firebaseConfig } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
let started = false;

export async function startAnalytics(pageName) {
  if (started) return;
  started = true;
  try {
    const site = await fetch("/api/site", { cache: "no-store" }).then((r) => r.json());
    if (!site.analytics) return;
    const { initializeApp } = await import(`${SDK}/firebase-app.js`);
    const { getAnalytics, isSupported, logEvent, setAnalyticsCollectionEnabled } = await import(`${SDK}/firebase-analytics.js`);
    if (!(await isSupported())) return;
    const app = initializeApp(firebaseConfig);
    const analytics = getAnalytics(app);
    setAnalyticsCollectionEnabled(analytics, true);
    logEvent(analytics, "page_view", { page_title: pageName, page_location: location.origin + location.pathname.replace(/\/s\/[^/]+/, "/s/:school") });
  } catch {
    // التحليلات اختيارية؛ فشلها لا يؤثر على المنصة
  }
}
