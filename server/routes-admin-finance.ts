/**
 * Admin Finance routes — Tahoe L6.
 *
 * Mounted at `/api/admin/finance` with `isAuthenticated + getOrCreateOrg +
 * requireFounder` (see registration in server/routes.ts). Read-only system-
 * wide finance signals: reserve floor compliance, system-of-record health.
 *
 * Distinct from `/api/founder/finance` which is the org-aware founder cockpit
 * surface — this router is for platform-level admin observability.
 */

import { Router, type Response } from "express";
import { desc } from "drizzle-orm";
import { db } from "./db";
import { reserveFloorChecks } from "@shared/schema";
import { RESERVE_FLOOR_RULE } from "@shared/finance/reserve-floor";
import {
  computeReserveFloor,
  recordReserveFloorCheck,
} from "./services/reserveFloorChecker";
import { assertFinancialLedgerInvariant } from "./services/financial-ledger-invariant";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { costClass } from "./utils/costClass";

const router = Router();

/**
 * GET /reserve-floor
 *
 * Returns the live reserve-floor computation (read-only against
 * financial_ledger) plus the last few persisted check rows for trend.
 *
 * Does NOT persist a new check row — pass `?record=1` to also persist.
 */
router.get("/reserve-floor", costClass("low"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shouldRecord = req.query.record === "1" || req.query.record === "true";

    const current = shouldRecord
      ? await recordReserveFloorCheck({ source: `manual:${req.user?.id ?? "founder"}` })
      : await computeReserveFloor();

    // History — last 30 rows, descending.
    const history = await db
      .select()
      .from(reserveFloorChecks)
      .orderBy(desc(reserveFloorChecks.checkedAt))
      .limit(30);

    res.json({
      rule: {
        minFraction: RESERVE_FLOOR_RULE.minFraction,
        trailingWindowDays: RESERVE_FLOOR_RULE.trailingWindowDays,
        reserveBuckets: RESERVE_FLOOR_RULE.reserveBuckets,
      },
      current: {
        reservesTotalCents: current.reservesTotalCents,
        trailingRevenueCents: current.trailingRevenueCents,
        floorCents: current.floorCents,
        headroomCents: current.headroomCents,
        belowFloor: current.belowFloor,
        reservesFraction: current.reservesFraction,
        trailingWindowDays: current.trailingWindowDays,
        asOf: current.asOf.toISOString(),
        recorded: shouldRecord,
      },
      history: history.map((h) => ({
        id: h.id,
        reservesTotalCents: h.reservesTotalCents,
        trailingRevenueCents: h.trailingRevenueCents,
        floorCents: h.floorCents,
        headroomCents: h.headroomCents,
        belowFloor: h.belowFloor,
        trailingWindowDays: h.trailingWindowDays,
        source: h.source,
        checkedAt: h.checkedAt,
      })),
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

/**
 * GET /system-of-record
 *
 * Reports the financial_ledger invariant probe + the canonical posture
 * doc location. Useful for a /founder/health pulse tile.
 */
router.get("/system-of-record", costClass("low"), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const probe = await assertFinancialLedgerInvariant();
    res.json({
      systemOfRecord: "financial_ledger",
      doc: "docs/internal/finance/system-of-record.md",
      invariant: probe,
      ratifiedAt: "2026-06-06",
    });
  } catch (err) {
    logger.error("admin_finance.system_of_record_probe_failed", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    Errors.internal(res, err);
  }
});

export default router;
