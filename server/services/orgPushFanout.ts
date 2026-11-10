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
 *  - RESPECTS MUTE (founder decision, 2026-11-10). Each recipient's stored
 *    notification preferences are consulted before dispatch: a globally muted
 *    user, or a user who turned push off for the family's mapped preference
 *    event (see ORG_PUSH_FAMILY_EVENT_ID), receives NO push from this fan-out.
 *    A preference read that fails counts as "no preference recorded" (the
 *    user keeps the event's default), never as a mute. In-app cards are
 *    unaffected — this door only governs the phone buzz.
 *  - UNCONFIGURED IS A NO-OP. With no VAPID keys / no `web-push` package the
 *    underlying sender returns without touching the network.
 *  - Carries only what the in-app card already says. Callers must not put
 *    borrower names or other counterparty PII in a lock-screen payload.
 */

import { logger } from "../utils/logger";
import { sendPushToOrg, type PushPayload } from "./pushNotificationService";
import { notificationPrefsService } from "./notificationPreferences";

export type OrgPushFamily = "pax_nudge" | "redemption_alert" | "ladder_ready";

/**
 * The fan-out family for an event, mapped to the `notificationPreferences`
 * event id whose per-user push toggle governs it (founder decision
 * 2026-11-10: RESPECT MUTE):
 *  - `pax_nudge` → `pax.needs_you`: an urgent Pax card is Pax waiting on the
 *    user — exactly the schema event written for it.
 *  - `ladder_ready` → `finance.payment_missed`: a borrower rung goes ready
 *    because a payment on a note the user holds is late.
 *  - `redemption_alert` → `deal.closing_reminder`: the nearest schema event
 *    (a hard deadline days away on the user's own position). There is no
 *    tax-certificate event in the schema — adding one is a deliberate
 *    product act, not a drive-by in a fan-out fix.
 * A user's explicit push override for the mapped id is honoured either way;
 * with no override, the schema's `defaultChannels.push` for that id decides
 * (all three currently default push ON, matching the pre-fix behaviour for
 * users who never touched the setting).
 *
 * ONE DELIBERATE DIVERGENCE, named rather than hidden: the settings page
 * keeps `pax.needs_you`'s push toggle OFF by default because the schema
 * comment records push as "not switched on until the org-scoped push lane is
 * proven" — and this slice IS that lane. Slice 7 shipped urgent-nudge push
 * live for every org member; gating `pax_nudge` on `pax.needs_you`'s schema
 * default would silently switch that shipped behaviour OFF for everyone who
 * never opened the settings page. So `pax_nudge` resolves as: globalMute →
 * no push; explicit `pax.needs_you` push override → honoured either way; no
 * override → push (the shipped behaviour). The other two families follow
 * their mapped events' schema defaults, which are push ON — the same
 * outcome by the plain rule. If Pax push should become opt-in later, that
 * is a product decision to flip deliberately, not a side effect of this fix.
 */
export const ORG_PUSH_FAMILY_EVENT_ID: Record<OrgPushFamily, string> = {
  pax_nudge: "pax.needs_you",
  redemption_alert: "deal.closing_reminder",
  ladder_ready: "finance.payment_missed",
};

/**
 * Families whose no-override default stays PUSH ON even where the mapped
 * schema event defaults push off — see the divergence note above. Only
 * `pax_nudge` today (its lane shipped live in this PR; the schema default
 * predates the lane's proof).
 */
export const ORG_PUSH_FAMILY_DEFAULT_ON: ReadonlySet<OrgPushFamily> = new Set(["pax_nudge"]);

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
    const result = await sendPushToOrg(organizationId, payload, {
      // Mute gate (founder decision 2026-11-10): a stored refusal — global
      // mute, or push off for the family's mapped preference event — drops
      // that user's devices. `undefined` (no stored row / unreadable prefs)
      // is NOT a refusal: the user keeps the mapped event's default.
      mayPushToUser: async (userIds) =>
        notificationPrefsService.getPushEligibility(userIds, ORG_PUSH_FAMILY_EVENT_ID[event.family], {
          defaultWhenNoOverride: ORG_PUSH_FAMILY_DEFAULT_ON.has(event.family) ? true : undefined,
        }),
    });
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
