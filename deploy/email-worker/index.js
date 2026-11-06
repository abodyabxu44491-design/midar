/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Cloudflare Email Routing sends every message for info@, support@, sales@ and admin@ to this Worker. It forwards the
// message to the owner's mailbox FIRST (so no message is ever lost), then posts its text to the platform, signed with
// INBOUND_EMAIL_SECRET, where it appears in the owner's inbox with a status.
//
// Settings (wrangler.jsonc vars, and one secret):
//   FORWARD_TO           the verified destination address (Email Routing → Destination addresses)
//   PLATFORM_URL         https://midarschool.com
//   INBOUND_EMAIL_SECRET wrangler secret put INBOUND_EMAIL_SECRET   (the same value as on the platform)
import PostalMime from "postal-mime";

const MAX_TEXT = 10000;

async function sign(secret, body) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Plain text of the message: the text part, or the HTML part without its tags.
export function textOf(mail) {
  if (mail.text) return mail.text;
  return String(mail.html || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

export async function record(message, env, raw) {
  const mail = await PostalMime.parse(raw);
  const body = JSON.stringify({
    to: message.to, from: mail.from?.address || message.from, from_name: mail.from?.name || "",
    subject: mail.subject || "", text: textOf(mail).slice(0, MAX_TEXT),
    message_id: mail.messageId || message.headers.get("message-id") || "", sent_at: Date.now(),
  });
  const res = await fetch(`${env.PLATFORM_URL.replace(/\/+$/, "")}/api/inbound/email`, {
    method: "POST", headers: { "content-type": "application/json", "x-midar-signature": `sha256=${await sign(env.INBOUND_EMAIL_SECRET, body)}` }, body,
  });
  if (!res.ok) throw new Error(`platform ${res.status}`);
  return res.json();
}

export default {
  async email(message, env, ctx) {
    // The raw message is read once, before forwarding consumes the stream.
    const raw = await new Response(message.raw).arrayBuffer();
    await message.forward(env.FORWARD_TO);
    if (env.PLATFORM_URL && env.INBOUND_EMAIL_SECRET) {
      // A failure here never loses the message: it is already in the mailbox. It is only logged.
      ctx.waitUntil(record(message, env, raw).catch((e) => console.error("record failed:", e.message)));
    }
  },
};
