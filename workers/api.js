/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Abdullah Al-Sakkani (عبدالله السكني). All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Cloudflare Workers entry: the same Express app as src/server.js, served through the Workers Node.js HTTP layer.
// Static files are answered by Workers Static Assets before this code runs (scripts/build-workers.js).
import "./setup.js";
import { httpServerHandler } from "cloudflare:node";
import { createApp } from "../src/app.js";

const PORT = 3000;
createApp().listen(PORT);

export default httpServerHandler({ port: PORT });
