// ---------------------------------------------------------------------------
// Subdivider workflow-event emitters (audit Wave 1, beta→core).
//
// `emitSubdivisionEvent` has lived in the workflow engine but had ZERO call
// sites, so the three subdivider templates a customer installed
// (tpl_subdivision_plat_submitted / tpl_subdivision_vendor_milestone /
// tpl_subdivision_phase_recorded) sat idle forever — the entire permit-and-plat
// automation lane was dead. This module is the ONE seam the subdivision
// lifecycle goes through to make `plat.submitted`,
// `subdivision.vendor_milestone` and `subdivision.phase_recorded` real, wired
// onto the two operator write-paths that already exist:
//   - a permit gate flipping to "approved"     → subdivision.vendor_milestone
//   - a plan flipping to "county_submitted"     → plat.submitted
//   - a plan flipping to "recorded"             → subdivision.phase_recorded
//
// Sibling of certificateEvents.ts / rehabEvents.ts / propertyEvents.ts; same
// rules:
//   1. FIRE-AND-FORGET. A workflow failure must never fail a permit/plan write.
//      Every function wraps its emit in try/catch and never throws.
//   2. NEVER EMIT A NO-OP where a transition is required. Each event fires ONLY
//      on a genuine status transition INTO the target state (the real pre-image
//      status was NOT already that state, the post-image status IS).
//   3. NO FABRICATION. The payload carries ONLY columns the row genuinely holds
//      plus context the route resolves from real columns. The two fabricated
//      template placeholders were corrected in the same change:
//      tpl_subdivision_plat_submitted lost {{nextCountyCheckinDays}} (no column
//      supplies a cadence) and tpl_subdivision_phase_recorded's {{phaseNumber}}
//      became {{planName}} (a real subdivision_plans.name). Every nullable field
//      passes through as its real value or null, never a placeholder 0.
//
// entityId: the subdivision lifecycle hangs off a parent PARCEL, which is a
// properties row (subdivision_plans.parent_parcel_id and
// permit_checklists.parent_parcel_id both FK properties.id), so entityId is the
// parent parcel's properties.id and entityType is "property" — no new
// entityType needed. The route handler (which already holds TEMPLATE_BY_KEY and
// the joins) computes propertyAddress / nextStage / nextVendor / nextStageDays
// and passes them in via `ctx`; this service NEVER imports from routes-*.ts, so
// there is no import cycle.
//
// When an emit call site is added, shared/workflow-live-triggers.ts must list
// the event in the SAME change — tests/unit/workflowActionHonesty.test.ts pins
// that relationship (it derives the live set from these call sites).
// ---------------------------------------------------------------------------

import { emitSubdivisionEvent } from "./workflow-engine";
import { logger } from "../utils/logger";

/** The slice of a permit_gates row this emitter needs. Real columns only. */
export interface PermitGateEventRow {
  id: string;
  organizationId: number;
  label: string;
  status: string;
  completedAt: string | null; // the real operator-set approval date (date column)
}

/**
 * Context the route resolves for an approved gate. propertyAddress + the
 * next-stage fields are computed in the route (which holds the join to
 * properties and TEMPLATE_BY_KEY); the next-stage fields are genuinely nullable
 * (an approved FINAL gate has no next stage) and pass through as their real
 * value or null — never a fabricated placeholder.
 */
export interface PermitGateApprovalContext {
  propertyAddress: string | null;
  parentParcelId: number;
  nextStage: string | null;
  nextVendor: string | null;
  nextStageDays: number | null;
}

/** The slice of a subdivision_plans row these emitters need. Real columns only. */
export interface SubdivisionPlanEventRow {
  id: string;
  organizationId: number;
  name: string;
  status: string;
  lotCount: number | null;
}

/** The parent parcel columns the plan emitters read. All real properties.* columns. */
export interface ParentParcelInfo {
  address: string | null;
  county: string;
  state: string;
}

const isoDay = (): string => new Date().toISOString().slice(0, 10);

/**
 * Honest parcel label. properties.address is nullable, so when a subdivider has
 * not entered a street we fall back to the parcel's county/state — real columns
 * the row genuinely holds — never a fabricated address.
 */
const parcelLabel = (p: ParentParcelInfo | null | undefined): string | null => {
  if (!p) return null;
  return p.address ?? `${p.county}, ${p.state}`;
};

/**
 * Emit subdivision.vendor_milestone ONLY on a genuine transition of a permit
 * gate INTO "approved" (pre-image status was NOT already "approved", post-image
 * status IS). Any other gate edit is a no-op. Fire-and-forget: never throws.
 */
export function emitPermitGateApproved(
  beforeStatus: string | null | undefined,
  gate: PermitGateEventRow,
  ctx: PermitGateApprovalContext,
): void {
  try {
    if (beforeStatus === "approved" || gate.status !== "approved") return; // no genuine transition
    emitSubdivisionEvent(
      "subdivision.vendor_milestone",
      gate.organizationId,
      ctx.parentParcelId,
      {
        milestoneName: gate.label,
        milestoneDate: gate.completedAt ?? null, // the real approval date, NOT wall-clock
        propertyAddress: ctx.propertyAddress,
        nextStage: ctx.nextStage,
        // An unset next-gate contactName genuinely means the vendor is not yet
        // assigned — an honest label, never a fabricated name.
        nextVendor: ctx.nextVendor ?? "unassigned",
        nextStageDays: ctx.nextStageDays,
      },
    );
  } catch (err) {
    logger.warn(
      `[subdivisionEvents] emit subdivision.vendor_milestone failed for gate ${gate.id}`,
      { metadata: { error: err instanceof Error ? err.message : String(err) } },
    );
  }
}

/**
 * Emit the plan-lifecycle events for a genuine status transition:
 *   - plan → "county_submitted"  → plat.submitted
 *   - plan → "recorded"          → subdivision.phase_recorded
 * Each fires ONLY when the pre-image status was NOT already the target state.
 * Any other plan edit is a no-op. Fire-and-forget: never throws.
 */
export function emitPlanStatusChange(
  beforeStatus: string | null | undefined,
  plan: SubdivisionPlanEventRow,
  parentProperty: ParentParcelInfo | null | undefined,
  ctx: { parentParcelId: number },
): void {
  try {
    const after = plan.status;
    if (beforeStatus === after) return; // no genuine transition
    const propertyAddress = parcelLabel(parentProperty);

    if (beforeStatus !== "county_submitted" && after === "county_submitted") {
      emitSubdivisionEvent(
        "plat.submitted",
        plan.organizationId,
        ctx.parentParcelId,
        {
          platId: plan.id,
          propertyAddress,
          countyName: parentProperty?.county ?? null,
          state: parentProperty?.state ?? null,
          numLots: plan.lotCount ?? null,
          // No estimatedApprovalMonths: no per-plan approval-estimate column
          // exists (county p50/p90 lives in county_subdivision_timelines, which
          // the plan write-path does not join), so the template no longer
          // interpolates one rather than render a blank or fabricated month
          // count — a future wire can add the join + the clause together.
          submittedDate: isoDay(), // the transition IS happening now
        },
      );
      return;
    }

    if (beforeStatus !== "recorded" && after === "recorded") {
      emitSubdivisionEvent(
        "subdivision.phase_recorded",
        plan.organizationId,
        ctx.parentParcelId,
        {
          propertyAddress,
          lotCount: plan.lotCount ?? null,
          planName: plan.name, // real subdivision_plans.name — replaces the fabricated phaseNumber
          recordedDate: isoDay(), // the transition IS happening now
        },
      );
    }
  } catch (err) {
    logger.warn(
      `[subdivisionEvents] emit plan status change failed for plan ${plan.id} (${beforeStatus}→${plan.status})`,
      { metadata: { error: err instanceof Error ? err.message : String(err) } },
    );
  }
}
