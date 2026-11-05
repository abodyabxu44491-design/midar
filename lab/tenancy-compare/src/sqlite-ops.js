// Data operations for SQLite backends (D1 shared, Durable Object per school). Identical SQL for both, so the
// comparison is about where the data lives, not about different code.
//
// `exec(sql, params)` returns rows. On D1 every statement is its own transaction (no BEGIN/COMMIT from a Worker),
// so anything that must be atomic is written as a single statement.
// In D1 the school is enforced only by `tenant_id = ?` in each statement. In a Durable Object the database itself
// belongs to one school; the same filter is present but cannot select anything else.
const PAY = `
INSERT INTO payments (tenant_id, invoice_id, amount, idem_key, created_by)
SELECT ?1, ?2, ?3, ?4, ?5
 WHERE (SELECT amount FROM invoices WHERE tenant_id = ?1 AND id = ?2)
       >= ?3 + COALESCE((SELECT SUM(amount) FROM payments WHERE tenant_id = ?1 AND invoice_id = ?2), 0)
ON CONFLICT (tenant_id, idem_key) DO NOTHING
RETURNING id, invoice_id, amount, idem_key`;

export function sqliteOps(exec) {
  const one = async (sql, p) => (await exec(sql, p))[0] || null;
  return {
    async seed(t, base) {
      const pw = (u) => `lab:${t}:${u}`;   // hashed by the caller
      const stmts = [
        ["INSERT INTO users VALUES (?,?,?,?,?)", [t, base + 1, "admin", pw("admin"), "admin"]],
        ["INSERT INTO users VALUES (?,?,?,?,?)", [t, base + 2, "teacher1", pw("teacher1"), "teacher"]],
        ["INSERT INTO users VALUES (?,?,?,?,?)", [t, base + 3, "teacher2", pw("teacher2"), "teacher"]],
        ["INSERT INTO users VALUES (?,?,?,?,?)", [t, base + 4, "accountant", pw("accountant"), "accountant"]],
        ["INSERT INTO users VALUES (?,?,?,?,?)", [t, base + 5, "parent1", pw("parent1"), "parent"]],
        ["INSERT INTO users VALUES (?,?,?,?,?)", [t, base + 6, "parent2", pw("parent2"), "parent"]],
        ["INSERT INTO classes VALUES (?,?,?,?)", [t, base + 1, "الأول أ", base + 2]],
        ["INSERT INTO classes VALUES (?,?,?,?)", [t, base + 2, "الأول ب", base + 3]],
        ["INSERT INTO students VALUES (?,?,?,?,?)", [t, base + 1, "طالب تجريبي 1", base + 1, base + 5]],
        ["INSERT INTO students VALUES (?,?,?,?,?)", [t, base + 2, "طالب تجريبي 2", base + 2, base + 6]],
        ["INSERT INTO invoices VALUES (?,?,?,?)", [t, base + 1, base + 1, 1000]],
      ];
      for (const [s, p] of stmts) await exec(s, p);
    },
    findUser: (t, username) => one("SELECT id, pw_hash, role FROM users WHERE tenant_id = ? AND username = ?", [t, username]),
    listStudents: (t) => exec("SELECT s.id, s.name, s.class_id, s.parent_id, c.teacher_id FROM students s JOIN classes c ON c.tenant_id = s.tenant_id AND c.id = s.class_id WHERE s.tenant_id = ? ORDER BY s.id", [t]),
    getStudent: (t, id) => one("SELECT s.id, s.name, s.class_id, s.parent_id, c.teacher_id FROM students s JOIN classes c ON c.tenant_id = s.tenant_id AND c.id = s.class_id WHERE s.tenant_id = ? AND s.id = ?", [t, id]),
    renameStudent: (t, id, name) => one("UPDATE students SET name = ? WHERE tenant_id = ? AND id = ? RETURNING id, name", [name, t, id]),
    // Upsert with a version counter: concurrent writers never create two rows, and every write is counted.
    setGrade: (t, sid, subject, score, by) => one(
      `INSERT INTO grades (tenant_id, student_id, subject, score, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, student_id, subject) DO UPDATE SET score = excluded.score, updated_by = excluded.updated_by, version = grades.version + 1
       RETURNING student_id, subject, score, version`, [t, sid, subject, score, by]),
    getGrades: (t, sid) => exec("SELECT subject, score, version FROM grades WHERE tenant_id = ? AND student_id = ? ORDER BY subject", [t, sid]),
    markAttendance: (t, sid, day, status) => one(
      `INSERT INTO attendance (tenant_id, student_id, day, status) VALUES (?, ?, ?, ?)
       ON CONFLICT (tenant_id, student_id, day) DO UPDATE SET status = excluded.status RETURNING student_id, day, status`, [t, sid, day, status]),
    attendanceCount: async (t, sid, day) => (await one("SELECT count(*) AS n FROM attendance WHERE tenant_id = ? AND student_id = ? AND day = ?", [t, sid, day])).n,
    getInvoice: (t, id) => one("SELECT i.id, i.student_id, i.amount, s.parent_id, COALESCE((SELECT SUM(amount) FROM payments p WHERE p.tenant_id = i.tenant_id AND p.invoice_id = i.id), 0) AS paid FROM invoices i JOIN students s ON s.tenant_id = i.tenant_id AND s.id = i.student_id WHERE i.tenant_id = ? AND i.id = ?", [t, id]),
    async pay(t, invoiceId, amount, idem, by) {
      const row = await one(PAY, [t, invoiceId, amount, idem, by]);
      if (row) return { status: "created", payment: row };
      const prior = await one("SELECT id, invoice_id, amount, idem_key FROM payments WHERE tenant_id = ? AND idem_key = ?", [t, idem]);
      if (prior) return prior.invoice_id === invoiceId && prior.amount === amount ? { status: "replayed", payment: prior } : { error: "idem_mismatch" };
      const inv = await one("SELECT id FROM invoices WHERE tenant_id = ? AND id = ?", [t, invoiceId]);
      return { error: inv ? "overpay" : "not_found" };
    },
    listPayments: (t, invoiceId) => exec("SELECT id, amount, idem_key FROM payments WHERE tenant_id = ? AND invoice_id = ? ORDER BY id", [t, invoiceId]),
    auditCount: async (t) => (await one("SELECT count(*) AS n FROM audit_log WHERE tenant_id = ? AND action = 'payment'", [t])).n,
    // Simulated developer mistakes: the school filter is forgotten.
    unsafeListStudents: (t) => exec("SELECT tenant_id, id, name FROM students ORDER BY tenant_id, id", []),
    unsafeDeletePayment: (t, id) => exec("DELETE FROM payments WHERE id = ? RETURNING id", [id]),
    unsafeUpdateStudentById: (t, id, name) => exec("UPDATE students SET name = ? WHERE id = ? RETURNING tenant_id, id", [name, id]),
  };
}
