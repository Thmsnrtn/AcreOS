/**
 * Tests for the per-user Pax context service.
 *
 * Coverage matrix:
 *  - captureUserContext UPSERT (insert + update on conflict)
 *  - captureUserContext DB error → returns null, never throws
 *  - loadUserContext returns null when no row
 *  - loadUserContext fire-and-forget last_used_at update
 *  - buildUserScopedPromptAppendix(null) → land_investing default
 *  - buildUserScopedPromptAppendix(opted-out) → default (not the user data)
 *  - buildUserScopedPromptAppendix(opted-in) → persona+experience+goals+greeting
 *  - setPersonalizationOptOut toggles the flag
 *  - deleteUserContext hard-deletes
 *  - getContextDistribution aggregate counts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── In-memory row store ──────────────────────────────────────────────────
interface CtxRow {
  id: number;
  userId: string;
  organizationId: string;
  vertical: string | null;
  experienceLevel: string | null;
  investmentGoals: string[];
  geographicFocus: string | null;
  displayedName: string | null;
  capturedAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
  optedInPersonalization: boolean;
}

const ROWS: CtxRow[] = [];
let nextId = 1;
let forceInsertError = false;
let forceSelectError = false;
let forceUpdateError = false;
let forceDeleteError = false;

const lastUsedAtUpdateMock = vi.fn();

// ── db mock ──────────────────────────────────────────────────────────────
// The userContext service uses:
//   1. db.insert(t).values(v).onConflictDoUpdate({target, set}).returning()
//   2. db.select().from(t).where(eq(t.userId, x)).limit(1)
//   3. db.update(t).set(v).where(eq(t.userId, x))   [+ .catch chain on the
//      fire-and-forget last_used_at variant]
//   4. db.delete(t).where(eq(t.userId, x))
//   5. db.select({...}).from(t)   [distribution aggregate]
//
// We dispatch by call sequence + .where predicate inspection. drizzle's
// eq() returns an object — we mock it below to capture (col, val).

vi.mock("../../db", () => {
  const db = {
    insert: (_table: unknown) => ({
      values: (v: Partial<CtxRow>) => ({
        onConflictDoUpdate: (conf: { target: unknown; set: Partial<CtxRow> }) => ({
          returning: async () => {
            if (forceInsertError) throw new Error("simulated insert failure");
            const existing = ROWS.find((r) => r.userId === v.userId);
            if (existing) {
              Object.assign(existing, conf.set);
              return [existing];
            }
            const row: CtxRow = {
              id: nextId++,
              userId: v.userId!,
              organizationId: v.organizationId!,
              vertical: v.vertical ?? null,
              experienceLevel: v.experienceLevel ?? null,
              investmentGoals: v.investmentGoals ?? [],
              geographicFocus: v.geographicFocus ?? null,
              displayedName: v.displayedName ?? null,
              capturedAt: v.capturedAt ?? new Date(),
              updatedAt: v.updatedAt ?? new Date(),
              lastUsedAt: v.lastUsedAt ?? null,
              optedInPersonalization: v.optedInPersonalization ?? true,
            };
            ROWS.push(row);
            return [row];
          },
        }),
      }),
    }),
    select: (_projection?: unknown) => ({
      from: (_t: unknown) => {
        const step: any = {
          where: (pred: { _userId?: string }) => {
            step._userIdFilter = pred?._userId;
            return step;
          },
          limit: (_n: number) => step,
          then: (onF: any, onR: any) => {
            if (forceSelectError) {
              return Promise.reject(new Error("simulated select failure")).then(
                onF,
                onR,
              );
            }
            const all = ROWS.map((r) => ({ ...r }));
            const userId = step._userIdFilter;
            const rows = userId ? all.filter((r) => r.userId === userId) : all;
            return Promise.resolve(rows).then(onF, onR);
          },
          _userIdFilter: undefined as string | undefined,
        };
        return step;
      },
    }),
    update: (_t: unknown) => ({
      set: (values: Partial<CtxRow>) => ({
        where: (pred: { _userId?: string }) => {
          if (forceUpdateError) {
            return Promise.reject(new Error("simulated update failure"));
          }
          const row = ROWS.find((r) => r.userId === pred?._userId);
          if (row) Object.assign(row, values);
          // Distinguish the fire-and-forget last_used_at update so the
          // test can assert it fired without awaiting.
          if (values.lastUsedAt !== undefined) {
            lastUsedAtUpdateMock(pred?._userId, values.lastUsedAt);
          }
          // Allow .catch chaining for the fire-and-forget variant.
          const p: Promise<void> & { catch: (...args: any[]) => Promise<void> } =
            Promise.resolve() as any;
          return p;
        },
      }),
    }),
    delete: (_t: unknown) => ({
      where: (pred: { _userId?: string }) => {
        if (forceDeleteError) {
          return Promise.reject(new Error("simulated delete failure"));
        }
        const idx = ROWS.findIndex((r) => r.userId === pred?._userId);
        if (idx >= 0) ROWS.splice(idx, 1);
        return Promise.resolve();
      },
    }),
  };
  return { db };
});

// ── drizzle-orm operator mocks ───────────────────────────────────────────
// eq(col, val) — capture (col-name, val) so the db.where mock can filter.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (col: any, val: unknown) => {
      // The schema column object has a `.name` property in drizzle.
      // For our test we only ever filter by user_id, so capture it
      // regardless of the column shape.
      return { _userId: typeof val === "string" ? val : undefined };
    },
    sql: actual.sql,
  };
});

// ── Imports under test (after mocks) ─────────────────────────────────────
import {
  captureUserContext,
  loadUserContext,
  buildUserScopedPromptAppendix,
  setPersonalizationOptOut,
  deleteUserContext,
  getContextDistribution,
} from "./userContext";

// ── State reset ──────────────────────────────────────────────────────────
beforeEach(() => {
  ROWS.length = 0;
  nextId = 1;
  forceInsertError = false;
  forceSelectError = false;
  forceUpdateError = false;
  forceDeleteError = false;
  lastUsedAtUpdateMock.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────

describe("captureUserContext", () => {
  it("UPSERT inserts a new row when none exists", async () => {
    const out = await captureUserContext({
      userId: "user_a",
      organizationId: "org_1",
      vertical: "land_investing",
      experienceLevel: "intermediate",
      investmentGoals: ["cash_flow", "appreciation"],
      geographicFocus: "Texas Hill Country",
      displayedName: "Sam",
    });
    expect(out).not.toBeNull();
    expect(out?.userId).toBe("user_a");
    expect(out?.vertical).toBe("land_investing");
    expect(out?.experienceLevel).toBe("intermediate");
    expect(out?.investmentGoals).toEqual(["cash_flow", "appreciation"]);
    expect(out?.geographicFocus).toBe("Texas Hill Country");
    expect(out?.displayedName).toBe("Sam");
    expect(out?.optedInPersonalization).toBe(true);
    expect(ROWS).toHaveLength(1);
  });

  it("UPSERT updates the existing row on second call with same user_id", async () => {
    await captureUserContext({
      userId: "user_a",
      organizationId: "org_1",
      vertical: "land_investing",
      experienceLevel: "beginner",
      investmentGoals: ["learning"],
    });
    await captureUserContext({
      userId: "user_a",
      organizationId: "org_1",
      vertical: "notes",
      experienceLevel: "expert",
      investmentGoals: ["cash_flow"],
      geographicFocus: "Southeast US",
      displayedName: "Sam",
    });
    expect(ROWS).toHaveLength(1);
    expect(ROWS[0]?.vertical).toBe("notes");
    expect(ROWS[0]?.experienceLevel).toBe("expert");
    expect(ROWS[0]?.investmentGoals).toEqual(["cash_flow"]);
    expect(ROWS[0]?.geographicFocus).toBe("Southeast US");
    expect(ROWS[0]?.displayedName).toBe("Sam");
  });

  it("returns null on DB error and NEVER throws", async () => {
    forceInsertError = true;
    let threw = false;
    let result: unknown = "init";
    try {
      result = await captureUserContext({
        userId: "user_x",
        organizationId: "org_1",
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result).toBeNull();
  });

  it("silently drops unknown enum values rather than corrupting the DB", async () => {
    const out = await captureUserContext({
      userId: "user_b",
      organizationId: "org_1",
      // @ts-expect-error — simulating stale client sending a value the server
      // doesn't recognize.
      vertical: "crypto_bros",
      // @ts-expect-error — same as above for experience level.
      experienceLevel: "elite",
      // @ts-expect-error — mixed valid + invalid goals.
      investmentGoals: ["cash_flow", "moonshot"],
    });
    expect(out?.vertical).toBeNull();
    expect(out?.experienceLevel).toBeNull();
    expect(out?.investmentGoals).toEqual(["cash_flow"]);
  });
});

describe("loadUserContext", () => {
  it("returns null when no row exists for the user", async () => {
    const out = await loadUserContext("user_nope");
    expect(out).toBeNull();
  });

  it("returns the row when it exists", async () => {
    await captureUserContext({
      userId: "user_a",
      organizationId: "org_1",
      vertical: "land_investing",
      experienceLevel: "expert",
      investmentGoals: ["appreciation"],
      displayedName: "Sam",
      geographicFocus: "Texas",
    });
    const out = await loadUserContext("user_a");
    expect(out?.userId).toBe("user_a");
    expect(out?.vertical).toBe("land_investing");
    expect(out?.experienceLevel).toBe("expert");
    expect(out?.investmentGoals).toEqual(["appreciation"]);
    expect(out?.displayedName).toBe("Sam");
    expect(out?.geographicFocus).toBe("Texas");
  });

  it("updates last_used_at as a fire-and-forget side-effect", async () => {
    await captureUserContext({
      userId: "user_a",
      organizationId: "org_1",
      vertical: "land_investing",
    });
    lastUsedAtUpdateMock.mockClear();
    await loadUserContext("user_a");
    // Give the void Promise a chance to schedule.
    await new Promise((r) => setImmediate(r));
    expect(lastUsedAtUpdateMock).toHaveBeenCalledTimes(1);
    expect(lastUsedAtUpdateMock.mock.calls[0]?.[0]).toBe("user_a");
    expect(lastUsedAtUpdateMock.mock.calls[0]?.[1]).toBeInstanceOf(Date);
  });

  it("returns null on DB error without throwing", async () => {
    forceSelectError = true;
    let threw = false;
    let result: unknown = "init";
    try {
      result = await loadUserContext("user_a");
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result).toBeNull();
  });
});

describe("buildUserScopedPromptAppendix", () => {
  // Assertions use case-insensitive substring checks because the authoritative
  // persona voice is owned by verticalSystemPrompt.ts (D1-B). The exact wording
  // there may evolve; these tests check semantic presence, not exact phrasing.
  it("returns the land_investing default when userId is null", async () => {
    const out = await buildUserScopedPromptAppendix(null);
    const lower = out.toLowerCase();
    expect(out).toContain("[USER CONTEXT — DEFAULT]");
    expect(lower).toContain("land invest"); // matches "Land Investing" or "Land Investor"
  });

  it("returns the default when no row exists", async () => {
    const out = await buildUserScopedPromptAppendix("user_ghost");
    const lower = out.toLowerCase();
    expect(out).toContain("[USER CONTEXT — DEFAULT]");
    expect(lower).toContain("land invest");
  });

  it("returns the default (NOT the user data) when opted out", async () => {
    await captureUserContext({
      userId: "user_a",
      organizationId: "org_1",
      vertical: "notes",
      experienceLevel: "expert",
      investmentGoals: ["cash_flow"],
      displayedName: "Sam",
      geographicFocus: "Texas",
    });
    await setPersonalizationOptOut("user_a", true);

    const out = await buildUserScopedPromptAppendix("user_a");
    const lower = out.toLowerCase();
    expect(out).toContain("[USER CONTEXT — DEFAULT]");
    // Critically: NO leakage of the opted-out user's data.
    expect(out).not.toContain("Sam");
    expect(out).not.toContain("Texas");
    expect(lower).not.toContain("note investor");
    // Default appendix is land-investing; should NOT contain notes-specific terms.
    expect(lower).not.toContain("upb");
  });

  it("composes persona + experience + goals + greeting for opted-in user", async () => {
    await captureUserContext({
      userId: "user_a",
      organizationId: "org_1",
      vertical: "notes",
      experienceLevel: "expert",
      investmentGoals: ["cash_flow", "passive_income"],
      displayedName: "Sam",
      geographicFocus: "Texas Hill Country",
    });
    const out = await buildUserScopedPromptAppendix("user_a");
    const lower = out.toLowerCase();

    expect(out).toContain("[USER CONTEXT]");
    // Vertical voice (notes persona — voice owned by verticalSystemPrompt.ts)
    expect(lower).toContain("notes"); // verticalLabel = "Notes"
    expect(lower).toContain("yield"); // notes domain terminology
    // Experience tone (expert)
    expect(lower).toMatch(/peer|nuance|precision/);
    // Goals framing (cash_flow + passive_income)
    expect(lower).toContain("cash flow");
    expect(lower).toMatch(/hands-off|passive|management/);
    // Greeting line with both name + geo
    expect(out).toContain("Sam");
    expect(out).toContain("Texas Hill Country");
  });

  it("falls back to land_investing default when vertical is null but row exists", async () => {
    await captureUserContext({
      userId: "user_skip",
      organizationId: "org_1",
      // No vertical — user picked "Multiple / I'm not sure yet"
      experienceLevel: "beginner",
      investmentGoals: ["learning"],
    });
    const out = await buildUserScopedPromptAppendix("user_skip");
    const lower = out.toLowerCase();
    // Still gets persona section (defaulted to land_investing).
    expect(out).toContain("[USER CONTEXT]");
    expect(lower).toContain("land invest");
    // Beginner tone (D1-B): "explain context before terms" / "plain language"
    expect(lower).toMatch(/explain|context|pitfalls/);
    // Learning goal framing (D1-B): "teaching opportunity"
    expect(lower).toMatch(/teaching|principle|learning/);
  });
});

describe("setPersonalizationOptOut", () => {
  it("toggles the flag without deleting the row", async () => {
    await captureUserContext({
      userId: "user_a",
      organizationId: "org_1",
      vertical: "land_investing",
    });
    await setPersonalizationOptOut("user_a", true);
    expect(ROWS[0]?.optedInPersonalization).toBe(false);
    expect(ROWS).toHaveLength(1);

    await setPersonalizationOptOut("user_a", false);
    expect(ROWS[0]?.optedInPersonalization).toBe(true);
    expect(ROWS).toHaveLength(1);
  });
});

describe("deleteUserContext", () => {
  it("hard-deletes the row", async () => {
    await captureUserContext({
      userId: "user_a",
      organizationId: "org_1",
      vertical: "land_investing",
    });
    expect(ROWS).toHaveLength(1);
    await deleteUserContext("user_a");
    expect(ROWS).toHaveLength(0);
  });

  it("rethrows DB errors so §8 compliance is observable", async () => {
    forceDeleteError = true;
    await expect(deleteUserContext("user_a")).rejects.toThrow(
      /simulated delete failure/,
    );
  });
});

describe("getContextDistribution", () => {
  it("returns correct aggregate counts", async () => {
    await captureUserContext({
      userId: "u1",
      organizationId: "o1",
      vertical: "land_investing",
      experienceLevel: "beginner",
    });
    await captureUserContext({
      userId: "u2",
      organizationId: "o1",
      vertical: "land_investing",
      experienceLevel: "expert",
    });
    await captureUserContext({
      userId: "u3",
      organizationId: "o2",
      vertical: "notes",
      experienceLevel: "intermediate",
    });
    await captureUserContext({
      userId: "u4",
      organizationId: "o2",
      // No vertical/experience — counts toward totalUsers but not withContext.
    });
    await setPersonalizationOptOut("u3", true);

    const dist = await getContextDistribution();
    expect(dist.totalUsers).toBe(4);
    expect(dist.withContext).toBe(3); // u1, u2, u3 (u3 has data even though opted out)
    expect(dist.optedOut).toBe(1);
    expect(dist.byVertical["land_investing"]).toBe(2);
    expect(dist.byVertical["notes"]).toBe(1);
    expect(dist.byExperience["beginner"]).toBe(1);
    expect(dist.byExperience["intermediate"]).toBe(1);
    expect(dist.byExperience["expert"]).toBe(1);
  });

  it("returns empty distribution on DB error without throwing", async () => {
    forceSelectError = true;
    const dist = await getContextDistribution();
    expect(dist.totalUsers).toBe(0);
    expect(dist.withContext).toBe(0);
    expect(dist.optedOut).toBe(0);
    expect(dist.byVertical).toEqual({});
    expect(dist.byExperience).toEqual({});
  });
});
