/**
 * Tests for Solene agent-claims service (Layer 1 capability #2).
 *
 * Coverage:
 *  - claimSurfaces validates inputs + persists rows
 *  - computePatternOverlap positive cases (overlap detected)
 *  - computePatternOverlap negative cases (no overlap)
 *  - matchesGlob for the pre-commit-hook helper path
 *  - findConflictingClaims excludes released/expired + filters by excludeClaimId
 *  - releaseClaim is idempotent + only affects active rows
 *  - expireStaleClaims walks TTL-expired active rows + returns count
 *  - predictDispatchConflicts is the same surface as findConflictingClaims
 *  - isFileUnderClaim returns the conflicting claim or null
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

interface ClaimRow {
  id: number;
  dispatchId: number | null;
  agentRole: string;
  claimedAt: Date;
  releasedAt: Date | null;
  ttlMinutes: number;
  fileSurfacePatterns: string[];
  claimStatus: string;
  note: string | null;
}

const CLAIMS: ClaimRow[] = [];
let nextClaimId = 1;

// The mock db implements a tiny in-memory state machine that supports the
// query shapes agentClaims.ts uses: insert().values().returning(),
// select().from().where(), update().set().where().returning().
function buildDbMock() {
  // The where-predicate the service builds is opaque to the mock; tag
  // each call so the mock can run the appropriate filter from CLAIMS.
  let pendingExclude: number | undefined;
  let pendingStatusFilter: string | undefined;
  let pendingExpireExpression = false;
  let pendingClaimIdAndActive: number | undefined;

  const resetPending = () => {
    pendingExclude = undefined;
    pendingStatusFilter = undefined;
    pendingExpireExpression = false;
    pendingClaimIdAndActive = undefined;
  };

  return {
    insert: () => ({
      values: (row: any) => ({
        returning: async () => {
          const created: ClaimRow = {
            id: nextClaimId++,
            dispatchId: row.dispatchId ?? null,
            agentRole: row.agentRole,
            claimedAt: row.claimedAt ?? new Date(),
            releasedAt: row.releasedAt ?? null,
            ttlMinutes: row.ttlMinutes ?? 60,
            fileSurfacePatterns: row.fileSurfacePatterns ?? [],
            claimStatus: row.claimStatus ?? "active",
            note: row.note ?? null,
          };
          CLAIMS.push(created);
          return [{ id: created.id }];
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: (pred: any) => {
          // Decode the predicate by walking its structure (set by the mocked
          // drizzle helpers below).
          parseWherePredicate(pred, (info) => {
            pendingExclude = info.excludeId;
            pendingStatusFilter = info.statusFilter;
          });
          const out = CLAIMS.filter((c) => {
            if (pendingStatusFilter && c.claimStatus !== pendingStatusFilter) return false;
            if (pendingExclude !== undefined && c.id === pendingExclude) return false;
            return true;
          });
          resetPending();
          return Promise.resolve(out);
        },
      }),
    }),
    update: () => ({
      set: (patch: any) => ({
        where: (pred: any) => {
          parseWherePredicate(pred, (info) => {
            pendingExpireExpression = info.isExpireExpression ?? false;
            pendingClaimIdAndActive = info.claimIdAndActive;
          });
          return {
            returning: async () => {
              let touched: ClaimRow[];
              if (pendingExpireExpression) {
                const now = Date.now();
                touched = CLAIMS.filter(
                  (c) =>
                    c.claimStatus === "active" &&
                    c.claimedAt.getTime() + c.ttlMinutes * 60_000 < now,
                );
              } else if (pendingClaimIdAndActive !== undefined) {
                touched = CLAIMS.filter(
                  (c) => c.id === pendingClaimIdAndActive && c.claimStatus === "active",
                );
              } else {
                touched = [...CLAIMS];
              }
              for (const c of touched) {
                Object.assign(c, patch);
              }
              resetPending();
              return touched.map((c) => ({ id: c.id }));
            },
          };
        },
      }),
    }),
  };
}

interface PredicateInfo {
  excludeId?: number;
  statusFilter?: string;
  isExpireExpression?: boolean;
  claimIdAndActive?: number;
}

function parseWherePredicate(pred: any, set: (info: PredicateInfo) => void) {
  // The mock-drizzle helpers below tag every helper return value with a
  // recognizable shape. Walk the tree and accumulate info.
  const info: PredicateInfo = {};
  walk(pred);
  set(info);

  function walk(node: any) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (typeof node === "object") {
      if (node.op === "eq" && node.col === "claim_status") {
        info.statusFilter = node.val;
      } else if (node.op === "eq" && node.col === "id") {
        info.claimIdAndActive = node.val;
      } else if (node.op === "ne" && node.col === "id") {
        info.excludeId = node.val;
      } else if (node.op === "expire_sql") {
        info.isExpireExpression = true;
      } else if (Array.isArray(node.preds)) {
        for (const p of node.preds) walk(p);
      }
    }
  }
}

vi.mock("../../db", () => ({ db: buildDbMock() }));

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    and: (...preds: unknown[]) => ({ preds }),
    eq: (col: any, val: unknown) => {
      const name = typeof col === "object" && col !== null && "name" in col
        ? (col as any).name
        : "unknown";
      return { op: "eq", col: name, val };
    },
    ne: (col: any, val: unknown) => {
      const name = typeof col === "object" && col !== null && "name" in col
        ? (col as any).name
        : "unknown";
      return { op: "ne", col: name, val };
    },
    gte: (col: unknown, val: unknown) => ({ op: "gte", col, val }),
    lte: (col: unknown, val: unknown) => ({ op: "lte", col, val }),
    sql: (() => {
      const tag: any = (_strings: TemplateStringsArray, ..._vals: unknown[]) => ({
        op: "expire_sql",
      });
      return tag;
    })(),
  };
});

// The schema mock just needs to expose objects whose properties carry a
// recognizable `name` so the mocked drizzle helpers above can identify them.
vi.mock("@shared/schema/solene-agent-claims", () => {
  return {
    soleneAgentClaims: {
      id: { name: "id" },
      claimStatus: { name: "claim_status" },
      claimedAt: { name: "claimed_at" },
      ttlMinutes: { name: "ttl_minutes" },
    },
    CLAIM_AGENT_ROLES: [
      "iris",
      "soren",
      "beatrice",
      "krieger",
      "solene",
      "general-purpose",
      "founder",
    ],
    DEFAULT_CLAIM_TTL_MINUTES: 60,
    MAX_CLAIM_TTL_MINUTES: 60 * 12,
  };
});

import {
  claimSurfaces,
  releaseClaim,
  expireStaleClaims,
  findConflictingClaims,
  predictDispatchConflicts,
  isFileUnderClaim,
  listActiveClaims,
  matchesGlob,
  computePatternOverlap,
} from "./agentClaims";

beforeEach(() => {
  CLAIMS.length = 0;
  nextClaimId = 1;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
// claimSurfaces — input validation + persist
// ────────────────────────────────────────────────────────────────────────────

describe("claimSurfaces", () => {
  it("persists a row with the right shape", async () => {
    const id = await claimSurfaces({
      agentRole: "iris",
      patterns: ["server/services/iris/*"],
      dispatchId: 42,
    });
    expect(id).toBeGreaterThan(0);
    expect(CLAIMS).toHaveLength(1);
    expect(CLAIMS[0].agentRole).toBe("iris");
    expect(CLAIMS[0].dispatchId).toBe(42);
    expect(CLAIMS[0].fileSurfacePatterns).toEqual(["server/services/iris/*"]);
    expect(CLAIMS[0].claimStatus).toBe("active");
    expect(CLAIMS[0].ttlMinutes).toBe(60);
  });

  it("rejects unknown agentRole", async () => {
    await expect(
      claimSurfaces({
        agentRole: "ghost" as any,
        patterns: ["x"],
      }),
    ).rejects.toThrow(/unknown agentRole/);
  });

  it("rejects empty patterns", async () => {
    await expect(
      claimSurfaces({ agentRole: "iris", patterns: [] }),
    ).rejects.toThrow(/non-empty array/);
  });

  it("rejects parent-dir or absolute patterns", async () => {
    await expect(
      claimSurfaces({ agentRole: "iris", patterns: ["/etc/passwd"] }),
    ).rejects.toThrow(/repo-relative/);
    await expect(
      claimSurfaces({ agentRole: "iris", patterns: ["../escape/*"] }),
    ).rejects.toThrow(/repo-relative/);
  });

  it("rejects ttlMinutes above ceiling", async () => {
    await expect(
      claimSurfaces({
        agentRole: "iris",
        patterns: ["server/*"],
        ttlMinutes: 60 * 24,
      }),
    ).rejects.toThrow(/exceeds ceiling/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// matchesGlob — used by pre-commit hook helper
// ────────────────────────────────────────────────────────────────────────────

describe("matchesGlob", () => {
  it("matches a file under a directory wildcard", () => {
    expect(matchesGlob("server/services/iris/perf.ts", "server/services/iris/*")).toBe(
      true,
    );
  });
  it("matches a prefix-based glob", () => {
    expect(matchesGlob("shared/schema/iris-trace.ts", "shared/schema/iris-*.ts")).toBe(
      true,
    );
  });
  it("does not match an unrelated path", () => {
    expect(matchesGlob("server/services/soren/seo.ts", "server/services/iris/*")).toBe(
      false,
    );
  });
  it("handles double-star deep matches", () => {
    expect(matchesGlob("tests/e2e/auth/login.spec.ts", "tests/e2e/**")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// computePatternOverlap — positive + negative cases
// ────────────────────────────────────────────────────────────────────────────

describe("computePatternOverlap", () => {
  it("detects direct overlap on same directory wildcard", () => {
    const r = computePatternOverlap(
      ["server/services/iris/*"],
      ["server/services/iris/*"],
    );
    expect(r.matchingExisting).toContain("server/services/iris/*");
    expect(r.matchingProposed).toContain("server/services/iris/*");
  });

  it("detects overlap when one pattern is a subset of another", () => {
    const r = computePatternOverlap(
      ["server/services/iris/perf.ts"],
      ["server/services/iris/*"],
    );
    expect(r.matchingExisting.length).toBeGreaterThan(0);
  });

  it("detects overlap on a shared literal prefix", () => {
    const r = computePatternOverlap(
      ["shared/schema/iris-trace.ts"],
      ["shared/schema/iris-*.ts"],
    );
    expect(r.matchingExisting.length).toBeGreaterThan(0);
  });

  it("returns no overlap for disjoint top-level directories", () => {
    const r = computePatternOverlap(
      ["server/services/soren/*"],
      ["server/services/iris/*"],
    );
    expect(r.matchingExisting).toEqual([]);
    expect(r.matchingProposed).toEqual([]);
  });

  it("returns no overlap for sibling files in same directory with explicit names", () => {
    const r = computePatternOverlap(
      ["docs/internal/iris-notes.md"],
      ["docs/internal/soren-notes.md"],
    );
    expect(r.matchingExisting).toEqual([]);
  });

  it("returns no overlap for empty inputs", () => {
    expect(computePatternOverlap([], ["server/*"]).matchingExisting).toEqual([]);
    expect(computePatternOverlap(["server/*"], []).matchingExisting).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// findConflictingClaims + predictDispatchConflicts
// ────────────────────────────────────────────────────────────────────────────

describe("findConflictingClaims", () => {
  it("returns active claims that overlap with proposed patterns", async () => {
    await claimSurfaces({
      agentRole: "iris",
      patterns: ["server/services/iris/*"],
      dispatchId: 1,
    });
    const conflicts = await findConflictingClaims([
      "server/services/iris/perf.ts",
    ]);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].agentRole).toBe("iris");
    expect(conflicts[0].dispatchId).toBe(1);
    expect(conflicts[0].matchingPatterns).toContain("server/services/iris/*");
  });

  it("ignores released claims", async () => {
    const id = await claimSurfaces({
      agentRole: "iris",
      patterns: ["server/services/iris/*"],
    });
    await releaseClaim(id);
    const conflicts = await findConflictingClaims(["server/services/iris/perf.ts"]);
    expect(conflicts).toEqual([]);
  });

  it("excludeClaimId omits the caller's own claim from conflict set", async () => {
    const own = await claimSurfaces({
      agentRole: "iris",
      patterns: ["server/services/iris/*"],
    });
    const conflicts = await findConflictingClaims(
      ["server/services/iris/perf.ts"],
      { excludeClaimId: own },
    );
    expect(conflicts).toEqual([]);
  });

  it("predictDispatchConflicts returns the same shape (alias)", async () => {
    await claimSurfaces({ agentRole: "iris", patterns: ["server/services/iris/*"] });
    const a = await findConflictingClaims(["server/services/iris/perf.ts"]);
    const b = await predictDispatchConflicts(["server/services/iris/perf.ts"]);
    expect(b.length).toBe(a.length);
    expect(b[0].agentRole).toBe(a[0].agentRole);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// releaseClaim — idempotent
// ────────────────────────────────────────────────────────────────────────────

describe("releaseClaim", () => {
  it("flips active → released", async () => {
    const id = await claimSurfaces({
      agentRole: "iris",
      patterns: ["server/services/iris/*"],
    });
    await releaseClaim(id);
    expect(CLAIMS[0].claimStatus).toBe("released");
  });

  it("is idempotent — no-op on already-released claim", async () => {
    const id = await claimSurfaces({
      agentRole: "iris",
      patterns: ["server/services/iris/*"],
    });
    await releaseClaim(id);
    await expect(releaseClaim(id)).resolves.toBeUndefined();
    expect(CLAIMS[0].claimStatus).toBe("released");
  });

  it("is a no-op on missing claim id", async () => {
    await expect(releaseClaim(99999)).resolves.toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// expireStaleClaims — TTL handling
// ────────────────────────────────────────────────────────────────────────────

describe("expireStaleClaims", () => {
  it("flips active rows past their TTL to expired", async () => {
    const id = await claimSurfaces({
      agentRole: "iris",
      patterns: ["server/services/iris/*"],
      ttlMinutes: 5,
    });
    // Backdate the claim 10 minutes ago so the TTL window has passed.
    const row = CLAIMS.find((c) => c.id === id)!;
    row.claimedAt = new Date(Date.now() - 10 * 60 * 1000);
    const n = await expireStaleClaims();
    expect(n).toBe(1);
    expect(row.claimStatus).toBe("expired");
  });

  it("leaves recent active claims alone", async () => {
    await claimSurfaces({
      agentRole: "iris",
      patterns: ["server/services/iris/*"],
      ttlMinutes: 60,
    });
    const n = await expireStaleClaims();
    expect(n).toBe(0);
    expect(CLAIMS[0].claimStatus).toBe("active");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// isFileUnderClaim
// ────────────────────────────────────────────────────────────────────────────

describe("isFileUnderClaim", () => {
  it("returns the conflicting claim when a file matches", async () => {
    await claimSurfaces({
      agentRole: "iris",
      patterns: ["server/services/iris/*"],
      dispatchId: 7,
    });
    const result = await isFileUnderClaim("server/services/iris/perf.ts");
    expect(result).not.toBeNull();
    expect(result!.agentRole).toBe("iris");
    expect(result!.dispatchId).toBe(7);
  });

  it("returns null when no active claim covers the file", async () => {
    await claimSurfaces({
      agentRole: "iris",
      patterns: ["server/services/iris/*"],
    });
    const result = await isFileUnderClaim("server/services/soren/seo.ts");
    expect(result).toBeNull();
  });

  it("excludeClaimId omits the caller's own claim", async () => {
    const own = await claimSurfaces({
      agentRole: "iris",
      patterns: ["server/services/iris/*"],
    });
    const result = await isFileUnderClaim("server/services/iris/perf.ts", {
      excludeClaimId: own,
    });
    expect(result).toBeNull();
  });
});

describe("listActiveClaims", () => {
  it("returns only active rows", async () => {
    const a = await claimSurfaces({
      agentRole: "iris",
      patterns: ["server/services/iris/*"],
    });
    await claimSurfaces({
      agentRole: "soren",
      patterns: ["server/services/soren/*"],
    });
    await releaseClaim(a);
    const list = await listActiveClaims();
    expect(list.length).toBe(1);
    expect(list[0].agentRole).toBe("soren");
  });
});
