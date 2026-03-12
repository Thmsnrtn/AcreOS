/**
 * Express Request type augmentation.
 *
 * Declares custom properties attached by middleware so that route handlers
 * are fully type-safe without resorting to `(req as any)` or `@ts-nocheck`.
 *
 * Properties:
 *  - `req.org`          — attached by getOrCreateOrg middleware (primary accessor)
 *  - `req.organization` — legacy alias, also set by getOrCreateOrg
 */

import type { Organization } from "@shared/schema";

declare global {
  namespace Express {
    interface Request {
      /** Organization resolved by getOrCreateOrg middleware. */
      org: Organization;
      /** Legacy alias for req.org — set by getOrCreateOrg middleware. */
      organization: Organization;
    }
  }
}
