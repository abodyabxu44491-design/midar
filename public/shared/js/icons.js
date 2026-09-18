// أيقونات SVG (لا تُستخدم رموز أو إيموجي في الواجهة)
const NS = "http://www.w3.org/2000/svg";

function svg(paths, { size = 18, stroke = 2, fill = "none" } = {}) {
  const el = document.createElementNS(NS, "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("width", size);
  el.setAttribute("height", size);
  el.setAttribute("fill", fill);
  el.setAttribute("stroke", "currentColor");
  el.setAttribute("stroke-width", stroke);
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("focusable", "false");
  el.classList.add("icon");
  for (const d of [].concat(paths)) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    el.append(p);
  }
  return el;
}

export const icons = {
  chevronDown: (o) => svg("M6 9l6 6 6-6", o),
  chevronLeft: (o) => svg("M15 6l-6 6 6 6", o),
  install: (o) => svg(["M12 3v12", "M7 10l5 5 5-5", "M4 21h16"], o),
  close: (o) => svg(["M6 6l12 12", "M18 6L6 18"], o),
  share: (o) => svg(["M12 16V4", "M8 8l4-4 4 4", "M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"], o),
  print: (o) => svg(["M7 8V3h10v5", "M7 18H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-2", "M7 14h10v7H7z"], o),
};
