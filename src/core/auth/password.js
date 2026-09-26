// تشفير كلمات المرور بخوارزمية scrypt (مدمجة في Node.js، مقاومة لهجمات التخمين)
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

// الصيغة: scrypt$N$r$p$salt$hash
/**
 * الشكل الموحد لكلمة المرور، يُطبَّق عند الحفظ وعند التحقق:
 *   - إزالة الأحرف غير المرئية (علامات الاتجاه التي تضيفها تطبيقات مثل واتساب عند النسخ من نص عربي)
 *   - الأرقام العربية/الفارسية ← أرقام لاتينية (لوحة المفاتيح العربية تكتب ٧٠ بدل 70)
 *   - أشكال الشرطة المختلفة ← "-"، وإزالة المسافات في البداية والنهاية (النسخ واللصق)
 * كلها تغييرات لا يراها المستخدم على الشاشة، فلا معنى لأن تجعل كلمة مرور صحيحة «خاطئة».
 */
const INVISIBLE = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
const DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;
const DASHES = /[\u2010-\u2015\u2212\u2E3A\u2E3B\uFE58\uFE63\uFF0D]/g;
export function canonPassword(password) {
  return String(password ?? "").normalize("NFKC").replace(INVISIBLE, "")
    .replace(DIGITS, (d) => String((d.charCodeAt(0) - (d.charCodeAt(0) >= 0x06F0 ? 0x06F0 : 0x0660))))
    .replace(DASHES, "-").trim();
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(canonPassword(password), salt, KEYLEN, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

// بصمة وهمية لمساواة زمن الاستجابة عند عدم وجود المستخدم
const DUMMY = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(KEYLEN).toString("base64");

async function check(candidate, stored) {
  const [alg, N, r, p, saltB64, hashB64] = String(stored || DUMMY).split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(candidate, Buffer.from(saltB64, "base64"), expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return stored ? crypto.timingSafeEqual(actual, expected) : false;
}

/**
 * التحقق: الشكل الموحد، ثم الشكل الأصلي كما كُتب (توافق مع كلمات مرور حُفظت قبل التوحيد).
 * temporary: كلمة مرور مؤقتة من النظام (حروف كبيرة وأرقام فقط) ← لا فرق بين الحروف الكبيرة والصغيرة
 *            (لا تُضعفها: النظام لا يولّد حروفًا صغيرة أصلًا). كلمات المرور التي يختارها المستخدم تبقى حساسة لحالة الأحرف.
 * عدد المحاولات يعتمد على النص المدخل فقط وليس على الحساب، فزمن الاستجابة لا يكشف وجود الحساب أو نوع كلمة مروره.
 */
export async function verifyPassword(password, stored, { temporary = false } = {}) {
  const raw = String(password ?? "").normalize("NFKC");
  const canon = canonPassword(password);
  // بالتتابع وبلا تكرار (كل تحقق يستهلك ذاكرة كبيرة عمدًا). غالبًا الأشكال متطابقة فيكفي تحقق واحد.
  const tries = [...new Set([canon, raw, canon.toUpperCase()])];
  let exact = false, upper = false;
  for (const c of tries) {
    const hit = await check(c, stored);
    if (hit && c === canon.toUpperCase() && c !== canon && c !== raw) upper = true;
    else if (hit) exact = true;
  }
  return exact || (temporary && upper);
}
