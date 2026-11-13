/**
 * P1-7 / A-2 — the demand bump records its refusal reason.
 *
 * enqueueCountyForDiscovery is the one writer every demand path funnels
 * through (search misses, gate refusals, explicit customer requests). This
 * pins its P1-7 behaviour against an argument-capturing db stub:
 *  - a bump carrying a refusalReason writes it as the queue row's
 *    lastRefusalReason on insert AND on the conflict-update (latest wins);
 *  - a bump carrying none leaves the column out of the insert's reason
 *    (null) and — critically — out of the conflict SET entirely, so plain
 *    search demand can never erase a recorded refusal reason.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const cap = vi.hoisted(() => ({
  insertValues: null as Record<string, unknown> | null,
  conflictSet: null as Record<string, unknown> | null,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db-replica", () => ({ dbForReads: async () => { throw new Error("not used by enqueue"); } }));
vi.mock("../../server/db", () => {
  const selectChain: Record<string, unknown> = {};
  selectChain.from = () => selectChain;
  selectChain.where = () => selectChain;
  // No active endpoint covers the county → the enqueue proceeds.
  selectChain.limit = async () => [];
  const insertChain: Record<string, unknown> = {};
  insertChain.values = (v: Record<string, unknown>) => {
    cap.insertValues = v;
    return insertChain;
  };
  insertChain.onConflictDoUpdate = (cfg: { set: Record<string, unknown> }) => {
    cap.conflictSet = cfg.set;
    return insertChain;
  };
  insertChain.returning = async () => [{ id: 7, status: "pending", demandCount: 1 }];
  return {
    db: {
      select: () => selectChain,
      insert: () => insertChain,
    },
  };
});

import { enqueueCountyForDiscovery } from "../../server/services/coverageLedger";

beforeEach(() => {
  cap.insertValues = null;
  cap.conflictSet = null;
});

describe("enqueueCountyForDiscovery — refusal reason recording (P1-7)", () => {
  it("a gate-refusal bump writes lastRefusalReason on insert and on conflict-update", async () => {
    const r = await enqueueCountyForDiscovery("WI", "Dane", { refusalReason: "gated" });
    expect(r.queueId).toBe(7);
    expect(cap.insertValues).toMatchObject({ state: "WI", county: "dane", lastRefusalReason: "gated" });
    expect(cap.conflictSet).toMatchObject({ lastRefusalReason: "gated" });
  });

  it("a no-endpoint bump records its own reason", async () => {
    await enqueueCountyForDiscovery("FL", "Leon", { refusalReason: "no_endpoint" });
    expect(cap.insertValues).toMatchObject({ lastRefusalReason: "no_endpoint" });
    expect(cap.conflictSet).toMatchObject({ lastRefusalReason: "no_endpoint" });
  });

  it("a reason-less bump (plain search demand) never touches the recorded reason", async () => {
    await enqueueCountyForDiscovery("FL", "Leon");
    expect(cap.insertValues).toMatchObject({ lastRefusalReason: null });
    expect(cap.conflictSet).not.toBeNull();
    expect("lastRefusalReason" in (cap.conflictSet as Record<string, unknown>)).toBe(false);
  });
});
