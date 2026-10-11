/**
 * Founder Letter: customer outcomes across all organizations (W5b) —
 * read-only, founder-only, a section of the Letter (/founder), not a new door.
 * Aggregates only: no organization id, name or per-org row leaves the server
 * (server/services/growth/customerOutcome.ts platformCustomerOutcomes).
 */
import type { Express, Response } from "express";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { platformCustomerOutcomes } from "./services/growth/customerOutcome";

export function registerFounderCustomerOutcomeRoutes(app: Express): void {
  app.get(
    "/api/founder/customer-outcomes",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        return res.json(await platformCustomerOutcomes());
      } catch (err) {
        return Errors.internal(res, err as Error);
      }
    },
  );
}
