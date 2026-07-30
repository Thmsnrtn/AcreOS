/**
 * Tax jurisdiction rules — state-by-state redemption + statutory data.
 *
 * GET    /api/tax-rules           — every jurisdiction we have data for
 * GET    /api/tax-rules/:state    — single-state detail
 *
 * Read-only customer endpoints; updates are paralegal-driven via DB
 * mutations (no UI write surface — the data is sensitive enough that we
 * don't want hot-path UI editors before a review workflow lands).
 *
 * ── What changed 2026-07-30 (Wave D) ───────────────────────────────────
 * This endpoint used to merge two sources: the `tax_jurisdiction_rules`
 * table (≈21 states, seeded by raw INSERTs in scripts/migrate.mjs) and the
 * `STATE_REDEMPTION_RULES` const (TEN states). So `/state-rules` showed a
 * ten-to-twenty-state library — while `shared/regulatory/taxLienStateRules.ts`,
 * 50 states + DC of researched sale types, redemption periods, statutory
 * yields and citations, sat in the repo with ZERO call sites.
 *
 * All three sources now feed one payload, and every row states plainly which
 * tier it came from:
 *
 *   computational   — redemption math IS encoded. Still preliminary.
 *   reference_only  — sale type / period / citation known; interest model
 *                     NOT encoded. `defaultRateBps` comes back as NULL, and
 *                     the UI must print "not encoded" — never "0.00%".
 *   not_encoded     — we have nothing. The detail endpoint 404s with that
 *                     word rather than falling back to a generic default.
 *
 * Nothing here is attorney-reviewed. `attorneyReviewed` and `caveat` ride on
 * every row and on the collection, so no surface can render this data without
 * the caveat being available to it.
 */

import type { Express, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { taxJurisdictionRules } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { STATE_REDEMPTION_RULES } from "./services/redemptionClock";
import { STATE_TAX_LIEN_RULES } from "@shared/regulatory/taxLienStateRules";
import {
  INTEREST_MODEL_NOT_ENCODED,
  UNREVIEWED_RULE_CAVEAT,
  getStateRuleCoverage,
  referenceCoveredStates,
  computationalStates,
  type RuleCoverageTier,
} from "./services/taxRuleCoverage";

/** One jurisdiction, as the client sees it. */
interface RuleRow {
  state: string;
  source: "db" | "computational_fallback" | "reference_only";
  coverage: RuleCoverageTier;
  /** False for reference-only rows. The UI keys its "not encoded" copy off this. */
  redemptionMathEncoded: boolean;
  saleType: string;
  /** Null when the interest model is not encoded. */
  interestModel: string | null;
  redemptionPeriodMonths: number | null;
  redemptionPeriodMonthsOwnerOccupied: number | null;
  /** NULL means "not encoded". It never means "zero percent". */
  defaultRateBps: number | null;
  firstPeriodMonths: number | null;
  firstPeriodRateBps: number | null;
  secondPeriodRateBps: number | null;
  yearlyAddOnBps: number | null;
  /** Null when the anchor is unknown — we do not assume the sale date. */
  deadlineAnchor: string | null;
  citation: string | null;
  noticeRequirements: string | null;
  quietTitleProcedure: string | null;
  foreclosureProcedure: string | null;
  attorneyReviewedAt: string | null;
  attorneyReviewedBy: string | null;
  attorneyReviewed: boolean;
  notes: string | null;
  updatedAt: string | null;
  caveat: string;
}

function referenceRow(state: string): RuleRow {
  const ref = STATE_TAX_LIEN_RULES[state];
  const coverage = getStateRuleCoverage(state);
  const months = ref.redemptionPeriodMonths ?? ref.postSaleRedemptionMonths ?? null;
  return {
    state,
    source: "reference_only",
    coverage: coverage.tier,
    redemptionMathEncoded: false,
    saleType: ref.saleType,
    interestModel: null,
    redemptionPeriodMonths: months,
    redemptionPeriodMonthsOwnerOccupied: null,
    defaultRateBps: null,
    firstPeriodMonths: null,
    firstPeriodRateBps: null,
    secondPeriodRateBps: null,
    yearlyAddOnBps: null,
    deadlineAnchor: null,
    citation: ref.statutoryReference,
    noticeRequirements:
      ref.preForeclosureNoticeMonths > 0
        ? `Research indicates roughly ${ref.preForeclosureNoticeMonths} month${ref.preForeclosureNoticeMonths === 1 ? "" : "s"} of pre-foreclosure notice. Not encoded for computation.`
        : null,
    quietTitleProcedure: null,
    foreclosureProcedure: null,
    attorneyReviewedAt: null,
    attorneyReviewedBy: null,
    attorneyReviewed: false,
    notes:
      (ref.statutoryYieldBps !== null
        ? `Research indicates a statutory yield near ${(ref.statutoryYieldBps / 100).toFixed(2)}%` +
          (ref.rateIsBidDown ? " (bid down at auction, so a ceiling rather than a realized rate)" : "") +
          ". It is NOT encoded for computation. "
        : "") + ref.notes,
    updatedAt: null,
    caveat: coverage.caveat,
  };
}

function computationalRow(state: string): RuleRow {
  const rule = STATE_REDEMPTION_RULES[state];
  const ref = STATE_TAX_LIEN_RULES[state];
  return {
    state,
    source: "computational_fallback",
    coverage: "computational",
    redemptionMathEncoded: true,
    saleType: rule.saleType,
    interestModel: rule.interestModel,
    redemptionPeriodMonths: rule.redemptionPeriodMonths,
    redemptionPeriodMonthsOwnerOccupied: rule.redemptionPeriodMonthsOwnerOccupied ?? null,
    defaultRateBps: rule.defaultRateBps,
    firstPeriodMonths: rule.firstPeriodMonths ?? null,
    firstPeriodRateBps: rule.firstPeriodRateBps ?? null,
    secondPeriodRateBps: rule.secondPeriodRateBps ?? null,
    yearlyAddOnBps: rule.yearlyAddOnBps ?? null,
    deadlineAnchor: rule.deadlineAnchor,
    citation: rule.citation ?? ref?.statutoryReference ?? null,
    noticeRequirements: null,
    quietTitleProcedure: null,
    foreclosureProcedure: null,
    attorneyReviewedAt: rule.attorneyReviewedAt,
    attorneyReviewedBy: rule.attorneyReviewedBy,
    attorneyReviewed: rule.attorneyReviewedAt !== null,
    notes: ref?.notes ?? null,
    updatedAt: null,
    caveat: UNREVIEWED_RULE_CAVEAT,
  };
}

type DbRule = typeof taxJurisdictionRules.$inferSelect;

function dbRow(rule: DbRule): RuleRow {
  const encoded = rule.interestModel !== INTEREST_MODEL_NOT_ENCODED;
  const reviewed = rule.attorneyReviewedAt !== null;
  return {
    state: rule.state,
    source: "db",
    coverage: encoded ? "computational" : "reference_only",
    redemptionMathEncoded: encoded,
    saleType: rule.saleType,
    interestModel: encoded ? rule.interestModel : null,
    redemptionPeriodMonths: rule.redemptionPeriodMonths,
    redemptionPeriodMonthsOwnerOccupied: rule.redemptionPeriodMonthsOwnerOccupied,
    // A reference-only row stores 0 bps as a NOT-NULL placeholder. Never let
    // that reach the client as a rate.
    defaultRateBps: encoded ? rule.defaultRateBps : null,
    firstPeriodMonths: rule.firstPeriodMonths,
    firstPeriodRateBps: rule.firstPeriodRateBps,
    secondPeriodRateBps: rule.secondPeriodRateBps,
    yearlyAddOnBps: rule.yearlyAddOnBps,
    deadlineAnchor: encoded ? rule.deadlineAnchor : null,
    citation: rule.citation,
    noticeRequirements: rule.noticeRequirements,
    quietTitleProcedure: rule.quietTitleProcedure,
    foreclosureProcedure: rule.foreclosureProcedure,
    attorneyReviewedAt: rule.attorneyReviewedAt ? rule.attorneyReviewedAt.toISOString() : null,
    attorneyReviewedBy: rule.attorneyReviewedBy,
    attorneyReviewed: reviewed,
    notes: rule.notes,
    updatedAt: rule.updatedAt ? rule.updatedAt.toISOString() : null,
    caveat: reviewed
      ? `Attorney-reviewed ${rule.attorneyReviewedAt!.toISOString().slice(0, 10)}. Still confirm the citation before relying on a quote in front of a clerk or judge.`
      : UNREVIEWED_RULE_CAVEAT,
  };
}

/**
 * Build the full jurisdiction list. Exported so the honesty tests can assert
 * the payload's properties without a database.
 */
export function buildRuleRows(dbRules: DbRule[]): RuleRow[] {
  const byState = new Map<string, DbRule>(dbRules.map((r) => [r.state.toUpperCase(), r]));
  const states = new Set<string>([
    ...byState.keys(),
    ...computationalStates(),
    ...referenceCoveredStates(),
  ]);

  return Array.from(states)
    .sort()
    .map((state) => {
      const fromDb = byState.get(state);
      if (fromDb) return dbRow(fromDb);
      if (STATE_REDEMPTION_RULES[state]) return computationalRow(state);
      return referenceRow(state);
    });
}

export function registerTaxRuleRoutes(app: Express): void {
  // List — the union of DB rows, computational fallbacks, and the 51-state
  // reference module, each tagged with its coverage tier.
  app.get(
    "/api/tax-rules",
    isAuthenticated,
    getOrCreateOrg,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const dbRules = await db.select().from(taxJurisdictionRules);
        const rows = buildRuleRows(dbRules);

        const reviewedCount = rows.filter((r) => r.attorneyReviewed).length;
        const computationalCount = rows.filter((r) => r.redemptionMathEncoded).length;
        return res.json({
          rules: rows,
          totalStates: rows.length,
          reviewedCount,
          /** Jurisdictions whose redemption math is actually encoded. */
          computationalCount,
          /** Jurisdictions we can cite but not compute. */
          referenceOnlyCount: rows.length - computationalCount,
          /**
           * Named honestly. The old field was `missingStates: 50 - rows.length`,
           * which went NEGATIVE the moment coverage passed 50 jurisdictions.
           */
          jurisdictionsNotEncoded: Math.max(0, 51 - rows.length),
          attorneyReviewed: reviewedCount > 0,
          caveat: UNREVIEWED_RULE_CAVEAT,
        });
      } catch (err) {
        logger.error("taxRules.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // Single state detail.
  app.get(
    "/api/tax-rules/:state",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const state = (req.params.state ?? "").toUpperCase();
        const coverage = getStateRuleCoverage(state);

        // Refuse-not-fabricate: an unknown jurisdiction says so. There is no
        // median-state default behind this endpoint.
        if (coverage.tier === "not_encoded") {
          return Errors.notFound(
            res,
            `Tax-sale rules for '${state}' — not encoded in AcreOS. Nothing is assumed on your behalf`,
          );
        }

        const [dbRule] = await db
          .select()
          .from(taxJurisdictionRules)
          .where(eq(taxJurisdictionRules.state, state))
          .limit(1);

        const rule = dbRule
          ? dbRow(dbRule)
          : STATE_REDEMPTION_RULES[state]
            ? computationalRow(state)
            : referenceRow(state);

        return res.json({ source: rule.source, coverage: rule.coverage, rule, caveat: rule.caveat });
      } catch (err) {
        logger.error("taxRules.get failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}
