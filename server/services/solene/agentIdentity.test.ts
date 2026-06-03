/**
 * Tests for the Solene persistent-agent-identity service (Layer 1 L1.4).
 *
 * Coverage:
 *  - recordAgentDecision inserts a row with the right shape
 *  - recordAgentDecision truncates summary at 500 chars
 *  - recordAgentDecision coerces unknown decisionKind to "other"
 *  - recordAgentDecision never throws on DB failure
 *  - loadAgentIdentityBlock returns the fallback when no rows exist
 *  - loadAgentIdentityBlock renders rows newest-first as expected markdown
 *  - loadAgentIdentityBlock filters by agentRole
 *  - loadAgentIdentityBlock honors the limit + caps at 50
 *  - loadAgentIdentityBlock truncates over-large blocks with the suffix
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
}

const ROWS: IdentityRow[] = [];
let nextRowId = 1;
let throwOnInsert = false;

interface PredicateInfo {
  roleEq?: string;
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
      if (node.op === "eq" && node.col === "agent_role") {
        info.roleEq = node.val;
      } else if (Array.isArray(node.preds)) {
        for (const c of node.preds) walk(c);
      }
    }
  }
}

function buildDbMock() {
  let pendingRoleEq: string | undefined;
  let pendingOrderDesc = false;
  let pendingLimit: number | undefined;

  const resetPending = () => {
    pendingRoleEq = undefined;
    pendingOrderDesc = false;
    pendingLimit = undefined;
  };

  const selectChain: any = {
    from() {
      return selectChain;
    },
    where(pred: any) {
      parseWhere(pred, (info) => {
        pendingRoleEq = info.roleEq;
      });
      return selectChain;
    },
    orderBy(_arg: any) {
      pendingOrderDesc = true;
      return selectChain;
    },
    limit(n: number) {
      pendingLimit = n;
      return selectChain;
    },
    then(onFulfilled: any, onRejected: any) {
      let out = [...ROWS];
      if (pendingRoleEq) out = out.filter((r) => r.agentRole === pendingRoleEq);
      if (pendingOrderDesc) {
        out.sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime());
      }
      if (pendingLimit !== undefined) out = out.slice(0, pendingLimit);
      resetPending();
      return Promise.resolve(out).then(onFulfilled, onRejected);
    },
  };

  return {
    insert: () => ({
      values: (row: any) => ({
        returning: async () => {
          if (throwOnInsert) {
            throw new Error("simulated db failure");
          }
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
          };
          ROWS.push(created);
          return [{ id: created.id }];
        },
      }),
    }),
    select: () => selectChain,
  };
}

vi.mock("../../db", () => ({ db: buildDbMock() }));

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    and: (...preds: unknown[]) => ({ preds }),
    eq: (col: any, val: unknown) => {
      const name =
        typeof col === "object" && col !== null && "name" in col
          ? (col as any).name
          : "unknown";
      return { op: "eq", col: name, val };
    },
    desc: (col: any) => ({ op: "desc", col }),
    sql: (() => {
      const tag: any = (_strings: TemplateStringsArray, ..._vals: unknown[]) => ({
        op: "sql",
      });
      return tag;
    })(),
  };
});

vi.mock("@shared/schema/solene-agent-identity", () => ({
  soleneAgentIdentityDecisions: {
    id: { name: "id" },
    agentRole: { name: "agent_role" },
    decidedAt: { name: "decided_at" },
    decisionKind: { name: "decision_kind" },
    summary: { name: "summary" },
    rationale: { name: "rationale" },
    referencedFiles: { name: "referenced_files" },
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
}));

import {
  recordAgentDecision,
  loadAgentIdentityBlock,
  IDENTITY_EMPTY_FALLBACK,
} from "./agentIdentity";

beforeEach(() => {
  ROWS.length = 0;
  nextRowId = 1;
  throwOnInsert = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
// recordAgentDecision
// ─────────────────────────────────────────────────────────────────────────

describe("recordAgentDecision", () => {
  it("inserts a row with the right shape and returns the id", async () => {
    const id = await recordAgentDecision({
      agentRole: "iris",
      decisionKind: "architecture",
      summary: "Chose pgvector over a separate vector store.",
      rationale: "Reuses existing Postgres connection pool.",
      referencedFiles: ["server/db.ts"],
      dispatchId: 42,
    });
    expect(id).toBeGreaterThan(0);
    expect(ROWS).toHaveLength(1);
    expect(ROWS[0].agentRole).toBe("iris");
    expect(ROWS[0].decisionKind).toBe("architecture");
    expect(ROWS[0].summary).toContain("pgvector");
    expect(ROWS[0].dispatchId).toBe(42);
    expect(ROWS[0].referencedFiles).toEqual(["server/db.ts"]);
  });

  it("truncates summary at 500 chars", async () => {
    await recordAgentDecision({
      agentRole: "soren",
      decisionKind: "policy",
      summary: "x".repeat(800),
      rationale: "y",
    });
    expect(ROWS[0].summary.length).toBe(500);
  });

  it("coerces unknown decisionKind to other", async () => {
    await recordAgentDecision({
      agentRole: "krieger",
      // intentionally bad input
      decisionKind: "ghost" as any,
      summary: "s",
      rationale: "r",
    });
    expect(ROWS[0].decisionKind).toBe("other");
  });

  it("never throws on db failure", async () => {
    throwOnInsert = true;
    const id = await recordAgentDecision({
      agentRole: "iris",
      decisionKind: "bug_fix",
      summary: "s",
      rationale: "r",
    });
    expect(id).toBe(0);
    expect(ROWS).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// loadAgentIdentityBlock
// ─────────────────────────────────────────────────────────────────────────

describe("loadAgentIdentityBlock", () => {
  it("returns the fallback when no rows exist", async () => {
    const out = await loadAgentIdentityBlock("iris");
    expect(out).toBe(IDENTITY_EMPTY_FALLBACK);
  });

  it("renders rows newest-first as bullet markdown", async () => {
    // Seed three rows on different dates.
    ROWS.push({
      id: 1,
      agentRole: "iris",
      decidedAt: new Date("2026-05-30T12:00:00Z"),
      decisionKind: "architecture",
      summary: "Chose A over B.",
      rationale: "Less coupling.",
      referencedFiles: ["a.ts"],
      dispatchId: 1,
      evidenceUrl: null,
      sessionToken: null,
    });
    ROWS.push({
      id: 2,
      agentRole: "iris",
      decidedAt: new Date("2026-06-01T12:00:00Z"),
      decisionKind: "bug_fix",
      summary: "Fixed leak in cache.",
      rationale: "TTL was unset.",
      referencedFiles: ["cache.ts", "cache.test.ts"],
      dispatchId: 2,
      evidenceUrl: null,
      sessionToken: null,
    });
    ROWS.push({
      id: 3,
      agentRole: "iris",
      decidedAt: new Date("2026-06-02T12:00:00Z"),
      decisionKind: "policy",
      summary: "No more `as any`.",
      rationale: "Enforced via type-check gate.",
      referencedFiles: [],
      dispatchId: 3,
      evidenceUrl: null,
      sessionToken: null,
    });

    const out = await loadAgentIdentityBlock("iris");

    // Newest first.
    const idxNewest = out.indexOf("2026-06-02");
    const idxMid = out.indexOf("2026-06-01");
    const idxOldest = out.indexOf("2026-05-30");
    expect(idxNewest).toBeGreaterThanOrEqual(0);
    expect(idxMid).toBeGreaterThan(idxNewest);
    expect(idxOldest).toBeGreaterThan(idxMid);

    // Shape: `- **YYYY-MM-DD** (kind): summary — rationale [files: ...]`
    expect(out).toContain(
      "- **2026-06-02** (policy): No more `as any`. — Enforced via type-check gate.",
    );
    expect(out).toContain(
      "- **2026-06-01** (bug_fix): Fixed leak in cache. — TTL was unset. [files: cache.ts, cache.test.ts]",
    );
    expect(out).toContain(
      "- **2026-05-30** (architecture): Chose A over B. — Less coupling. [files: a.ts]",
    );
    // No "files: " annotation when referencedFiles is empty.
    expect(
      out
        .split("\n")
        .find((l) => l.includes("2026-06-02"))!
        .includes("[files:"),
    ).toBe(false);
  });

  it("filters by agentRole", async () => {
    ROWS.push({
      id: 1,
      agentRole: "iris",
      decidedAt: new Date("2026-06-01T00:00:00Z"),
      decisionKind: "bug_fix",
      summary: "iris row",
      rationale: "r",
      referencedFiles: [],
      dispatchId: null,
      evidenceUrl: null,
      sessionToken: null,
    });
    ROWS.push({
      id: 2,
      agentRole: "soren",
      decidedAt: new Date("2026-06-01T00:00:00Z"),
      decisionKind: "policy",
      summary: "soren row",
      rationale: "r",
      referencedFiles: [],
      dispatchId: null,
      evidenceUrl: null,
      sessionToken: null,
    });

    const irisOut = await loadAgentIdentityBlock("iris");
    expect(irisOut).toContain("iris row");
    expect(irisOut).not.toContain("soren row");

    const sorenOut = await loadAgentIdentityBlock("soren");
    expect(sorenOut).toContain("soren row");
    expect(sorenOut).not.toContain("iris row");
  });

  it("honors the limit argument", async () => {
    for (let i = 0; i < 12; i++) {
      ROWS.push({
        id: i + 1,
        agentRole: "krieger",
        decidedAt: new Date(2026, 0, i + 1),
        decisionKind: "other",
        summary: `decision ${i}`,
        rationale: "r",
        referencedFiles: [],
        dispatchId: null,
        evidenceUrl: null,
        sessionToken: null,
      });
    }
    const out = await loadAgentIdentityBlock("krieger", 3);
    const bulletCount = out.split("\n").filter((l) => l.startsWith("- **")).length;
    expect(bulletCount).toBe(3);
  });

  it("truncates over-large blocks with the … [truncated] suffix", async () => {
    // Push enough rows with huge rationales to exceed 8 KB after rendering.
    for (let i = 0; i < 20; i++) {
      ROWS.push({
        id: i + 1,
        agentRole: "iris",
        decidedAt: new Date(2026, 0, i + 1),
        decisionKind: "architecture",
        summary: "s".repeat(400),
        rationale: "r".repeat(400),
        referencedFiles: [],
        dispatchId: null,
        evidenceUrl: null,
        sessionToken: null,
      });
    }
    const out = await loadAgentIdentityBlock("iris", 20);
    expect(out).toContain("… [truncated]");
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(8 * 1024 + 64);
  });
});
