// تشفير كلمات المرور بخوارزمية scrypt (مدمجة في Node.js، مقاومة لهجمات التخمين)
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

// الصيغة: scrypt$N$r$p$salt$hash
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password).normalize("NFKC"), salt, KEYLEN, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

// بصمة وهمية لمساواة زمن الاستجابة عند عدم وجود المستخدم
const DUMMY = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(KEYLEN).toString("base64");

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, saltB64, hashB64] = String(stored || DUMMY).split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(String(password ?? "").normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return stored ? crypto.timingSafeEqual(actual, expected) : false;
}
