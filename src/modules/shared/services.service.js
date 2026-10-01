// الخدمات: النقل المدرسي، المكتبة، العهد والمخزون، العيادة المدرسية
import { z, t } from "../../core/http/validate.js";
import { badRequest, notFound, conflict } from "../../core/http/errors.js";
import { notify } from "./notify.service.js";
import { featureSettings } from "./feature-settings.service.js";
import { createInvoices } from "./finance.service.js";

const opt = (max) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const localDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Aden" });
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/* ===================== النقل المدرسي ===================== */
export const busSchema = z.object({
  name: z.string().trim().min(1, "اكتب اسم الحافلة أو الخط").max(60),
  plate: opt(30), driver_name: opt(80), driver_phone: t.phone, supervisor: opt(80),
  capacity: z.union([z.coerce.number().int().min(1).max(200), z.literal(""), z.null()]).optional().transform((v) => (v === "" ? null : v ?? null)),
  route: opt(1000),
  fee: z.union([z.coerce.number().min(0).max(10_000_000), z.literal(""), z.null()]).optional().transform((v) => (v === "" ? null : v ?? null)),
  is_active: z.boolean().optional(),
});
export const buses = (q) => q(
  `SELECT b.*, (SELECT count(*) FROM bus_students x JOIN students s ON s.id = x.student_id WHERE x.bus_id = b.id AND s.archived_at IS NULL)::int AS riders
     FROM buses b ORDER BY b.is_active DESC, b.name`);
export async function saveBus(q, b, id = null) {
  const [dup] = await q("SELECT id FROM buses WHERE name = $1 AND ($2::bigint IS NULL OR id <> $2)", [b.name, id]);
  if (dup) throw conflict("يوجد خط بنفس الاسم");
  const vals = [b.name, b.plate, b.driver_name, b.driver_phone ?? null, b.supervisor, b.capacity, b.route, b.fee];
  if (id) {
    const r = await q(`UPDATE buses SET name = $2, plate = $3, driver_name = $4, driver_phone = $5, supervisor = $6, capacity = $7, route = $8, fee = $9,
      is_active = COALESCE($10, is_active) WHERE id = $1 RETURNING id`, [id, ...vals, b.is_active ?? null]);
    if (!r.length) throw notFound("الحافلة غير موجودة");
    return r[0];
  }
  return (await q(`INSERT INTO buses (tenant_id, name, plate, driver_name, driver_phone, supervisor, capacity, route, fee)
    VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, vals))[0];
}
export async function removeBus(q, id) {
  const [used] = await q("SELECT 1 FROM bus_students WHERE bus_id = $1 LIMIT 1", [id]);
  if (used) throw conflict("في الحافلة طلاب. انقلهم أو أوقف الحافلة بدل حذفها.");
  const r = await q("DELETE FROM buses WHERE id = $1 RETURNING id", [id]);
  if (!r.length) throw notFound("الحافلة غير موجودة");
}

export const ridersOf = (q, busId) => q(
  `SELECT x.student_id, s.full_name AS name, c.name AS class_name, x.stop, x.direction, x.pickup_time, s.guardian_phone
     FROM bus_students x JOIN students s ON s.id = x.student_id LEFT JOIN classes c ON c.id = s.class_id
    WHERE x.bus_id = $1 AND s.archived_at IS NULL ORDER BY x.stop NULLS LAST, s.full_name`, [busId]);

export const assignSchema = z.object({ student_ids: z.array(t.id).min(1).max(300), stop: opt(120),
  direction: z.enum(["both", "to_school", "from_school"]).default("both"), pickup_time: opt(20) });
export async function assignRiders(q, busId, b) {
  const [bus] = await q("SELECT id, capacity FROM buses WHERE id = $1 AND is_active", [busId]);
  if (!bus) throw notFound("الحافلة غير موجودة أو موقوفة");
  const st = await q("SELECT id FROM students WHERE id = ANY($1) AND archived_at IS NULL", [b.student_ids]);
  if (st.length !== new Set(b.student_ids).size) throw notFound("أحد الطلاب غير موجود");
  if (bus.capacity) {
    const [{ n }] = await q("SELECT count(*)::int AS n FROM bus_students WHERE bus_id = $1 AND NOT (student_id = ANY($2))", [busId, b.student_ids]);
    if (n + b.student_ids.length > bus.capacity) throw badRequest(`الحافلة تتسع لـ ${bus.capacity} طالبًا فقط`);
  }
  for (const sid of b.student_ids) {
    await q(`INSERT INTO bus_students (tenant_id, bus_id, student_id, stop, direction, pickup_time) VALUES (app_tenant(), $1, $2, $3, $4, $5)
             ON CONFLICT (student_id) DO UPDATE SET bus_id = EXCLUDED.bus_id, stop = EXCLUDED.stop, direction = EXCLUDED.direction, pickup_time = EXCLUDED.pickup_time`,
      [busId, sid, b.stop, b.direction, b.pickup_time]);
  }
  return { assigned: b.student_ids.length };
}
export const unassignRider = (q, studentId) => q("DELETE FROM bus_students WHERE student_id = $1", [studentId]);

const EVENT_TEXT = { boarded: "صعد الحافلة", arrived: "وصل المدرسة", left: "غادر المدرسة بالحافلة", dropped: "نزل من الحافلة عند محطته", absent: "لم يحضر للحافلة" };
export const eventSchema = z.object({ kind: z.enum(Object.keys(EVENT_TEXT)), student_ids: z.array(t.id).min(1).max(200) });
export async function recordBusEvent(q, busId, b, actor) {
  const riders = new Set((await ridersOf(q, busId)).map((r) => Number(r.student_id)));
  const ids = b.student_ids.filter((id) => riders.has(Number(id)));
  if (!ids.length) throw badRequest("الطلاب ليسوا من ركاب هذه الحافلة");
  const day = localDay();
  const fresh = [];
  for (const sid of ids) {
    const r = await q(`INSERT INTO bus_events (tenant_id, bus_id, student_id, day, kind, recorded_by) VALUES (app_tenant(), $1, $2, $3, $4, $5)
      ON CONFLICT (student_id, day, kind) DO NOTHING RETURNING student_id`, [busId, sid, day, b.kind, actor]);
    if (r.length) fresh.push(sid);
  }
  if (fresh.length && (await featureSettings(q, "transport")).notify_parent) {
    const names = new Map((await q("SELECT id, full_name FROM students WHERE id = ANY($1)", [fresh])).map((s) => [Number(s.id), s.full_name]));
    const time = new Date().toLocaleTimeString("ar-SA-u-nu-latn", { timeZone: "Asia/Aden", hour: "numeric", minute: "2-digit" });
    for (const sid of fresh) await notify(q, { event: "transport", students: [sid], title: `${names.get(Number(sid))} ${EVENT_TEXT[b.kind]}`, body: `الساعة ${time}`, link: "transport" });
  }
  return { recorded: fresh.length };
}
export const busDay = (q, busId, day) => q("SELECT student_id, kind, at FROM bus_events WHERE bus_id = $1 AND day = $2", [busId, day]);

/** فواتير رسوم النقل لركاب الحافلة (بند واحد لكل طالب) */
export async function billRiders(q, busId, { title, due_date }, actor) {
  const [bus] = await q("SELECT name, fee FROM buses WHERE id = $1", [busId]);
  if (!bus) throw notFound("الحافلة غير موجودة");
  if (!bus.fee) throw badRequest("حدد رسوم النقل للحافلة أولًا");
  const riders = await ridersOf(q, busId);
  if (!riders.length) throw badRequest("لا يوجد ركاب");
  let n = 0;
  for (const r of riders) n += await createInvoices(q, { target: "student", target_id: r.student_id, title: title || `رسوم النقل — ${bus.name}`, amount: bus.fee, due_date: due_date || null }, actor);
  return { invoices: n };
}

export async function transportOf(q, studentId) {
  const [x] = await q(`SELECT b.name, b.driver_name, b.driver_phone, b.supervisor, b.plate, x.stop, x.direction, x.pickup_time
    FROM bus_students x JOIN buses b ON b.id = x.bus_id WHERE x.student_id = $1`, [studentId]);
  if (!x) return null;
  const events = await q("SELECT kind, at FROM bus_events WHERE student_id = $1 AND day >= CURRENT_DATE - 6 ORDER BY at DESC LIMIT 20", [studentId]);
  return { ...x, events: events.map((e) => ({ ...e, text: EVENT_TEXT[e.kind] })) };
}

/* ===================== المكتبة ===================== */
export const bookSchema = z.object({ title: z.string().trim().min(1).max(200), author: opt(120), isbn: opt(20), category: opt(60), shelf: opt(30),
  copies: z.coerce.number().int().min(0).max(10000).default(1), notes: opt(300) });
export const books = (q, search = null) => q(
  `SELECT b.*, (SELECT count(*) FROM library_loans l WHERE l.book_id = b.id AND l.returned_on IS NULL)::int AS out
     FROM library_books b WHERE ($1::text IS NULL OR b.title ILIKE '%' || $1 || '%' OR b.author ILIKE '%' || $1 || '%' OR b.isbn = $1)
    ORDER BY b.title LIMIT 500`, [search]);
export async function saveBook(q, b, id = null) {
  const vals = [b.title, b.author, b.isbn, b.category, b.shelf, b.copies, b.notes];
  if (id) {
    const [{ out } = { out: 0 }] = await q("SELECT count(*)::int AS out FROM library_loans WHERE book_id = $1 AND returned_on IS NULL", [id]);
    if (b.copies < out) throw badRequest(`لا يمكن أن تقل النسخ عن المعار حاليًا (${out})`);
    const r = await q(`UPDATE library_books SET title = $2, author = $3, isbn = $4, category = $5, shelf = $6, copies = $7, notes = $8 WHERE id = $1 RETURNING id`, [id, ...vals]);
    if (!r.length) throw notFound("الكتاب غير موجود");
    return r[0];
  }
  return (await q(`INSERT INTO library_books (tenant_id, title, author, isbn, category, shelf, copies, notes) VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`, vals))[0];
}
export async function removeBook(q, id) {
  const [out] = await q("SELECT 1 FROM library_loans WHERE book_id = $1 AND returned_on IS NULL LIMIT 1", [id]);
  if (out) throw conflict("الكتاب معار حاليًا");
  const r = await q("DELETE FROM library_books WHERE id = $1 RETURNING id", [id]);
  if (!r.length) throw notFound("الكتاب غير موجود");
}

export const loanSchema = z.object({ book_id: t.id, student_id: t.optId, staff_id: t.optId, due_on: t.optDate, note: opt(200) });
export async function lend(q, b, actor) {
  if (!b.student_id === !b.staff_id) throw badRequest("اختر طالبًا أو موظفًا");
  const [book] = await q(`SELECT b.title, b.copies, (SELECT count(*) FROM library_loans l WHERE l.book_id = b.id AND l.returned_on IS NULL)::int AS out
    FROM library_books b WHERE b.id = $1 FOR UPDATE`, [b.book_id]);
  if (!book) throw notFound("الكتاب غير موجود");
  if (book.out >= book.copies) throw conflict("لا توجد نسخة متاحة من هذا الكتاب");
  const s = await featureSettings(q, "library");
  if (b.student_id) {
    const [st] = await q("SELECT id FROM students WHERE id = $1 AND archived_at IS NULL", [b.student_id]);
    if (!st) throw notFound("الطالب غير موجود");
    const [{ n }] = await q("SELECT count(*)::int AS n FROM library_loans WHERE student_id = $1 AND returned_on IS NULL", [b.student_id]);
    if (n >= s.max_loans) throw badRequest(`الحد الأقصى ${s.max_loans} كتب معارة للطالب في وقت واحد`);
  } else {
    const [sf] = await q("SELECT id FROM staff WHERE id = $1", [b.staff_id]);
    if (!sf) throw notFound("الموظف غير موجود");
  }
  const due = b.due_on || addDays(localDay(), s.loan_days);
  const [row] = await q(`INSERT INTO library_loans (tenant_id, book_id, student_id, staff_id, loaned_on, due_on, note, created_by)
    VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7) RETURNING id`, [b.book_id, b.student_id ?? null, b.staff_id ?? null, localDay(), due, b.note, actor]);
  return { id: row.id, due_on: due };
}
export async function returnLoan(q, id) {
  const r = await q("UPDATE library_loans SET returned_on = $2 WHERE id = $1 AND returned_on IS NULL RETURNING id", [id, localDay()]);
  if (!r.length) throw notFound("الإعارة غير موجودة أو مُرجعة");
}
export const loans = (q, { open = true } = {}) => q(
  `SELECT l.id, l.book_id, b.title, l.student_id, s.full_name AS student, c.name AS class_name, l.staff_id, sf.full_name AS staff,
          l.loaned_on::text, l.due_on::text, l.returned_on::text, l.note, (l.returned_on IS NULL AND l.due_on < CURRENT_DATE) AS overdue
     FROM library_loans l JOIN library_books b ON b.id = l.book_id LEFT JOIN students s ON s.id = l.student_id
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN staff sf ON sf.id = l.staff_id
    WHERE ($1 = false OR l.returned_on IS NULL) ORDER BY l.returned_on NULLS FIRST, l.due_on LIMIT 500`, [open]);
export const loansOf = (q, studentId) => q(
  `SELECT b.title, l.loaned_on::text, l.due_on::text, l.returned_on::text, (l.returned_on IS NULL AND l.due_on < CURRENT_DATE) AS overdue
     FROM library_loans l JOIN library_books b ON b.id = l.book_id WHERE l.student_id = $1 ORDER BY l.loaned_on DESC LIMIT 30`, [studentId]);

/* ===================== العهد والمخزون ===================== */
export const itemSchema = z.object({ name: z.string().trim().min(1).max(120), category: opt(60), unit: z.string().trim().min(1).max(20).default("قطعة"),
  min_quantity: z.coerce.number().min(0).max(1e9).default(0), location: opt(80), note: opt(300) });
export const items = (q) => q(
  `SELECT i.*, COALESCE((SELECT sum(CASE WHEN m.kind = 'custody' THEN m.qty ELSE -m.qty END) FROM inventory_moves m
             WHERE m.item_id = i.id AND m.kind IN ('custody', 'return')), 0) AS in_custody
     FROM inventory_items i ORDER BY (i.quantity <= i.min_quantity AND i.min_quantity > 0) DESC, i.name`);
export async function saveItem(q, b, id = null) {
  const [dup] = await q("SELECT id FROM inventory_items WHERE name = $1 AND ($2::bigint IS NULL OR id <> $2)", [b.name, id]);
  if (dup) throw conflict("يوجد صنف بنفس الاسم");
  const vals = [b.name, b.category, b.unit, b.min_quantity, b.location, b.note];
  if (id) {
    const r = await q("UPDATE inventory_items SET name = $2, category = $3, unit = $4, min_quantity = $5, location = $6, note = $7 WHERE id = $1 RETURNING id", [id, ...vals]);
    if (!r.length) throw notFound("الصنف غير موجود");
    return r[0];
  }
  return (await q("INSERT INTO inventory_items (tenant_id, name, category, unit, min_quantity, location, note) VALUES (app_tenant(), $1, $2, $3, $4, $5, $6) RETURNING id", vals))[0];
}
export const moveSchema = z.object({ kind: z.enum(["in", "out", "custody", "return", "adjust"]), qty: z.coerce.number().positive("الكمية أكبر من صفر").max(1e9),
  staff_id: t.optId, note: opt(300), set_to: z.coerce.number().min(0).optional() });
// in: إضافة للمخزون، out: صرف (استهلاك)، custody: تسليم عهدة لموظف (تنقص من المخزون)، return: إرجاع عهدة (تعود للمخزون)، adjust: جرد (تعيين الكمية)
export async function move(q, itemId, b, actor) {
  const [it] = await q("SELECT id, quantity, name FROM inventory_items WHERE id = $1 FOR UPDATE", [itemId]);
  if (!it) throw notFound("الصنف غير موجود");
  if ((b.kind === "custody" || b.kind === "return") && !b.staff_id) throw badRequest("اختر الموظف");
  let next = Number(it.quantity);
  if (b.kind === "in") next += b.qty;
  else if (b.kind === "out" || b.kind === "custody") next -= b.qty;
  else if (b.kind === "return") {
    const [{ held }] = await q(`SELECT COALESCE(sum(CASE WHEN kind = 'custody' THEN qty ELSE -qty END), 0) AS held FROM inventory_moves
      WHERE item_id = $1 AND staff_id = $2 AND kind IN ('custody', 'return')`, [itemId, b.staff_id]);
    if (b.qty > Number(held)) throw badRequest(`عهدة الموظف من هذا الصنف ${held} فقط`);
    next += b.qty;
  } else next = b.qty;   // جرد: الكمية الفعلية
  if (next < 0) throw badRequest(`الكمية المتوفرة ${it.quantity} فقط`);
  await q("UPDATE inventory_items SET quantity = $2 WHERE id = $1", [itemId, next]);
  await q(`INSERT INTO inventory_moves (tenant_id, item_id, kind, qty, staff_id, note, created_by) VALUES (app_tenant(), $1, $2, $3, $4, $5, $6)`,
    [itemId, b.kind, b.qty, b.staff_id ?? null, b.note, actor]);
  return { quantity: next };
}
export const moves = (q, itemId) => q(
  `SELECT m.id, m.kind, m.qty, m.day::text, m.note, m.created_by, s.full_name AS staff FROM inventory_moves m LEFT JOIN staff s ON s.id = m.staff_id
    WHERE ($1::bigint IS NULL OR m.item_id = $1) ORDER BY m.id DESC LIMIT 200`, [itemId]);
export const custodyByStaff = (q) => q(
  `SELECT s.id AS staff_id, s.full_name, i.name AS item, i.unit, sum(CASE WHEN m.kind = 'custody' THEN m.qty ELSE -m.qty END) AS qty
     FROM inventory_moves m JOIN staff s ON s.id = m.staff_id JOIN inventory_items i ON i.id = m.item_id
    WHERE m.kind IN ('custody', 'return') GROUP BY s.id, i.id HAVING sum(CASE WHEN m.kind = 'custody' THEN m.qty ELSE -m.qty END) > 0
    ORDER BY s.full_name, i.name`);

/* ===================== العيادة ===================== */
export const healthSchema = z.object({
  blood_type: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).optional().nullable().or(z.literal("").transform(() => null)),
  allergies: opt(500), chronic: opt(500), medications: opt(500), emergency_phone: t.phone, notes: opt(1000) });
export async function saveHealth(q, studentId, b, actor) {
  const [st] = await q("SELECT id FROM students WHERE id = $1", [studentId]);
  if (!st) throw notFound("الطالب غير موجود");
  await q(`INSERT INTO health_profiles (tenant_id, student_id, blood_type, allergies, chronic, medications, emergency_phone, notes, updated_by)
           VALUES (app_tenant(), $1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (student_id) DO UPDATE SET blood_type = EXCLUDED.blood_type, allergies = EXCLUDED.allergies, chronic = EXCLUDED.chronic,
             medications = EXCLUDED.medications, emergency_phone = EXCLUDED.emergency_phone, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [studentId, b.blood_type ?? null, b.allergies, b.chronic, b.medications, b.emergency_phone ?? null, b.notes, actor]);
}
export const visitSchema = z.object({ student_id: t.id, complaint: t.shortText("الشكوى", 300), action: opt(500),
  temperature: z.union([z.coerce.number().min(30).max(45), z.literal(""), z.null()]).optional().transform((v) => (v === "" ? null : v ?? null)),
  sent_home: z.boolean().default(false), notify_parent: z.boolean().default(true) });
export async function addVisit(q, b, actor) {
  const [st] = await q("SELECT id, full_name FROM students WHERE id = $1 AND archived_at IS NULL", [b.student_id]);
  if (!st) throw notFound("الطالب غير موجود");
  const [row] = await q(`INSERT INTO clinic_visits (tenant_id, student_id, complaint, action, temperature, sent_home, recorded_by)
    VALUES (app_tenant(), $1, $2, $3, $4, $5, $6) RETURNING id`, [b.student_id, b.complaint, b.action, b.temperature, b.sent_home, actor]);
  if (b.notify_parent && (await featureSettings(q, "clinic")).notify_parent) {
    await notify(q, { event: "clinic", students: [b.student_id], urgent: b.sent_home,
      title: b.sent_home ? `${st.full_name}: يحتاج المغادرة للمنزل` : `${st.full_name} زار عيادة المدرسة`,
      body: [b.complaint, b.action ? `الإجراء: ${b.action}` : null, b.temperature ? `الحرارة ${b.temperature}` : null].filter(Boolean).join(" — "), link: "health" });
  }
  return row;
}
export const visits = (q, { student_id = null, from = null } = {}) => q(
  `SELECT v.id, v.student_id, s.full_name AS student, c.name AS class_name, v.visited_at, v.complaint, v.action, v.temperature, v.sent_home, v.recorded_by
     FROM clinic_visits v JOIN students s ON s.id = v.student_id LEFT JOIN classes c ON c.id = s.class_id
    WHERE ($1::bigint IS NULL OR v.student_id = $1) AND ($2::date IS NULL OR v.visited_at >= $2) ORDER BY v.visited_at DESC LIMIT 300`, [student_id, from]);
export async function healthOf(q, studentId) {
  const [p] = await q("SELECT blood_type, allergies, chronic, medications, emergency_phone, notes, updated_at FROM health_profiles WHERE student_id = $1", [studentId]);
  return { profile: p || null, visits: await q("SELECT visited_at, complaint, action, temperature, sent_home FROM clinic_visits WHERE student_id = $1 ORDER BY visited_at DESC LIMIT 30", [studentId]) };
}
