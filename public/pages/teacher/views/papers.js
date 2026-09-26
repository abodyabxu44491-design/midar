// الاختبارات والامتحانات: مصمم الاختبارات الورقية (بنك الأسئلة، الإنشاء، التصميم، الطباعة)
import { examSection } from "../../shared/js/exam/home.js";

export default async function papers({ me }) {
  return examSection({ base: "/api/teacher/papers", me: { ...me, role: "teacher" } });
}
