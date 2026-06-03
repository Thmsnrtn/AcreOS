/**
 * Tests for the L4.18 model-upgrade path.
 *
 *   - classifyAnthropicEvent covers all 5 enum kinds + null on unrelated.
 *   - decideAction covers each branch of the decision matrix.
 *   - processWatchEvent persists a row + pages on adopt_now + skips
 *     duplicates (UNIQUE source_event_id).
 *   - processUnactionedEvents counts + filters correctly.
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

// ---------- Pager mock ----------------------------------------------------

const PAGE_CALLS: Array<{ severity: string; subject: string; body: string }> =
  [];
vi.mock("../solene/pagerService", () => ({
  sendSolenePage: vi.fn(async (input: any) => {
    PAGE_CALLS.push({
      severity: input.severity,
      subject: input.subject,
      body: input.body,
    });
    return {
      eventId: 1,
      deliveryStatus: "delivered",
      deliveryDetail: null,
    };
  }),
}));

// ---------- DB mock --------------------------------------------------------
// In-memory tables emulate external_watch_events + recommendation rows.

interface FakeEvent {
  id: number;
  source: string;
  sourceUrl: string;
  title: string;
  summary: string;
  ackStatus: string;
  publishedAt: Date;
}
interface FakeRecommendation {
  id: number;
  sourceEventId: number | null;
  eventKind: string;
  affectedModel: string;
  currentModelInUse: string;
  recommendation: string;
  rationale: string;
}

const EVENTS: FakeEvent[] = [];
const RECOMMENDATIONS: FakeRecommendation[] = [];
let nextRecommendationId = 1;

vi.mock("../../db", () => {
  const tableName = (t: unknown): string => {
    if (typeof t === "object" && t !== null) {
      // Drizzle pgTable objects expose Symbol.for("drizzle:Name") with the
      // SQL table name. Honour that primary path first; fall back to other
      // structural hints for robustness across drizzle versions.
      const drizzleName = (t as any)[Symbol.for("drizzle:Name")];
      if (typeof drizzleName === "string") return drizzleName;
      const name = (t as any).__name ?? (t as any).name;
      if (typeof name === "string") return name;
    }
    return "";
  };

  // Track current select/where state across the fluent chain.
  let currentSelect: {
    table: string;
    join: string | null;
    whereFn: ((row: any) => boolean) | null;
  } = { table: "", join: null, whereFn: null };

  // Trivial expression-tree: callers build via and/eq/isNull below.
  const makeChain = (initial: string) => {
    currentSelect = { table: initial, join: null, whereFn: null };
    const chain: any = {
      from(t: unknown) {
        currentSelect.table = tableName(t) || currentSelect.table;
        return chain;
      },
      leftJoin(t: unknown, _on: unknown) {
        currentSelect.join = tableName(t);
        return chain;
      },
      where(predicate: any) {
        currentSelect.whereFn = predicate;
        return chain;
      },
      limit(_n: number) {
        return chain.then((rows: any[]) => rows);
      },
      then(resolve: any) {
        const rows = runSelect();
        return Promise.resolve(rows).then(resolve);
      },
    };
    return chain;
  };

  const runSelect = (): any[] => {
    const { table, join, whereFn } = currentSelect;
    if (table === "external_watch_events" && !join) {
      return EVENTS.filter((e) => (whereFn ? whereFn(e) : true));
    }
    if (table === "external_watch_events" && join === "solene_model_upgrade_recommendations") {
      // Emulate LEFT JOIN — for each event, attach matching recommendation (or null).
      const joined = EVENTS.map((e) => {
        const rec = RECOMMENDATIONS.find((r) => r.sourceEventId === e.id);
        return {
          id: e.id,
          recommendationId: rec ? rec.id : null,
          ackStatus: e.ackStatus,
          source: e.source,
        };
      });
      return joined.filter((row) => (whereFn ? whereFn(row) : true));
    }
    return [];
  };

  const db = {
    select(_proj?: unknown) {
      return makeChain("");
    },
    insert(t: unknown) {
      const target = tableName(t);
      return {
        values(row: any) {
          let conflictSkip = false;
          const builder = {
            onConflictDoNothing(_args: unknown) {
              // Honor UNIQUE(source_event_id) for recommendations.
              if (
                target === "solene_model_upgrade_recommendations" &&
                row.sourceEventId !== undefined &&
                row.sourceEventId !== null
              ) {
                const dup = RECOMMENDATIONS.find(
                  (r) => r.sourceEventId === row.sourceEventId,
                );
                if (dup) conflictSkip = true;
              }
              return builder;
            },
            returning(_proj: unknown) {
              if (conflictSkip) return Promise.resolve([]);
              if (target === "solene_model_upgrade_recommendations") {
                const inserted: FakeRecommendation = {
                  id: nextRecommendationId++,
                  sourceEventId: row.sourceEventId ?? null,
                  eventKind: row.eventKind,
                  affectedModel: row.affectedModel,
                  currentModelInUse: row.currentModelInUse,
                  recommendation: row.recommendation,
                  rationale: row.rationale,
                };
                RECOMMENDATIONS.push(inserted);
                return Promise.resolve([{ id: inserted.id }]);
              }
              return Promise.resolve([{ id: 0 }]);
            },
          };
          return builder;
        },
      };
    },
  };

  return { db };
});

// drizzle-orm helpers — we override and/eq/isNull to return functions the
// fake select chain can apply directly to in-memory rows.
vi.mock("drizzle-orm", () => {
  const eq = (col: any, value: any) => (row: any) =>
    resolveColValue(row, col) === value;
  const and =
    (...preds: any[]) =>
    (row: any) =>
      preds.every((p) => (typeof p === "function" ? p(row) : true));
  const isNull = (col: any) => (row: any) => {
    const v = resolveColValue(row, col);
    return v === null || v === undefined;
  };
  return { eq, and, isNull };
});

// Map a drizzle "column" reference to the corresponding field on our
// in-memory rows. Because schemas declare names like text("source"), the
// runtime column object exposes that name on a non-stable key — we lean
// on the structural hints we attached to fake-row shape.
function resolveColValue(row: any, col: any): any {
  if (!row || typeof row !== "object") return undefined;
  if (col === undefined || col === null) return undefined;
  let sqlName: string =
    col?.name ??
    col?.fieldAlias ??
    col?.columnName ??
    (col as any)[Symbol.for("drizzle:Name")] ??
    "";
  if (typeof sqlName !== "string") sqlName = "";
  const tableName: string =
    col?.table?.[Symbol.for("drizzle:Name")] ??
    col?.table?.name ??
    "";
  // Disambiguate "id" between event vs recommendation join — when the
  // column belongs to the recommendations table, map "id" to the joined
  // row's `recommendationId` alias rather than the event id.
  if (
    tableName === "solene_model_upgrade_recommendations" &&
    sqlName === "id" &&
    "recommendationId" in row
  ) {
    return row.recommendationId;
  }
  const camel = sqlName ? sqlToCamel(sqlName) : "";
  if (camel && camel in row) return row[camel];
  if (sqlName && sqlName in row) return row[sqlName];
  return undefined;
}

function sqlToCamel(sql: string): string {
  return sql.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

beforeEach(() => {
  EVENTS.length = 0;
  RECOMMENDATIONS.length = 0;
  PAGE_CALLS.length = 0;
  nextRecommendationId = 1;
  delete process.env.SOLENE_DISPATCH_MODEL;
});

afterEach(() => {
  vi.clearAllMocks();
});

import {
  classifyAnthropicEvent,
  decideAction,
  getCurrentDispatchModel,
  processWatchEvent,
  processUnactionedEvents,
} from "./modelUpgradePath";

// ============================================================================
// classifyAnthropicEvent
// ============================================================================

describe("classifyAnthropicEvent", () => {
  it("returns null on a generic / unrelated announcement", () => {
    const result = classifyAnthropicEvent({
      title: "Quarterly community update",
      body: "Highlights from the developer community.",
      sourceUrl: "https://docs.anthropic.com/en/release-notes/api#community",
    });
    expect(result).toBeNull();
  });

  it("classifies a new model release", () => {
    const result = classifyAnthropicEvent({
      title: "Claude Opus 4.8 is now generally available",
      body: "Ships with improved coding benchmarks and 1M context.",
      sourceUrl: "https://docs.anthropic.com/x",
    });
    expect(result).toEqual({
      kind: "new_model_available",
      affectedModel: "claude-opus-4.8",
    });
  });

  it("classifies a deprecation notice", () => {
    const result = classifyAnthropicEvent({
      title: "Deprecation: claude-2.1 reaches EOL 2026-12-31",
      body: "Migration guide below.",
      sourceUrl: "https://docs.anthropic.com/x",
    });
    expect(result?.kind).toBe("model_deprecated");
    expect(result?.affectedModel).toBe("claude-2.1");
  });

  it("classifies a pricing change", () => {
    const result = classifyAnthropicEvent({
      title: "Pricing update for Claude Haiku 3.5",
      body: "Input pricing reduced by 15% per million tokens.",
      sourceUrl: "https://docs.anthropic.com/x",
    });
    expect(result).toEqual({
      kind: "pricing_change",
      affectedModel: "claude-haiku-3.5",
    });
  });

  it("classifies a feature addition", () => {
    const result = classifyAnthropicEvent({
      title: "Extended thinking now available on Claude Sonnet 4.6",
      body: "Tool-use loops can opt in to extended thinking blocks.",
      sourceUrl: "https://docs.anthropic.com/x",
    });
    expect(result?.kind).toBe("feature_added");
  });

  it("classifies a rate-limit change", () => {
    const result = classifyAnthropicEvent({
      title: "Rate limit table refresh for Claude Opus 4.7",
      body: "New tier limits for tier 4 customers.",
      sourceUrl: "https://docs.anthropic.com/x",
    });
    expect(result?.kind).toBe("rate_limit_change");
    expect(result?.affectedModel).toBe("claude-opus-4.7");
  });

  it("prioritises deprecation over new-model when both wordings appear", () => {
    const result = classifyAnthropicEvent({
      title: "Deprecation timeline for claude-opus-4.5 (new release notes)",
      body: "EOL 2026-12-31; please migrate to Opus 4.7.",
      sourceUrl: "https://docs.anthropic.com/x",
    });
    expect(result?.kind).toBe("model_deprecated");
    expect(result?.affectedModel).toBe("claude-opus-4.5");
  });
});

// ============================================================================
// decideAction
// ============================================================================

describe("decideAction", () => {
  it("deprecation of in-use model → adopt_now", () => {
    const out = decideAction(
      {
        kind: "model_deprecated",
        affectedModel: "claude-opus-4.7",
        body: "EOL announcement.",
      },
      "claude-opus-4-7",
    );
    expect(out.recommendation).toBe("adopt_now");
    expect(out.rationale).toMatch(/deprecation/i);
  });

  it("pricing decrease on in-use model → flag_only", () => {
    const out = decideAction(
      {
        kind: "pricing_change",
        affectedModel: "claude-opus-4.7",
        body: "Input pricing reduced by 15%.",
      },
      "claude-opus-4-7",
    );
    expect(out.recommendation).toBe("flag_only");
    expect(out.rationale).toMatch(/decrease/i);
  });

  it("pricing increase 12% on in-use model → schedule_eval", () => {
    const out = decideAction(
      {
        kind: "pricing_change",
        affectedModel: "claude-opus-4.7",
        body: "Pricing increase of 12% effective next quarter.",
      },
      "claude-opus-4-7",
    );
    expect(out.recommendation).toBe("schedule_eval");
    expect(out.rationale).toMatch(/12/);
  });

  it("pricing increase 5% on in-use model → flag_only (under threshold)", () => {
    const out = decideAction(
      {
        kind: "pricing_change",
        affectedModel: "claude-opus-4.7",
        body: "Pricing raised by 5%.",
      },
      "claude-opus-4-7",
    );
    expect(out.recommendation).toBe("flag_only");
  });

  it("same-family new model → schedule_eval", () => {
    const out = decideAction(
      {
        kind: "new_model_available",
        affectedModel: "claude-opus-4.8",
        body: "GA.",
      },
      "claude-opus-4-7",
    );
    expect(out.recommendation).toBe("schedule_eval");
  });

  it("different-family new model → flag_only", () => {
    const out = decideAction(
      {
        kind: "new_model_available",
        affectedModel: "claude-haiku-4.0",
        body: "GA.",
      },
      "claude-opus-4-7",
    );
    expect(out.recommendation).toBe("flag_only");
  });

  it("feature addition → flag_only", () => {
    const out = decideAction(
      { kind: "feature_added", affectedModel: "all", body: "" },
      "claude-opus-4-7",
    );
    expect(out.recommendation).toBe("flag_only");
  });

  it("rate-limit change on in-use model → flag_only", () => {
    const out = decideAction(
      { kind: "rate_limit_change", affectedModel: "claude-opus-4.7", body: "" },
      "claude-opus-4-7",
    );
    expect(out.recommendation).toBe("flag_only");
  });
});

// ============================================================================
// getCurrentDispatchModel
// ============================================================================

describe("getCurrentDispatchModel", () => {
  it("returns default when env unset", () => {
    expect(getCurrentDispatchModel()).toBe("claude-opus-4-7");
  });
  it("uses SOLENE_DISPATCH_MODEL env override", () => {
    process.env.SOLENE_DISPATCH_MODEL = "claude-opus-4-8";
    expect(getCurrentDispatchModel()).toBe("claude-opus-4-8");
  });
});

// ============================================================================
// processWatchEvent
// ============================================================================

describe("processWatchEvent", () => {
  it("persists a recommendation row for a classifiable event", async () => {
    EVENTS.push({
      id: 100,
      source: "anthropic_api",
      sourceUrl: "https://docs.anthropic.com/x",
      title: "Pricing update for Claude Haiku 3.5",
      summary: "Input pricing reduced by 15%.",
      ackStatus: "pending",
      publishedAt: new Date(),
    });

    const result = await processWatchEvent(100);
    expect(result.classification?.kind).toBe("pricing_change");
    expect(result.recommendationId).not.toBeNull();
    expect(RECOMMENDATIONS).toHaveLength(1);
    expect(RECOMMENDATIONS[0].recommendation).toBe("flag_only");
    expect(RECOMMENDATIONS[0].affectedModel).toBe("claude-haiku-3.5");
  });

  it("pages Solene urgent on adopt_now (deprecation of in-use model)", async () => {
    EVENTS.push({
      id: 101,
      source: "anthropic_api",
      sourceUrl: "https://docs.anthropic.com/y",
      title: "Deprecation: claude-opus-4.7 reaches EOL 2026-12-31",
      summary: "Migrate to the next Opus before the deadline.",
      ackStatus: "pending",
      publishedAt: new Date(),
    });

    const result = await processWatchEvent(101);
    expect(result.classification?.kind).toBe("model_deprecated");
    expect(RECOMMENDATIONS[0].recommendation).toBe("adopt_now");
    expect(PAGE_CALLS).toHaveLength(1);
    expect(PAGE_CALLS[0].severity).toBe("urgent");
    expect(PAGE_CALLS[0].subject).toMatch(/claude-opus-4\.7/);
  });

  it("does NOT page on flag_only / schedule_eval", async () => {
    EVENTS.push({
      id: 102,
      source: "anthropic_api",
      sourceUrl: "https://docs.anthropic.com/z",
      title: "Extended thinking now available on Claude Sonnet 4.6",
      summary: "New feature.",
      ackStatus: "pending",
      publishedAt: new Date(),
    });
    await processWatchEvent(102);
    expect(PAGE_CALLS).toHaveLength(0);
  });

  it("skips duplicate events (UNIQUE source_event_id)", async () => {
    EVENTS.push({
      id: 103,
      source: "anthropic_api",
      sourceUrl: "https://docs.anthropic.com/dup",
      title: "Pricing update for Claude Haiku 3.5",
      summary: "Input pricing reduced by 10%.",
      ackStatus: "pending",
      publishedAt: new Date(),
    });
    const first = await processWatchEvent(103);
    const second = await processWatchEvent(103);
    expect(first.recommendationId).not.toBeNull();
    expect(second.recommendationId).toBeNull();
    expect(RECOMMENDATIONS).toHaveLength(1);
  });

  it("returns null classification for an unrelated event", async () => {
    EVENTS.push({
      id: 104,
      source: "anthropic_api",
      sourceUrl: "https://docs.anthropic.com/community",
      title: "Quarterly community update",
      summary: "Hackathon recap.",
      ackStatus: "pending",
      publishedAt: new Date(),
    });
    const result = await processWatchEvent(104);
    expect(result.classification).toBeNull();
    expect(result.recommendationId).toBeNull();
    expect(RECOMMENDATIONS).toHaveLength(0);
  });

  it("returns null when the event id does not exist", async () => {
    const result = await processWatchEvent(99999);
    expect(result.classification).toBeNull();
    expect(result.recommendationId).toBeNull();
  });
});

// ============================================================================
// processUnactionedEvents
// ============================================================================

describe("processUnactionedEvents", () => {
  it("processes only anthropic events that lack a recommendation", async () => {
    EVENTS.push(
      {
        id: 200,
        source: "anthropic_api",
        sourceUrl: "https://docs.anthropic.com/a",
        title: "Pricing update for Claude Haiku 3.5",
        summary: "Input pricing reduced by 15%.",
        ackStatus: "pending",
        publishedAt: new Date(),
      },
      {
        id: 201,
        source: "anthropic_api",
        sourceUrl: "https://docs.anthropic.com/b",
        title: "Quarterly community update",
        summary: "Recap.",
        ackStatus: "pending",
        publishedAt: new Date(),
      },
      {
        id: 202,
        source: "npm_vuln",
        sourceUrl: "https://github.com/advisories/GHSA-xxx",
        title: "Some npm CVE",
        summary: "irrelevant",
        ackStatus: "pending",
        publishedAt: new Date(),
      },
      {
        id: 203,
        source: "anthropic_api",
        sourceUrl: "https://docs.anthropic.com/d",
        title: "Deprecation: claude-2.1 reaches EOL",
        summary: "Migrate before EOL.",
        ackStatus: "pending",
        publishedAt: new Date(),
      },
    );
    // Pre-existing recommendation for event 200 — should be skipped.
    RECOMMENDATIONS.push({
      id: 9999,
      sourceEventId: 200,
      eventKind: "pricing_change",
      affectedModel: "claude-haiku-3.5",
      currentModelInUse: "claude-opus-4-7",
      recommendation: "flag_only",
      rationale: "preexisting",
    });
    nextRecommendationId = 10000;

    const result = await processUnactionedEvents();

    // 201 + 203 are processed (200 skipped by left join, 202 filtered by source).
    expect(result.processed).toBe(2);
    // 201 classifies to null (unrelated); 203 classifies to deprecation.
    expect(result.recommended).toBe(1);
  });
});
