// تثبيت التطبيق حسب الدور، وصفحة المدرسة مفتوحة للجميع بلا رمز
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, uid, ownerPassword, ownerPath, endPool } from "./helpers.js";
import { currentTotp } from "../src/core/auth/totp.js";

let srv, id;
const NAME = "مدرسة التطبيق";

before(async () => {
  srv = await startServer();
  const owner = client(srv.base);
  const otp = process.env.OWNER_TOTP_SECRET ? currentTotp(process.env.OWNER_TOTP_SECRET) : undefined;
  assert.equal((await owner.post("/api/owner/login", { username: process.env.OWNER_USERNAME, password: ownerPassword, code: otp })).status, 200);
  id = `app-${uid()}`;
  assert.equal((await owner.post("/api/owner/tenants", { id, name: NAME })).status, 201);
});
after(async () => { await srv.close(); await endPool(); });

const html = async (p) => (await fetch(`${srv.base}${p}`)).text();
const manifestHref = (s) => s.match(/<link rel="manifest" href="([^"]+)"/)?.[1];
const manifest = async (href) => {
  const r = await fetch(`${srv.base}${href.startsWith("/") ? href : `${ownerPath}/${href}`}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /manifest\+json/);
  return r.json();
};

test("كل صفحة تشير لتطبيق صاحبها: ولي الأمر لصفحة المدرسة، وكل دور من المنسوبين للوحته", async () => {
  const cases = [
    [`/${id}`, "parent"], [`/${id}/student`, "parent"], [`/${id}/idara`, "staff"],
    [`/${id}/idara?role=admin`, "admin"], [`/${id}/idara?role=teacher`, "teacher"], [`/${id}/idara?role=accountant`, "accountant"],
    [`/${id}/idara?role=owner`, "staff"],
  ];
  for (const [page, as] of cases) assert.equal(manifestHref(await html(page)), `/${id}/app.webmanifest?as=${as}`, page);

  const parent = await manifest(`/${id}/app.webmanifest?as=parent`);
  assert.equal(parent.start_url, `/${id}`);
  assert.equal(parent.name, NAME, "تطبيق ولي الأمر باسم المدرسة");
  const ids = new Set([parent.id]);
  for (const role of ["admin", "teacher", "accountant"]) {
    const m = await manifest(`/${id}/app.webmanifest?as=${role}`);
    assert.equal(m.start_url, `/${id}/idara?role=${role}`, "يفتح على لوحة الدور مباشرة");
    assert.ok(m.start_url.startsWith(m.scope));
    assert.ok(m.name.includes(NAME));
    ids.add(m.id);
  }
  assert.equal(ids.size, 4, "تطبيقات مستقلة: يمكن تثبيت أكثر من واحد على الجهاز نفسه");
});

test("تطبيق المالك يفتح لوحة المالك على رابطها السري", async () => {
  const href = manifestHref(await html(`${ownerPath}/`));
  assert.equal(href, "app.webmanifest");
  const m = await manifest(href);
  assert.equal(m.start_url, `${ownerPath}/`);
  assert.equal(m.scope, `${ownerPath}/`);
});

test("صفحة المدرسة مفتوحة للجميع بلا رمز، وملف الطالب يبقى بمعرّفه فقط", async () => {
  const anon = client(srv.base);
  assert.equal((await anon.post(`/api/public/${id}/home`, {})).status, 200);
  assert.equal((await anon.post(`/api/public/${id}/structure`, {})).status, 200);
  assert.ok([400, 401].includes((await anon.post(`/api/public/${id}/student`, { student_id: 1, key: "WRONGKEY" })).status), "ملف الطالب بلا معرّفه الصحيح مرفوض");
});
