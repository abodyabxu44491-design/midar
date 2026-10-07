// قارئ رموز QR بالكاميرا (لتطبيق الحارس عند البوابة)
// القراءة: BarcodeDetector المدمج في المتصفح إن وُجد (أندرويد)، وإلا jsQR (آيفون وغيره).

/** صوت قصير للنتيجة — يعمل بعد أول ضغطة من المستخدم */
let ac;
export function beep(kind) {
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    const tones = { ok: [880, 1320], late: [660, 660], err: [220, 180], again: [990], saved: [740, 990] }[kind] || [880];
    tones.forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.0001, ac.currentTime + i * 0.13);
      g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + i * 0.13 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + i * 0.13 + 0.12);
      o.connect(g).connect(ac.destination); o.start(ac.currentTime + i * 0.13); o.stop(ac.currentTime + i * 0.13 + 0.14);
    });
  } catch { /* بلا صوت */ }
  navigator.vibrate?.(kind === "err" ? [80, 60, 80] : 60);
}

async function makeReader() {
  if ("BarcodeDetector" in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes("qr_code")) {
        const det = new window.BarcodeDetector({ formats: ["qr_code"] });
        return async (video) => (await det.detect(video))[0]?.rawValue || null;
      }
    } catch { /* نجرب jsQR */ }
  }
  const jsQR = (await import("../vendor/jsqr/jsqr.mjs")).default;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    const w = video.videoWidth, hgt = video.videoHeight;
    if (!w || !hgt) return null;
    const scale = Math.min(1, 640 / Math.max(w, hgt));
    canvas.width = Math.round(w * scale); canvas.height = Math.round(hgt * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data || null;
  };
}

/**
 * يشغّل الكاميرا الخلفية على عنصر الفيديو ويستدعي onCode لكل رمز جديد
 * (نفس البطاقة أمام الكاميرا: مرة كل 5 ثوانٍ فقط). يعيد دالة الإيقاف.
 */
export async function startCamera(video, onCode) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("الكاميرا غير متاحة في هذا المتصفح");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
  } catch {
    throw new Error("لم يُسمح باستخدام الكاميرا. اسمح بها من إعدادات المتصفح لهذا الموقع ثم أعد المحاولة.");
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  const read = await makeReader();
  let timer = null, busy = false, last = "", lastAt = 0, stopped = false;
  const loop = () => {
    timer = setTimeout(async () => {
      if (stopped) return;
      try {
        const code = busy ? null : await read(video);
        const now = Date.now();
        if (code && (code !== last || now - lastAt > 5000)) {
          last = code; lastAt = now; busy = true;
          try { await onCode(code); } finally { busy = false; }
        }
      } catch { /* إطار غير صالح */ }
      loop();
    }, 200);
  };
  loop();
  return () => { stopped = true; clearTimeout(timer); stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
}
