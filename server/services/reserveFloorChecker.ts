/**
 * reserveFloorChecker — Tahoe L6.
 *
 * Sums the three reserve buckets (tax_reserve + refund_reserve + profit_reserve)
 * against trailing-window revenue and writes a row to `reserve_floor_check`.
 *
 * Read-only against `financial_ledger`. Never blocks any work — purely a
 * compliance signal for the founder cockpit + reserve-floor endpoint.
 *
 * Used by:
 *   - runScheduledJobs.ts (nightly cron)
 *   - routes-admin-finance.ts (founder-triggered manual check)
 */

import { and, eq, gte, inArray, sql, sum } from "drizzle-orm";
import { db } from "../db";
import { financialLedger, reserveFloorChecks } from "@shared/schema";
import {
  RESERVE_FLOOR_RULE,
  assembleReserveFloorCheck,
  type ReserveFloorCheck,
} from "@shared/finance/reserve-floor";
import { logger } from "../utils/logger";

export interface ReserveFloorComputation extends ReserveFloorCheck {
  trailingWindowDays: number;
  asOf: Date;
}

/**
 * Compute the current reserve floor check WITHOUT persisting it. Pure
 * read against `financial_ledger`.
 */
export async function computeReserveFloor(opts?: {
  now?: Date;
}): Promise<ReserveFloorComputation> {
  const now = opts?.now ?? new Date();
  const trailingWindowDays = RESERVE_FLOOR_RULE.trailingWindowDays;
  const since = new Date(now.getTime() - trailingWindowDays * 24 * 60 * 60 * 1000);

  // Reserves total — sum of signed amount_cents across the three reserve
  // buckets. Manual transfers between buckets net to zero so this is the
  // live balance.
  const reserveBuckets = [...RESERVE_FLOOR_RULE.reserveBuckets];
  const [reservesRow] = await db
    .select({ total: sum(financialLedger.amountCents).mapWith(Number) })
    .from(financialLedger)
    .where(inArray(financialLedger.bucket, reserveBuckets));
  const reservesTotalCents = reservesRow?.total ?? 0;

  // Trailing revenue — sum of category='revenue' rows over the window.
  const [revRow] = await db
    .select({ total: sum(financialLedger.amountCents).mapWith(Number) })
    .from(financialLedger)
    .where(
      and(
        eq(financialLedger.category, "revenue"),
        gte(financialLedger.postedAt, since),
      ),
    );
  const trailingRevenueCents = revRow?.total ?? 0;

  const check = assembleReserveFloorCheck({
    reservesTotalCents,
    trailingRevenueCents,
  });

  return {
    ...check,
    trailingWindowDays,
    asOf: now,
  };
}

/**
 * Persist a reserve floor check to the log table. Returns the inserted row.
 */
export async function recordReserveFloorCheck(opts?: {
  source?: string;
  now?: Date;
}): Promise<ReserveFloorComputation & { id: number }> {
  const source = opts?.source ?? "scheduled";
  const c = await computeReserveFloor({ now: opts?.now });

  const [row] = await db
    .insert(reserveFloorChecks)
    .values({
      reservesTotalCents: c.reservesTotalCents,
      trailingRevenueCents: c.trailingRevenueCents,
      floorCents: c.floorCents,
      headroomCents: c.headroomCents,
      belowFloor: c.belowFloor,
      trailingWindowDays: c.trailingWindowDays,
      source,
      checkedAt: c.asOf,
    })
    .returning();

  if (c.belowFloor) {
    logger.warn("reserve_floor.below_floor", {
      metadata: {
        reservesTotalCents: c.reservesTotalCents,
        floorCents: c.floorCents,
        headroomCents: c.headroomCents,
        trailingRevenueCents: c.trailingRevenueCents,
        trailingWindowDays: c.trailingWindowDays,
        source,
      },
    });
  } else {
    logger.info("reserve_floor.ok", {
      metadata: {
        reservesTotalCents: c.reservesTotalCents,
        floorCents: c.floorCents,
        headroomCents: c.headroomCents,
        reservesFraction: c.reservesFraction,
        source,
      },
    });
  }

  return { ...c, id: row.id };
}
