/**
 * Lifecycle program dispatcher — unit tests.
 *
 * Phase 4 Week 17-18 (Sigrid §3, Camila §4, Indigo §1-§4).
 *
 * Two acceptance behaviours are load-bearing:
 *
 *   1. Suppression-list block — sending to a suppressed address must
 *      NEVER touch the outbox. The audit row must record status=suppressed.
 *
 *   2. Win-back 2-touches-per-12-months throttle — the third winback
 *      attempt against the same org inside the rolling window must be
 *      skipped (status=skipped, reason=winback_throttled) and NOT enqueue
 *      another outbox row.
 *
 * The DB layer is mocked at the module boundary — we don't need a live
 * Postgres for this; we need to verify the dispatcher's *decision logic*.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — set up BEFORE the module-under-test is imported.
// ---------------------------------------------------------------------------

const suppressedSet = new Set<string>();

vi.mock("../../server/services/emailSuppressions", () => ({
  isSuppressed: vi.fn(async (e: string) =>
    suppressedSet.has(e.trim().toLowerCase()),
  ),
  filterSuppressed: vi.fn(),
  suppress: vi.fn(),
  recordSoftBounce: vi.fn(),
  alertFounderOnComplaint: vi.fn(),
}));

// shared/schema.ts has an unrelated unresolved-conflict marker on main
// that breaks esbuild parsing. We never need the real drizzle table
// objects in this test (the db mock dispatches by `_name` tag), so we
// stub each referenced export with a simple identifier marker.
vi.mock("@shared/schema", () => ({
  emailTemplates: { _name: "email_templates" },
  lifecycleMessageSends: { _name: "lifecycle_message_sends" },
  outbox: { _name: "outbox" },
  reactivationTokens: { _name: "reactivation_tokens" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ op: "eq", col, val }),
  and: (...args: any[]) => ({ op: "and", args }),
  desc: (col: any) => ({ op: "desc", col }),
  gte: (col: any, val: any) => ({ op: "gte", col, val }),
  sql: Object.assign(
    (..._args: any[]) => ({ op: "sql" }),
    {
      raw: (..._args: any[]) => ({ op: "sql_raw" }),
    },
  ),
}));

// In-memory outbox + audit row capture for assertions.
const outboxRows: Array<{ id: number; payload: any }> = [];
const auditRows: Array<{
  id: number;
  organizationId: number;
  templateKey: string;
  category: string;
  status: string;
  outboxId: number | null;
  metadata: Record<string, unknown>;
  sentAt: Date;
}> = [];

let outboxIdSeq = 1;
let auditIdSeq = 1;

function makeDbMock() {
  const db = {
    insert: (table: any) => ({
      values: (vals: any) => {
        const name = table?._name ?? "";
        return {
          returning: (_proj?: any) => {
            if (name === "outbox") {
              const id = outboxIdSeq++;
              outboxRows.push({ id, payload: vals });
              return Promise.resolve([{ id }]);
            }
            if (name === "lifecycle_message_sends") {
              const id = auditIdSeq++;
              auditRows.push({
                id,
                organizationId: vals.organizationId,
                templateKey: vals.templateKey,
                category: vals.category,
                status: vals.status,
                outboxId: vals.outboxId,
                metadata: vals.metadata,
                sentAt: new Date(),
              });
              return Promise.resolve([{ id }]);
            }
            return Promise.resolve([{ id: 0 }]);
          },
        };
      },
    }),
    select: (_proj?: any) => ({
      from: (table: any) => {
        const name = table?._name ?? "";
        return {
          where: (_cond: any) => {
            if (name === "lifecycle_message_sends") {
              const winbackCount = auditRows.filter(
                (r) =>
                  r.category === "lifecycle.winback" &&
                  (r.status === "queued" || r.status === "sent"),
              ).length;
              const result = Promise.resolve([{ count: winbackCount }]);
              return Object.assign(result, {
                orderBy: () => ({ limit: () => Promise.resolve([]) }),
                limit: () => Promise.resolve([]),
              });
            }
            // email_templates load — return empty so the dispatcher
            // falls back to the static registry.
            const emptyResult = Promise.resolve([]);
            return Object.assign(emptyResult, {
              orderBy: () => ({ limit: () => Promise.resolve([]) }),
              limit: () => Promise.resolve([]),
            });
          },
        };
      },
    }),
    update: (_table: any) => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
  };

  return db;
}

vi.mock("../../server/db", () => ({
  db: makeDbMock(),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Now import the module-under-test (after mocks).
import {
  sendLifecycleMessage,
  sendWinback,
  countWinbackTouches,
} from "../../server/services/lifecycleProgram";
import {
  WINBACK_MAX_TOUCHES_PER_YEAR,
  winbackCellFor,
  normalizeCancellationReason,
  winbackTierFor,
} from "../../shared/lifecycle/messages";

beforeEach(() => {
  suppressedSet.clear();
  outboxRows.length = 0;
  auditRows.length = 0;
  outboxIdSeq = 1;
  auditIdSeq = 1;
});

// ---------------------------------------------------------------------------
// 1. Suppression-list block
// ---------------------------------------------------------------------------

describe("sendLifecycleMessage — suppression block", () => {
  it("blocks send when recipient is on the suppression list", async () => {
    suppressedSet.add("blocked@example.com");

    const result = await sendLifecycleMessage({
      templateKey: "welcome",
      organizationId: 42,
      recipientEmail: "blocked@example.com",
    });

    expect(result.status).toBe("suppressed");
    // Audit row was written with status=suppressed.
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].status).toBe("suppressed");
    // No outbox row was enqueued.
    expect(outboxRows).toHaveLength(0);
  });

  it("queues send when recipient is not suppressed", async () => {
    const result = await sendLifecycleMessage({
      templateKey: "welcome",
      organizationId: 42,
      recipientEmail: "ok@example.com",
    });

    expect(result.status).toBe("queued");
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].payload.payload.templateKey).toBe("welcome");
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].status).toBe("queued");
  });

  it("rejects malformed recipient emails without touching outbox", async () => {
    const result = await sendLifecycleMessage({
      templateKey: "welcome",
      organizationId: 42,
      recipientEmail: "not-an-email",
    });

    expect(result.status).toBe("skipped");
    expect(outboxRows).toHaveLength(0);
    // Invalid recipient short-circuits before audit write — that's fine,
    // we only need to assert the outbox wasn't touched.
  });
});

// ---------------------------------------------------------------------------
// 2. Win-back throttle (max 2 touches per org per 12 months)
// ---------------------------------------------------------------------------

describe("sendWinback — Indigo 2-touch / 12-month throttle", () => {
  it("allows the first two win-back touches and skips the third", async () => {
    // Touch 1.
    const r1 = await sendWinback({
      organizationId: 1,
      recipientEmail: "user@example.com",
      cancellationReason: "too_expensive",
      cancelledTier: "operator",
      variant: "d14",
    });
    expect(r1.status).toBe("queued");

    // Touch 2.
    const r2 = await sendWinback({
      organizationId: 1,
      recipientEmail: "user@example.com",
      cancellationReason: "too_expensive",
      cancelledTier: "operator",
      variant: "d90",
    });
    expect(r2.status).toBe("queued");

    expect(outboxRows).toHaveLength(2);
    expect(WINBACK_MAX_TOUCHES_PER_YEAR).toBe(2);

    // Touch 3 — must be throttled.
    const r3 = await sendWinback({
      organizationId: 1,
      recipientEmail: "user@example.com",
      cancellationReason: "too_expensive",
      cancelledTier: "operator",
      variant: "d14",
    });

    expect(r3.status).toBe("skipped");
    expect(r3.reason).toBe("winback_throttled");
    // Outbox count unchanged — no third send.
    expect(outboxRows).toHaveLength(2);

    // Throttle was recorded as a skipped audit row.
    const skippedAudits = auditRows.filter((r) => r.status === "skipped");
    expect(skippedAudits.length).toBe(1);
    expect(skippedAudits[0].metadata.reason).toBe("winback_throttled");
  });

  it("respects wrong_fit cancellations — no win-back ever sent", async () => {
    const r = await sendWinback({
      organizationId: 2,
      recipientEmail: "user@example.com",
      cancellationReason: "wrong_fit",
      cancelledTier: "solo",
      variant: "d14",
    });

    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("wrong_fit_no_touch");
    expect(outboxRows).toHaveLength(0);
  });

  it("countWinbackTouches reflects only queued/sent rows", async () => {
    await sendWinback({
      organizationId: 7,
      recipientEmail: "x@example.com",
      cancellationReason: "price",
      cancelledTier: "solo",
      variant: "d14",
    });
    const touches = await countWinbackTouches(7);
    expect(touches).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Matrix lookup smoke tests
// ---------------------------------------------------------------------------

describe("Indigo win-back matrix lookups", () => {
  it("normalizes free-text reasons to the canonical taxonomy", () => {
    expect(normalizeCancellationReason("too_expensive")).toBe("price");
    expect(normalizeCancellationReason("missing_features")).toBe(
      "missing_feature",
    );
    expect(normalizeCancellationReason("not_using")).toBe("not_using");
    expect(normalizeCancellationReason("switching_competitor")).toBe(
      "wrong_fit",
    );
    expect(normalizeCancellationReason(null)).toBe("unknown");
    expect(normalizeCancellationReason("")).toBe("unknown");
  });

  it("maps subscription tier aliases to win-back tiers", () => {
    expect(winbackTierFor("starter")).toBe("solo");
    expect(winbackTierFor("solo")).toBe("solo");
    expect(winbackTierFor("pro")).toBe("operator");
    expect(winbackTierFor("operator")).toBe("operator");
    expect(winbackTierFor("scale")).toBe("empire");
    expect(winbackTierFor("empire")).toBe("empire");
    expect(winbackTierFor("free")).toBe("solo");
    expect(winbackTierFor(null)).toBe("solo");
  });

  it("price × solo cell pitches the $20 keep-it-going line", () => {
    const cell = winbackCellFor("price", "solo");
    expect(cell.approach).toBe("tailored_email");
    expect(cell.pitch.toLowerCase()).toContain("$20");
  });

  it("price × operator/empire cell pitches the downgrade-to-solo line", () => {
    const op = winbackCellFor("price", "operator");
    const emp = winbackCellFor("price", "empire");
    expect(op.approach).toBe("tailored_email");
    expect(emp.approach).toBe("tailored_email");
    expect(op.pitch.toLowerCase()).toContain("solo");
    expect(emp.pitch.toLowerCase()).toContain("solo");
  });

  it("wrong_fit cells across all tiers are no_touch", () => {
    for (const tier of ["solo", "operator", "empire"] as const) {
      const cell = winbackCellFor("wrong_fit", tier);
      expect(cell.approach).toBe("no_touch");
      expect(cell.pitch).toBe("");
    }
  });

  it("missing_feature cells are feature_ship_trigger across all tiers", () => {
    for (const tier of ["solo", "operator", "empire"] as const) {
      const cell = winbackCellFor("missing_feature", tier);
      expect(cell.approach).toBe("feature_ship_trigger");
    }
  });

  it("not_using cells offer live re-onboarding across all tiers", () => {
    for (const tier of ["solo", "operator", "empire"] as const) {
      const cell = winbackCellFor("not_using", tier);
      expect(cell.approach).toBe("reonboarding_offer");
      expect(cell.pitch.toLowerCase()).toContain("live");
    }
  });
});
