/**
 * routes-founder-market-reports.ts — quarterly market report drafts
 * (Tier 3F foundation — witnessed-publish).
 *
 * The data co-op's quarterly public market report is generated server-side
 * and stored as a DRAFT (market_report_drafts). It is NEVER auto-published:
 * the founder lists + previews drafts here (Sophie-side, /founder/* — never
 * customer-visible), and an actual publish path is a deliberate follow-up.
 *
 * Routes (founder-gated):
 *   GET  /api/founder/market-reports            — list drafts (newest first)
 *   GET  /api/founder/market-reports/:quarter   — full JSON + markdown preview
 *   POST /api/founder/market-reports/generate   — (re)generate a quarter's draft
 */

import type { Express, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { marketReportDrafts } from "@shared/schema";
import { isAuthenticated, requireFounder } from "./auth";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";
import {
  FIRST_PARTY_SOURCE,
  screenSourcedNodes,
  withholdingDisclosure,
} from "./services/licenseEgress";

const QUARTER_RE = /^\d{4}-Q[1-4]$/;

/**
 * LICENSE-AWARE EGRESS for the quarterly market report.
 *
 * PROVENANCE, VERIFIED AT HEAD, NOT ASSUMED: the draft is built by
 * services/dataCoop/quarterlyMarketReport.ts from `county_market_rollups`,
 * which countyRollupJob.ts computes by reading `offer_letters.offerAmount`,
 * `deals.acceptedAmount` and `properties.sizeAcres` — customer-entered
 * records, k-anonymized. No vendor feed contributes a figure today, so each
 * county row is marked FIRST_PARTY_SOURCE.
 *
 * That marking is a claim, so it is made defeasible: a county row that
 * carries its OWN `source` key (the shape a future vendor-backed rollup would
 * have) is screened against that source instead, and a vendor whose contract
 * says `redistributable:"no"` is withheld from a report that exists to be
 * published. The founder therefore cannot be handed a publishable draft
 * containing a figure we may not republish.
 */
function screenMarketReportDraft(
  report: unknown,
): { report: unknown; disclosure: ReturnType<typeof withholdingDisclosure> } {
  if (!report || typeof report !== "object") {
    return { report, disclosure: null };
  }
  const draft = report as Record<string, unknown>;
  const counties = Array.isArray(draft.counties)
    ? (draft.counties as Record<string, unknown>[])
    : [];
  if (counties.length === 0) return { report, disclosure: null };

  const marked = counties.map((c) => ({
    ...c,
    source: typeof c.source === "string" && c.source.trim()
      ? c.source
      : FIRST_PARTY_SOURCE,
  }));

  const { nodes, screen } = screenSourcedNodes("founder-market-report", marked, {
    dataKeys: ["metrics"],
    labelKey: "county",
  });

  return {
    report: { ...draft, counties: nodes },
    disclosure: withholdingDisclosure(screen),
  };
}

export function registerFounderMarketReportRoutes(app: Express): void {
  app.get(
    "/api/founder/market-reports",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const { listMarketReportDrafts } = await import(
          "./services/dataCoop/quarterlyMarketReport"
        );
        const drafts = await listMarketReportDrafts();
        res.json({ drafts });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/founder/market-reports/:quarter",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const quarter = String(req.params.quarter ?? "");
      if (!QUARTER_RE.test(quarter)) {
        return Errors.badRequest(res, "Quarter must look like 2026-Q2");
      }
      try {
        const [row] = await db
          .select()
          .from(marketReportDrafts)
          .where(eq(marketReportDrafts.quarter, quarter))
          .limit(1);
        if (!row) {
          return Errors.notFound(res, "Market report draft");
        }
        const screened = screenMarketReportDraft(row.report);
        res.json({
          ...row,
          report: screened.report,
          ...(screened.disclosure ? { license: screened.disclosure } : {}),
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/founder/market-reports/generate",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const quarter = String(req.body?.quarter ?? "");
      if (!QUARTER_RE.test(quarter)) {
        return Errors.badRequest(res, "Quarter must look like 2026-Q2");
      }
      try {
        const { upsertQuarterlyMarketReportDraft } = await import(
          "./services/dataCoop/quarterlyMarketReport"
        );
        const draft = await upsertQuarterlyMarketReportDraft(quarter);
        logger.info("[founder/market-reports] draft generated", {
          metadata: {
            __pii_safe: true,
            quarter,
            draftId: draft.id,
            actor: getUserId(req),
          },
        });
        // 200 (not 201): this is an idempotent upsert — regeneration
        // replaces the existing draft. Also keeps the res-status-raw
        // ratchet at baseline.
        const screened = screenMarketReportDraft(draft.report);
        res.json({
          ...draft,
          report: screened.report,
          ...(screened.disclosure ? { license: screened.disclosure } : {}),
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
