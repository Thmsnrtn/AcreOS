// Pins the fix-and-flip rehab lifecycle emitter (audit Wave 1, beta→core):
// the two flip milestone templates were dead until this emitter shipped, so
// this test fixes the new truth — the events fire on the two REAL status
// transitions the templates handle, carry only real rehab fields (no
// fabricated comp numbers), and no-op on everything else.
import { afterEach, describe, expect, it, vi } from "vitest";

const { emitRehabEvent } = vi.hoisted(() => ({ emitRehabEvent: vi.fn() }));
vi.mock("../../server/services/workflow-engine", () => ({ emitRehabEvent }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { emitRehabStatusChange } from "../../server/services/rehabEvents";

const rehab = {
  id: "reh_1",
  organizationId: 7,
  propertyId: 42,
  name: "1247 Cherokee Pl",
  status: "framing",
  spentTotalCents: 1_250_000,
  budgetTotalCents: 4_000_000,
  arvCents: 32_000_000,
  plannedListingDate: "2026-10-01",
};

afterEach(() => emitRehabEvent.mockClear());

describe("emitRehabStatusChange", () => {
  it("fires rehab.milestone when demo completes, with only real rehab fields", () => {
    emitRehabStatusChange("demo", { ...rehab, status: "framing" });
    expect(emitRehabEvent).toHaveBeenCalledTimes(1);
    const [event, orgId, propertyId, data] = emitRehabEvent.mock.calls[0];
    expect(event).toBe("rehab.milestone");
    expect(orgId).toBe(7);
    expect(propertyId).toBe(42);
    expect(data.propertyAddress).toBe("1247 Cherokee Pl");
    expect(data.actualSpend).toBe(12_500); // cents → dollars, real column
    expect(data.plannedSpend).toBe(40_000);
    // No fabricated comp fields leak into the payload.
    expect(data.compArv).toBeUndefined();
    expect(data.nextStageDays).toBeUndefined();
  });

  it("fires rehab.punch_list_complete when the rehab reaches 'listed'", () => {
    emitRehabStatusChange("punch_list", { ...rehab, status: "listed" });
    expect(emitRehabEvent).toHaveBeenCalledTimes(1);
    const [event, , , data] = emitRehabEvent.mock.calls[0];
    expect(event).toBe("rehab.punch_list_complete");
    expect(data.afterRepairValue).toBe(320_000);
    expect(data.targetListDate).toBe("2026-10-01");
    expect(data.compLow).toBeUndefined();
    expect(data.recentListSaleRatio).toBeUndefined();
  });

  it("no-ops on a non-transition (same status) and on unrelated transitions", () => {
    emitRehabStatusChange("framing", { ...rehab, status: "framing" }); // same
    emitRehabStatusChange(null, { ...rehab, status: "framing" }); // no pre-image
    emitRehabStatusChange("framing", { ...rehab, status: "drywall" }); // mid-build, no template
    expect(emitRehabEvent).not.toHaveBeenCalled();
  });

  it("passes null (never a fabricated 0) when a money column is absent", () => {
    emitRehabStatusChange("demo", {
      ...rehab,
      status: "framing",
      spentTotalCents: null,
      budgetTotalCents: null,
    });
    const [, , , data] = emitRehabEvent.mock.calls[0];
    expect(data.actualSpend).toBeNull();
    expect(data.plannedSpend).toBeNull();
  });
});
