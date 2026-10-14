# مراقبة مدار والنسخ الاحتياطي

## ما يعمل تلقائيًا في GitHub (بلا أي إعداد إضافي)

| الفحص | متى | ماذا يفعل |
|---|---|---|
| **مراقبة الموقع** (`uptime.yml`) | كل ساعة | يفحص الصفحة الرئيسية والخادم وقاعدة البيانات. إن توقف شيء يفشل، ويرسل لك GitHub بريدًا. |
| **نسخة احتياطية** (`backup.yml`) | يوميًا 3:17 فجرًا | نسخة مشفّرة من قاعدة البيانات، تُحفظ 30 يومًا. |
| **اختبار استرجاع النسخة** (`backup-verify.yml`) | كل جمعة | يسترجع آخر نسخة في قاعدة مؤقتة ويتأكد أن الجداول والمدارس والطلاب موجودة. |
| **Keep alive** (`keepalive.yml`) | كل 10 دقائق | يُبقي الخادم المجاني مستيقظًا. |

تأكد أن بريد GitHub يصلك: GitHub ← Settings ← Notifications ← Actions ← فعّل **Email** لـ «Failed workflows only».

لتغيير رابط الموقع المراقَب: Settings ← Secrets and variables ← Actions ← Variables ← `SITE_URL` (مثل `https://midarschool.com`).

## تنبيه فوري على الجوال (UptimeRobot — مجاني، 5 دقائق)

1. سجّل في https://uptimerobot.com (Sign up — مجاني).
2. **+ New monitor**:
   - Monitor type: **HTTP(s)**
   - Friendly name: `مدار`
   - URL: `https://midarschool.com/healthz`
   - Monitoring interval: **5 minutes**
3. في **Alert contacts** اختر بريدك، ونزّل تطبيق UptimeRobot على الجوال ليصلك إشعار فوري.
4. **Create monitor**.

ملاحظة: لا تضع `/healthz/db` في UptimeRobot؛ فحصه كل 5 دقائق يُبقي قاعدة البيانات المجانية مستيقظة دائمًا فتنفد ساعاتها. فحص قاعدة البيانات يتم كل ساعة من GitHub.

## الاسترجاع يدويًا عند الحاجة

1. GitHub ← Actions ← «نسخة احتياطية» ← آخر تشغيل ناجح ← Artifacts ← نزّل الملف.
2. فك التشفير بكلمة السر `BACKUP_PASSPHRASE`:
   ```
   gpg --decrypt midar-XXXX.dump.gpg > midar.dump
   ```
3. أنشئ قاعدة فارغة في **نفس مشروع Neon** (Databases ← New database)، حتى يكون المستخدم `midar_app` موجودًا فيها، ثم استرجع مع الصلاحيات (بدون `--no-privileges`):
   ```
   pg_restore --no-owner --dbname "رابط المالك للقاعدة الجديدة" midar.dump
   ```
4. غيّر `DATABASE_URL` و`MIGRATION_DATABASE_URL` في Render إلى القاعدة الجديدة (نفس الروابط مع تغيير اسم القاعدة فقط)، وأعد التشغيل.
