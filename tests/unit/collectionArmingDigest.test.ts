/**
 * R-3 · a confirmation covers ONE specific ladder — BEHAVIOURAL test.
 *
 * WHY THIS FILE EXISTS: the digest guard was first pinned by
 * `expect(service).toContain("ladder_changed")`. Mutation M12 replaced the
 * condition with `if (false)` — disabling the guard while leaving the string —
 * and the suite stayed GREEN. Second presence check in this slice to fail the
 * same way, so this one drives `armSequence()` for real and asserts on whether
 * the row was WRITTEN.
 *
 * The invariant: arming stamps the digest of the ladder the customer actually
 * had on screen. If the steps moved between render and tap, the confirmation is
 * refused rather than silently applied to a ladder nobody saw.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ladderDigest, type CollectionLadderStep } from "@shared/collections/arming";

const ORG_ID = 7;

const SHOWN_LADDER: CollectionLadderStep[] = [
  { stepNumber: 1, daysAfterDue: -6, channel: "sms", escalationLevel: "reminder" },
  { stepNumber: 2, daysAfterDue: 21, channel: "call", escalationLevel: "urgent" },
];

/** What the SELECT in armSequence() returns — the row as it is RIGHT NOW. */
let currentRow: Record<string, unknown> | undefined;
/** Every UPDATE ... SET the service actually issued. */
const WRITES: Array<Record<string, unknown>> = [];

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => (currentRow ? [currentRow] : []),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        WRITES.push(values);
        return {
          where: () => ({
            returning: async () => [{ ...currentRow, ...values }],
          }),
        };
      },
    }),
  },
}));

const { armSequence } = await import("../../server/services/collectionArming");

beforeEach(() => {
  WRITES.length = 0;
  currentRow = {
    id: 1,
    organizationId: ORG_ID,
    name: "Ladder under confirmation",
    steps: SHOWN_LADDER,
    autoStart: false,
    armedAt: null,
    armedBy: null,
    armedLadderDigest: null,
  };
});

describe("R-3 · armSequence binds the confirmation to the ladder that was shown", () => {
  it("arms when the acknowledged digest matches the stored ladder", async () => {
    const result = await armSequence(ORG_ID, 1, "user_abc", ladderDigest(SHOWN_LADDER));

    expect(result.ok).toBe(true);
    expect(WRITES).toHaveLength(1);
    expect(WRITES[0].autoStart).toBe(true);
    expect(WRITES[0].armedBy).toBe("user_abc");
    expect(WRITES[0].armedLadderDigest).toBe(ladderDigest(SHOWN_LADDER));
    expect(WRITES[0].armedAt).toBeInstanceOf(Date);
  });

  it("REFUSES and writes NOTHING when the ladder moved between render and tap", async () => {
    // The customer reviewed SHOWN_LADDER; the stored steps have since changed.
    currentRow!.steps = [
      ...SHOWN_LADDER,
      { stepNumber: 3, daysAfterDue: 60, channel: "mail", escalationLevel: "final" },
    ];

    const result = await armSequence(ORG_ID, 1, "user_abc", ladderDigest(SHOWN_LADDER));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("ladder_changed");
    // The load-bearing assertion: no row was armed against steps nobody saw.
    expect(WRITES).toEqual([]);
  });

  it("refuses a stale digest even when the new ladder is SHORTER", async () => {
    currentRow!.steps = [SHOWN_LADDER[0]];
    const result = await armSequence(ORG_ID, 1, "user_abc", ladderDigest(SHOWN_LADDER));
    expect(result.ok).toBe(false);
    expect(WRITES).toEqual([]);
  });

  it("refuses an empty/garbage digest rather than arming on nothing", async () => {
    for (const digest of ["", "not-a-digest"]) {
      WRITES.length = 0;
      const result = await armSequence(ORG_ID, 1, "user_abc", digest);
      expect(result.ok).toBe(false);
      expect(WRITES).toEqual([]);
    }
  });

  it("reports not_found for a sequence outside the org, without writing", async () => {
    currentRow = undefined;
    const result = await armSequence(ORG_ID, 1, "user_abc", ladderDigest(SHOWN_LADDER));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("not_found");
    expect(WRITES).toEqual([]);
  });
});
