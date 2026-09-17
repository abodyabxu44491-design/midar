import { h } from "/shared/js/dom.js";
import { stats, panel, empty, line } from "/shared/js/ui.js";

export const myClasses = (me) => [...new Map(me.load.map((l) => [l.class_id, { id: l.class_id, name: l.class_name }])).values()];

export default function home({ me }) {
  return [
    stats([["فصولي", myClasses(me).length], ["موادي", new Set(me.load.map((l) => l.subject_id)).size]]),
    panel("الفصول والمواد المسندة لي", null, me.load.length
      ? me.load.map((l) => line(h("b", {}, l.subject_name), h("span", {}, l.class_name)))
      : empty("لم تُسند لك فصول بعد. تواصل مع إدارة المدرسة.")),
  ];
}
