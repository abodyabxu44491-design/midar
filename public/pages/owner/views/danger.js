// منطقة الحذر في لوحة المالك (قسم مستقل، لا علاقة له بالاشتراكات والباقات والفواتير)
import { dangerZone } from "/shared/js/danger-zone.js";

export default () => dangerZone({ base: "/api/owner/danger", scope: "owner" });
