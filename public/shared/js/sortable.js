// السحب والإفلات بمؤشر موحّد (فأرة ولمس): يعمل على الجوال والكمبيوتر، وبين أكثر من قائمة في المجموعة نفسها.
// الاستخدام: sortable(list, { item: ".xb-q", handle: ".xb-handle", group: "questions", onDrop })
// onDrop يُستدعى بعد الإفلات، والمستدعي يقرأ الترتيب الجديد من الصفحة (data-id) ويحدّث بياناته.
const groups = new Map();

export function sortable(list, { item, handle, group = "default", onDrop }) {
  if (!groups.has(group)) groups.set(group, new Set());
  groups.get(group).add(list);
  list.addEventListener("pointerdown", (ev) => {
    const h = ev.target.closest(handle);
    if (!h || !list.contains(h) || ev.button > 0) return;
    const el = h.closest(item);
    if (!el || el.parentElement !== list) return;
    ev.preventDefault();
    start(el, ev, { item, group, onDrop });
  });
}

function start(el, ev, { item, group, onDrop }) {
  const rect = el.getBoundingClientRect();
  const offsetY = ev.clientY - rect.top;
  const ph = document.createElement("div");
  ph.className = "xb-placeholder";
  ph.style.height = `${rect.height}px`;
  const ghost = el.cloneNode(true);
  ghost.classList.add("xb-ghost");
  ghost.style.width = `${rect.width}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  el.after(ph);
  el.style.display = "none";
  document.body.append(ghost);
  document.body.classList.add("xb-dragging");
  const from = el.parentElement;
  let raf = null;
  let lastY = ev.clientY;

  const lists = () => [...(groups.get(group) || [])].filter((l) => l.isConnected);
  const place = (x, y) => {
    ghost.style.top = `${y - offsetY}px`;
    const target = lists().find((l) => {
      const r = l.closest(".xb-section")?.getBoundingClientRect() || l.getBoundingClientRect();
      return y >= r.top && y <= r.bottom && x >= r.left && x <= r.right;
    });
    if (!target) return;
    const siblings = [...target.children].filter((c) => c !== ph && c !== el && c.matches(item));
    const before = siblings.find((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
    if (before) target.insertBefore(ph, before); else target.append(ph);
  };
  // تمرير الصفحة تلقائيًا قرب الحافتين
  const autoscroll = () => {
    const edge = 70;
    if (lastY < edge) window.scrollBy(0, -12);
    else if (lastY > innerHeight - edge) window.scrollBy(0, 12);
    raf = requestAnimationFrame(autoscroll);
  };
  raf = requestAnimationFrame(autoscroll);

  const move = (e) => { lastY = e.clientY; place(e.clientX, e.clientY); };
  const end = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    ph.replaceWith(el);
    el.style.display = "";
    ghost.remove();
    document.body.classList.remove("xb-dragging");
    onDrop?.({ el, from, to: el.parentElement });
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}
