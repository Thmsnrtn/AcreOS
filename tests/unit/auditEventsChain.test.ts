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
import { createHash } from "crypto";
import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import {
  GENESIS_PREV_HASH,
  canonicalAuditEventPayload,
  computeEventRowHash,
  stableCanonicalStringify,
  verifyAuditEventRows,
  type AuditEventChainRow,
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

// ─── AUD-DEF-1: canonicalization v2 ─────────────────────────────────────────

describe("audit_events chain — v2 recursive canonicalization (AUD-DEF-1)", () => {
  it("nested metadata key order does NOT change the canonical payload or hash", () => {
    // The v1 defect: only top-level keys were sorted, so the writer's
    // in-memory nested order was hashed, while Postgres jsonb returned a
    // different (length-then-bytewise) order at verify time.
    const writerOrder = mkRow({
      metadata: { reviewedCount: 0, staleCount: 0, thresholdDays: 90, sentTo: [] },
    });
    // Exactly the jsonb ::text order staging returned for this shape.
    const jsonbOrder = mkRow({
      metadata: JSON.parse('{"sentTo": [], "staleCount": 0, "reviewedCount": 0, "thresholdDays": 90}') as Record<string, unknown>,
    });
    const alphaOrder = mkRow({
      metadata: { reviewedCount: 0, sentTo: [], staleCount: 0, thresholdDays: 90 },
    });
    expect(canonicalAuditEventPayload(jsonbOrder)).toBe(canonicalAuditEventPayload(writerOrder));
    expect(canonicalAuditEventPayload(alphaOrder)).toBe(canonicalAuditEventPayload(writerOrder));
    expect(computeEventRowHash(GENESIS_PREV_HASH, jsonbOrder)).toBe(
      computeEventRowHash(GENESIS_PREV_HASH, writerOrder),
    );
  });

  it("canonicalizes deeply nested objects and objects inside arrays recursively", () => {
    const a = mkRow({ metadata: { outer: { z: 1, a: { y: 2, b: 3 } }, list: [{ q: 1, p: 2 }] } });
    const b = mkRow({ metadata: { list: [{ p: 2, q: 1 }], outer: { a: { b: 3, y: 2 }, z: 1 } } });
    expect(canonicalAuditEventPayload(a)).toBe(canonicalAuditEventPayload(b));
    // Array ORDER is meaning and must still change the hash.
    const c = mkRow({ metadata: { list: [{ p: 2, q: 1 }, { p: 9, q: 9 }] } });
    expect(canonicalAuditEventPayload(c)).not.toBe(canonicalAuditEventPayload(a));
  });

  it("metadata null and {} canonicalize identically (the writer stores {})", () => {
    expect(canonicalAuditEventPayload(mkRow({ metadata: null }))).toBe(
      canonicalAuditEventPayload(mkRow({ metadata: {} })),
    );
  });

  it("createdAt sub-millisecond fractions truncate to the writer's millisecond ISO", () => {
    const fromDb = canonicalAuditEventPayload(mkRow({ createdAt: "2026-06-08T12:00:00.000912Z" }));
    const fromWriter = canonicalAuditEventPayload(mkRow({ createdAt: new Date("2026-06-08T12:00:00.000Z") }));
    expect(fromDb).toBe(fromWriter);
  });

  it("stableCanonicalStringify sorts keys at every depth and drops undefined properties", () => {
    expect(stableCanonicalStringify({ b: { d: 1, c: 2 }, a: undefined })).toBe('{"b":{"c":2,"d":1}}');
    expect(stableCanonicalStringify([3, { y: 1, x: 2 }])).toBe('[3,{"x":2,"y":1}]');
  });
});

// ─── AUD-DEF-1: the historical byte pattern (staging genesis row) ───────────
//
// First-hand root-cause record (2026-11-21, read-only staging read): the
// genesis row seq=1 (access_review.quarterly, 2026-07-07) stores
// row_hash 2065e6b8…. Recomputing under payload variants showed the stored
// hash matches EXACTLY ONE variant — the v1 payload with metadata in the
// WRITER's source order (accessReview.ts: reviewedCount, staleCount,
// thresholdDays, sentTo) and a millisecond ISO createdAt. The v1 verifier,
// reading metadata back in jsonb order (sentTo, staleCount, reviewedCount,
// thresholdDays), recomputes 01e95f94… — the alert's expected value. No
// order-independent canonical form can recover the writer order, so the
// disposition is grandfather + checkpoint, never hash rewriting.

const GENESIS_STORED_HASH = "2065e6b8db5c340434516bdd1ed843dbdaaeaf59a0c019edc2743a649e3fda20";

function legacyV1Hash(prevHash: string, row: AuditEventHashable, metadataInWriterOrder: Record<string, unknown>): string {
  // The v1 algorithm: top-level keys sorted, nested metadata passed
  // through JSON.stringify in the order supplied.
  const payload: Record<string, unknown> = {
    id: row.id,
    actorUserId: row.actorUserId ?? null,
    actorEmail: row.actorEmail ?? null,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    justification: row.justification ?? null,
    metadata: metadataInWriterOrder,
    ip: row.ip ?? null,
    userAgent: row.userAgent ?? null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
  };
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(payload).sort()) sorted[k] = payload[k];
  return createHash("sha256").update(prevHash).update("\n").update(JSON.stringify(sorted)).digest("hex");
}

function genesisRow(): AuditEventChainRow {
  return {
    id: "1b47a57b-71ae-473a-9136-4109c9cd6b09",
    actorUserId: null,
    actorEmail: null,
    action: "access_review.quarterly",
    targetType: "organization",
    targetId: "0",
    justification: null,
    // As read back from jsonb (length-then-bytewise key order).
    metadata: JSON.parse('{"sentTo": [], "staleCount": 0, "reviewedCount": 0, "thresholdDays": 90}') as Record<string, unknown>,
    ip: null,
    userAgent: "scheduled-job/access-review",
    createdAt: new Date("2026-07-07T14:00:37.795Z"),
    seq: 1,
    prevHash: GENESIS_PREV_HASH,
    rowHash: GENESIS_STORED_HASH,
  };
}

describe("audit_events chain — historical fixture + grandfather disposition (AUD-DEF-1)", () => {
  it("the stored genesis hash is explained ONLY by the writer's metadata order (root cause)", () => {
    const row = genesisRow();
    const writerOrder = { reviewedCount: 0, staleCount: 0, thresholdDays: 90, sentTo: [] as string[] };
    expect(legacyV1Hash(GENESIS_PREV_HASH, row, writerOrder)).toBe(GENESIS_STORED_HASH);
    // The jsonb round-tripped order recomputes the alert's expected hash —
    // a DIFFERENT value — proving the writer order is unrecoverable from
    // the stored row and no canonical rewrite can verify this row.
    expect(legacyV1Hash(GENESIS_PREV_HASH, row, row.metadata ?? {})).toBe(
      "01e95f94d581b1f383ca832e17ed6981daec46dcb56897372521e8746fde2f45",
    );
    expect(computeEventRowHash(GENESIS_PREV_HASH, row)).not.toBe(GENESIS_STORED_HASH);
  });

  it("strict verification (no boundary configured) still fails on the legacy row", () => {
    const result = verifyAuditEventRows([genesisRow()]);
    expect(result.ok).toBe(false);
    expect(result.failure?.reason).toBe("row_hash_mismatch");
    expect(result.legacyGrandfathered).toBe(0);
  });

  it("grandfather + checkpoint: legacy row anchors a strictly-verified v2 successor", () => {
    const legacy = genesisRow();
    const successorHashable: AuditEventHashable = {
      id: "22222222-2222-2222-2222-222222222222",
      actorUserId: "user_abc",
      actorEmail: "owner@example.com",
      action: "auth.mfa_disabled",
      targetType: "user",
      targetId: "user_abc",
      justification: null,
      metadata: { method: "totp", nested: { z: 1, a: 2 } },
      ip: null,
      userAgent: "vitest",
      createdAt: new Date("2026-11-21T12:00:00.000Z"),
    };
    const successor: AuditEventChainRow = {
      ...successorHashable,
      seq: 2,
      prevHash: GENESIS_STORED_HASH,
      rowHash: computeEventRowHash(GENESIS_STORED_HASH, successorHashable),
    };
    const result = verifyAuditEventRows([legacy, successor], { grandfatherThroughSeq: 1 });
    expect(result).toMatchObject({ ok: true, legacyGrandfathered: 1, checkpointSeq: 1, scanned: 2 });

    // Tampering with the post-checkpoint row is still detected.
    const tampered: AuditEventChainRow = { ...successor, metadata: { method: "sms", nested: { z: 1, a: 2 } } };
    const tamperResult = verifyAuditEventRows([legacy, tampered], { grandfatherThroughSeq: 1 });
    expect(tamperResult.ok).toBe(false);
    expect(tamperResult.failure?.reason).toBe("row_hash_mismatch");

    // A successor that does not chain onto the legacy tip is rejected —
    // the checkpoint is an anchor, not a gap.
    const unanchored: AuditEventChainRow = { ...successor, prevHash: GENESIS_PREV_HASH };
    const unanchoredResult = verifyAuditEventRows([legacy, unanchored], { grandfatherThroughSeq: 1 });
    expect(unanchoredResult.ok).toBe(false);
    expect(unanchoredResult.failure?.reason).toBe("prev_hash_mismatch");
  });
});
