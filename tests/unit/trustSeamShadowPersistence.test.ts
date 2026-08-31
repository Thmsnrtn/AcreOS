/**
 * Shadow evidence must survive deploys (2026-08-31).
 *
 * THE DEFECT THIS PINS: the trust-seam shadow counters were process memory
 * and the divergence "record" was a logger.warn into Fly's minutes-scale
 * log retention. Every deploy zeroed both — and with several deploys a day,
 * the ≥1-week evidence window that licenses the turn-12/13 authority flips
 * was structurally unreadable. shadowCompare now persists into
 * jobHealthLogs: one row per divergence (status "failed" for the
 * flip-blocking seam-LOOSER direction) and a cumulative counter flush on
 * each boot's first comparison and every 200th, keyed by bootId.
 *
 * The seam's first law still holds: a dead database must never disturb the
 * live gate — pinned by the db-failure case.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  level: "execute_gated" as string,
  inserted: [] as Array<{ jobName: string; status: string; runMetrics: Record<string, unknown> }>,
  dbThrows: false,
}));

vi.mock("../../server/services/autopilot/domainAutonomy", () => ({
  getDomainLevel: vi.fn(async () => state.level),
}));
vi.mock("../../server/services/agentAuthorityGate", () => ({
  isNeverPromote: vi.fn(() => false),
}));
vi.mock("../../server/db", () => ({
  db: {
    insert: () => ({
      values: (v: any) => {
        if (state.dbThrows) return Promise.reject(new Error("db down"));
        state.inserted.push(v);
        return { catch: (_f: any) => Promise.resolve() };
      },
    }),
  },
}));

async function freshSeam() {
  vi.resetModules();
  return import("../../server/services/autopilot/trustSeam");
}

// send_alert maps to a real domain in ACTION_DOMAIN_MAP; with the ledger at
// execute_gated the seam ALLOWS, so legacyAllowed:false forces seam-LOOSER
// and legacyAllowed:true agreement/stricter as needed per case.
const CMP = (legacyAllowed: boolean) => ({
  gate: "executionEngine" as const,
  agentCodename: "atlas",
  action: "send_alert",
  legacyAllowed,
});

describe("shadow evidence persists durably", () => {
  beforeEach(() => {
    state.inserted = [];
    state.dbThrows = false;
    state.level = "execute_gated";
  });

  it("the first comparison of a boot writes a counter flush keyed by bootId", async () => {
    const seam = await freshSeam();
    await seam.shadowCompare(CMP(true)); // agreement — still must flush
    const flushes = state.inserted.filter((r) => r.jobName === "trustSeamShadow:flush");
    expect(flushes.length).toBe(1);
    expect(flushes[0].status).toBe("success");
    expect(flushes[0].runMetrics.bootId).toBeTruthy();
    expect(flushes[0].runMetrics.comparisons).toBe(1);
  });

  it("a seam-LOOSER divergence writes a FAILED row with full context", async () => {
    const seam = await freshSeam();
    await seam.shadowCompare(CMP(false)); // legacy blocked, seam allows → LOOSER
    const div = state.inserted.filter((r) => r.jobName === "trustSeamShadow:divergence");
    expect(div.length).toBe(1);
    expect(div[0].status).toBe("failed");
    expect(div[0].runMetrics).toMatchObject({
      direction: "seam-LOOSER",
      action: "send_alert",
      gate: "executionEngine",
      legacyAllowed: false,
    });
  });

  it("a seam-stricter divergence records as success (safe direction), still with context", async () => {
    state.level = "observe"; // seam refuses while legacy allowed → stricter
    const seam = await freshSeam();
    await seam.shadowCompare(CMP(true));
    const div = state.inserted.filter((r) => r.jobName === "trustSeamShadow:divergence");
    expect(div.length).toBe(1);
    expect(div[0].status).toBe("success");
    expect(div[0].runMetrics.direction).toBe("seam-stricter");
  });

  it("an agreement writes NO divergence row", async () => {
    const seam = await freshSeam();
    await seam.shadowCompare(CMP(true)); // seam allows, legacy allows
    expect(state.inserted.filter((r) => r.jobName === "trustSeamShadow:divergence").length).toBe(0);
  });

  it("a dead database never disturbs the gate — shadowCompare still resolves and counts", async () => {
    state.dbThrows = true;
    const seam = await freshSeam();
    await expect(seam.shadowCompare(CMP(false))).resolves.toBeUndefined();
    const c = seam.getShadowCounters();
    expect(c.comparisons).toBe(1);
    expect(c.seamLooser).toBe(1);
  });
});
