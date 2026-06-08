/**
 * routes-founder-audit — the founder "is it green?" read surface for the
 * shared continuous-audit substrate (domain_audit_findings).
 *
 *   GET  /api/founder/audit-findings        — findings (filterable by
 *        ?domain=&status=) + a per-domain rollup (open/warn/critical counts)
 *        the Command cockpit renders its traffic-lights off.
 *   POST /api/founder/audit-findings/:id/acknowledge — founder marks seen.
 *   POST /api/founder/audit-findings/:id/resolve     — founder marks fixed.
 *
 * Founder-gated. COMPANY-LEVEL data (no organization_id) — these are facts
 * about the company, surfaced only to the founder. See
 * server/services/audit/domainAudit.ts + shared/schema/domain-audit-findings.ts.
 */

import type { Express, Response } from "express";
import { sql } from "drizzle-orm";

import type { AuthenticatedRequest } from "./types/request";
import { isAuthenticated, requireFounder } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { db } from "./db";
import {
  domainAuditFindings,
  DOMAIN_AUDIT_DOMAINS,
  DOMAIN_AUDIT_STATUSES,
} from "@shared/schema";
import {
  listFindings,
  acknowledgeFinding,
  resolveFinding,
} from "./services/audit/domainAudit";

// ─── Per-domain rollup ─────────────────────────────────────────────────────────

interface DomainRollup {
  domain: string;
  open: number; // active (open + acknowledged) findings
  warn: number; // active findings at warn severity
  critical: number; // active findings at critical severity
}

/**
 * One row per domain: count of ACTIVE (open|acknowledged) findings, plus how
 * many of those are warn vs critical. Resolved/stale findings don't count —
 * a domain with only resolved findings reads green. Returns a row for every
 * known domain (zeros where clean) so the cockpit can render a fixed grid.
 */
async function domainRollups(): Promise<DomainRollup[]> {
  const rows = await db
    .select({
      domain: domainAuditFindings.domain,
      active: sql<number>`COUNT(*) FILTER (WHERE ${domainAuditFindings.status} IN ('open','acknowledged'))`.mapWith(
        Number,
      ),
      warn: sql<number>`COUNT(*) FILTER (WHERE ${domainAuditFindings.status} IN ('open','acknowledged') AND ${domainAuditFindings.severity} = 'warn')`.mapWith(
        Number,
      ),
      critical: sql<number>`COUNT(*) FILTER (WHERE ${domainAuditFindings.status} IN ('open','acknowledged') AND ${domainAuditFindings.severity} = 'critical')`.mapWith(
        Number,
      ),
    })
    .from(domainAuditFindings)
    .groupBy(domainAuditFindings.domain);

  const byDomain = new Map(rows.map((r) => [r.domain, r]));
  return DOMAIN_AUDIT_DOMAINS.map((domain) => {
    const r = byDomain.get(domain);
    return {
      domain,
      open: r?.active ?? 0,
      warn: r?.warn ?? 0,
      critical: r?.critical ?? 0,
    };
  });
}

// ─── Route registration ─────────────────────────────────────────────────────────

export function registerFounderAuditRoutes(app: Express): void {
  // GET /api/founder/audit-findings?domain=&status=
  app.get(
    "/api/founder/audit-findings",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const domainParam =
          typeof req.query.domain === "string" ? req.query.domain : undefined;
        const statusParam =
          typeof req.query.status === "string" ? req.query.status : undefined;

        if (domainParam && !DOMAIN_AUDIT_DOMAINS.includes(domainParam as never)) {
          return Errors.badRequest(res, `Unknown domain '${domainParam}'`);
        }
        if (statusParam && !DOMAIN_AUDIT_STATUSES.includes(statusParam as never)) {
          return Errors.badRequest(res, `Unknown status '${statusParam}'`);
        }

        const [findings, rollup] = await Promise.all([
          listFindings({
            domain: domainParam,
            statuses: statusParam ? [statusParam] : undefined,
          }),
          domainRollups(),
        ]);

        // Group findings by domain for the cockpit's accordion view.
        const grouped: Record<string, typeof findings> = {};
        for (const f of findings) {
          (grouped[f.domain] ??= []).push(f);
        }

        return res.json({
          findings,
          grouped,
          rollup,
          totals: {
            active: rollup.reduce((n, r) => n + r.open, 0),
            warn: rollup.reduce((n, r) => n + r.warn, 0),
            critical: rollup.reduce((n, r) => n + r.critical, 0),
          },
        });
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );

  // POST /api/founder/audit-findings/:id/acknowledge
  app.post(
    "/api/founder/audit-findings/:id/acknowledge",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return Errors.badRequest(res, "Invalid finding id");
        }
        const row = await acknowledgeFinding(id);
        if (!row) return Errors.notFound(res, "Finding");
        logger.info("[founder-audit] finding acknowledged", {
          metadata: { findingId: id, detector: row.detector },
        });
        return res.json({ finding: row });
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );

  // POST /api/founder/audit-findings/:id/resolve
  app.post(
    "/api/founder/audit-findings/:id/resolve",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return Errors.badRequest(res, "Invalid finding id");
        }
        const row = await resolveFinding(id);
        if (!row) return Errors.notFound(res, "Finding");
        logger.info("[founder-audit] finding resolved", {
          metadata: { findingId: id, detector: row.detector },
        });
        return res.json({ finding: row });
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );
}
