# مختبر المقارنة: عزل المدارس على ثلاث بنى

نموذج تجريبي **منفصل تمامًا** عن مشروع مدار (لا يستورد شيئًا من `src/`)، **ببيانات وهمية فقط**، يعمل محليًا ولا يُنشر.
النتائج والتوصية في [`docs/cloudflare/ARCHITECTURE-DECISION.md`](../../docs/cloudflare/ARCHITECTURE-DECISION.md).

| المسار | البنية |
|---|---|
| `/d1/...` | Cloudflare D1، قاعدة واحدة مشتركة، العزل بـ `tenant_id` في كل استعلام (في الكود فقط) |
| `/do/...` | Durable Object بقاعدة SQLite مستقلة لكل مدرسة (عزل فيزيائي) |
| `/pg/...` | PostgreSQL عبر Hyperdrive مع Row-Level Security (العزل تفرضه قاعدة البيانات) |

API واحدة وقواعد عمل واحدة للثلاثة (`src/worker.js`)، والمدرسة تُؤخذ دائمًا من الرمز الموقّع، لا من الطلب.

## التشغيل
```sh
# PostgreSQL محلي: أدوار lab_owner و lab_app (NOBYPASSRLS) وقاعدة midar_lab، ثم:
psql -U lab_owner -d midar_lab -f sql/pg-schema.sql
npx wrangler d1 execute midar-lab --local --file sql/sqlite-schema.sql
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PG=postgres://lab_app:lab-app@127.0.0.1:5432/midar_lab npx wrangler dev --port 8790

node --test test/attack.test.js      # 25 اختبار هجوم على كل بنية
node test/backup-drill.mjs           # نسخ واستعادة ومقارنة كل الصفوف
node test/bench.mjs                  # حمل محلي (SCHOOLS, REQUESTS, CONC)
```

مسارات `/unsafe/*` تحاكي **خطأ مبرمج** (استعلام نسي شرط المدرسة)، ولا توجد إلا هنا (`LAB_UNSAFE=1`).
