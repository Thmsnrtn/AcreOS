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
  "tpl_buyer_match_found", // buyer.match_created
  "tpl_payment_received", // payment.confirmed
  "tpl_delinquency_escalation", // note.delinquent_60d
  "tpl_property_listed", // property.listed
  "tpl_campaign_response", // campaign.response_received
  "tpl_referral_milestone", // org.milestone_reached
  "tpl_lead_score_high", // lead.scored
  "tpl_offer_batch_sent", // offers.batch_sent
  "tpl_lease_expiring", // lease.expiring_60d
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
