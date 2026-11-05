# دليل النشر على Cloudflare (Workers + Hyperdrive + Neon)

**البنية المعتمدة:** [دراسة القرار](ARCHITECTURE-DECISION.md). هذا الدليل خطوات تنفيذية، كل خطوة بأمر أو فحص.

> لا تُنفذ خطوات الإنتاج (القسم 5) قبل اكتمال staging وموافقة المالك. Render وNeon الحاليان يبقيان يعملان طوال الوقت.

## 1. المتطلبات (من المالك)

| ماذا | أين | لماذا |
|---|---|---|
| رمز Cloudflare API بصلاحيات: Workers Scripts، Hyperdrive، Workers KV، Queues (Edit)، Account Settings (Read) | إعدادات بيئة الجلسة: `CLOUDFLARE_API_TOKEN` و`CLOUDFLARE_ACCOUNT_ID` | إنشاء الموارد والنشر |
| قاعدة staging منفصلة (مشروع Neon مجاني) ببيانات وهمية | `STAGING_DATABASE_URL` (دور `midar_app`) و`STAGING_MIGRATION_DATABASE_URL` (دور `midar_owner`) | الاختبار دون مساس الإنتاج |

لا اشتراك مدفوع مطلوب لـ staging. **التشغيل الفعلي يحتاج Workers Paid (5$ شهريًا)**، لأن تسجيل الدخول يتجاوز حد المعالج المجاني (10 مللي ثانية).

## 2. إنشاء staging والنشر
```sh
# قاعدة staging: الأدوار كما في db/setup-roles-managed.sql، ثم الترحيلات
MIGRATION_DATABASE_URL=$STAGING_MIGRATION_DATABASE_URL npm run migrate

# Hyperdrive + KV + Queues، وكتابة المعرّفات في wrangler.jsonc، ثم النشر
ENV=staging DATABASE_URL_FOR_HYPERDRIVE=$STAGING_DATABASE_URL scripts/cloudflare-provision.sh
```
السكربت آمن للتكرار: يعيد استخدام الموارد الموجودة، ولا يشتري أي خطة.

## 3. الأسرار (لكل بيئة)
```sh
npx wrangler secret put NAME --env staging
```

| السر | ملاحظة |
|---|---|
| **`CREDENTIAL_KEY`** | **إلزامي على Workers.** في الإنتاج يجب أن يساوي المفتاح الفعّال على Render الآن (`npm run credential:key` أو لوحة المالك). إن اختلف أو غاب، لا تُفتح أي من الأسرار المحفوظة (بوابة البريد والرسائل، مفتاح الذكاء الاصطناعي، مفاتيح الإشعارات). على Workers لا يُشتق من عنوان القاعدة أبدًا |
| `OWNER_PATH`, `OWNER_USERNAME`, `OWNER_PASSWORD_HASH`, `OWNER_TOTP_SECRET` | كما في Render |
| `OWNER_ALLOWED_IPS`, `OWNER_ALERT_EMAIL` | اختيارية |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | إن كانت مضبوطة في Render: القيم نفسها، وإلا تبطل اشتراكات الأجهزة |
| `ANTHROPIC_API_KEY`, `NEON_API_KEY`, `NEON_PROJECT_ID` | اختيارية |

المتغيرات غير السرية (`PUBLIC_URL`، `FIREBASE_ANALYTICS`، `ANDROID_PACKAGE`، `ANDROID_SHA256`) تُضاف إلى `vars` في `wrangler.jsonc` للبيئة.

## 4. التحقق على staging (قبل أي قرار)
```sh
# كل الاختبارات على نسخة Workers المنشورة (قاعدة staging فقط: الاختبارات تكتب بيانات)
TEST_BASE_URL=https://midar-api-staging.<الحساب>.workers.dev DATABASE_URL=$STAGING_DATABASE_URL \
  MIGRATION_DATABASE_URL=$STAGING_MIGRATION_DATABASE_URL npm test

# وحدات مدار داخل Workers (الإشعارات، كلمات المرور، الأسرار، Excel، الذكاء الاصطناعي، حماية بوابة الرسائل)
cd lab/workers-probe && npx wrangler deploy --dry-run   # أو تشغيله على staging
```

**بنود لم يمكن التحقق منها محليًا، وتُتحقق هنا:**

| البند | كيف |
|---|---|
| زمن الاستجابة الحقيقي (Hyperdrive إلى Neon، وSmart Placement) | قياس p50 وp95 من موقع المستخدمين، وبالحمل (`lab/tenancy-compare/test/bench.mjs` بعد تكييفه) |
| بوابة الرسائل: قبول عنوان عام عبر DNS-over-HTTPS | حفظ بوابة رسائل تجريبية من لوحة المالك |
| البريد عبر مزود حقيقي (TLS على 465/587) | رمز دخول من جهاز جديد |
| الإشعارات الفورية على جهاز حقيقي | تفعيل الإشعارات في صفحة الطالب ثم تسجيل غياب |
| المهام المجدولة (Cron) | سجلات Workers: سطر `"scheduled"` كل خمس دقائق أثناء الاستخدام |
| الاستيراد الكبير عبر الطابور | استيراد 2,000 طالب تجريبي ومتابعة التقدم |
| حدود المعدل | 25 طلبًا متتاليًا على `/healthz/db` ← 429 بعد 20 |

## 5. الانتقال الرسمي (بموافقة المالك فقط)
1. **قبل الانتقال:**
   - نسخة احتياطية يدوية مشفّرة من Neon (`backup.yml` يدويًا) مع التحقق منها.
   - تأكيد نافذة الاسترجاع لأي لحظة في خطة Neon.
2. نسخ أسرار الإنتاج (القسم 3)، **وأولها `CREDENTIAL_KEY` المطابق لـ Render**.
3. `ENV=production DATABASE_URL_FOR_HYPERDRIVE=<رابط midar_app على Neon> scripts/cloudflare-provision.sh`
4. الدومين:
   - نقله إلى Cloudflare DNS إن لم يكن.
   - ربط مسار الـ Worker بالدومين.
   - تفعيل WAF والقواعد المُدارة.
5. **Render يبقى يعمل** على القاعدة نفسها. الطلبات القديمة والجديدة آمنة معًا: Node لا يمس المهام التي ينفذها الطابور.
6. **الرجوع:** إعادة الدومين إلى Render خلال دقائق، ولا تضيع أي بيانات لأن القاعدة واحدة.
7. بعد 30 يومًا مستقرة وبموافقة المالك: إيقاف Render.

## 6. المراقبة بعد النشر
- **Workers Logs:** الأخطاء، وأسطر المهام المجدولة، ورسائل الطابور الفاشلة.
- **Queues:** `midar-jobs-dlq` يجب أن تبقى فارغة؛ أي رسالة فيها تُفحص.
- **لوحة Cloudflare:** تنبيهات الميزانية عند 80% من كل حد.
- **لوحة المالك:** مراقبة استهلاك Neon (قائمة).
