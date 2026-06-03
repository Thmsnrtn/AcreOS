/**
 * Tests for the Solene time-aware-decisions service (Layer 4 L4.19).
 *
 * Coverage:
 *  - computeRevisitDueAt for all three horizons (deterministic fromDate)
 *  - setDecisionHorizon happy path stamps both columns
 *  - setDecisionHorizon honors customRevisitDueAt override
 *  - listDueForRevisit filters by cutoff
 *  - listDueForRevisit filters by agentRole
 *  - listDueForRevisit honors limit
 *  - markRevisited:
 *      * inserts a follow-up decision with kind='revisit'
 *      * clears original's revisit_due_at
 *      * when newHorizon set, applies to follow-up not original
 *  - scanOverdueRevisits returns counts + emits warn logs
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────
// Logger mock — capture warn calls to assert scanOverdueRevisits logging.
// ─────────────────────────────────────────────────────────────────────────
const warnSpy = vi.fn();
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: (...args: unknown[]) => warnSpy(...args),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────────────
// In-memory row store + db mock.
// ─────────────────────────────────────────────────────────────────────────
interface IdentityRow {
  id: number;
  agentRole: string;
  decidedAt: Date;
  decisionKind: string;
  summary: string;
  rationale: string;
  referencedFiles: string[];
  dispatchId: number | null;
  evidenceUrl: string | null;
  sessionToken: string | null;
  decisionHorizon: string | null;
  revisitDueAt: Date | null;
}

const ROWS: IdentityRow[] = [];
let nextRowId = 1;

interface PredicateInfo {
  idEq?: number;
  roleEq?: string;
  hasRevisitNotNull?: boolean;
  revisitLte?: Date;
}

function parseWhere(pred: any, set: (info: PredicateInfo) => void) {
  const info: PredicateInfo = {};
  walk(pred);
  set(info);
  function walk(node: any) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const c of node) walk(c);
      return;
    }
    if (typeof node === "object") {
      if (node.op === "eq" && node.col === "id") {
        info.idEq = node.val as number;
      } else if (node.op === "eq" && node.col === "agent_role") {
        info.roleEq = node.val as string;
      } else if (node.op === "isNotNull" && node.col === "revisit_due_at") {
        info.hasRevisitNotNull = true;
      } else if (node.op === "lte" && node.col === "revisit_due_at") {
        info.revisitLte = node.val as Date;
      } else if (Array.isArray(node.preds)) {
        for (const c of node.preds) walk(c);
      }
    }
  }
}

function rowMatches(row: IdentityRow, info: PredicateInfo): boolean {
  if (info.idEq !== undefined && row.id !== info.idEq) return false;
  if (info.roleEq !== undefined && row.agentRole !== info.roleEq) return false;
  if (info.hasRevisitNotNull && row.revisitDueAt === null) return false;
  if (info.revisitLte !== undefined) {
    if (row.revisitDueAt === null) return false;
    if (row.revisitDueAt.getTime() > info.revisitLte.getTime()) return false;
  }
  return true;
}

function buildDbMock() {
  let selectPred: PredicateInfo = {};
  let selectOrderAsc = false;
  let selectLimit: number | undefined;

  const resetSelect = () => {
    selectPred = {};
    selectOrderAsc = false;
    selectLimit = undefined;
  };

  const selectChain: any = {
    from() {
      return selectChain;
    },
    where(pred: any) {
      parseWhere(pred, (info) => {
        selectPred = info;
      });
      return selectChain;
    },
    orderBy(_arg: any) {
      selectOrderAsc = true;
      return selectChain;
    },
    limit(n: number) {
      selectLimit = n;
      return selectChain;
    },
    then(onFulfilled: any, onRejected: any) {
      let out = ROWS.filter((r) => rowMatches(r, selectPred));
      if (selectOrderAsc) {
        out.sort((a, b) => {
          const ad = a.revisitDueAt?.getTime() ?? 0;
          const bd = b.revisitDueAt?.getTime() ?? 0;
          return ad - bd;
        });
      }
      if (selectLimit !== undefined) out = out.slice(0, selectLimit);
      resetSelect();
      return Promise.resolve(out).then(onFulfilled, onRejected);
    },
  };

  return {
    insert: () => ({
      values: (row: any) => ({
        returning: async () => {
          const created: IdentityRow = {
            id: nextRowId++,
            agentRole: row.agentRole,
            decidedAt: row.decidedAt ?? new Date(),
            decisionKind: row.decisionKind,
            summary: row.summary,
            rationale: row.rationale,
            referencedFiles: row.referencedFiles ?? [],
            dispatchId: row.dispatchId ?? null,
            evidenceUrl: row.evidenceUrl ?? null,
            sessionToken: row.sessionToken ?? null,
            decisionHorizon: row.decisionHorizon ?? null,
            revisitDueAt: row.revisitDueAt ?? null,
          };
          ROWS.push(created);
          return [{ id: created.id }];
        },
      }),
    }),
    select: () => selectChain,
    update: () => ({
      set: (patch: any) => ({
        where: async (pred: any) => {
          let info: PredicateInfo = {};
          parseWhere(pred, (i) => {
            info = i;
          });
          for (const row of ROWS) {
            if (!rowMatches(row, info)) continue;
            if ("decisionHorizon" in patch) {
              row.decisionHorizon = patch.decisionHorizon ?? null;
            }
            if ("revisitDueAt" in patch) {
              row.revisitDueAt = patch.revisitDueAt ?? null;
            }
            if ("decisionKind" in patch) {
              row.decisionKind = patch.decisionKind;
            }
          }
          return undefined;
        },
      }),
    }),
  };
}

vi.mock("../../db", () => ({ db: buildDbMock() }));

// ─────────────────────────────────────────────────────────────────────────
// drizzle-orm shim — record op + col so parseWhere can introspect.
// ─────────────────────────────────────────────────────────────────────────
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  const colName = (col: any) =>
    typeof col === "object" && col !== null && "name" in col
      ? (col as any).name
      : "unknown";
  return {
    ...actual,
    and: (...preds: unknown[]) => ({ preds }),
    eq: (col: any, val: unknown) => ({ op: "eq", col: colName(col), val }),
    lte: (col: any, val: unknown) => ({ op: "lte", col: colName(col), val }),
    isNotNull: (col: any) => ({ op: "isNotNull", col: colName(col) }),
    asc: (col: any) => ({ op: "asc", col: colName(col) }),
    desc: (col: any) => ({ op: "desc", col: colName(col) }),
    sql: (() => {
      const tag: any = (_strings: TemplateStringsArray, ..._vals: unknown[]) => ({
        op: "sql",
      });
      return tag;
    })(),
  };
});

// ─────────────────────────────────────────────────────────────────────────
// Schema shim — column tokens that carry their snake_case name through to
// the drizzle-orm shim above.
// ─────────────────────────────────────────────────────────────────────────
vi.mock("@shared/schema/solene-agent-identity", () => ({
  soleneAgentIdentityDecisions: {
    id: { name: "id" },
    agentRole: { name: "agent_role" },
    decidedAt: { name: "decided_at" },
    decisionKind: { name: "decision_kind" },
    summary: { name: "summary" },
    rationale: { name: "rationale" },
    referencedFiles: { name: "referenced_files" },
    dispatchId: { name: "dispatch_id" },
    evidenceUrl: { name: "evidence_url" },
    sessionToken: { name: "session_token" },
    decisionHorizon: { name: "decision_horizon" },
    revisitDueAt: { name: "revisit_due_at" },
  },
  IDENTITY_BLOCK_DEFAULT_LIMIT: 10,
  IDENTITY_BLOCK_MAX_BYTES: 8 * 1024,
  IDENTITY_SUMMARY_MAX_CHARS: 500,
  IDENTITY_DECISION_KINDS: [
    "architecture",
    "bug_fix",
    "policy",
    "escalation",
    "other",
  ],
  DECISION_HORIZONS: ["immediate", "quarter", "year"],
}));

// ─────────────────────────────────────────────────────────────────────────
// Imports — must come after the mocks so the service binds to the mocked db.
// ─────────────────────────────────────────────────────────────────────────
import {
  computeRevisitDueAt,
  setDecisionHorizon,
  listDueForRevisit,
  markRevisited,
  scanOverdueRevisits,
} from "./timeAwareDecisions";

// Helpers --------------------------------------------------------------------

function seedRow(partial: Partial<IdentityRow> = {}): IdentityRow {
  const row: IdentityRow = {
    id: partial.id ?? nextRowId++,
    agentRole: partial.agentRole ?? "iris",
    decidedAt: partial.decidedAt ?? new Date("2026-06-01T00:00:00Z"),
    decisionKind: partial.decisionKind ?? "architecture",
    summary: partial.summary ?? "seed summary",
    rationale: partial.rationale ?? "seed rationale",
    referencedFiles: partial.referencedFiles ?? [],
    dispatchId: partial.dispatchId ?? null,
    evidenceUrl: partial.evidenceUrl ?? null,
    sessionToken: partial.sessionToken ?? null,
    decisionHorizon: partial.decisionHorizon ?? null,
    revisitDueAt: partial.revisitDueAt ?? null,
  };
  ROWS.push(row);
  return row;
}

beforeEach(() => {
  ROWS.length = 0;
  nextRowId = 1;
  warnSpy.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
// computeRevisitDueAt
// ─────────────────────────────────────────────────────────────────────────

describe("computeRevisitDueAt", () => {
  const FROM = new Date("2026-06-01T00:00:00Z");
  const DAY = 24 * 60 * 60 * 1000;

  it("immediate horizon → +7 days", () => {
    const out = computeRevisitDueAt("immediate", FROM);
    expect(out.getTime() - FROM.getTime()).toBe(7 * DAY);
  });

  it("quarter horizon → +90 days", () => {
    const out = computeRevisitDueAt("quarter", FROM);
    expect(out.getTime() - FROM.getTime()).toBe(90 * DAY);
  });

  it("year horizon → +365 days", () => {
    const out = computeRevisitDueAt("year", FROM);
    expect(out.getTime() - FROM.getTime()).toBe(365 * DAY);
  });

  it("does not mutate the supplied fromDate", () => {
    const start = FROM.getTime();
    computeRevisitDueAt("quarter", FROM);
    expect(FROM.getTime()).toBe(start);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// setDecisionHorizon
// ─────────────────────────────────────────────────────────────────────────

describe("setDecisionHorizon", () => {
  it("stamps horizon + auto-computed revisitDueAt", async () => {
    const row = seedRow({ agentRole: "iris" });
    const before = Date.now();
    await setDecisionHorizon({ decisionId: row.id, horizon: "immediate" });
    expect(row.decisionHorizon).toBe("immediate");
    expect(row.revisitDueAt).toBeInstanceOf(Date);
    const dueMs = row.revisitDueAt!.getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(dueMs - before).toBeGreaterThanOrEqual(sevenDays - 5_000);
    expect(dueMs - before).toBeLessThanOrEqual(sevenDays + 5_000);
  });

  it("honors customRevisitDueAt override", async () => {
    const row = seedRow();
    const custom = new Date("2027-01-01T00:00:00Z");
    await setDecisionHorizon({
      decisionId: row.id,
      horizon: "quarter",
      customRevisitDueAt: custom,
    });
    expect(row.decisionHorizon).toBe("quarter");
    expect(row.revisitDueAt?.getTime()).toBe(custom.getTime());
  });
});

// ─────────────────────────────────────────────────────────────────────────
// listDueForRevisit
// ─────────────────────────────────────────────────────────────────────────

describe("listDueForRevisit", () => {
  it("filters by cutoff (returns only rows due at-or-before cutoff)", async () => {
    seedRow({ id: 100, revisitDueAt: new Date("2026-05-01T00:00:00Z") }); // overdue
    seedRow({ id: 101, revisitDueAt: new Date("2026-06-01T00:00:00Z") }); // overdue
    seedRow({ id: 102, revisitDueAt: new Date("2027-01-01T00:00:00Z") }); // future
    seedRow({ id: 103, revisitDueAt: null }); // never scheduled

    const cutoff = new Date("2026-06-15T00:00:00Z");
    const out = await listDueForRevisit({ cutoff });
    const ids = out.map((r) => r.id).sort();
    expect(ids).toEqual([100, 101]);
  });

  it("filters by agentRole", async () => {
    const past = new Date("2026-05-01T00:00:00Z");
    seedRow({ agentRole: "iris", revisitDueAt: past });
    seedRow({ agentRole: "soren", revisitDueAt: past });
    seedRow({ agentRole: "krieger", revisitDueAt: past });

    const out = await listDueForRevisit({
      agentRole: "soren",
      cutoff: new Date("2026-06-15T00:00:00Z"),
    });
    expect(out).toHaveLength(1);
    expect(out[0].agentRole).toBe("soren");
  });

  it("honors the limit", async () => {
    const past = new Date("2026-05-01T00:00:00Z");
    for (let i = 0; i < 8; i++) {
      seedRow({ agentRole: "iris", revisitDueAt: past });
    }
    const out = await listDueForRevisit({
      cutoff: new Date("2026-06-15T00:00:00Z"),
      limit: 3,
    });
    expect(out).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// markRevisited
// ─────────────────────────────────────────────────────────────────────────

describe("markRevisited", () => {
  it("inserts follow-up, clears original revisit, marks kind='revisit'", async () => {
    const original = seedRow({
      agentRole: "iris",
      decisionKind: "architecture",
      summary: "Original decision",
      rationale: "Original rationale",
      dispatchId: 42,
      sessionToken: "sess-abc",
      decisionHorizon: "quarter",
      revisitDueAt: new Date("2026-05-01T00:00:00Z"),
    });

    const { followUpDecisionId } = await markRevisited(original.id, {
      followUpSummary: "Revisited: still the right call.",
      followUpRationale: "Conditions unchanged after 90d.",
    });

    expect(followUpDecisionId).toBeGreaterThan(0);

    // Original was cleared.
    const originalAfter = ROWS.find((r) => r.id === original.id)!;
    expect(originalAfter.revisitDueAt).toBeNull();
    // Horizon stays as historical record on the original.
    expect(originalAfter.decisionHorizon).toBe("quarter");

    // Follow-up was inserted with kind='revisit'.
    const followUp = ROWS.find((r) => r.id === followUpDecisionId)!;
    expect(followUp.decisionKind).toBe("revisit");
    expect(followUp.agentRole).toBe("iris");
    expect(followUp.summary).toBe("Revisited: still the right call.");
    expect(followUp.dispatchId).toBe(42);
    expect(followUp.sessionToken).toBe("sess-abc");
    // No new horizon by default — follow-up has none.
    expect(followUp.decisionHorizon).toBeNull();
    expect(followUp.revisitDueAt).toBeNull();
  });

  it("applies newHorizon to follow-up, not original", async () => {
    const original = seedRow({
      agentRole: "soren",
      decisionHorizon: "immediate",
      revisitDueAt: new Date("2026-05-15T00:00:00Z"),
    });

    const { followUpDecisionId } = await markRevisited(original.id, {
      followUpSummary: "Escalating to quarter cadence.",
      followUpRationale: "Stabilized enough to widen window.",
      newHorizon: "quarter",
    });

    const originalAfter = ROWS.find((r) => r.id === original.id)!;
    // Original keeps its old horizon but revisit cleared.
    expect(originalAfter.decisionHorizon).toBe("immediate");
    expect(originalAfter.revisitDueAt).toBeNull();

    const followUp = ROWS.find((r) => r.id === followUpDecisionId)!;
    expect(followUp.decisionHorizon).toBe("quarter");
    expect(followUp.revisitDueAt).toBeInstanceOf(Date);
  });

  it("returns 0 follow-up id when original is missing", async () => {
    const { followUpDecisionId } = await markRevisited(999, {
      followUpSummary: "x",
      followUpRationale: "y",
    });
    expect(followUpDecisionId).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// scanOverdueRevisits
// ─────────────────────────────────────────────────────────────────────────

describe("scanOverdueRevisits", () => {
  it("returns counts and writes a warn line per overdue decision", async () => {
    const past = new Date("2026-05-01T00:00:00Z");
    seedRow({ agentRole: "iris", revisitDueAt: past, summary: "iris-a" });
    seedRow({ agentRole: "iris", revisitDueAt: past, summary: "iris-b" });
    seedRow({ agentRole: "soren", revisitDueAt: past, summary: "soren-a" });
    seedRow({ agentRole: "krieger", revisitDueAt: null }); // skipped

    const result = await scanOverdueRevisits();
    expect(result.scanned).toBe(3);
    expect(result.overdue).toBe(3);
    expect(result.byAgent).toEqual({ iris: 2, soren: 1 });

    const overdueWarnings = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("overdue revisit"),
    );
    expect(overdueWarnings).toHaveLength(3);
  });

  it("returns zero counts when nothing is overdue", async () => {
    seedRow({ revisitDueAt: null });
    const result = await scanOverdueRevisits();
    expect(result.scanned).toBe(0);
    expect(result.overdue).toBe(0);
    expect(result.byAgent).toEqual({});
  });
});
