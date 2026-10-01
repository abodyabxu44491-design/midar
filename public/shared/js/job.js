// تشغيل عملية طويلة في الخلفية مع نافذة تقدم: يبدأها الطلب، ثم تُسأل حالتها كل ثانية حتى تنتهي.
// الإغلاق لا يوقف العملية (تكمل في الخادم)، ويمكن فتح النتيجة لاحقًا من نفس الصفحة ما دامت مفتوحة.
import { h, mount } from "./dom.js";
import { api, ApiError } from "./api.js";
import { sub } from "./ui.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * runJob("/api/admin/import/students/commit", body, { title, jobsBase: "/api/admin/jobs" })
 * يعيد { summary, secret } عند النجاح، ويرمي ApiError برسالة الخادم عند الفشل.
 */
export async function runJob(url, body, { title = "جارٍ التنفيذ", jobsBase, note = null } = {}) {
  const { id } = await api(url, body);
  const bar = h("i", { style: "width:0%" });
  const pct = h("b", {}, "0%");
  const step = h("span", { class: "sub" }, "بدأت العملية…");
  const d = h("dialog", { class: "job-dialog", "aria-label": title },
    h("div", { class: "d-in" }, h("h2", {}, title),
      h("div", { class: "job-row" }, step, pct),
      h("div", { class: "bar job-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, bar),
      sub(note || "تعمل العملية في الخادم، ولن تتوقف إن ضعف الاتصال. أبقِ الصفحة مفتوحة لترى النتيجة.")));
  d.addEventListener("cancel", (e) => e.preventDefault());     // لا إغلاق بزر Esc أثناء التنفيذ
  document.body.append(d);
  d.showModal();
  try {
    let misses = 0;
    for (;;) {
      await sleep(900);
      let j;
      try { j = await api(`${jobsBase}/${id}`); misses = 0; }
      catch (e) { if (e.code === "network" || e.code === "timeout" || e.status >= 500) { if (++misses < 60) continue; } throw e; }
      const p = j.total ? Math.min(100, Math.round((100 * j.done) / j.total)) : 0;
      bar.style.width = `${j.status === "done" ? 100 : p}%`;
      bar.parentElement.setAttribute("aria-valuenow", String(p));
      mount(pct, `${j.status === "done" ? 100 : p}%`);
      if (j.step) mount(step, j.total && j.total !== 100 && j.status === "running" ? `${j.step}: ${j.done} من ${j.total}` : j.step);
      if (j.status === "done") return { summary: j.summary, secret: j.secret || null };
      if (j.status === "failed") throw new ApiError(j.error || "تعذر إكمال العملية", 400, "job_failed", j.summary?.details || null);
    }
  } finally {
    d.close(); d.remove();
  }
}
