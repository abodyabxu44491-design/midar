/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Sound and video in questions, pictures as choices, and students answering with a photo or a voice recording.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, readySchool, endPool } from "./helpers.js";
import { setTransport } from "../src/modules/shared/notify.service.js";

let srv, A, B, audio, video, pic, paperId, online;
const mp3 = Buffer.concat([Buffer.from("ID3\x03\x00\x00\x00\x00\x00\x00", "latin1"), Buffer.alloc(2000, 7)]);
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42", "latin1"), Buffer.alloc(3000, 3)]);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 1)]);
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(800, 2)]);
const b64 = (b) => b.toString("base64");
const who = (s) => A.parent(s);
const pub = (path, body) => client(srv.base).post(`/api/public/${A.id}${path}`, body);
const raw = (path, { cookie, headers = {}, body } = {}) => fetch(srv.base + path, {
  method: body ? "POST" : "GET",
  headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
  body: body ? JSON.stringify(body) : undefined,
});

before(async () => {
  srv = await startServer();
  setTransport({ push: async () => {}, sms: async () => {} });
  A = await readySchool(srv.base, { prefix: "em", students: 2 });
  B = await readySchool(srv.base, { prefix: "en", students: 1 });
});
after(async () => { setTransport(null); await srv.close(); await endPool(); });

test("رفع الصوت والفيديو: الأنواع المسموحة فقط، والمحتوى يطابق النوع، والتشغيل بالمقاطع (Range)", async () => {
  const a = await A.teacher.post("/api/teacher/papers/media", { mime: "audio/mpeg", data: b64(mp3), name: "listening.mp3" });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.equal(a.data.kind, "audio");
  audio = a.data;
  const v = await A.teacher.post("/api/teacher/papers/media", { mime: "video/quicktime", data: b64(mp4) });
  assert.equal(v.status, 201, "اسم آيفون للفيديو يُقبل كـ MP4");
  assert.equal(v.data.mime, "video/mp4");
  video = v.data;
  assert.equal((await A.teacher.post("/api/teacher/papers/media", { mime: "audio/mpeg", data: b64(png) })).status, 400, "صورة باسم صوت");
  assert.equal((await A.teacher.post("/api/teacher/papers/media", { mime: "application/pdf", data: b64(mp3) })).status, 400, "نوع غير مسموح");
  const i = await A.teacher.post("/api/teacher/papers/images", { mime: "image/png", data: b64(png) });
  assert.equal(i.status, 201);
  pic = i.data;

  const full = await raw(`/api/teacher/papers/media/${audio.id}`, { cookie: A.teacher.cookie() });
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "audio/mpeg");
  assert.equal(Buffer.from(await full.arrayBuffer()).length, mp3.length);
  const part = await raw(`/api/teacher/papers/media/${audio.id}`, { cookie: A.teacher.cookie(), headers: { Range: "bytes=0-9" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), `bytes 0-9/${mp3.length}`);
  assert.equal(Buffer.from(await part.arrayBuffer()).toString("latin1", 0, 3), "ID3");
  assert.equal((await raw(`/api/teacher/papers/media/${audio.id}`, { cookie: B.teacher.cookie() })).status, 404, "مدرسة أخرى لا ترى الملف");
});

test("الورقة: صوت وفيديو ورابط ورقم تشغيل، وصور في الخيارات، وطريقة إجابة الطالب، والروابط غير المسموحة مرفوضة", async () => {
  const content = { sections: [{ id: "s_media", title: "", instructions: "", questions: [
    { id: "q_lis1", type: "mcq", marks: 2, text: "استمع ثم اختر", media: { kind: "audio", id: audio.id, plays: 2 },
      options: [{ id: "o_pic1", text: "", image: { id: pic.id } }, { id: "o_txt1", text: "قطة" }], correct: ["o_pic1"] },
    { id: "q_vid1", type: "short", marks: 2, text: "شاهد ثم أجب", media: { kind: "video", id: video.id } },
    { id: "q_lnk1", type: "truefalse", marks: 1, text: "شاهد المقطع", media: { kind: "video", url: "https://www.youtube.com/watch?v=abcdefghijk" }, correct: true },
    { id: "q_pho1", type: "essay", marks: 3, text: "حل المسألة على الورقة وصوّرها", respond: "image" },
    { id: "q_voi1", type: "short", marks: 2, text: "اقرأ الآية بصوتك", respond: "audio" },
  ] }] };
  const bad = JSON.parse(JSON.stringify(content));
  bad.sections[0].questions[2].media.url = "https://evil.example.com/video.mp4";
  assert.equal((await A.teacher.post("/api/teacher/papers", { title: "اختبار وسائط", subject_id: A.math.id, class_id: A.c1.id, content: bad })).status, 400, "رابط من موقع غير مسموح");
  const bad2 = JSON.parse(JSON.stringify(content));
  bad2.sections[0].questions[0].media = { kind: "audio", url: "https://www.youtube.com/watch?v=abcdefghijk" };
  assert.equal((await A.teacher.post("/api/teacher/papers", { title: "اختبار وسائط", subject_id: A.math.id, class_id: A.c1.id, content: bad2 })).status, 400, "الصوت يُرفع ملفًا");

  const p = await A.teacher.post("/api/teacher/papers", { title: "اختبار وسائط", subject_id: A.math.id, class_id: A.c1.id, content });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  paperId = p.data.id;
  const saved = (await A.teacher.get(`/api/teacher/papers/${paperId}`)).data;
  const qs = (saved.paper || saved).content.sections[0].questions;
  assert.equal(qs[0].media.id, audio.id);
  assert.equal(qs[0].media.plays, 2);
  assert.equal(qs[0].options[0].image.id, pic.id);
  assert.equal(qs[3].respond, "image");
  assert.equal(qs[4].respond, "audio");

  // A clip from another school is dropped when saved.
  const other = await B.teacher.post("/api/teacher/papers/media", { mime: "audio/mpeg", data: b64(mp3) });
  const foreign = JSON.parse(JSON.stringify(content));
  foreign.sections[0].questions[0].media.id = other.data.id;
  const f = await A.teacher.post("/api/teacher/papers", { title: "اختبار وسائط 2", subject_id: A.math.id, class_id: A.c1.id, content: foreign });
  const fq = ((await A.teacher.get(`/api/teacher/papers/${f.data.id}`)).data.paper || (await A.teacher.get(`/api/teacher/papers/${f.data.id}`)).data).content.sections[0].questions[0];
  assert.equal(fq.media, null, "ملف مدرسة أخرى يُحذف من السؤال");
});

test("الطالب: يصله المقطع والصورة دون الإجابات، ويرفع صورة حله وتسجيله، والمعلم يراها ويصححها", async () => {
  assert.equal((await A.teacher.post(`/api/teacher/papers/${paperId}/status`, { action: "approve" })).status, 200);
  const r = await A.teacher.post("/api/teacher/online-exams", { paper_id: paperId, opens_at: new Date(Date.now() - 60_000).toISOString(),
    closes_at: new Date(Date.now() + 3600_000).toISOString(), duration_min: 20, show_result: "score" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  online = r.data;
  const [s1, s2] = A.students;

  assert.equal((await raw(`/api/public/${A.id}/student/online-exams/${online.id}/media`, { body: { ...who(s1), media_id: audio.id } })).status, 400, "قبل بدء الاختبار");
  const st = await pub(`/student/online-exams/${online.id}/start`, who(s1));
  assert.equal(st.status, 200, JSON.stringify(st.data));
  const q1 = st.data.content.sections[0].questions.find((q) => q.id === "q_lis1");
  assert.equal(q1.media.plays, 2);
  assert.ok(!JSON.stringify(st.data.content).includes("\"correct\""));
  assert.ok(q1.options.find((o) => o.id === "o_pic1").image.id);

  const clip = await raw(`/api/public/${A.id}/student/online-exams/${online.id}/media`, { body: { ...who(s1), media_id: audio.id } });
  assert.equal(clip.status, 200);
  assert.equal(clip.headers.get("content-type"), "audio/mpeg");
  assert.equal((await raw(`/api/public/${A.id}/student/online-exams/${online.id}/media`, { body: { ...who(s1), media_id: video.id + 999 } })).status, 404, "ملف ليس في الاختبار");
  const img = await pub(`/student/online-exams/${online.id}/image`, { ...who(s1), image_id: pic.id });
  assert.equal(img.status, 200, "صورة الخيار تصل للطالب");
  assert.ok(img.data.src.startsWith("data:image/png;base64,"));

  const up = (body) => pub(`/student/online-exams/${online.id}/answer-file`, { ...who(s1), ...body });
  assert.equal((await up({ question_id: "q_pho1", mime: "image/jpeg", data: b64(jpg) })).status, 200);
  assert.equal((await up({ question_id: "q_voi1", mime: "audio/webm;codecs=opus", data: b64(webm) })).status, 200, "تسجيل المتصفح بصيغته");
  assert.equal((await up({ question_id: "q_pho1", mime: "audio/webm", data: b64(webm) })).status, 400, "السؤال يُجاب بصورة");
  assert.equal((await up({ question_id: "q_lis1", mime: "image/jpeg", data: b64(jpg) })).status, 400, "سؤال لا يقبل ملفًا");
  assert.equal((await up({ question_id: "q_pho1", mime: "image/jpeg", data: b64(mp3) })).status, 400, "المحتوى لا يطابق النوع");
  const mine = await raw(`/api/public/${A.id}/student/online-exams/${online.id}/answer-file/view`, { body: { ...who(s1), question_id: "q_pho1" } });
  assert.equal(mine.status, 200);
  assert.equal(mine.headers.get("content-type"), "image/jpeg");
  assert.equal((await raw(`/api/public/${A.id}/student/online-exams/${online.id}/answer-file/view`, { body: { ...who(s2), question_id: "q_pho1" } })).status, 404, "طالب آخر لا يرى ملف زميله");

  const answers = { q_lis1: "o_pic1", q_vid1: "الإجابة", q_lnk1: true, q_pho1: { file: "image" }, q_voi1: { file: "audio" } };
  const sub = await pub(`/student/online-exams/${online.id}/submit`, { ...who(s1), answers });
  assert.equal(sub.status, 200, JSON.stringify(sub.data));
  assert.equal(sub.data.pending, true);
  assert.equal((await up({ question_id: "q_pho1", mime: "image/jpeg", data: b64(jpg) })).status, 400, "لا رفع بعد التسليم");

  const res = (await A.teacher.get(`/api/teacher/online-exams/${online.id}`)).data;
  const att = res.students.find((s) => s.attempt_id && s.submitted_at);
  const det = (await A.teacher.get(`/api/teacher/online-exams/${online.id}/attempts/${att.attempt_id}`)).data;
  const pho = det.questions.find((q) => q.id === "q_pho1");
  assert.equal(pho.file, true);
  assert.equal(pho.respond, "image");
  assert.equal(det.questions.find((q) => q.id === "q_lis1").media.id, audio.id);
  const file = await raw(`/api/teacher/online-exams/${online.id}/attempts/${att.attempt_id}/files/q_voi1`, { cookie: A.teacher.cookie() });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "audio/webm");
  const asset = await raw(`/api/teacher/online-exams/${online.id}/assets/media/${video.id}`, { cookie: A.teacher.cookie() });
  assert.equal(asset.status, 200);
  assert.equal((await raw(`/api/admin/online-exams/${online.id}/attempts/${att.attempt_id}/files/q_voi1`, { cookie: B.admin.cookie() })).status, 404, "مدرسة أخرى");
  const g = await A.teacher.put(`/api/teacher/online-exams/${online.id}/attempts/${att.attempt_id}/marks`, { marks: { q_vid1: 2, q_pho1: 3, q_voi1: 1.5 } });
  assert.equal(g.status, 200, JSON.stringify(g.data));
  assert.equal(g.data.needs_grading, false);
  assert.equal(g.data.score, 2 + 2 + 1 + 3 + 1.5);
});
