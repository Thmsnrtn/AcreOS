// ---------------------------------------------------------------------------
// The webhook event vocabulary — ONE catalogue, shared by the dispatcher, the
// save route and the settings panel.
//
// There were three lists. `server/services/webhookDispatcher.ts` declared a
// 36-member `WebhookEventType` union, `client/src/pages/webhooks.tsx` offered a
// hand-written 15-event picker, and the two overlapped by nine. **Six of the
// fifteen events a customer could subscribe to did not exist in the server's
// vocabulary at all** — `offer.sent`, `offer.accepted`, `deal.status_changed`,
// `payment.late`, `property.updated` and `task.created`. Ticking any of them
// stored a string nothing would ever match, and the panel showed it ticked.
//
// Four of the six are near-miss renames of real events (the wire names are
// `deal.offer_sent`, `deal.offer_accepted`, `deal.stage_changed`,
// `payment.overdue`), which is what makes this class so easy to ship: the list
// looks right, and nothing anywhere compares the two.
//
// Deriving both ends from this file is the fix. The picker cannot offer an
// event the wire does not carry, because it is the same array.
// ---------------------------------------------------------------------------

/** Every event name the dispatcher understands. The wire vocabulary. */
export const WEBHOOK_EVENT_IDS = [
  // Lead lifecycle
  "lead.created",
  "lead.updated",
  "lead.deleted",
  "lead.responded",
  "lead.status_changed",
  "lead.score_changed",
  // Deal lifecycle
  "deal.created",
  "deal.stage_changed",
  "deal.closed_won",
  "deal.closed_lost",
  "deal.closed",
  "deal.offer_sent",
  "deal.offer_accepted",
  // Property
  "property.created",
  "property.enriched",
  "property.lcs_updated",
  // Note lifecycle
  "note.created",
  "note.payment_received",
  "note.payment_overdue",
  "note.paid_off",
  "note.delinquent",
  // Payment
  "payment.received",
  "payment.overdue",
  "payment.failed",
  // Campaign
  "campaign.sent",
  "campaign.response_received",
  "campaign.response",
  // Marketplace
  "listing.created",
  "listing.offer_received",
  "listing.sold",
  // System
  "deal_feed.generated",
  "compliance.alert",
  "agent.action_taken",
  // Legacy
  "sms.reply",
  "sequence.completed",
  "task.completed",
] as const;

export type WebhookEventId = (typeof WEBHOOK_EVENT_IDS)[number];

const KNOWN = new Set<string>(WEBHOOK_EVENT_IDS);

export function isKnownWebhookEvent(id: string): id is WebhookEventId {
  return KNOWN.has(id);
}

// ---------------------------------------------------------------------------
// LIVE events — the ones with a real dispatch call site in server/ TODAY.
//
// Every other event in the vocabulary above is declared and never fired: a
// subscription to it sits idle until its emitter ships. The panel badges them,
// rather than presenting a subscription that cannot arrive as if it worked.
//
// This is the same discipline as `shared/workflow-live-triggers.ts`, and for
// the same reason: Wave B badged six genuinely-firing triggers as "Not yet
// live" from a hand-maintained list that had gone stale. So the list below is
// asserted against call sites DERIVED FROM SOURCE by
// `tests/unit/webhookEventCatalogue.test.ts` — it cannot drift from reality
// without that test failing.
//
//   lead.created
//       server/routes-leads.ts → webhookLeadCreated(org.id, lead) on the
//       single-lead create path.
//
// The dispatcher also exports webhookLeadStatusChanged, webhookDealCreated,
// webhookDealStageChanged, webhookPaymentReceived and webhookCampaignResponse.
// **None of them has a call site.** They are wrappers waiting for the seam that
// calls them, which is exactly why they must not count as live.
// ---------------------------------------------------------------------------

export const LIVE_WEBHOOK_EVENTS: readonly string[] = ["lead.created"] as const;

const LIVE = new Set<string>(LIVE_WEBHOOK_EVENTS);

export function isLiveWebhookEvent(id: string): boolean {
  return LIVE.has(id);
}

// ---------------------------------------------------------------------------
// The picker — the curated subset the settings panel offers.
//
// A subset is a product decision and perfectly honest; a subset containing
// names the wire does not carry is not. Every id here is checked against
// WEBHOOK_EVENT_IDS by the catalogue test, so the two cannot diverge again.
// ---------------------------------------------------------------------------

export interface WebhookEventChoice {
  id: WebhookEventId;
  label: string;
  group: string;
}

export const WEBHOOK_EVENT_CHOICES: readonly WebhookEventChoice[] = [
  { id: "lead.created", label: "Lead created", group: "Leads" },
  { id: "lead.updated", label: "Lead updated", group: "Leads" },
  { id: "lead.status_changed", label: "Lead status changed", group: "Leads" },
  { id: "property.created", label: "Property created", group: "Properties" },
  { id: "deal.created", label: "Deal created", group: "Deals" },
  { id: "deal.closed", label: "Deal closed", group: "Deals" },
  { id: "deal.stage_changed", label: "Deal stage changed", group: "Deals" },
  { id: "deal.offer_sent", label: "Offer sent", group: "Deals" },
  { id: "deal.offer_accepted", label: "Offer accepted", group: "Deals" },
  { id: "payment.received", label: "Payment received", group: "Finance" },
  { id: "payment.overdue", label: "Payment overdue", group: "Finance" },
  { id: "campaign.sent", label: "Campaign sent", group: "Marketing" },
  { id: "task.completed", label: "Task completed", group: "Tasks" },
] as const;

export const WEBHOOK_EVENT_GROUPS: readonly string[] = Array.from(
  new Set(WEBHOOK_EVENT_CHOICES.map((e) => e.group)),
);

// ---------------------------------------------------------------------------
// Legacy subscription names already sitting in customers' stored endpoints.
//
// These were offered by the old picker and never existed on the wire. Four are
// unambiguous renames of a real event — the SAME intent, spelled a way the
// dispatcher never used — so they are normalised on read, exactly as unit 41
// normalises the legacy `enabled` flag. That is not rewriting a customer's
// intent; it is honouring the intent they expressed through the only control
// they were given.
//
// `property.updated` and `task.created` have no counterpart in the vocabulary
// and are dropped on read. They were inert from the moment they were stored,
// and inventing a destination for them would be a guess about what the customer
// meant.
// ---------------------------------------------------------------------------

export const LEGACY_EVENT_RENAMES: Readonly<Record<string, WebhookEventId>> = {
  "offer.sent": "deal.offer_sent",
  "offer.accepted": "deal.offer_accepted",
  "deal.status_changed": "deal.stage_changed",
  "payment.late": "payment.overdue",
};

/** Event names that were offered, never existed, and have no real counterpart. */
export const LEGACY_EVENTS_DROPPED: readonly string[] = [
  "property.updated",
  "task.created",
];

/**
 * A stored subscription list, in today's vocabulary. Unknown names that are
 * neither a known event nor a known legacy name are KEPT: this function exists
 * to repair names this codebase got wrong, not to quietly discard something a
 * customer configured that we simply do not recognise.
 */
export function normalizeSubscribedEvents(events: readonly string[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    const mapped = LEGACY_EVENT_RENAMES[e];
    if (mapped) {
      if (!out.includes(mapped)) out.push(mapped);
      continue;
    }
    if (LEGACY_EVENTS_DROPPED.includes(e)) continue;
    if (!out.includes(e)) out.push(e);
  }
  return out;
}
