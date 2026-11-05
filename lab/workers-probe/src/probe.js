// Runs Midar's real modules and libraries inside the Workers runtime, so a Node test can check their output.
import "./setup.js";
// Local only (wrangler dev), never deployed, no real data or keys.
import webpush from "web-push";
import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import { hashPassword, verifyPassword } from "../../../src/core/auth/password.js";
import { createBox } from "../../../src/core/auth/secret-box.js";
import { assertPublicHttps } from "../../../src/core/http/safe-url.js";
import { buildXlsx } from "../../../src/core/xlsx.js";

const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const err = (e) => ({ name: e?.name, message: String(e?.message || e).slice(0, 300), statusCode: e?.statusCode ?? e?.status });
const cpu = async (fn) => { const t = performance.now(); const r = await fn(); return [r, Math.round(performance.now() - t)]; };

export default {
  async fetch(req) {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json() : {};
    try {
      switch (url.pathname) {
        // Passwords hashed on Node must verify on Workers, and the other way round.
        case "/password": {
          const [ok] = await cpu(() => verifyPassword(body.password, body.hash));
          const [wrong] = await cpu(() => verifyPassword(`${body.password}x`, body.hash));
          const [made, ms] = await cpu(() => hashPassword(body.password));
          return json({ ok, wrong, made, hash_ms: ms });
        }
        // Secrets sealed on Node (SMS gateway headers, mail password) must open on Workers.
        case "/secret": {
          const box = createBox(body.key);
          return json({ opened: box.open(body.sealed, body.aad), sealed: box.seal(body.plain, body.aad) });
        }
        // The SSRF guard of the SMS gateway: public https allowed, local and private addresses refused.
        case "/safe-url": {
          const out = {};
          for (const u of body.urls) { try { await assertPublicHttps(u); out[u] = "allowed"; } catch (e) { out[u] = `refused: ${e.message}`; } }
          return json(out);
        }
        // Web push: the encrypted request exactly as it would be sent; the test decrypts it with the device's key.
        case "/push-encrypt": {
          const details = webpush.generateRequestDetails(body.subscription, body.payload, {
            vapidDetails: { subject: "mailto:lab@midar.test", publicKey: body.vapid.publicKey, privateKey: body.vapid.privateKey }, TTL: 60 });
          return json({ endpoint: details.endpoint, headers: details.headers, body: Buffer.from(details.body).toString("base64") });
        }
        // Web push over the network through node:https (the push service answers; any HTTP status proves the path).
        case "/push-send": {
          try {
            const r = await webpush.sendNotification(body.subscription, "probe", { vapidDetails: { subject: "mailto:lab@midar.test", ...body.vapid }, timeout: 10_000 });
            return json({ sent: true, statusCode: r.statusCode });
          } catch (e) { return json({ sent: false, ...err(e) }); }
        }
        // Google and Apple ID tokens: a public JWK and an RS256 signature, as oauth.service verifies them.
        case "/jwt": {
          const [h, p, s] = body.token.split(".");
          const key = crypto.createPublicKey({ key: body.jwk, format: "jwk" });
          const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"));
          const forged = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}x`), key, Buffer.from(s, "base64url"));
          return json({ ok, forged });
        }
        // The AI assistant SDK reaches Anthropic's API (an invalid key must come back as a clean 401).
        case "/anthropic": {
          try {
            await new Anthropic({ apiKey: "sk-ant-invalid-lab-key" }).messages.create({ model: "claude-haiku-5-5", max_tokens: 5, messages: [{ role: "user", content: "hi" }] });
            return json({ reached: true, status: 200 });
          } catch (e) { return json({ reached: Boolean(e?.status), ...err(e) }); }
        }
        case "/dns": {
          const out = {};
          for (const f of ["resolve4", "lookup"]) { try { out[f] = await dns[f](body.host); } catch (e) { out[f] = err(e); } }
          try { const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${body.host}&type=A`, { headers: { accept: "application/dns-json" } }); out.doh_fetch = r.status; } catch (e) { out.doh_fetch = err(e); }
          return json(out);
        }
        // Excel export built on Workers must be byte-identical to the one built on Node.
        case "/xlsx": {
          const buf = buildXlsx(body.sheets);
          return json({ sha256: crypto.createHash("sha256").update(buf).digest("hex"), size: buf.length });
        }
      }
      return json({ error: "not_found" }, 404);
    } catch (e) { return json({ error: err(e) }, 500); }
  },
};
