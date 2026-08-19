/**
 * An unknown autonomy level is not permission.
 *
 * THE DEFECT
 * ──────────
 * `getOrgAutonomyLevel` read the stored column with a CAST:
 *
 *     return (org?.paxAutonomyLevel as AutonomyLevel) ?? "assisted";
 *
 * A cast is not a check, and `??` only catches null/undefined. An empty string,
 * a typo, or anything a future code path wrote came back unchanged. Every
 * consumer then asked the same question the same wrong way round:
 *
 *     if (autonomyLevel === "assisted" && !trustedApproval) { ...draft, no send }
 *
 * — a check for the ONE level that must not send. So any value that was not
 * literally "assisted" fell through to the guarded send. An unrecognised level
 * conveyed MORE permission than the default, which is the inverse of what a
 * safety default is for, and it contradicted the invariant those very call sites
 * state in capitals: NOTHING sends without an explicit human tap.
 *
 * It also meant a level added later would be granted unattended sending by every
 * consumer at once, silently, on the day it was added.
 *
 * WHAT IS ASSERTED
 * ────────────────
 * Both halves, because either alone is satisfiable by a broken fix:
 *   - the RESOLVER maps anything unrecognised to the floor;
 *   - the PREDICATE the send paths consume answers "may this level send
 *     unattended", so an unknown level answers no.
 * Plus the positive direction: `supervised` and `autonomous` must still send,
 * or a resolver that returned "assisted" unconditionally would pass everything
 * above while quietly disabling the feature.
 *
 * The hostile values are driven through the REAL resolver against a stubbed
 * row, not through a reimplementation of it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
vi.mock("../../server/db", () => ({ db: { query: { organizations: { findFirst: (...a: unknown[]) => findFirst(...a) } } } }));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/storage", () => ({ storage: {} }));

const { getOrgAutonomyLevel, unattendedSendPermitted } = await import(
  "../../server/services/autonomyGuardrails"
);
const { logger } = await import("../../server/utils/logger");

/**
 * Values a column typed `varchar(20)` can actually hold.
 *
 * `""` is the one that made this a live fail-open rather than a theoretical
 * one: it is falsy, so a reader reaching for `||` would have caught it, but the
 * code used `??`, which does not.
 */
const HOSTILE = ["", " ", "autonomus", "AUTONOMOUS", "Assisted", "full_auto", "none", "0", "null"];

describe("the resolver parses rather than casts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("vacuity: the hostile set is non-empty and none of it is a real level", () => {
    expect(HOSTILE.length).toBeGreaterThan(0);
    for (const v of HOSTILE) {
      expect(["assisted", "supervised", "autonomous"], `${JSON.stringify(v)} is a real level`)
        .not.toContain(v);
    }
  });

  it("resolves every unrecognised stored value to the safe floor", async () => {
    const leaked: string[] = [];
    for (const stored of HOSTILE) {
      findFirst.mockResolvedValue({ paxAutonomyLevel: stored });
      const level = await getOrgAutonomyLevel(1);
      if (level !== "assisted") leaked.push(`${JSON.stringify(stored)} → ${level}`);
    }
    expect(leaked).toEqual([]);
  });

  it("says so, rather than swallowing it", async () => {
    // A value nobody recognises is a fact worth seeing. Silence here would make
    // a corrupted column indistinguishable from a correctly-defaulted one.
    findFirst.mockResolvedValue({ paxAutonomyLevel: "autonomus" });
    await getOrgAutonomyLevel(42);
    expect(logger.warn).toHaveBeenCalled();
    const said = (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => String(c[0])).join(" ");
    expect(said).toMatch(/autonomus/);
    expect(said).toMatch(/assisted/);
  });

  it("a missing row and a missing column both resolve to the floor", async () => {
    for (const row of [undefined, null, {}, { paxAutonomyLevel: null }]) {
      findFirst.mockResolvedValue(row);
      expect(await getOrgAutonomyLevel(1)).toBe("assisted");
    }
  });

  it("the real levels survive — this fails closed, it does not fail shut", async () => {
    for (const level of ["assisted", "supervised", "autonomous"] as const) {
      findFirst.mockResolvedValue({ paxAutonomyLevel: level });
      expect(await getOrgAutonomyLevel(1)).toBe(level);
    }
  });
});

describe("the send predicate asks which levels MAY send", () => {
  it("only the two levels above the floor send unattended", () => {
    expect(unattendedSendPermitted("assisted")).toBe(false);
    expect(unattendedSendPermitted("supervised")).toBe(true);
    expect(unattendedSendPermitted("autonomous")).toBe(true);
  });

  it("a level nobody has considered sends nothing", () => {
    // The polarity IS the fix. `=== "assisted"` grants a new level unattended
    // sending on the day it is added; asking which levels may send withholds it
    // until somebody says so.
    for (const invented of ["delegated", "trusted", "full_auto", "", "unknown"]) {
      expect(
        unattendedSendPermitted(invented as never),
        `an unconsidered level "${invented}" was granted unattended sending`,
      ).toBe(false);
    }
  });
});
