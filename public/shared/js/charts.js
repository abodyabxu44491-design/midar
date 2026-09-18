// رسوم بسيطة بالـ SVG (بدون أي مكتبة خارجية)
import { h } from "./dom.js";

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/**
 * أعمدة رأسية.
 * data: [{ label, value, color? }]
 */
export function barChart(data, { height = 170, max = null, suffix = "" } = {}) {
  if (!data.length) return h("p", { class: "empty" }, "لا توجد بيانات كافية.");
  const top = max ?? Math.max(...data.map((d) => Number(d.value) || 0), 1);
  const W = Math.max(data.length * 56, 120);
  const svg = el("svg", {
    viewBox: `0 0 ${W} ${height}`, width: W, height, class: "chart",
    preserveAspectRatio: "xMaxYMax meet", role: "img", "aria-label": "رسم بياني",
  });
  data.forEach((d, i) => {
    const v = Number(d.value) || 0;
    const barH = Math.max(2, Math.round((v / top) * (height - 46)));
    const x = W - (i + 1) * 56 + 10;                       // من اليمين لليسار
    const y = height - 26 - barH;
    svg.append(el("rect", { x, y, width: 36, height: barH, rx: 6, fill: d.color || "var(--teal)" }));
    const value = el("text", { x: x + 18, y: y - 6, "text-anchor": "middle", class: "chart-value" });
    value.textContent = v + suffix;
    const label = el("text", { x: x + 18, y: height - 8, "text-anchor": "middle", class: "chart-label" });
    label.textContent = d.label;
    svg.append(value, label);
  });
  return h("div", { class: "scroll" }, svg);
}

// شريط أفقي بنسبة مئوية
export const percentRow = (label, percent, note) => h("div", { style: "padding:6px 0" },
  h("div", { class: "row", style: "justify-content:space-between" },
    h("span", {}, label), h("b", { style: "flex:none" }, percent === null || percent === undefined ? "—" : `${percent}%`)),
  h("div", { class: "bar" }, h("i", { style: `width:${Math.max(0, Math.min(100, percent || 0))}%` })),
  note ? h("div", { class: "sub" }, note) : null);
