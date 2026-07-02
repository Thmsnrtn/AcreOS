/**
 * Module-freeze regression tests.
 *
 * Strategy decision (2026-07-02): speculative modules (marketplace, academy,
 * white-label, voice, deal rooms, …) are frozen behind 'off' flags while the
 * core land-investor loop is hardened. Two mechanisms make that freeze real:
 *
 * 1. Server: evaluateFlag's 5-state machine — 'off' is off for EVERY
 *    audience (only requireFlag's founder bypass sits above it).
 * 2. Client: resolveRouteEnabled's deny-first precedence — before this,
 *    an all-flags-off world produced enabledRoutes: [] which the sidebar
 *    treated as "flags unused → show every door", so a full freeze was
 *    impossible to express in the nav.
 */
import { describe, it, expect } from "vitest";
import { evaluateFlag, type FeatureFlag } from "../../server/services/featureFlags";
import {
  resolveRouteEnabled,
  resolveFlagEnabled,
  type FeatureFlagsResponse,
} from "../../client/src/hooks/use-feature-flags";

function flag(state: FeatureFlag["state"], audience: { betaUserIds?: string[] } = {}): FeatureFlag {
  return {
    key: "feature_test",
    label: "Test",
    description: "",
    state,
    audience,
    controlledRoutes: ["/test"],
  };
}

describe("evaluateFlag state machine", () => {
  it("'off' is off for every audience, including founders", () => {
    expect(evaluateFlag(flag("off"), {})).toBe(false);
    expect(evaluateFlag(flag("off"), { isFounder: true })).toBe(false);
    expect(evaluateFlag(flag("off"), { tier: "enterprise", userId: "u1" })).toBe(false);
  });

  it("'on' is on for everyone", () => {
    expect(evaluateFlag(flag("on"), {})).toBe(true);
    expect(evaluateFlag(flag("on"), { tier: "free" })).toBe(true);
  });

  it("'founder-only' admits only founders", () => {
    expect(evaluateFlag(flag("founder-only"), { isFounder: true })).toBe(true);
    expect(evaluateFlag(flag("founder-only"), { userId: "u1", tier: "scale" })).toBe(false);
  });

  it("'beta' admits founders and listed users only", () => {
    const f = flag("beta", { betaUserIds: ["u1"] });
    expect(evaluateFlag(f, { userId: "u1" })).toBe(true);
    expect(evaluateFlag(f, { userId: "u2" })).toBe(false);
    expect(evaluateFlag(f, { isFounder: true })).toBe(true);
  });

  it("'tier:X' admits exactly that tier (plus founders)", () => {
    expect(evaluateFlag(flag("tier:pro"), { tier: "pro" })).toBe(true);
    expect(evaluateFlag(flag("tier:pro"), { tier: "free" })).toBe(false);
    expect(evaluateFlag(flag("tier:pro"), { isFounder: true })).toBe(true);
  });
});

describe("resolveRouteEnabled precedence (client nav)", () => {
  const FROZEN: FeatureFlagsResponse = {
    enabledKeys: [],
    enabledRoutes: [],
    disabledKeys: ["feature_marketplace", "feature_academy"],
    disabledRoutes: ["/marketplace", "/academy"],
  };

  it("full freeze: deny-listed doors hide even when the enabled list is empty", () => {
    expect(resolveRouteEnabled(FROZEN, "/marketplace")).toBe(false);
    expect(resolveRouteEnabled(FROZEN, "/academy")).toBe(false);
    expect(resolveFlagEnabled(FROZEN, "feature_marketplace")).toBe(false);
  });

  it("full freeze: un-flagged core doors stay visible", () => {
    expect(resolveRouteEnabled(FROZEN, "/leads")).toBe(true);
    expect(resolveRouteEnabled(FROZEN, "/deals")).toBe(true);
  });

  it("no data (loading/unauthenticated/error) shows everything", () => {
    expect(resolveRouteEnabled(undefined, "/marketplace")).toBe(true);
  });

  it("legacy server without deny-lists keeps historical behavior", () => {
    const legacy: FeatureFlagsResponse = { enabledKeys: [], enabledRoutes: [] };
    expect(resolveRouteEnabled(legacy, "/marketplace")).toBe(true);
    const partial: FeatureFlagsResponse = {
      enabledKeys: ["feature_avm"],
      enabledRoutes: ["/avm"],
    };
    expect(resolveRouteEnabled(partial, "/avm")).toBe(true);
    expect(resolveRouteEnabled(partial, "/marketplace")).toBe(false);
  });

  it("enabled wins only when not denied", () => {
    const conflicted: FeatureFlagsResponse = {
      enabledKeys: ["feature_avm"],
      enabledRoutes: ["/avm"],
      disabledKeys: ["feature_avm"],
      disabledRoutes: ["/avm"],
    };
    expect(resolveRouteEnabled(conflicted, "/avm")).toBe(false);
  });
});
