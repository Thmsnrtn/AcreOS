/**
 * audit_events hash chain — Beatrice / compliance-debt §2.
 *
 * Extends the audit_log SHA-256 tamper-evidence chain to audit_events (the
 * crown-jewel table: login, MFA-disable, ownership-transfer, refunds,
 * DSAR-erasure). This test pins the pure chain primitives:
 *   - canonicalization is deterministic + key-order independent,
 *   - row_hash chains off the previous row's row_hash (or GENESIS),
 *   - any after-the-fact mutation to a chained row breaks recomputation
 *     (tamper-EVIDENCE).
 *
 * We mock ../db so importing the chain module (which statically imports db) is
 * side-effect free — the verify-walk DB path is out of scope here; the hash
 * math is the load-bearing security property.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import {
  GENESIS_PREV_HASH,
  canonicalAuditEventPayload,
  computeEventRowHash,
  type AuditEventHashable,
} from "../../server/utils/auditEventsChain";

function mkRow(over: Partial<AuditEventHashable> = {}): AuditEventHashable {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    actorUserId: "user_abc",
    actorEmail: "owner@example.com",
    action: "auth.mfa_disabled",
    targetType: "user",
    targetId: "user_abc",
    justification: null,
    metadata: { method: "totp" },
    ip: "203.0.113.7",
    userAgent: "vitest",
    createdAt: new Date("2026-06-08T12:00:00.000Z"),
    ...over,
  };
}

describe("audit_events chain — canonicalization", () => {
  it("is deterministic across calls for the same logical row", () => {
    const a = canonicalAuditEventPayload(mkRow());
    const b = canonicalAuditEventPayload(mkRow());
    expect(a).toBe(b);
  });

  it("sorts TOP-LEVEL keys so the canonical string is field-order independent", () => {
    // The canonicalizer (like audit_log's) sorts top-level keys; whichever
    // order the hashable fields are assembled in, the canonical output is the
    // same. We assert the keys come out sorted.
    const canon = canonicalAuditEventPayload(mkRow());
    const keys = Object.keys(JSON.parse(canon));
    expect(keys).toEqual([...keys].sort());
  });

  it("normalizes a Date createdAt to a stable ISO string", () => {
    const fromDate = canonicalAuditEventPayload(mkRow({ createdAt: new Date("2026-06-08T12:00:00.000Z") }));
    const fromStr = canonicalAuditEventPayload(mkRow({ createdAt: "2026-06-08T12:00:00.000Z" }));
    expect(fromDate).toBe(fromStr);
  });
});

describe("audit_events chain — row_hash linkage", () => {
  it("the first row chains off the literal GENESIS prev-hash", () => {
    const row0 = mkRow();
    const hash0 = computeEventRowHash(GENESIS_PREV_HASH, row0);
    expect(hash0).toMatch(/^[0-9a-f]{64}$/);
    // Deterministic: same input → same hash.
    expect(computeEventRowHash(GENESIS_PREV_HASH, row0)).toBe(hash0);
  });

  it("each row's hash depends on the previous row's hash (the chain links)", () => {
    const row0 = mkRow({ id: "00000000-0000-0000-0000-000000000000" });
    const row1 = mkRow({ id: "99999999-9999-9999-9999-999999999999", action: "billing.refund_issued" });

    const hash0 = computeEventRowHash(GENESIS_PREV_HASH, row0);
    const hash1Chained = computeEventRowHash(hash0, row1);
    const hash1Genesis = computeEventRowHash(GENESIS_PREV_HASH, row1);

    // Same row body, different prev_hash → different row_hash. This is what
    // makes an out-of-band INSERT/DELETE detectable.
    expect(hash1Chained).not.toBe(hash1Genesis);
  });

  it("TAMPER-EVIDENCE: mutating a chained row breaks recomputation", () => {
    const row = mkRow({ action: "dsar.erasure" });
    const prev = computeEventRowHash(GENESIS_PREV_HASH, mkRow({ id: "aaa" }));
    const original = computeEventRowHash(prev, row);

    // Auditor recomputes from a row whose business field was altered after the
    // fact (e.g. action flipped from erasure → completed to hide a deletion).
    const tampered = { ...row, action: "dsar.completed" };
    const recomputed = computeEventRowHash(prev, tampered);

    expect(recomputed).not.toBe(original);
  });
});
