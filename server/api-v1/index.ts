/**
 * Public API v0 mount point — Lens 50.
 *
 * NOT mounted in server/routes.ts yet. When ready to open the surface,
 * call:
 *
 *   import { registerPublicApiV1 } from "./api-v1";
 *   registerPublicApiV1(app);
 *
 * The mount path is /api/v1/*. Auth is via bearer token (ak_...), not
 * the cookie session — these routes are intentionally outside the
 * isAuthenticated / getOrCreateOrg pipeline.
 */

import type { Express } from "express";
import { leadsV1Router } from "./leads";
import { propertiesV1Router } from "./properties";
import { webhooksV1Router } from "./webhooks";

export function registerPublicApiV1(app: Express): void {
  app.use("/api/v1/leads", leadsV1Router);
  app.use("/api/v1/properties", propertiesV1Router);
  app.use("/api/v1/webhooks", webhooksV1Router);
}
