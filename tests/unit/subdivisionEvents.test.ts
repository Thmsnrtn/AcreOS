// Pins the subdivider lifecycle emitters (audit Wave 1, beta→core): the three
// subdivision templates were dead until this emitter shipped, so this test
// fixes the new truth — the events fire on the REAL operator transitions the
// templates handle (permit gate → approved; plan → county_submitted / recorded),
// carry only real columns (no fabricated phaseNumber / nextCountyCheckinDays),
// bind milestoneDate to the gate's real approval date (not wall-clock), pass
// nullable columns through as null (never a fabricated 0), and no-op on
// everything else. Fire-and-forget: a throwing engine never propagates.
import { afterEach, describe, expect, it, vi } from "vitest";

const { emitSubdivisionEvent } = vi.hoisted(() => ({
  emitSubdivisionEvent: vi.fn(),
}));
vi.mock("../../server/services/workflow-engine", () => ({ emitSubdivisionEvent }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  emitPermitGateApproved,
  emitPlanStatusChange,
} from "../../server/services/subdivisionEvents";

const TODAY = new Date().toISOString().slice(0, 10);

const gate = {
  id: "gate_1",
  organizationId: 7,
  label: "Preliminary plat submitted",
  status: "approved",
  completedAt: "2026-05-01", // operator-set approval date, well before TODAY
};

const gateCtx = {
  propertyAddress: "1247 Cherokee Pl",
  parentParcelId: 42,
  nextStage: "Soil percolation tests (TDEC)",
  nextVendor: "Earl (civil eng)",
  nextStageDays: 90,
};

const plan = {
  id: "plan_1",
  organizationId: 7,
  name: "Plan A — 12 lots",
  status: "county_submitted",
  lotCount: 12,
};

const parent = { address: "1247 Cherokee Pl", county: "Williamson", state: "TN" };

afterEach(() => emitSubdivisionEvent.mockReset());

describe("emitPermitGateApproved", () => {
  it("fires subdivision.vendor_milestone on a genuine gate→approved transition, real fields only", () => {
    emitPermitGateApproved("submitted", gate, gateCtx);
    expect(emitSubdivisionEvent).toHaveBeenCalledTimes(1);
    const [event, orgId, entityId, data] = emitSubdivisionEvent.mock.calls[0];
    expect(event).toBe("subdivision.vendor_milestone");
    expect(orgId).toBe(7);
    // entityId is the PARENT PARCEL's properties.id, never the gate id.
    expect(entityId).toBe(42);
    expect(data.milestoneName).toBe("Preliminary plat submitted"); // gate.label
    // milestoneDate binds the gate's REAL approval date, not wall-clock.
    expect(data.milestoneDate).toBe("2026-05-01");
    expect(data.milestoneDate).not.toBe(TODAY);
    expect(data.propertyAddress).toBe("1247 Cherokee Pl");
    expect(data.nextStage).toBe("Soil percolation tests (TDEC)");
    expect(data.nextVendor).toBe("Earl (civil eng)");
    expect(data.nextStageDays).toBe(90);
    // No fabricated placeholders leak into the payload.
    expect(data.phaseNumber).toBeUndefined();
    expect(data.nextCountyCheckinDays).toBeUndefined();
  });

  it("no-ops on submitted→in_review, approved→approved, and non-approve edits", () => {
    emitPermitGateApproved("submitted", { ...gate, status: "in_review" }, gateCtx);
    emitPermitGateApproved("approved", { ...gate, status: "approved" }, gateCtx);
    emitPermitGateApproved("in_review", { ...gate, status: "rejected" }, gateCtx);
    emitPermitGateApproved(null, { ...gate, status: "not_started" }, gateCtx);
    expect(emitSubdivisionEvent).not.toHaveBeenCalled();
  });

  it("carries honest values (never a fabricated placeholder) when the approved gate is the final stage", () => {
    emitPermitGateApproved("in_review", gate, {
      propertyAddress: "1247 Cherokee Pl",
      parentParcelId: 42,
      nextStage: null,
      nextVendor: null,
      nextStageDays: null,
    });
    expect(emitSubdivisionEvent).toHaveBeenCalledTimes(1);
    const [, , , data] = emitSubdivisionEvent.mock.calls[0];
    // nextStage / nextStageDays stay null (the engine renders a real null as
    // blank, never the literal "null"); an unset next-gate vendor is the honest
    // "unassigned", never a fabricated name.
    expect(data.nextStage).toBeNull();
    expect(data.nextVendor).toBe("unassigned");
    expect(data.nextStageDays).toBeNull();
  });

  it("binds milestoneDate to a null completedAt as null, never wall-clock", () => {
    emitPermitGateApproved("submitted", { ...gate, completedAt: null }, gateCtx);
    const [, , , data] = emitSubdivisionEvent.mock.calls[0];
    expect(data.milestoneDate).toBeNull();
    expect(data.milestoneDate).not.toBe(TODAY);
  });

  it("does not propagate a throwing engine (fire-and-forget)", () => {
    emitSubdivisionEvent.mockImplementationOnce(() => {
      throw new Error("engine down");
    });
    expect(() => emitPermitGateApproved("submitted", gate, gateCtx)).not.toThrow();
  });
});

describe("emitPlanStatusChange", () => {
  it("fires plat.submitted ONLY on a genuine →county_submitted transition, real fields only", () => {
    emitPlanStatusChange("engineer_review", plan, parent, { parentParcelId: 42 });
    expect(emitSubdivisionEvent).toHaveBeenCalledTimes(1);
    const [event, orgId, entityId, data] = emitSubdivisionEvent.mock.calls[0];
    expect(event).toBe("plat.submitted");
    expect(orgId).toBe(7);
    expect(entityId).toBe(42); // parent parcel properties.id
    expect(data.platId).toBe("plan_1");
    expect(data.propertyAddress).toBe("1247 Cherokee Pl");
    expect(data.countyName).toBe("Williamson");
    expect(data.state).toBe("TN");
    expect(data.numLots).toBe(12);
    // estimatedApprovalMonths is deliberately NOT sent — no per-plan column
    // supplies it, so the template dropped the clause rather than render a blank
    // or a fabricated month count.
    expect(data.estimatedApprovalMonths).toBeUndefined();
    expect(data.submittedDate).toBe(TODAY); // the transition IS happening now
    // planName belongs to the phase_recorded payload, not plat.submitted.
    expect(data.planName).toBeUndefined();
  });

  it("fires subdivision.phase_recorded ONLY on a genuine →recorded transition, real fields only", () => {
    emitPlanStatusChange("county_submitted", { ...plan, status: "recorded" }, parent, {
      parentParcelId: 42,
    });
    expect(emitSubdivisionEvent).toHaveBeenCalledTimes(1);
    const [event, , entityId, data] = emitSubdivisionEvent.mock.calls[0];
    expect(event).toBe("subdivision.phase_recorded");
    expect(entityId).toBe(42);
    expect(data.propertyAddress).toBe("1247 Cherokee Pl");
    expect(data.lotCount).toBe(12);
    // planName replaces the fabricated phaseNumber — a real subdivision_plans.name.
    expect(data.planName).toBe("Plan A — 12 lots");
    expect(data.recordedDate).toBe(TODAY);
    expect(data.platId).toBeUndefined();
    expect(data.phaseNumber).toBeUndefined();
  });

  it("no-ops on unrelated transitions and same-status edits", () => {
    emitPlanStatusChange("draft", { ...plan, status: "engineer_review" }, parent, {
      parentParcelId: 42,
    }); // not a target state
    emitPlanStatusChange("county_submitted", { ...plan, status: "county_submitted" }, parent, {
      parentParcelId: 42,
    }); // already submitted → no re-fire
    emitPlanStatusChange("recorded", { ...plan, status: "recorded" }, parent, {
      parentParcelId: 42,
    }); // already recorded → no re-fire
    expect(emitSubdivisionEvent).not.toHaveBeenCalled();
  });

  it("passes null (never 0) for an absent lotCount, and falls back to a real county/state label", () => {
    emitPlanStatusChange(
      "draft",
      { ...plan, status: "county_submitted", lotCount: null },
      { address: null, county: "Hickman", state: "TN" },
      { parentParcelId: 9 },
    );
    expect(emitSubdivisionEvent).toHaveBeenCalledTimes(1);
    const [, , entityId, data] = emitSubdivisionEvent.mock.calls[0];
    expect(entityId).toBe(9);
    expect(data.numLots).toBeNull(); // honest null, never a fabricated 0
    // address is null → honest fallback to the parcel's real county/state.
    expect(data.propertyAddress).toBe("Hickman, TN");
  });

  it("does not propagate a throwing engine (fire-and-forget)", () => {
    emitSubdivisionEvent.mockImplementationOnce(() => {
      throw new Error("engine down");
    });
    expect(() =>
      emitPlanStatusChange("draft", { ...plan, status: "county_submitted" }, parent, {
        parentParcelId: 42,
      }),
    ).not.toThrow();
  });
});
