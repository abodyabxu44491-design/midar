/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// A minimal SMTP server for tests that run against a separate server process (TEST_BASE_URL, e.g. the Workers build):
// the platform sends real email over SMTP, and each message is decoded into { to, subject, text } like the
// in-process test transport records it. Local only, no TLS, no authentication.
import net from "node:net";

const decodeWords = (s) => s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=\s*/g, (all, cs, enc, data) =>
  enc.toUpperCase() === "B" ? Buffer.from(data, "base64").toString("utf8")
    : Buffer.from(data.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8"));

function splitHeaders(raw) {
  const i = raw.search(/\r?\n\r?\n/);
  const head = (i < 0 ? raw : raw.slice(0, i)).replace(/\r?\n[ \t]+/g, " ");
  const body = i < 0 ? "" : raw.slice(i).replace(/^\r?\n\r?\n/, "");
  const headers = {};
  for (const line of head.split(/\r?\n/)) {
    const j = line.indexOf(":");
    if (j > 0) headers[line.slice(0, j).trim().toLowerCase()] = line.slice(j + 1).trim();
  }
  return { headers, body };
}

function decodeBody(headers, body) {
  const cte = (headers["content-transfer-encoding"] || "").toLowerCase();
  if (cte === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  if (cte === "quoted-printable") {
    const bytes = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(bytes, "latin1").toString("utf8");
  }
  return body;
}

function findPart(headers, body, type) {
  const ct = headers["content-type"] || "text/plain";
  const boundary = ct.match(/boundary="?([^";]+)"?/i)?.[1];
  if (!/^multipart\//i.test(ct) || !boundary) return ct.toLowerCase().startsWith(type) ? decodeBody(headers, body) : null;
  for (const part of body.split(`--${boundary}`).slice(1)) {
    if (part.startsWith("--")) break;
    const p = splitHeaders(part.replace(/^\r?\n/, ""));
    const found = findPart(p.headers, p.body, type);
    if (found != null) return found;
  }
  return null;
}

export function parseMessage(raw) {
  const { headers, body } = splitHeaders(raw);
  const address = (v) => (decodeWords(v || "").match(/<([^>]+)>/)?.[1] || decodeWords(v || "")).trim();
  return {
    to: address(headers.to),
    subject: decodeWords(headers.subject || ""),
    text: (findPart(headers, body, "text/plain") || "").replace(/\r\n/g, "\n"),
    html: findPart(headers, body, "text/html") || undefined,
  };
}

export function startSmtpSink(onMessage) {
  const server = net.createServer((socket) => {
    let buf = "", inData = false;
    const say = (l) => socket.write(`${l}\r\n`);
    say("220 midar-test-sink ESMTP");
    socket.on("data", (chunk) => {
      buf += chunk.toString("latin1");
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          const raw = Buffer.from(buf.slice(0, end).replace(/\r\n\.\./g, "\r\n."), "latin1").toString("utf8");
          buf = buf.slice(end + 5);
          inData = false;
          onMessage(parseMessage(raw));
          say("250 OK queued");
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO") { say("250-midar-test-sink"); say("250 8BITMIME"); }
        else if (cmd === "HELO") say("250 midar-test-sink");
        else if (cmd === "DATA") { inData = true; say("354 End data with <CR><LF>.<CR><LF>"); }
        else if (cmd === "QUIT") { say("221 Bye"); socket.end(); return; }
        else say("250 OK");
      }
    });
    socket.on("error", () => {});
  });
  server.unref();   // never keeps the test process alive
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, close: () => server.close() })));
}
