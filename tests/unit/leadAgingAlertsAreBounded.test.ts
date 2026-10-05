/**
 * Lead-aging alerts and the aging list are bounded, ranked in SQL, and carry
 * the true whole-book count (W10.2b audit).
 *
 * Once the aging sweep read the whole book (DEFECT-0171), checkLeadAging
 * raised one system alert per stale lead — two sequential queries each — so a
 * large book meant tens of thousands of alerts per org per night, and
 * GET /api/leads/aging returned every stale lead as a full row. Now a run
 * alerts on at most AGING_ALERTS_PER_DAY leads a day (most urgent, stalest first,
 * chosen in SQL), skips leads already alerted today, and raises ONE summary
 * alert stating the counted remainder; the list is the top AGING_LIST_LIMIT
 * plus the whole-book total.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Urgency = "urgent" | "warning" | "info";
const H = vi.hoisted(() => ({
  /** Aging leads in the order SQL would rank them. */
  aging: [] as Array<{ id: number; urgency: Urgency; stage: string }>,
  alertedToday: [] as string[],
  resolvedToday: [] as string[],
  inserted: [] as Array<Record<string, unknown>>,
  topCalls: [] as Array<{ limit: number; excludeIds?: number[] }>,
  countCalls: [] as number[][],
  /** createAlert's own same-day dedupe finds an alert (a race with another run). */
  dedupeHit: false,
}));

vi.mock("../../server/storage/wholeOrgReadsG", () => ({
  mostUrgentAgingLeads: vi.fn(async (_org: number, opts: { limit: number; excludeIds?: number[] }) => {
    H.topCalls.push({ limit: opts.limit, excludeIds: opts.excludeIds });
    const ex = new Set(opts.excludeIds ?? []);
    return H.aging
      .filter((l) => !ex.has(l.id))
      .slice(0, opts.limit)
      .map((l) => ({
        id: l.id,
        firstName: `F${l.id}`,
        lastName: null,
        nurturingStage: l.stage,
        score: 40,
        lastTouch: new Date(Date.now() - 20.5 * 86_400_000),
        urgency: l.urgency,
      }));
  }),
  agingLeadCount: vi.fn(async (_org: number, _now: Date, excludeIds: number[] = []) => {
    H.countCalls.push(excludeIds);
    const ex = new Set(excludeIds);
    return H.aging.filter((l) => !ex.has(l.id)).length;
  }),
  leadStageFigures: vi.fn(),
  newlyDelinquentNoteIds: vi.fn(),
  noteRiskTotals: vi.fn(),
  recentlyInactiveNoteTotals: vi.fn(),
}));

vi.mock("../../server/db", () => {
  const select = (fields?: Record<string, unknown>) => {
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = () => q;
    q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => {
          // agingAlertsToday selects { alertType, status }; createAlert's
          // same-day dedupe selects * — answer it from what was inserted.
          if (fields && "alertType" in fields)
            return H.alertedToday.map((alertType) => ({ alertType, status: H.resolvedToday.includes(alertType) ? "resolved" : "active" }));
          return H.dedupeHit ? [{ id: 1 }] : [];
        })
        .then(res, rej);
    return q;
  };
  const insert = () => ({
    values: (v: Record<string, unknown>) => ({
      returning: async () => {
        H.inserted.push(v);
        return [{ id: H.inserted.length }];
      },
    }),
  });
  return { db: { select, insert } };
});
vi.mock("../../server/services/alertPolicy", () => ({ alertPolicyService: { routeAlert: vi.fn(async () => undefined) } }));
vi.mock("../../server/services/agentComms", () => ({ agentCommsService: { broadcast: vi.fn(async () => undefined) } }));
vi.mock("../../server/services/paxControls", () => ({ getPaxControls: vi.fn() }));

const { alertingService } = await import("../../server/services/alerting");
// The module's caps (not exported: nothing else needs them). Pinned by behaviour below.
const AGING_ALERTS_PER_DAY = 50;
const AGING_LIST_LIMIT = 100;

const lead = (id: number, urgency: Urgency = "info", stage = "new") => ({ id, urgency, stage });

beforeEach(() => {
  H.aging = [];
  H.alertedToday = [];
  H.resolvedToday = [];
  H.inserted = [];
  H.topCalls = [];
  H.countCalls = [];
  H.dedupeHit = false;
});

describe("checkLeadAging — at most the cap, then one summary with the counted remainder", () => {
  it("6,200 aging leads: 50 individual alerts (the most urgent) + ONE summary stating 6,150", async () => {
    H.aging = [lead(1, "urgent", "hot"), lead(2, "warning", "warm"), ...Array.from({ length: 6198 }, (_, i) => lead(i + 3))];
    const r = await alertingService.checkLeadAging(7);

    expect(H.topCalls).toEqual([{ limit: AGING_ALERTS_PER_DAY, excludeIds: [] }]);
    const perLead = H.inserted.filter((a) => String(a.alertType).match(/^lead_aging_\d+$/));
    expect(perLead).toHaveLength(50);
    expect(perLead[0]).toMatchObject({ alertType: "lead_aging_1", severity: "critical", title: "Hot Lead Going Cold", organizationId: 7 });
    expect(perLead[1]).toMatchObject({ alertType: "lead_aging_2", severity: "warning" });

    const summary = H.inserted.filter((a) => a.alertType === "lead_aging_summary");
    expect(summary).toHaveLength(1);
    expect(summary[0].message).toBe(
      "6200 leads are past their follow-up window (hot 3+ days, warm 7+ days, any 14+ days without contact). " +
        "Individual alerts cover the most urgent; 6150 more have none today.",
    );
    expect(summary[0].metadata).toMatchObject({ agingTotal: 6200, alertedThisRun: 50, unalerted: 6150, perDayCap: 50 });

    expect(H.inserted).toHaveLength(51);
    expect(r.alertsCreated).toBe(51);
    expect(r.agingTotal).toBe(6200);
    expect(r.agingLeads).toHaveLength(50);
    expect(r.agingLeads[0]).toMatchObject({ id: 1, urgency: "urgent", lastName: "", daysSinceContact: 20 });
  });

  it("at or under the cap: one alert per lead, no summary", async () => {
    H.aging = [lead(1), lead(2), lead(3)];
    const r = await alertingService.checkLeadAging(7);
    expect(H.inserted.map((a) => a.alertType)).toEqual(["lead_aging_1", "lead_aging_2", "lead_aging_3"]);
    expect(r).toMatchObject({ alertsCreated: 3, agingTotal: 3 });
  });

  it("a later run the same day spends only what is left of the day's cap, further down the list", async () => {
    H.aging = Array.from({ length: 120 }, (_, i) => lead(i + 1));
    H.alertedToday = Array.from({ length: 30 }, (_, i) => `lead_aging_${i + 1}`).concat("lead_aging_summary");
    const r = await alertingService.checkLeadAging(7);
    const alreadyAlerted = Array.from({ length: 30 }, (_, i) => i + 1);
    // The summary's alertType is not a lead id, and it does not spend the cap.
    expect(H.topCalls).toEqual([{ limit: 20, excludeIds: alreadyAlerted }]);
    expect(H.countCalls).toEqual(expect.arrayContaining([alreadyAlerted, []]));
    const perLead = H.inserted.filter((a) => String(a.alertType).match(/^lead_aging_\d+$/));
    expect(perLead[0].alertType).toBe("lead_aging_31");
    expect(perLead).toHaveLength(20);
    // 120 aging, 30 alerted earlier, 20 now: 70 still without an alert.
    const summary = H.inserted.find((a) => a.alertType === "lead_aging_summary");
    expect(summary?.metadata).toMatchObject({ agingTotal: 120, unalerted: 70 });
    expect(r.agingTotal).toBe(120);
  });

  it("once the day's cap is spent, later runs raise no per-lead alert — 96 runs a day stay at 50", async () => {
    H.aging = Array.from({ length: 6200 }, (_, i) => lead(i + 1));
    H.alertedToday = Array.from({ length: 50 }, (_, i) => `lead_aging_${i + 1}`);
    await alertingService.checkLeadAging(7);
    expect(H.topCalls).toEqual([]);
    expect(H.inserted.filter((a) => String(a.alertType).match(/^lead_aging_\d+$/))).toHaveLength(0);
    expect(H.inserted.find((a) => a.alertType === "lead_aging_summary")?.metadata).toMatchObject({ unalerted: 6150 });
  });

  it("a resolved alert still spent the day's cap, but its lead may be alerted again", async () => {
    H.aging = Array.from({ length: 120 }, (_, i) => lead(i + 1));
    H.alertedToday = ["lead_aging_1", "lead_aging_2"];
    H.resolvedToday = ["lead_aging_1"];
    await alertingService.checkLeadAging(7);
    expect(H.topCalls).toEqual([{ limit: 48, excludeIds: [2] }]);
  });

  it("an alert createAlert declined as a same-day duplicate is not counted as created", async () => {
    H.aging = Array.from({ length: 60 }, (_, i) => lead(i + 1));
    H.dedupeHit = true;
    const r = await alertingService.checkLeadAging(7);
    expect(H.inserted).toHaveLength(0);
    expect(r.alertsCreated).toBe(0);
  });

  it("no aging leads: no alerts, honest zeros", async () => {
    expect(await alertingService.checkLeadAging(7)).toEqual({ agingLeads: [], agingTotal: 0, alertsCreated: 0 });
    expect(H.inserted).toHaveLength(0);
  });
});

describe("getAgingLeads — the top of the list, plus the whole-book total", () => {
  it("returns at most AGING_LIST_LIMIT, ranked as SQL ranked them, and the true total", async () => {
    H.aging = [lead(9, "urgent", "hot"), ...Array.from({ length: 4999 }, (_, i) => lead(i + 10))];
    const r = await alertingService.getAgingLeads(7);
    expect(H.topCalls).toEqual([{ limit: AGING_LIST_LIMIT, excludeIds: undefined }]);
    expect(r.agingLeads).toHaveLength(100);
    expect(r.agingLeads[0]).toMatchObject({ id: 9, urgency: "urgent", nurturingStage: "hot" });
    expect(r.total).toBe(5000);
  });
});
