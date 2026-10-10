/**
 * The retention worker is briefed only on customers it may still act on.
 *
 * Found in the simulated year (2026-10-10): the briefing listed an org that had
 * already been sent a win-back email this week. email_customer refuses that
 * org, so the run ended "empty_result". That counted as the support domain's
 * failure and demoted it to DRAFT, after which every support move asked the
 * founder again. An org already emailed for its kind is now left out; when
 * nothing actionable remains, the briefing has 0 items, so the run is "no_work"
 * (nobody's failure) rather than a failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  atRisk: [] as Array<Record<string, unknown>>,
  emailed: new Set<number>(),
  probes: 0,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/utils/orgScopedDb", () => ({
  unscopedForPlatformOps: () => {
    const chain: any = {
      execute: async () => ({ rows: H.atRisk }),
      select: () => chain,
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      // recentlyEmailed is asked once per at-risk org, in list order.
      limit: async () => {
        const org = Number(H.atRisk[H.probes++]?.id);
        return H.emailed.has(org) ? [{ id: 1 }] : [];
      },
    };
    return chain;
  },
}));

const cancelled = (id: number) => ({ id, name: `Org ${id}`, dunning_stage: null, subscription_status: "canceled", subscription_tier: "pro", trial_ends_at: null, subscription_ended_at: new Date(), quiet: false });

describe("retention briefing", () => {
  beforeEach(() => {
    H.atRisk = [];
    H.emailed = new Set();
    H.probes = 0;
  });

  it("leaves out an org already emailed this week; keeps the one still actionable", async () => {
    const { buildBriefing } = await import("../../server/services/solene/roleWorkers/tools");
    H.atRisk = [cancelled(2), cancelled(3)];
    H.emailed = new Set([2]);
    const b = await buildBriefing("retention");
    expect(b.items).toBe(1);
    expect(b.text).toContain("Org #3");
    expect(b.text).not.toContain("Org #2");
  });

  it("with every at-risk org already emailed, the briefing has no items (no_work, not a failure)", async () => {
    const { buildBriefing } = await import("../../server/services/solene/roleWorkers/tools");
    H.atRisk = [cancelled(2)];
    H.emailed = new Set([2]);
    const b = await buildBriefing("retention");
    expect(b.items).toBe(0);
  });
});
