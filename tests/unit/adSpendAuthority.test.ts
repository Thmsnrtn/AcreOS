/**
 * Any member of any org could buy ads on AcreOS's own ad account.
 *
 * `POST /api/meta-ads/campaigns` (as it was then named) took `dailyBudgetCents` from the request body
 * and handed it to `metaAdsService.createLandListingCampaign`, which POSTs
 * `daily_budget` to `graph.facebook.com/v21.0` against **META_AD_ACCOUNT_ID
 * with META_ACCESS_TOKEN** — one platform ad account for every organization.
 *
 * It was gated by `[isAuthenticated, getOrCreateOrg]` and nothing else. No
 * founder gate, no cap, no credit deduction, and **no simulation guard** —
 * every other outbound rail in this repo checks `shouldSimulate` first, and
 * `ads` was not even a category, so a dev, CI or staging boot with those env
 * vars present would have bought real advertising.
 *
 * THE FOUNDER HAD ALREADY RULED ON THIS EXACT SHAPE, IN THIS FILE.
 * ---------------------------------------------------------------
 * Twenty lines below the ads routes sits a comment block recording the
 * 2026-07-29 deletion of the ACTUM ACH endpoints, under "be the rail, not the
 * provider": they used **one platform ACTUM_MERCHANT_ID for all orgs**, so
 * customer money would have moved on AcreOS's own merchant account.
 *
 * The Meta ads routes are the same pattern — one platform account for all orgs
 * — and were never brought under the same ruling. That is the shape units 30–46
 * kept finding (a rule applied to some surfaces and not others), at the highest
 * stakes in the repository: this one is denominated in dollars per day.
 *
 * WHAT THIS DID, AND WHAT THE FOUNDER THEN RULED
 * ---------------------------------------------
 * Unit 50 gated, capped and simulation-guarded these routes — **not deleted**,
 * because the ACTUM precedent says deletion is how the founder makes that call.
 * BLOCKERS B11 carried the open question: platform activity, or customer feature?
 *
 * **Answered 2026-08-13:** *"this was meant for me as the founder to run ads for
 * this AcreOS only. Never for a customer to be able to run their own ads."* So
 * the interim gate is permanent, the routes moved to `/api/founder/meta-ads/*`,
 * and the paths below moved with them.
 *
 * DIVISION OF LABOUR with `metaAdsFounderOnly.test.ts`, which arrived with that
 * ruling: **this file is about the SPEND** — that it is bounded, simulated by
 * default, and made against the platform's own account. That file is about the
 * RULE — that all three routes are founder-only (including the stats read, which
 * this file never checked and which was ungated until the ruling), that they live
 * in the founder namespace, that no client bundle reaches them, and that the
 * public lead webhook verifies its signature fail-closed.
 *
 * The ceiling is $500/day, the same figure as the constitution's founder-only
 * spend hard-stop, deliberately. The founder gate does not make the cap
 * redundant: the hard-stop reads "spends >$500 are founder-only", not "spends
 * are unbounded once a founder is on the call", and a typo in a cents field is
 * three orders of magnitude away from its intent.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/** Line-based comment stripping. See destructivePermissionCoverage for why. */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    let s = line;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) { out.push(""); continue; }
      s = s.slice(end + 2);
      inBlock = false;
    }
    const open = s.indexOf("/*");
    if (open > -1) {
      const close = s.indexOf("*/", open + 2);
      if (close > -1) s = s.slice(0, open) + s.slice(close + 2);
      else if (/^\s*\{?\s*\/\*/.test(s)) { s = s.slice(0, open); inBlock = true; }
    }
    out.push(s.replace(/(^|[^:])\/\/.*$/, "$1"));
  }
  if (inBlock) throw new Error("stripComments ran away — assertions would be meaningless.");
  return out.join("\n");
}

const elite = stripComments(
  fs.readFileSync(path.join(ROOT, "server/routes-elite-features.ts"), "utf8"),
);
const service = stripComments(
  fs.readFileSync(path.join(ROOT, "server/services/metaAdsService.ts"), "utf8"),
);
const simMode = stripComments(
  fs.readFileSync(path.join(ROOT, "server/utils/simulationMode.ts"), "utf8"),
);

/** One route's registration line — the middleware chain, not the whole body. */
function registration(src: string, marker: string): string {
  const at = src.indexOf(marker);
  expect(at, `${marker} not found — renamed?`).toBeGreaterThan(-1);
  const end = src.indexOf("\n", at);
  return end === -1 ? src.slice(at) : src.slice(at, end);
}

describe("spending on the platform ad account is founder-only", () => {
  it("the routes still exist (vacuity guard)", () => {
    expect(elite).toContain('app.post("/api/founder/meta-ads/campaigns"');
    expect(elite).toContain('app.post("/api/founder/meta-ads/sync-catalog"');
  });

  it("campaign creation requires the founder", () => {
    expect(
      registration(elite, 'app.post("/api/founder/meta-ads/campaigns"'),
      "any authenticated member of any org can buy ads on the platform account again",
    ).toContain("requireFounder");
  });

  it("catalog sync requires the founder", () => {
    // Same platform account, same token.
    expect(registration(elite, 'app.post("/api/founder/meta-ads/sync-catalog"')).toContain(
      "requireFounder",
    );
  });

  it("the account really is the PLATFORM's, not the org's", () => {
    // The whole basis for founder-gating. If this ever reads an org-connected
    // ad account, the gate is the wrong instrument and should be revisited
    // rather than left in place out of habit.
    expect(service).toContain("META_AD_ACCOUNT_ID");
    expect(service).toContain("META_ACCESS_TOKEN");
    expect(
      /organizationIntegrations|getOrganizationIntegration/.test(service),
      "metaAdsService now resolves an org-connected ad account — the founder " +
        "gate was justified by the account being the PLATFORM's. Revisit it.",
    ).toBe(false);
  });
});

describe("the budget has a ceiling", () => {
  it("a cap constant exists and is a real number", () => {
    const m = /const MAX_DAILY_AD_BUDGET_CENTS = ([\d_]+);/.exec(elite);
    expect(m, "MAX_DAILY_AD_BUDGET_CENTS is gone").not.toBeNull();
    const cents = Number(m![1].replace(/_/g, ""));
    expect(cents).toBeGreaterThan(0);
    // $500/day — the constitution's founder-only spend hard-stop. A ceiling
    // far above it would be decorative, and this file would be reporting a
    // bounded spend that is not bounded.
    expect(cents, "the daily ad ceiling exceeds the $500 hard-stop figure")
      .toBeLessThanOrEqual(50_000);
  });

  it("the budget is validated as a positive integer before it is spent", () => {
    const at = elite.indexOf('app.post("/api/founder/meta-ads/campaigns"');
    const handler = elite.slice(at, at + 2500);
    expect(handler).toContain("Number.isInteger(budget)");
    expect(handler).toMatch(/budget\s*>\s*MAX_DAILY_AD_BUDGET_CENTS/);
    // Before the service call, not after it.
    expect(
      handler.indexOf("MAX_DAILY_AD_BUDGET_CENTS"),
      "the ceiling is checked after the campaign is created",
    ).toBeLessThan(handler.indexOf("createLandListingCampaign("));
  });
});

describe("ads are a simulated category, like every other spend rail", () => {
  it("`ads` is in the category union", () => {
    expect(
      simMode,
      "ads is not a SimulatedCategory — the one rail that literally buys things " +
        "would have no kill-switch",
    ).toMatch(/\|\s*"ads"/);
  });

  it("`ads` is simulated by default under global simulation mode", () => {
    // stripe, lob, sms, email and webhooks are all in the default set. A spend
    // rail outside it is one env var away from buying ads from CI.
    const at = simMode.indexOf("GLOBAL_SIM_CATEGORIES");
    expect(at).toBeGreaterThan(-1);
    const block = simMode.slice(at, simMode.indexOf("]);", at));
    expect(block, "ads is not in the global default simulated set").toContain('"ads"');
  });

  it("the service checks it BEFORE reading the account id", () => {
    // `getAdAccountId()` throws when the env var is absent, so a guard placed
    // after it would never run in exactly the environments that most need it.
    const at = service.indexOf("export async function createLandListingCampaign");
    const body = service.slice(at, at + 3000);
    expect(body).toContain('shouldSimulate("ads"');
    expect(
      body.indexOf('shouldSimulate("ads"'),
      "the simulation guard runs after getAdAccountId(), which throws first",
    ).toBeLessThan(body.indexOf("getAdAccountId()"));
  });

  it("a simulated run returns nulls, not invented campaign ids", () => {
    // Fabricating plausible ids would be the no-fabrication rule broken at the
    // worst possible place: a caller could not tell a real campaign from a
    // suppressed one and would poll stats for an ad that does not exist.
    const at = service.indexOf("export async function createLandListingCampaign");
    const body = service.slice(at, at + 3000);
    expect(body).toMatch(/simulated:\s*true,\s*campaignId:\s*null/);
    expect(body).toContain("recordSimulatedAction(");
  });
});

describe("the precedent this was measured against is still in the file", () => {
  it("the ACTUM deletion note survives", () => {
    // The founder ruling that makes this a rule-application rather than a
    // product opinion: one platform merchant account for all orgs, deleted.
    // If this note is ever removed, the justification above loses its anchor.
    const raw = fs.readFileSync(path.join(ROOT, "server/routes-elite-features.ts"), "utf8");
    expect(raw).toContain("be the rail, not the provider");
    expect(raw).toContain("ACTUM_MERCHANT_ID");
  });
});
