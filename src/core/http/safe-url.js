/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Outbound requests to an address a school typed (its own SMS gateway): only public https hosts. The host is
// resolved first and every address it resolves to must be public, so the server cannot be pointed at itself,
// the hosting network or a cloud metadata address.
import dns from "node:dns/promises";
import net from "node:net";
import { badRequest } from "./errors.js";

const PRIVATE_V4 = [["10.0.0.0", 8], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16],
  ["100.64.0.0", 10], ["0.0.0.0", 8], ["192.0.0.0", 24], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]];
const v4num = (ip) => ip.split(".").reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
function isPrivate(ip) {
  if (net.isIPv4(ip)) return PRIVATE_V4.some(([base, bits]) => (v4num(ip) >>> (32 - bits)) === (v4num(base) >>> (32 - bits)));
  const x = ip.toLowerCase();
  if (x.startsWith("::ffff:")) return isPrivate(x.slice(7));
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80") || x.startsWith("ff");
}

export async function assertPublicHttps(raw) {
  let u;
  try { u = new URL(raw); } catch { throw badRequest("رابط البوابة غير صحيح"); }
  if (u.protocol !== "https:" || u.username || u.password) throw badRequest("رابط البوابة يجب أن يبدأ بـ https:// بلا اسم مستخدم");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw badRequest("تعذر الوصول إلى عنوان البوابة");
  if (addrs.some((a) => isPrivate(a.address))) throw badRequest("عنوان البوابة يجب أن يكون عنوانًا عامًا على الإنترنت");
  return u;
}
export const _isPrivate = isPrivate;
