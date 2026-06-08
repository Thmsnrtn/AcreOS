/**
 * QUINN (Chief of Alignment) + BEATRICE (CRO) — public /transparency surface.
 *
 * Tahoe wave E9 → elevation. The substrate (pax_refusal_payloads,
 * pax_decision_appeals, transparency_reports + the nightly aggregator) is
 * live and produces real rows. This route now serves the latest PUBLISHED
 * row instead of a "coming soon" stub — an honest accountability surface
 * nobody can read is half a virtue.
 *
 * Routes:
 *   GET /transparency        — public latest-published report JSON. costClass
 *                              =low (single indexed DB read). No auth.
 *   GET /transparency/schema — declared shape of a published report row.
 *                              Lets the UI codegen its types from one source.
 *
 * House-style note (CLAUDE.md): these are DELIBERATELY public, unauthenticated
 * endpoints — the whole point of a transparency surface is that anyone (a
 * regulator, a journalist, a prospect) can read it without a login. So we do
 * NOT use `AuthenticatedRequest` here: there is no `user`/`organization` on
 * the request, and `getOrganization(req)` would (correctly) throw. We DO honor
 * the rest of the house style — every failure path goes through `Errors.*`
 * rather than a raw `res.status().json()`. Success returns plain `res.json`
 * because there is no `Errors.ok()` helper and these payloads carry no
 * org-scoped data (the table is platform-aggregate, no organization_id).
 *
 * Reproducibility: every response is stamped with the immutables.json version
 * and SHA-256 the report was computed against, so a published period stays
 * re-derivable even after a future constitutional amendment changes the list.
 */

import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { desc, isNotNull } from "drizzle-orm";
import { db } from "./db";
import { transparencyReports } from "@shared/schema/transparency-reports";
import { RAW_IMMUTABLES } from "@sovereign/immutables";
import { costClass } from "./utils/costClass";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

/** Declared shape of a published transparency report row. */
export interface PublishedTransparencyReportShape {
  periodStart: string;
  periodEnd: string;
  publishedAt: string;
  refusalCount: number;
  refusalByImmutable: Record<string, number>;
  appealCount: number;
  appealsUpheldCount: number;
  appealsReversedCount: number;
  founderBypassCount: number;
  demographicBiasFindings: {
    findings: unknown[];
    reviewedAt: string | null;
    // Honest accountability: when we cannot compute a fairness signal, this
    // carries the reason (e.g. "pre-customer: insufficient volume…") so the
    // surface never ASSERTS a clean bias audit it never ran. Mirrors the
    // jsonb shape in shared/schema/transparency-reports.ts.
    notMeasurableReason: string | null;
  };
  driftFindings: Record<string, unknown>;
}

/** Stamp identifying the constitution a report was computed against. */
export interface ImmutablesStamp {
  version: string;
  sha256: string | null;
}

/**
 * The constitution stamp a published period is reproducible against. Computed
 * once at module load: the version field from immutables.json plus the
 * SHA-256 of the canonical JSON file (the same byte-stable artifact the
 * hash-asserting unit test pins). On any read failure we fall back to the
 * version alone with a null hash rather than fabricate one.
 */
const IMMUTABLES_STAMP: ImmutablesStamp = (() => {
  const version =
    typeof RAW_IMMUTABLES.version === "string"
      ? RAW_IMMUTABLES.version
      : "unknown";
  try {
    const jsonPath = path.join(
      process.cwd(),
      "sovereign-protocol",
      "immutables.json",
    );
    const sha256 = createHash("sha256")
      .update(readFileSync(jsonPath))
      .digest("hex");
    return { version, sha256 };
  } catch (err) {
    logger.warn(
      "[transparency] could not compute immutables.json hash for stamp; serving version-only",
      { error: err instanceof Error ? err.message : String(err) },
    );
    return { version, sha256: null };
  }
})();

/**
 * Public-safe projection of a transparency_reports row into the declared
 * shape. Dates are ISO strings; jsonb columns pass through as-is. No
 * org-scoped or otherwise sensitive data lives on this platform-aggregate
 * table, so the whole row is public by construction.
 */
function toPublishedShape(
  row: typeof transparencyReports.$inferSelect,
): PublishedTransparencyReportShape {
  return {
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    // `publishedAt` is non-null on any row this route returns (we filter on
    // it), but the column type is nullable — fall back defensively.
    publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
    refusalCount: row.refusalCount,
    refusalByImmutable: row.refusalByImmutable,
    appealCount: row.appealCount,
    appealsUpheldCount: row.appealsUpheldCount,
    appealsReversedCount: row.appealsReversedCount,
    founderBypassCount: row.founderBypassCount,
    demographicBiasFindings: row.demographicBiasFindings,
    driftFindings: row.driftFindings,
  };
}

export function registerTransparencyRoutes(app: Express): void {
  // Public latest-published report. Single indexed read on the
  // (published_at) index, ordered newest-first. When no row has been
  // published yet, we return `status: "no_report_yet"` (HTTP 200) — the UI
  // renders an honest EmptyState rather than treating it as an error.
  app.get(
    "/transparency",
    costClass("low"),
    async (_req: Request, res: Response) => {
      try {
        const [row] = await db
          .select()
          .from(transparencyReports)
          .where(isNotNull(transparencyReports.publishedAt))
          .orderBy(desc(transparencyReports.publishedAt))
          .limit(1);

        if (!row) {
          res.json({
            status: "no_report_yet",
            message:
              "No transparency report has been published yet. The first published period will appear here.",
            immutables: IMMUTABLES_STAMP,
            contact: "alignment@acreos.com",
          });
          return;
        }

        res.json({
          status: "published",
          report: toPublishedShape(row),
          immutables: IMMUTABLES_STAMP,
          contact: "alignment@acreos.com",
        });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // Schema-shape stub — useful for the UI's type codegen and for a regulator
  // who wants the declared contract without waiting for a published period.
  app.get(
    "/transparency/schema",
    costClass("free"),
    (_req: Request, res: Response) => {
      try {
        const shape: PublishedTransparencyReportShape = {
          periodStart: "2026-01-01T00:00:00.000Z",
          periodEnd: "2026-03-31T23:59:59.999Z",
          publishedAt: "2026-04-01T00:00:00.000Z",
          refusalCount: 0,
          refusalByImmutable: {},
          appealCount: 0,
          appealsUpheldCount: 0,
          appealsReversedCount: 0,
          founderBypassCount: 0,
          demographicBiasFindings: {
            findings: [],
            reviewedAt: null,
            notMeasurableReason:
              "pre-customer: insufficient volume to compute fairness signal",
          },
          driftFindings: {},
        };
        res.json({
          shape,
          immutables: IMMUTABLES_STAMP,
          note: "example shape only — no real data",
        });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  logger.info(
    "[transparency] registered /transparency (latest published) + /transparency/schema",
  );
}
