// شعار المدرسة: من ملف المدرسة، وإلا شعار الاختبارات الورقية (للمدارس التي رفعته قبل وجود شعار المدرسة).
// الرابط العام /api/public/<المدرسة>/logo?v=<رقم الصورة>: الرقم يتغير مع كل شعار جديد فيظهر فورًا مع كاش طويل.
export async function logoId(q) {
  const [row] = await q(
    `SELECT COALESCE(p.logo_image_id, CASE WHEN s.show_logo THEN s.logo_image_id END) AS id
       FROM tenants t LEFT JOIN school_profile p ON p.tenant_id = t.id LEFT JOIN exam_paper_settings s ON s.tenant_id = t.id
      WHERE t.id = app_tenant()`);
  return row?.id ? Number(row.id) : null;
}
