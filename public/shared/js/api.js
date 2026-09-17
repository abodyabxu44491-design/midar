// الاتصال بالخادم
export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

export async function api(url, body, method) {
  let res;
  try {
    res = await fetch(url, {
      method: method || (body !== undefined ? "POST" : "GET"),
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("تعذر الاتصال بالخادم. تحقق من الإنترنت.", 0, "network");
  }
  let data = null;
  try { data = await res.json(); } catch { /* رد بدون محتوى */ }
  if (!res.ok) throw new ApiError(data?.error || "حدث خطأ غير متوقع", res.status, data?.code);
  return data;
}

// مفتاح فريد لكل عملية مالية: لو ضُغط الزر مرتين أو انقطع الاتصال لا تتكرر العملية
export const idempotencyKey = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
