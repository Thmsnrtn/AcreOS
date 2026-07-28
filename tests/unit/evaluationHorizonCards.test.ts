/**
 * 2026-07 evaluation horizon — one-shot founder decision-card seed.
 *
 * Pins the same discipline as railSunsetDecisionCards: (1) the
 * platform_settings marker short-circuits the seed (an answered decision is
 * never re-asked); (2) a fresh boot creates exactly the two cards with tap
 * options and nothing that auto-executes; (3) the marker writes ONLY after
 * both cards insert, so a mid-seed failure retries next boot; (4) the seed
 * never throws (boot-safe). Plus the honesty constraint: because no
 * spend-triggered automatic outreach pause exists yet, the stop-loss card
 * must say plainly that answering records a ruling and the wiring is a
 * follow-up PR.
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

import { seedEvaluationHorizonCards } from "../../server/services/evaluationHorizonCards";

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

describe("seedEvaluationHorizonCards", () => {
  it("marker present → already_seeded, no cards created", async () => {
    markerRows = [{ id: 7 }];
    const result = await seedEvaluationHorizonCards();
    expect(result).toBe("already_seeded");
    expect(createDirectDecisionCard).not.toHaveBeenCalled();
    expect(insertedSettings).toHaveLength(0);
  });

  it("fresh boot → exactly two cards, then the marker", async () => {
    const result = await seedEvaluationHorizonCards();
    expect(result).toBe("seeded");
    expect(createDirectDecisionCard).toHaveBeenCalledTimes(2);

    const subjects = createDirectDecisionCard.mock.calls.map(
      (c: any[]) => (c[0] as SeededCard).subject,
    );
    expect(subjects).toEqual([
      "When do we judge the mail program — decide now, while it's calm",
      "The stop-loss shape — what pauses spending automatically",
    ]);

    expect(insertedSettings).toHaveLength(1);
    expect(insertedSettings[0].key).toBe("evaluation_horizon_2026_07.decision_cards_seeded");
  });

  it("horizon card carries the specced option keys and recommendation", async () => {
    await seedEvaluationHorizonCards();
    const horizon = createDirectDecisionCard.mock.calls[0][0] as unknown as SeededCard;
    expect(horizon.options.map((o) => o.key)).toEqual([
      "six_months",
      "spend_threshold",
      "both_whichever_first",
    ]);
    expect(horizon.recommendedAction).toBe("eval_horizon_both_whichever_first");
    // Pre-commitment framing: nothing changes today, only WHEN we evaluate.
    expect(horizon.sophieAnalysis).toContain("Nothing changes today");
    expect(horizon.sophieAnalysis).toContain("WHEN we evaluate");
  });

  it("stop-loss card: specced options, monthly-cap recommendation, no number picked", async () => {
    await seedEvaluationHorizonCards();
    const stopLoss = createDirectDecisionCard.mock.calls[1][0] as unknown as SeededCard;
    expect(stopLoss.options.map((o) => o.key)).toEqual([
      "monthly_cap_pause",
      "cumulative_cap_pause",
      "no_auto_pause",
    ]);
    expect(stopLoss.recommendedAction).toBe("stop_loss_shape_monthly_cap_pause");
    // Shape only — the founder sets the dollar line; the machine never picks it.
    expect(stopLoss.sophieAnalysis).toContain("no number");
    expect(stopLoss.sophieAnalysis).toContain("cost panel");
  });

  it("honesty constraint: stop-loss card admits no spend-triggered pause is wired yet", async () => {
    await seedEvaluationHorizonCards();
    const stopLoss = createDirectDecisionCard.mock.calls[1][0] as unknown as SeededCard;
    expect(stopLoss.sophieAnalysis).toContain(
      "Answering records your ruling; wiring the actual pause is a follow-up change you'll see in a PR before it's live.",
    );
  });

  it("card-creation failure → 'failed', marker NOT written (retries next boot)", async () => {
    createDirectDecisionCard.mockRejectedValueOnce(new Error("db down"));
    const result = await seedEvaluationHorizonCards();
    expect(result).toBe("failed");
    expect(insertedSettings).toHaveLength(0);
  });

  it("never throws even when card creation explodes", async () => {
    markerRows = [];
    createDirectDecisionCard.mockRejectedValue(new Error("boom"));
    await expect(seedEvaluationHorizonCards()).resolves.toBe("failed");
  });
});
