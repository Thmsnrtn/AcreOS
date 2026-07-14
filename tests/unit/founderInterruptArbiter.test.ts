/**
 * Founder Interrupt Arbiter — Jarvis 2.2 (audit finding G3).
 *
 * Pins the constitutional interruption physics:
 *   - Class A ALWAYS delivers — over budget, during quiet hours, and even
 *     when every supporting read fails (fail OPEN).
 *   - Class B is budget-gated (under → deliver; at/over → defer to the
 *     Letter, never dropped) and quiet-hours-gated (window active → defer to
 *     next pulse). Read failures fail CLOSED-quiet (defer, never spam).
 *   - Class C never interrupts — suppressed with a defect-signal log.
 *   - The budget numerator is the tickMetric counting seam; the limit is the
 *     constitutional FOUNDER_MINUTES_BUDGET (5), never a local constant.
 *   - No enabled quiet-hours preference = no quiet hours (honest default,
 *     logged once).
 *   - Every decision writes a structured logger line AND a
 *     logActivity(job:"interrupt") audit row.
 *   - Deferrals persist as decisions_inbox_items rows (status='deferred') so
 *     they are batched, never dropped.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/services/systemActivityLogger", () => ({
  logActivity: vi.fn(async () => {}),
}));

vi.mock("../../server/services/solene/tickMetric", () => ({
  countFounderDecisionsThisWeek: vi.fn(async () => 0),
}));

vi.mock("../../server/services/founder", () => ({
  getFounderUserIds: vi.fn(async () => [] as string[]),
}));

// In-memory stores the db mock serves/captures.
const USERS: Array<{ id: string; appearancePreferences: any }> = [];
const INSERTED: Array<Record<string, any>> = [];
let usersReadShouldFail = false;
let insertShouldFail = false;
let nextInsertId = 100;

vi.mock("../../server/db", () => {
  const db = {
    select: (_proj?: any) => ({
      from: (_t: any) => ({
        where: (_w: any) => {
          if (usersReadShouldFail) {
            return Promise.reject(new Error("simulated users read failure"));
          }
          return Promise.resolve(USERS.map((u) => ({ ...u })));
        },
      }),
    }),
    insert: (_t: any) => ({
      values: (row: Record<string, any>) => ({
        returning: (_p: any) => {
          if (insertShouldFail) {
            return Promise.reject(new Error("simulated insert failure"));
          }
          INSERTED.push(row);
          return Promise.resolve([{ id: nextInsertId++ }]);
        },
      }),
    }),
  };
  return { db };
});

import {
  arbitrateFounderInterrupt,
  recordDeferredInterrupt,
  _resetQuietHoursLogLatch,
  type FounderInterrupt,
} from "../../server/services/founderInterruptArbiter";
import { countFounderDecisionsThisWeek } from "../../server/services/solene/tickMetric";
import { getFounderUserIds } from "../../server/services/founder";
import { logActivity } from "../../server/services/systemActivityLogger";
import { logger } from "../../server/utils/logger";
import { FOUNDER_MINUTES_BUDGET } from "@sovereign/immutables";

const countMock = vi.mocked(countFounderDecisionsThisWeek);
const founderIdsMock = vi.mocked(getFounderUserIds);
const logActivityMock = vi.mocked(logActivity);

// Noon founder-local (tests pin FOUNDER_TIMEZONE=UTC) — outside any window.
const NOON = new Date("2026-07-14T12:00:00Z");
// 23:30 founder-local — inside a 22:00→07:00 wrapping window.
const LATE_NIGHT = new Date("2026-07-14T23:30:00Z");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function interrupt(cls: "A" | "B" | "C", extra?: Partial<FounderInterrupt>): FounderInterrupt {
  return {
    source: "pager",
    interruptClass: cls,
    channel: "ntfy_push",
    subject: "test interrupt",
    body: "body",
    ...extra,
  };
}

function seedQuietHours(startHour: number, endHour: number, enabled = true): void {
  founderIdsMock.mockResolvedValue(["founder-1"]);
  USERS.push({
    id: "founder-1",
    appearancePreferences: { notificationQuietHours: { enabled, startHour, endHour } },
  });
}

beforeEach(() => {
  USERS.length = 0;
  INSERTED.length = 0;
  usersReadShouldFail = false;
  insertShouldFail = false;
  nextInsertId = 100;
  process.env.FOUNDER_TIMEZONE = "UTC";
  countMock.mockReset();
  countMock.mockResolvedValue(0);
  founderIdsMock.mockReset();
  founderIdsMock.mockResolvedValue([]);
  logActivityMock.mockClear();
  vi.mocked(logger.info).mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.error).mockClear();
  _resetQuietHoursLogLatch();
});

// ─── Class A ────────────────────────────────────────────────────────────────

describe("Class A — always delivers", () => {
  it("delivers OVER budget and DURING quiet hours — budget never blocks A, quiet hours never hold A", async () => {
    countMock.mockResolvedValue(9);
    seedQuietHours(22, 7);

    const d = await arbitrateFounderInterrupt(interrupt("A"), LATE_NIGHT);

    expect(d.outcome).toBe("deliver");
    expect(d.budget).toEqual({ used: 9, limit: 5 });
    expect(d.quietHoursActive).toBe(true);
    expect(d.reason).toContain("OVER the weekly budget (9/5)");
    expect(d.reason).toContain("broke through quiet hours");
  });

  it("fails OPEN: delivers even when the budget count AND quiet-hours reads fail", async () => {
    countMock.mockRejectedValue(new Error("db down"));
    founderIdsMock.mockRejectedValue(new Error("db down"));

    const d = await arbitrateFounderInterrupt(interrupt("A"), NOON);

    expect(d.outcome).toBe("deliver");
    // Unmeasured context is null — never a fabricated value.
    expect(d.budget).toBeNull();
    expect(d.quietHoursActive).toBeNull();
  });
});

// ─── Class B — budget gate ──────────────────────────────────────────────────

describe("Class B — budget gate", () => {
  it("under budget, outside quiet hours → deliver", async () => {
    countMock.mockResolvedValue(3);

    const d = await arbitrateFounderInterrupt(interrupt("B"), NOON);

    expect(d.outcome).toBe("deliver");
    expect(d.budget).toEqual({ used: 3, limit: 5 });
    expect(d.reason).toContain("3/5");
  });

  it("AT budget → defer_to_letter with a deferUntil when the trailing-week window has rolled", async () => {
    countMock.mockResolvedValue(5);

    const d = await arbitrateFounderInterrupt(interrupt("B"), NOON);

    expect(d.outcome).toBe("defer_to_letter");
    expect(d.reason).toContain("budget consumed (5/5)");
    expect(d.deferUntil?.getTime()).toBe(NOON.getTime() + 7 * DAY_MS);
  });

  it("OVER budget → defer_to_letter (never dropped, never delivered)", async () => {
    countMock.mockResolvedValue(7);

    const d = await arbitrateFounderInterrupt(interrupt("B"), NOON);

    expect(d.outcome).toBe("defer_to_letter");
  });

  it("the limit is the constitutional budget, never a local constant", async () => {
    countMock.mockResolvedValue(0);

    const d = await arbitrateFounderInterrupt(interrupt("B"), NOON);

    expect(d.budget?.limit).toBe(FOUNDER_MINUTES_BUDGET.classABDecisionsPerWeek);
    expect(d.budget?.limit).toBe(5);
  });

  it("budget count read failure → fails CLOSED-quiet (defer_next_pulse, budget honestly null)", async () => {
    countMock.mockRejectedValue(new Error("cascade_resolutions unreadable"));

    const d = await arbitrateFounderInterrupt(interrupt("B"), NOON);

    expect(d.outcome).toBe("defer_next_pulse");
    expect(d.budget).toBeNull();
    expect(d.reason).toContain("unmeasurable");
    expect(d.deferUntil?.getTime()).toBe(NOON.getTime() + DAY_MS);
  });
});

// ─── Class B — quiet hours ──────────────────────────────────────────────────

describe("Class B — quiet hours", () => {
  it("window active (wraps midnight) → defer_next_pulse until the window end", async () => {
    countMock.mockResolvedValue(0);
    seedQuietHours(22, 7);

    const d = await arbitrateFounderInterrupt(interrupt("B"), LATE_NIGHT);

    expect(d.outcome).toBe("defer_next_pulse");
    expect(d.quietHoursActive).toBe(true);
    expect(d.reason).toContain("quiet hours active");
    // 23:30 + 8h = 07:30 — at/after the 07:00 window end, never inside it.
    expect(d.deferUntil?.getUTCHours()).toBe(7);
    expect(d.deferUntil!.getTime()).toBeGreaterThan(LATE_NIGHT.getTime());
  });

  it("early-morning side of a wrapping window is also quiet", async () => {
    countMock.mockResolvedValue(0);
    seedQuietHours(22, 7);
    const threeAm = new Date("2026-07-15T03:00:00Z");

    const d = await arbitrateFounderInterrupt(interrupt("B"), threeAm);

    expect(d.outcome).toBe("defer_next_pulse");
    expect(d.quietHoursActive).toBe(true);
  });

  it("outside the window → deliver", async () => {
    countMock.mockResolvedValue(0);
    seedQuietHours(22, 7);

    const d = await arbitrateFounderInterrupt(interrupt("B"), NOON);

    expect(d.outcome).toBe("deliver");
    expect(d.quietHoursActive).toBe(false);
  });

  it("no founder row / disabled toggle = no quiet hours — the honest default, logged once", async () => {
    countMock.mockResolvedValue(0);
    seedQuietHours(22, 7, /* enabled */ false);

    const first = await arbitrateFounderInterrupt(interrupt("B"), LATE_NIGHT);
    const second = await arbitrateFounderInterrupt(interrupt("B"), LATE_NIGHT);

    expect(first.outcome).toBe("deliver");
    expect(second.outcome).toBe("deliver");
    const honestDefaultLogs = vi
      .mocked(logger.info)
      .mock.calls.filter(([msg]) => String(msg).includes("no quiet hours in effect"));
    expect(honestDefaultLogs).toHaveLength(1);
  });

  it("quiet-hours preference read failure → fails CLOSED-quiet (defer_next_pulse)", async () => {
    countMock.mockResolvedValue(0);
    founderIdsMock.mockResolvedValue(["founder-1"]);
    usersReadShouldFail = true;

    const d = await arbitrateFounderInterrupt(interrupt("B"), NOON);

    expect(d.outcome).toBe("defer_next_pulse");
    expect(d.quietHoursActive).toBeNull();
    expect(d.reason).toContain("unreadable");
  });
});

// ─── Class C ────────────────────────────────────────────────────────────────

describe("Class C — never interrupts", () => {
  it("suppresses even under budget and outside quiet hours, naming itself a defect signal", async () => {
    countMock.mockResolvedValue(0);

    const d = await arbitrateFounderInterrupt(interrupt("C"), NOON);

    expect(d.outcome).toBe("suppress");
    expect(d.reason).toContain("defect signal");
    // C never consults budget or quiet hours — it can never interrupt anyway.
    expect(countMock).not.toHaveBeenCalled();
  });
});

// ─── Audit trail ────────────────────────────────────────────────────────────

describe("audit — every decision is answerable after the fact", () => {
  it("writes a logActivity(job:'interrupt') row with class, channel, outcome, and reason", async () => {
    countMock.mockResolvedValue(5);

    await arbitrateFounderInterrupt(
      interrupt("B", { source: "decisions_inbox", channel: "inbox_pending_item" }),
      NOON,
    );

    expect(logActivityMock).toHaveBeenCalledTimes(1);
    const call = logActivityMock.mock.calls[0][0];
    expect(call.job).toBe("interrupt");
    expect(call.action).toBe("interrupt_deferred_to_letter");
    expect(call.metadata).toMatchObject({
      source: "decisions_inbox",
      interruptClass: "B",
      channel: "inbox_pending_item",
      outcome: "defer_to_letter",
      budgetUsed: 5,
      budgetLimit: 5,
    });
    expect(typeof call.metadata?.reason).toBe("string");
  });

  it("audits delivered and suppressed outcomes too", async () => {
    countMock.mockResolvedValue(0);

    await arbitrateFounderInterrupt(interrupt("A"), NOON);
    await arbitrateFounderInterrupt(interrupt("C"), NOON);

    const actions = logActivityMock.mock.calls.map(([p]) => p.action);
    expect(actions).toContain("interrupt_delivered");
    expect(actions).toContain("interrupt_suppressed");
  });
});

// ─── Deferral persistence ───────────────────────────────────────────────────

describe("recordDeferredInterrupt — deferrals are never dropped", () => {
  it("persists a decisions_inbox_items deferral row for a deferred Class B interrupt", async () => {
    countMock.mockResolvedValue(5);
    const i = interrupt("B", { metadata: { organizationId: 7 } });
    const d = await arbitrateFounderInterrupt(i, NOON);

    const id = await recordDeferredInterrupt(i, d);

    expect(id).toBe(100);
    expect(INSERTED).toHaveLength(1);
    expect(INSERTED[0]).toMatchObject({
      itemType: "deferred_interrupt",
      status: "deferred",
      organizationId: 7,
      recommendedActionLabel: "Review deferred interrupt",
    });
    expect(INSERTED[0].deferredUntil).toBeInstanceOf(Date);
    expect(INSERTED[0].sophieAnalysis).toContain("Class B founder interrupt deferred");
  });

  it("is a no-op for non-deferral outcomes", async () => {
    countMock.mockResolvedValue(0);
    const i = interrupt("B");
    const d = await arbitrateFounderInterrupt(i, NOON);
    expect(d.outcome).toBe("deliver");

    const id = await recordDeferredInterrupt(i, d);

    expect(id).toBeNull();
    expect(INSERTED).toHaveLength(0);
  });

  it("never throws when the insert fails — the audit log line is the durable record", async () => {
    countMock.mockResolvedValue(5);
    insertShouldFail = true;
    const i = interrupt("B");
    const d = await arbitrateFounderInterrupt(i, NOON);

    const id = await recordDeferredInterrupt(i, d);

    expect(id).toBeNull();
    expect(vi.mocked(logger.error)).toHaveBeenCalled();
  });
});
