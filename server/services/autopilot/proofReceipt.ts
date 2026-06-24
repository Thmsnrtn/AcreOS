/**
 * ProofReceipt — a principal-attributed, tamper-evident record of a governed
 * outward action (Foundry move #3 / B3).
 *
 * KERNEL (domain-agnostic). Every witnessed-send the autopilot performs emits
 * one of these. It binds, in a single hashable artifact: WHAT was done
 * (actionKind + payloadHash), on WHOSE behalf (scope), under WHOSE authority
 * (accountableHumanId), under WHICH constitution (version + content hash), with
 * an EU-AI-Act-Art.50 disclosure line. `verifyReceipt` recomputes the hash to
 * detect tampering — the receipt is its own integrity proof.
 *
 * Why this is the load-bearing Foundry primitive: it is simultaneously a legal
 * shield (provable human-in-the-loop + constitution-at-issuance), a trust
 * product (the thing a customer/insurer/regulator can independently verify), and
 * the multi-tenant accountability record (it carries the TenantScope from move
 * #2). One artifact, four payoffs.
 *
 * Pure + exhaustively testable: `issuedAt` is injected (no clock inside), the
 * hash is deterministic over a canonicalized body. Durable persistence + a
 * prev-hash CHAIN (tamper-evident log) is a follow-up; the field is reserved now.
 */

import { createHash } from "node:crypto";
import { RAW_IMMUTABLES } from "@sovereign/immutables";
import { type TenantScope, describeScope, scopeOrgId } from "./tenantScope";

export const PROOF_RECEIPT_VERSION = 1 as const;

/** The `prevReceiptHash` of the first receipt in any scope's chain. */
export const GENESIS_RECEIPT_HASH = "GENESIS";

/**
 * EU AI Act Art. 50 transparency line — every witnessed governed action carries
 * it, stating the action was machine-prepared and human-authorized.
 */
export const ART50_DISCLOSURE =
  "Prepared by AcreOS automated operations and executed only under explicit human approval (EU AI Act Art. 50 transparency).";

export interface ProofReceiptInput {
  /** What was done, e.g. "send_email" | "run_ad_campaign". */
  actionKind: string;
  /** On whose behalf — platform (AcreOS itself) or a customer org (move #2). */
  scope: TenantScope;
  /** sha256 of the action payload (the frozen, witnessed content). */
  payloadHash: string;
  /** The human who authorized this send (the witnessing founder/approver). */
  accountableHumanId: string;
  /** The composed gate decisions, if available at the emit site. */
  gateResults?: Array<{ gate: string; status: string }>;
  evalScore?: number | null;
  costUsd?: number | null;
  autonomyLevel?: string | null;
  /** Hash of the situation/senses the decision was made under, if available. */
  situationHash?: string | null;
  /** Link to the previous receipt in the chain (null until the chain is persisted). */
  prevReceiptHash?: string | null;
}

export interface ProofReceipt {
  v: typeof PROOF_RECEIPT_VERSION;
  actionKind: string;
  /** Stable scope string, e.g. "platform" | "org:123". */
  scope: string;
  /** Numeric org id (null for platform) — denormalized for indexing/queries. */
  orgId: number | null;
  payloadHash: string;
  accountableHumanId: string;
  constitutionVersion: string;
  constitutionVersionHash: string;
  gateResults: Array<{ gate: string; status: string }>;
  evalScore: number | null;
  costUsd: number | null;
  autonomyLevel: string | null;
  situationHash: string | null;
  disclosure: string;
  issuedAt: string;
  prevReceiptHash: string | null;
  /** sha256 over the canonical form of every field above. The integrity seal. */
  receiptHash: string;
}

// ── Canonical hashing ────────────────────────────────────────────────────────

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(sortValue(value)), "utf8").digest("hex");
}

/** sha256 of a canonicalized payload — what `payloadHash` on a receipt should be. */
export function hashPayload(value: unknown): string {
  return sha256Canonical(value);
}

/** The constitution version + a stable content hash of the immutable principles. */
export const CONSTITUTION_VERSION: string = (RAW_IMMUTABLES as { version?: string }).version ?? "unknown";
export const CONSTITUTION_VERSION_HASH: string = sha256Canonical(RAW_IMMUTABLES);

/** The receipt body that the receiptHash seals (everything except the hash itself). */
function receiptBody(r: Omit<ProofReceipt, "receiptHash">): Omit<ProofReceipt, "receiptHash"> {
  return r;
}

function hashReceiptBody(r: ProofReceipt | Omit<ProofReceipt, "receiptHash">): string {
  const { ...rest } = r as ProofReceipt;
  delete (rest as Partial<ProofReceipt>).receiptHash;
  return sha256Canonical(rest);
}

// ── Build + verify ────────────────────────────────────────────────────────────

/**
 * Build a sealed proof-receipt for a witnessed governed action. `issuedAt` is
 * injected (ISO string) so the function is pure and testable — the wire site
 * passes `new Date().toISOString()`.
 */
export function buildReceipt(input: ProofReceiptInput, issuedAt: string): ProofReceipt {
  const body: Omit<ProofReceipt, "receiptHash"> = receiptBody({
    v: PROOF_RECEIPT_VERSION,
    actionKind: input.actionKind,
    scope: describeScope(input.scope),
    orgId: scopeOrgId(input.scope),
    payloadHash: input.payloadHash,
    accountableHumanId: input.accountableHumanId,
    constitutionVersion: CONSTITUTION_VERSION,
    constitutionVersionHash: CONSTITUTION_VERSION_HASH,
    gateResults: input.gateResults ?? [],
    evalScore: input.evalScore ?? null,
    costUsd: input.costUsd ?? null,
    autonomyLevel: input.autonomyLevel ?? null,
    situationHash: input.situationHash ?? null,
    disclosure: ART50_DISCLOSURE,
    issuedAt,
    prevReceiptHash: input.prevReceiptHash ?? null,
  });
  return { ...body, receiptHash: hashReceiptBody(body) };
}

export interface ReceiptVerdict {
  valid: boolean;
  reason?: string;
  /** Whether the recorded constitution hash matches the CURRENTLY-loaded one.
   *  A false here is NOT invalid — the receipt faithfully records the
   *  constitution at issuance; this just flags that the constitution has since
   *  changed. */
  constitutionMatchesCurrent: boolean;
}

/**
 * Verify a receipt's integrity: recompute the hash over its canonical body and
 * confirm the required attribution is present. A standalone, dependency-light
 * check — anyone holding a receipt + this function (and the immutables) can
 * confirm it was neither tampered with nor fabricated.
 */
export function verifyReceipt(receipt: ProofReceipt): ReceiptVerdict {
  const constitutionMatchesCurrent = receipt.constitutionVersionHash === CONSTITUTION_VERSION_HASH;
  if (receipt.v !== PROOF_RECEIPT_VERSION) {
    return { valid: false, reason: `unsupported receipt version ${String(receipt.v)}`, constitutionMatchesCurrent };
  }
  if (!receipt.actionKind || !receipt.accountableHumanId) {
    return { valid: false, reason: "missing required attribution (actionKind / accountableHumanId)", constitutionMatchesCurrent };
  }
  if (!receipt.payloadHash) {
    return { valid: false, reason: "missing payloadHash", constitutionMatchesCurrent };
  }
  const recomputed = hashReceiptBody(receipt);
  if (recomputed !== receipt.receiptHash) {
    return { valid: false, reason: "receiptHash mismatch — the receipt has been tampered with", constitutionMatchesCurrent };
  }
  return { valid: true, constitutionMatchesCurrent };
}
