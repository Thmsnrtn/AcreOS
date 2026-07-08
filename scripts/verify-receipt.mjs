#!/usr/bin/env node
/**
 * OFFLINE RECEIPT VERIFIER (Frontier #14).
 *
 * A self-contained, dependency-free tool that verifies an AcreOS governance
 * artifact — a single ProofReceipt, an ordered receipt CHAIN, or a Governance
 * Evidence Packet — WITHOUT the running app, a database, or any AcreOS package.
 * This makes real the promise the receipt format only implied: "anyone holding
 * the artifact can independently confirm it was neither tampered with nor
 * fabricated." A regulator / insurer / customer runs:
 *
 *     node scripts/verify-receipt.mjs path/to/artifact.json
 *
 * It re-derives the same canonical sha256 the app seals with (sorted-key JSON,
 * undefined dropped) and recomputes every hash from scratch. Exit 0 = every
 * seal + chain link verifies; exit 1 = a break (the reason is printed).
 *
 * ANTI-DRIFT: the canonical hash here MUST byte-for-byte match
 * server/services/autopilot/proofReceipt.ts (sortValue + sha256Canonical). A
 * test (tests/unit/offlineReceiptVerifier.test.ts) builds a real receipt with
 * buildReceipt and asserts this script PASSes it — so the two can never silently
 * diverge.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const GENESIS_RECEIPT_HASH = "GENESIS";
const SUPPORTED_RECEIPT_VERSIONS = new Set([1, 2]);

// ── Canonical hashing — an EXACT mirror of proofReceipt.ts ───────────────────
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v !== undefined) out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}
function sha256Canonical(value) {
  return createHash("sha256").update(JSON.stringify(sortValue(value)), "utf8").digest("hex");
}

// ── Single-receipt verification (mirrors verifyReceipt) ──────────────────────
export function verifyReceiptObject(receipt) {
  if (!receipt || typeof receipt !== "object") return { valid: false, reason: "not an object" };
  if (!SUPPORTED_RECEIPT_VERSIONS.has(receipt.v)) {
    return { valid: false, reason: `unsupported receipt version ${String(receipt.v)}` };
  }
  if (!receipt.actionKind || !receipt.accountableHumanId) {
    return { valid: false, reason: "missing required attribution (actionKind / accountableHumanId)" };
  }
  if (receipt.accountableHumanId === "unknown") {
    return { valid: false, reason: "accountable human is 'unknown' — no real principal attribution" };
  }
  if (!receipt.payloadHash) return { valid: false, reason: "missing payloadHash" };
  const { receiptHash, ...body } = receipt;
  if (sha256Canonical(body) !== receiptHash) {
    return { valid: false, reason: "receiptHash mismatch — the receipt has been tampered with" };
  }
  return { valid: true };
}

// ── Ordered-chain verification (mirrors verifyReceiptSequence) ───────────────
export function verifyChain(receipts) {
  let expectedPrev = GENESIS_RECEIPT_HASH;
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    const seal = verifyReceiptObject(r);
    if (!seal.valid) return { ok: false, count: receipts.length, failedAtIndex: i, reason: `#${i}: ${seal.reason}` };
    if ((r.prevReceiptHash ?? GENESIS_RECEIPT_HASH) !== expectedPrev) {
      return {
        ok: false,
        count: receipts.length,
        failedAtIndex: i,
        reason: `#${i}: chain link broken (prev=${r.prevReceiptHash ?? "GENESIS"}, expected ${expectedPrev})`,
      };
    }
    expectedPrev = r.receiptHash;
  }
  return { ok: true, count: receipts.length };
}

// ── Evidence-packet verification (mirrors verifyEvidencePacket) ──────────────
export function verifyEvidencePacketObject(packet) {
  if (!packet || typeof packet !== "object" || !packet.packetHash) {
    return { valid: false, reason: "missing packetHash" };
  }
  const { packetHash, ...body } = packet;
  return sha256Canonical(body) === packetHash
    ? { valid: true }
    : { valid: false, reason: "packetHash mismatch — the packet was altered after export" };
}

/**
 * Detect the artifact shape and verify it. Returns { ok, kind, detail }.
 * Pure — takes the already-parsed JSON, so it's unit-testable without fs.
 */
export function verifyArtifact(parsed) {
  if (Array.isArray(parsed)) {
    const v = verifyChain(parsed);
    return { ok: v.ok, kind: "chain", detail: v };
  }
  if (parsed && typeof parsed === "object" && "receiptHash" in parsed) {
    const v = verifyReceiptObject(parsed);
    return { ok: v.valid, kind: "receipt", detail: v };
  }
  if (parsed && typeof parsed === "object" && "packetHash" in parsed) {
    const v = verifyEvidencePacketObject(parsed);
    return { ok: v.valid, kind: "evidence-packet", detail: v };
  }
  return { ok: false, kind: "unknown", detail: { reason: "unrecognized artifact (no receiptHash / packetHash, not an array)" } };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main(argv) {
  const file = argv[2];
  if (!file) {
    process.stderr.write("usage: node scripts/verify-receipt.mjs <artifact.json>\n");
    return 2;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    process.stderr.write(`[verify-receipt] could not read/parse ${file}: ${err?.message ?? err}\n`);
    return 2;
  }
  const res = verifyArtifact(parsed);
  if (res.ok) {
    const n = res.kind === "chain" ? ` (${res.detail.count} receipts)` : "";
    process.stdout.write(`[verify-receipt] PASS — ${res.kind}${n} verifies (every seal + chain link intact).\n`);
    return 0;
  }
  process.stdout.write(`[verify-receipt] FAIL — ${res.kind}: ${res.detail.reason ?? "verification failed"}\n`);
  return 1;
}

// Only run the CLI when invoked directly (not when imported by the test).
import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv));
}
