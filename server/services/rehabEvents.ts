// ---------------------------------------------------------------------------
// Rehab (fix-and-flip) workflow-event emitters (audit Wave 1, beta→core).
//
// `emitRehabEvent` has lived in the workflow engine but had ZERO call sites,
// so the two fix-and-flip milestone templates a customer installed
// (tpl_flip_milestone_demo_complete / tpl_flip_listing_ready) sat idle
// forever — the renovate half of the flip loop was dead automation. This
// module is the ONE seam the rehab status machine goes through to make
// `rehab.milestone` and `rehab.punch_list_complete` real.
//
// Sibling of dealEvents.ts / leadEvents.ts / propertyEvents.ts; same rules:
//   1. FIRE-AND-FORGET. A workflow failure must never fail a rehab write.
//   2. NEVER EMIT A NO-OP. An event fires only on a GENUINE status transition
//      (real pre-image status ≠ real post-image status), and only at the two
//      transitions the shipped templates actually handle.
//   3. NO FABRICATION. The payload carries ONLY columns the rehab row genuinely
//      holds (address, spend, budget, target ARV, planned list date, the
//      transition date). The templates were corrected in the same change to
//      stop interpolating comp/valuation fields the row does not have — they
//      now prompt the operator to pull fresh comps on the real comps surface
//      instead of rendering an invented number.
//
// When an emit call site is added, shared/workflow-live-triggers.ts must list
// the event in the SAME change — tests/unit/workflowActionHonesty.test.ts pins
// that relationship.
// ---------------------------------------------------------------------------

import { emitRehabEvent } from "./workflow-engine";
import { logger } from "../utils/logger";

/** The slice of a rehab row these emitters need. Real columns only. */
export interface RehabEventRow {
  id: string;
  organizationId: number;
  propertyId: number;
  name: string; // the property address, e.g. "1247 Cherokee Pl"
  status: string;
  spentTotalCents?: number | null;
  budgetTotalCents?: number | null;
  arvCents?: number | null;
  plannedListingDate?: string | null;
}

const dollars = (cents: number | null | undefined): number | null =>
  cents == null ? null : Math.round(cents) / 100;

const isoDay = (): string => new Date().toISOString().slice(0, 10);

/**
 * Emit the fix-and-flip lifecycle event for a genuine status transition.
 * Fires ONLY at the two moments the shipped templates handle:
 *   - demo complete  → rehab.milestone           (status leaves "demo")
 *   - punch list closed → rehab.punch_list_complete (status reaches "listed")
 * Any other status edit is a no-op. Fire-and-forget: never throws.
 */
export function emitRehabStatusChange(
  beforeStatus: string | null | undefined,
  rehab: RehabEventRow,
): void {
  try {
    const after = rehab.status;
    if (!beforeStatus || beforeStatus === after) return; // no genuine transition

    if (beforeStatus === "demo" && after !== "demo") {
      emitRehabEvent("rehab.milestone", rehab.organizationId, rehab.propertyId, {
        rehabId: rehab.id,
        propertyId: rehab.propertyId,
        propertyAddress: rehab.name,
        milestone: "demo_complete",
        milestoneDate: isoDay(),
        actualSpend: dollars(rehab.spentTotalCents),
        plannedSpend: dollars(rehab.budgetTotalCents),
        status: after,
      });
      return;
    }

    if (after === "listed" && beforeStatus !== "listed") {
      emitRehabEvent(
        "rehab.punch_list_complete",
        rehab.organizationId,
        rehab.propertyId,
        {
          rehabId: rehab.id,
          propertyId: rehab.propertyId,
          propertyAddress: rehab.name,
          punchListDate: isoDay(),
          afterRepairValue: dollars(rehab.arvCents),
          targetListDate: rehab.plannedListingDate ?? null,
          status: after,
        },
      );
    }
  } catch (err) {
    logger.warn(
      `[rehabEvents] emit failed for rehab ${rehab.id} (${beforeStatus}→${rehab.status})`,
      { metadata: { error: err instanceof Error ? err.message : String(err) } },
    );
  }
}
