/**
 * P1-13 — first-settlement milestone pure model. Nothing mocked.
 */
import { describe, expect, it } from "vitest";
import {
  shapeFirstSettlementMilestone as shape,
  FIRST_SETTLEMENT_EVENT_NAME as EV,
  FIRST_SETTLEMENT_SCAN_LIMIT,
} from "../../server/services/founder/firstSettlementMilestone";

const row = (o: Record<string, unknown> = {}) => ({
  eventName: EV,
  organizationId: 1,
  eventValue: { paymentId: 10, noteId: 20, amount: 123.45 },
  occurredAt: "2026-11-01T00:00:00.000Z",
  ...o,
});

describe("shapeFirstSettlementMilestone", () => {
  it("no rows → not reached, trigger not fired", () => {
    for (const input of [[], null, undefined]) {
      const m = shape(input as any);
      expect(m.milestoneReached).toBe(false);
      expect(m.firstSettlement).toBeNull();
      expect(m.orgsWithFirstSettlement).toBe(0);
      expect(m.llcTrigger).toEqual({ fired: false, accelerator: "first-borrower-money-settlement", posture: "alert-only" });
      expect(m.excludedMalformed).toBe(0);
    }
  });

  it("one row → reached, exact fields, dollars converted to cents", () => {
    const m = shape([row()]);
    expect(m.milestoneReached).toBe(true);
    expect(m.firstSettlement).toEqual({
      organizationId: 1,
      occurredAt: "2026-11-01T00:00:00.000Z",
      paymentId: 10,
      noteId: 20,
      amountCents: 12345,
    });
    expect(m.orgsWithFirstSettlement).toBe(1);
    expect(m.llcTrigger.fired).toBe(true);
  });

  it("float dollars round, not truncate (0.29 → 29)", () => {
    expect(shape([row({ eventValue: { amount: 0.29 } })]).firstSettlement!.amountCents).toBe(29);
  });

  it("missing / non-finite amount → null cents, never guessed", () => {
    for (const eventValue of [{}, { amount: "5" }, { amount: NaN }, { amount: Infinity }, { amount: null }]) {
      const m = shape([row({ eventValue })]);
      expect(m.milestoneReached).toBe(true);
      expect(m.firstSettlement!.amountCents).toBeNull();
    }
  });

  it("multiple orgs → earliest wins regardless of order; distinct org count", () => {
    const rows = [
      row({ organizationId: 3, occurredAt: "2026-11-05T00:00:00Z", eventValue: { paymentId: 3, noteId: 3, amount: 3 } }),
      row({ organizationId: 2, occurredAt: "2026-10-20T12:00:00Z", eventValue: { paymentId: 2, noteId: 2, amount: 2 } }),
      row({ organizationId: 2, occurredAt: "2026-10-25T00:00:00Z" }),
      row({ organizationId: 1, occurredAt: new Date("2026-11-09T00:00:00Z") }),
    ];
    for (const r of [rows, [...rows].reverse()]) {
      const m = shape(r);
      expect(m.firstSettlement).toMatchObject({ organizationId: 2, occurredAt: "2026-10-20T12:00:00.000Z", amountCents: 200 });
      expect(m.orgsWithFirstSettlement).toBe(3);
    }
  });

  it("wrong-eventName rows are ignored (not counted as malformed)", () => {
    const m = shape([row({ eventName: "first_deal_created" }), row({ eventName: `${EV}_x`, organizationId: null })]);
    expect(m.milestoneReached).toBe(false);
    expect(m.excludedMalformed).toBe(0);
    expect(m.llcTrigger.fired).toBe(false);
  });

  it("malformed rows are excluded and counted without throwing", () => {
    const bad = [
      row({ organizationId: null }),
      row({ organizationId: undefined }),
      row({ organizationId: 0 }),
      row({ eventValue: null }),
      row({ eventValue: "garbage" }),
      row({ eventValue: [1] }),
      row({ occurredAt: "not-a-date" }),
      row({ occurredAt: null }),
      null,
    ];
    let m!: ReturnType<typeof shape>;
    expect(() => { m = shape(bad as any); }).not.toThrow();
    expect(m.milestoneReached).toBe(false);
    expect(m.excludedMalformed).toBe(bad.length - 1); // null entry is skipped as not-our-event
    expect(m.llcTrigger.fired).toBe(false);
  });

  it("malformed rows do not poison good ones", () => {
    const m = shape([row({ organizationId: null }), row({ organizationId: 7 })]);
    expect(m.milestoneReached).toBe(true);
    expect(m.firstSettlement!.organizationId).toBe(7);
    expect(m.excludedMalformed).toBe(1);
  });

  it("llcTrigger.fired === milestoneReached and posture is always alert-only", () => {
    for (const rows of [[], [row()], [row({ organizationId: null })], [row({ eventName: "x" })]]) {
      const m = shape(rows as any);
      expect(m.llcTrigger.fired).toBe(m.milestoneReached);
      expect(m.llcTrigger.posture).toBe("alert-only");
    }
  });

  it("payload carries no person identifiers", () => {
    const m = shape([row({ eventValue: { paymentId: 1, noteId: 2, amount: 1, email: "a@b.c", userId: "u" } })]);
    expect(JSON.stringify(m)).not.toMatch(/a@b\.c|"userId"|"email"/);
  });

  it("scan bound is a positive finite integer", () => {
    expect(Number.isInteger(FIRST_SETTLEMENT_SCAN_LIMIT) && FIRST_SETTLEMENT_SCAN_LIMIT > 0).toBe(true);
  });
});
