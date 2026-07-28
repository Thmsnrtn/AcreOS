/**
 * Self-Healing Data Plane — probe wiring is failure-isolated.
 *
 * The annunciation sweep runs at the END of the canary job
 * (runAndRecordDataSourceProbes). Pins: (1) the sweep IS invoked once per
 * probe run; (2) a sweep that explodes NEVER breaks the probe — outcomes are
 * still recorded and the job resolves normally.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const lookupMock = vi.fn(async () => null);
vi.mock("../../server/services/providers/provider-registry", () => ({
  providerRegistry: { lookup: (...args: unknown[]) => lookupMock(...args) },
}));

const healthInserts: unknown[] = [];
vi.mock("../../server/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(async (v: unknown) => {
        healthInserts.push(v);
      }),
    })),
  },
}));

vi.mock("../../server/services/providerIntelligence", () => ({
  recordLookup: vi.fn(async () => {}),
}));

const createSystemAlert = vi.fn(async () => ({}));
vi.mock("../../server/storage", () => ({
  storage: { createSystemAlert: (...args: unknown[]) => createSystemAlert(...args) },
}));

const runSelfHealingSweep = vi.fn(async () => {
  throw new Error("sweep exploded");
});
vi.mock("../../server/services/openData/selfHealing", () => ({
  runSelfHealingSweep: () => runSelfHealingSweep(),
}));

import { runAndRecordDataSourceProbes, GOLDEN_PROBES } from "../../server/jobs/dataSourceProbe";

beforeEach(() => {
  lookupMock.mockClear();
  runSelfHealingSweep.mockClear();
  runSelfHealingSweep.mockImplementation(async () => {
    throw new Error("sweep exploded");
  });
  healthInserts.length = 0;
});

describe("dataSourceProbe → self-healing wiring", () => {
  it("invokes the sweep once at the end of the run, and a sweep explosion never breaks the probe", async () => {
    const result = await runAndRecordDataSourceProbes();
    // probe job completed normally despite the throwing sweep
    expect(result.ran).toBe(GOLDEN_PROBES.length);
    expect(typeof result.failed).toBe("number");
    // provider_health history was still written BEFORE the sweep ran
    expect(healthInserts).toHaveLength(1);
    // and the sweep was actually wired in (called exactly once)
    expect(runSelfHealingSweep).toHaveBeenCalledTimes(1);
  });

  it("a healthy sweep also runs exactly once and does not alter the probe result", async () => {
    runSelfHealingSweep.mockImplementation(async () => ({
      confirmedDrifts: 0,
      cardsRaised: 0,
      windowsClosed: 0,
    }));
    const result = await runAndRecordDataSourceProbes();
    expect(result.ran).toBe(GOLDEN_PROBES.length);
    expect(runSelfHealingSweep).toHaveBeenCalledTimes(1);
  });
});
