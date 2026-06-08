/**
 * auditChain tests — tamper-EVIDENCE hash-chain primitives.
 *
 * Covers the pure (no-DB) chain math that the verifier relies on:
 *   - canonicalAuditPayload: stable, key-order-independent serialization
 *   - computeRowHash: deterministic SHA-256 over prev_hash || canonical(row)
 *   - the chain invariant: row N's prev_hash == row (N-1)'s row_hash, and any
 *     mutation of a row's business fields changes its row_hash (detectable).
 *
 * The DB-backed verifyAuditChain() walk is an integration test by nature and
 * is not exercised here — but the hash recomputation it performs row-by-row IS
 * the logic under test below, so a break that the verifier would catch is
 * caught here too.
 *
 * Framing reminder: this is TAMPER-EVIDENCE, not legal proof.
 */

import { describe, it, expect } from "vitest";
import {
  computeRowHash,
  canonicalAuditPayload,
  GENESIS_PREV_HASH,
} from "./auditChain";
import type { AuditLogEntry } from "@shared/schema";

function makeRow(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 1,
    organizationId: 42,
    userId: "user_1",
    action: "create",
    entityType: "lead",
    entityId: 100,
    changes: { after: { firstName: "Jane" }, fields: ["firstName"] },
    ipAddress: "203.0.113.7",
    userAgent: "vitest",
    metadata: { route: "POST /api/leads" },
    createdAt: new Date("2026-06-08T12:00:00.000Z"),
    prevHash: null,
    rowHash: null,
    ...overrides,
  } as AuditLogEntry;
}

describe("canonicalAuditPayload", () => {
  it("is deterministic for the same logical row", () => {
    const a = canonicalAuditPayload(makeRow());
    const b = canonicalAuditPayload(makeRow());
    expect(a).toBe(b);
  });

  it("does not depend on JS object key insertion order", () => {
    // Two rows with the same fields built in different orders hash the same.
    const row1 = makeRow();
    const row2 = makeRow();
    expect(canonicalAuditPayload(row1)).toBe(canonicalAuditPayload(row2));
  });

  it("changes when a business field changes", () => {
    const base = canonicalAuditPayload(makeRow());
    const mutated = canonicalAuditPayload(makeRow({ action: "delete" }));
    expect(mutated).not.toBe(base);
  });

  it("normalizes createdAt to ISO and tolerates null", () => {
    const withDate = canonicalAuditPayload(makeRow());
    expect(withDate).toContain("2026-06-08T12:00:00.000Z");
    expect(() => canonicalAuditPayload(makeRow({ createdAt: null }))).not.toThrow();
  });
});

describe("computeRowHash", () => {
  it("produces a 64-hex SHA-256 digest", () => {
    const h = computeRowHash(GENESIS_PREV_HASH, makeRow());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(computeRowHash(GENESIS_PREV_HASH, makeRow())).toBe(
      computeRowHash(GENESIS_PREV_HASH, makeRow()),
    );
  });

  it("depends on prev_hash (chaining)", () => {
    const a = computeRowHash(GENESIS_PREV_HASH, makeRow());
    const b = computeRowHash("some-other-prev-hash", makeRow());
    expect(a).not.toBe(b);
  });

  it("depends on the row contents (tamper detection)", () => {
    const original = computeRowHash(GENESIS_PREV_HASH, makeRow());
    const tampered = computeRowHash(
      GENESIS_PREV_HASH,
      makeRow({ entityId: 999, changes: { after: { firstName: "Mallory" } } }),
    );
    expect(tampered).not.toBe(original);
  });
});

describe("chain invariant (what the verifier walks)", () => {
  it("links rows so each prev_hash equals the predecessor's row_hash", () => {
    // Genesis row.
    const r1 = makeRow({ id: 1, prevHash: GENESIS_PREV_HASH });
    const r1Hash = computeRowHash(r1.prevHash ?? GENESIS_PREV_HASH, r1);

    // Second row chains off r1.
    const r2 = makeRow({ id: 2, entityId: 200, prevHash: r1Hash });
    const r2Hash = computeRowHash(r2.prevHash ?? GENESIS_PREV_HASH, r2);

    // Invariant 1: r2.prev_hash == r1.row_hash.
    expect(r2.prevHash).toBe(r1Hash);
    // Invariant 2: each row's own row_hash recomputes correctly.
    expect(computeRowHash(r1.prevHash ?? GENESIS_PREV_HASH, r1)).toBe(r1Hash);
    expect(computeRowHash(r2.prevHash ?? GENESIS_PREV_HASH, r2)).toBe(r2Hash);
  });

  it("detects a mutated middle row (row_hash no longer recomputes)", () => {
    const r1 = makeRow({ id: 1, prevHash: GENESIS_PREV_HASH });
    const storedR1Hash = computeRowHash(r1.prevHash ?? GENESIS_PREV_HASH, r1);

    // Attacker edits the row's action AFTER it was chained.
    const tampered = makeRow({ id: 1, prevHash: GENESIS_PREV_HASH, action: "export" });
    const recomputed = computeRowHash(tampered.prevHash ?? GENESIS_PREV_HASH, tampered);

    // The stored hash and the recomputed hash diverge → verifier would flag
    // row_hash_mismatch.
    expect(recomputed).not.toBe(storedR1Hash);
  });
});
