/**
 * agentCodenameAlias tests.
 *
 * Covers:
 *   - Canonical passthrough: every canonical codename resolves to itself,
 *     wasAlias=false.
 *   - Legacy default mapping: each legacy → expected canonical default.
 *   - Action-aware override: forge_revenue / forge + churn/risk actions →
 *     maren; non-override actions stay on the default (soren).
 *   - Unknown codename → iris fallback, wasAlias=true, rationale.
 *   - Type guards: isCanonicalCodename / isLegacyCodename behave correctly.
 *   - getAliasUsageStats counts up correctly and tracks override usage.
 *   - resetAliasUsageStats zeroes the counters + firstSeenAt.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveCodename,
  isCanonicalCodename,
  isLegacyCodename,
  getAliasUsageStats,
  resetAliasUsageStats,
} from "./agentCodenameAlias";
import { CANONICAL_AGENT_CODENAMES } from "@shared/schema/agent-codenames";

describe("agentCodenameAlias", () => {
  beforeEach(() => {
    resetAliasUsageStats();
  });

  // ─── Canonical passthrough ────────────────────────────────────────────────

  describe("canonical passthrough", () => {
    it("returns canonical codenames unchanged with wasAlias=false", () => {
      for (const canonical of CANONICAL_AGENT_CODENAMES) {
        const result = resolveCodename({ requestedCodename: canonical });
        expect(result.canonical).toBe(canonical);
        expect(result.wasAlias).toBe(false);
        expect(result.legacyCodename).toBeUndefined();
        expect(result.rationale).toBe("canonical_passthrough");
      }
    });

    it("does not increment stats on canonical passthrough", () => {
      resolveCodename({ requestedCodename: "iris" });
      resolveCodename({ requestedCodename: "soren" });
      const stats = getAliasUsageStats();
      expect(stats.totalResolutions).toBe(0);
      expect(stats.firstSeenAt).toBeNull();
    });
  });

  // ─── Legacy default mapping ───────────────────────────────────────────────

  describe("legacy default mapping", () => {
    it("atlas_cto → iris", () => {
      const result = resolveCodename({ requestedCodename: "atlas_cto" });
      expect(result.canonical).toBe("iris");
      expect(result.wasAlias).toBe(true);
      expect(result.legacyCodename).toBe("atlas_cto");
      expect(result.rationale).toBe("default_alias");
    });

    it("atlas → iris", () => {
      const result = resolveCodename({ requestedCodename: "atlas" });
      expect(result.canonical).toBe("iris");
      expect(result.legacyCodename).toBe("atlas");
    });

    it("sophie_csm → rafe", () => {
      const result = resolveCodename({ requestedCodename: "sophie_csm" });
      expect(result.canonical).toBe("rafe");
      expect(result.legacyCodename).toBe("sophie_csm");
    });

    it("sophie → rafe", () => {
      const result = resolveCodename({ requestedCodename: "sophie" });
      expect(result.canonical).toBe("rafe");
    });

    it("forge_revenue → soren (default, no action)", () => {
      const result = resolveCodename({ requestedCodename: "forge_revenue" });
      expect(result.canonical).toBe("soren");
      expect(result.rationale).toBe("default_alias");
    });

    it("forge → soren (default, no action)", () => {
      const result = resolveCodename({ requestedCodename: "forge" });
      expect(result.canonical).toBe("soren");
    });

    it("oracle → iris (Iyari dormant until Phase 3)", () => {
      const result = resolveCodename({ requestedCodename: "oracle" });
      expect(result.canonical).toBe("iris");
      expect(result.legacyCodename).toBe("oracle");
    });

    // Step-4 completions (2026-07-14): every companyAgents roster codename
    // resolves as a REAL alias — none silently falls through to the
    // unknown→iris fallback anymore. Pins the full 12/12 bridge.
    it.each([
      ["beacon_marketing", "soren"],
      ["sentinel_devops", "iris"],
      ["ledger_finance", "lena"],
      ["shield_legal", "beatrice"],
      ["oracle_analytics", "iris"],
      ["compass_pm", "maren"],
      ["crucible_qa", "krieger"],
      ["prism_ux", "krieger"],
      ["scribe_content", "soren"],
    ] as const)("%s → %s (step-4 bridge, default_alias not fallback)", (legacy, canonical) => {
      const result = resolveCodename({ requestedCodename: legacy });
      expect(result.canonical).toBe(canonical);
      expect(result.wasAlias).toBe(true);
      expect(result.legacyCodename).toBe(legacy);
      expect(result.rationale).toBe("default_alias");
    });
  });

  // ─── Action-aware overrides ───────────────────────────────────────────────

  describe("action-aware overrides", () => {
    it("forge_revenue + send_churn_intervention → maren", () => {
      const result = resolveCodename({
        requestedCodename: "forge_revenue",
        actionName: "send_churn_intervention",
      });
      expect(result.canonical).toBe("maren");
      expect(result.wasAlias).toBe(true);
      expect(result.legacyCodename).toBe("forge_revenue");
      expect(result.rationale).toBe("action_override");
    });

    it("forge + flag_deal_risk → maren", () => {
      const result = resolveCodename({
        requestedCodename: "forge",
        actionName: "flag_deal_risk",
      });
      expect(result.canonical).toBe("maren");
      expect(result.rationale).toBe("action_override");
    });

    it("forge_revenue + send_alert → soren (override defined, points to soren)", () => {
      const result = resolveCodename({
        requestedCodename: "forge_revenue",
        actionName: "send_alert",
      });
      expect(result.canonical).toBe("soren");
      expect(result.rationale).toBe("action_override");
    });

    it("forge_revenue + escalate_to_founder → soren (override)", () => {
      const result = resolveCodename({
        requestedCodename: "forge_revenue",
        actionName: "escalate_to_founder",
      });
      expect(result.canonical).toBe("soren");
      expect(result.rationale).toBe("action_override");
    });

    it("forge_revenue + unrelated_action → soren (default, no override)", () => {
      const result = resolveCodename({
        requestedCodename: "forge_revenue",
        actionName: "some_random_action",
      });
      expect(result.canonical).toBe("soren");
      expect(result.rationale).toBe("default_alias");
    });

    it("sophie_csm + any action → rafe (no overrides defined for sophie)", () => {
      const result = resolveCodename({
        requestedCodename: "sophie_csm",
        actionName: "send_churn_intervention",
      });
      expect(result.canonical).toBe("rafe");
      expect(result.rationale).toBe("default_alias");
    });
  });

  // ─── Unknown codename fallback ────────────────────────────────────────────

  describe("unknown codename fallback", () => {
    it("unknown codename → iris with unknown_codename_fallback rationale", () => {
      const result = resolveCodename({ requestedCodename: "ghost_agent" });
      expect(result.canonical).toBe("iris");
      expect(result.wasAlias).toBe(true);
      expect(result.legacyCodename).toBeUndefined();
      expect(result.rationale).toBe("unknown_codename_fallback");
    });

    it("empty string → iris fallback", () => {
      const result = resolveCodename({ requestedCodename: "" });
      expect(result.canonical).toBe("iris");
      expect(result.rationale).toBe("unknown_codename_fallback");
    });

    it("unknown codename does not increment legacy stats", () => {
      resolveCodename({ requestedCodename: "ghost_agent" });
      const stats = getAliasUsageStats();
      expect(stats.totalResolutions).toBe(0);
    });
  });

  // ─── Type guards ──────────────────────────────────────────────────────────

  describe("type guards", () => {
    it("isCanonicalCodename returns true for canonical codenames", () => {
      expect(isCanonicalCodename("iris")).toBe(true);
      expect(isCanonicalCodename("solene")).toBe(true);
      expect(isCanonicalCodename("maren")).toBe(true);
      expect(isCanonicalCodename("henrik")).toBe(true);
    });

    it("isCanonicalCodename returns false for legacy / unknown", () => {
      expect(isCanonicalCodename("atlas_cto")).toBe(false);
      expect(isCanonicalCodename("oracle")).toBe(false);
      expect(isCanonicalCodename("ghost")).toBe(false);
      expect(isCanonicalCodename("")).toBe(false);
    });

    it("isLegacyCodename returns true for legacy codenames", () => {
      expect(isLegacyCodename("atlas_cto")).toBe(true);
      expect(isLegacyCodename("atlas")).toBe(true);
      expect(isLegacyCodename("sophie_csm")).toBe(true);
      expect(isLegacyCodename("sophie")).toBe(true);
      expect(isLegacyCodename("forge_revenue")).toBe(true);
      expect(isLegacyCodename("forge")).toBe(true);
      expect(isLegacyCodename("oracle")).toBe(true);
    });

    it("isLegacyCodename returns false for canonical / unknown", () => {
      expect(isLegacyCodename("iris")).toBe(false);
      expect(isLegacyCodename("solene")).toBe(false);
      expect(isLegacyCodename("ghost")).toBe(false);
    });
  });

  // ─── Stats accumulation ───────────────────────────────────────────────────

  describe("getAliasUsageStats", () => {
    it("counts legacy resolutions across multiple calls", () => {
      resolveCodename({ requestedCodename: "atlas_cto" });
      resolveCodename({ requestedCodename: "atlas_cto" });
      resolveCodename({ requestedCodename: "sophie_csm" });
      resolveCodename({ requestedCodename: "forge_revenue" });

      const stats = getAliasUsageStats();
      expect(stats.totalResolutions).toBe(4);
      expect(stats.byLegacyCodename.atlas_cto).toBe(2);
      expect(stats.byLegacyCodename.sophie_csm).toBe(1);
      expect(stats.byLegacyCodename.forge_revenue).toBe(1);
    });

    it("tracks action-override usage separately", () => {
      resolveCodename({
        requestedCodename: "forge_revenue",
        actionName: "send_churn_intervention",
      });
      resolveCodename({
        requestedCodename: "forge",
        actionName: "flag_deal_risk",
      });
      resolveCodename({
        requestedCodename: "forge_revenue",
        actionName: "send_churn_intervention",
      });

      const stats = getAliasUsageStats();
      expect(stats.byActionOverride["forge_revenue:send_churn_intervention"]).toBe(2);
      expect(stats.byActionOverride["forge:flag_deal_risk"]).toBe(1);
    });

    it("sets firstSeenAt on first legacy resolution", () => {
      expect(getAliasUsageStats().firstSeenAt).toBeNull();
      resolveCodename({ requestedCodename: "atlas_cto" });
      const stats = getAliasUsageStats();
      expect(stats.firstSeenAt).toBeInstanceOf(Date);
    });

    it("firstSeenAt does not move on subsequent legacy resolutions", () => {
      resolveCodename({ requestedCodename: "atlas_cto" });
      const first = getAliasUsageStats().firstSeenAt;
      resolveCodename({ requestedCodename: "sophie_csm" });
      const second = getAliasUsageStats().firstSeenAt;
      expect(second?.getTime()).toBe(first?.getTime());
    });

    it("returns a defensive copy that does not mutate internal state", () => {
      resolveCodename({ requestedCodename: "atlas_cto" });
      const snapshot = getAliasUsageStats();
      snapshot.totalResolutions = 999;
      snapshot.byLegacyCodename.atlas_cto = 999;
      const fresh = getAliasUsageStats();
      expect(fresh.totalResolutions).toBe(1);
      expect(fresh.byLegacyCodename.atlas_cto).toBe(1);
    });
  });

  // ─── Reset ────────────────────────────────────────────────────────────────

  describe("resetAliasUsageStats", () => {
    it("zeroes all counters and firstSeenAt", () => {
      resolveCodename({ requestedCodename: "atlas_cto" });
      resolveCodename({
        requestedCodename: "forge_revenue",
        actionName: "send_churn_intervention",
      });
      expect(getAliasUsageStats().totalResolutions).toBeGreaterThan(0);

      resetAliasUsageStats();

      const stats = getAliasUsageStats();
      expect(stats.totalResolutions).toBe(0);
      expect(stats.byLegacyCodename).toEqual({});
      expect(stats.byActionOverride).toEqual({});
      expect(stats.firstSeenAt).toBeNull();
    });
  });
});
