/**
 * Tier 2D — per-org audit_log hash-chain verification (2026-06-10).
 *
 * Exercises the REAL verifyAuditLogChain / verifyAllOrgAuditLogChains walk
 * (including the genuine SHA-256 recompute via computeRowHash) against a
 * deterministic fake db. Proves:
 *   - an intact chain verifies ok
 *   - a tampered row (payload mutated after hashing) → row_hash_mismatch
 *   - a deleted middle row with no documented purge → prev_hash_mismatch
 *   - a chained row followed by an unhashed row → missing_row_hash
 *   - the fleet-wide walker aggregates per-org failures + isolates infra
 *     errors from tamper evidence (errors must never mask, or masquerade
 *     as, tampering)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// No documented purges in these scenarios — every gap is a real break.
const findPurgeForGapMock = vi.fn();
vi.mock("./auditLogPurge", () => ({
  findPurgeForGap: (orgId: number, prevHash: string) =>
    findPurgeForGapMock(orgId, prevHash),
}));

// ─── Fake db ───────────────────────────────────────────────────────────────
// Serves `state.rows` through the two query shapes auditLogChain.ts uses:
//   db.select().from(t).where(c).orderBy(o).limit(n).offset(k)   → row page
//   db.selectDistinct({organizationId}).from(t)                  → org list
// The where-condition's org id is recovered by walking the drizzle SQL AST
// for its bound Param value.

interface FakeRow {
  id: number;
  organizationId: number;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: Date;
  rowHash: string | null;
  prevHash: string | null;
}

const state: { rows: FakeRow[]; throwForOrg: number | null } = {
  rows: [],
  throwForOrg: null,
};

function extractBoundNumber(cond: unknown): number | null {
  const found: number[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const rec = node as Record<string, unknown>;
    if (typeof rec.value === "number") found.push(rec.value);
    if (Array.isArray(rec.queryChunks)) rec.queryChunks.forEach(walk);
    if (Array.isArray(node)) (node as unknown[]).forEach(walk);
  };
  walk(cond);
  return found[0] ?? null;
}

function makeSelectBuilder() {
  let orgId: number | null = null;
  let limitN = Infinity;
  let offsetN = 0;
  const builder = {
    from: () => builder,
    where: (cond: unknown) => {
      orgId = extractBoundNumber(cond);
      return builder;
    },
    orderBy: () => builder,
    limit: (n: number) => {
      limitN = n;
      return builder;
    },
    offset: (n: number) => {
      offsetN = n;
      return builder;
    },
    then: (
      resolve: (rows: FakeRow[]) => void,
      reject: (err: unknown) => void,
    ) => {
      if (orgId != null && orgId === state.throwForOrg) {
        reject(new Error(`fake db: connection lost for org ${orgId}`));
        return;
      }
      const filtered = state.rows
        .filter((r) => orgId == null || r.organizationId === orgId)
        .sort((a, b) => a.id - b.id)
        .slice(offsetN, offsetN + limitN);
      resolve(filtered);
    },
  };
  return builder;
}

vi.mock("../db", () => ({
  db: {
    select: () => makeSelectBuilder(),
    selectDistinct: () => ({
      from: () => ({
        then: (resolve: (rows: Array<{ organizationId: number }>) => void) => {
          const orgs = [...new Set(state.rows.map((r) => r.organizationId))];
          resolve(orgs.map((organizationId) => ({ organizationId })));
        },
      }),
    }),
  },
}));

import {
  GENESIS_PREV_HASH,
  computeRowHash,
  verifyAuditLogChain,
  verifyAllOrgAuditLogChains,
} from "./auditLogChain";

// Build a genuinely chained sequence of rows for an org using the REAL
// hashing functions — exactly what chainAndInsertAuditLog would persist.
function buildChain(organizationId: number, count: number, startId = 1): FakeRow[] {
  const rows: FakeRow[] = [];
  let prevHash = GENESIS_PREV_HASH;
  for (let i = 0; i < count; i++) {
    const row: FakeRow = {
      id: startId + i,
      organizationId,
      userId: `user_${organizationId}`,
      action: `update_lead_${i}`,
      entityType: "lead",
      entityId: `lead-${i}`,
      changes: { step: i },
      ipAddress: null,
      userAgent: null,
      metadata: null,
      createdAt: new Date(Date.UTC(2026, 5, 1, 0, i)),
      rowHash: null,
      prevHash,
    };
    row.rowHash = computeRowHash(prevHash, row as never);
    prevHash = row.rowHash;
    rows.push(row);
  }
  return rows;
}

beforeEach(() => {
  state.rows = [];
  state.throwForOrg = null;
  findPurgeForGapMock.mockReset();
  findPurgeForGapMock.mockResolvedValue(null);
});

describe("verifyAuditLogChain", () => {
  it("verifies an intact chain ok", async () => {
    state.rows = buildChain(7, 5);
    const result = await verifyAuditLogChain(7);
    expect(result.ok).toBe(true);
    expect(result.scanned).toBe(5);
    expect(result.failure).toBeNull();
  });

  it("detects a tampered row payload (row_hash_mismatch)", async () => {
    state.rows = buildChain(7, 5);
    // Tamper: rewrite the action on the middle row AFTER it was hashed —
    // the classic out-of-band UPDATE the chain exists to catch.
    state.rows[2].action = "update_lead_TAMPERED";
    const result = await verifyAuditLogChain(7);
    expect(result.ok).toBe(false);
    expect(result.failure?.reason).toBe("row_hash_mismatch");
    expect(result.failure?.auditLogId).toBe(state.rows[2].id);
  });

  it("detects a deleted middle row with no documented purge (prev_hash_mismatch)", async () => {
    state.rows = buildChain(7, 5);
    // Delete row id=3 out-of-band. Row id=4's prev_hash now points at a hash
    // no surviving predecessor carries, and no purge documents the gap.
    state.rows = state.rows.filter((r) => r.id !== 3);
    const result = await verifyAuditLogChain(7);
    expect(result.ok).toBe(false);
    expect(result.failure?.reason).toBe("prev_hash_mismatch");
    expect(result.failure?.auditLogId).toBe(4);
    // The purge ledger was consulted before declaring the break.
    expect(findPurgeForGapMock).toHaveBeenCalled();
  });

  it("detects an unhashed row after the chain started (missing_row_hash)", async () => {
    state.rows = buildChain(7, 3);
    state.rows.push({
      ...state.rows[2],
      id: 4,
      rowHash: null,
      prevHash: null,
    });
    const result = await verifyAuditLogChain(7);
    expect(result.ok).toBe(false);
    expect(result.failure?.reason).toBe("missing_row_hash");
    expect(result.failure?.auditLogId).toBe(4);
  });
});

describe("verifyAllOrgAuditLogChains", () => {
  it("walks every org and aggregates per-org failures", async () => {
    state.rows = [
      ...buildChain(1, 4, 1), // intact
      ...buildChain(2, 4, 100), // will be tampered
    ];
    const tampered = state.rows.find((r) => r.id === 101)!;
    tampered.changes = { step: 999, injected: true };
    const summary = await verifyAllOrgAuditLogChains();
    expect(summary.orgsChecked).toBe(2);
    // Org 1 scans all 4 rows; org 2 stops at the first failure (row 2 of 4).
    expect(summary.totalScanned).toBe(6);
    expect(summary.ok).toBe(false);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].organizationId).toBe(2);
    expect(summary.failures[0].failure?.reason).toBe("row_hash_mismatch");
    expect(summary.errors).toHaveLength(0);
  });

  it("returns ok when every org chain is intact", async () => {
    state.rows = [...buildChain(1, 3, 1), ...buildChain(2, 2, 50)];
    const summary = await verifyAllOrgAuditLogChains();
    expect(summary.ok).toBe(true);
    expect(summary.orgsChecked).toBe(2);
    expect(summary.totalScanned).toBe(5);
    expect(summary.failures).toHaveLength(0);
  });

  it("isolates verifier infra errors from tamper failures", async () => {
    state.rows = [...buildChain(1, 3, 1), ...buildChain(2, 3, 50)];
    state.throwForOrg = 2;
    const summary = await verifyAllOrgAuditLogChains();
    expect(summary.ok).toBe(false);
    // The infra error is NOT reported as a chain failure.
    expect(summary.failures).toHaveLength(0);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].organizationId).toBe(2);
    expect(summary.errors[0].message).toContain("connection lost");
    // The healthy org still verified.
    expect(summary.orgsChecked).toBe(2);
    expect(summary.totalScanned).toBe(3);
  });
});
