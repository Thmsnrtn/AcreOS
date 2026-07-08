/**
 * Tests for the Meta ad provider (step-away gap #7 — the first real limb).
 *
 * Coverage:
 *  - mapMetaObjective (pure) routes to the right OUTCOME_* enums
 *  - not connected → honest draft-only, no network call
 *  - connected without an ad account id → honest draft-only
 *  - happy path creates the campaign PAUSED with HOUSING special-ad-category
 *    and the daily budget bound, against the right ad account
 *  - a Meta rejection surfaces as a non-draft failure with detail
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const VALUES = new Map<string, string>();
vi.mock("../../connections/platformConnections", () => ({
  resolveConnectionValue: async (provider: string, field: string) => VALUES.get(`${provider}.${field}`) ?? null,
}));

const FETCHES: Array<{ url: string; body: URLSearchParams }> = [];
let fetchResponse: { ok: boolean; json?: unknown; text?: string; status?: number } = { ok: true, json: { id: "camp_1" } };
const originalFetch = globalThis.fetch;

import { metaAdProvider, mapMetaObjective } from "./metaAdProvider";

beforeEach(() => {
  VALUES.clear();
  FETCHES.length = 0;
  fetchResponse = { ok: true, json: { id: "camp_1" } };
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    FETCHES.push({ url: String(url), body: new URLSearchParams(String(init?.body ?? "")) });
    return {
      ok: fetchResponse.ok,
      status: fetchResponse.status ?? (fetchResponse.ok ? 200 : 400),
      json: async () => fetchResponse.json ?? {},
      text: async () => fetchResponse.text ?? "",
    } as Response;
  }) as any;
  return () => {
    globalThis.fetch = originalFetch;
  };
});

const SPEC = {
  platform: "meta",
  objective: "lead generation for county guides",
  dailyBudgetCents: 500,
  audience: "land investors, US",
  creative: "County guide launch",
};

describe("mapMetaObjective (pure)", () => {
  it("routes by intent with a traffic default", () => {
    expect(mapMetaObjective("lead generation")).toBe("OUTCOME_LEADS");
    expect(mapMetaObjective("brand awareness")).toBe("OUTCOME_AWARENESS");
    expect(mapMetaObjective("drive signups")).toBe("OUTCOME_SALES");
    expect(mapMetaObjective("visit the site")).toBe("OUTCOME_TRAFFIC");
  });
});

describe("metaAdProvider.launch", () => {
  it("not connected → honest draft-only, zero network calls", async () => {
    const r = await metaAdProvider.launch(SPEC);
    expect(r.success).toBe(false);
    expect(r.draftOnly).toBe(true);
    expect(r.reason).toContain("not connected");
    expect(FETCHES).toHaveLength(0);
  });

  it("connected without an ad account id → honest draft-only", async () => {
    VALUES.set("meta_ads.oauth_access_token", "tok");
    const r = await metaAdProvider.launch(SPEC);
    expect(r.draftOnly).toBe(true);
    expect(r.reason).toContain("ad account");
    expect(FETCHES).toHaveLength(0);
  });

  it("creates the campaign PAUSED, housing-classed, budget-bound", async () => {
    VALUES.set("meta_ads.oauth_access_token", "tok");
    VALUES.set("meta_ads.ad_account_id", "987654");
    const r = await metaAdProvider.launch(SPEC);
    expect(r.success).toBe(true);
    expect(r.draftOnly).toBe(false);
    expect(r.campaignId).toBe("camp_1");
    expect(r.reason).toContain("PAUSED");
    expect(FETCHES).toHaveLength(1);
    expect(FETCHES[0].url).toContain("/act_987654/campaigns");
    const body = FETCHES[0].body;
    expect(body.get("status")).toBe("PAUSED");
    expect(body.get("special_ad_categories")).toContain("HOUSING");
    expect(body.get("daily_budget")).toBe("500");
    expect(body.get("objective")).toBe("OUTCOME_LEADS");
  });

  it("a Meta rejection surfaces as a non-draft failure with the detail", async () => {
    VALUES.set("meta_ads.oauth_access_token", "tok");
    VALUES.set("meta_ads.ad_account_id", "987654");
    fetchResponse = { ok: false, status: 400, text: "(#100) Invalid parameter" };
    const r = await metaAdProvider.launch(SPEC);
    expect(r.success).toBe(false);
    expect(r.draftOnly).toBe(false);
    expect(r.reason).toContain("HTTP 400");
    expect(r.reason).toContain("Invalid parameter");
  });
});
