/**
 * Self-Healing Data Plane — detection→annunciation loop (ruling #9 wave 4).
 *
 * Pins:
 *  1. the persistence threshold BOTH ways — a short failure streak (or a
 *     streak that hasn't spanned 2h) never becomes a finding; the documented
 *     threshold (every probe in the category >=3 consecutive fails AND the
 *     category fully dark >=2h) does;
 *  2. marker dedup — the same failure window never raises two cards;
 *  3. a NEW failure window (after recovery closed the previous one) re-raises;
 *  4. recovery closes the open window silently (no card);
 *  5. the card copy carries the honest what-breaks line and promises NO
 *     auto-fix (replacements go through the reviewed discovery flow only).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const createDirectDecisionCard = vi.fn(async () => ({ itemId: 42, created: true }));
vi.mock("../../server/services/decisionsInbox", () => ({
  decisionsInboxService: {
    createDirectDecisionCard: (card: unknown) => createDirectDecisionCard(card),
  },
}));

// Drizzle-chain mock (same pattern as railSunsetDecisionCards.test.ts).
// The provider_health read ends in .orderBy(); the marker read ends in
// .limit(1) — that's how the two select chains are told apart.
let healthRows: Array<Record<string, unknown>> = [];
let markerRow: { id: number; value: Record<string, unknown> } | null = null;
const markerInserts: Array<Record<string, any>> = [];
const markerUpdates: Array<Record<string, any>> = [];

vi.mock("../../server/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => [...healthRows]),
          limit: vi.fn(async () => (markerRow ? [markerRow] : [])),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (v: Record<string, any>) => {
        markerInserts.push(v);
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: Record<string, any>) => ({
        where: vi.fn(async () => {
          markerUpdates.push(v);
        }),
      })),
    })),
  },
}));

import {
  DRIFT_MIN_CONSECUTIVE_RUNS,
  DRIFT_MIN_SPAN_MS,
  annunciateDrift,
  buildDriftCard,
  closeDriftWindowIfOpen,
  evaluateProbeRows,
  runSelfHealingSweep,
  type ConfirmedDrift,
  type ProbeHealthRow,
} from "../../server/services/openData/selfHealing";

const NOW = Date.now();

/** provider_health row `minutesAgo` in the past (matches the probe's writes). */
function row(
  probe: string,
  healthy: boolean,
  minutesAgo: number,
  opts: Partial<ProbeHealthRow> = {},
): ProbeHealthRow {
  return {
    source: opts.source ?? "FEMA NFHL",
    category: opts.category ?? "flood_zone",
    probe,
    healthy,
    detail: opts.detail ?? (healthy ? null : "no result (all providers exhausted)"),
    checkedAt: new Date(NOW - minutesAgo * 60_000),
  };
}

/** N consecutive failing runs for one probe, 30 min apart, newest first. */
function failStreak(probe: string, runs: number, newestMinutesAgo = 0, opts: Partial<ProbeHealthRow> = {}) {
  return Array.from({ length: runs }, (_, i) => row(probe, false, newestMinutesAgo + i * 30, opts));
}

function drift(overrides: Partial<ConfirmedDrift> = {}): ConfirmedDrift {
  return {
    kind: "CONFIRMED_DRIFT",
    source: "FEMA NFHL",
    category: "flood_zone",
    firstFailedAt: new Date(NOW - 3 * 60 * 60 * 1000),
    consecutiveFailures: 5,
    lastError: "no result (all providers exhausted)",
    probes: ["travis-tx-flood"],
    ...overrides,
  };
}

beforeEach(() => {
  healthRows = [];
  markerRow = null;
  markerInserts.length = 0;
  markerUpdates.length = 0;
  createDirectDecisionCard.mockClear();
  createDirectDecisionCard.mockImplementation(async () => ({ itemId: 42, created: true }));
});

describe("evaluateProbeRows — persistence threshold", () => {
  it("2 consecutive fails (even spanning >2h) is NOT drift — under the run threshold", () => {
    const rows = [row("travis-tx-flood", false, 0), row("travis-tx-flood", false, 150), row("travis-tx-flood", true, 180)];
    const { drifts } = evaluateProbeRows(rows);
    expect(DRIFT_MIN_CONSECUTIVE_RUNS).toBe(3);
    expect(drifts).toHaveLength(0);
  });

  it("3 consecutive fails spanning only 1h is NOT drift — under the 2h span", () => {
    expect(DRIFT_MIN_SPAN_MS).toBe(2 * 60 * 60 * 1000);
    const rows = [...failStreak("travis-tx-flood", 3), row("travis-tx-flood", true, 90)];
    // streak spans 0..60 min < 2h
    expect(evaluateProbeRows(rows).drifts).toHaveLength(0);
  });

  it("a single blip inside a healthy history is never drift", () => {
    const rows = [
      row("travis-tx-flood", false, 0), // newest failed once
      row("travis-tx-flood", true, 30),
      row("travis-tx-flood", false, 60),
      row("travis-tx-flood", true, 90),
    ];
    expect(evaluateProbeRows(rows).drifts).toHaveLength(0);
  });

  it("the documented threshold (>=3 runs AND >=2h fully dark) IS a CONFIRMED_DRIFT with honest fields", () => {
    const rows = [
      ...failStreak("travis-tx-flood", 5), // 0..120 min ago = 2h span, 5 runs
      row("travis-tx-flood", true, 150),
    ];
    const { drifts } = evaluateProbeRows(rows);
    expect(drifts).toHaveLength(1);
    const d = drifts[0];
    expect(d.kind).toBe("CONFIRMED_DRIFT");
    expect(d.category).toBe("flood_zone");
    expect(d.source).toBe("FEMA NFHL");
    expect(d.consecutiveFailures).toBe(5);
    expect(d.firstFailedAt.getTime()).toBe(NOW - 120 * 60_000); // oldest row of the streak
    expect(d.lastError).toMatch(/exhausted/);
    expect(d.probes).toEqual(["travis-tx-flood"]);
  });

  it("one probe failing while a sibling probe of the same category passes is NOT category drift", () => {
    const rows = [
      ...failStreak("travis-tx-environmental", 6, 0, { category: "environmental" }),
      row("maricopa-az-environmental", true, 0, { category: "environmental" }),
      row("maricopa-az-environmental", true, 30, { category: "environmental" }),
    ];
    const evaln = evaluateProbeRows(rows);
    expect(evaln.drifts).toHaveLength(0);
    // mixed is not "healthy" either — recovery must not close a window on it
    expect(evaln.healthyCategories).not.toContain("environmental");
  });

  it("multi-probe category: firstFailedAt is when the LAST probe went dark; consecutiveFailures is the smallest streak", () => {
    const rows = [
      ...failStreak("travis-tx-environmental", 8, 0, { category: "environmental" }), // dark since 210m
      ...failStreak("maricopa-az-environmental", 5, 0, { category: "environmental" }), // dark since 120m
      row("maricopa-az-environmental", true, 150, { category: "environmental" }),
    ];
    const { drifts } = evaluateProbeRows(rows);
    expect(drifts).toHaveLength(1);
    expect(drifts[0].consecutiveFailures).toBe(5);
    expect(drifts[0].firstFailedAt.getTime()).toBe(NOW - 120 * 60_000);
    expect(drifts[0].probes).toEqual(["maricopa-az-environmental", "travis-tx-environmental"]);
  });

  it("an all-healthy category lands in healthyCategories (recovery candidate)", () => {
    const rows = [row("travis-tx-flood", true, 0), row("travis-tx-flood", false, 30)];
    const evaln = evaluateProbeRows(rows);
    expect(evaln.drifts).toHaveLength(0);
    expect(evaln.healthyCategories).toContain("flood_zone");
  });
});

describe("annunciateDrift — marker dedup per failure window", () => {
  it("no marker → raises exactly one card and opens the window marker", async () => {
    const result = await annunciateDrift(drift());
    expect(result).toBe("card_raised");
    expect(createDirectDecisionCard).toHaveBeenCalledTimes(1);
    expect(markerInserts).toHaveLength(1);
    expect(markerInserts[0].key).toBe("self_healing.drift.flood_zone");
    expect(markerInserts[0].value.status).toBe("open");
  });

  it("open window → same window NEVER raises a second card (re-run dedup)", async () => {
    markerRow = {
      id: 1,
      value: { status: "open", category: "flood_zone", source: "FEMA NFHL", firstFailedAt: new Date(NOW - 3 * 3_600_000).toISOString() },
    };
    const result = await annunciateDrift(drift());
    expect(result).toBe("window_already_open");
    expect(createDirectDecisionCard).not.toHaveBeenCalled();
    expect(markerInserts).toHaveLength(0);
    expect(markerUpdates).toHaveLength(0);
  });

  it("closed window covering the finding → no re-raise (stale finding, same window)", async () => {
    markerRow = {
      id: 1,
      value: {
        status: "closed",
        category: "flood_zone",
        source: "FEMA NFHL",
        firstFailedAt: new Date(NOW - 6 * 3_600_000).toISOString(),
        closedAt: new Date(NOW - 1 * 3_600_000).toISOString(),
      },
    };
    // finding's window started BEFORE the close → same old window
    const result = await annunciateDrift(drift({ firstFailedAt: new Date(NOW - 5 * 3_600_000) }));
    expect(result).toBe("same_window_already_annunciated");
    expect(createDirectDecisionCard).not.toHaveBeenCalled();
  });

  it("NEW failure window after a closed one → fresh card is raised", async () => {
    markerRow = {
      id: 1,
      value: {
        status: "closed",
        category: "flood_zone",
        source: "FEMA NFHL",
        firstFailedAt: new Date(NOW - 24 * 3_600_000).toISOString(),
        closedAt: new Date(NOW - 10 * 3_600_000).toISOString(),
      },
    };
    // this window began AFTER the previous one closed
    const result = await annunciateDrift(drift({ firstFailedAt: new Date(NOW - 3 * 3_600_000) }));
    expect(result).toBe("card_raised");
    expect(createDirectDecisionCard).toHaveBeenCalledTimes(1);
    // existing marker row is UPDATED back to open, not duplicated
    expect(markerUpdates).toHaveLength(1);
    expect(markerUpdates[0].value.status).toBe("open");
    expect(markerInserts).toHaveLength(0);
  });

  it("card-creation failure → 'failed', marker NOT written (retries next probe run), never throws", async () => {
    createDirectDecisionCard.mockRejectedValueOnce(new Error("db down"));
    await expect(annunciateDrift(drift())).resolves.toBe("failed");
    expect(markerInserts).toHaveLength(0);
  });
});

describe("recovery — silence on good", () => {
  it("closes an open window (so a future failure raises a FRESH card) with NO card", async () => {
    markerRow = {
      id: 1,
      value: { status: "open", category: "flood_zone", source: "FEMA NFHL", firstFailedAt: new Date(NOW - 5 * 3_600_000).toISOString() },
    };
    const closed = await closeDriftWindowIfOpen("flood_zone");
    expect(closed).toBe(true);
    expect(markerUpdates).toHaveLength(1);
    expect(markerUpdates[0].value.status).toBe("closed");
    expect(typeof markerUpdates[0].value.closedAt).toBe("string");
    expect(createDirectDecisionCard).not.toHaveBeenCalled();
  });

  it("no marker / already-closed marker → nothing happens", async () => {
    expect(await closeDriftWindowIfOpen("flood_zone")).toBe(false);
    markerRow = { id: 1, value: { status: "closed", category: "flood_zone", source: "x", firstFailedAt: new Date().toISOString() } };
    expect(await closeDriftWindowIfOpen("flood_zone")).toBe(false);
    expect(markerUpdates).toHaveLength(0);
  });

  it("sweep end-to-end: healthy history closes the open window and raises nothing", async () => {
    healthRows = [row("travis-tx-flood", true, 0), row("travis-tx-flood", true, 30)];
    markerRow = {
      id: 1,
      value: { status: "open", category: "flood_zone", source: "FEMA NFHL", firstFailedAt: new Date(NOW - 5 * 3_600_000).toISOString() },
    };
    const result = await runSelfHealingSweep();
    expect(result).toEqual({ confirmedDrifts: 0, cardsRaised: 0, windowsClosed: 1 });
    expect(createDirectDecisionCard).not.toHaveBeenCalled();
  });

  it("sweep end-to-end: confirmed drift raises exactly one card", async () => {
    healthRows = [...failStreak("travis-tx-flood", 6), row("travis-tx-flood", true, 180)];
    const result = await runSelfHealingSweep();
    expect(result.confirmedDrifts).toBe(1);
    expect(result.cardsRaised).toBe(1);
    expect(createDirectDecisionCard).toHaveBeenCalledTimes(1);
  });
});

describe("card copy — honest diagnosis, no auto-fix promise", () => {
  it("names the instrument, since-when, and the honest what-breaks line", () => {
    const card = buildDriftCard(drift());
    expect(card.subject).toMatch(/Data instrument dark: flood-zone/);
    expect(card.subject).toMatch(/since /);
    // the honest impact map: what this category feeds in the product
    expect(card.analysis).toContain("flood-zone answers on the Map and in due-diligence reports");
    expect(card.analysis).toMatch(/went dark on/);
    expect(card.analysis).toContain("no result (all providers exhausted)");
  });

  it("states the honest machine behavior: stale cache where available, report the gap elsewhere", () => {
    const card = buildDriftCard(drift());
    expect(card.analysis).toMatch(/previously fetched answers from cache/);
    expect(card.analysis).toMatch(/report the gap honestly/);
    expect(card.analysis).toMatch(/no invented numbers, no silent substitute/);
  });

  it("promises NO auto-fix: replacement is a separate reviewed flow behind founder approval", () => {
    const card = buildDriftCard(drift());
    expect(card.analysis).toMatch(/will NOT auto-fix/);
    expect(card.analysis).toMatch(/reviewed discovery\s+flow/);
    expect(card.analysis).toMatch(/only after your approval/);
    // options are acknowledge/hold ONLY — no "fix"/"swap"/"replace" tap exists
    expect(card.options.map((o) => o.key)).toEqual(["acknowledge", "hold"]);
    for (const o of card.options) {
      expect(o.label).not.toMatch(/fix|swap|replace/i);
    }
  });

  it("source-shape: the annunciated card goes through createDirectDecisionCard (actionPayload null — nothing auto-executes)", async () => {
    await annunciateDrift(drift());
    const call = createDirectDecisionCard.mock.calls[0][0] as any;
    expect(call.itemType).toBe("critical_alert");
    expect(call.subject).toMatch(/Data instrument dark/);
    // createDirectDecisionCard hard-codes actionPayload: null — the card can
    // only record a ruling; approving executes nothing.
    expect(Object.keys(call)).not.toContain("actionPayload");
  });
});
