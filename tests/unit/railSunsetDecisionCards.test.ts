/**
 * 2026-07 usage-rail sunset — one-shot founder decision-card seed.
 *
 * Pins the same discipline as costDecisionCards: (1) the platform_settings
 * marker short-circuits the seed (an answered decision is never re-asked);
 * (2) a fresh boot creates exactly the two cards with tap options and nothing
 * that auto-executes; (3) the marker writes ONLY after both cards insert, so a
 * mid-seed failure retries next boot; (4) the seed never throws (boot-safe).
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

import { seedRailSunsetDecisionCards } from "../../server/services/railSunsetDecisionCards";

beforeEach(() => {
  markerRows = [];
  insertedSettings.length = 0;
  createDirectDecisionCard.mockClear();
  createDirectDecisionCard.mockImplementation(async () => ({ itemId: 1, created: true }));
});

describe("seedRailSunsetDecisionCards", () => {
  it("marker present → already_seeded, no cards created", async () => {
    markerRows = [{ id: 7 }];
    const result = await seedRailSunsetDecisionCards();
    expect(result).toBe("already_seeded");
    expect(createDirectDecisionCard).not.toHaveBeenCalled();
    expect(insertedSettings).toHaveLength(0);
  });

  it("fresh boot → exactly two cards, each with tap options, then the marker", async () => {
    const result = await seedRailSunsetDecisionCards();
    expect(result).toBe("seeded");
    expect(createDirectDecisionCard).toHaveBeenCalledTimes(2);

    const subjects = createDirectDecisionCard.mock.calls.map(
      (c: any[]) => (c[0] as { subject: string }).subject,
    );
    expect(subjects).toEqual([
      "Rail sunset order: which rails graduate to bring-your-own first?",
      "Free-taste allowance: what shape before bring-your-own kicks in?",
    ]);
    for (const call of createDirectDecisionCard.mock.calls) {
      const card = call[0] as { options: Array<{ key: string; label: string }> };
      expect(card.options.length).toBe(3);
    }

    expect(insertedSettings).toHaveLength(1);
    expect(insertedSettings[0].key).toBe("rail_sunset_2026_07.decision_cards_seeded");
  });

  it("card-creation failure → 'failed', marker NOT written (retries next boot)", async () => {
    createDirectDecisionCard.mockRejectedValueOnce(new Error("db down"));
    const result = await seedRailSunsetDecisionCards();
    expect(result).toBe("failed");
    expect(insertedSettings).toHaveLength(0);
  });

  it("never throws even when card creation explodes", async () => {
    markerRows = [];
    createDirectDecisionCard.mockRejectedValue(new Error("boom"));
    await expect(seedRailSunsetDecisionCards()).resolves.toBe("failed");
  });
});
