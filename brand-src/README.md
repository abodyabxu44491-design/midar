# مصدر الشعار

الشعار مبني على حرف **الميم** من خط Reem Kufi (نفس خط كلمة «مدار») داخل مدار، مع قمر ذهبي.

| الملف | الاستخدام |
|---|---|
| `public/brand/logo.svg` | الشعار الكامل على الخلفيات الفاتحة |
| `public/brand/logo-light.svg` | الشعار الكامل على الخلفيات الداكنة (الشريط العلوي) |
| `public/brand/logo-stacked.svg` و `logo-stacked-light.svg` | الشعار العمودي: العلامة ثم الاسم (صفحات الدخول والرئيسية) |
| `public/brand/mark.svg` و `mark-light.svg` | الرمز فقط (شريط التثبيت) |
| `public/brand/icon*.png` و `favicon*` | أيقونات المتصفح والجوال |
| `public/brand/og-image.png` | صورة المشاركة في الروابط |

**الألوان:**

| اللون | الرمز |
|---|---|
| الكحلي | `#16244A` |
| الفيروزي | `#0B7A75` و `#12A39B` |
| الذهبي | `#F0A53A` |

**إعادة التوليد:**

```bash
pip install uharfbuzz fonttools brotli
python3 build.py
```

يحتاج ملف خط Reem Kufi من الحزمة `@fontsource/reem-kufi`.
