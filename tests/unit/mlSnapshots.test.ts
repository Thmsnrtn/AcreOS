/**
 * Phase 3 Week 12 — ML training-snapshot helper unit tests (Magnus §1).
 *
 * The load-bearing contract is idempotency on
 * (snapshotType, subjectType, subjectId, decisionAt) — re-firing
 * recordSnapshot() for the same decision must be a no-op.
 *
 * We mock the db layer so the test exercises the helper's call-construction
 * without needing a real Postgres. The mock simulates ON CONFLICT DO NOTHING
 * by tracking insertions and returning an empty result on the second insert
 * with the same idempotency key.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = {
  snapshotType: string;
  subjectType: string;
  subjectId: string;
  decisionAt: Date;
  organizationId: number | null;
  labels: Record<string, unknown>;
  features: Record<string, unknown>;
  outcomeAt: Date | null;
  metadata: Record<string, unknown>;
  id: string;
};

// vi.mock factories are hoisted above all top-level statements, so the mock
// state must live inside vi.hoisted() to be accessible. We expose the shared
// `insertedRows` array back out so tests can assert against it.
const hoisted = vi.hoisted(() => {
  const insertedRows: any[] = [];

  function idemKey(r: any): string {
    return [
      r.snapshotType,
      r.subjectType,
      r.subjectId,
      r.decisionAt instanceof Date ? r.decisionAt.toISOString() : String(r.decisionAt),
    ].join("|");
  }

  const dbMock = {
    insert: () => ({
      values: (vals: any) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            const key = idemKey(vals);
            const existing = insertedRows.find((r) => idemKey(r) === key);
            if (existing) return [];
            const row = { ...vals, id: `id-${insertedRows.length + 1}` };
            insertedRows.push(row);
            return [{ id: row.id }];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => [],
          }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
    execute: async () => ({ rows: [] }),
  };

  return { insertedRows, dbMock };
});

const insertedRows = hoisted.insertedRows as Row[];

vi.mock("../../server/db", () => ({ db: hoisted.dbMock }));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@shared/schema", () => ({
  // The helper only references these as drizzle tables — empty objects are
  // sufficient because our db mock doesn't actually inspect the table shape.
  mlTrainingSnapshots: {
    snapshotType: "snapshot_type",
    subjectType: "subject_type",
    subjectId: "subject_id",
    decisionAt: "decision_at",
    outcomeAt: "outcome_at",
    id: "id",
  },
  ML_SNAPSHOT_TYPES: [
    "avm_vs_actual",
    "deal_outcome",
    "lead_conversion",
    "churn_outcome",
    "offer_acceptance",
  ] as const,
  ML_SUBJECT_TYPES: ["deal", "lead", "property", "org"] as const,
}));

import {
  recordSnapshot,
  TRAINING_READY_THRESHOLDS,
} from "../../server/services/mlSnapshots";
import { ML_SNAPSHOT_TYPES, ML_SUBJECT_TYPES } from "@shared/schema";

describe("recordSnapshot idempotency", () => {
  beforeEach(() => {
    insertedRows.length = 0;
  });

  it("inserts a new snapshot on first call", async () => {
    const ok = await recordSnapshot({
      snapshotType: "avm_vs_actual",
      subjectType: "property",
      subjectId: "42",
      orgId: 1,
      decisionAt: new Date("2026-05-01T12:00:00Z"),
      features: { acres: 10 },
      labels: { avmEstimate: 100000 },
    });

    expect(ok).toBe(true);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].subjectId).toBe("42");
    expect(insertedRows[0].labels).toEqual({ avmEstimate: 100000 });
  });

  it("is a no-op when re-fired with the same (snapshotType, subjectType, subjectId, decisionAt)", async () => {
    const decisionAt = new Date("2026-05-01T12:00:00Z");
    const args = {
      snapshotType: "avm_vs_actual" as const,
      subjectType: "property" as const,
      subjectId: "42",
      orgId: 1,
      decisionAt,
      features: { acres: 10 },
      labels: { avmEstimate: 100000 },
    };

    const first = await recordSnapshot(args);
    const second = await recordSnapshot(args);
    const third = await recordSnapshot(args);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(third).toBe(false);
    expect(insertedRows).toHaveLength(1);
  });

  it("treats a different decisionAt as a new row even with same subject", async () => {
    const baseArgs = {
      snapshotType: "avm_vs_actual" as const,
      subjectType: "property" as const,
      subjectId: "42",
      orgId: 1,
      features: { acres: 10 },
      labels: { avmEstimate: 100000 },
    };

    await recordSnapshot({ ...baseArgs, decisionAt: new Date("2026-05-01T12:00:00Z") });
    await recordSnapshot({ ...baseArgs, decisionAt: new Date("2026-05-02T12:00:00Z") });

    expect(insertedRows).toHaveLength(2);
  });

  it("treats a different subjectId as a new row", async () => {
    const baseArgs = {
      snapshotType: "deal_outcome" as const,
      subjectType: "deal" as const,
      orgId: 1,
      decisionAt: new Date("2026-05-01T12:00:00Z"),
      features: {},
      labels: {},
    };

    await recordSnapshot({ ...baseArgs, subjectId: "1" });
    await recordSnapshot({ ...baseArgs, subjectId: "2" });
    await recordSnapshot({ ...baseArgs, subjectId: "1" }); // duplicate of first

    expect(insertedRows).toHaveLength(2);
  });

  it("treats a different snapshotType as a new row even with same subject", async () => {
    const decisionAt = new Date("2026-05-01T12:00:00Z");
    const baseArgs = {
      subjectType: "deal" as const,
      subjectId: "1",
      orgId: 1,
      decisionAt,
      features: {},
      labels: {},
    };

    await recordSnapshot({ ...baseArgs, snapshotType: "deal_outcome" });
    await recordSnapshot({ ...baseArgs, snapshotType: "offer_acceptance" });

    expect(insertedRows).toHaveLength(2);
  });

  it("returns false and logs when called with missing required args", async () => {
    const ok = await recordSnapshot({
      // @ts-expect-error — exercising the runtime guard
      snapshotType: undefined,
      subjectType: "deal",
      subjectId: "1",
      decisionAt: new Date(),
    });
    expect(ok).toBe(false);
    expect(insertedRows).toHaveLength(0);
  });
});

describe("training-ready thresholds", () => {
  it("defines a positive threshold for every snapshot type", () => {
    for (const t of ML_SNAPSHOT_TYPES) {
      expect(TRAINING_READY_THRESHOLDS[t]).toBeGreaterThan(0);
    }
  });
});

describe("schema constants", () => {
  it("ML_SNAPSHOT_TYPES covers the five outcome types", () => {
    expect(ML_SNAPSHOT_TYPES).toEqual(
      expect.arrayContaining([
        "avm_vs_actual",
        "deal_outcome",
        "lead_conversion",
        "churn_outcome",
        "offer_acceptance",
      ]),
    );
  });

  it("ML_SUBJECT_TYPES includes deal/lead/property/org", () => {
    expect(ML_SUBJECT_TYPES).toEqual(
      expect.arrayContaining(["deal", "lead", "property", "org"]),
    );
  });
});
