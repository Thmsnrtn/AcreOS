/**
 * Workflow-engine template integrity (wave V3, founder ruling #11).
 *
 * The template audit found workflowTemplateIds empty for most verticals;
 * V1/V2 filled registries with EXISTING templates. Wave V3 adds genuinely
 * new templates ONLY where the engine's real vocabulary supports them.
 * This suite pins what "real" means and stops the two historical failure
 * modes of this file:
 *
 *   1. Templates invoking action types with no handler case in
 *      executeAction (silent `logger.warn("Unknown action type")` no-op).
 *   2. Templates triggering on events that exist nowhere — not even in the
 *      shared WORKFLOW_TRIGGER_EVENTS union. Eleven legacy templates
 *      already lean on the local ExtendedTriggerEvent escape hatch (typed
 *      locally, never legally emittable); that set is pinned below and may
 *      only SHRINK. Every template added after this suite landed must use
 *      a shared-union event.
 *
 * Also pins:
 *   - the full pre-existing template-id snapshot (order + content), so no
 *     agent renames/removes an id another registry entry references;
 *   - global template-id uniqueness;
 *   - the wave-V3 additions' triggers + actions resolve to real handlers;
 *   - the two parcel.* templates interpolate ONLY fields the real runtime
 *     emitter (parcelDeltaDetector.persistDelta) actually sends — those
 *     are the only events with a live emit call site today, and their
 *     templates must not render literal {{placeholders}} for fields that
 *     never arrive.
 *
 * idempotent: true — pure assertions over the exported template array and
 * engine source shape. No DB.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { WORKFLOW_TRIGGER_EVENTS, WORKFLOW_ACTION_TYPES } from "@shared/schema";
import { LAND_INVESTING_WORKFLOW_TEMPLATES } from "../../server/services/workflow-engine";

const ENGINE_SOURCE = fs.readFileSync(
  path.join(__dirname, "../../server/services/workflow-engine.ts"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// Snapshot of every template id that existed BEFORE wave V3, in array order.
// Other code (shared/business-types.ts workflowTemplateIds, the install
// endpoint's stable-id contract) references these ids — they may never be
// renamed, removed, or reordered. New templates append AFTER this prefix.
// ---------------------------------------------------------------------------
const PRE_EXISTING_IDS = [
  "tpl_new_lead_received",
  "tpl_payment_missed_dunning",
  "tpl_deal_closed",
  "tpl_buyer_match_found",
  "tpl_lead_to_deal",
  "tpl_balloon_approaching",
  "tpl_payment_received",
  "tpl_delinquency_escalation",
  "tpl_property_listed",
  "tpl_deal_stage_advanced",
  "tpl_campaign_response",
  "tpl_referral_milestone",
  "tpl_lead_score_high",
  "tpl_acquisition_closed",
  "tpl_offer_batch_sent",
  "tpl_lease_expiring",
  "tpl_support_ticket",
  "tpl_weekly_pipeline_review",
  "tpl_note_setup",
  "tpl_ltv_alert",
  "tpl_fix_flip_rehab_kickoff",
  "tpl_note_payment_received_receipt",
  "tpl_note_insurance_expiring",
  "tpl_note_escrow_shortfall",
  "tpl_note_reperforming_threshold",
  "tpl_landlord_lease_renewal_countdown",
  "tpl_landlord_maintenance_request_triage",
  "tpl_landlord_rent_received_receipt",
  "tpl_flip_milestone_demo_complete",
  "tpl_flip_listing_ready",
  "tpl_subdivision_plat_submitted",
  "tpl_subdivision_vendor_milestone",
  "tpl_subdivision_phase_recorded",
  "tpl_wholesaler_contract_signed_buyer_broadcast",
  "tpl_wholesaler_assignment_pending",
  "tpl_wholesaler_occupied_cash_for_keys",
  "tpl_tax_cert_acquired_kickoff",
  "tpl_tax_cert_redemption_approaching",
  "tpl_tax_cert_foreclosure_eligible",
  "tpl_note_balloon_approaching_extended",
] as const;

// Wave-V3 additions (this change). Registry destinations are coordinated
// separately (shared/business-types.ts is owned by another agent):
//   multifamily            → tpl_multifamily_unit_turn
//   mobile_home            → tpl_mobile_home_lot_rent_receipt
//   tax_lien_deed          → tpl_tax_cert_redeemed_payoff,
//                            tpl_parcel_tax_delinquent_watchlist
//   land_flipper / hybrid  → tpl_parcel_owner_changed_followup
const WAVE_V3_IDS = [
  "tpl_multifamily_unit_turn",
  "tpl_mobile_home_lot_rent_receipt",
  "tpl_tax_cert_redeemed_payoff",
  "tpl_parcel_owner_changed_followup",
  "tpl_parcel_tax_delinquent_watchlist",
] as const;

// Legacy templates whose trigger event lives ONLY in workflow-engine.ts's
// local ExtendedTriggerEvent union (not in shared WORKFLOW_TRIGGER_EVENTS —
// so no code can legally emit it through workflowEngine.emit's typed
// surface). Grandfathered, pinned: this set may only shrink. Anything NEW
// outside the shared union fails the ratchet below.
const LEGACY_EXTENDED_TRIGGER_TEMPLATE_IDS = new Set([
  // tpl_buyer_match_found (buyer.match_created) GRADUATED out of the escape hatch
  // in audit Wave 1 (wholesaler beta→core): buyer.match_created is now a declared
  // member of the shared WORKFLOW_TRIGGER_EVENTS union with a real emitter
  // (buyerEvents.ts → emitBuyerEvent). The set may only shrink — this is a shrink.
  // tpl_lease_expiring (lease.expiring_60d) GRADUATED out in audit Wave 1
  // (buy_and_hold beta→core): lease.expiring_60d is now a declared member of the
  // shared union with a real emitter (rentalEvents.ts → emitRentalEvent, fired by
  // the daily leaseExpiryDetector). The set may only shrink — this is a shrink.
  "tpl_payment_received", // payment.confirmed
  "tpl_delinquency_escalation", // note.delinquent_60d
  "tpl_property_listed", // property.listed
  "tpl_campaign_response", // campaign.response_received
  "tpl_referral_milestone", // org.milestone_reached
  "tpl_lead_score_high", // lead.scored
  "tpl_offer_batch_sent", // offers.batch_sent
  "tpl_support_ticket", // support.ticket_created
  "tpl_weekly_pipeline_review", // schedule.weekly_monday
]);

// The exact payload fields parcelDeltaDetector.persistDelta passes to
// emitParcelEvent (server/services/parcelDeltaDetector.ts) — the ONLY
// runtime emit call site in the codebase today. previousValue rides in
// previousData, which interpolateTemplate does NOT expose as a variable,
// so it is deliberately absent here.
const PARCEL_EVENT_PAYLOAD_FIELDS = new Set([
  "apn",
  "state",
  "county",
  "field",
  "alertType",
  "currentValue",
  "leadId",
  "propertyId",
]);

const SHARED_TRIGGER_EVENTS = new Set<string>(WORKFLOW_TRIGGER_EVENTS);
const SHARED_ACTION_TYPES = new Set<string>(WORKFLOW_ACTION_TYPES);

const templateById = new Map(
  LAND_INVESTING_WORKFLOW_TEMPLATES.map((t) => [t.id, t]),
);

/** Extract {{placeholder}} roots exactly as interpolateTemplate resolves them. */
function extractPlaceholders(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    for (const m of value.matchAll(/\{\{(\w+(?:\.\w+)*)\}\}/g)) {
      out.add(m[1].split(".")[0]);
    }
  } else if (Array.isArray(value)) {
    for (const v of value) extractPlaceholders(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) extractPlaceholders(v, out);
  }
}

describe("pre-existing template snapshot", () => {
  it("the first 40 templates are exactly the pre-existing ids, unchanged and in order", () => {
    const prefix = LAND_INVESTING_WORKFLOW_TEMPLATES.slice(
      0,
      PRE_EXISTING_IDS.length,
    ).map((t) => t.id);
    expect(prefix).toEqual([...PRE_EXISTING_IDS]);
  });

  it("no pre-existing id was removed", () => {
    for (const id of PRE_EXISTING_IDS) {
      expect(templateById.has(id), `${id} must still exist`).toBe(true);
    }
  });
});

describe("template-id uniqueness", () => {
  it("every template id is globally unique", () => {
    const ids = LAND_INVESTING_WORKFLOW_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every template id uses the tpl_ prefix convention", () => {
    for (const t of LAND_INVESTING_WORKFLOW_TEMPLATES) {
      expect(t.id).toMatch(/^tpl_[a-z0-9_]+$/);
    }
  });
});

describe("actions resolve to real handlers (all templates)", () => {
  const usedActionTypes = new Set(
    LAND_INVESTING_WORKFLOW_TEMPLATES.flatMap((t) =>
      t.actions.map((a) => a.type),
    ),
  );

  it("every action type is declared in shared WORKFLOW_ACTION_TYPES", () => {
    for (const type of usedActionTypes) {
      expect(
        SHARED_ACTION_TYPES.has(type),
        `action type "${type}" must be in WORKFLOW_ACTION_TYPES`,
      ).toBe(true);
    }
  });

  it("every used action type has a handler case in executeAction (no silent no-op)", () => {
    for (const type of usedActionTypes) {
      expect(
        ENGINE_SOURCE.includes(`case "${type}":`),
        `executeAction must handle "${type}"`,
      ).toBe(true);
    }
  });

  it("every template has at least one action, with per-template-unique action ids", () => {
    for (const t of LAND_INVESTING_WORKFLOW_TEMPLATES) {
      expect(t.actions.length, `${t.id} must have actions`).toBeGreaterThan(0);
      const actionIds = t.actions.map((a) => a.id);
      expect(
        new Set(actionIds).size,
        `${t.id} action ids must be unique within the template`,
      ).toBe(actionIds.length);
    }
  });
});

describe("trigger-event ratchet", () => {
  it("every template outside the shared union is a pinned legacy template (set may only shrink)", () => {
    for (const t of LAND_INVESTING_WORKFLOW_TEMPLATES) {
      if (!SHARED_TRIGGER_EVENTS.has(t.trigger.event)) {
        expect(
          LEGACY_EXTENDED_TRIGGER_TEMPLATE_IDS.has(t.id),
          `${t.id} triggers on "${t.trigger.event}", which is not in shared ` +
            `WORKFLOW_TRIGGER_EVENTS. New templates must use a declared union ` +
            `event — do not grow the ExtendedTriggerEvent escape hatch.`,
        ).toBe(true);
      }
    }
  });
});

describe("wave-V3 templates", () => {
  it("all five exist, appended after the pre-existing prefix", () => {
    for (const id of WAVE_V3_IDS) {
      expect(templateById.has(id), `${id} must exist`).toBe(true);
      const index = LAND_INVESTING_WORKFLOW_TEMPLATES.findIndex(
        (t) => t.id === id,
      );
      expect(index).toBeGreaterThanOrEqual(PRE_EXISTING_IDS.length);
    }
  });

  it("every wave-V3 trigger event is a declared member of shared WORKFLOW_TRIGGER_EVENTS", () => {
    for (const id of WAVE_V3_IDS) {
      const t = templateById.get(id)!;
      expect(
        SHARED_TRIGGER_EVENTS.has(t.trigger.event),
        `${id} trigger "${t.trigger.event}" must be in the shared union`,
      ).toBe(true);
    }
  });

  it("wave-V3 triggers are the intended events", () => {
    expect(templateById.get("tpl_multifamily_unit_turn")!.trigger.event).toBe(
      "lease.renewal_countdown_60d",
    );
    expect(
      templateById.get("tpl_mobile_home_lot_rent_receipt")!.trigger.event,
    ).toBe("rent.received");
    expect(
      templateById.get("tpl_tax_cert_redeemed_payoff")!.trigger.event,
    ).toBe("cert.redeemed");
    expect(
      templateById.get("tpl_parcel_owner_changed_followup")!.trigger.event,
    ).toBe("parcel.owner_changed");
    expect(
      templateById.get("tpl_parcel_tax_delinquent_watchlist")!.trigger.event,
    ).toBe("parcel.tax_status_changed");
  });

  it("every wave-V3 action resolves to a real handler", () => {
    for (const id of WAVE_V3_IDS) {
      const t = templateById.get(id)!;
      for (const action of t.actions) {
        expect(
          SHARED_ACTION_TYPES.has(action.type),
          `${id}/${action.id}: type "${action.type}" must be in WORKFLOW_ACTION_TYPES`,
        ).toBe(true);
        expect(
          ENGINE_SOURCE.includes(`case "${action.type}":`),
          `${id}/${action.id}: executeAction must handle "${action.type}"`,
        ).toBe(true);
      }
    }
  });

  it("every wave-V3 template has a plain-words name and description", () => {
    for (const id of WAVE_V3_IDS) {
      const t = templateById.get(id)!;
      expect(t.name.length).toBeGreaterThan(10);
      expect(t.description.length).toBeGreaterThan(30);
      expect(["leads", "notes", "deals"]).toContain(t.category);
    }
  });
});

describe("parcel templates interpolate only real emitted payload fields", () => {
  // parcel.owner_changed / parcel.tax_status_changed are the only trigger
  // events with a live emit call site (parcelDeltaDetector.persistDelta →
  // emitParcelEvent). Their templates must never reference a field that
  // emit call does not send — a missing variable renders as a literal
  // "{{placeholder}}" in tasks/notifications, which is fabricated-looking
  // output. Refuse-not-fabricate applies to template plumbing too.
  const PARCEL_TEMPLATE_IDS = [
    "tpl_parcel_owner_changed_followup",
    "tpl_parcel_tax_delinquent_watchlist",
  ] as const;

  it.each(PARCEL_TEMPLATE_IDS)("%s uses only fields the emitter sends", (id) => {
    const t = templateById.get(id)!;
    const used = new Set<string>();
    for (const action of t.actions) extractPlaceholders(action.config, used);
    expect(used.size).toBeGreaterThan(0);
    for (const field of used) {
      expect(
        PARCEL_EVENT_PAYLOAD_FIELDS.has(field),
        `${id} interpolates {{${field}}}, which parcelDeltaDetector.persistDelta never emits`,
      ).toBe(true);
    }
  });

  it("the emitter really does send the pinned payload fields (source pin)", () => {
    const detectorSource = fs.readFileSync(
      path.join(__dirname, "../../server/services/parcelDeltaDetector.ts"),
      "utf-8",
    );
    // The emit call passes these exact keys from the detected delta.
    for (const field of PARCEL_EVENT_PAYLOAD_FIELDS) {
      expect(
        detectorSource.includes(`${field}: delta.${field}`),
        `parcelDeltaDetector must emit "${field}" (payload contract drifted — update PARCEL_EVENT_PAYLOAD_FIELDS)`,
      ).toBe(true);
    }
  });
});

describe("subdivision templates interpolate only real emitted payload fields", () => {
  // Audit Wave 1 (beta→core): the three subdivider templates are now LIVE —
  // subdivisionEvents.ts → emitSubdivisionEvent fires them on genuine operator
  // transitions (permit gate → approved; plan → county_submitted / recorded).
  // Each template may only interpolate fields its emitter actually sends — a
  // reintroduced {{nextCountyCheckinDays}} (dropped) or {{phaseNumber}}
  // (replaced by the real {{planName}}) would render as a literal placeholder,
  // i.e. fabricated-looking output. Refuse-not-fabricate applies to template
  // plumbing too. These sets are the payloads in server/services/subdivisionEvents.ts.
  const SUBDIVISION_PAYLOAD_FIELDS: Record<string, Set<string>> = {
    // emitPlanStatusChange → plat.submitted
    tpl_subdivision_plat_submitted: new Set([
      "platId",
      "propertyAddress",
      "countyName",
      "state",
      "numLots",
      "submittedDate",
    ]),
    // emitPermitGateApproved → subdivision.vendor_milestone
    tpl_subdivision_vendor_milestone: new Set([
      "milestoneName",
      "milestoneDate",
      "propertyAddress",
      "nextStage",
      "nextVendor",
      "nextStageDays",
    ]),
    // emitPlanStatusChange → subdivision.phase_recorded
    tpl_subdivision_phase_recorded: new Set([
      "propertyAddress",
      "lotCount",
      "planName",
      "recordedDate",
    ]),
  };

  it.each(Object.keys(SUBDIVISION_PAYLOAD_FIELDS))(
    "%s uses only fields the emitter sends",
    (id) => {
      const t = templateById.get(id)!;
      const used = new Set<string>();
      for (const action of t.actions) extractPlaceholders(action.config, used);
      expect(used.size).toBeGreaterThan(0);
      const allowed = SUBDIVISION_PAYLOAD_FIELDS[id];
      for (const field of used) {
        expect(
          allowed.has(field),
          `${id} interpolates {{${field}}}, which emitSubdivisionEvent never sends for its event`,
        ).toBe(true);
      }
    },
  );

  it("the corrected fabrications stay gone (nextCountyCheckinDays / phaseNumber)", () => {
    const platUsed = new Set<string>();
    for (const a of templateById.get("tpl_subdivision_plat_submitted")!.actions) {
      extractPlaceholders(a.config, platUsed);
    }
    expect(platUsed.has("nextCountyCheckinDays")).toBe(false);

    const phaseUsed = new Set<string>();
    for (const a of templateById.get("tpl_subdivision_phase_recorded")!.actions) {
      extractPlaceholders(a.config, phaseUsed);
    }
    expect(phaseUsed.has("phaseNumber")).toBe(false);
    expect(phaseUsed.has("planName")).toBe(true); // the real replacement is present
  });
});

describe("wholesaler templates interpolate only real emitted payload fields", () => {
  // Audit Wave 1 (residential_wholesaler beta→core): two of the wholesaler
  // templates are now LIVE — wholesaleEvents.ts → emitWholesaleDealEvent fires
  // them on genuine operator transitions (deal → in_escrow; contract_assignments
  // → sent_for_signature). Each template may only interpolate fields its emitter
  // actually sends — a reintroduced {{compArv}}/{{askingPrice}} (dropped: no
  // comps plane) or {{buyerEntity}}/{{buyerPrice}} (dropped: no such column)
  // would render as a literal placeholder, i.e. fabricated-looking output.
  // Refuse-not-fabricate applies to template plumbing too. These sets are the
  // payloads in server/services/wholesaleEvents.ts.
  const WHOLESALER_PAYLOAD_FIELDS: Record<string, Set<string>> = {
    // emitContractSigned → deal.contract_signed
    tpl_wholesaler_contract_signed_buyer_broadcast: new Set([
      "dealId",
      "propertyAddress",
      "contractPrice",
      "closingDate",
      "contractDate",
    ]),
    // emitAssignmentPending → deal.assignment_pending
    tpl_wholesaler_assignment_pending: new Set([
      "assignmentId",
      "dealId",
      "propertyAddress",
      "state",
      "assignmentFee",
      "buyerName",
      "originalContractDate",
    ]),
  };

  it.each(Object.keys(WHOLESALER_PAYLOAD_FIELDS))(
    "%s uses only fields the emitter sends",
    (id) => {
      const t = templateById.get(id)!;
      const used = new Set<string>();
      for (const action of t.actions) extractPlaceholders(action.config, used);
      expect(used.size).toBeGreaterThan(0);
      const allowed = WHOLESALER_PAYLOAD_FIELDS[id];
      for (const field of used) {
        expect(
          allowed.has(field),
          `${id} interpolates {{${field}}}, which emitWholesaleDealEvent never sends for its event`,
        ).toBe(true);
      }
    },
  );

  it("the corrected fabrications stay gone (compArv/askingPrice; buyerEntity/buyerPrice)", () => {
    const broadcastUsed = new Set<string>();
    for (const a of templateById.get("tpl_wholesaler_contract_signed_buyer_broadcast")!.actions) {
      extractPlaceholders(a.config, broadcastUsed);
    }
    expect(broadcastUsed.has("compArv")).toBe(false);
    expect(broadcastUsed.has("askingPrice")).toBe(false);
    expect(broadcastUsed.has("assignmentFee")).toBe(false); // no assignment fee at contract-signing
    expect(broadcastUsed.has("contractPrice")).toBe(true); // the real replacement is present

    const assignmentUsed = new Set<string>();
    for (const a of templateById.get("tpl_wholesaler_assignment_pending")!.actions) {
      extractPlaceholders(a.config, assignmentUsed);
    }
    expect(assignmentUsed.has("buyerEntity")).toBe(false);
    expect(assignmentUsed.has("buyerPrice")).toBe(false);
    expect(assignmentUsed.has("buyerName")).toBe(true); // real end_buyer_name
    expect(assignmentUsed.has("assignmentFee")).toBe(true); // real assignment_fee_cents
  });

  it("tpl_wholesaler_occupied_cash_for_keys stays installable but its event (deal.occupied) is NOT live", async () => {
    // The occupied template is pinned by PRE_EXISTING_IDS so it stays in the
    // engine array (still installable), but deal.occupied has ZERO schema
    // backing, so it must NOT be wired live. Guard both facts here.
    expect(templateById.has("tpl_wholesaler_occupied_cash_for_keys")).toBe(true);
    const { LIVE_WORKFLOW_TRIGGER_EVENTS } = await import(
      "../../shared/workflow-live-triggers"
    );
    expect([...LIVE_WORKFLOW_TRIGGER_EVENTS]).not.toContain("deal.occupied");
    // …while the two wired wholesaler events ARE live.
    expect([...LIVE_WORKFLOW_TRIGGER_EVENTS]).toContain("deal.contract_signed");
    expect([...LIVE_WORKFLOW_TRIGGER_EVENTS]).toContain("deal.assignment_pending");
    expect([...LIVE_WORKFLOW_TRIGGER_EVENTS]).toContain("buyer.match_created");
  });
});

describe("landlord + cross-vertical templates interpolate only real emitted payload fields", () => {
  // Audit Wave 1 (buy_and_hold beta→core): the four landlord templates are now
  // LIVE — rentalEvents.ts → emitRentalEvent fires them on the rent-ledger POST
  // seam (rent.received), the maintenance POST seam (maintenance.request_received)
  // and the daily leaseExpiryDetector (lease.renewal_countdown_60d +
  // lease.expiring_60d). Making those events live ALSO activated two other
  // verticals' templates that ride the same events: tpl_mobile_home_lot_rent_receipt
  // (rent.received) and tpl_multifamily_unit_turn (lease.renewal_countdown_60d).
  // Each template may only interpolate fields its emitter actually sends — a
  // reintroduced {{marketRent}}/{{suggestedRenewalRent}} (dropped: residential-
  // comps hard-stop) or {{urgencyRationale}}/{{suggestedVendor}}/{{estimatedCost}}/
  // {{responseTimeSla}} (dropped: no such column/engine) would render as a literal
  // {{placeholder}}, i.e. fabricated-looking output. These sets are the payloads
  // buildRentReceivedPayload / buildMaintenanceRequestPayload / buildLeasePayload
  // send in server/services/rentalEvents.ts.
  const RENT_RECEIVED_FIELDS = new Set([
    "leaseId", "paymentId", "rentAmount", "rentPeriodLabel", "tenantName",
    "tenantEmail", "propertyAddress", "ytdPaid", "nextDueDate", "lateFeeApplied",
    "orgName",
  ]);
  const MAINTENANCE_FIELDS = new Set([
    "ticketId", "propertyAddress", "requestCategory", "urgencyLevel",
    "requestDescription", "tenantName", "tenantEmail", "orgName",
  ]);
  const LEASE_FIELDS = new Set([
    "leaseId", "propertyAddress", "tenantName", "tenantEmail", "leaseEndDate",
    "currentRent", "state", "orgName",
  ]);
  const RENTAL_PAYLOAD_FIELDS: Record<string, Set<string>> = {
    // rent.received
    tpl_landlord_rent_received_receipt: RENT_RECEIVED_FIELDS,
    tpl_mobile_home_lot_rent_receipt: RENT_RECEIVED_FIELDS, // cross-vertical, same event
    // maintenance.request_received
    tpl_landlord_maintenance_request_triage: MAINTENANCE_FIELDS,
    // lease.renewal_countdown_60d / lease.expiring_60d
    tpl_landlord_lease_renewal_countdown: LEASE_FIELDS,
    tpl_multifamily_unit_turn: LEASE_FIELDS, // cross-vertical, same renewal event
    tpl_lease_expiring: LEASE_FIELDS,
  };

  it.each(Object.keys(RENTAL_PAYLOAD_FIELDS))(
    "%s uses only fields the emitter sends",
    (id) => {
      const t = templateById.get(id)!;
      const used = new Set<string>();
      for (const action of t.actions) extractPlaceholders(action.config, used);
      expect(used.size).toBeGreaterThan(0);
      const allowed = RENTAL_PAYLOAD_FIELDS[id];
      for (const field of used) {
        expect(
          allowed.has(field),
          `${id} interpolates {{${field}}}, which emitRentalEvent never sends for its event`,
        ).toBe(true);
      }
    },
  );

  it("the corrected fabrications stay gone (market/suggested rent; urgency rationale/vendor/cost/SLA)", () => {
    const usedIn = (id: string) => {
      const used = new Set<string>();
      for (const a of templateById.get(id)!.actions) extractPlaceholders(a.config, used);
      return used;
    };

    for (const id of ["tpl_landlord_lease_renewal_countdown", "tpl_multifamily_unit_turn"]) {
      const used = usedIn(id);
      expect(used.has("marketRent"), `${id} must not fabricate market rent`).toBe(false);
      expect(used.has("suggestedRenewalRent")).toBe(false);
      expect(used.has("rentChangePct")).toBe(false);
      expect(used.has("currentRent"), `${id} keeps the real current rent`).toBe(true);
    }

    const maint = usedIn("tpl_landlord_maintenance_request_triage");
    expect(maint.has("urgencyRationale")).toBe(false);
    expect(maint.has("suggestedVendor")).toBe(false);
    expect(maint.has("estimatedCost")).toBe(false);
    expect(maint.has("responseTimeSla")).toBe(false);
    expect(maint.has("urgencyLevel"), "the real severity enum stays").toBe(true);
  });

  it("all four landlord events are live (rentalEvents.ts + leaseExpiryDetector.ts)", async () => {
    const { LIVE_WORKFLOW_TRIGGER_EVENTS } = await import(
      "../../shared/workflow-live-triggers"
    );
    const live = [...LIVE_WORKFLOW_TRIGGER_EVENTS];
    expect(live).toContain("rent.received");
    expect(live).toContain("maintenance.request_received");
    expect(live).toContain("lease.renewal_countdown_60d");
    expect(live).toContain("lease.expiring_60d");
  });
});

describe("balloon templates interpolate only real emitted payload fields", () => {
  // Audit Wave 1 (creative_finance beta→core): note.balloon_approaching is now
  // LIVE — noteEvents.ts → emitNoteEvent fires it from the daily
  // notePaymentDueDetector scan (the balloon scan folded into
  // runNotePaymentDueScan, no new job) for an ACTIVE note ~90 days from maturity
  // with a positive balance. BOTH templates on the event
  // (tpl_balloon_approaching / tpl_note_balloon_approaching_extended) may only
  // interpolate fields the emitter actually sends. The critical correction: the
  // fabricated {{balloonAmount}} (a precise balloon payoff no row holds — it
  // lives in the amortization schedule) was replaced by {{outstandingBalance}}
  // (notes.currentBalance), honest ONLY as the approximate outstanding figure. A
  // reintroduced {{balloonAmount}} would render as a literal {{placeholder}},
  // i.e. fabricated-looking output. This set is the payload buildBalloonPayload
  // sends in server/services/noteEvents.ts.
  const BALLOON_FIELDS = new Set([
    "noteId", "borrowerName", "borrowerFirstName", "borrowerEmail",
    "balloonDate", "daysToBalloon", "outstandingBalance", "orgName",
  ]);
  const BALLOON_TEMPLATE_IDS = [
    "tpl_balloon_approaching",
    "tpl_note_balloon_approaching_extended",
  ];

  it.each(BALLOON_TEMPLATE_IDS)(
    "%s uses only fields emitNoteEvent sends for note.balloon_approaching",
    (id) => {
      const t = templateById.get(id)!;
      const used = new Set<string>();
      for (const action of t.actions) extractPlaceholders(action.config, used);
      expect(used.size).toBeGreaterThan(0);
      for (const field of used) {
        expect(
          BALLOON_FIELDS.has(field),
          `${id} interpolates {{${field}}}, which noteEvents.ts never sends for note.balloon_approaching`,
        ).toBe(true);
      }
    },
  );

  it("the fabricated precise balloon amount stays gone (outstanding balance only)", () => {
    for (const id of BALLOON_TEMPLATE_IDS) {
      const used = new Set<string>();
      for (const a of templateById.get(id)!.actions) extractPlaceholders(a.config, used);
      // The invented precise payoff must never come back.
      expect(used.has("balloonAmount"), `${id} must not fabricate a precise balloon amount`).toBe(false);
      // The honest, approximate outstanding figure is what both templates carry.
      expect(used.has("outstandingBalance"), `${id} keeps the real outstanding balance`).toBe(true);
    }
  });

  it("both balloon templates trigger on note.balloon_approaching", () => {
    for (const id of BALLOON_TEMPLATE_IDS) {
      expect(templateById.get(id)!.trigger.event).toBe("note.balloon_approaching");
    }
  });

  it("note.balloon_approaching is live (noteEvents.ts + notePaymentDueDetector fold-in)", async () => {
    const { LIVE_WORKFLOW_TRIGGER_EVENTS } = await import(
      "../../shared/workflow-live-triggers"
    );
    expect([...LIVE_WORKFLOW_TRIGGER_EVENTS]).toContain("note.balloon_approaching");
  });
});
