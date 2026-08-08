/**
 * Buy-and-hold vertical BH-3 — rent ledger + state-aware late-fee engine.
 *
 * Imelda §2.4-§2.5:
 *   "Anyone shipping landlord rent collection has to ship a state-rule
 *    engine, not just a templated email."
 *   "If Maria in Unit 3B owes \$1,400 and pays \$700 on the 5th and \$700
 *    on the 18th, my system needs to know that the first \$700 doesn't
 *    satisfy the rent and doesn't stop the late-fee clock unless I say so.
 *    In Texas, accepting partial rent after filing a notice to vacate can
 *    void the notice and force me to start over."
 *
 *   GET   /api/rent-charges/scheduled-preview   — what the schedule WOULD post
 *   POST  /api/rent-charges/generate-scheduled  — post it (operator-confirmed)
 *   GET   /api/leases/:id/ledger                — full ledger (charges + payments)
 *   POST  /api/leases/:id/payments              — record payment (multi-charge)
 *   GET   /api/rent-charges/:id/late-fee-proposal — propose, never charge
 *   GET   /api/rent/late-fee-proposals          — org-wide proposals
 *   POST  /api/rent-charges/:id/apply-late-fee  — charge a CONFIRMED proposal
 *   POST  /api/rent-charges/:id/legal-posture   — flip to notice_served / etc
 *   GET   /api/late-fee-rules                   — list seeded rules
 *   GET   /api/rent/aging                       — org-wide aging buckets
 *   GET   /api/rent-ledger/summary              — money received since <date>
 *   GET   /api/leases/:id/security-deposit      — deposit + statutory clock
 *   POST  /api/leases/:id/security-deposit/clock          — (re)start the clock
 *   POST  /api/leases/:id/security-deposit/disposition-letter — itemised letter
 *
 * Every line above is a route registered in this file's body. If a route is
 * ever removed, remove its line in the same edit: a header that advertises
 * endpoints which do not exist is the dishonesty this codebase keeps deleting.
 *
 * MONEY POSTURE — this file is a LEDGER, not a payment rail. Nothing here
 * touches a payment processor and nothing here moves funds; a rent_payment row
 * records money the landlord received on their own rails. That is deliberate
 * and permanent (founder ruling "be the rail, not the provider", 2026-07-29):
 * customer money never moves on AcreOS's account, so AcreOS does not collect
 * rent. Every surface must read as "record what you received", never "we'll
 * collect it".
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, asc, desc, sql, gt } from "drizzle-orm";
import { db } from "./db";
import {
  rentalLeases,
  rentalUnits,
  rentCharges,
  rentPayments,
  rentPaymentAllocations,
  lateFeeRules,
  securityDeposits,
  leaseTenants,
  tenants,
  properties,
  organizations,
} from "@shared/schema";
import type { LateFeeRule, RentalUnitStatus } from "@shared/schema";
import {
  parseLateFeeRuleRow,
  proposeLateFee,
  type LateFeeProposal,
  type LateFeeRuleData,
} from "@shared/rental/lateFeeProposal";
import {
  recordRentPayment,
  PartialPaymentUnderNoticeError,
} from "./services/rental/paymentPosting";
import {
  previewScheduledCharges,
  generateScheduledCharges,
} from "./services/rental/rentChargeGenerator";
import { startDepositClock, resolveMoveOutDate } from "./services/rental/depositClock";
import {
  buildDispositionLetter,
  DispositionLetterBlockedError,
} from "./services/rental/depositDisposition";
import { computeDepositDeadline, depositDeadlineCountdown } from "@shared/regulatory/depositReturnRules";
import { tenantDisplayName } from "@shared/rental/tenantName";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganization, getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors, sendError } from "./utils/errors";
import { logger } from "./utils/logger";
import { emitPaymentEvent } from "./services/workflow-engine";
// Audit Wave 1 (buy_and_hold beta→core): the landlord rent-receipt template never
// ran because nothing emitted rent.received. This fires it, SECOND, right after
// the pre-existing payment.received emit — both for one payment, on purpose (the
// generic money lane vs. the landlord receipt lane). Fire-and-forget — see
// services/rentalEvents.ts.
import { emitRentReceived } from "./services/rentalEvents";

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

// NOTE — `POST /api/leases/:id/rent-charges/seed` was DELETED here (2026-07-30)
// rather than kept alongside the scheduled generator. It was a second, worse
// charge-creation path: it snapped to "first of next month", generated a fixed
// N months regardless of the lease's own start and end dates (so it would post
// rent for months after the tenancy ended), and had zero callers anywhere in
// the repo. `GET /api/rent-charges/scheduled-preview` +
// `POST /api/rent-charges/generate-scheduled` do the same job from the lease's
// real schedule, idempotently, and refuse to invent a prorated partial period.
// One way rent gets onto the ledger.

const paymentSchema = z.object({
  amountCents: z.coerce.number().int().nonnegative(),
  receivedAt: z.string(),
  method: z.string().optional(),
  referenceNumber: z.string().optional(),
  payorType: z.enum(["tenant", "hap"]).default("tenant"),
  payorTenantId: z.string().uuid().optional(),
  acceptedDespitePartial: z.boolean().default(false),
  notes: z.string().optional(),
});

const postureSchema = z.object({
  legalPosture: z.enum(["ok", "late", "notice_served", "eviction_filed"]),
  notes: z.string().optional(),
});

/** YYYY-MM-DD, validated rather than coerced — a bad date must not become one. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

const scheduledPreviewSchema = z.object({
  /** Generate periods whose month starts on or before this. Default: today. */
  throughDate: isoDate.optional(),
  leaseId: z.string().uuid().optional(),
});

const generateScheduledSchema = scheduledPreviewSchema;

/**
 * A late fee is a PROPOSAL until an operator confirms the exact figure. When
 * `confirmFeeCents` is supplied it must equal the figure the server proposes,
 * so nobody can confirm an amount they were never shown; the caller that omits
 * it is trusted to have shown the proposal itself (the /rent-roll dialog does)
 * and gets the server's capped figure.
 */
const applyLateFeeSchema = z.object({
  confirmFeeCents: z.coerce.number().int().nonnegative().optional(),
});

const depositClockSchema = z.object({
  /** Override the resolved trigger date (e.g. keys came back later). */
  moveOutDate: isoDate.optional(),
});

const dispositionLetterSchema = z.object({
  /** The date the letter is dated. Default: today. */
  letterDate: isoDate.optional(),
  /** Tenant-supplied forwarding address, when one was recorded. */
  forwardingAddress: z.string().max(500).optional(),
});

// ----------------------------------------------------------------------------
// Workflow payment events (Wave B — "wire the engine")
// ----------------------------------------------------------------------------
// POST /api/leases/:id/payments is the ONLY writer of the rent_payments
// ledger (the single `insert(rentPayments)` in the repo), so it is the one
// emit site for rent — exactly one `payment.received` per posted row.
//
// Money-path discipline: the insert + charge update run inside a db
// transaction; the emit runs AFTER that transaction has committed and is
// wrapped so a workflow failure can never fail, roll back, or double-post
// rent. Never throws back into the request.
//
// `entityId` is 0 because rent_payments is uuid-keyed while
// emitPaymentEvent's entityId is numeric; the real key rides in
// `data.paymentId`.
const UUID_KEYED_PAYMENT_ENTITY_ID = 0;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days between a charge's due date and the date the payment was
 * received. Both are stored `date` columns (YYYY-MM-DD). Returns null when
 * the payment applied to no open charge (nothing to be late against) or a
 * date is unparseable — the event carries `null`, never a guessed number.
 */
export function daysLateForRentPayment(
  dueDate: string | null | undefined,
  receivedAt: string | null | undefined,
): number | null {
  if (!dueDate || !receivedAt) return null;
  const due = new Date(`${String(dueDate).slice(0, 10)}T00:00:00.000Z`).getTime();
  const paid = new Date(`${String(receivedAt).slice(0, 10)}T00:00:00.000Z`).getTime();
  if (Number.isNaN(due) || Number.isNaN(paid)) return null;
  const diffDays = Math.floor((paid - due) / DAY_MS);
  return diffDays > 0 ? diffDays : 0;
}

/** Whole days a charge due on `dueDate` is overdue as of `asOf`. Never negative. */
export function daysOverdue(dueDate: string | null | undefined, asOf: Date): number | null {
  if (!dueDate) return null;
  const due = new Date(`${String(dueDate).slice(0, 10)}T00:00:00.000Z`).getTime();
  if (Number.isNaN(due)) return null;
  const today = new Date(`${asOf.toISOString().slice(0, 10)}T00:00:00.000Z`).getTime();
  const diff = Math.floor((today - due) / DAY_MS);
  return diff > 0 ? diff : 0;
}

/** Everything the emit needs, read from rows that are already committed. */
export interface PostedRentPayment {
  organizationId: number;
  leaseId: string;
  paymentId: string;
  rentChargeId: string | null;
  amountCents: number;
  isPartial: boolean;
  payorType: string;
  method: string | null;
  receivedAt: string;
  dueDate: string | null;
  chargeAmountCents: number | null;
  /** rent_charges.balance_cents AFTER this payment applied. */
  chargeBalanceAfterCents: number | null;
  legalPosture: string | null;
  /** Cents that landed on a charge. Omitted ⇒ reported as null, never guessed. */
  allocatedCents?: number | null;
  /** Cents held as an explicit credit because no open charge was left. */
  unappliedCents?: number | null;
  /** How many charges this one payment cured or reduced. */
  allocationLineCount?: number | null;
  /** Plain-language "where did my money go" line. */
  allocationExplanation?: string | null;
}

/** The `data` bag workflow conditions match on / templates interpolate. */
export function buildRentPaymentEventData(p: PostedRentPayment): Record<string, any> {
  return {
    source: "rent_ledger",
    // Identity
    leaseId: p.leaseId,
    paymentId: p.paymentId,
    rentChargeId: p.rentChargeId,
    // Money
    amountCents: p.amountCents,
    amount: p.amountCents / 100,
    chargeAmountCents: p.chargeAmountCents,
    chargeBalanceAfterCents: p.chargeBalanceAfterCents,
    // Shape
    isPartial: p.isPartial,
    isFullPayment: p.chargeBalanceAfterCents === null ? null : p.chargeBalanceAfterCents === 0,
    payorType: p.payorType,
    paymentMethod: p.method,
    paymentDate: p.receivedAt,
    dueDate: p.dueDate,
    daysLate: daysLateForRentPayment(p.dueDate, p.receivedAt),
    legalPosture: p.legalPosture,
    // Allocation shape — a payment can now cure several months at once.
    allocatedCents: p.allocatedCents ?? null,
    unappliedCents: p.unappliedCents ?? null,
    chargesTouched: p.allocationLineCount ?? null,
    allocationExplanation: p.allocationExplanation ?? null,
  };
}

/**
 * Fire-and-forget workflow emit for rent that is ALREADY committed to the
 * ledger. Never throws.
 */
export function emitRentPaymentReceived(p: PostedRentPayment): void {
  try {
    emitPaymentEvent(
      "payment.received",
      p.organizationId,
      UUID_KEYED_PAYMENT_ENTITY_ID,
      buildRentPaymentEventData(p),
    );
  } catch (err) {
    // Swallowed on purpose — the rent is banked; a workflow fault must not
    // change the response or the ledger.
    logger.error(
      "[BH-3] rent payment workflow emit failed (payment already posted)",
      err instanceof Error ? err : undefined,
      { organizationId: p.organizationId, leaseId: p.leaseId, paymentId: p.paymentId },
    );
  }
}

// ----------------------------------------------------------------------------
// Late fees — a PROPOSAL, computed from the late_fee_rules table seeded in BH-1
// by the one shared implementation (@shared/rental/lateFeeProposal).
// ----------------------------------------------------------------------------
// This route file used to carry its own `computeLateFee`, which rounded the
// statutory percentage cap (`Math.round`) instead of flooring it. One cent over
// a statutory cap is still over the cap, and the /rent-roll dialog showed the
// operator the SHARED module's (floored) figure while the server charged its
// own — two implementations of the same statute, differing by a cent, one of
// them shown and the other billed. There is now exactly one: the shared,
// floored, cap-respecting proposer, used by both sides.

/**
 * How the unit count behind a statutory cap was arrived at. The cap is a legal
 * figure, so the operator is owed the provenance of the number it keyed off —
 * "counted from your inventory" and "the least it could possibly be" are not
 * the same claim and must not render identically.
 *
 *  - `modelled_units`      — counted from `rental_units`. EXACT, so the statute
 *                            is applied as written, one branch, no hedge.
 *  - `lease_derived_floor` — no units are modelled at this property, so the
 *                            only ground truth is the number of DISTINCT units
 *                            this org has ever put on a lease there. A FLOOR,
 *                            never a count, and treated as such.
 */
export type UnitCountBasis = "modelled_units" | "lease_derived_floor";

export interface PropertyUnitCount {
  count: number;
  basis: UnitCountBasis;
  /**
   * What the count WOULD have been from lease history alone. Populated only
   * for `modelled_units`, where it is the reference point for disclosing that
   * an exact count moved the fee. Absent for `lease_derived_floor`, where it
   * would simply repeat `count`.
   */
  leaseDerivedFloor?: number;
}

/**
 * Which unit statuses count toward the STATUTORY unit count.
 *
 * `active` + `offline`, never `retired`. This is a legal judgement, not an
 * implementation detail. Tex. Prop. Code §92.019 keys its cap off how many
 * dwelling units the STRUCTURE contains, not off how many the landlord happens
 * to be able to rent this month: a unit gutted by a fire or held empty
 * mid-renovation is still a unit in the building, and the cap that applies to
 * the tenant next door must not move because a contractor is behind schedule.
 * `retired` is the opposite case — the slot no longer exists as a unit
 * (combined into its neighbour, demolished), so counting it would overstate the
 * structure and, in states where the larger-property percentage is the higher
 * one, overcharge.
 *
 * Deliberately a DIFFERENT denominator from the occupancy one, which excludes
 * `offline` (see `rentalUnits.status` in shared/schema/rental.ts). Two
 * questions, two denominators, on purpose — folding them together is how one of
 * the two numbers starts lying.
 */
export const STATUTORY_UNIT_STATUSES: readonly RentalUnitStatus[] = ["active", "offline"];

/**
 * A FLOOR on the property's unit count, derived from lease data only.
 *
 * The fallback for a property whose units are not modelled. `properties` has no
 * unit_count column, so the only ground truth left is the number of DISTINCT
 * units this org has ever put on a lease at the property — a floor on the true
 * count. `proposeLateFee` treats a floor under 4 as "unknowable" and computes
 * BOTH branches, charging the lower.
 *
 * Behaviour here is deliberately UNCHANGED by the units table. Charging a
 * tenant more because a landlord has not finished entering their inventory
 * would be the platform billing someone for its own missing data.
 */
async function leaseDerivedUnitCountFloor(orgId: number, propertyId: number): Promise<number> {
  const unitCountRow = await db.execute(sql`
    SELECT COUNT(DISTINCT COALESCE(unit_label, ''))::int AS c
    FROM rental_leases
    WHERE property_id = ${propertyId}
      AND organization_id = ${orgId}
  `);
  // drizzle's execute() result shape is driver-dependent (node-postgres wraps
  // rows in `.rows`; others return the array directly). Narrowed to a precise
  // row shape rather than `as any`: this figure picks the statutory late-fee
  // cap, and an untyped hop is exactly where a mispriced charge hides.
  const rows: Array<{ c?: number }> = Array.isArray(unitCountRow)
    ? (unitCountRow as unknown as Array<{ c?: number }>)
    : ((unitCountRow as unknown as { rows?: Array<{ c?: number }> }).rows ?? []);
  return Math.max(1, Number(rows[0]?.c ?? 0) || 0);
}

/**
 * The property's unit count for statutory purposes, WITH the provenance of the
 * figure.
 *
 * A real `rental_units` table now exists, so for any property whose units are
 * modelled the count is EXACT rather than a floor, and the statute can be
 * applied as written instead of hedged. Properties that have not been modelled
 * fall back to the lease-derived floor, byte-for-byte as before.
 */
async function unitCountForProperty(orgId: number, propertyId: number): Promise<PropertyUnitCount> {
  // Statuses come back rather than a `COUNT(*) FILTER (…)` so the status rule
  // above stays in TypeScript, next to the reasoning that justifies it, instead
  // of inside a SQL string — and so the read is fully typed end to end. This
  // figure picks a statutory late-fee cap, and an untyped hop is exactly where a
  // mispriced charge hides. Org-scoped, covered by
  // rental_units_org_property_idx, and memoised per property by the org-wide
  // proposals route.
  const unitRows = await db
    .select({ status: rentalUnits.status })
    .from(rentalUnits)
    .where(and(
      eq(rentalUnits.organizationId, orgId),
      eq(rentalUnits.propertyId, propertyId),
    ));

  const modelledCount = unitRows.filter((u) => STATUTORY_UNIT_STATUSES.includes(u.status)).length;
  if (modelledCount > 0) {
    // The floor is read even when an exact count is available. It costs one
    // indexed query and it is the only way the proposal can tell an operator
    // WHY a fee moved when their inventory landed — without it the disclosure
    // in `proposeLateFeeForUnitCount` is unreachable, which is this repo's
    // most common defect (built, then never wired to the thing that needs it).
    const leaseDerivedFloor = await leaseDerivedUnitCountFloor(orgId, propertyId);
    return { count: modelledCount, basis: "modelled_units", leaseDerivedFloor };
  }

  // Either nothing is modelled here, or every row is `retired`. A property with
  // no live units says nothing usable about the structure a sitting tenant is
  // living in, so fall back rather than assert a count of zero — an empty
  // inventory is missing data, and missing data is never a fact about a tenant.
  return {
    count: await leaseDerivedUnitCountFloor(orgId, propertyId),
    basis: "lease_derived_floor",
  };
}

/** A proposal that carries the unit figure — and its provenance — it keyed off. */
export interface UnitAwareLateFeeProposal extends LateFeeProposal {
  unitCount: number;
  unitCountBasis: UnitCountBasis;
}

/**
 * The whole unit-count decision, as a PURE function: count + basis + the state
 * rule in, capped proposal out. No DB, no clock — so the branch a tenant is
 * charged under is directly testable (tests/unit/rentalUnitCountForCap.test.ts).
 *
 * `modelled_units`      → the statutory branch the count actually selects,
 *                         exactly, with no both-branches hedge.
 * `lease_derived_floor` → today's behaviour, untouched: under 4 the true count
 *                         is unknowable, so both branches are computed and the
 *                         LOWER fee wins.
 */
export function proposeLateFeeForUnitCount(args: {
  rule: LateFeeRuleData | null;
  monthlyRentCents: number;
  daysLate: number;
  units: PropertyUnitCount;
  state: string;
  /**
   * What the lease-derived floor for this same property would be. Supplied by
   * the route so an exact count can be compared against what AcreOS would have
   * proposed while still ignorant — the disclosure in the ≥ 4 branch depends on
   * it. Omit and the comparison degrades to "no movement to report", which is
   * the safe reading for a caller that cannot compute the floor.
   */
  leaseDerivedFloor?: number;
}): UnitAwareLateFeeProposal {
  const { rule, monthlyRentCents, daysLate, units, state } = args;

  const stamp = (p: LateFeeProposal, note = ""): UnitAwareLateFeeProposal => ({
    ...p,
    explanation: note ? `${p.explanation}${note}` : p.explanation,
    unitCount: units.count,
    unitCountBasis: units.basis,
  });

  // What AcreOS proposes when this same figure is read as a FLOOR — i.e. exactly
  // what shipped before the units table existed. Kept as the reference point
  // for the non-regression rail below, and returned verbatim when the count is
  // in fact only a floor.
  const floorPath = proposeLateFee({
    rule,
    monthlyRentCents,
    daysLate,
    knownUnitCountFloor: units.count,
    state,
  });

  if (units.basis === "lease_derived_floor") return stamp(floorPath);

  // What AcreOS WOULD have proposed for this same property before its units
  // were modelled — the lease-derived floor is still derivable, and comparing
  // against it is the only way to know whether an exact count moved the money.
  const floorCount = args.leaseDerivedFloor ?? units.count;
  const largeBranchFromFloor = {
    unitCount: floorCount,
    proposedFeeCents: proposeLateFee({
      rule, monthlyRentCents, daysLate, knownUnitCountFloor: floorCount, state,
    }).proposedFeeCents,
  };

  // ── The count is EXACT from here down. ───────────────────────────────────
  //
  // WHAT KNOWING THE COUNT CAN AND CANNOT CHANGE (corrected 2026-07-31)
  //
  // An earlier version of this comment claimed that modelling a property's
  // units "never raises a tenant's fee". That is FALSE, and an audit caught
  // it. Measured against the seeded TX rule, $2,000/mo, 60 days late, on a
  // real 6-plex with only 2 tenancies ever recorded:
  //
  //     lease_derived_floor, count 2 → conservative_unknown → $200.00
  //     modelled_units,      count 6 → large_4_plus         → $240.00
  //
  // Same building, same tenant, $40 more — because the landlord imported a
  // rent roll. The old rail below only ever compared the two readings of the
  // SAME number, which for count ≥ 4 is the same object, so it could not
  // catch this.
  //
  // The behaviour is nevertheless RIGHT, and suppressing it would be worse.
  // §92.019's higher percentage IS the applicable law for a 6-plex; $200 was
  // AcreOS hedging under uncertainty, not a benefit the tenant was owed. The
  // count already moves on its own as tenancies accumulate — a floor going
  // 3 → 4 flips the branch today, with no units table involved — so pinning
  // fees to whatever AcreOS happened to know first would be arbitrary, not
  // protective. And nothing is charged either way: this is a proposal an
  // operator confirms.
  //
  // What we owe the operator is that the movement is never silent. When an
  // exact count selects a HIGHER branch than the floor would have, the
  // proposal says so, naming both figures, so a tenant asking "why is this
  // more than last time?" has an answer that is on the record.
  if (units.count >= 4) {
    if (floorPath.proposedFeeCents !== largeBranchFromFloor.proposedFeeCents) {
      return stamp(
        floorPath,
        ` This property's ${units.count} units are on record, so the 4-plus statutory branch ` +
          `applies exactly. Before the units were modelled AcreOS could only prove ` +
          `${largeBranchFromFloor.unitCount} of them and hedged to the lower branch — this ` +
          `proposal is higher for that reason, not because anything about the tenancy changed.`,
      );
    }
    return stamp(floorPath);
  }

  // < 4 units: the large-property percentage is simply not the applicable law
  // for this building, so it is collapsed onto the small-property one before
  // the proposer runs. Both branches then agree, and the proposer returns the
  // under-4 branch exactly — labelled `small_under_4` rather than
  // `conservative_unknown`, because it is no longer a guess.
  //
  // Deliberately NOT a second copy of the cap arithmetic: this file already
  // carried two implementations of one statute once (see the block comment
  // above) and will not again. This selects a branch; the shared, floored,
  // cap-respecting proposer still does all the money math.
  const smallPropertyRule: LateFeeRuleData | null = rule
    ? { ...rule, capPctLargeProperty: rule.capPctSmallProperty }
    : null;
  const exact = proposeLateFee({
    rule: smallPropertyRule,
    monthlyRentCents,
    daysLate,
    knownUnitCountFloor: units.count,
    state,
  });

  // SAME-COUNT RAIL. Narrower than the claim it replaces, and true: for ONE
  // count, reading it as exact must never propose more than reading it as a
  // floor. Every rule seeded today caps small properties at or below the
  // large-property percentage (TX §92.019: 10% under 4, 12% at 4+), so this is
  // an equality in practice. It exists for the rule that inverts it, where
  // resolving an ambiguity in the platform's own favour would be indefensible.
  //
  // This does NOT promise that a bigger, better-known count cannot select a
  // higher branch — see the block above for why that is correct rather than a
  // gap, and how it is disclosed.
  if (exact.proposedFeeCents > floorPath.proposedFeeCents) {
    return stamp(
      floorPath,
      " This property's units are on record and the under-4 statutory branch applies, but that " +
        "branch proposes MORE than the figure AcreOS proposes when the unit count is unknown — the " +
        "lower figure was kept. Modelling a property's units never raises a tenant's fee.",
    );
  }
  return stamp(exact);
}

/** The seeded rule for a state, or null when the jurisdiction is not encoded. */
async function lateFeeRuleForState(state: string): Promise<LateFeeRule | null> {
  const [rule] = await db
    .select()
    .from(lateFeeRules)
    .where(eq(lateFeeRules.state, state.toUpperCase()));
  return rule ?? null;
}

/** Propose (never charge) a late fee for one overdue charge. */
async function proposalForCharge(args: {
  organizationId: number;
  charge: Pick<typeof rentCharges.$inferSelect, "id" | "dueDate">;
  lease: Pick<typeof rentalLeases.$inferSelect, "id" | "propertyId" | "monthlyRentCents" | "state">;
  asOf: Date;
}): Promise<{ proposal: UnitAwareLateFeeProposal; rule: LateFeeRule | null; daysLate: number }> {
  const rule = await lateFeeRuleForState(args.lease.state);
  const units = await unitCountForProperty(args.organizationId, args.lease.propertyId);
  const daysLate = daysOverdue(String(args.charge.dueDate), args.asOf) ?? 0;
  const proposal = proposeLateFeeForUnitCount({
    rule: rule ? parseLateFeeRuleRow(rule) : null,
    monthlyRentCents: args.lease.monthlyRentCents,
    daysLate,
    units,
    state: args.lease.state,
    leaseDerivedFloor: units.leaseDerivedFloor,
  });
  return { proposal, rule, daysLate };
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

/**
 * The residential late-fee surface — state STATUTORY caps, grace periods and
 * citations (the `late_fee_rules` table) — is WRONG-DOMAIN for a commercial
 * lease. Commercial late fees are CONTRACTUAL: they are set by the lease itself,
 * not by a residential-tenancy statute. Presenting a residential statutory cap
 * as the binding rule for a commercial org is a fabrication (assumed /
 * wrong-domain data shown as real), so every residential late-fee endpoint
 * REFUSES a commercial org with an honest 409 rather than returning a rule that
 * does not bind them. Returns true (and has already responded) when the org is
 * commercial; the handler must then stop. (Wave 2 pass B, 2026-08.)
 */
function refuseResidentialLateFeeForCommercial(req: AuthenticatedRequest, res: Response): boolean {
  // businessType is stored on organizations.onboardingData.businessType (the
  // same read the sidebar / contextProfile use), not a top-level column.
  const businessType = getOrganization(req).onboardingData?.businessType;
  if (businessType === "commercial") {
    sendError(
      res,
      409,
      "LATE_FEE_NOT_APPLICABLE_COMMERCIAL",
      "State statutory late-fee rules are residential and do not bind a commercial lease — a " +
        "commercial late fee is set by the lease, not by statute. Enter it as a manual charge " +
        "instead of proposing one from the residential statute surface.",
    );
    return true;
  }
  return false;
}

export function registerRentLedgerRoutes(app: Express): void {
  // List late-fee rules (read-only). getOrCreateOrg is required so the
  // commercial guard can read the org's businessType — the residential statute
  // table must not surface to a commercial org (see the guard's note).
  app.get("/api/late-fee-rules", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (refuseResidentialLateFeeForCommercial(req, res)) return;
      const rules = await db.select().from(lateFeeRules).orderBy(asc(lateFeeRules.state));
      return res.json({ rules });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── Scheduled charge generation ───────────────────────────────────────────
  // Rent charges were only ever created by an operator pressing "seed 12
  // months". A landlord who never pressed it had an EMPTY rent_charges table,
  // so aging buckets, the collected-% tile, the late-fee engine and every
  // arrears number computed over rent that was owed and never recorded.
  // Nothing lied louder than "$0 outstanding" on a unit two months behind.
  //
  // Read-only preview: exactly what generation WOULD post, per lease.
  app.get("/api/rent-charges/scheduled-preview", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = scheduledPreviewSchema.safeParse(req.query);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const throughDate = parsed.data.throughDate ?? new Date().toISOString().slice(0, 10);
      const preview = await previewScheduledCharges({
        organizationId: orgId,
        throughDate,
        leaseId: parsed.data.leaseId,
      });

      return res.json({
        throughDate,
        ...preview,
        // Partial first/final periods are NOT generated: proration is a lease
        // term AcreOS does not hold, and inventing a convention would overcharge
        // somebody. They come back per-lease as `skipped`, to post by hand.
        prorationPolicy:
          "Partial first/final periods are never generated — AcreOS does not hold the lease's " +
          "proration convention and will not invent one. Post those periods manually at the agreed amount.",
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Post the scheduled charges. Idempotent: a second run over the same horizon
  // inserts NOTHING (the planner subtracts periods already on the ledger, and
  // the unique index on (lease_id, charged_for_month) is the second guard).
  app.post("/api/rent-charges/generate-scheduled", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = generateScheduledSchema.safeParse(req.body ?? {});
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const throughDate = parsed.data.throughDate ?? new Date().toISOString().slice(0, 10);
      const result = await generateScheduledCharges({
        organizationId: orgId,
        throughDate,
        leaseId: parsed.data.leaseId,
        userId,
      });

      // 200, not 201: the honest status for an idempotent generator whose
      // correct behaviour on a re-run is to create nothing at all.
      return res.json({ throughDate, ...result });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Lease ledger — charges with payment breakdown.
  app.get("/api/leases/:id/ledger", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [lease] = await db.select().from(rentalLeases)
        .where(and(eq(rentalLeases.id, req.params.id), eq(rentalLeases.organizationId, orgId)));
      if (!lease) return Errors.notFound(res, "Lease");

      const charges = await db.select().from(rentCharges)
        .where(and(eq(rentCharges.leaseId, lease.id), eq(rentCharges.organizationId, orgId)))
        .orderBy(asc(rentCharges.chargedForMonth));

      const payments = await db.select().from(rentPayments)
        .where(and(eq(rentPayments.leaseId, lease.id), eq(rentPayments.organizationId, orgId)))
        .orderBy(desc(rentPayments.receivedAt));

      // The authoritative "which payment cured which month" join. A payment can
      // now touch several charges, so the allocation rows — not the legacy
      // single `rentChargeId` pointer — decide what shows under each month.
      const allocations = await db.select().from(rentPaymentAllocations)
        .where(and(
          eq(rentPaymentAllocations.leaseId, lease.id),
          eq(rentPaymentAllocations.organizationId, orgId),
        ))
        .orderBy(asc(rentPaymentAllocations.sequence));

      const paymentById = new Map(payments.map((p) => [p.id, p]));
      const allocationsByCharge = new Map<string, typeof allocations>();
      const paymentsWithAllocations = new Set<string>();
      for (const a of allocations) {
        paymentsWithAllocations.add(a.paymentId);
        const list = allocationsByCharge.get(a.rentChargeId) ?? [];
        list.push(a);
        allocationsByCharge.set(a.rentChargeId, list);
      }

      const chargesWithPayments = charges.map((c) => {
        const lines = allocationsByCharge.get(c.id) ?? [];
        const fromAllocations = lines
          .map((a) => {
            const p = paymentById.get(a.paymentId);
            return p ? { ...p, appliedToThisChargeCents: a.appliedCents, allocation: a } : null;
          })
          .filter((p): p is NonNullable<typeof p> => p !== null);
        // Rows recorded before allocations existed carry only the single
        // pointer. Shown, not hidden — with no invented per-charge split.
        const legacy = payments
          .filter((p) => p.rentChargeId === c.id && !paymentsWithAllocations.has(p.id))
          .map((p) => ({ ...p, appliedToThisChargeCents: null, allocation: null }));
        return {
          ...c,
          payments: [...fromAllocations, ...legacy],
          allocations: lines,
        };
      });

      const totalDueCents = charges.reduce((s, c) => s + c.amountCents, 0);
      const totalPaidCents = charges.reduce((s, c) => s + c.paidCents, 0);
      const totalBalanceCents = charges.reduce((s, c) => s + c.balanceCents, 0);
      const totalLateFeesCents = charges.reduce((s, c) => s + c.lateFeeCents, 0);
      // Money the landlord holds that no open charge could absorb. Stated as a
      // credit, which is the whole point of not clamping overpayment away.
      const unappliedPayments = payments.filter(
        (p) => (p.unappliedCents ?? 0) > 0 || (!p.rentChargeId && !paymentsWithAllocations.has(p.id)),
      );
      const totalUnappliedCreditCents = payments.reduce((s, p) => s + (p.unappliedCents ?? 0), 0);

      return res.json({
        lease,
        charges: chargesWithPayments,
        unappliedPayments,
        totals: {
          totalDueCents,
          totalPaidCents,
          totalBalanceCents,
          totalLateFeesCents,
          totalUnappliedCreditCents,
        },
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Record a payment the landlord ALREADY received (never a collection — see
  // the MONEY POSTURE note at the head of this file).
  //
  // It applies across EVERY open charge, oldest first, rent before late fees,
  // and persists one rent_payment_allocations row per line so each month's
  // balance can explain itself. Overpayment comes back as an explicit
  // unapplied credit instead of being clamped away by a max(0, …).
  app.post("/api/leases/:id/payments", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = paymentSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [lease] = await db.select().from(rentalLeases)
        .where(and(eq(rentalLeases.id, req.params.id), eq(rentalLeases.organizationId, orgId)));
      if (!lease) return Errors.notFound(res, "Lease");

      // Everything below — the charge read (FOR UPDATE), the payment row, the
      // allocation rows and every charge update — lands in one transaction or
      // not at all. The read lives INSIDE it so two payments recorded at the
      // same instant cannot both allocate against the same balance.
      let posted;
      try {
        posted = await db.transaction((tx) =>
          recordRentPayment(tx, {
            organizationId: orgId,
            leaseId: lease.id,
            amountCents: parsed.data.amountCents,
            receivedAt: parsed.data.receivedAt,
            method: parsed.data.method ?? null,
            referenceNumber: parsed.data.referenceNumber ?? null,
            payorType: parsed.data.payorType,
            payorTenantId: parsed.data.payorTenantId ?? null,
            acceptedDespitePartial: parsed.data.acceptedDespitePartial,
            notes: parsed.data.notes ?? null,
          }),
        );
      } catch (err) {
        // Imelda §2.5: "accepting partial rent after filing a notice to vacate
        // can void the notice and force me to start over." The refusal is
        // raised inside the transaction, so nothing was posted.
        if (err instanceof PartialPaymentUnderNoticeError) {
          return sendError(
            res,
            409,
            "PARTIAL_PAYMENT_VOIDS_NOTICE",
            "This payment leaves a charge under a notice to vacate still short. In several states " +
              "accepting partial rent after serving notice voids the notice and the process has to " +
              "start over. Nothing was recorded. Set acceptedDespitePartial=true to accept it anyway.",
            {
              rentChargeId: err.chargeId,
              chargedForMonth: err.chargedForMonth,
              balanceAfterCents: err.balanceAfterCents,
            },
          );
        }
        throw err;
      }

      const { payment, allocation, firstCharge, isPartial } = posted;

      logger.info("[BH-3] rent payment recorded", {
        orgId,
        userId,
        leaseId: lease.id,
        paymentId: payment.id,
        amountCents: parsed.data.amountCents,
        allocatedCents: allocation.appliedCents,
        unappliedCents: allocation.unappliedCents,
        chargesTouched: allocation.allocations.length,
        isPartial,
      });

      // Transaction has COMMITTED — safe to tell the workflow engine.
      // Fire-and-forget: never throws, never touches the ledger again.
      emitRentPaymentReceived({
        organizationId: orgId,
        leaseId: lease.id,
        paymentId: payment.id,
        rentChargeId: firstCharge?.chargeId ?? null,
        amountCents: parsed.data.amountCents,
        isPartial,
        payorType: parsed.data.payorType,
        method: parsed.data.method ?? null,
        receivedAt: parsed.data.receivedAt,
        dueDate: firstCharge?.dueDate ?? null,
        chargeAmountCents: posted.firstChargeAmountCents,
        chargeBalanceAfterCents: firstCharge?.balanceCents ?? null,
        legalPosture: firstCharge?.legalPosture ?? null,
        allocatedCents: allocation.appliedCents,
        unappliedCents: allocation.unappliedCents,
        allocationLineCount: allocation.allocations.length,
        allocationExplanation: allocation.explanation,
      });

      // Audit Wave 1 (buy_and_hold beta→core) — SECOND emit for the SAME posted
      // payment: rent.received drives the landlord receipt template
      // (tpl_landlord_rent_received_receipt) and the mobile-home lot-rent receipt.
      // Both events firing for one payment is intended and documented above the
      // import. Fire-and-forget: rentalEvents resolves the tenant/property/org +
      // the real YTD sum off the request path and never throws.
      emitRentReceived({
        organizationId: orgId,
        leaseId: lease.id,
        paymentId: payment.id,
        propertyId: lease.propertyId,
        amountCents: parsed.data.amountCents,
        receivedAt: parsed.data.receivedAt,
        rentChargeId: firstCharge?.chargeId ?? null,
        rentPeriodMonth: firstCharge?.chargedForMonth ?? null,
      });

      return res.status(201).json({
        payment,
        isPartial,
        allocation: {
          appliedCents: allocation.appliedCents,
          // Overpayment is STATED, not swallowed: this is a credit the operator
          // now holds against the next charge.
          unappliedCents: allocation.unappliedCents,
          orderRule: allocation.orderRule,
          explanation: allocation.explanation,
          lines: allocation.allocations,
        },
        charges: posted.charges,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── Late fees: propose, then charge only a CONFIRMED proposal ─────────────
  //
  // Registered BEFORE the ":id" family below so the literal `scheduled-preview`
  // path can never be swallowed (scripts/check-route-order.mjs).

  // Propose a late fee for ONE overdue charge. Read-only: nothing is charged.
  app.get("/api/rent-charges/:id/late-fee-proposal", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (refuseResidentialLateFeeForCommercial(req, res)) return;
      const orgId = getOrganizationId(req);
      const [charge] = await db.select().from(rentCharges)
        .where(and(eq(rentCharges.id, req.params.id), eq(rentCharges.organizationId, orgId)));
      if (!charge) return Errors.notFound(res, "Rent charge");

      const [lease] = await db.select().from(rentalLeases)
        .where(and(eq(rentalLeases.id, charge.leaseId), eq(rentalLeases.organizationId, orgId)));
      if (!lease) return Errors.notFound(res, "Lease");

      const { proposal, rule, daysLate } = await proposalForCharge({
        organizationId: orgId,
        charge,
        lease,
        asOf: new Date(),
      });

      return res.json({
        charge: {
          id: charge.id,
          leaseId: charge.leaseId,
          chargedForMonth: charge.chargedForMonth,
          dueDate: charge.dueDate,
          amountCents: charge.amountCents,
          balanceCents: charge.balanceCents,
          lateFeeCents: charge.lateFeeCents,
          legalPosture: charge.legalPosture,
        },
        daysLate,
        proposal,
        rule,
        // Said out loud on the wire, not just in a comment: this endpoint
        // computes, it does not charge.
        requiresOperatorConfirmation: true,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Org-wide proposals — every overdue charge with what the statute would allow.
  // Nothing is charged; this is the operator's review queue.
  app.get("/api/rent/late-fee-proposals", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (refuseResidentialLateFeeForCommercial(req, res)) return;
      const orgId = getOrganizationId(req);
      const asOf = new Date();

      const rows = await db
        .select({ charge: rentCharges, lease: rentalLeases })
        .from(rentCharges)
        .innerJoin(rentalLeases, eq(rentCharges.leaseId, rentalLeases.id))
        .where(and(eq(rentCharges.organizationId, orgId), gt(rentCharges.balanceCents, 0)))
        .orderBy(asc(rentCharges.dueDate));

      // One rule read per state and one unit-count read per property, reused
      // across charges — an org with 200 open charges must not issue 400 queries.
      const rulesByState = new Map<string, LateFeeRule | null>();
      const unitsByProperty = new Map<number, PropertyUnitCount>();
      const proposals: Array<Record<string, unknown>> = [];

      for (const { charge, lease } of rows) {
        const stateKey = lease.state.toUpperCase();
        if (!rulesByState.has(stateKey)) {
          rulesByState.set(stateKey, await lateFeeRuleForState(stateKey));
        }
        if (!unitsByProperty.has(lease.propertyId)) {
          unitsByProperty.set(lease.propertyId, await unitCountForProperty(orgId, lease.propertyId));
        }
        const rule = rulesByState.get(stateKey) ?? null;
        const daysLate = daysOverdue(String(charge.dueDate), asOf) ?? 0;
        const proposal = proposeLateFeeForUnitCount({
          rule: rule ? parseLateFeeRuleRow(rule) : null,
          monthlyRentCents: lease.monthlyRentCents,
          daysLate,
          // A property with no leases and no units cannot reach this loop (the
          // row came off a lease), so the memo is always populated here; the
          // fallback is a floor of 1, the most conservative possible reading.
          units: unitsByProperty.get(lease.propertyId)
            ?? { count: 1, basis: "lease_derived_floor" as const },
          leaseDerivedFloor: unitsByProperty.get(lease.propertyId)?.leaseDerivedFloor,
          state: lease.state,
        });
        proposals.push({
          rentChargeId: charge.id,
          leaseId: lease.id,
          unitLabel: lease.unitLabel,
          chargedForMonth: charge.chargedForMonth,
          dueDate: charge.dueDate,
          balanceCents: charge.balanceCents,
          lateFeeAlreadyChargedCents: charge.lateFeeCents,
          legalPosture: charge.legalPosture,
          daysLate,
          proposal,
        });
      }

      const chargeable = proposals.filter(
        (p) => (p.proposal as LateFeeProposal).status === "proposed",
      );

      return res.json({
        asOf: asOf.toISOString().slice(0, 10),
        proposals,
        totals: {
          overdueCharges: proposals.length,
          chargeableProposals: chargeable.length,
          proposedFeeCents: chargeable.reduce(
            (s, p) => s + (p.proposal as LateFeeProposal).proposedFeeCents,
            0,
          ),
        },
        requiresOperatorConfirmation: true,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Charge a CONFIRMED late-fee proposal onto a charge. The figure comes from
  // the one shared, statute-capped proposer — never from the client.
  app.post("/api/rent-charges/:id/apply-late-fee", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (refuseResidentialLateFeeForCommercial(req, res)) return;
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = applyLateFeeSchema.safeParse(req.body ?? {});
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [charge] = await db.select().from(rentCharges)
        .where(and(eq(rentCharges.id, req.params.id), eq(rentCharges.organizationId, orgId)));
      if (!charge) return Errors.notFound(res, "Rent charge");

      const [lease] = await db.select().from(rentalLeases)
        .where(and(eq(rentalLeases.id, charge.leaseId), eq(rentalLeases.organizationId, orgId)));
      if (!lease) return Errors.notFound(res, "Lease");

      const { proposal, rule, daysLate } = await proposalForCharge({
        organizationId: orgId,
        charge,
        lease,
        asOf: new Date(),
      });

      // An operator can never confirm an amount they were not shown. When the
      // caller echoes a figure it must match the server's proposal to the cent.
      if (
        parsed.data.confirmFeeCents !== undefined &&
        parsed.data.confirmFeeCents !== proposal.proposedFeeCents
      ) {
        return sendError(
          res,
          409,
          "LATE_FEE_PROPOSAL_CHANGED",
          "The fee you confirmed is not the fee the state rule now proposes for this charge, so " +
            "nothing was charged. Re-read the proposal and confirm the current figure.",
          {
            confirmedFeeCents: parsed.data.confirmFeeCents,
            proposedFeeCents: proposal.proposedFeeCents,
            explanation: proposal.explanation,
          },
        );
      }

      if (proposal.status !== "proposed" || proposal.proposedFeeCents <= 0) {
        // Not an error — the statute allows nothing here. Say so plainly
        // instead of posting a fee we cannot justify.
        return res.json({
          feeCents: 0,
          charged: false,
          explanation: proposal.explanation,
          proposal,
          rule,
          daysLate,
        });
      }

      if (proposal.capped) {
        logger.info("[BH-3] late fee capped to the statutory maximum", {
          orgId,
          userId,
          chargeId: charge.id,
          state: proposal.state,
          uncappedFeeCents: proposal.uncappedFeeCents,
          capCents: proposal.capCents,
          chargedFeeCents: proposal.proposedFeeCents,
          citation: proposal.citation,
        });
      }
      if (proposal.unitBranch === "conservative_unknown") {
        // Now actionable rather than merely regrettable: the operator can model
        // this property's units and get the statute applied as written.
        logger.warn("[BH-3] unit count unknowable — tenant-conservative late-fee branch applied", {
          orgId,
          userId,
          leaseId: lease.id,
          propertyId: lease.propertyId,
          chargedFeeCents: proposal.proposedFeeCents,
          unitCount: proposal.unitCount,
          unitCountBasis: proposal.unitCountBasis,
        });
      }

      await db.update(rentCharges).set({
        lateFeeCents: charge.lateFeeCents + proposal.proposedFeeCents,
        // Derived from the parts, never from the stored balance — the old
        // writer's max(0, …) could have left `balanceCents` understated.
        balanceCents:
          charge.amountCents +
          charge.lateFeeCents +
          proposal.proposedFeeCents -
          charge.paidCents,
        lateFeeAppliedAt: new Date(),
        legalPosture: charge.legalPosture === "ok" ? "late" : charge.legalPosture,
        updatedAt: new Date(),
      }).where(and(eq(rentCharges.id, charge.id), eq(rentCharges.organizationId, orgId)));

      logger.info("[BH-3] late fee charged from a confirmed proposal", {
        orgId,
        userId,
        chargeId: charge.id,
        feeCents: proposal.proposedFeeCents,
        daysLate,
      });

      return res.json({
        feeCents: proposal.proposedFeeCents,
        charged: true,
        explanation: proposal.explanation,
        proposal,
        rule,
        daysLate,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Update legal posture explicitly (operator action).
  app.post("/api/rent-charges/:id/legal-posture", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = postureSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [updated] = await db.update(rentCharges).set({
        legalPosture: parsed.data.legalPosture,
        legalPostureAt: new Date(),
        notes: parsed.data.notes ?? null,
        updatedAt: new Date(),
      })
        .where(and(eq(rentCharges.id, req.params.id), eq(rentCharges.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Rent charge");

      logger.info("[BH-3] legal posture changed", { orgId, userId, chargeId: updated.id, posture: parsed.data.legalPosture });
      return res.json({ charge: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Org-wide aging buckets — Imelda §3 portfolio: "Aging buckets are right
  // shape, wrong source. Wire them to rent-roll late-pay data."
  app.get("/api/rent/aging", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const today = new Date().toISOString().slice(0, 10);
      const rows = await db.execute(sql`
        SELECT
          rc.id, rc.lease_id, rc.charged_for_month, rc.due_date,
          rc.amount_cents, rc.balance_cents, rc.late_fee_cents,
          rc.legal_posture,
          (CURRENT_DATE - rc.due_date) AS days_overdue
        FROM rent_charges rc
        WHERE rc.organization_id = ${orgId}
          AND rc.balance_cents > 0
        ORDER BY rc.due_date ASC
      `);

      const charges = ((rows as any).rows ?? []).map((r: any) => ({
        ...r,
        days_overdue: Number(r.days_overdue) || 0,
      }));
      const buckets = {
        current: charges.filter((c: any) => c.days_overdue <= 0),
        d1_30: charges.filter((c: any) => c.days_overdue > 0 && c.days_overdue <= 30),
        d31_60: charges.filter((c: any) => c.days_overdue > 30 && c.days_overdue <= 60),
        d61_90: charges.filter((c: any) => c.days_overdue > 60 && c.days_overdue <= 90),
        d90_plus: charges.filter((c: any) => c.days_overdue > 90),
      };

      const totalsByBucket = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [
        k,
        { count: v.length, totalCents: v.reduce((s: number, c: any) => s + Number(c.balance_cents), 0) },
      ]));

      return res.json({ asOf: today, totalsByBucket, charges });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Overnight rent receipts — the Imelda "answer-the-phone-from-the-truck"
  // surface needs a single read that says "X dollars came in since 12:01am,
  // Y of it was HAP." `since` is an ISO timestamp (date or datetime); the
  // route trims it to a date for the DB column (rent_payments.received_at
  // is a date, not a timestamp).
  app.get("/api/rent-ledger/summary", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const rawSince = typeof req.query.since === "string" ? req.query.since : null;
      const todayIso = new Date().toISOString().slice(0, 10);
      // Normalize "2026-05-26" or "2026-05-26T00:00:00.000Z" -> "2026-05-26".
      // Anything unparseable falls back to today (start of day in server tz),
      // which matches the Today-tab intent without surfacing a 400.
      let sinceDate = todayIso;
      if (rawSince) {
        const parsed = new Date(rawSince);
        if (Number.isFinite(parsed.getTime())) {
          sinceDate = parsed.toISOString().slice(0, 10);
        }
      }

      const totalsRow = await db.execute(sql`
        SELECT
          COUNT(*)::int AS payments_count,
          COALESCE(SUM(amount_cents), 0)::bigint AS total_cents,
          COALESCE(SUM(CASE WHEN payor_type = 'hap' THEN amount_cents ELSE 0 END), 0)::bigint AS hap_cents,
          COALESCE(SUM(CASE WHEN payor_type = 'tenant' THEN amount_cents ELSE 0 END), 0)::bigint AS tenant_cents
        FROM rent_payments
        WHERE organization_id = ${orgId}
          AND received_at >= ${sinceDate}::date
      `);
      const r = ((totalsRow as any).rows?.[0]) ?? {};
      return res.json({
        since: sinceDate,
        paymentsCount: Number(r.payments_count) || 0,
        totalCents: Number(r.total_cents) || 0,
        hapCents: Number(r.hap_cents) || 0,
        tenantCents: Number(r.tenant_cents) || 0,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── Security deposit: the statutory clock + the itemised letter ────────────
  //
  // `security_deposits` had NO read route at all, and `statutoryDeadline` had no
  // writer, so the deadline that carries the largest single landlord/tenant
  // exposure (forfeiture of the right to withhold ANYTHING plus statutory
  // damages, often 2-3x) was invisible and unset. An empty countdown reads to
  // an operator as "no clock is running".
  //
  // MONEY POSTURE: AcreOS never holds, transmits or refunds a tenant deposit.
  // These routes write dates and text onto a ledger row; the refund is issued
  // by the landlord on their own rails (founder ruling #15).
  app.get("/api/leases/:id/security-deposit", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [lease] = await db.select().from(rentalLeases)
        .where(and(eq(rentalLeases.id, req.params.id), eq(rentalLeases.organizationId, orgId)));
      if (!lease) return Errors.notFound(res, "Lease");

      const [deposit] = await db.select().from(securityDeposits)
        .where(and(
          eq(securityDeposits.leaseId, lease.id),
          eq(securityDeposits.organizationId, orgId),
        ));

      const moveOut = await resolveMoveOutDate({ organizationId: orgId, leaseId: lease.id });
      const hasDeductions = (deposit?.deductionsTotalCents ?? 0) > 0;
      // What the registry says TODAY, alongside whatever is stored. If the two
      // disagree the operator is shown both rather than one silently winning.
      const computed = computeDepositDeadline({
        moveOutDate: moveOut.moveOutDate ?? deposit?.moveOutDate ?? null,
        state: lease.state,
        hasDeductions,
      });

      if (!deposit) {
        return res.json({
          lease: { id: lease.id, state: lease.state, unitLabel: lease.unitLabel, status: lease.status },
          deposit: null,
          // Honest absence, not a zero: the lease records a deposit AMOUNT but
          // no deposit LEDGER row has been opened, so nothing is being tracked.
          depositLedgerOpened: false,
          leaseSecurityDepositCents: lease.securityDepositCents,
          moveOut,
          computedDeadline: computed,
          countdown: depositDeadlineCountdown(computed.deadlineDate),
        });
      }

      return res.json({
        lease: { id: lease.id, state: lease.state, unitLabel: lease.unitLabel, status: lease.status },
        deposit,
        depositLedgerOpened: true,
        leaseSecurityDepositCents: lease.securityDepositCents,
        moveOut,
        // The persisted clock (what the operator has been told before).
        storedDeadline: {
          deadlineDate: deposit.statutoryDeadline,
          deadlineDays: deposit.statutoryDeadlineDays,
          citation: deposit.statutoryDeadlineCitation,
          unknownReason: deposit.statutoryDeadlineUnknownReason,
          setAt: deposit.statutoryDeadlineSetAt,
        },
        computedDeadline: computed,
        countdown: depositDeadlineCountdown(deposit.statutoryDeadline ?? computed.deadlineDate),
        dispositionLetter: {
          generatedAt: deposit.dispositionLetterGeneratedAt,
          version: deposit.dispositionLetterVersion,
          // Never asserted as sent — stamped only when the operator records
          // their own delivery (AcreOS has no counterparty send rail).
          deliveredAt: deposit.dispositionLetterDeliveredAt,
          deliveryMethod: deposit.dispositionLetterDeliveryMethod,
          markdown: deposit.dispositionLetterMarkdown,
        },
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // (Re)compute and persist the statutory deadline. Idempotent — the same
  // move-out date, state and deduction posture writes nothing.
  app.post("/api/leases/:id/security-deposit/clock", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = depositClockSchema.safeParse(req.body ?? {});
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [lease] = await db.select().from(rentalLeases)
        .where(and(eq(rentalLeases.id, req.params.id), eq(rentalLeases.organizationId, orgId)));
      if (!lease) return Errors.notFound(res, "Lease");

      const outcome = await startDepositClock({
        organizationId: orgId,
        leaseId: lease.id,
        moveOutDate: parsed.data.moveOutDate ?? null,
        trigger: parsed.data.moveOutDate ? "manual" : "lease_ended",
        userId,
      });

      if (!outcome.depositFound) {
        return Errors.notFound(res, "Security deposit (open the deposit ledger on the lease first)");
      }
      return res.json(outcome);
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Generate the itemised disposition letter from the reconciled deductions.
  //
  // Every state that lets a landlord withhold any part of a deposit conditions
  // that right on delivering a WRITTEN, ITEMISED statement inside the statutory
  // window. AcreOS could reconcile deductions and then produced nothing to
  // send — the exact posture that loses the withholding right.
  //
  // It renders recorded facts only. Anything missing is a BLOCKING refusal
  // (422 with the list) or a warning — never filler, never a placeholder
  // tenant, never an assumed deduction. It does not send the letter and never
  // claims one was sent.
  app.post("/api/leases/:id/security-deposit/disposition-letter", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = dispositionLetterSchema.safeParse(req.body ?? {});
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [lease] = await db.select().from(rentalLeases)
        .where(and(eq(rentalLeases.id, req.params.id), eq(rentalLeases.organizationId, orgId)));
      if (!lease) return Errors.notFound(res, "Lease");

      const [deposit] = await db.select().from(securityDeposits)
        .where(and(
          eq(securityDeposits.leaseId, lease.id),
          eq(securityDeposits.organizationId, orgId),
        ));
      if (!deposit) {
        return Errors.notFound(res, "Security deposit (open the deposit ledger on the lease first)");
      }

      const [org] = await db.select({ name: organizations.name }).from(organizations)
        .where(eq(organizations.id, orgId));
      const [property] = await db
        .select({
          address: properties.address,
          city: properties.city,
          state: properties.state,
          zip: properties.zip,
        })
        .from(properties)
        .where(and(eq(properties.id, lease.propertyId), eq(properties.organizationId, orgId)));

      const tenantRows = await db
        .select({
          firstName: tenants.firstName,
          lastName: tenants.lastName,
          companyName: tenants.companyName,
          isEntity: tenants.isEntity,
          isPrimary: leaseTenants.isPrimary,
        })
        .from(leaseTenants)
        .innerJoin(tenants, eq(leaseTenants.tenantId, tenants.id))
        .where(and(
          eq(leaseTenants.leaseId, lease.id),
          eq(leaseTenants.organizationId, orgId),
        ))
        .orderBy(desc(leaseTenants.isPrimary));

      const moveOut = await resolveMoveOutDate({ organizationId: orgId, leaseId: lease.id });
      const moveOutDate = moveOut.moveOutDate ?? deposit.moveOutDate ?? null;
      const deductions = deposit.deductions ?? [];
      const deadline = computeDepositDeadline({
        moveOutDate,
        state: lease.state,
        hasDeductions: deductions.length > 0,
      });

      const addressParts = [property?.address, property?.city, property?.state, property?.zip]
        .filter((p): p is string => typeof p === "string" && p.trim().length > 0);

      let letter;
      try {
        letter = buildDispositionLetter({
          landlordName: org?.name ?? "",
          landlordContact: null,
          propertyAddress: addressParts.length > 0 ? addressParts.join(", ") : null,
          unitLabel: lease.unitLabel,
          // Entity-aware + honest: a company tenant renders its companyName, and
          // a row that resolves to no name is DROPPED rather than emitted as a
          // blank / "null null" on a legal disposition letter.
          tenantNames: tenantRows
            .map((t) => tenantDisplayName(t))
            .filter((n): n is string => n !== null && n.trim() !== ""),
          forwardingAddress: parsed.data.forwardingAddress ?? null,
          heldCents: deposit.heldCents,
          deductions,
          moveOutDate,
          deadline,
          letterDate: parsed.data.letterDate ?? new Date().toISOString().slice(0, 10),
          state: lease.state,
        });
      } catch (err) {
        if (err instanceof DispositionLetterBlockedError) {
          // Refuse, and say exactly what is missing. A letter assembled around
          // a gap is worse than no letter — it is the document the statute is
          // about.
          return Errors.validationFailed(res, err.issues);
        }
        throw err;
      }

      const [updated] = await db.update(securityDeposits).set({
        dispositionLetterMarkdown: letter.markdown,
        dispositionLetterVersion: letter.version,
        dispositionLetterGeneratedAt: new Date(),
        // deliveredAt/deliveryMethod are deliberately NOT touched here.
        updatedAt: new Date(),
      }).where(and(
        eq(securityDeposits.id, deposit.id),
        eq(securityDeposits.organizationId, orgId),
      )).returning();

      logger.info("[BH-4] deposit disposition letter generated", {
        orgId,
        userId,
        leaseId: lease.id,
        depositId: deposit.id,
        deductionCount: deductions.length,
        refundCents: letter.refundCents,
        warnings: letter.warnings.length,
      });

      return res.json({
        letter,
        deposit: updated ?? deposit,
        deadline,
        moveOut,
        // Stated on the wire so no client can imply otherwise.
        delivery:
          "AcreOS does not send this letter. Deliver it on your own identity, then record how and " +
          "when you delivered it — nothing here claims it was sent.",
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
