import { describe, it, expect, beforeEach } from "vitest";
import { getHand, executeHandWitnessed } from "../../server/services/autopilot/hands";
import { executeDispatchTool } from "../../server/services/solene/dispatchToolExecutor";
import {
  registerAdProvider,
  __resetAdProvidersForTest,
} from "../../server/services/autopilot/adProvider";
import { AD_DAILY_BUDGET_CEILING_CENTS } from "../../server/services/autopilot/hands/run-ad-campaign";

const validSpec = {
  platform: "meta",
  objective: "leads",
  audience: "land investors",
  creative: "honest copy",
  daily_budget_cents: 2000,
};

describe("growth limb — run_ad_campaign (highest blast radius)", () => {
  beforeEach(() => __resetAdProvidersForTest());

  it("is registered: growth domain, broadcast, approval-required", () => {
    const h = getHand("run_ad_campaign");
    expect(h?.domain).toBe("growth");
    expect(h?.outwardClass).toBe("broadcast");
    expect(h?.requiresApproval).toBe(true);
  });

  it("the executor refuses a direct model call (witnessed-send wall)", async () => {
    const r = await executeDispatchTool("run_ad_campaign", validSpec);
    expect(r.success).toBe(false);
    expect(r.output).toContain("WITNESSED-SEND");
  });

  it("is dormant by ABSENCE: with no provider wired, spends nothing (draft-only)", async () => {
    const r = await executeHandWitnessed("run_ad_campaign", validSpec, "founder_1");
    expect(r.success).toBe(false);
    expect(r.output).toContain("no ad provider configured");
  });

  it("refuses a daily budget over the $50/day ceiling even when witnessed", async () => {
    const r = await executeHandWitnessed(
      "run_ad_campaign",
      { ...validSpec, daily_budget_cents: AD_DAILY_BUDGET_CEILING_CENTS + 1 },
      "founder_1",
    );
    expect(r.success).toBe(false);
    expect(r.output).toContain("ceiling");
  });

  it("launches through a registered provider within the ceiling", async () => {
    registerAdProvider({
      platform: "meta",
      launch: async () => ({ success: true, draftOnly: false, campaignId: "camp_1" }),
    });
    const r = await executeHandWitnessed("run_ad_campaign", validSpec, "founder_1");
    expect(r.success).toBe(true);
    expect(r.output).toContain("camp_1");
  });
});
