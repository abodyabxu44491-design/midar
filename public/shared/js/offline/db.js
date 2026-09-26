// قاعدة البيانات المحلية (IndexedDB) — ليست localStorage.
// قاعدة مستقلة لكل مدرسة ولكل مستخدم (لا تختلط بيانات حسابين على نفس الجهاز)، وتُحذف عند تسجيل الخروج.
// الكتابة بمتانة «strict»: العملية تُكتب على القرص قبل أن نقول للمستخدم «محفوظ على الجهاز»،
// فإغلاق التطبيق أو انقطاع البطارية بعدها لا يفقدها.
const VERSION = 1;
const STORES = {
  meta: { keyPath: "key" },
  load: { keyPath: "k" },                                   // الفصول والمواد المسندة
  students: { keyPath: "id", indexes: [["class_id", "class_id"]] },
  attendance: { keyPath: "k", indexes: [["day", "day"], ["student_id", "student_id"]] },  // k = طالب|يوم
  exams: { keyPath: "id" },
  scores: { keyPath: "k", indexes: [["exam_id", "exam_id"]] },                             // k = اختبار|طالب
  queue: { keyPath: "operation_id", indexes: [["seq", "client_seq"], ["status", "status"]] },
};

export const dbName = (tenantId, userId) => `midar-${tenantId}-${userId}`;

export function openDb(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [store, def] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(store)) continue;
        const os = db.createObjectStore(store, { keyPath: def.keyPath });
        for (const [iname, path] of def.indexes || []) os.createIndex(iname, path);
      }
    };
    req.onsuccess = () => resolve(wrap(req.result));
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("قاعدة البيانات المحلية مفتوحة في نافذة أخرى"));
  });
}

export const deleteDb = (name) => new Promise((resolve) => {
  const req = indexedDB.deleteDatabase(name);
  req.onsuccess = req.onerror = req.onblocked = () => resolve();
});

const done = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

function wrap(db) {
  // معاملة: fn تستلم المخازن، والوعد يتحقق بعد اكتمال الكتابة على القرص
  const tx = (stores, mode, fn) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode, mode === "readwrite" ? { durability: "strict" } : undefined);
    const map = Object.fromEntries([].concat(stores).map((s) => [s, t.objectStore(s)]));
    let out;
    Promise.resolve(fn(map)).then((v) => { out = v; }, (e) => { try { t.abort(); } catch { /* */ } reject(e); });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("أُلغيت الكتابة المحلية"));
  });
  return {
    raw: db,
    tx,
    get: (store, key) => tx(store, "readonly", (s) => done(s[store].get(key))),
    all: (store, index, value) => tx(store, "readonly", (s) => done(index ? s[store].index(index).getAll(value) : s[store].getAll())),
    count: (store, index, value) => tx(store, "readonly", (s) => done(index ? s[store].index(index).count(value) : s[store].count())),
    put: (store, value) => tx(store, "readwrite", (s) => done(s[store].put(value))),
    putMany: (store, values) => tx(store, "readwrite", (s) => Promise.all(values.map((v) => done(s[store].put(v))))),
    del: (store, key) => tx(store, "readwrite", (s) => done(s[store].delete(key))),
    clear: (stores) => tx(stores, "readwrite", (s) => Promise.all([].concat(stores).map((n) => done(s[n].clear())))),
    meta: async (key, value) => {
      if (value === undefined) return (await tx("meta", "readonly", (s) => done(s.meta.get(key))))?.value;
      return tx("meta", "readwrite", (s) => done(s.meta.put({ key, value })));
    },
    close: () => db.close(),
  };
}
