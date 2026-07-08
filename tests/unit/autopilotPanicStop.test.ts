import { describe, it, expect, vi, afterEach } from "vitest";

// settings reads the db barrel on the non-panic path; stub it. The panic path
// returns ALL_OFF before touching the db, which is exactly what we assert.
vi.mock("../../server/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
}));

import { isPanicStopped, getEffectiveSettings, isDispatchEnabled } from "../../server/services/autopilot/settings";

afterEach(() => {
  delete process.env.SOLENE_PANIC_STOP;
});

describe("isPanicStopped — the out-of-reach hard kill (T0.3)", () => {
  it("is false when the env is unset", () => {
    expect(isPanicStopped()).toBe(false);
  });
  it("is true for 'true' or '1'", () => {
    process.env.SOLENE_PANIC_STOP = "true";
    expect(isPanicStopped()).toBe(true);
    process.env.SOLENE_PANIC_STOP = "1";
    expect(isPanicStopped()).toBe(true);
  });
});

describe("getEffectiveSettings — panic forces every switch OFF, overriding the DB", () => {
  it("returns all-off the instant panic is engaged (not cached on)", async () => {
    process.env.SOLENE_PANIC_STOP = "true";
    const s = await getEffectiveSettings();
    expect(s.dispatchEnabled).toBe(false);
    expect(s.publishEnabled).toBe(false);
    expect(s.cognitionEnabled).toBe(false);
    expect(await isDispatchEnabled()).toBe(false);
  });
});
