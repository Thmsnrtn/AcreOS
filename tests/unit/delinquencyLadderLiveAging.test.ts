/**
 * H-DEF-3 — the delinquency ladder must derive its CURRENT stage live at
 * read, not read the stored `days_delinquent` column.
 *
 * The defect (hybrid journey walk, 2026-11-20): a tape-imported note whose
 * stated next payment date was 32 days past due read `stage: "current"`,
 * `daysDelinquent: 0`, `disagreement: null` from
 * GET /api/notes/:id/delinquency-ladder until a payment posting happened to
 * recompute the stored columns. Import writes the tape-stated
 * `nextPaymentDate` but never refreshes `daysDelinquent` (schema default 0 /
 * 'current'), and `buildLadderView` read the column.
 *
 * These tests drive the REAL `buildLadderView` / `recordDefaultReview`
 * against a stubbed db whose note row is exactly the post-import shape:
 * a stated, determinable next payment date and a stored day count of 0 that
 * nothing has refreshed. The clock is pinned to the walk date
 * (2026-11-20T12:00Z), so no payment posting and no aging sweep run between
 * "import" and "read" — if the view still reports the true stage, it can
 * only have derived it live.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  note: null as Record<string, unknown> | null,
  events: [] as Array<Record<string, unknown>>,
  inserted: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../server/utils/clock", () => ({
  clock: {
    now: () => new Date("2026-11-20T12:00:00.000Z"),
    nowMs: () => Date.parse("2026-11-20T12:00:00.000Z"),
  },
}));

vi.mock("../../server/db", async () => {
  const { acquiredNotes } = await import("@shared/schema");
  // The service's query shapes, stubbed at the chain boundary:
  //   loadNote / recordDefaultReview note read:  select().from(acquiredNotes).where().limit(1)
  //   default-review existence check:            select().from(noteEvents).where().limit(1)  → none
  //   latest recorded stage:                     select().from(noteEvents).where().orderBy().limit(1)
  //   ladder event history:                      select().from(noteEvents).where().orderBy()  (awaited)
  const fakeDb = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async (n: number) => (table === acquiredNotes ? (state.note ? [state.note] : []) : [] as Array<Record<string, unknown>>).slice(0, n),
          orderBy: () => {
            const rows = table === acquiredNotes ? (state.note ? [state.note] : []) : state.events;
            return Object.assign(Promise.resolve(rows), { limit: async (n: number) => rows.slice(0, n) });
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        state.inserted.push(v);
        return { returning: async () => [{ ...v, id: "00000000-0000-4000-8000-0000000000e1", recordedAt: new Date("2026-11-20T12:00:00.000Z") }] };
      },
    }),
  };
  return { db: fakeDb };
});

import { buildLadderView, recordDefaultReview } from "../../server/services/notes/delinquencyLadder";

const ORG = 126;
const NOTE_ID = "a7e02da0-e186-4382-99f2-f6204216a7c2";

/** The post-import row: tape-stated dates, stored aging never refreshed. */
function importedNote(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTE_ID,
    organizationId: ORG,
    status: "performing",
    daysDelinquent: 0,
    delinquencyStatus: "current",
    nextPaymentDate: "2026-10-19", // 32 days before the pinned now
    paidThroughDate: "2026-09-19",
    ...overrides,
  };
}

function stageRow(stage: string, daysDelinquent: number) {
  return {
    id: "00000000-0000-4000-8000-0000000000s1".replace("s", "a"),
    eventType: "delinquency_stage_entered",
    category: "delinquency",
    eventDate: "2026-11-01",
    recordedAt: new Date("2026-11-01T06:00:00.000Z"),
    detail: { stage, priorStage: null, daysDelinquent },
  };
}

beforeEach(() => {
  state.note = importedNote();
  state.events = [];
  state.inserted = [];
});

describe("H-DEF-3 — ladder current stage is derived live at read", () => {
  it("a note imported 32 days past due reads stage_30 / 32 days with NO payment posting and NO sweep first", async () => {
    const view = await buildLadderView(ORG, NOTE_ID);
    expect(view).not.toBeNull();
    expect(view!.onLadder).toBe(true);
    expect(view!.current).toEqual({
      stage: "stage_30",
      label: "30–59 days",
      daysDelinquent: 32,
      nextPaymentDate: "2026-10-19",
      paidThroughDate: "2026-09-19",
    });
    expect(view!.escalates).toBe(true);
    expect(view!.disagreement).toBeNull(); // nothing recorded yet — the live stage is the only claim
  });

  it("one day past due reads past_due_under_30 / 1 day, not the stored 0 / current", async () => {
    state.note = importedNote({ nextPaymentDate: "2026-11-19", paidThroughDate: "2026-10-19" });
    const view = await buildLadderView(ORG, NOTE_ID);
    expect(view!.current).toMatchObject({ stage: "past_due_under_30", daysDelinquent: 1 });
  });

  it("a stale stored count that OVERSTATES aging is also not read: live derivation wins both directions", async () => {
    state.note = importedNote({ daysDelinquent: 90, delinquencyStatus: "seriously_delinquent", nextPaymentDate: "2026-11-15", paidThroughDate: "2026-10-15" });
    state.events = [stageRow("stage_90_plus", 90)];
    const view = await buildLadderView(ORG, NOTE_ID);
    expect(view!.current).toMatchObject({ stage: "past_due_under_30", daysDelinquent: 5 });
    expect(view!.disagreement).toMatchObject({ recordedStage: "stage_90_plus", currentStage: "past_due_under_30" });
  });

  it("a genuinely current note still reads current / 0 (live derivation is not a lateness bias)", async () => {
    state.note = importedNote({ nextPaymentDate: "2026-12-19", paidThroughDate: "2026-11-19" });
    const view = await buildLadderView(ORG, NOTE_ID);
    expect(view!.current).toMatchObject({ stage: "current", daysDelinquent: 0 });
    expect(view!.escalates).toBe(false);
  });

  it("unknown is still not late: no derivable next payment date → no current stage, with the reason", async () => {
    state.note = importedNote({ nextPaymentDate: null, paidThroughDate: null });
    const view = await buildLadderView(ORG, NOTE_ID);
    expect(view!.current).toBeNull();
    expect(view!.onLadder).toBe(false);
    expect(view!.reason).toMatch(/not determinable/i);
  });

  it("terminal notes stay off the ladder even when the stored date is past due", async () => {
    state.note = importedNote({ status: "paid_off" });
    const view = await buildLadderView(ORG, NOTE_ID);
    expect(view!.current).toBeNull();
    expect(view!.reason).toMatch(/off the ladder/i);
  });

  it("default review records the LIVE day count at recording, not the stale stored 0", async () => {
    const row = await recordDefaultReview({ organizationId: ORG, noteId: NOTE_ID, userId: "operator-1", note: "reviewing" });
    expect(row).not.toBeNull();
    expect(state.inserted).toHaveLength(1);
    expect((state.inserted[0].detail as { daysDelinquentAtRecording: number | null }).daysDelinquentAtRecording).toBe(32);
  });
});
