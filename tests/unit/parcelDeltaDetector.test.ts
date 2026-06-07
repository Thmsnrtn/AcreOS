/**
 * Iyari #5 — Parcel delta detector unit tests.
 *
 * Locks in the PURE decision core of the owner-change & tax-status delta
 * detector: change-detected / no-change / first-observation-only, plus the
 * false-positive guard (cosmetic churn, empty/"unknown" current, low
 * confidence) and the idempotency dedupe key.
 *
 * These tests exercise pure functions only — no DB. We mock the db +
 * workflow-engine modules the SUT imports at module load so importing the file
 * never opens a connection.
 *
 * idempotent: true — pure assertions of helper behavior.
 */

import { describe, it, expect, vi } from "vitest";

// The SUT imports db (for the report/persist layer) and emitParcelEvent at
// module load. Stub them so importing the pure helpers is side-effect free.
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/storage", () => ({ db: {}, storage: {} }));
vi.mock("../../server/services/workflow-engine", () => ({
  emitParcelEvent: vi.fn(),
}));

import {
  evaluateFieldDelta,
  normalizeValue,
  isEmptyValue,
  dedupeKeyFor,
  alertTypeForField,
  type FieldObservationPair,
} from "../../server/services/parcelDeltaDetector";

function pair(over: Partial<FieldObservationPair> = {}): FieldObservationPair {
  return {
    apn: "123-45-678",
    state: "AZ",
    county: "Cochise",
    field: "owner",
    current: { value: "Jane Buyer LLC", confidence: 0.9 },
    previous: { value: "John Seller", confidence: 0.9 },
    ...over,
  };
}

describe("alertTypeForField", () => {
  it("maps owner + owner_address to owner_changed", () => {
    expect(alertTypeForField("owner")).toBe("owner_changed");
    expect(alertTypeForField("owner_address")).toBe("owner_changed");
  });
  it("maps tax_status + tax_amount to tax_status_changed", () => {
    expect(alertTypeForField("tax_status")).toBe("tax_status_changed");
    expect(alertTypeForField("tax_amount")).toBe("tax_status_changed");
  });
  it("returns null for untracked fields", () => {
    expect(alertTypeForField("acres")).toBeNull();
    expect(alertTypeForField("site_address")).toBeNull();
  });
});

describe("normalizeValue / isEmptyValue", () => {
  it("trims + lowercases strings", () => {
    expect(normalizeValue("  John Seller ")).toBe("john seller");
  });
  it("stringifies numbers + objects consistently", () => {
    expect(normalizeValue(1200)).toBe("1200");
    expect(normalizeValue({ a: 1 })).toBe('{"a":1}');
  });
  it("treats null/unknown/n-a as empty", () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue("")).toBe(true);
    expect(isEmptyValue("Unknown")).toBe(true);
    expect(isEmptyValue("N/A")).toBe(true);
    expect(isEmptyValue("John Seller")).toBe(false);
  });
});

describe("evaluateFieldDelta — change detected", () => {
  it("fires on a real owner change", () => {
    const r = evaluateFieldDelta(pair());
    expect(r.changed).toBe(true);
    expect(r.alertType).toBe("owner_changed");
    expect(r.reason).toBe("changed");
  });

  it("fires on a tax_amount change", () => {
    const r = evaluateFieldDelta(
      pair({
        field: "tax_amount",
        current: { value: 4200, confidence: 0.95 },
        previous: { value: 1200, confidence: 0.95 },
      }),
    );
    expect(r.changed).toBe(true);
    expect(r.alertType).toBe("tax_status_changed");
  });

  it("fires when tax_status goes from blank to delinquent", () => {
    const r = evaluateFieldDelta(
      pair({
        field: "tax_status",
        current: { value: "delinquent", confidence: 0.9 },
        previous: { value: "", confidence: 0.9 },
      }),
    );
    expect(r.changed).toBe(true);
    expect(r.alertType).toBe("tax_status_changed");
  });
});

describe("evaluateFieldDelta — no change", () => {
  it("does not fire when values are identical", () => {
    const r = evaluateFieldDelta(
      pair({ current: { value: "John Seller" }, previous: { value: "John Seller" } }),
    );
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("no_change");
  });

  it("does not fire on cosmetic-only churn (case + whitespace)", () => {
    const r = evaluateFieldDelta(
      pair({
        current: { value: "  john seller " },
        previous: { value: "John Seller" },
      }),
    );
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("no_change");
  });

  it("does not fire on number-vs-string churn (1200 vs '1200')", () => {
    const r = evaluateFieldDelta(
      pair({
        field: "tax_amount",
        current: { value: "1200" },
        previous: { value: 1200 },
      }),
    );
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("no_change");
  });
});

describe("evaluateFieldDelta — first observation only", () => {
  it("does not fire when there is no previous observation", () => {
    const r = evaluateFieldDelta(
      pair({ previous: undefined }),
    );
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("first_observation_only");
  });
});

describe("evaluateFieldDelta — false-positive guard", () => {
  it("suppresses when the current value is empty/unknown (county dropped the field)", () => {
    const r = evaluateFieldDelta(
      pair({
        current: { value: "Unknown" },
        previous: { value: "John Seller" },
      }),
    );
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("empty_current");
  });

  it("suppresses when current value is empty string", () => {
    const r = evaluateFieldDelta(
      pair({
        current: { value: "" },
        previous: { value: "John Seller" },
      }),
    );
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("empty_current");
  });

  it("suppresses a low-confidence current observation (below threshold)", () => {
    const r = evaluateFieldDelta(
      pair({
        current: { value: "Jane Buyer LLC", confidence: 0.2 },
        previous: { value: "John Seller", confidence: 0.9 },
      }),
    );
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("low_confidence");
  });

  it("honors a custom minConfidence option", () => {
    const r = evaluateFieldDelta(
      pair({ current: { value: "Jane Buyer LLC", confidence: 0.6 } }),
      { minConfidence: 0.8 },
    );
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("low_confidence");
  });

  it("fires when confidence is null/undefined (source-trusted)", () => {
    const r = evaluateFieldDelta(
      pair({
        current: { value: "Jane Buyer LLC", confidence: null },
        previous: { value: "John Seller", confidence: null },
      }),
    );
    expect(r.changed).toBe(true);
  });

  it("does not fire on an untracked field even when the value changes", () => {
    const r = evaluateFieldDelta(
      pair({ field: "acres", current: { value: 10 }, previous: { value: 5 } }),
    );
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("untracked_field");
  });
});

describe("dedupeKeyFor — idempotency", () => {
  it("produces a stable key for the same transition", () => {
    const a = dedupeKeyFor(pair());
    const b = dedupeKeyFor(pair());
    expect(a).toBe(b);
  });

  it("produces different keys for different transitions", () => {
    const a = dedupeKeyFor(pair());
    const b = dedupeKeyFor(
      pair({ current: { value: "Third Owner LLC" } }),
    );
    expect(a).not.toBe(b);
  });

  it("is insensitive to cosmetic churn in the values", () => {
    const a = dedupeKeyFor(
      pair({ current: { value: "Jane Buyer LLC" }, previous: { value: "John Seller" } }),
    );
    const b = dedupeKeyFor(
      pair({ current: { value: " jane buyer llc " }, previous: { value: "JOHN SELLER" } }),
    );
    expect(a).toBe(b);
  });
});
