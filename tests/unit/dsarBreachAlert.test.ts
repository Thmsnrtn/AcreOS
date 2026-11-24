/**
 * Founder Autopilot B-1 — DSAR breach paging (services/privacy/dsarBreachAlert).
 *
 * Before this service the strict 24h DSAR clock (Tap #4) breached into a
 * server log line only. These pins cover the fan-out contract with injected
 * deps (no database):
 *   - first breach → exactly one critical alert + one founder card, with
 *     metBySla recorded as false;
 *   - inside the 24h re-alert interval → no second alert, no card;
 *   - ≥24h since the last alert, still unfulfilled → re-alert fires;
 *   - while a founder card for the DSAR is still open, the daily re-alert
 *     does NOT duplicate the card; once resolved, the next due sweep
 *     raises a fresh card;
 *   - fulfilled rows and rows still inside their SLA never alert, even if
 *     a loader hands them to the sweep (the sweep re-filters in process);
 *   - metBySla honesty: on-time fulfilment true, late fulfilment false,
 *     unfulfilled false — a miss is never rewritten into a meet;
 *   - one row's failure never suppresses another row's alert.
 */
import { describe, expect, it, vi } from "vitest";
import {
  breachAlertDue,
  dsarDaysOverdue,
  dsarMetBySla,
  isOverdueUnfulfilled,
  runDsarBreachAlertSweep,
  DSAR_BREACH_RE_ALERT_MS,
  type DsarBreachAlertDeps,
  type DsarLifecycleRow,
} from "../../server/services/privacy/dsarBreachAlert";

const DEADLINE = new Date("2026-11-16T10:00:00.000Z");
const NOW = new Date("2026-11-17T12:00:00.000Z"); // 26h past the deadline

function row(overrides: Partial<DsarLifecycleRow> = {}): DsarLifecycleRow {
  return {
    id: "dsar-1",
    requestType: "access",
    requesterEmail: "requester@example.com",
    requesterIdentityVerified: false,
    receivedAt: new Date("2026-11-15T10:00:00.000Z"),
    slaDeadlineAt: DEADLINE,
    fulfilledAt: null,
    deliveryMethod: null,
    bytesDelivered: null,
    auditNotes: null,
    isSelfTest: false,
    ...overrides,
  } as DsarLifecycleRow;
}

function makeDeps(overrides: Partial<DsarBreachAlertDeps> = {}) {
  const raised: Array<{ row: DsarLifecycleRow; now: Date }> = [];
  const cardedFor: number[] = [];
  const deps: DsarBreachAlertDeps = {
    now: () => NOW,
    loadOverdue: async () => [row()],
    lastBreachAlertAt: async () => null,
    raiseBreachAlert: async (r, now) => {
      raised.push({ row: r, now });
      return 4242;
    },
    hasOpenBreachCard: async () => false,
    ensureBreachCard: async (alertId) => {
      cardedFor.push(alertId);
      return 777;
    },
    log: vi.fn(),
    ...overrides,
  };
  return { deps, raised, cardedFor };
}

describe("dsarBreachAlert — pure decisions", () => {
  it("isOverdueUnfulfilled: unfulfilled + past deadline only", () => {
    expect(isOverdueUnfulfilled(row(), NOW.getTime())).toBe(true);
    expect(isOverdueUnfulfilled(row({ fulfilledAt: NOW }), NOW.getTime())).toBe(false);
    expect(isOverdueUnfulfilled(row(), DEADLINE.getTime() - 1)).toBe(false);
    expect(isOverdueUnfulfilled(row(), DEADLINE.getTime())).toBe(true);
  });

  it("dsarMetBySla is honest either way", () => {
    // Fulfilled before the deadline → met.
    expect(dsarMetBySla(row({ fulfilledAt: new Date("2026-11-16T09:00:00.000Z") }))).toBe(true);
    // Fulfilled exactly at the deadline → met.
    expect(dsarMetBySla(row({ fulfilledAt: DEADLINE }))).toBe(true);
    // Fulfilled late → NOT met, and nothing re-labels it.
    expect(dsarMetBySla(row({ fulfilledAt: NOW }))).toBe(false);
    // Unfulfilled → not met.
    expect(dsarMetBySla(row())).toBe(false);
  });

  it("breachAlertDue: first breach always; then only after the daily interval", () => {
    expect(breachAlertDue(null, NOW.getTime())).toBe(true);
    expect(breachAlertDue(new Date(NOW.getTime() - 60 * 60 * 1000), NOW.getTime())).toBe(false);
    expect(
      breachAlertDue(new Date(NOW.getTime() - DSAR_BREACH_RE_ALERT_MS + 1), NOW.getTime()),
    ).toBe(false);
    expect(
      breachAlertDue(new Date(NOW.getTime() - DSAR_BREACH_RE_ALERT_MS), NOW.getTime()),
    ).toBe(true);
    expect(
      breachAlertDue(new Date(NOW.getTime() - 3 * DSAR_BREACH_RE_ALERT_MS), NOW.getTime()),
    ).toBe(true);
  });

  it("dsarDaysOverdue counts whole days past the deadline", () => {
    expect(dsarDaysOverdue(row(), DEADLINE.getTime())).toBe(0);
    expect(dsarDaysOverdue(row(), NOW.getTime())).toBe(1);
    expect(dsarDaysOverdue(row(), DEADLINE.getTime() - 1000)).toBe(0);
  });
});

describe("runDsarBreachAlertSweep — fan-out", () => {
  it("first breach: one alert + one founder card for the overdue DSAR", async () => {
    const { deps, raised, cardedFor } = makeDeps();
    const result = await runDsarBreachAlertSweep(deps);
    expect(result).toEqual({ overdue: 1, alerted: 1, carded: 1, suppressed: 0 });
    expect(raised).toHaveLength(1);
    expect(raised[0].row.id).toBe("dsar-1");
    expect(dsarMetBySla(raised[0].row)).toBe(false);
    expect(cardedFor).toEqual([4242]);
  });

  it("inside the re-alert interval: no second alert and no card", async () => {
    const { deps, raised, cardedFor } = makeDeps({
      lastBreachAlertAt: async () => new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    const result = await runDsarBreachAlertSweep(deps);
    expect(result).toEqual({ overdue: 1, alerted: 0, carded: 0, suppressed: 1 });
    expect(raised).toHaveLength(0);
    expect(cardedFor).toEqual([]);
  });

  it("a day later, still unfulfilled: the re-alert fires", async () => {
    const { deps, raised } = makeDeps({
      lastBreachAlertAt: async () =>
        new Date(NOW.getTime() - DSAR_BREACH_RE_ALERT_MS - 1000),
    });
    const result = await runDsarBreachAlertSweep(deps);
    expect(result.alerted).toBe(1);
    expect(raised).toHaveLength(1);
  });

  it("daily re-alert does not duplicate a still-open founder card", async () => {
    const { deps, cardedFor } = makeDeps({
      lastBreachAlertAt: async () =>
        new Date(NOW.getTime() - DSAR_BREACH_RE_ALERT_MS - 1000),
      hasOpenBreachCard: async () => true,
    });
    const result = await runDsarBreachAlertSweep(deps);
    expect(result).toEqual({ overdue: 1, alerted: 1, carded: 0, suppressed: 0 });
    expect(cardedFor).toEqual([]);
  });

  it("once the founder resolves the card, the next due sweep raises a fresh one", async () => {
    const { deps, cardedFor } = makeDeps({
      lastBreachAlertAt: async () =>
        new Date(NOW.getTime() - 2 * DSAR_BREACH_RE_ALERT_MS),
      hasOpenBreachCard: async () => false,
    });
    const result = await runDsarBreachAlertSweep(deps);
    expect(result.carded).toBe(1);
    expect(cardedFor).toEqual([4242]);
  });

  it("fulfilled and within-SLA rows never alert, even if the loader returns them", async () => {
    const { deps, raised } = makeDeps({
      loadOverdue: async () => [
        row({ id: "done-late", fulfilledAt: NOW }),
        row({ id: "still-in-window", slaDeadlineAt: new Date(NOW.getTime() + 60_000) }),
      ],
    });
    const result = await runDsarBreachAlertSweep(deps);
    expect(result).toEqual({ overdue: 0, alerted: 0, carded: 0, suppressed: 0 });
    expect(raised).toHaveLength(0);
  });

  it("rows are independent: one row's failure does not suppress another's alert", async () => {
    const { deps, raised } = makeDeps({
      loadOverdue: async () => [row({ id: "bad-row" }), row({ id: "good-row" })],
      raiseBreachAlert: async (r, now) => {
        if (r.id === "bad-row") throw new Error("insert failed");
        raised.push({ row: r, now });
        return 5150;
      },
    });
    const result = await runDsarBreachAlertSweep(deps);
    expect(result.overdue).toBe(2);
    expect(result.alerted).toBe(1);
    expect(raised.map((x) => x.row.id)).toEqual(["good-row"]);
    expect(deps.log).toHaveBeenCalled();
  });

  it("multiple overdue DSARs each get their own alert + card", async () => {
    const { deps, raised, cardedFor } = makeDeps({
      loadOverdue: async () => [row({ id: "dsar-a" }), row({ id: "dsar-b" })],
    });
    const result = await runDsarBreachAlertSweep(deps);
    expect(result).toEqual({ overdue: 2, alerted: 2, carded: 2, suppressed: 0 });
    expect(raised.map((x) => x.row.id)).toEqual(["dsar-a", "dsar-b"]);
    expect(cardedFor).toEqual([4242, 4242]);
  });

  it("a TEST-labelled (self-test) overdue DSAR still pages — it is the drill vehicle", async () => {
    const { deps, raised } = makeDeps({
      loadOverdue: async () => [row({ id: "dsar-test", isSelfTest: true })],
    });
    const result = await runDsarBreachAlertSweep(deps);
    expect(result.alerted).toBe(1);
    expect(raised[0].row.isSelfTest).toBe(true);
  });

  it("no overdue rows: a quiet no-op", async () => {
    const { deps, raised } = makeDeps({ loadOverdue: async () => [] });
    const result = await runDsarBreachAlertSweep(deps);
    expect(result).toEqual({ overdue: 0, alerted: 0, carded: 0, suppressed: 0 });
    expect(raised).toHaveLength(0);
  });
});
