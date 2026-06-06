/**
 * routes-customer-audit — customer-readable security activity log.
 *
 * Tahoe / Beatrice. Exposes the org-scoped customer_audit_log to the customer
 * who owns the org. This is the read side of the substrate written by
 * server/utils/customerAudit.ts. Surfaced behind Settings → Security activity
 * (NOT a new top-level door).
 *
 *   GET /api/audit/log?category=&limit=&offset=
 *     Paginated, newest-first, scoped to the caller's active organization.
 *     Returns { entries, total, limit, offset } where each entry's metadata
 *     has already been class-labelled at write time (PII / financial values
 *     are reduced to labels like "[Personal]" / "[Financial]").
 */

import type { Express, Response } from "express";
import { and, desc, eq, count } from "drizzle-orm";
import { db } from "./db";
import { customerAuditLog } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const VALID_CATEGORIES = new Set([
  "auth",
  "members",
  "billing",
  "data",
  "security",
]);

export function registerCustomerAuditRoutes(app: Express): void {
  app.get(
    "/api/audit/log",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);

        const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
        const offset = Math.max(Number(req.query.offset) || 0, 0);
        const category =
          typeof req.query.category === "string" &&
          VALID_CATEGORIES.has(req.query.category)
            ? req.query.category
            : undefined;

        const conditions = [eq(customerAuditLog.organizationId, orgId)];
        if (category) {
          conditions.push(eq(customerAuditLog.category, category));
        }
        const where = and(...conditions);

        const [entries, totalRow] = await Promise.all([
          db
            .select({
              id: customerAuditLog.id,
              action: customerAuditLog.action,
              category: customerAuditLog.category,
              actorEmail: customerAuditLog.actorEmail,
              targetLabel: customerAuditLog.targetLabel,
              metadata: customerAuditLog.metadata,
              ipAddress: customerAuditLog.ipAddress,
              createdAt: customerAuditLog.createdAt,
            })
            .from(customerAuditLog)
            .where(where)
            .orderBy(desc(customerAuditLog.createdAt))
            .limit(limit)
            .offset(offset),
          db
            .select({ total: count() })
            .from(customerAuditLog)
            .where(where),
        ]);

        return res.json({
          entries,
          total: totalRow[0]?.total ?? 0,
          limit,
          offset,
        });
      } catch (err) {
        logger.error(
          "[customer-audit.log] failed",
          err instanceof Error ? err : undefined,
        );
        return Errors.internal(res, err);
      }
    },
  );
}
