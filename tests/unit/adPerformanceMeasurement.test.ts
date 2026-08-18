/**
 * A measurement that failed is not a measurement of zero.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `getAdPerformance` caught every error from the Meta Insights API and returned
 * `{ impressions: 0, reach: 0, clicks: 0, leads: 0, spend: 0, cpl: 0, ctr: 0 }`.
 * Its only caller is the founder-only stats route, which passes the object
 * straight to `res.json()`.
 *
 * So an unreachable Meta API rendered as "0 impressions, 0 clicks, 0 leads, $0
 * spend" — indistinguishable from a campaign that genuinely delivered nothing,
 * and on the field that matters most it asserted the OPPOSITE of the dangerous
 * case: AcreOS's own ad account can be spending while this reports it spent
 * nothing. Paid advertising is a founder instrument spending AcreOS's own money
 * (CLAUDE.md, founder ruling 2026-08-13), and this is the surface the founder
 * reads it on.
 *
 * The route already had `catch (err) { Errors.internal(res, err) }`. Swallowing
 * the error in the service is what made that catch dead code for this path.
 *
 * ── WHERE IT CAME FROM ──────────────────────────────────────────────────────
 * Foundry §16 read once more from the measurement side, and AcreOS's own
 * standing rule: refuse, do not fabricate. No invented numbers, no placeholder
 * data presented as real (CLAUDE.md DO-NOT-DO list).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { getAdPerformance } from "../../server/services/metaAdsService";

const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.META_ACCESS_TOKEN ??= "test-token";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** Drive the real code path by answering its one outbound call. */
function mockMeta(resp: { ok: boolean; body: unknown }) {
  globalThis.fetch = vi.fn(async () => ({
    ok: resp.ok,
    json: async () => resp.body,
  })) as unknown as typeof fetch;
}

describe("an unreachable Meta API refuses instead of reporting zero", () => {
  it("THROWS RATHER THAN RETURNING $0 SPEND", async () => {
    mockMeta({ ok: false, body: { error: { message: "rate limited" } } });
    await expect(getAdPerformance("camp_1")).rejects.toThrow(/could not be measured/);
  });

  it("names the campaign and carries the upstream reason", async () => {
    // The founder needs to know WHICH campaign is unmeasured and why, or the
    // error is just a different kind of silence.
    mockMeta({ ok: false, body: { error: { message: "rate limited" } } });
    await expect(getAdPerformance("camp_42")).rejects.toThrow(/camp_42/);
    await expect(getAdPerformance("camp_42")).rejects.toThrow(/rate limited/);
  });

  it("throws when the transport itself fails", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ENOTFOUND graph.facebook.com");
    }) as unknown as typeof fetch;
    await expect(getAdPerformance("camp_1")).rejects.toThrow(/could not be measured/);
  });
});

describe("a real zero is still a real zero", () => {
  it("A SUCCESSFUL CALL WITH NO ROWS REPORTS ZEROS, AND DOES NOT THROW", () => {
    // The distinction the fix exists to draw. Over-correcting into "any zero is
    // suspicious" would delete a true answer: a campaign that delivered nothing
    // in the window genuinely has zero impressions.
    mockMeta({ ok: true, body: { data: [] } });
    return expect(getAdPerformance("camp_1")).resolves.toMatchObject({
      campaignId: "camp_1",
      impressions: 0,
      spend: 0,
      leads: 0,
    });
  });

  it("reports real figures when the API answers", async () => {
    // Vacuity guard: a function that always threw would satisfy the first
    // describe entirely.
    mockMeta({
      ok: true,
      body: {
        data: [{
          impressions: "1000",
          reach: "800",
          clicks: "50",
          spend: "125.50",
          actions: [{ action_type: "lead", value: "5" }],
        }],
      },
    });
    const stats = await getAdPerformance("camp_1");
    expect(stats.impressions).toBe(1000);
    expect(stats.clicks).toBe(50);
    expect(stats.leads).toBe(5);
    expect(stats.spend).toBeCloseTo(125.5);
    expect(stats.cpl).toBeCloseTo(25.1);
    expect(stats.ctr).toBeCloseTo(5);
  });
});

describe("the route's error path is no longer dead", () => {
  it("the founder stats route still catches and answers", async () => {
    // The service throwing only helps because the caller handles it. Before the
    // fix this catch could not fire for this path.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/routes-elite-features.ts"),
      "utf8",
    );
    const at = src.indexOf('"/api/founder/meta-ads/campaigns/:campaignId/stats"');
    expect(at, "the founder stats route moved — re-adjudicate").toBeGreaterThan(0);
    const handler = src.slice(at, at + 600);
    expect(handler).toContain("getAdPerformance");
    expect(handler, "the route no longer answers the failure").toContain("Errors.internal");
  });
});
