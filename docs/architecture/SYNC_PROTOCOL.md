# بروتوكول المزامنة (v1) — المعلم

| الطلب | الوصف |
|---|---|
| `GET /api/teacher/sync/bootstrap` | اللقطة الأولى لنطاق المعلم + `cursor` (يُقرأ قبل اللقطة) |
| `GET /api/teacher/sync/changes?since=<cursor>&limit=500` | التغييرات منذ المؤشر: `attendance`، `scores`، `students`، `exams`، `deleted`، `cursor`، `has_more` — أو `reset: true` |
| `POST /api/teacher/sync/push` | `{ device_id, operations: [...] }` حتى 200 عملية؛ نتيجة لكل عملية |
| `GET /api/teacher/sync/conflicts` | تعارضات هذا المستخدم |
| `POST /api/teacher/sync/conflicts/:id/resolve` | `{ choice: "local" \| "server" }` |
| `GET /api/admin/sync/conflicts` · `POST …/resolve` | كل تعارضات المدرسة (الإدارة) |
| `GET /api/admin/sync/devices` · `POST …/devices/:id/revoke` | الأجهزة وإيقافها |
| `GET /api/admin/sync/stats` | مؤشرات 30 يومًا: طُبّقت، تعارضات، رُفضت، متوسط زمن الوصول، الأجهزة |

**العملية:**
```json
{ "operation_id": "uuid", "type": "attendance.mark | score.set", "base_version": 0,
  "client_seq": 12, "client_time": "2026-09-26T08:15:00+03:00",
  "payload": { "student_id": 491, "day": "2026-09-26", "status": "absent", "reason": null } }
```
`score.set` ← `payload: { exam_id, student_id, score }`.

**النتيجة:** `applied {version}` · `conflict {server, local}` · `rejected {error}` · مع `duplicate: true` لإعادة الإرسال.

# دليل التشغيل (Runbook)
- **طابور عالق على جهاز:** مؤشر المزامنة ← «مزامنة الآن». عند 401 يسجل المعلم الدخول (العمليات تبقى على الجهاز). عند 403 الجهاز موقوف.
- **تعارضات متراكمة:** الإدارة ← الإعدادات ← المزامنة والأجهزة. القرار يطبق بنفس قواعد الشاشات.
- **جهاز مفقود:** إيقافه من نفس الشاشة، وتغيير كلمة مرور المعلم (تُغلق جلساته). بيانات الجهاز تنتهي تلقائيًا بعد 7 أيام بلا مزامنة.
- **إعادة تهيئة جهاز:** تسجيل الخروج يمسح القاعدة المحلية؛ الدخول التالي يعيد اللقطة.
- **مراقبة:** `sync/stats`، وترويسة `Server-Timing`، وسطور `[slow]` في سجل الخادم.
- **التراجع (Rollback):** إعادة نشر الإصدار السابق آمنة: جداول المزامنة إضافية، وإيقاف الميزة يعني فقط أن الشاشات تعود للإرسال المباشر.
