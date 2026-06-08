/**
 * RAFE (P0) — detractor NPS founder alert.
 *
 * Our whole CS identity is "every detractor is a same-day call." Proves that
 * notifyFounderOfDetractor() writes a founder-visible `system_alerts` row on a
 * score ≤6, with the VERBATIM comment attached and severity scaled by score,
 * and that promoters/passives (>6) write nothing.
 *
 * db is mocked: the helper does
 *   db.select().from().where().limit()   → the org name
 *   db.insert().values()                 → the alert row
 * We capture the inserted row to assert on it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const inserted: Array<Record<string, unknown>> = [];

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [{ name: "Cedar Hollow Land Co." }]),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (v: Record<string, unknown>) => {
        inserted.push(v);
        return undefined;
      }),
    })),
  };

  return {
    db,
    inserted,
    reset: () => {
      inserted.length = 0;
    },
  };
});

vi.mock("../../server/db", () => ({ db: mocks.db }));

import { notifyFounderOfDetractor } from "../../server/services/supportNotifications";

describe("notifyFounderOfDetractor", () => {
  beforeEach(() => mocks.reset());
  afterEach(() => vi.clearAllMocks());

  it("writes a founder alert with the verbatim comment on a detractor score (3)", async () => {
    await notifyFounderOfDetractor({
      orgId: 42,
      score: 3,
      comment: "your county data was wrong",
      surveyTrigger: "day_14",
    });

    expect(mocks.inserted).toHaveLength(1);
    const row = mocks.inserted[0];
    expect(row.type).toBe("nps_detractor");
    expect(row.alertType).toBe("high_churn");
    // ≤3 is critical
    expect(row.severity).toBe("critical");
    expect(row.organizationId).toBe(42);
    // verbatim comment must be in the human-readable message…
    expect(String(row.message)).toContain("your county data was wrong");
    // …and on the structured metadata
    expect((row.metadata as Record<string, unknown>).comment).toBe("your county data was wrong");
    expect((row.metadata as Record<string, unknown>).score).toBe(3);
    expect((row.metadata as Record<string, unknown>).surveyTrigger).toBe("day_14");
    expect(String(row.title)).toContain("Cedar Hollow Land Co.");
  });

  it("scales a 5 to warning (high), not critical", async () => {
    await notifyFounderOfDetractor({ orgId: 7, score: 5, comment: "slow" });
    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.inserted[0].severity).toBe("warning");
  });

  it("notes 'no comment' explicitly when feedback is empty", async () => {
    await notifyFounderOfDetractor({ orgId: 7, score: 2, comment: "   " });
    expect(mocks.inserted).toHaveLength(1);
    expect(String(mocks.inserted[0].message)).toContain("(no comment)");
    expect((mocks.inserted[0].metadata as Record<string, unknown>).comment).toBeNull();
  });

  it("writes NOTHING for a promoter/passive score (>6)", async () => {
    await notifyFounderOfDetractor({ orgId: 7, score: 9, comment: "love it" });
    await notifyFounderOfDetractor({ orgId: 7, score: 7 });
    expect(mocks.inserted).toHaveLength(0);
  });
});
