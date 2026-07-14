/**
 * Tests for the deal-lifecycle → event-mesh seam (Jarvis 2.1, audit G2).
 *
 * Coverage:
 *  - classifyDealMutation (pure): discovered on create, updated on genuine
 *    stage transitions with from→to, closed on won/lost with amount only
 *    when honestly known, null for non-transitions and soft deletes
 *  - publishDealLifecycle: routes each kind to the matching publisher method,
 *    org-scoped; fire-and-forget isolation — a rejecting/throwing publisher
 *    never throws back into the mutation path
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const CALLS: Array<{ method: string; orgId: number; payload: Record<string, unknown> }> = [];
let FAIL_MODE: "none" | "reject" | "throw" = "none";

vi.mock("./eventMeshPublisher", () => {
  const record = (method: string) => async (orgId: number, payload: Record<string, unknown>) => {
    if (FAIL_MODE === "throw") throw new Error("mesh down (sync)");
    CALLS.push({ method, orgId, payload });
    if (FAIL_MODE === "reject") return Promise.reject(new Error("mesh down (async)"));
  };
  return {
    eventMeshPublisher: {
      dealDiscovered: record("dealDiscovered"),
      dealUpdated: record("dealUpdated"),
      dealClosed: record("dealClosed"),
    },
  };
});

import { classifyDealMutation, publishDealLifecycle } from "./dealLifecycleEvents";

beforeEach(() => {
  CALLS.length = 0;
  FAIL_MODE = "none";
  vi.clearAllMocks();
});

// The publish path hops through a dynamic import + a then/catch chain; give
// the event loop a few turns so the fire-and-forget promise fully settles.
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

describe("classifyDealMutation (pure)", () => {
  it("classifies a create (no pre-image) as discovered with id/type/status/property", () => {
    const e = classifyDealMutation(null, { id: 7, type: "acquisition", status: "negotiating", propertyId: 12 });
    expect(e).toEqual({
      kind: "discovered",
      payload: { dealId: 7, type: "acquisition", status: "negotiating", propertyId: 12 },
    });
  });

  it("omits absent fields from the discovered payload rather than inventing them", () => {
    const e = classifyDealMutation(null, { id: 7 });
    expect(e).toEqual({ kind: "discovered", payload: { dealId: 7 } });
  });

  it("classifies a genuine stage transition as updated with from→to", () => {
    const e = classifyDealMutation({ status: "negotiating" }, { id: 7, status: "offer_sent" });
    expect(e).toEqual({ kind: "updated", payload: { dealId: 7, from: "negotiating", to: "offer_sent" } });
  });

  it("returns null when the status did not change (field-only edits are not lifecycle)", () => {
    expect(classifyDealMutation({ status: "offer_sent" }, { id: 7, status: "offer_sent" })).toBeNull();
  });

  it("classifies closed as won with the accepted amount when honestly known", () => {
    const e = classifyDealMutation(
      { status: "in_escrow" },
      { id: 7, status: "closed", acceptedAmount: "45000", offerAmount: "42000" },
    );
    expect(e).toEqual({
      kind: "closed",
      payload: { dealId: 7, from: "in_escrow", to: "closed", outcome: "won", amount: 45000 },
    });
  });

  it("falls back to the offer amount when no accepted amount exists", () => {
    const e = classifyDealMutation({ status: "in_escrow" }, { id: 7, status: "closed", offerAmount: "42000" });
    expect(e?.kind).toBe("closed");
    expect((e as any).payload.amount).toBe(42000);
  });

  it("omits amount entirely when no honest figure exists (never fabricates)", () => {
    const e = classifyDealMutation({ status: "in_escrow" }, { id: 7, status: "closed" });
    expect(e?.kind).toBe("closed");
    expect((e as any).payload).not.toHaveProperty("amount");
  });

  it("classifies cancelled as closed-lost with no amount", () => {
    const e = classifyDealMutation(
      { status: "offer_sent" },
      { id: 7, status: "cancelled", offerAmount: "42000" },
    );
    expect(e).toEqual({
      kind: "closed",
      payload: { dealId: 7, from: "offer_sent", to: "cancelled", outcome: "lost" },
    });
  });

  it("never publishes soft deletes (status → deleted) or deleted creates", () => {
    expect(classifyDealMutation({ status: "negotiating" }, { id: 7, status: "deleted" })).toBeNull();
    expect(classifyDealMutation(null, { id: 7, status: "deleted" })).toBeNull();
  });
});

describe("publishDealLifecycle (fire-and-forget seam)", () => {
  it("routes discovered / updated / closed to the matching publisher, org-scoped", async () => {
    publishDealLifecycle(42, null, { id: 1, status: "negotiating" });
    publishDealLifecycle(42, { status: "negotiating" }, { id: 1, status: "offer_sent" });
    publishDealLifecycle(42, { status: "in_escrow" }, { id: 1, status: "closed", acceptedAmount: "9000" });
    await flush();
    expect(CALLS.map((c) => c.method)).toEqual(["dealDiscovered", "dealUpdated", "dealClosed"]);
    expect(CALLS.every((c) => c.orgId === 42)).toBe(true);
    expect(CALLS[2].payload).toMatchObject({ outcome: "won", amount: 9000 });
  });

  it("publishes nothing for a non-transition", async () => {
    publishDealLifecycle(42, { status: "offer_sent" }, { id: 1, status: "offer_sent" });
    await flush();
    expect(CALLS).toHaveLength(0);
  });

  it("never throws when the publisher rejects (mutation isolation)", async () => {
    FAIL_MODE = "reject";
    expect(() =>
      publishDealLifecycle(42, { status: "negotiating" }, { id: 1, status: "offer_sent" }),
    ).not.toThrow();
    await flush();
  });

  it("never throws when the publisher throws synchronously (mutation isolation)", async () => {
    FAIL_MODE = "throw";
    expect(() =>
      publishDealLifecycle(42, { status: "negotiating" }, { id: 1, status: "offer_sent" }),
    ).not.toThrow();
    await flush();
    expect(CALLS).toHaveLength(0);
  });
});
