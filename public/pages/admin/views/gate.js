// البوابة الذكية — شاشة الإدارة:
//   اليوم: الأرقام، المباشر، «لم يسجل حضور» والاستثناءات، واعتماد الغياب
//   الأجهزة: رابط للحارس (واتساب أو QR) ← موافقة ← إيقاف أو إلغاء فوري
//   البطاقات: طباعة بطاقات الحضور لشعبة كاملة، وإعادة إصدار أو تعطيل بطاقة
//   الإعدادات: أوقات الحضور والإشعارات والأيام الاستثنائية
//   المراجعة: المسح المشبوه وسجل التعديلات
import { h, mount } from "../../shared/js/dom.js";
import { api } from "../../shared/js/api.js";
import { panel, field, input, select, btn, empty, notice, sub, toast, dialog, badge, switchBtn, confirmAction } from "../../shared/js/ui.js";
import { ATTENDANCE, today, fmtDateTime } from "../../shared/js/format.js";
import { attendanceCard, printCards } from "../../shared/js/attendance-card.js";
import { A, loadClasses } from "./common.js";

const G = () => `${A}/attendance/gate`;
const PARTS = [["day", "اليوم والمراجعة"], ["records", "السجلات"], ["devices", "البوابات والأجهزة"], ["cards", "بطاقات الحضور"], ["settings", "الأوقات والإعدادات"], ["review", "المشبوه والتعديلات"]];
const RESULT = { present: ["حاضر", ""], late: ["متأخر", "amber"], duplicate: ["مسح مكرر", "gray"], kept: ["مسجّل مسبقًا", "gray"], rejected: ["مرفوض", "red"], departed: ["انصراف", "gray"] };
const DIRECTION = { in: "دخول", out: "انصراف", both: "دخول وانصراف" };
const DEVICE = { pairing: ["بانتظار فتح الرابط", "gray"], pending: ["بانتظار موافقتك", "amber"], active: ["مفعّل", ""], disabled: ["موقوف", "red"], revoked: ["ملغى", "gray"] };
const SUSPICIOUS = { two_gates: "نفس البطاقة من بوابتين خلال ثوانٍ", revoked_card: "بطاقة ملغاة", no_clock_ref: "وقت جهاز بلا مرجع",
  outside_network: "الجهاز خارج شبكة المدرسة", outside_geofence: "الجهاز بعيد عن موقع البوابة" };
const SOURCE = { gate: "البوابة", manual: "يدوي", teacher: "المعلم", review: "اعتماد المراجعة", sync: "مزامنة", import: "استيراد", excuse: "عذر" };
const EXCEPTIONS = [["trip", "رحلة"], ["activity", "نشاط خارجي"], ["excused", "غياب بعذر"], ["permitted", "مستأذن"], ["present", "حاضر (يدوي)"], ["late", "متأخر (يدوي)"]];
let part = "day", date = null, userDate = false, feedTimer = null;

export async function gateView({ me }) {
  date ??= today();
  const chips = h("div", { class: "xb-chips" });
  const box = h("div", { class: "gate-admin" });
  const show = async (k = part) => {
    part = k;
    clearInterval(feedTimer);
    mount(chips, PARTS.map(([key, label]) => h("button", { type: "button", class: `xb-chip${key === k ? " on" : ""}`, onclick: () => show(key) }, label)));
    mount(box, empty("جارٍ التحميل…"));
    try { mount(box, await VIEWS[k]()); } catch (e) { mount(box, notice(e.message, "err")); }
  };

  /* ---------- اليوم والمراجعة ---------- */
  async function dayView() {
    let [s, devices] = await Promise.all([api(`${G()}/summary?date=${date}`), api(`${G()}/devices`)]);
    // «اليوم» بتوقيت المدرسة (لا بتوقيت جهاز المدير)
    if (!userDate && s.today !== date) { date = s.today; s = await api(`${G()}/summary?date=${date}`); }
    const c = s.counts;
    const dateIn = input({ type: "date", value: date, max: s.today });
    dateIn.addEventListener("change", () => { date = dateIn.value || s.today; userDate = true; show("day"); });
    const PH = {
      before: ["wait", `تفتح البوابة ${s.window.open_at} — يُحسب متأخرًا بعد ${s.window.late_after} — تُغلق ${s.window.close_at}`],
      open: ["open", `الحضور مفتوح الآن — يُحسب متأخرًا بعد ${s.window.late_after} — يُغلق ${s.window.close_at}`],
      closed: ["closed", `انتهى وقت الحضور (${s.window.close_at}). راجع «لم يسجل حضور» ثم اعتمد الغياب.`],
      finalized: ["done", `اعتُمد الغياب بواسطة ${s.finalized_by || ""}${s.absence_notified_at ? " — وصل الإشعار لأولياء الأمور" : ` — يصل الإشعار ${s.absence_notify_at}`}`],
      no_school: ["closed", s.no_school_reason || "لا يوجد دوام"],
    }[s.phase];
    const noDevice = !devices.some((d) => d.status === "active");
    const stat = (n, label, cls = "") => h("div", { class: `gs ${cls}` }, h("b", {}, n ?? "—"), h("small", {}, label));
    const feedBox = h("div", { class: "gate-feed" });
    let last = 0;
    const loadFeed = async () => {
      try {
        const rows = await api(`${G()}/feed?date=${date}&after=${last}`);
        if (!rows.length) { if (!last) mount(feedBox, empty("لم يُمسح أحد بعد.")); return; }
        if (!last) mount(feedBox);
        last = rows[0].id;
        feedBox.prepend(...rows.map((r) => h("div", { class: `gf-row r-${r.result}` },
          h("div", { class: "gf-main" }, h("b", {}, r.name || "بطاقة غير معروفة"), h("small", {}, [r.class_name, r.gate_name, r.kind === "nfc" ? "NFC" : null].filter(Boolean).join(" · "))),
          h("div", { class: "gf-side" },
            badge(r.result === "late" && r.minutes_late ? `متأخر ${r.minutes_late} د` : RESULT[r.result][0], RESULT[r.result][1]),
            r.suspicious ? badge("مشبوه", "red") : null, r.offline ? badge("بدون اتصال", "gray") : null,
            h("small", {}, r.message ? `${r.message} · ${r.time}` : r.time)))));
        while (feedBox.children.length > 60) feedBox.lastChild.remove();
      } catch { /* يُعاد لاحقًا */ }
    };
    await loadFeed();
    if (date === s.today) feedTimer = setInterval(() => { if (box.isConnected && part === "day") loadFeed(); else clearInterval(feedTimer); }, 5000);

    return [
      h("div", { class: "row spaced" }, field("اليوم", dateIn), s.rate !== null ? h("div", { class: "gate-rate" }, h("b", {}, `${s.rate}%`), h("small", {}, "نسبة الحضور")) : null),
      noDevice ? notice("لا يوجد جهاز بوابة مفعّل بعد. أضف جوال الحارس من «أجهزة الحراس» وأرسل له الرابط.", "") : null,
      h("div", { class: `gate-phase ${PH[0]}` }, PH[1]),
      h("div", { class: "gate-stats" },
        stat(c.students, "طالب مقيد"), stat(c.present, "حاضر", "ok"), stat(c.late, "متأخر", "late"),
        stat(c.unrecorded, "لم يسجل حضور", c.unrecorded ? "warn" : ""), stat(c.absent, "غائب", "bad"),
        stat(c.excused + c.permitted, "بعذر / مستأذن"), stat(c.out_of_school, "رحلة / نشاط"), stat(c.suspicious, "مسح مشبوه", c.suspicious ? "bad" : ""),
        c.departed ? stat(c.departed, "انصرف") : null),
      s.gates.length > 1 ? h("div", { class: "row" }, s.gates.map((g) => badge(`${g.name}: ${g.n}`, "gray"))) : null,
      ["closed", "finalized"].includes(s.phase) ? await reviewPanel(s) : null,
      panel("المباشر — آخر المسحات", null, feedBox),
    ];
  }

  async function reviewPanel(s) {
    const list = s.phase === "finalized" ? [] : await api(`${G()}/unrecorded?date=${date}`);
    if (s.phase === "finalized") {
      return panel("المراجعة", null, notice(`اعتُمد غياب هذا اليوم (${s.counts.absent} غائب). أي تعديل بعد ذلك من «تسجيل الحضور» بسبب، ويُحفظ في سجل التعديلات.`, ""));
    }
    const picked = new Set();
    const groups = new Map();
    for (const st of list) {
      const k = st.class_name || "بلا شعبة";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(st);
    }
    const counter = h("b", {}, "0");
    const sync = () => { counter.textContent = String(picked.size); };
    const checkbox = (st) => {
      const cb = h("input", { type: "checkbox", onchange: () => { if (cb.checked) picked.add(st.id); else picked.delete(st.id); sync(); } });
      return h("label", { class: "check gate-un" }, cb, h("span", {}, st.name), st.last_rejected ? h("small", { class: "sub" }, "حاول المسح بعد الإغلاق") : null);
    };
    const status = select(EXCEPTIONS);
    const reason = input({ placeholder: "السبب (إلزامي) — مثال: رحلة الشعبة إلى المتحف", maxLength: 200 });
    const apply = btn("تطبيق على المحددين", async () => {
      if (!picked.size) return toast("حدد طلابًا من القائمة", true);
      if (reason.value.trim().length < 2) return toast("اكتب السبب", true);
      try {
        await api(`${G()}/exceptions`, { date, status: status.value, reason: reason.value.trim(), student_ids: [...picked] });
        toast("حُفظت الاستثناءات"); show("day");
      } catch (e) { toast(e.message, true); }
    }, "sm");
    const finalize = btn(`اعتماد الغياب (${list.length})`, async () => {
      if (!confirmAction(`سيُسجَّل ${list.length} طالبًا غائبين ويصل الإشعار لأولياء أمورهم. متابعة؟`)) return;
      try {
        const r = await api(`${G()}/finalize`, { date });
        toast(r.notified ? `اعتُمد: ${r.absent} غائب، ووصل الإشعار لأولياء الأمور` : `اعتُمد: ${r.absent} غائب. يصل الإشعار الساعة ${r.notify_at}`);
        show("day");
      } catch (e) { toast(e.message, true); }
    }, list.length ? "danger" : "");
    return panel(`لم يسجل حضور (${list.length})`, null,
      sub("هؤلاء لم يُسجَّل لهم حضور اليوم. لم يُكتب عليهم غياب ولم يصل أي إشعار بعد. حدد من له عذر أو في رحلة، ثم اعتمد الغياب للباقين."),
      list.length ? h("div", { class: "gate-groups" }, [...groups].map(([name, rows]) => h("div", { class: "gate-group" },
        h("div", { class: "gg-head" }, h("b", {}, name), h("small", {}, `${rows.length}`),
          btn("تحديد الكل", (ev) => { ev.target.closest(".gate-group").querySelectorAll("input").forEach((cb) => { cb.checked = true; cb.dispatchEvent(new Event("change")); }); }, "ghost sm")),
        rows.map(checkbox)))) : notice("كل الطلاب مسجلون. اعتمد اليوم لإغلاقه.", ""),
      list.length ? h("div", { class: "gate-actions" }, h("span", { class: "sub" }, "المحددون: ", counter), field("الحالة", status), reason, apply) : null,
      h("div", { class: "row" }, finalize));
  }

  /* ---------- أجهزة الحراس ---------- */
  async function devicesView() {
    const [devices, gates] = await Promise.all([api(`${G()}/devices`), api(`${G()}/gates`)]);
    const linkDialog = (title, r, name) => {
      const msg = `السلام عليكم، هذا رابط بوابة الحضور في ${me.school.name}.\nافتحه على جوالك (${name})، ثم انتظر موافقة الإدارة وستظهر لك شاشة المسح.\n${r.link}\nالرابط يعمل مرة واحدة خلال ${r.hours} ساعة.`;
      dialog(title, h("div", { class: "gate-link" },
        h("img", { class: "gate-link-qr", src: r.qr, alt: "رمز الرابط" }),
        sub("أرسل الرابط للحارس، أو امسح هذا الرمز من جواله. الرابط يعمل مرة واحدة فقط، وبعد فتحه يظهر الجهاز هنا بانتظار موافقتك."),
        h("code", { class: "gate-link-url", dir: "ltr" }, r.link)),
      [h("a", { class: "btn", href: `https://wa.me/?text=${encodeURIComponent(msg)}`, target: "_blank", rel: "noopener" }, "إرسال واتساب"),
        btn("نسخ الرابط", async () => { try { await navigator.clipboard.writeText(r.link); toast("نُسخ الرابط"); } catch { toast("تعذر النسخ", true); } }, "ghost")]);
    };
    const addDevice = () => {
      const name = input({ placeholder: "مثال: جوال الحارس أبو محمد", maxLength: 60 });
      const gate = select(gates.filter((g) => g.is_active).map((g) => [String(g.id), g.name]));
      const d = dialog("إضافة جهاز للحارس", h("div", {}, field("اسم الجهاز", name), gates.length > 1 ? field("البوابة", gate) : null,
        sub("ينشئ رابطًا ترسله للحارس. يفتحه على جواله فيصير جهاز بوابة بعد موافقتك. لا يحتاج الحارس اسم مستخدم ولا كلمة مرور.")),
      [btn("إنشاء الرابط", async () => {
        if (name.value.trim().length < 2) return toast("اكتب اسم الجهاز", true);
        try {
          const r = await api(`${G()}/devices`, { name: name.value.trim(), ...(gates.length ? { gate_id: Number(gate.value) } : {}) });
          d.close(); linkDialog("رابط جهاز البوابة", r, name.value.trim()); show("devices");
        } catch (e) { toast(e.message, true); }
      })]);
      name.focus();
    };
    const act = (d, action, okMsg, confirmMsg) => btn(okMsg[0], async () => {
      if (confirmMsg && !confirmAction(confirmMsg)) return;
      try { await api(`${G()}/devices/${d.id}/${action}`, {}); toast(okMsg[1]); show("devices"); } catch (e) { toast(e.message, true); }
    }, action === "approve" ? "sm" : action === "revoke" ? "danger sm" : "ghost sm");
    const newLink = (d) => btn("رابط جديد", async () => {
      if (d.status !== "pairing" && !confirmAction("الجوال الحالي سيتوقف فورًا ويحتاج الرابط الجديد. متابعة؟")) return;
      try { linkDialog("رابط جديد للجهاز", await api(`${G()}/devices/${d.id}/link`, {}), d.name); show("devices"); } catch (e) { toast(e.message, true); }
    }, "ghost sm");
    const fp = (d) => [d.fingerprint?.platform, d.fingerprint?.screen].filter(Boolean).join(" · ");
    const card = (d) => h("div", { class: `gate-dev s-${d.status}` },
      h("div", { class: "gd-main" },
        h("div", { class: "row" }, h("b", {}, d.name), badge(DEVICE[d.status][0], DEVICE[d.status][1]),
          d.status === "active" ? badge(d.online ? "متصل" : "غير متصل", d.online ? "" : "gray") : null,
          d.pair_expired ? badge("انتهت صلاحية الرابط", "red") : null,
          d.outside ? badge(`بعيد عن البوابة ${d.distance_m} م`, "red") : null),
        h("small", { class: "sub" }, [d.gate_name, d.last_seen_at ? `آخر ظهور ${fmtDateTime(d.last_seen_at)}` : "لم يتصل بعد", fp(d),
          d.pending_events ? `${d.pending_events} مسح بانتظار الإرسال` : null,
          d.clock_skew_ms && Math.abs(d.clock_skew_ms) > 120000 ? `ساعة الجهاز مختلفة ${Math.round(d.clock_skew_ms / 60000)} دقيقة` : null].filter(Boolean).join(" · ")),
        d.status === "pending" ? notice(`فتح الحارس الرابط من: ${fp(d) || "جهاز"}. وافق إن كان هذا جهازه.`, "") : null),
      d.status === "revoked" ? null : h("div", { class: "gd-actions" },
        d.status === "pending" ? act(d, "approve", ["موافقة", "فُعّل الجهاز"]) : null,
        d.status === "active" ? act(d, "disable", ["إيقاف", "أُوقف الجهاز"]) : null,
        d.status === "disabled" ? act(d, "enable", ["تفعيل", "فُعّل الجهاز"]) : null,
        newLink(d),
        act(d, "revoke", ["إلغاء", "أُلغي الجهاز"], `إلغاء «${d.name}» نهائيًا؟ يتوقف فورًا.`)));
    const gateDialog = (g) => {
      const name = input({ value: g?.name || "", placeholder: "مثال: البوابة الشرقية", maxLength: 60 });
      const dir = select(Object.entries(DIRECTION), {});
      dir.value = g?.direction || "in";
      const lat = input({ type: "number", step: "0.000001", value: g?.geo_lat ?? "", placeholder: "خط العرض", dir: "ltr" });
      const lng = input({ type: "number", step: "0.000001", value: g?.geo_lng ?? "", placeholder: "خط الطول", dir: "ltr" });
      const rad = input({ type: "number", min: 50, max: 5000, value: g?.geo_radius_m ?? 200, dir: "ltr" });
      const here = btn("استخدم موقعي الحالي", () => {
        if (!navigator.geolocation) return toast("الموقع غير متاح في هذا المتصفح", true);
        navigator.geolocation.getCurrentPosition((p) => { lat.value = p.coords.latitude.toFixed(6); lng.value = p.coords.longitude.toFixed(6); toast("حُدد الموقع"); },
          () => toast("لم يُسمح بالموقع", true), { enableHighAccuracy: true, timeout: 15000 });
      }, "ghost sm");
      const d = dialog(g ? "تعديل البوابة" : "بوابة جديدة", h("div", {},
        field("الاسم", name), field("نوع البوابة", dir, "بوابة «دخول وانصراف» تُظهر للحارس زر التبديل بينهما."),
        h("b", {}, "موقع البوابة (اختياري)"),
        sub("إن حددته وفعّلت «التحقق من الموقع» في الإعدادات، يُنبَّه على المسح من جهاز بعيد عن البوابة."),
        h("div", { class: "row" }, lat, lng, field("نصف القطر بالمتر", rad)), here),
      [btn("حفظ", async () => {
        const geo = lat.value && lng.value ? { lat: Number(lat.value), lng: Number(lng.value), radius_m: Number(rad.value) || 200 } : null;
        try {
          await api(g ? `${G()}/gates/${g.id}` : `${G()}/gates`, { name: name.value.trim(), direction: dir.value, geo }, g ? "PATCH" : "POST");
          d.close(); show("devices");
        } catch (e) { toast(e.message, true); }
      })]);
      name.focus();
    };
    const gateRow = (g) => h("div", { class: "line" }, h("div", {}, h("b", {}, g.name),
      sub([`${g.devices} جهاز`, DIRECTION[g.direction], g.geo_lat !== null ? `الموقع محدد (${g.geo_radius_m} م)` : null, g.is_active ? null : "موقوفة"].filter(Boolean).join(" · "))),
    btn("تعديل", () => gateDialog(g), "ghost sm"));
    const addGate = btn("+ بوابة", () => gateDialog(null), "ghost sm");
    const live = devices.filter((d) => d.status !== "revoked");
    return [
      panel("أجهزة الحراس", btn("+ إضافة جهاز للحارس", addDevice, "sm"),
        sub("الحارس يفتح رابطًا ترسله له من هنا، فيصير جواله جهاز بوابة بعد موافقتك. لا أحد يستطيع تحويل جواله إلى بوابة بدونك، وتستطيع إيقاف أي جهاز فورًا."),
        live.length ? h("div", { class: "gate-devs" }, live.map(card)) : empty("لا توجد أجهزة بعد.")),
      panel("البوابات", addGate, gates.length ? gates.map(gateRow) : sub("تُنشأ «البوابة الرئيسية» تلقائيًا مع أول جهاز.")),
    ];
  }

  /* ---------- بطاقات الحضور ---------- */
  async function cardsView() {
    const classes = await loadClasses();
    const cls = select([["", "اختر الشعبة"], ...classes.map((c) => [String(c.id), c.name])]);
    const out = h("div");
    const load = async () => {
      if (!cls.value) return mount(out);
      mount(out, empty("جارٍ تجهيز البطاقات…"));
      try {
        const d = await api(`${G()}/cards?class_id=${cls.value}`);
        if (!d.cards.length) return mount(out, empty("لا يوجد طلاب في هذه الشعبة."));
        mount(out,
          h("div", { class: "row" }, btn(`طباعة بطاقات الشعبة (${d.cards.length})`, () => printCards(d.school, d.cards))),
          h("div", { class: "ac-grid" }, d.cards.map((c) => h("div", { class: "ac-item" }, attendanceCard(d.school, c),
            h("div", { class: "row" },
              btn("طباعة", () => printCards(d.school, [c]), "ghost sm"),
              "NDEFReader" in window ? btn("كتابة على شريحة NFC", async () => {
                try {
                  toast("قرّب الشريحة من الجوال…");
                  await new window.NDEFReader().write({ records: [{ recordType: "url", data: c.qr }] });
                  toast(`كُتبت شريحة ${c.name}`);
                } catch (e) { toast(`تعذّرت الكتابة: ${e.message}`, true); }
              }, "ghost sm") : null,
              btn("إصدار بطاقة جديدة", async () => {
                const why = window.prompt(`سبب إصدار بطاقة جديدة لـ ${c.name} (البطاقة الحالية ستتوقف فورًا):`, "فُقدت البطاقة");
                if (why === null) return;
                try { await api(`${G()}/students/${c.id}/token/reissue`, { reason: why }); toast("صدرت بطاقة جديدة — اطبعها"); load(); } catch (e) { toast(e.message, true); }
              }, "ghost sm"),
              btn("تعطيل", async () => {
                if (!confirmAction(`تعطيل بطاقة ${c.name}؟ لن تُقبل عند البوابة حتى تصدر بطاقة جديدة.`)) return;
                try { await api(`${G()}/students/${c.id}/token/disable`, { reason: "تعطيل من الإدارة" }); toast("عُطّلت البطاقة"); load(); } catch (e) { toast(e.message, true); }
              }, "ghost sm"))))));
      } catch (e) { mount(out, notice(e.message, "err")); }
    };
    cls.addEventListener("change", load);
    return panel("بطاقات الحضور", null,
      sub("لكل طالب بطاقة برمز QR خاص بالحضور (غير معرّف ولي الأمر). تُطبع هنا لشعبة كاملة، ويستطيع ولي الأمر طباعتها من ملف الطالب. البطاقة المفقودة تُعطَّل أو تُصدر بدلها بطاقة جديدة فتتوقف القديمة فورًا."),
      field("الشعبة", cls), out);
  }

  /* ---------- الإعدادات ---------- */
  async function settingsView() {
    const s = await api(`${G()}/settings`);
    const t = (k) => input({ type: "time", value: s[k] });
    const f = { open_at: t("open_at"), late_after: t("late_after"), close_at: t("close_at"), absence_notify_at: t("absence_notify_at") };
    const toggles = [["notify_present", "إشعار ولي الأمر عند الوصول"], ["notify_late", "إشعار التأخر (مع عدد الدقائق)"],
      ["notify_absent", "إشعار الغياب بعد الاعتماد"], ["auto_finalize", "اعتماد الغياب تلقائيًا في وقت الإشعار إن لم يراجعه أحد"],
      ["notify_departure", "إشعار ولي الأمر عند الانصراف (بوابات الانصراف)"],
      ["teacher_can_edit", "المعلم يعدّل ما سجلته البوابة في فصوله"], ["teacher_can_excuse", "المعلم يضيف عذرًا أو ملاحظة على الغياب والتأخر"],
      ["legacy_cards", "قبول بطاقات ولي الأمر القديمة مؤقتًا (فترة انتقالية)"]];
    const locMode = select([["off", "بلا تحقق"], ["flag", "تعليم المسح المخالف للمراجعة"], ["block", "رفض المسح المخالف"]]);
    locMode.value = s.location_mode;
    const nets = input({ value: s.allowed_networks || "", placeholder: "مثال: 82.114.160.0/24, 37.236.12.5", dir: "ltr" });
    const offMin = input({ type: "number", min: 3, max: 120, value: s.device_offline_alert_min, dir: "ltr" });
    const stageHours = await api(`${G()}/stage-hours`);
    const vals = { ...s };
    const sw = toggles.map(([k, label]) => h("div", { class: "line" }, h("b", {}, label),
      switchBtn(Boolean(vals[k]), label, async () => { vals[k] = !vals[k]; return true; })));
    const dayDate = input({ type: "date", value: today() });
    const mode = select([["normal", "يوم عادي"], ["custom_hours", "أوقات خاصة (اختبارات مثلًا)"], ["no_attendance", "بلا حضور (فعالية، رحلة عامة)"]]);
    const dt = { open_at: input({ type: "time", value: s.open_at }), late_after: input({ type: "time", value: s.late_after }), close_at: input({ type: "time", value: s.close_at }) };
    const note = input({ placeholder: "ملاحظة (اختياري)", maxLength: 200 });
    const times = h("div", { class: "row", hidden: true }, field("البداية", dt.open_at), field("التأخر بعد", dt.late_after), field("الإغلاق", dt.close_at));
    mode.addEventListener("change", () => { times.hidden = mode.value !== "custom_hours"; });
    return [
      panel("أوقات الحضور", null,
        h("div", { class: "gate-times" }, field("يبدأ تسجيل الحضور", f.open_at), field("يُحسب متأخرًا بعد", f.late_after),
          field("يُغلق تسجيل الحضور", f.close_at), field("وقت إشعار الغياب (بعد الاعتماد)", f.absence_notify_at)),
        sub("قبل البداية وبعد الإغلاق لا يُقبل أي مسح. بعد الإغلاق يظهر «لم يسجل حضور» للمراجعة، ولا يصل إشعار غياب قبل اعتمادك."),
        ...sw,
        h("h3", { class: "sec-title" }, "الحماية من التسجيل خارج المدرسة"),
        h("div", { class: "row" }, field("التحقق من الشبكة والموقع", locMode), field("تنبيه انقطاع جهاز البوابة بعد (دقيقة)", offMin)),
        field("شبكات المدرسة المسموحة (اختياري)", nets, "عنوان الإنترنت لشبكة المدرسة. المسح المباشر من شبكة أخرى يُعلَّم أو يُرفض. موقع كل بوابة يُحدَّد من «البوابات والأجهزة»."),
        btn("حفظ", async () => {
          try {
            await api(`${G()}/settings`, { ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])),
              ...Object.fromEntries(toggles.map(([k]) => [k, Boolean(vals[k])])),
              location_mode: locMode.value, allowed_networks: nets.value.trim(), device_offline_alert_min: Number(offMin.value) || 10 }, "PUT");
            toast("حُفظت الإعدادات");
          } catch (e) { toast(e.message, true); }
        })),
      panel("أوقات خاصة لكل مرحلة", null,
        sub("إن كان لمرحلة دوام مختلف (مثلًا رياض الأطفال تبدأ متأخرة)، حدد أوقاتها هنا. المراحل بلا أوقات خاصة تتبع الأوقات العامة."),
        stageHours.length ? stageHours.map((st) => {
          const o = input({ type: "time", value: st.open_at || s.open_at }), l = input({ type: "time", value: st.late_after || s.late_after }),
            c = input({ type: "time", value: st.close_at || s.close_at });
          return h("div", { class: "gate-stage" }, h("b", {}, st.name), badge(st.open_at ? "أوقات خاصة" : "الأوقات العامة", st.open_at ? "" : "gray"),
            h("div", { class: "row" }, field("البداية", o), field("التأخر بعد", l), field("الإغلاق", c)),
            h("div", { class: "row" },
              btn("حفظ", async () => {
                try { await api(`${G()}/stage-hours`, { stage_id: st.stage_id, open_at: o.value, late_after: l.value, close_at: c.value }, "PUT"); toast("حُفظ"); show("settings"); }
                catch (e) { toast(e.message, true); }
              }, "sm"),
              st.open_at ? btn("العودة للأوقات العامة", async () => {
                try { await api(`${G()}/stage-hours/${st.stage_id}`, undefined, "DELETE"); show("settings"); } catch (e) { toast(e.message, true); }
              }, "ghost sm") : null));
        }) : empty("لا توجد مراحل.")),
      panel("يوم استثنائي", null,
        sub("أيام الإجازات من التقويم لا يُسجَّل فيها حضور تلقائيًا. هنا تضبط يومًا بأوقات مختلفة أو بلا حضور."),
        h("div", { class: "row" }, field("اليوم", dayDate), field("النوع", mode)), times, note,
        btn("حفظ اليوم", async () => {
          try {
            await api(`${G()}/day-mode`, { date: dayDate.value, mode: mode.value, note: note.value.trim() || undefined,
              ...(mode.value === "custom_hours" ? Object.fromEntries(Object.entries(dt).map(([k, el]) => [k, el.value])) : {}) }, "PUT");
            toast("حُفظ");
          } catch (e) { toast(e.message, true); }
        }, "sm")),
    ];
  }

  /* ---------- السجلات (تصفية) ---------- */
  async function recordsView() {
    const F = await api(`${G()}/filters`);
    const dateIn = input({ type: "date", value: date, max: today() });
    const opt = (list, all) => [["", all], ...list.map((x) => [String(x.id), x.name])];
    const stage = select(opt(F.stages, "كل المراحل")), grade = select(opt(F.grades, "كل الصفوف")), cls = select(opt(F.classes, "كل الشعب"));
    const gateSel = select(opt(F.gates, "كل البوابات"));
    const status = select([["", "كل الحالات"], ["unrecorded", "لم يسجل حضور"], ...Object.entries(ATTENDANCE).map(([k, v]) => [k, v[0]])]);
    const source = select([["", "كل المصادر"], ...Object.entries(SOURCE)]);
    const from = input({ type: "time" }), to = input({ type: "time" });
    const qName = input({ placeholder: "اسم الطالب", maxLength: 60 });
    const offline = h("input", { type: "checkbox" });
    const out = h("div");
    // الصفوف والشعب حسب المرحلة والصف المختارين
    const narrow = () => {
      for (const o of grade.options) o.hidden = Boolean(o.value && stage.value && String(F.grades.find((g) => String(g.id) === o.value)?.stage_id) !== stage.value);
      for (const o of cls.options) {
        const g = F.grades.find((x) => String(x.id) === String(F.classes.find((c) => String(c.id) === o.value)?.grade_id));
        o.hidden = Boolean(o.value && ((grade.value && String(g?.id) !== grade.value) || (stage.value && String(g?.stage_id) !== stage.value)));
      }
    };
    const load = async () => {
      narrow();
      date = dateIn.value || today(); userDate = true;
      const p = new URLSearchParams({ date });
      for (const [k, el] of [["stage_id", stage], ["grade_id", grade], ["class_id", cls], ["gate_id", gateSel], ["status", status], ["source", source], ["from", from], ["to", to], ["q", qName]]) {
        if (el.value.trim()) p.set(k, el.value.trim());
      }
      if (offline.checked) p.set("offline", "1");
      mount(out, empty("جارٍ التحميل…"));
      try {
        const rows = await api(`${G()}/records?${p}`);
        mount(out, h("p", { class: "sub" }, `${rows.length} طالب`), rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "grid gate-records" },
          h("thead", {}, h("tr", {}, ["الطالب", "الشعبة", "الحالة", "الوصول", "البوابة", "الانصراف", "المصدر"].map((t) => h("th", {}, t)))),
          h("tbody", {}, rows.map((r) => h("tr", {},
            h("td", {}, h("b", {}, r.name)), h("td", {}, r.class_name || "—"),
            h("td", {}, r.status ? badge(`${ATTENDANCE[r.status]?.[0] || r.status}${r.minutes_late ? ` ${r.minutes_late} د` : ""}`, r.status === "absent" ? "red" : r.status === "late" ? "amber" : r.status === "present" ? "" : "gray") : badge("لم يسجل", "amber")),
            h("td", {}, r.in_time || "—", r.offline ? h("small", { class: "sub" }, " (بدون اتصال)") : null),
            h("td", {}, r.gate_name || "—"), h("td", {}, r.out_time ? `${r.out_time}${r.out_gate_name ? ` · ${r.out_gate_name}` : ""}` : "—"),
            h("td", {}, SOURCE[r.source] || "—")))))) : empty("لا توجد سجلات بهذه التصفية."));
      } catch (e) { mount(out, notice(e.message, "err")); }
    };
    for (const el of [dateIn, stage, grade, cls, gateSel, status, source, from, to, offline]) el.addEventListener("change", load);
    let t;
    qName.addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 350); });
    load();
    return panel("السجلات", null,
      h("div", { class: "gate-filters" }, field("اليوم", dateIn), field("المرحلة", stage), field("الصف", grade), field("الشعبة", cls),
        field("البوابة", gateSel), field("الحالة", status), field("المصدر", source), field("وصل من", from), field("إلى", to), field("بحث", qName),
        h("label", { class: "check" }, offline, h("span", {}, "المسجّل بدون اتصال فقط"))),
      out);
  }

  /* ---------- المشبوه والتعديلات ---------- */
  async function reviewView() {
    const [sus, audit] = await Promise.all([api(`${G()}/suspicious?date=${date}`), api(`${G()}/audit?date=${date}`)]);
    const dateIn = input({ type: "date", value: date, max: today() });
    dateIn.addEventListener("change", () => { date = dateIn.value || today(); userDate = true; show("review"); });
    const decide = (e, state) => btn(state === "dismissed" ? "تجاهل" : "تأكيد", async () => {
      try { await api(`${G()}/suspicious/${e.id}`, { state }); show("review"); } catch (x) { toast(x.message, true); }
    }, state === "dismissed" ? "ghost sm" : "danger sm");
    return [
      field("اليوم", dateIn),
      panel(`المسح المشبوه (${sus.length})`, null,
        sus.length ? sus.map((e) => h("div", { class: "line" },
          h("div", {}, h("b", {}, e.name || "بطاقة غير معروفة"), sub([SUSPICIOUS[e.suspicious] || e.suspicious, e.gate_name, e.device_name, e.time].filter(Boolean).join(" · "))),
          e.review_state === "open" ? h("div", { class: "row" }, decide(e, "dismissed"), decide(e, "confirmed"))
            : badge(e.review_state === "confirmed" ? "مؤكد" : "متجاهل", e.review_state === "confirmed" ? "red" : "gray")))
          : empty("لا يوجد مسح مشبوه في هذا اليوم.")),
      panel(`سجل تعديلات الحضور (${audit.length})`, null,
        audit.length ? audit.map((a) => h("div", { class: "line" },
          h("div", {}, h("b", {}, `${a.name} — ${a.class_name || ""}`),
            sub(`${ATTENDANCE[a.old_status]?.[0] || "—"} ← ${ATTENDANCE[a.new_status]?.[0] || a.new_status} · ${SOURCE[a.new_source] || a.new_source || ""} · ${a.reason || ""}`),
            h("small", { class: "sub" }, [a.actor, fmtDateTime(a.at), a.device].filter(Boolean).join(" · ")))))
          : empty("لا توجد تعديلات في هذا اليوم.")),
    ];
  }

  const VIEWS = { day: dayView, records: recordsView, devices: devicesView, cards: cardsView, settings: settingsView, review: reviewView };
  await show();
  return [chips, box];
}
