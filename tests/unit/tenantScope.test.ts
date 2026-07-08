import { describe, it, expect } from "vitest";
import {
  PLATFORM_SCOPE,
  orgScope,
  isPlatformScope,
  isOrgScope,
  scopeOrgId,
  describeScope,
  assertOutwardScope,
  type TenantScope,
} from "../../server/services/autopilot/tenantScope";

describe("TenantScope — the typed accountable scope (replaces overloaded orgId=null)", () => {
  it("PLATFORM_SCOPE is the platform operating itself, and is frozen", () => {
    expect(PLATFORM_SCOPE.kind).toBe("platform");
    expect(isPlatformScope(PLATFORM_SCOPE)).toBe(true);
    expect(isOrgScope(PLATFORM_SCOPE)).toBe(false);
    expect(Object.isFrozen(PLATFORM_SCOPE)).toBe(true);
  });

  it("orgScope builds an org scope and validates a positive integer id", () => {
    const s = orgScope(42);
    expect(s.kind).toBe("org");
    expect(isOrgScope(s)).toBe(true);
    if (isOrgScope(s)) expect(s.orgId).toBe(42);
    expect(() => orgScope(0)).toThrow();
    expect(() => orgScope(-1)).toThrow();
    expect(() => orgScope(1.5)).toThrow();
    expect(() => orgScope(NaN)).toThrow();
  });

  it("scopeOrgId maps platform → null and org → its id (the DB/cost-ceiling column)", () => {
    expect(scopeOrgId(PLATFORM_SCOPE)).toBeNull();
    expect(scopeOrgId(orgScope(7))).toBe(7);
  });

  it("describeScope is stable and log-safe", () => {
    expect(describeScope(PLATFORM_SCOPE)).toBe("platform");
    expect(describeScope(orgScope(7))).toBe("org:7");
  });

  describe("assertOutwardScope — the hard-error guard for outward actions", () => {
    it("permits platform scope (AcreOS operating itself)", () => {
      expect(() => assertOutwardScope(PLATFORM_SCOPE, "publish_guide")).not.toThrow();
    });
    it("permits a well-formed org scope", () => {
      expect(() => assertOutwardScope(orgScope(3), "send_email")).not.toThrow();
    });
    it("throws on a null/undefined scope (the old 'unscoped' case)", () => {
      expect(() => assertOutwardScope(null, "send_email")).toThrow(/no accountable scope/);
      expect(() => assertOutwardScope(undefined, "send_email")).toThrow(/no accountable scope/);
    });
    it("throws on a malformed org scope (corrupt orgId)", () => {
      const bad = { kind: "org", orgId: -5 } as unknown as TenantScope;
      expect(() => assertOutwardScope(bad, "run_ads")).toThrow(/malformed scope/);
    });
    it("throws on an unrecognized scope kind", () => {
      const bad = { kind: "everyone" } as unknown as TenantScope;
      expect(() => assertOutwardScope(bad, "run_ads")).toThrow(/malformed scope/);
    });
  });
});
