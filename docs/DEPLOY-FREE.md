# التشغيل مجانًا (Neon + Render)

هذا المسار يشغّل مدار بنفس الكود وبنفس الحماية، بدون بطاقة بنكية وبدون أي تكلفة.

| الجزء | الخدمة | الخطة المجانية |
|---|---|---|
| قاعدة البيانات | **Neon** (PostgreSQL) | 0.5 جيجابايت تخزين، و100 ساعة حوسبة شهريًا، وتنام تلقائيًا عند عدم الاستخدام. الاستخدام التجاري مسموح وبدون بطاقة. |
| الخادم والموقع | **Render** | 750 ساعة شهريًا، مع شهادة HTTPS ونطاق مخصص مجانًا. |
| الشعار والتحليلات | **Firebase** | Analytics مجاني بالكامل. |

**العيب الوحيد:** الخادم المجاني ينام بعد 15 دقيقة خمول، وأول زيارة بعد النوم تتأخر نحو دقيقة. حلّها ملف `keepalive.yml` الذي يوقظه أثناء الدوام فقط.

---

## 1) قاعدة البيانات على Neon
1. سجّل في `neon.com` بحساب GitHub.
2. أنشئ مشروعًا: الاسم `midar`، والمنطقة الأقرب (فرانكفورت مثلًا).
3. من **SQL Editor** نفّذ الأمر التالي بعد تغيير كلمة المرور:

```sql
CREATE ROLE midar_app LOGIN PASSWORD 'كلمة-مرور-قوية' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA public TO midar_app;
```

4. من **Connection Details** انسخ رابط الاتصال. ستحصل على رابطين:
   - **رابط المالك** (المستخدم الافتراضي مثل `neondb_owner`) ← للترحيلات.
   - **رابط التطبيق**: نفس الرابط مع استبدال اسم المستخدم وكلمة المرور بـ `midar_app`.

## 2) الكود على GitHub
```bash
cd midar
git remote add origin https://github.com/USERNAME/midar.git
git push -u origin main
```
اجعل المستودع **خاصًا (Private)**.

## 3) توليد بيانات لوحتك
```bash
npm install
npm run owner:password    # يطبع OWNER_PASSWORD_HASH
npm run owner:totp        # يطبع OWNER_TOTP_SECRET (أضفه في Google Authenticator)
```

## 4) الخادم على Render
1. سجّل في `render.com` بحساب GitHub.
2. **New ← Blueprint** واختر المستودع. سيقرأ ملف `render.yaml` تلقائيًا.
3. أدخل القيم التي يطلبها:

| المتغير | القيمة |
|---|---|
| `DATABASE_URL` | رابط Neon بمستخدم `midar_app` |
| `MIGRATION_DATABASE_URL` | رابط Neon بمستخدم المالك |
| `OWNER_PATH` | `/control-` + حروف عشوائية طويلة |
| `OWNER_USERNAME` | اسم المستخدم الذي تختاره |
| `OWNER_PASSWORD_HASH` | من الأمر السابق |
| `OWNER_TOTP_SECRET` | من الأمر السابق |
| `PUBLIC_URL` | `https://midar.onrender.com` |

4. اضغط **Apply**. سيبني المشروع، ويطبق الترحيلات تلقائيًا، ثم يشتغل.
5. افتح `https://midar.onrender.com` ثم رابط لوحتك السري، وأنشئ أول مدرسة.

## 5) إبقاء الخادم مستيقظًا
من GitHub ← Settings ← Secrets and variables ← Actions ← Variables، أضف:
- `SITE_URL` = `https://midar.onrender.com`

يوقظ الخادم كل 10 دقائق من 6 صباحًا إلى 4 عصرًا، الأحد إلى الخميس. هذا الجدول مقصود: لو أبقيناه مستيقظًا 24 ساعة لتجاوزنا ساعات الحوسبة المجانية في Neon.

## 6) النطاق (اختياري)
Render ← الخدمة ← Settings ← Custom Domains ← أضف نطاقك، ثم أضف سجل CNAME عند مسجّل النطاق. الشهادة تُصدر تلقائيًا. بعدها حدّث `PUBLIC_URL`.

---

## متى تنتقل لخطة مدفوعة؟
| العلامة | الحل | التكلفة |
|---|---|---|
| المدارس تشتكي من بطء أول زيارة | ترقية Render إلى Starter | 7 دولارات شهريًا |
| تجاوز 0.5 جيجابايت في Neon (تقريبًا بعد آلاف الطلاب وسنوات من السجلات) | ترقية Neon | من 5 دولارات شهريًا |
| رغبتك في استضافة داخل السعودية | Firebase + Cloud SQL في الدمام | 15 إلى 30 دولارًا شهريًا |

**الانتقال لا يحتاج تعديل الكود**، فقط تغيير متغيرات البيئة.

## قبل أول مدرسة حقيقية
- فعّل **Point-in-time restore** في Neon، وجرّب الاسترجاع مرة واحدة.
- احفظ نسخة احتياطية يدوية شهريًا: `pg_dump "$MIGRATION_DATABASE_URL" -Fc > midar-YYYY-MM.dump`.
- لا تضع بيانات طلاب حقيقية قبل المراجعة القانونية (PDPL).
