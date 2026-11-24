/**
 * AUD-DEF-2 — founder-audit writes into audit_log must be hash-chained.
 *
 * Regression test for the defect found on staging 2026-11-20: the
 * founder-audit security-event bridge inserted audit_log rows with a raw
 * INSERT, landing NULL prev_hash/row_hash mid-chain (org 107 row 97,
 * action founder_audit:security_event:byok.set) and permanently breaking
 * verifyAuditLogChain(107) — missing_row_hash from that row onward.
 *
 * This test runs the REAL founderAudit.log() → REAL
 * chainAndInsertAuditLog() → REAL verifyAuditLogChain() path against a
 * deterministic fake db (same technique as auditLogChain.test.ts), and
 * proves a founder_audit:security_event:* write produces a chained row
 * that verifies — including when it lands after pre-existing chained
 * rows, exactly the row-97 position.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// No documented purges in these scenarios — every gap is a real break.
vi.mock("../utils/auditLogPurge", () => ({
  findPurgeForGap: () => Promise.resolve(null),
}));

// ─── Fake db ───────────────────────────────────────────────────────────────
// Serves the query shapes used by founderAuditService (via
// chainAndInsertAuditLog) and verifyAuditLogChain:
//   db.insert(t).values(entry).returning()                → created row
//   db.select(f?).from(t).where(c).orderBy(o).limit(n)    → prev-hash lookup
//   db.update(t).set(p).where(c).returning()              → chained row
//   db.select().from(t).where(c).orderBy(o).limit(n).offset(k) → verify page
//   db.selectDistinct({organizationId}).from(t)           → org list
// The where-condition's bound number is recovered by walking the drizzle
// SQL AST for its Param value (first number wins: org id for selects,
// row id for the update).

interface FakeRow {
  id: number;
  organizationId: number;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  changes: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: Date;
  rowHash: string | null;
  prevHash: string | null;
}

const state: { rows: FakeRow[]; nextId: number } = { rows: [], nextId: 1 };

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
      _reject: (err: unknown) => void,
    ) => {
      // getPrevHashForOrg orders by id DESC and limits 1; the verify walk
      // orders ASC with limit/offset. The fake cannot see the ORDER BY
      // direction, so: a limit-1 select after rows exist is the prev-hash
      // lookup (newest chained row), anything else is the ascending walk.
      if (limitN === 1 && offsetN === 0) {
        const chained = state.rows
          .filter((r) => (orgId == null || r.organizationId === orgId) && r.rowHash != null)
          .sort((a, b) => b.id - a.id);
        resolve(chained.slice(0, 1) as FakeRow[]);
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
    insert: () => ({
      values: (entry: Record<string, unknown>) => ({
        returning: async () => {
          const row: FakeRow = {
            id: state.nextId++,
            organizationId: entry.organizationId as number,
            userId: (entry.userId as string | null) ?? null,
            action: entry.action as string,
            entityType: entry.entityType as string,
            entityId: (entry.entityId as number | null) ?? null,
            changes: entry.changes ?? null,
            ipAddress: (entry.ipAddress as string | null) ?? null,
            userAgent: (entry.userAgent as string | null) ?? null,
            metadata: entry.metadata ?? null,
            createdAt: new Date(Date.UTC(2026, 10, 19, 16, 44, state.nextId)),
            rowHash: null,
            prevHash: null,
          };
          state.rows.push(row);
          return [row];
        },
      }),
    }),
    update: () => ({
      set: (patch: Partial<FakeRow>) => ({
        where: (cond: unknown) => ({
          returning: async () => {
            const id = extractBoundNumber(cond);
            const row = state.rows.find((r) => r.id === id);
            if (!row) return [];
            Object.assign(row, patch);
            return [row];
          },
        }),
      }),
    }),
  },
}));

import { founderAudit } from "./founderAuditService";
import {
  GENESIS_PREV_HASH,
  chainAndInsertAuditLog,
  verifyAuditLogChain,
} from "../utils/auditLogChain";

beforeEach(() => {
  state.rows = [];
  state.nextId = 1;
});

describe("founderAudit → audit_log chaining (AUD-DEF-2)", () => {
  it("a founder_audit:security_event:byok.set write produces a chained row", async () => {
    await founderAudit.log({
      category: "security_event",
      severity: "info",
      action: "byok.set",
      description: "BYOK credential set for channel=lob (fingerprint=...x4az)",
      organizationId: 107,
      metadata: { channel: "lob", fingerprint: "x4az" },
    });

    expect(state.rows).toHaveLength(1);
    const row = state.rows[0];
    expect(row.action).toBe("founder_audit:security_event:byok.set");
    expect(row.entityType).toBe("system");
    expect(row.entityId).toBe(0);
    // The defect was NULL hashes; the cure must populate both.
    expect(row.prevHash).toBe(GENESIS_PREV_HASH);
    expect(row.rowHash).toMatch(/^[0-9a-f]{64}$/);
    // The persisted payload shape is unchanged from the old raw INSERT.
    expect(row.changes).toMatchObject({
      severity: "info",
      description: "BYOK credential set for channel=lob (fingerprint=...x4az)",
      metadata: { channel: "lob", fingerprint: "x4az" },
    });
  });

  it("a security-event write landing after chained rows keeps verifyAuditLogChain green (the row-97 position)", async () => {
    // Pre-existing properly chained rows for org 107 (cf. staging ids 45–48).
    await chainAndInsertAuditLog({
      organizationId: 107,
      userId: "user_1",
      action: "update",
      entityType: "organization",
      entityId: 107,
    });
    await chainAndInsertAuditLog({
      organizationId: 107,
      userId: "user_1",
      action: "create",
      entityType: "mail_identity",
      entityId: 5,
    });

    // The write that used to break the chain:
    await founderAudit.log({
      category: "security_event",
      severity: "info",
      action: "byok.set",
      description: "BYOK credential set for channel=lob (fingerprint=...x4az)",
      organizationId: 107,
      metadata: { channel: "lob", fingerprint: "x4az" },
    });

    // And a further founder-audit write of another category after it —
    // the bridge is generic, so every category must chain.
    await founderAudit.log({
      category: "autonomous_decision",
      severity: "warning",
      action: "morning_brief_sent",
      description: "Autonomous decision (80% confidence): brief. EXECUTED",
      organizationId: 107,
    });

    expect(state.rows).toHaveLength(4);
    for (const row of state.rows) {
      expect(row.rowHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.prevHash).not.toBeNull();
    }
    // Each founder-audit row chains onto its immediate predecessor.
    expect(state.rows[2].prevHash).toBe(state.rows[1].rowHash);
    expect(state.rows[3].prevHash).toBe(state.rows[2].rowHash);

    const result = await verifyAuditLogChain(107);
    expect(result.ok).toBe(true);
    expect(result.scanned).toBe(4);
    expect(result.failure).toBeNull();
  });

  it("logSecurityEvent without an organization still writes no audit_log row (unchanged behaviour)", async () => {
    await founderAudit.logSecurityEvent("warning", "platform_connection_set", "no org scope");
    expect(state.rows).toHaveLength(0);
  });
});
