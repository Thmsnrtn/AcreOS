/**
 * 2026-07 open-data corpora — one-shot founder decision-card seed (ruling #10).
 *
 * Pins the same discipline as evaluationHorizonCards/railSunsetDecisionCards:
 * (1) the platform_settings marker short-circuits the seed (an answered
 * decision is never re-asked); (2) a fresh boot creates exactly ONE card with
 * the provision_now_r2 / provision_now_s3 / hold options and nothing that
 * auto-executes (actionPayload is null via createDirectDecisionCard — the
 * founder provisions bucket + keys manually, money/vendor being founder-only);
 * (3) the marker writes ONLY after the card inserts, so a mid-seed failure
 * retries next boot; (4) the seed never throws (boot-safe). Plus the honesty
 * constraint: the card must say plainly that nothing ingests until the
 * founder sets the keys, and that the pipeline is a follow-up PR.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const createDirectDecisionCard = vi.fn(async () => ({ itemId: 1, created: true }));
vi.mock("../../server/services/decisionsInbox", () => ({
  decisionsInboxService: {
    createDirectDecisionCard: (card: unknown) => createDirectDecisionCard(card),
  },
}));

let markerRows: Array<{ id: number }> = [];
const insertedSettings: Array<Record<string, unknown>> = [];

vi.mock("../../server/db", () => {
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [...markerRows]),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (v: Record<string, unknown>) => {
        insertedSettings.push(v);
      }),
    })),
  };
  return { db };
});

import { seedOpenDataCorporaDecisionCard } from "../../server/services/openData/corporaStatus";

interface SeededCard {
  subject: string;
  sophieAnalysis: string;
  recommendedAction: string;
  options: Array<{ key: string; label: string }>;
}

beforeEach(() => {
  markerRows = [];
  insertedSettings.length = 0;
  createDirectDecisionCard.mockClear();
  createDirectDecisionCard.mockImplementation(async () => ({ itemId: 1, created: true }));
});

describe("seedOpenDataCorporaDecisionCard", () => {
  it("marker present → already_seeded, no card created", async () => {
    markerRows = [{ id: 3 }];
    const result = await seedOpenDataCorporaDecisionCard();
    expect(result).toBe("already_seeded");
    expect(createDirectDecisionCard).not.toHaveBeenCalled();
    expect(insertedSettings).toHaveLength(0);
  });

  it("fresh boot → exactly one card, then the marker", async () => {
    const result = await seedOpenDataCorporaDecisionCard();
    expect(result).toBe("seeded");
    expect(createDirectDecisionCard).toHaveBeenCalledTimes(1);

    const card = createDirectDecisionCard.mock.calls[0][0] as unknown as SeededCard;
    expect(card.subject).toBe(
      "Own the open-data corpora — provision object storage (~$10–30/mo)",
    );

    expect(insertedSettings).toHaveLength(1);
    expect(insertedSettings[0].key).toBe("open_data_corpora_2026_07.decision_card_seeded");
  });

  it("carries the specced options and the R2 recommendation", async () => {
    await seedOpenDataCorporaDecisionCard();
    const card = createDirectDecisionCard.mock.calls[0][0] as unknown as SeededCard;
    expect(card.options.map((o) => o.key)).toEqual([
      "provision_now_r2",
      "provision_now_s3",
      "hold",
    ]);
    expect(card.recommendedAction).toBe("open_data_corpora_provision_now_r2");
  });

  it("analysis is honest: names what owning unlocks, the cost, and that NOTHING ingests until the founder sets the keys", async () => {
    await seedOpenDataCorporaDecisionCard();
    const card = createDirectDecisionCard.mock.calls[0][0] as unknown as SeededCard;
    // What it unlocks — the three concrete wins.
    expect(card.sophieAnalysis).toMatch(/change detection over time/i);
    expect(card.sophieAnalysis).toMatch(/faster lookups/i);
    expect(card.sophieAnalysis).toMatch(/independence from federal endpoint uptime/i);
    // What it costs.
    expect(card.sophieAnalysis).toMatch(/\$10–30 a month/);
    // The no-fabrication line: nothing ingests, keys are the founder's hands.
    expect(card.sophieAnalysis).toMatch(/Nothing ingests until you act/i);
    expect(card.sophieAnalysis).toContain("OPEN_DATA_BUCKET_*");
    expect(card.sophieAnalysis).toMatch(/not_provisioned/);
    // The pipeline itself is a follow-up build, reviewed as a PR.
    expect(card.sophieAnalysis).toMatch(/follow-up build you'll see in a PR/i);
  });

  it("nothing auto-executes: the seed passes no actionPayload (createDirectDecisionCard hard-codes it null)", async () => {
    await seedOpenDataCorporaDecisionCard();
    const raw = createDirectDecisionCard.mock.calls[0][0] as Record<string, unknown>;
    expect("actionPayload" in raw).toBe(false);
  });

  it("card-creation failure → 'failed', marker NOT written (retries next boot)", async () => {
    createDirectDecisionCard.mockRejectedValueOnce(new Error("db down"));
    const result = await seedOpenDataCorporaDecisionCard();
    expect(result).toBe("failed");
    expect(insertedSettings).toHaveLength(0);
  });

  it("never throws even when card creation explodes", async () => {
    createDirectDecisionCard.mockRejectedValue(new Error("boom"));
    await expect(seedOpenDataCorporaDecisionCard()).resolves.toBe("failed");
  });
});
