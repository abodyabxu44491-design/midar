/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
import { mount } from "../shared/js/dom.js";
import { inquiryForm } from "../shared/js/inquiry-form.js";

const kind = new URLSearchParams(location.search).get("kind");
mount(document.querySelector("[data-inquiry]"), inquiryForm({ kind: ["support", "sales", "complaint", "general", "other"].includes(kind) ? kind : "support" }));
