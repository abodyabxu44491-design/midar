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
  eye: (o) => svg(["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z", "M12 15a3 3 0 100-6 3 3 0 000 6z"], o),
  eyeOff: (o) => svg(["M3 3l18 18", "M10.6 5.2A9.6 9.6 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.6 4.3",
    "M6.2 6.8A17 17 0 002 12s3.5 7 10 7a9.5 9.5 0 004-.9", "M9.9 9.9a3 3 0 004.2 4.2"], o),
  print: (o) => svg(["M7 8V3h10v5", "M7 18H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-2", "M7 14h10v7H7z"], o),
};
