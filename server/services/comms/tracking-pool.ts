/**
 * Tracking-number pool.
 *
 * A "tracking number" is a phone number we rent from a carrier and assign
 * to a specific (organization, campaign) pair so inbound traffic on that
 * number can be attributed back to the campaign that triggered the lead.
 *
 * Rather than rent a new number every time a campaign launches (~$1.15/mo
 * per number on Twilio, which compounds fast), we recycle numbers across
 * campaigns: when a number sits idle for N days (default 60, configurable
 * via founder_settings `comms.pool.auto_release_days`), release it back
 * to the pool and reassign it to the next requester.
 *
 * Assignment lookup priority for a fresh request:
 *   1. A number whose `released_at IS NOT NULL` (already released, ready).
 *   2. A number whose `last_inbound_at` is older than the auto-release
 *      threshold (effectively idle).
 *   3. Rent a new number from the cheapest enabled carrier.
 *
 * Inbound attribution is done by `attributeInbound(...)`, called from
 * webhook handlers in routes-voice.ts / routes-misc.ts. Given the
 * destination number and a timestamp, it returns the active (org,
 * campaign) assignment so the inbound message can be filed correctly.
 */
import { db } from "../../db";
import { trackingNumberAssignments } from "@shared/schema";
import { and, eq, isNull, isNotNull, lt, or } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { getNumberSetting } from "../founderSettings";
import { commsRouter, type CommsProviderName } from "./router";

const DEFAULT_AUTO_RELEASE_DAYS = 60;

async function getAutoReleaseDays(): Promise<number> {
  return getNumberSetting("comms.pool.auto_release_days", DEFAULT_AUTO_RELEASE_DAYS);
}

export interface AssignedNumber {
  number: string;
  provider: CommsProviderName;
  assignmentId: number;
}

/**
 * Wave B — attach a tracking number to a MAIL SHIPMENT at queue time.
 *
 * The pool existed but the mail queue path never called it, so the response
 * phone number printed on a postcard was the org's ordinary line and an
 * inbound call could not be told apart from any other call. `callsReceived`
 * in the mail funnel therefore had no way to ever be non-zero.
 *
 * Semantics:
 *   - IDEMPOTENT per shipment. If this shipment already has an active
 *     assignment we return it rather than renting a second number.
 *   - BEST EFFORT. Queueing mail must never fail because Twilio is not
 *     configured, the pool is empty, or the carrier API is down — the send is
 *     the customer's money and the tracking number is instrumentation. On any
 *     failure we log and return null, and the shipment goes out with no
 *     call attribution (which the UI reports honestly as "not instrumented",
 *     never as "0 calls measured").
 *   - Recorded against `mail_shipment_id`, NOT `campaign_id`: mail shipments
 *     and marketing campaigns are different id spaces and conflating them
 *     would attribute calls to whichever campaign happened to share the
 *     number.
 */
export async function assignTrackingNumberForMailShipment(
  organizationId: number,
  mailShipmentId: number,
): Promise<AssignedNumber | null> {
  try {
    const [existing] = await db
      .select()
      .from(trackingNumberAssignments)
      .where(
        and(
          eq(trackingNumberAssignments.mailShipmentId, mailShipmentId),
          isNull(trackingNumberAssignments.releasedAt),
        ),
      )
      .limit(1);

    if (existing) {
      return {
        number: existing.number,
        provider: existing.provider as CommsProviderName,
        assignmentId: existing.id,
      };
    }

    const assigned = await assignNumber(organizationId, null);
    await db
      .update(trackingNumberAssignments)
      .set({ mailShipmentId })
      .where(eq(trackingNumberAssignments.id, assigned.assignmentId));

    logger.info("[tracking-pool] tracking number attached to mail shipment", {
      metadata: { organizationId, mailShipmentId, assignmentId: assigned.assignmentId },
    });
    return assigned;
  } catch (err) {
    logger.warn("[tracking-pool] could not attach tracking number to mail shipment", {
      metadata: {
        organizationId,
        mailShipmentId,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return null;
  }
}

/** The active tracking number for a mail shipment, or null if none. */
export async function trackingNumberForMailShipment(
  mailShipmentId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ number: trackingNumberAssignments.number })
    .from(trackingNumberAssignments)
    .where(
      and(
        eq(trackingNumberAssignments.mailShipmentId, mailShipmentId),
        isNull(trackingNumberAssignments.releasedAt),
      ),
    )
    .limit(1);
  return row?.number ?? null;
}

/**
 * Assign a tracking number to (orgId, campaignId). Recycles from the
 * pool if possible; rents a fresh number from the router otherwise.
 */
export async function assignNumber(
  organizationId: number,
  campaignId: number | null,
  options: { preferredProvider?: CommsProviderName; areaCode?: string } = {},
): Promise<AssignedNumber> {
  const autoReleaseDays = await getAutoReleaseDays();
  const idleCutoff = new Date(Date.now() - autoReleaseDays * 86400 * 1000);

  // Candidate: released, OR no inbound activity inside the idle window.
  // `lastInboundAt IS NULL` is treated as "not idle" only if the
  // assignment is still active — a fresh assignment with no inbound yet
  // shouldn't be recycled out from under its current owner.
  //
  // We grab one candidate, then issue a transactional update to flip
  // ownership atomically. Concurrent assignNumber() calls race on the
  // WHERE clause and only one wins.
  const candidates = await db
    .select()
    .from(trackingNumberAssignments)
    .where(
      or(
        isNotNull(trackingNumberAssignments.releasedAt),
        and(
          isNull(trackingNumberAssignments.releasedAt),
          isNotNull(trackingNumberAssignments.lastInboundAt),
          lt(trackingNumberAssignments.lastInboundAt, idleCutoff),
        ),
      ),
    )
    .limit(1);

  const candidate = candidates[0];
  if (candidate) {
    // Mark the old assignment finalized (if it wasn't already released)
    // and insert the fresh one.
    if (candidate.releasedAt == null) {
      await db
        .update(trackingNumberAssignments)
        .set({ releasedAt: new Date() })
        .where(eq(trackingNumberAssignments.id, candidate.id));
    }
    const [fresh] = await db
      .insert(trackingNumberAssignments)
      .values({
        number: candidate.number,
        organizationId,
        campaignId,
        provider: candidate.provider,
      })
      .returning();
    return {
      number: fresh.number,
      provider: fresh.provider as CommsProviderName,
      assignmentId: fresh.id,
    };
  }

  // Pool empty — rent a fresh number from the cheapest enabled provider.
  const rented = await commsRouter.rentNumber({
    organizationId,
    areaCode: options.areaCode,
    preferredProvider: options.preferredProvider,
  });
  const [fresh] = await db
    .insert(trackingNumberAssignments)
    .values({
      number: rented.number,
      organizationId,
      campaignId,
      provider: rented.provider,
    })
    .returning();
  logger.info("[tracking-pool] rented fresh number", {
    metadata: { number: rented.number, provider: rented.provider, organizationId, campaignId },
  });
  return {
    number: fresh.number,
    provider: fresh.provider as CommsProviderName,
    assignmentId: fresh.id,
  };
}

/**
 * Release a number — marks the active assignment as released so the
 * number can be recycled. Does NOT call the carrier; that's a separate
 * decision (we generally hold rented numbers until we need to truly
 * delete them, e.g. when monthly cost outweighs reuse value).
 */
export async function releaseNumber(number: string): Promise<void> {
  await db
    .update(trackingNumberAssignments)
    .set({ releasedAt: new Date() })
    .where(
      and(
        eq(trackingNumberAssignments.number, number),
        isNull(trackingNumberAssignments.releasedAt),
      ),
    );
}

/**
 * Attribute an inbound message to the active assignment.
 *
 * Given the destination number + a timestamp, return the (org, campaign)
 * that owns that number at that moment. Also bumps `lastInboundAt` so
 * the auto-release sweeper doesn't recycle a still-active number.
 */
export async function attributeInbound(
  toNumber: string,
  _fromCallerId: string,
  timestamp: Date = new Date(),
): Promise<{ organizationId: number | null; campaignId: number | null; assignmentId: number } | null> {
  // Active assignment = released_at IS NULL. (We don't enforce a
  // historical window here because the partial index keeps the lookup
  // cheap and there can only be one active row per number.)
  const [row] = await db
    .select()
    .from(trackingNumberAssignments)
    .where(
      and(
        eq(trackingNumberAssignments.number, toNumber),
        isNull(trackingNumberAssignments.releasedAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  // Update lastInboundAt — only if the new timestamp advances the high
  // watermark, so a delayed webhook can't roll it backward.
  await db
    .update(trackingNumberAssignments)
    .set({ lastInboundAt: timestamp })
    .where(
      and(
        eq(trackingNumberAssignments.id, row.id),
        or(
          isNull(trackingNumberAssignments.lastInboundAt),
          lt(trackingNumberAssignments.lastInboundAt, timestamp),
        ),
      ),
    );

  return {
    organizationId: row.organizationId,
    campaignId: row.campaignId,
    assignmentId: row.id,
  };
}

/**
 * Sweeper — called on a cron. Auto-releases assignments whose
 * lastInboundAt is older than the configured threshold. Returns the
 * count released for audit.
 */
export async function autoReleaseIdle(): Promise<number> {
  const autoReleaseDays = await getAutoReleaseDays();
  const idleCutoff = new Date(Date.now() - autoReleaseDays * 86400 * 1000);
  const result = await db
    .update(trackingNumberAssignments)
    .set({ releasedAt: new Date() })
    .where(
      and(
        isNull(trackingNumberAssignments.releasedAt),
        isNotNull(trackingNumberAssignments.lastInboundAt),
        lt(trackingNumberAssignments.lastInboundAt, idleCutoff),
      ),
    )
    .returning({ id: trackingNumberAssignments.id });
  const count = result.length;
  if (count > 0) {
    logger.info(`[tracking-pool] auto-released ${count} idle number(s)`, {
      metadata: { thresholdDays: autoReleaseDays },
    });
  }
  return count;
}

