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
  users: (o) => svg(["M16 19v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2", "M9 9a4 4 0 100-8 4 4 0 000 8",
    "M22 19v-2a4 4 0 00-3-3.9", "M16 1.1a4 4 0 010 7.8"], o),
  calendar: (o) => svg(["M3 5h18v16H3z", "M8 2v4", "M16 2v4", "M3 10h18"], o),
  money: (o) => svg(["M2 6h20v12H2z", "M12 15a3 3 0 100-6 3 3 0 000 6", "M6 9h.01", "M18 15h.01"], o),
  lock: (o) => svg(["M5 11h14v10H5z", "M8 11V7a4 4 0 118 0v4"], o),
  grip: (o) => svg(["M9 5h.01", "M15 5h.01", "M9 12h.01", "M15 12h.01", "M9 19h.01", "M15 19h.01"], { stroke: 3, ...o }),
  edit: (o) => svg(["M4 20h4L19 9l-4-4L4 16v4z", "M13.5 6.5l4 4"], o),
  copy: (o) => svg(["M9 9h11v11H9z", "M5 15H4V4h11v1"], o),
  trash: (o) => svg(["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 13h10l1-13", "M9 7V4h6v3"], o),
  up: (o) => svg("M6 15l6-6 6 6", o),
  down: (o) => svg("M6 9l6 6 6-6", o),
  plus: (o) => svg(["M12 5v14", "M5 12h14"], o),
  bank: (o) => svg(["M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z", "M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6", "M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"], o),
  refresh: (o) => svg(["M20 11a8 8 0 00-14.9-4", "M4 4v4h4", "M4 13a8 8 0 0014.9 4", "M20 20v-4h-4"], o),
  image: (o) => svg(["M3 5h18v14H3z", "M8 11a2 2 0 100-4 2 2 0 000 4", "M21 16l-5-5L5 19"], o),
  check: (o) => svg("M5 12.5l4.5 4.5L19 7.5", { stroke: 2.4, ...o }),
  gift: (o) => svg(["M4 11h16v9H4z", "M3 7h18v4H3z", "M12 7v13", "M12 7c-1.5-3-5-3.5-5-1s3.5 1 5 1c1.5 0 5 1.5 5-1s-3.5-2-5 1"], o),
  star: (o) => svg("M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z", o),
  search: (o) => svg(["M11 18a7 7 0 100-14 7 7 0 000 14z", "M20 20l-4-4"], o),
  link: (o) => svg(["M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1", "M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"], o),
  external: (o) => svg(["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"], o),
  phone: (o) => svg("M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2", o),
  megaphone: (o) => svg(["M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1z", "M15 9a3 3 0 010 6", "M18 7a6 6 0 010 10"], o),
  key: (o) => svg(["M15 7a4 4 0 11-3.5 6H9v2H7v2H4v-3l6.5-6.5A4 4 0 0115 7z"], o),
  print: (o) => svg(["M7 8V3h10v5", "M7 18H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-2", "M7 14h10v7H7z"], o),
};
