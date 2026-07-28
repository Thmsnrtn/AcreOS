/**
 * Horizon A5 — weekly connections sweep.
 *
 * Pins:
 *  - buildSweepBrief: exactly three finding-type sections, pending items +
 *    escalations quoted, retrieval anchors included, machine state included,
 *    unreadable sources NAMED (never silently omitted), FINDINGS contract.
 *  - parseSweepFindings: 'none' / valid JSON / malformed / last-wins /
 *    invalid entries dropped / capped at 5 / summaries clipped.
 *  - isoWeekKey + per-ISO-week idempotency of enqueueWeeklySweep.
 *  - the persisted blob shape ({atIso, findings, dispatchId, parseOk}) via
 *    handleSweepCompletion, with atIso from the dispatch row's completedAt.
 *  - Letter paragraph (buildConnectionsParagraph) + pulse sentence
 *    (buildFounderBrief.sweep): honest empty / not-run / unparseable states,
 *    silent pulse when nothing was found. NEVER an interrupt.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── DB mock — table-keyed row stores (tickMetric.test.ts pattern) ─────────

const STORES = {
  inboxItems: [] as Array<Record<string, any>>,
  dispatches: [] as Array<Record<string, any>>,
  cascades: [] as Array<Record<string, any>>,
  settings: [] as Array<Record<string, any>>,
};
const FAIL_TABLES = new Set<string>();
const SETTING_INSERTS: Array<Record<string, any>> = [];
const SETTING_UPDATES: Array<Record<string, any>> = [];

vi.mock("../../server/db", () => {
  const tableName = (tableLike: any): string | null => {
    if (!tableLike) return null;
    const sym = Object.getOwnPropertySymbols(tableLike).find((s) =>
      String(s).includes("Name"),
    );
    if (sym && typeof tableLike[sym] === "string") return tableLike[sym];
    return null;
  };
  const rowsFor = (table: string | null): any[] => {
    if (table && FAIL_TABLES.has(table)) {
      throw new Error(`simulated read failure: ${table}`);
    }
    if (table === "decisions_inbox_items") return [...STORES.inboxItems];
    if (table === "solene_dispatch_queue") return [...STORES.dispatches];
    if (table === "cascade_resolutions") return [...STORES.cascades];
    if (table === "platform_settings") return [...STORES.settings];
    return [];
  };
  const buildChain = () => {
    const chain: any = {
      _table: null as string | null,
      from(t: any) {
        this._table = tableName(t);
        return this;
      },
      where() {
        return this;
      },
      orderBy() {
        return this;
      },
      limit(n: number) {
        const self = this;
        return {
          then(onF: (rows: any[]) => any, onR?: (e: any) => any) {
            return Promise.resolve()
              .then(() => rowsFor(self._table).slice(0, n))
              .then(onF, onR);
          },
        };
      },
      then(onF: (rows: any[]) => any, onR?: (e: any) => any) {
        return Promise.resolve()
          .then(() => rowsFor(this._table))
          .then(onF, onR);
      },
    };
    return chain;
  };
  return {
    db: {
      select: (_proj?: any) => buildChain(),
      insert: (_t: any) => ({
        values: async (row: Record<string, any>) => {
          SETTING_INSERTS.push(row);
          STORES.settings.push(row);
        },
      }),
      update: (_t: any) => ({
        set: (values: Record<string, any>) => ({
          where: async () => {
            SETTING_UPDATES.push(values);
            if (STORES.settings[0]) Object.assign(STORES.settings[0], values);
          },
        }),
      }),
    },
  };
});

// ─── Collaborator mocks ─────────────────────────────────────────────────────

const enqueueDispatchMock = vi.fn(async () => 4242);
vi.mock("../../server/services/solene/dispatchQueue", () => ({
  enqueueDispatch: (...a: unknown[]) => (enqueueDispatchMock as any)(...a),
}));

const RETRIEVED: Array<{
  namespace: string;
  sourceRef: string;
  contentSnippet: string;
  similarityScore: number;
}> = [];
const retrieveMock = vi.fn(async () => ({
  retrievalEventId: 1,
  retrieved: [...RETRIEVED],
  byNamespace: {},
  latencyMs: 1,
}));
vi.mock("../../server/services/solene/memoryRetrieval", () => ({
  retrieveCrossNamespaceMemories: (...a: unknown[]) => (retrieveMock as any)(...a),
}));

let dispatchEnabled = true;
vi.mock("../../server/services/autopilot/settings", () => ({
  isDispatchEnabled: vi.fn(async () => dispatchEnabled),
  getEffectiveSettings: vi.fn(async () => ({
    dispatchEnabled,
    cognitionEnabled: true,
  })),
}));

vi.mock("../../server/services/autopilot/domainAutonomy", () => ({
  getTrustLedger: vi.fn(async () => [
    { domain: "growth", level: "L1", cleanCycleCount: 3, threshold: 10 },
  ]),
}));

vi.mock("@sovereign/immutables", () => ({
  RAW_IMMUTABLES: { version: "1.1.0" },
  CURRENT_PHASE: "phase_0",
  FOUNDER_MINUTES_BUDGET: { classABDecisionsPerWeek: 5 },
}));

// founderNarrative pulls the model router at module load — stub it so the
// pure buildConnectionsParagraph helper imports without a model client.
vi.mock("../../server/services/aiRouter", () => ({
  routeCriticalTask: vi.fn(),
}));

import {
  buildSweepBrief,
  enqueueWeeklySweep,
  parseSweepFindings,
  isoWeekKey,
  handleSweepCompletion,
  readLatestSweepBlob,
  CONNECTIONS_SWEEP_SETTING_KEY,
  SWEEP_MAX_FINDINGS,
} from "../../server/services/solene/connectionsSweep";
import { buildConnectionsParagraph } from "../../server/services/founderNarrative";
import { buildFounderBrief } from "../../server/services/autopilot/narrate";
import { logger } from "../../server/utils/logger";

const NOW = new Date("2026-07-13T13:00:00Z"); // a Monday

beforeEach(() => {
  vi.clearAllMocks();
  STORES.inboxItems.length = 0;
  STORES.dispatches.length = 0;
  STORES.cascades.length = 0;
  STORES.settings.length = 0;
  SETTING_INSERTS.length = 0;
  SETTING_UPDATES.length = 0;
  FAIL_TABLES.clear();
  RETRIEVED.length = 0;
  dispatchEnabled = true;
  enqueueDispatchMock.mockResolvedValue(4242);
});

// ────────────────────────────────────────────────────────────────────────────
// isoWeekKey
// ────────────────────────────────────────────────────────────────────────────

describe("isoWeekKey", () => {
  it("computes the ISO-8601 week", () => {
    expect(isoWeekKey(new Date("2026-07-13T00:00:00Z"))).toBe("2026-W29"); // Monday
    expect(isoWeekKey(new Date("2026-07-19T23:59:59Z"))).toBe("2026-W29"); // Sunday, same week
    expect(isoWeekKey(new Date("2026-07-20T00:00:00Z"))).toBe("2026-W30"); // next Monday
    expect(isoWeekKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01"); // Jan 1 2026 is a Thursday
  });
});

// ────────────────────────────────────────────────────────────────────────────
// buildSweepBrief
// ────────────────────────────────────────────────────────────────────────────

describe("buildSweepBrief", () => {
  it("includes the three finding types, quoted items, retrieval anchors, and machine state", async () => {
    STORES.inboxItems.push({
      id: 11,
      itemType: "pricing_change",
      recommendedActionLabel: "Raise the Pro tier to $79",
      sophieAnalysis: "Margin analysis suggests a raise.",
    });
    STORES.dispatches.push({
      id: 22,
      sourceType: "auto_dispatch",
      promptText: "Ship the new pricing page",
      queuedAt: NOW,
    });
    STORES.cascades.push({
      id: 33,
      triggerType: "refund_over_cap",
      founderResolution: "approve refunds under $50 without me",
      createdAt: new Date("2026-07-10T00:00:00Z"),
    });
    RETRIEVED.push({
      namespace: "founder_precedent",
      sourceRef: "founder_precedent:decision:9",
      contentSnippet: "FOUNDER RULING: never raise prices mid-quarter",
      similarityScore: 0.91,
    });

    const brief = await buildSweepBrief(NOW);

    expect(brief).toContain("## 1. CONTRADICTIONS");
    expect(brief).toContain("## 2. FORGOTTEN PRECEDENTS");
    expect(brief).toContain("## 3. STALE DOCTRINE");
    // Pending items + in-flight dispatches quoted with their ids.
    expect(brief).toContain("decisions_inbox_items:11");
    expect(brief).toContain("Raise the Pro tier to $79");
    expect(brief).toContain("solene_dispatch_queue:22");
    // Escalation rows quoted.
    expect(brief).toContain("cascade_resolutions:33");
    expect(brief).toContain("refund_over_cap");
    // Retrieval anchors are IN the brief (the agent starts anchored).
    expect(brief).toContain("founder_precedent:decision:9");
    expect(brief).toContain("never raise prices mid-quarter");
    // Machine state for the stale-doctrine section.
    expect(brief).toContain("version=1.1.0");
    expect(brief).toContain("phase=phase_0");
    expect(brief).toContain("dispatchEnabled=true");
    expect(brief).toContain("growth=L1");
    // Output contract.
    expect(brief).toContain("FINDINGS: none");
    expect(brief).toContain('"forgotten_precedent"');
    // Never-an-interrupt discipline stated to the agent.
    expect(brief).toContain("Do NOT create inbox");
  });

  it("says 'none' for empty sources and never invents anchors", async () => {
    const brief = await buildSweepBrief(NOW);
    expect(brief).toContain("Pending decision-inbox items: none.");
    expect(brief).toContain("Queued / in-progress dispatches: none.");
    expect(brief).toContain("Recent founder escalations: none in the window.");
    expect(brief).toContain("(nothing pending to anchor against)");
    expect(brief).toContain("(no escalations to anchor against)");
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it("NAMES an unreadable source instead of silently omitting it", async () => {
    FAIL_TABLES.add("decisions_inbox_items");
    const brief = await buildSweepBrief(NOW);
    expect(brief).toContain("Pending decision-inbox items: (unreadable this run)");
    expect(logger.warn).toHaveBeenCalledWith(
      "connectionsSweep.brief.pending_decisions_unreadable",
      expect.anything(),
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// enqueueWeeklySweep
// ────────────────────────────────────────────────────────────────────────────

describe("enqueueWeeklySweep", () => {
  it("enqueues a read-only self_audit_drift dispatch keyed to the ISO week", async () => {
    const r = await enqueueWeeklySweep(NOW);
    expect(r).toEqual({ dispatchId: 4242, skipped: false });
    expect(enqueueDispatchMock).toHaveBeenCalledTimes(1);
    const args = (enqueueDispatchMock.mock.calls[0] as any[])[0];
    expect(args.sourceType).toBe("self_audit_drift");
    expect(args.agentRole).toBe("general-purpose");
    expect(args.idempotencyKey).toBe("connections-sweep:2026-W29");
    expect(args.sourceId).toBe("connections-sweep:2026-W29");
    // maxCostUsd omitted → queue default.
    expect(args.maxCostUsd).toBeUndefined();
    // successCriteria describe the FINDINGS contract.
    expect(args.successCriteria.criteria[0].description).toContain("FINDINGS");
    expect(args.successCriteria.criteria[0].description).toContain("never pad");
  });

  it("two enqueues in the SAME ISO week carry the same idempotency key (queue dedups)", async () => {
    await enqueueWeeklySweep(new Date("2026-07-13T13:00:00Z"));
    await enqueueWeeklySweep(new Date("2026-07-17T09:00:00Z"));
    const k1 = (enqueueDispatchMock.mock.calls[0] as any[])[0].idempotencyKey;
    const k2 = (enqueueDispatchMock.mock.calls[1] as any[])[0].idempotencyKey;
    expect(k1).toBe(k2);
    const k3Run = await enqueueWeeklySweep(new Date("2026-07-20T13:00:00Z"));
    expect(k3Run.skipped).toBe(false);
    const k3 = (enqueueDispatchMock.mock.calls[2] as any[])[0].idempotencyKey;
    expect(k3).toBe("connections-sweep:2026-W30");
  });

  it("stands down when the dispatch switch is off", async () => {
    dispatchEnabled = false;
    const r = await enqueueWeeklySweep(NOW);
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("dispatch_disabled");
    expect(enqueueDispatchMock).not.toHaveBeenCalled();
  });

  it("never throws: an enqueue failure is reported as skipped", async () => {
    enqueueDispatchMock.mockRejectedValueOnce(new Error("queue down"));
    const r = await enqueueWeeklySweep(NOW);
    expect(r.dispatchId).toBeNull();
    expect(r.skipped).toBe(true);
    expect(r.reason).toContain("enqueue_failed");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// parseSweepFindings
// ────────────────────────────────────────────────────────────────────────────

describe("parseSweepFindings", () => {
  it("'FINDINGS: none' → honest empty array", () => {
    expect(parseSweepFindings("I looked everywhere.\n\nFINDINGS: none")).toEqual([]);
  });

  it("valid JSON array → parsed findings with refs", () => {
    const text =
      "Sweep done.\nFINDINGS: [" +
      '{"type":"contradiction","summary":"Pending pricing raise conflicts with ruling","refs":["decisions_inbox_items:11","founder_precedent:decision:9"]},' +
      '{"type":"stale_doctrine","summary":"Doc says phase_1; machine says phase_0","refs":["docs/company/mature-machine.md"]}]';
    const out = parseSweepFindings(text);
    expect(out).toHaveLength(2);
    expect(out![0]).toEqual({
      type: "contradiction",
      summary: "Pending pricing raise conflicts with ruling",
      refs: ["decisions_inbox_items:11", "founder_precedent:decision:9"],
    });
    expect(out![1].type).toBe("stale_doctrine");
  });

  it("unparseable → null (recorded as unparseable, never as zero findings)", () => {
    expect(parseSweepFindings("no block at all")).toBeNull();
    expect(parseSweepFindings("FINDINGS: [ {broken json")).toBeNull();
    expect(parseSweepFindings("")).toBeNull();
  });

  it("LAST occurrence wins (the model may quote the contract earlier)", () => {
    const quoted =
      'The contract says end with FINDINGS: [{"type":"contradiction","summary":"example","refs":[]}]\n' +
      "…after checking, nothing held up.\n\nFINDINGS: none";
    expect(parseSweepFindings(quoted)).toEqual([]);

    const reversed =
      "FINDINGS: none is what I would say if I had nothing, but:\n" +
      'FINDINGS: [{"type":"forgotten_precedent","summary":"Escalation matches ruling #9","refs":["cascade_resolutions:33"]}]';
    const out = parseSweepFindings(reversed);
    expect(out).toHaveLength(1);
    expect(out![0].type).toBe("forgotten_precedent");
  });

  it("drops invalid entries, clips summaries, caps at the max", () => {
    const entries = [
      { type: "contradiction", summary: "S".repeat(300), refs: ["a"] },
      { type: "not_a_type", summary: "invalid type", refs: [] },
      { summary: "missing type", refs: [] },
      ...Array.from({ length: 8 }, (_, i) => ({
        type: "stale_doctrine",
        summary: `finding ${i}`,
        refs: [`docs/x${i}.md`],
      })),
    ];
    const out = parseSweepFindings(`FINDINGS: ${JSON.stringify(entries)}`);
    expect(out).toHaveLength(SWEEP_MAX_FINDINGS);
    expect(out![0].summary).toHaveLength(200);
    expect(out!.every((f) => f.type === "contradiction" || f.type === "stale_doctrine")).toBe(true);
  });

  it("an array where NOTHING validates is unparseable (null), not an all-clear", () => {
    const out = parseSweepFindings('FINDINGS: [{"type":"bogus","summary":"x"}]');
    expect(out).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// handleSweepCompletion — blob persistence
// ────────────────────────────────────────────────────────────────────────────

describe("handleSweepCompletion + readLatestSweepBlob", () => {
  it("persists {atIso, findings, dispatchId, parseOk} with atIso from the row's completedAt", async () => {
    STORES.dispatches.push({
      id: 4242,
      completedAt: new Date("2026-07-13T14:05:00Z"),
      queuedAt: new Date("2026-07-13T13:00:00Z"),
    });
    await handleSweepCompletion(4242, "FINDINGS: none");
    expect(SETTING_INSERTS).toHaveLength(1);
    const row = SETTING_INSERTS[0];
    expect(row.key).toBe(CONNECTIONS_SWEEP_SETTING_KEY);
    expect(row.scope).toBe("global");
    expect(row.scopeRef).toBeNull();
    expect(row.value).toEqual({
      atIso: "2026-07-13T14:05:00.000Z",
      findings: [],
      dispatchId: 4242,
      parseOk: true,
    });

    const blob = await readLatestSweepBlob();
    expect(blob).toEqual({
      atIso: "2026-07-13T14:05:00.000Z",
      findings: [],
      dispatchId: 4242,
      parseOk: true,
    });
  });

  it("an unparseable FINDINGS block persists parseOk=false and logs 'unparseable' — never counted as zero findings", async () => {
    STORES.dispatches.push({ id: 9, completedAt: new Date("2026-07-13T14:05:00Z"), queuedAt: NOW });
    await handleSweepCompletion(9, "I did things but forgot the block");
    expect(SETTING_INSERTS[0].value.parseOk).toBe(false);
    expect(SETTING_INSERTS[0].value.findings).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("findings unparseable"));
  });

  it("a second sweep UPDATES the existing blob row (single-key upsert)", async () => {
    STORES.dispatches.push({ id: 1, completedAt: new Date("2026-07-06T14:00:00Z"), queuedAt: NOW });
    await handleSweepCompletion(1, "FINDINGS: none");
    STORES.dispatches.push({ id: 2, completedAt: new Date("2026-07-13T14:00:00Z"), queuedAt: NOW });
    await handleSweepCompletion(
      2,
      'FINDINGS: [{"type":"contradiction","summary":"conflict","refs":["a:1"]}]',
    );
    expect(SETTING_INSERTS).toHaveLength(1);
    expect(SETTING_UPDATES).toHaveLength(1);
    expect(SETTING_UPDATES[0].value.findings).toHaveLength(1);
    expect(SETTING_UPDATES[0].value.dispatchId).toBe(2);
  });

  it("readLatestSweepBlob → null when no sweep has ever completed", async () => {
    expect(await readLatestSweepBlob()).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Surfaces — Letter paragraph + pulse sentence (silent-log tier, never an
// interrupt)
// ────────────────────────────────────────────────────────────────────────────

describe("buildConnectionsParagraph (The Letter)", () => {
  it("no blob yet → 'has not run yet'", () => {
    expect(buildConnectionsParagraph(null)).toBe("Connections sweep has not run yet.");
  });

  it("empty findings → the plain all-clear sentence with the sweep date, never padded", () => {
    const p = buildConnectionsParagraph({
      atIso: "2026-07-13T14:05:00.000Z",
      findings: [],
      parseOk: true,
    });
    expect(p).toBe(
      "Connections sweep: no contradictions, forgotten precedents, or stale doctrine found in the last sweep (2026-07-13).",
    );
  });

  it("findings → one line each with refs cited", () => {
    const p = buildConnectionsParagraph({
      atIso: "2026-07-13T14:05:00.000Z",
      parseOk: true,
      findings: [
        { type: "contradiction", summary: "Pricing raise conflicts with ruling", refs: ["decisions_inbox_items:11"] },
        { type: "stale_doctrine", summary: "Doc claims phase_1", refs: ["docs/company/mature-machine.md"] },
      ],
    });
    expect(p).toContain("2 findings");
    expect(p).toContain("- [contradiction] Pricing raise conflicts with ruling (refs: decisions_inbox_items:11)");
    expect(p).toContain("- [stale doctrine] Doc claims phase_1 (refs: docs/company/mature-machine.md)");
  });

  it("unparseable → says so instead of claiming an all-clear", () => {
    const p = buildConnectionsParagraph({
      atIso: "2026-07-13T14:05:00.000Z",
      findings: [],
      parseOk: false,
    });
    expect(p).toContain("findings unparseable");
    expect(p).not.toContain("no contradictions");
  });
});

describe("morning pulse sentence (buildFounderBrief)", () => {
  const baseInputs = {
    partOfDay: "morning" as const,
    founderName: "Tom",
    pulse: {
      mrr: 0,
      trials: 0,
      weeklySpendUsd: 0,
      envelopeStatus: "green" as const,
      uptimePct: null,
      dispatchesCompletedLast24h: 0,
      dispatchesFlaggedLast24h: 0,
      decisionsWaitingCount: 0,
    },
    openAsks: [],
    plannedFocus: null,
    operatingMode: null,
    trustLedger: [],
  };

  it("one sentence when findings exist", () => {
    const brief = buildFounderBrief({ ...baseInputs, sweep: { findingsCount: 3 } });
    // 2026-07-27: the sentence used to say "details in The Letter" — a
    // self-referential dead end (the reader IS on The Letter). It now names
    // the real destination: the monthly letter (founderNarrative.ts carries
    // the full sweep paragraph, sidebar "Monthly letter").
    expect(brief.theWord).toContain(
      "The weekly connections sweep flagged 3 items — the full list is in the monthly letter",
    );
  });

  it("SILENT when no findings, no sweep, or omitted — never padding, never an interrupt", () => {
    for (const sweep of [{ findingsCount: 0 }, null, undefined]) {
      const brief = buildFounderBrief({ ...baseInputs, sweep });
      expect(brief.theWord).not.toContain("connections sweep");
    }
  });
});
