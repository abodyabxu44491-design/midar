// Local load test of the three backends with the same mixed school workload.
// LOCAL ONLY: the Worker, D1, the Durable Objects and PostgreSQL all run on this machine, so these numbers compare
// the cost of each design (round trips, locking, serialisation), not the latency users will see in production.
const BASE = "http://127.0.0.1:8790", KEY = "lab-only-secret-not-for-production";
const SCHOOLS = Number(process.env.SCHOOLS || 20), REQUESTS = Number(process.env.REQUESTS || 3000), CONC = Number(process.env.CONC || 32);
const BACKENDS = (process.env.LAB_BACKENDS || "d1,do,pg").split(",");
const run = Date.now().toString(36);

async function req(b, method, path, token, body) {
  const t = performance.now();
  const r = await fetch(`${BASE}/${b}${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(path.startsWith("/seed") || path.startsWith("/admin") ? { "x-lab-key": KEY } : {}) }, body: body ? JSON.stringify(body) : undefined });
  await r.arrayBuffer();
  return { ms: performance.now() - t, status: r.status };
}
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];

const results = [];
for (const b of BACKENDS) {
  const schools = [];
  for (let i = 0; i < SCHOOLS; i++) {
    const tenant = `bench-${run}-${b}-${i}`, base = 50_000_000 + i * 100;
    await req(b, "POST", "/seed", null, { tenant, base });
    const tok = {};
    for (const u of ["teacher1", "parent1", "accountant"]) {
      const r = await fetch(`${BASE}/${b}/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenant, username: u, password: `lab:${tenant}:${u}` }) });
      tok[u] = (await r.json()).token;
    }
    schools.push({ tenant, base, tok });
  }
  // Mixed workload: reads dominate, as in a school day.
  const ops = [
    [40, (s) => ["GET", "/students", s.tok.parent1]],
    [20, (s) => ["GET", `/grades/${s.base + 1}`, s.tok.parent1]],
    [15, (s, i) => ["PUT", "/grades", s.tok.teacher1, { student_id: s.base + 1, subject: `sub${i % 8}`, score: i % 100 }]],
    [15, (s, i) => ["POST", "/attendance", s.tok.teacher1, { student_id: s.base + 1, day: `2026-11-${String(1 + (i % 28)).padStart(2, "0")}`, status: "present" }]],
    [10, (s, i) => ["POST", "/payments", s.tok.accountant, { invoice_id: s.base + 1, amount: 1, idem_key: `bench-${run}-${b}-${i}` }]],
  ];
  const pick = (i) => { let r = i % 100; for (const [w, f] of ops) { if (r < w) return f; r -= w; } return ops[0][1]; };
  const lat = []; let errors = 0, next = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (next < REQUESTS) {
      const i = next++;
      const s = schools[i % SCHOOLS];
      const [m, p, tok, body] = pick((i * 37) % 100)(s, i);
      const r = await req(b, m, p, tok, body);
      lat.push(r.ms);
      if (r.status >= 500 || (r.status >= 400 && !(p === "/payments" && r.status === 409))) errors++;
    }
  }));
  const secs = (performance.now() - t0) / 1000;
  lat.sort((x, y) => x - y);
  // Owner-wide figure across every school.
  const fan = b === "pg" ? null : await req(b, "POST", "/admin/count-students", null, { tenants: schools.map((s) => s.tenant) });
  results.push({ backend: b, schools: SCHOOLS, requests: REQUESTS, concurrency: CONC, rps: Math.round(REQUESTS / secs),
    p50: +pct(lat, 50).toFixed(1), p95: +pct(lat, 95).toFixed(1), p99: +pct(lat, 99).toFixed(1), errors, cross_school_count_ms: fan ? +fan.ms.toFixed(1) : "n/a" });
}
console.table(results);
console.log(JSON.stringify(results));
