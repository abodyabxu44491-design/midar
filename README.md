# مِدار | MIDAR — منصة إدارة المدارس

**برمجة وتطوير: المبرمج عبدالله السكني**

منصة لعدة مدارس. كل مدرسة معزولة عن غيرها داخل قاعدة البيانات نفسها، وكل دور له صفحة ودخول منفصلان.

| الصفحة | الرابط | من يدخلها |
|---|---|---|
| الرئيسية | `/` | الجميع |
| لوحة المالك | رابط سري (`OWNER_PATH`) | أنت فقط، مع رمز تحقق ثنائي |
| إدارة المدرسة | `/admin` | مدير المدرسة |
| بوابة المعلم | `/teacher` | المعلمون (فصولهم فقط) |
| صفحة الطلاب | `/s/رمز-المدرسة` | الأهالي والطلاب برمز الصفحة (الأسماء فقط) |
| ملف الطالب | `/s/رمز-المدرسة/student` | بمعرّف الطالب فقط |

---

## طريقة السداد

1. **الإدارة** تضيف الحساب البنكي للمدرسة من: الإعدادات ← طرق السداد (اسم البنك، اسم الحساب، الآيبان).
2. **ولي الأمر** يضغط «ادفع» في ملف الطالب، فيظهر له:
   - الحساب البنكي مع زر نسخ للآيبان، ونص يكتبه في ملاحظة التحويل.
   - بعد التحويل يضغط «حوّلت المبلغ» ويرسل إشعارًا يحتوي المبلغ والتاريخ واسم المحوِّل ورقم العملية.
   - أو يختار الدفع النقدي بالحضور للمدرسة، وتظهر له التعليمات التي كتبتها الإدارة.
3. **الإدارة** تراجع الإشعار من تبويب «الرسوم» بعد مقارنته بكشف البنك:
   - **تأكيد:** تُسجَّل دفعة من نوع «تحويل» ويصدر إيصال برقم متسلسل.
   - **رفض:** مع سبب يظهر لولي الأمر.
4. **الدفع النقدي:** تسجله الإدارة مباشرة من الفاتورة، ويصدر له إيصال أيضًا.

الإشعار وحده لا يغيّر حالة السداد. الطالب لا يُعتبر مسددًا إلا بعد تأكيد الإدارة.

---

## الرفع على Firebase (المشروع: `midar-714c1`)

### كيف تعمل المنصة على Firebase

```
المتصفح ──► Firebase Hosting (الشعار والخطوط عبر CDN + شهادة HTTPS مجانية)
               │  كل الطلبات الأخرى
               ▼
         Cloud Functions ‹app› (نفس خادم Express) ──► Cloud SQL (PostgreSQL) في الدمام
               │
         Secret Manager (كلمات المرور والروابط السرية)
```

قاعدة البيانات **PostgreSQL** وليست Firestore، عن قصد، للأسباب التالية:
- بيانات الطلاب والمبالغ تحتاج علاقات صارمة ومعاملات كاملة.
- المنصة تحتاج قواعد حماية داخل القاعدة نفسها: منع الدفع الزائد، ثبات المدفوعات، وعزل المدارس.
- Cloud SQL خدمة من Google تعمل ضمن نفس مشروع Firebase.

### المتطلبات
- **خطة Blaze في Firebase (الدفع حسب الاستخدام):** مطلوبة للدوال وCloud SQL. أصغر خادم Cloud SQL يكلّف تقريبًا 10 إلى 30 دولارًا شهريًا حسب الحجم، والدوال والاستضافة شبه مجانية في البداية. **ضع تنبيه ميزانية (Budget alert) من Google Cloud Billing.**
- على جهازك: Node.js 22، وGit، و`npm i -g firebase-tools`.

### الخطوة 1: تفعيل الخدمات
1. افتح console.firebase.google.com ← مشروع **midar-714c1**، ثم رقِّ الخطة إلى **Blaze**.
2. من console.cloud.google.com (نفس المشروع) فعّل الخدمات التالية:
   - Cloud SQL Admin API
   - Cloud Functions
   - Cloud Run
   - Cloud Build
   - Artifact Registry
   - Secret Manager
   - Cloud Scheduler

### الخطوة 2: إنشاء قاعدة البيانات
1. من Cloud SQL ← Create instance ← PostgreSQL 16:
   - Instance ID: `midar-db`
   - Region: `me-central2` (الدمام)
   - فعّل **Automated backups** و**Point-in-time recovery**، وهذا هو صمام الأمان الأهم.
   - فعّل **Deletion protection**.
2. افتح **Cloud Shell** (زر >_ أعلى الصفحة) ونفّذ:

```bash
git clone https://github.com/USERNAME/midar.git && cd midar
gcloud sql connect midar-db --user=postgres
```

داخل psql عرّف كلمتي المرور أولًا (غيّرهما لكلمتين قويتين)، ثم شغّل ملف الإعداد:

```sql
\set owner_pw '''كلمة-قوية-1'''
\set app_pw '''كلمة-قوية-2'''
\i db/setup-roles.sql
```

### الخطوة 3: الأسرار
من جهازك داخل مجلد المشروع، نفّذ:

```bash
firebase login
npm install
npm run owner:password     # يطبع OWNER_PASSWORD_HASH
npm run owner:totp         # يطبع OWNER_TOTP_SECRET — أضفه في تطبيق Google Authenticator
```

ثم احفظ الأسرار في Secret Manager:

```bash
firebase functions:secrets:set DATABASE_URL
#   القيمة: postgres://midar_app:كلمة-قوية-2@localhost/midar
firebase functions:secrets:set OWNER_PATH
#   القيمة: رابط سري طويل مثل /control-k29x7p4m8q
firebase functions:secrets:set OWNER_PASSWORD_HASH
firebase functions:secrets:set OWNER_TOTP_SECRET
```

أخيرًا امنح حساب خدمة الدوال صلاحية **Cloud SQL Client** من IAM. الحساب اسمه عادةً:
`266112517876-compute@developer.gserviceaccount.com`

### الخطوة 4: الترحيلات والنشر
شغّل Cloud SQL Auth Proxy في نافذة طرفية منفصلة:

```bash
cloud-sql-proxy --port 5432 midar-714c1:me-central2:midar-db
```

في نافذة أخرى أنشئ ملف `.env.local` يحتوي هذا السطر:

```
MIGRATION_DATABASE_URL=postgres://midar_owner:كلمة-قوية-1@127.0.0.1:5432/midar
```

ثم نفّذ:

```bash
npm run migrate
npm run deploy
```

بعد النشر تعمل المنصة على:
- `https://midar-714c1.web.app`
- لوحتك على `https://midar-714c1.web.app/control-...` (الرابط السري الذي اخترته)

> إذا ظهر أن المنطقة `me-central2` غير مدعومة للدوال أو الجدولة، غيّر `MIDAR_REGION` في `.env.midar-714c1` والمنطقة في `firebase.json` إلى `europe-west1`، واترك قاعدة البيانات في الدمام.

### الخطوة 5: الرفع على GitHub
1. أنشئ مستودعًا **خاصًا (Private)** باسم `midar` على github.com.
2. ارفع المشروع:

```bash
git remote add origin https://github.com/USERNAME/midar.git
git push -u origin main
```

3. للنشر التلقائي عند كل رفع، أضف من Settings ← Secrets ← Actions:
   - `GCP_SA_KEY`: مفتاح JSON لحساب خدمة له الصلاحيات التالية:
     - Firebase Admin
     - Cloud Functions Admin
     - Service Account User
     - Cloud SQL Client
     - Secret Manager Viewer
   - `MIGRATION_DATABASE_URL`: `postgres://midar_owner:كلمة-قوية-1@127.0.0.1:5432/midar`

   بعدها كل رفع إلى `main` يمر أولًا بالاختبارات، ثم الترحيلات، ثم النشر.

### الخطوة 6: ربط الدومين
1. اشترِ نطاقًا، مثل `midar.sa` من nic.sa أو `midar-edu.com` من أي مسجل.
2. من Firebase Console ← Hosting ← **Add custom domain** ← اكتب النطاق.
3. أضف السجلات التي يعرضها Firebase (TXT ثم A) في إعدادات DNS عند المسجل.
4. انتظر من ساعة إلى 24 ساعة. شهادة HTTPS تُصدر تلقائيًا.
5. حدّث `PUBLIC_URL` في `.env.midar-714c1` إلى النطاق الجديد، ثم نفّذ `npm run deploy`.
6. من Google Cloud ← APIs ← Credentials، قيّد مفتاح Firebase الموجود في `firebase-config.js` على نطاقك فقط.

---

## التشغيل على جهازك للتطوير

```bash
npm install
sudo -u postgres psql -v owner_pw="'dev-owner'" -v app_pw="'dev-app'" -f db/setup-roles.sql
```

أنشئ ملف `.env.local` بهذا المحتوى:

```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://midar_app:dev-app@127.0.0.1:5432/midar
MIGRATION_DATABASE_URL=postgres://midar_owner:dev-owner@127.0.0.1:5432/midar
OWNER_PATH=/control-local-dev-path
OWNER_USERNAME=owner
OWNER_PASSWORD_HASH=...        # من npm run owner:password
COOKIE_SECURE=false
TRUST_PROXY=0
TEST_OWNER_PASSWORD=...        # كلمة المرور نفسها، للاختبارات
```

ثم نفّذ:

```bash
npm run migrate
npm run seed:demo     # مدرسة تجريبية
npm run dev
npm test              # الاختبارات
```

## هيكل المشروع
التفاصيل الكاملة في `docs/ARCHITECTURE.md`، والحماية في `docs/SECURITY.md`.

```
src/
  config/          الإعدادات والتحقق منها
  core/            الأساس: قاعدة البيانات، الأمان، الأخطاء، التحقق
  modules/
    owner/         لوحة المالك
    school-admin/  الإدارة — ملف لكل قسم
    teacher/       المعلم — ملف لكل قسم
    public/        صفحة الطلاب وملف الطالب والسداد
    shared/        منطق مشترك (الطلاب، الحضور، الاختبارات، المالية، السداد)
  app.js  server.js  firebase.js
db/migrations/     تعديلات قاعدة البيانات (مرقمة، لا تُعدّل بعد تطبيقها)
public/
  brand/           الشعار والأيقونات
  shared/          التصميم والأدوات المشتركة
  pages/           صفحة لكل دور، وتبويب لكل ملف داخل views/
tests/             الاختبارات الآلية
```

---
© مِدار MIDAR — برمجة وتطوير: المبرمج عبدالله السكني
