// السلوك (المعلم): طلاب فصوله فقط
import { behaviorBoard } from "../../shared/js/behavior-board.js";

export default async function behavior({ me }) {
  const seen = new Map();
  for (const l of me.load || []) if (!seen.has(l.class_id)) seen.set(l.class_id, { id: l.class_id, name: l.class_name });
  return behaviorBoard({ base: "/api/teacher", classes: [...seen.values()] });
}
