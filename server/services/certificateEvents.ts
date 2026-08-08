// ---------------------------------------------------------------------------
// Tax-lien / tax-deed certificate workflow-event emitters (audit Wave 1,
// beta→core).
//
// `emitCertEvent` has lived in the workflow engine but had ZERO call sites, so
// the four tax-cert templates a customer installed (tpl_tax_cert_acquired_kickoff
// / tpl_tax_cert_redemption_approaching / tpl_tax_cert_foreclosure_eligible /
// tpl_tax_cert_redeemed_payoff) sat idle forever — the entire tax-delinquent
// automation lane was dead. This module is the ONE seam the certificate lifecycle
// goes through to make `cert.acquired`, `cert.redemption_period_60d`,
// `cert.foreclosure_eligible` and `cert.redeemed` real.
//
// Sibling of rehabEvents.ts / dealEvents.ts / leadEvents.ts / propertyEvents.ts;
// same rules:
//   1. FIRE-AND-FORGET. A workflow failure must never fail a certificate write.
//      Every function wraps its emit in try/catch and never throws.
//   2. NEVER EMIT A NO-OP where a transition is required. cert.redeemed fires
//      ONLY on a genuine status transition into "redeemed" (real pre-image
//      status ≠ "redeemed"). cert.acquired fires unconditionally — a create IS
//      the genuine event.
//   3. NO FABRICATION. The payload carries ONLY columns the certificate row
//      genuinely holds plus per-state facts from the encoded rule table
//      (shared/regulatory/taxLienStateRules.ts). There is NO delinquent-owner
//      email column, so no cure-letter recipient is invented; the property is
//      identified by its APN/county/state, never a fabricated street address;
//      and every nullable field passes through as its real value or null,
//      never a placeholder 0.
//
// entityId: a certificate id is a varchar UUID but WorkflowEventData.entityId is
// numeric, so the cert's own propertyId (nullable — set only when a parcel is
// attached) is the numeric entity handle, falling back to 0 when absent. The
// cert UUID rides in data.certificateId (mirrors the rehab entityId comment).
//
// When an emit call site is added, shared/workflow-live-triggers.ts must list
// the event in the SAME change — tests/unit/workflowActionHonesty.test.ts pins
// that relationship.
// ---------------------------------------------------------------------------

import { emitCertEvent } from "./workflow-engine";
import {
  getStateRules,
  type StateTaxLienRules,
} from "@shared/regulatory/taxLienStateRules";
import { logger } from "../utils/logger";

/** The slice of a tax_certificates row these emitters need. Real columns only. */
export interface CertEventRow {
  id: string;
  organizationId: number;
  propertyId: number | null;
  state: string;
  county: string;
  apn: string;
  saleType: string;
  saleDate: string;
  bidDownRateBps: number | null;
  redemptionDeadline: string;
  status: string;
  redeemedAt?: string | null;
  redeemedAmountCents?: number | null;
}

/**
 * Honest property identifier. There is no street-address column on a tax
 * certificate (the parcel may never have been attached), so we identify by the
 * parcel number + county + state — the fields the row genuinely holds. NEVER a
 * fabricated street.
 */
const propertyLabel = (c: CertEventRow): string =>
  `APN ${c.apn} (${c.county}, ${c.state})`;

/**
 * The statutory / realized rate as a percent string ("12%", "14.25%"), or null
 * when neither the certificate's won bid-down rate nor the state's statutory
 * yield is known. Prefer the actually-won rate; fall back to the encoded state
 * default; refuse to invent one.
 */
const ratePct = (
  c: CertEventRow,
  rules: StateTaxLienRules | null,
): string | null => {
  const bps = c.bidDownRateBps ?? rules?.statutoryYieldBps ?? null;
  if (bps == null) return null;
  return `${bps / 100}%`;
};

const dollars = (cents: number | null | undefined): number | null =>
  cents == null ? null : Math.round(cents) / 100;

/**
 * Emit cert.acquired on certificate creation. A create IS the genuine event, so
 * this fires unconditionally. Fire-and-forget: never throws.
 */
export function emitCertAcquired(c: CertEventRow): void {
  try {
    const rules = getStateRules(c.state);
    emitCertEvent("cert.acquired", c.organizationId, c.propertyId ?? 0, {
      certificateId: c.id,
      propertyAddress: propertyLabel(c),
      state: c.state,
      saleType: c.saleType,
      certificateAcquiredDate: c.saleDate,
      redemptionEndsDate: c.redemptionDeadline,
      stateRedemptionPeriodMonths:
        rules?.redemptionPeriodMonths ?? rules?.postSaleRedemptionMonths ?? null,
      stateStatutoryRatePct: ratePct(c, rules),
    });
  } catch (err) {
    logger.warn(`[certificateEvents] emit cert.acquired failed for cert ${c.id}`, {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

/**
 * Emit cert.redeemed ONLY on a genuine transition into "redeemed" (pre-image
 * status was NOT already "redeemed", post-image status IS). Any other status
 * edit is a no-op. Fire-and-forget: never throws.
 */
export function emitCertRedeemed(
  beforeStatus: string | null | undefined,
  c: CertEventRow,
): void {
  try {
    if (beforeStatus === "redeemed" || c.status !== "redeemed") return; // no genuine transition
    const rules = getStateRules(c.state);
    emitCertEvent("cert.redeemed", c.organizationId, c.propertyId ?? 0, {
      certificateId: c.id,
      propertyAddress: propertyLabel(c),
      state: c.state,
      redeemedDate: c.redeemedAt ?? null,
      redemptionAmount: dollars(c.redeemedAmountCents),
      stateStatutoryRatePct: ratePct(c, rules),
    });
  } catch (err) {
    logger.warn(`[certificateEvents] emit cert.redeemed failed for cert ${c.id}`, {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

/**
 * Emit cert.redemption_period_60d when the redemption window is 60 days out.
 * The caller (the nightly redemption-clock job) is responsible for the 60-day
 * gating + dedupe; this just carries the real payload. Fire-and-forget.
 */
export function emitCertRedemptionApproaching(c: CertEventRow): void {
  try {
    const rules = getStateRules(c.state);
    emitCertEvent(
      "cert.redemption_period_60d",
      c.organizationId,
      c.propertyId ?? 0,
      {
        certificateId: c.id,
        propertyAddress: propertyLabel(c),
        redemptionEndsDate: c.redemptionDeadline,
        stateForeclosureNoticeMonths: rules?.preForeclosureNoticeMonths ?? null,
      },
    );
  } catch (err) {
    logger.warn(
      `[certificateEvents] emit cert.redemption_period_60d failed for cert ${c.id}`,
      { metadata: { error: err instanceof Error ? err.message : String(err) } },
    );
  }
}

/**
 * Emit cert.foreclosure_eligible when the redemption window has lapsed. The
 * caller gates on the lapsed deadline + dedupe; this carries the real payload.
 * Fire-and-forget.
 */
export function emitCertForeclosureEligible(c: CertEventRow): void {
  try {
    const rules = getStateRules(c.state);
    emitCertEvent(
      "cert.foreclosure_eligible",
      c.organizationId,
      c.propertyId ?? 0,
      {
        certificateId: c.id,
        propertyAddress: propertyLabel(c),
        redemptionEndsDate: c.redemptionDeadline,
        state: c.state,
        stateForeclosureNoticeMonths: rules?.preForeclosureNoticeMonths ?? null,
        stateStatutoryReference: rules?.statutoryReference ?? null,
      },
    );
  } catch (err) {
    logger.warn(
      `[certificateEvents] emit cert.foreclosure_eligible failed for cert ${c.id}`,
      { metadata: { error: err instanceof Error ? err.message : String(err) } },
    );
  }
}
