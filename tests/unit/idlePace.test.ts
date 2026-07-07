/**
 * idlePace (server/jobs/idlePace.ts) — activity-aware job pacing from the
 * 2026-07-07 cost audit. Contract: below the paying-customer threshold only
 * 1 in IDLE_PACE_MULTIPLIER time slots does work; at/above it every tick
 * runs; a failed count read fails toward ACTIVE (full speed), never toward
 * throttling a real business.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.fn();
vi.mock("../../server/db", () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  isPlatformIdle,
  shouldRunAtPace,
  __resetIdlePaceCache,
} from "../../server/jobs/idlePace";

const INTERVAL = 30 * 60 * 1000;
const MULTIPLIER = 8; // default IDLE_PACE_MULTIPLIER

const payingOrgs = (n: number) => executeMock.mockResolvedValue({ rows: [{ n }] });

beforeEach(() => {
  executeMock.mockReset();
  __resetIdlePaceCache();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isPlatformIdle", () => {
  it("is idle below the 5-paying-org threshold and active at it", async () => {
    payingOrgs(0);
    expect(await isPlatformIdle()).toBe(true);
    __resetIdlePaceCache();
    payingOrgs(4);
    expect(await isPlatformIdle()).toBe(true);
    __resetIdlePaceCache();
    payingOrgs(5);
    expect(await isPlatformIdle()).toBe(false);
  });

  it("fails toward ACTIVE when the count read errors", async () => {
    executeMock.mockRejectedValue(new Error("db down"));
    expect(await isPlatformIdle()).toBe(false);
  });

  it("caches the count so repeated gates don't re-query", async () => {
    payingOrgs(0);
    await isPlatformIdle();
    await isPlatformIdle();
    await isPlatformIdle();
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});

describe("shouldRunAtPace", () => {
  it("always runs when the platform is active", async () => {
    payingOrgs(10);
    // An arbitrary non-live slot for the idle math — must still run.
    vi.setSystemTime(new Date(INTERVAL * (MULTIPLIER * 100 + 3)));
    expect(await shouldRunAtPace("job", INTERVAL)).toBe(true);
  });

  it("runs exactly 1 in MULTIPLIER slots when idle (stateless slot math)", async () => {
    payingOrgs(0);
    let ran = 0;
    for (let slot = 0; slot < MULTIPLIER * 2; slot++) {
      vi.setSystemTime(new Date(INTERVAL * slot + 1));
      if (await shouldRunAtPace("job", INTERVAL)) ran++;
    }
    expect(ran).toBe(2); // slots 0 and MULTIPLIER
  });

  it("live slots are aligned across processes (pure function of wall time)", async () => {
    payingOrgs(0);
    vi.setSystemTime(new Date(INTERVAL * MULTIPLIER * 7 + 1234));
    const a = await shouldRunAtPace("job", INTERVAL);
    const b = await shouldRunAtPace("job", INTERVAL);
    expect(a).toBe(true);
    expect(b).toBe(true);
  });
});
