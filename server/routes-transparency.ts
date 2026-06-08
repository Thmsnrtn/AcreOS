/**
 * QUINN (Chief of Alignment) — public /transparency stub.
 *
 * Tahoe wave E9. The substrate (pax_refusal_payloads, pax_decision_appeals,
 * transparency_reports + the nightly aggregator) is live. The public UI
 * ships in a future wave. This file declares the data shape today so the
 * future wave is a UI-only change.
 *
 * Routes:
 *   GET /transparency        — public "Coming Soon" landing JSON. No DB
 *                              read. costClass=free. No auth required.
 *   GET /transparency/schema — declared shape of a published report row.
 *                              Lets the future UI codegen its types from a
 *                              single source.
 *
 * House-style note (CLAUDE.md): these are DELIBERATELY public, unauthenticated
 * endpoints — the whole point of a transparency surface is that anyone (a
 * regulator, a journalist, a prospect) can read it without a login. So we do
 * NOT use `AuthenticatedRequest` here: there is no `user`/`organization` on
 * the request, and `getOrganization(req)` would (correctly) throw. We DO honor
 * the rest of the house style — every failure path goes through `Errors.*`
 * rather than a raw `res.status().json()`. Success returns plain `res.json`
 * because there is no `Errors.ok()` helper and these payloads carry no
 * org-scoped data.
 */

import type { Express, Request, Response } from "express";
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

export function registerTransparencyRoutes(app: Express): void {
  // Stub landing — public, no DB read. The future UI replaces this with a
  // server-rendered surface that reads the latest published row.
  app.get(
    "/transparency",
    costClass("free"),
    (_req: Request, res: Response) => {
      try {
        res.json({
          status: "coming_soon",
          message:
            "AcreOS transparency report is in active development. The next published period will appear here.",
          contact: "alignment@acreos.com",
        });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // Schema-shape stub — useful for the future UI's type codegen.
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
        res.json({ shape, note: "example shape only — no real data" });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  logger.info(
    "[transparency] registered /transparency + /transparency/schema (stub)",
  );
}
