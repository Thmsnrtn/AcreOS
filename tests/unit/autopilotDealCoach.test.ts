import { describe, it, expect } from "vitest";
import { labelForKind, type DealActionKind } from "../../server/services/autopilot/dealActions";

describe("deal coach — labelForKind (D4, pure)", () => {
  it("maps every action kind to a customer-facing label", () => {
    const cases: Record<DealActionKind, string> = {
      advance_to_close: "Advance to close",
      follow_up: "Follow up",
      contact_now: "Contact now",
      first_contact: "Make first contact",
      requalify_or_drop: "Requalify or drop",
    };
    for (const [kind, label] of Object.entries(cases)) {
      expect(labelForKind(kind as DealActionKind)).toBe(label);
    }
  });

  it("falls back to the raw kind for an unknown value", () => {
    expect(labelForKind("something_new" as DealActionKind)).toBe("something_new");
  });
});
