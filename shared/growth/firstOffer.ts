/**
 * What counts as "this org has made an offer" for Today's first-offer CTA.
 *
 * There is no single canonical offer record in the product, so the CTA reads
 * the three places an offer is genuinely recorded as SENT, and nothing else:
 *
 *   deals       a deal that has left "negotiating" (the activation event
 *               first_offer_made fires when a deal enters offer_sent)
 *   offers      a VA-engine offer row that has left draft/approved
 *   properties  a parcel the operator marked "Offer sent" / under contract
 *
 * Not counted, on purpose: a draft offer (QuickOfferModal creates an empty
 * one), a recorded wizard decision (priced, not sent), a cancelled deal (it
 * says nothing about whether an offer went out), and offer batches (they
 * cannot be created, so a batch test would never clear).
 */
import { ALL_FUNNEL_DEAL_STATUSES } from "../lifecycle/pipeline-status";

const DEAL_STATUSES_BEFORE_AN_OFFER: readonly string[] = ["negotiating", "cancelled"];

/** Derived from the canonical funnel so a new post-offer stage counts by default. */
export const OFFER_MADE_DEAL_STATUSES: readonly string[] = ALL_FUNNEL_DEAL_STATUSES.filter(
  (s) => !DEAL_STATUSES_BEFORE_AN_OFFER.includes(s),
);

/** offers.status vocabulary (shared/schema.ts): draft and approved have not been sent. */
export const OFFER_MADE_OFFER_STATUSES: readonly string[] = [
  "sent",
  "viewed",
  "accepted",
  "rejected",
  "expired",
  "countered",
];

/** properties.status: the parcel-level pipeline the Map door writes. */
export const OFFER_MADE_PROPERTY_STATUSES: readonly string[] = ["offer_sent", "under_contract"];
