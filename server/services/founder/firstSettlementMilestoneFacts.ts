/**
 * P1-13 — best-effort gatherer for the first-settlement milestone.
 *
 * Reads `activation_events` (org-keyed; `occurred_at` is the timestamp) for the
 * single milestone event name, cross-org, because the founder question is
 * platform-wide. Bounded scan; total failure → null, never throws.
 */
import { asc, eq } from "drizzle-orm";
import { activationEvents } from "@shared/schema";
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";
import { logger } from "../../utils/logger";
import {
  FIRST_SETTLEMENT_EVENT_NAME,
  FIRST_SETTLEMENT_SCAN_LIMIT,
  shapeFirstSettlementMilestone,
  type FirstSettlementMilestone,
} from "./firstSettlementMilestone";

export type FirstSettlementReport = FirstSettlementMilestone & { truncated: boolean };

export async function gatherFirstSettlementMilestone(): Promise<FirstSettlementReport | null> {
  try {
    const platformDb = unscopedForPlatformOps(
      "founder first-settlement milestone: cross-org read of the first_borrower_payment_received activation event (org id, payload, timestamp only) to surface the alert-only LLC-formation trigger",
    );
    // Earliest-first, so a binding limit still keeps the true earliest settlement.
    const rows = await platformDb
      .select({
        eventName: activationEvents.eventName,
        organizationId: activationEvents.organizationId,
        eventValue: activationEvents.eventValue,
        occurredAt: activationEvents.occurredAt,
      })
      .from(activationEvents)
      .where(eq(activationEvents.eventName, FIRST_SETTLEMENT_EVENT_NAME))
      .orderBy(asc(activationEvents.occurredAt))
      .limit(FIRST_SETTLEMENT_SCAN_LIMIT + 1);
    const truncated = rows.length > FIRST_SETTLEMENT_SCAN_LIMIT;
    const bounded = truncated ? rows.slice(0, FIRST_SETTLEMENT_SCAN_LIMIT) : rows;
    return { ...shapeFirstSettlementMilestone(bounded), truncated };
  } catch (err) {
    logger.warn("[founder] first-settlement milestone gather failed", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return null;
  }
}
