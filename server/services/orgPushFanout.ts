/**
 * Org push fan-out — the ONE best-effort door from "an event card was created"
 * to "the org's subscribed phones buzz" (autonomy gap slice 7).
 *
 * Why this exists: Pax cards (nudges), redemption-clock alerts and borrower
 * ladder-ready cards were created in-app only, so every watch spoke into an app
 * the user had to open. Each creation site now calls `pushOrgEvent` AFTER its
 * own write has succeeded.
 *
 * Contract:
 *  - BEST EFFORT. Never throws, never rejects: a push problem must not fail,
 *    roll back or delay the creation of the event it announces.
 *  - ORG-SCOPED. Goes through `sendPushToOrg(organizationId, …)`, which filters
 *    `push_subscriptions` by organization. There is no person-global path here,
 *    and no founder-plane delivery (that is `sendPushToPerson`, a different door).
 *  - UNCONFIGURED IS A NO-OP. With no VAPID keys / no `web-push` package the
 *    underlying sender returns without touching the network.
 *  - Carries only what the in-app card already says. Callers must not put
 *    borrower names or other counterparty PII in a lock-screen payload.
 */

import { logger } from "../utils/logger";
import { sendPushToOrg, type PushPayload } from "./pushNotificationService";

export type OrgPushFamily = "pax_nudge" | "redemption_alert" | "ladder_ready";

export interface OrgPushEvent {
  family: OrgPushFamily;
  title: string;
  body: string;
  /** In-app deep link opened by the notification click. Must be a same-origin path. */
  url: string;
  /**
   * Collapses repeats on the device (same tag replaces, not stacks). Use a
   * stable per-entity key.
   */
  tag: string;
}

/**
 * Send one push to every subscribed user in `organizationId`. Resolves to
 * `true` when at least one device accepted it; `false` for every other outcome,
 * including errors. Never throws.
 */
export async function pushOrgEvent(
  organizationId: number,
  event: OrgPushEvent,
): Promise<boolean> {
  try {
    if (!Number.isInteger(organizationId) || organizationId <= 0) return false;
    const payload: PushPayload = {
      title: event.title,
      body: event.body,
      url: event.url,
      tag: event.tag,
      data: { family: event.family },
    };
    const result = await sendPushToOrg(organizationId, payload);
    return result.sent > 0;
  } catch (err) {
    logger.warn("[OrgPushFanout] push failed (event creation unaffected)", {
      metadata: {
        family: event.family,
        organizationId,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return false;
  }
}
