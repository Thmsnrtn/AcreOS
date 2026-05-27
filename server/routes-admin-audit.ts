/**
 * Admin audit-log integrity routes — Kareem §1 (SOC 2 CC7.2 / CC7.3).
 *
 * Two endpoints, both founder-only:
 *
 *   GET  /api/admin/audit-log/verify[?orgId=N]
 *        Walks the audit_log hash chain for the requested organization
 *        (defaults to the caller's active org) and reports the first row
 *        where the chain is broken — either a recomputed row_hash mismatch
 *        or a prev_hash that doesn't point at the previous row.
 *
 *   GET  /api/admin/audit-log/verify-all
 *        Walks every organization that has at least one audit_log row.
 *        Returns a summary plus the failing org (if any). Bounded by org
 *        count; intended for a quarterly cron + on-demand auditor pulls.
 *
 * These are append-only-evidence endpoints — they NEVER mutate the chain.
 * If verification fails, the operator must escalate via the
 * `data-breach-response.md` runbook because a chain break implies either
 * direct DB tampering (the audit_log trigger blocks UPDATE/DELETE) or a
 * concurrent-insert bug. Either way, it's incident-grade.
 */

import type { Express, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { auditLog } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { isAuthenticated, requireFounder } from "./auth";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { verifyAuditLogChain } from "./utils/auditLogChain";
import { auditFromRequest } from "./utils/auditLog";

export function registerAdminAuditLogRoutes(app: Express): void {
  // Single-org verification — defaults to the caller's active org.
  app.get(
    "/api/admin/audit-log/verify",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const requested = req.query.orgId ? Number(req.query.orgId) : undefined;
        const orgId = Number.isFinite(requested) ? Number(requested) : req.organizationId;
        if (!orgId || !Number.isFinite(orgId)) {
          return Errors.badRequest(res, "orgId required (query or active organization)");
        }

        const startedAt = Date.now();
        const result = await verifyAuditLogChain(orgId);
        const elapsedMs = Date.now() - startedAt;

        // Emit a sensitive-action audit event for the verification itself.
        // SOC 2 evidence: the auditor wants to know who ran the integrity
        // check, when, and what the result was.
        void auditFromRequest(req, {
          action: "audit_log.verify",
          target: { type: "organization", id: orgId },
          metadata: {
            ok: result.ok,
            scanned: result.scanned,
            preChainSkipped: result.preChainSkipped,
            failureReason: result.failure?.reason ?? null,
            elapsedMs,
          },
        });

        return res.json({ ...result, elapsedMs });
      } catch (err) {
        logger.error("[admin.audit-log.verify] failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // Whole-platform verification — enumerates orgs that have any audit_log
  // rows and verifies each. Returns the first failing org (if any) plus
  // per-org summaries. Cap at 500 orgs per call to keep response sizes
  // bounded; for a larger fleet, the caller can paginate via offset/limit.
  app.get(
    "/api/admin/audit-log/verify-all",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const limit = Math.min(Number(req.query.limit) || 500, 500);
        const offset = Math.max(Number(req.query.offset) || 0, 0);

        const orgs = await db.execute<{ organization_id: number }>(sql`
          SELECT DISTINCT organization_id
          FROM ${auditLog}
          ORDER BY organization_id
          LIMIT ${limit} OFFSET ${offset}
        `);

        const summaries: Array<{
          organizationId: number;
          ok: boolean;
          scanned: number;
          preChainSkipped: number;
          failureReason?: string | null;
        }> = [];
        let firstFailureOrgId: number | null = null;

        for (const row of orgs.rows ?? orgs) {
          const orgId = Number((row as any).organization_id);
          const result = await verifyAuditLogChain(orgId);
          summaries.push({
            organizationId: orgId,
            ok: result.ok,
            scanned: result.scanned,
            preChainSkipped: result.preChainSkipped,
            failureReason: result.failure?.reason ?? null,
          });
          if (!result.ok && firstFailureOrgId == null) firstFailureOrgId = orgId;
        }

        const totalScanned = summaries.reduce((acc, s) => acc + s.scanned, 0);
        const allOk = summaries.every((s) => s.ok);

        void auditFromRequest(req, {
          action: "audit_log.verify_all",
          target: { type: "organization", id: 0 },
          metadata: {
            ok: allOk,
            orgsScanned: summaries.length,
            totalRowsScanned: totalScanned,
            firstFailureOrgId,
          },
        });

        return res.json({
          ok: allOk,
          orgsScanned: summaries.length,
          totalRowsScanned: totalScanned,
          firstFailureOrgId,
          summaries,
        });
      } catch (err) {
        logger.error("[admin.audit-log.verify-all] failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}
