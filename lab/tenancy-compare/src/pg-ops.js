// Data operations for PostgreSQL behind Hyperdrive, connected as lab_app (cannot bypass row-level security).
// Every operation is one transaction that first sets app.tenant_id; the RLS policies then hide every other school's
// rows from every statement, including the deliberately unsafe ones below.
import pg from "pg";

pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));   // bigint ids and amounts fit in a JS number here

export function pgOps(connectionString) {
  async function tx(tenant, fn) {
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant || ""]);
      const q = async (sql, p = []) => (await client.query(sql, p)).rows;
      const out = await fn(q);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.end().catch(() => {});
    }
  }
  const one = (rows) => rows[0] || null;
  return {
    seed: (t, base) => tx(t, async (q) => {
      const pw = (u) => `lab:${t}:${u}`;
      for (const [id, u, role] of [[1, "admin", "admin"], [2, "teacher1", "teacher"], [3, "teacher2", "teacher"], [4, "accountant", "accountant"], [5, "parent1", "parent"], [6, "parent2", "parent"]]) {
        await q("INSERT INTO users VALUES ($1,$2,$3,$4,$5)", [t, base + id, u, pw(u), role]);
      }
      await q("INSERT INTO classes VALUES ($1,$2,$3,$4), ($1,$5,$6,$7)", [t, base + 1, "الأول أ", base + 2, base + 2, "الأول ب", base + 3]);
      await q("INSERT INTO students VALUES ($1,$2,$3,$4,$5), ($1,$6,$7,$8,$9)", [t, base + 1, "طالب تجريبي 1", base + 1, base + 5, base + 2, "طالب تجريبي 2", base + 2, base + 6]);
      await q("INSERT INTO invoices VALUES ($1,$2,$3,$4)", [t, base + 1, base + 1, 1000]);
    }),
    findUser: (t, username) => tx(t, async (q) => one(await q("SELECT id, pw_hash, role FROM users WHERE username = $1", [username]))),
    // From here on, no statement filters by school: row-level security does it.
    listStudents: (t) => tx(t, (q) => q("SELECT s.id, s.name, s.class_id, s.parent_id, c.teacher_id FROM students s JOIN classes c ON c.tenant_id = s.tenant_id AND c.id = s.class_id ORDER BY s.id")),
    getStudent: (t, id) => tx(t, async (q) => one(await q("SELECT s.id, s.name, s.class_id, s.parent_id, c.teacher_id FROM students s JOIN classes c ON c.tenant_id = s.tenant_id AND c.id = s.class_id WHERE s.id = $1", [id]))),
    renameStudent: (t, id, name) => tx(t, async (q) => one(await q("UPDATE students SET name = $1 WHERE id = $2 RETURNING id, name", [name, id]))),
    setGrade: (t, sid, subject, score, by) => tx(t, async (q) => one(await q(
      `INSERT INTO grades (tenant_id, student_id, subject, score, updated_by) VALUES (app_tenant(), $1, $2, $3, $4)
       ON CONFLICT (tenant_id, student_id, subject) DO UPDATE SET score = excluded.score, updated_by = excluded.updated_by, version = grades.version + 1
       RETURNING student_id, subject, score, version`, [sid, subject, score, by]))),
    getGrades: (t, sid) => tx(t, (q) => q("SELECT subject, score, version FROM grades WHERE student_id = $1 ORDER BY subject", [sid])),
    markAttendance: (t, sid, day, status) => tx(t, async (q) => one(await q(
      `INSERT INTO attendance (tenant_id, student_id, day, status) VALUES (app_tenant(), $1, $2, $3)
       ON CONFLICT (tenant_id, student_id, day) DO UPDATE SET status = excluded.status RETURNING student_id, to_char(day, 'YYYY-MM-DD') AS day, status`, [sid, day, status]))),
    attendanceCount: (t, sid, day) => tx(t, async (q) => Number((await q("SELECT count(*) AS n FROM attendance WHERE student_id = $1 AND day = $2", [sid, day]))[0].n)),
    getInvoice: (t, id) => tx(t, async (q) => one(await q(
      "SELECT i.id, i.student_id, i.amount, s.parent_id, COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id), 0)::bigint AS paid FROM invoices i JOIN students s ON s.tenant_id = i.tenant_id AND s.id = i.student_id WHERE i.id = $1", [id]))),
    // Interactive transaction: lock the invoice row, then decide. Two payments for one invoice wait for each other.
    pay: (t, invoiceId, amount, idem, by) => tx(t, async (q) => {
      const [inv] = await q("SELECT id, amount FROM invoices WHERE id = $1 FOR UPDATE", [invoiceId]);
      if (!inv) return { error: "not_found" };
      const [prior] = await q("SELECT id, invoice_id, amount, idem_key FROM payments WHERE idem_key = $1", [idem]);
      if (prior) return prior.invoice_id === invoiceId && prior.amount === amount ? { status: "replayed", payment: prior } : { error: "idem_mismatch" };
      const [{ paid }] = await q("SELECT COALESCE(SUM(amount), 0)::bigint AS paid FROM payments WHERE invoice_id = $1", [invoiceId]);
      if (paid + amount > inv.amount) return { error: "overpay" };
      const [row] = await q(`INSERT INTO payments (tenant_id, invoice_id, amount, idem_key, created_by) VALUES (app_tenant(), $1, $2, $3, $4)
                             RETURNING id, invoice_id, amount, idem_key`, [invoiceId, amount, idem, by]);
      return { status: "created", payment: row };
    }),
    listPayments: (t, invoiceId) => tx(t, (q) => q("SELECT id, amount, idem_key FROM payments WHERE invoice_id = $1 ORDER BY id", [invoiceId])),
    auditCount: (t) => tx(t, async (q) => Number((await q("SELECT count(*) AS n FROM audit_log WHERE action = 'payment'"))[0].n)),
    // The same deliberate mistakes as the SQLite backends.
    unsafeListStudents: (t) => tx(t, (q) => q("SELECT tenant_id, id, name FROM students ORDER BY tenant_id, id")),
    unsafeDeletePayment: (t, id) => tx(t, (q) => q("DELETE FROM payments WHERE id = $1 RETURNING id", [id])),
    unsafeUpdateStudentById: (t, id, name) => tx(t, (q) => q("UPDATE students SET name = $1 WHERE id = $2 RETURNING tenant_id, id", [name, id])),
  };
}
