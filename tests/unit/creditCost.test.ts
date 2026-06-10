/**
 * creditCost() — founder_settings override + fallback.
 *
 * Moved from shared/billing/credit-weights.test.ts when the helper moved to
 * server/services/creditCost.ts (Tier 1C boundary enforcement: shared/ must
 * not import server code, so the settings-aware half lives server-side).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CREDIT_WEIGHTS } from "../../shared/billing/credit-weights";

describe("creditCost — founder_settings override + fallback", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../../server/services/settings");
  });

  it("falls back to CREDIT_WEIGHTS when no founder_settings override is set", async () => {
    // Mock the settings module so getSetting returns the supplied fallback
    // (matching the production code path where no row exists at any scope).
    vi.doMock("../../server/services/settings", () => ({
      getSetting: async <T,>(_key: string, fallback: T) => fallback,
    }));

    const mod = await import("../../server/services/creditCost");
    const cost = await mod.creditCost("postcard_eddm");
    expect(cost).toBe(CREDIT_WEIGHTS.postcard_eddm); // 31
  });

  it("honors a founder_settings override when present", async () => {
    vi.doMock("../../server/services/settings", () => ({
      // Simulate a calibrated override at the global scope.
      getSetting: async (key: string, _fallback: unknown) => {
        if (key === "credits.weight.postcard_eddm") return 28;
        return _fallback;
      },
    }));

    const mod = await import("../../server/services/creditCost");
    const cost = await mod.creditCost("postcard_eddm");
    expect(cost).toBe(28);
  });

  it("ignores a malformed (non-numeric) override and uses the fallback", async () => {
    vi.doMock("../../server/services/settings", () => ({
      // founder_settings is JSONB, so a buggy write could yield a string.
      getSetting: async (key: string, _fallback: unknown) => {
        if (key === "credits.weight.sms_outbound") return "garbage";
        return _fallback;
      },
    }));

    const mod = await import("../../server/services/creditCost");
    const cost = await mod.creditCost("sms_outbound");
    expect(cost).toBe(CREDIT_WEIGHTS.sms_outbound); // 1
  });
});
