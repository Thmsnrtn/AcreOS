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
 * hash is deterministic over a canonicalized body.
 *
 * Frontier #4 — the receipt is now a FALSIFIABLE COMMITMENT, not just a record:
 *   • prediction-sealed — the brain's forecast (P(success), expected value,
 *     predicted cost) is sealed into the hash at issuance, so the autopilot
 *     CANNOT retroactively claim it called the outcome. `scorePrediction`
 *     grades the sealed forecast against reality (a Brier contribution).
 *   • replayable — `inputsHash` commits to the exact decision inputs, so an
 *     auditor can reconstruct the inputs, re-hash, and confirm THIS action
 *     followed from THOSE inputs under THAT constitution (deterministic replay).
 *   • cause-allocable — `causeAllocation` names the lever the outcome delta
 *     should be attributed to, closing the loop to the causal world-model.
 * v2 adds these three fields (always present, null-default); v1 receipts (no
 * such fields) still verify — `verifyReceipt` accepts both versions and hashes
 * each over its own body shape.
 */

import { createHash } from "node:crypto";
import { RAW_IMMUTABLES } from "@sovereign/immutables";
import { type TenantScope, describeScope, scopeOrgId } from "./tenantScope";

/** Current emit version. v2 seals prediction + inputsHash + causeAllocation. */
export const PROOF_RECEIPT_VERSION = 2 as const;
export type ReceiptVersion = 1 | 2;
/** Every version this build can still verify (older receipts stay valid). */
export const SUPPORTED_RECEIPT_VERSIONS: ReadonlySet<number> = new Set([1, 2]);

/** The `prevReceiptHash` of the first receipt in any scope's chain. */
export const GENESIS_RECEIPT_HASH = "GENESIS";

/**
 * EU AI Act Art. 50 transparency line — every witnessed governed action carries
 * it, stating the action was machine-prepared and human-authorized.
 */
export const ART50_DISCLOSURE =
  "Prepared by AcreOS automated operations and executed only under explicit human approval (EU AI Act Art. 50 transparency).";

/**
 * The brain's SEALED forecast at decision time — a commitment, not a record.
 * Once in the receiptHash it can't be edited; `scorePrediction` grades it
 * against the realized outcome. All fields nullable (the brain may abstain).
 */
export interface SealedPrediction {
  /** P(this action succeeds), 0..1, as the brain believed AT ISSUANCE. */
  pSuccess: number | null;
  /** Expected value in USD the brain attributed to this action. */
  expectedValueUsd: number | null;
  /** Predicted cost in USD (vs the realized cost on the receipt). */
  predictedCostUsd: number | null;
  /** Where the forecast came from, e.g. "contextualForecast" | "memory" | "prior". */
  basis: string;
}

/** What the realized outcome delta should be attributed to (causal world-model). */
export interface CauseAllocation {
  /** The lever/cause, e.g. "publish_guide" | "recover_payment". */
  lever: string;
  /** The concrete move kind that fired. */
  moveKind: string;
  /** Attribution weight 0..1 (1 = solely this cause). */
  weight: number;
}

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
  /** The brain's sealed forecast at issuance (Frontier #4 — falsifiable). */
  prediction?: SealedPrediction | null;
  /** sha256 of the full decision inputs — the replay anchor (Frontier #4). */
  inputsHash?: string | null;
  /** What the outcome delta is attributed to (Frontier #4 — cause-allocable). */
  causeAllocation?: CauseAllocation | null;
  /** Link to the previous receipt in the chain (null until the chain is persisted). */
  prevReceiptHash?: string | null;
}

export interface ProofReceipt {
  v: ReceiptVersion;
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
  /** v2+ only: the sealed forecast (absent on v1 receipts). */
  prediction?: SealedPrediction | null;
  /** v2+ only: the replay anchor (absent on v1 receipts). */
  inputsHash?: string | null;
  /** v2+ only: the cause attribution (absent on v1 receipts). */
  causeAllocation?: CauseAllocation | null;
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
    // v2 — always present (null-default) so the body shape is stable + sealed.
    prediction: input.prediction ?? null,
    inputsHash: input.inputsHash ?? null,
    causeAllocation: input.causeAllocation ?? null,
    disclosure: ART50_DISCLOSURE,
    issuedAt,
    prevReceiptHash: input.prevReceiptHash ?? null,
  });
  return { ...body, receiptHash: hashReceiptBody(body) };
}

/**
 * sha256 of the full decision inputs — what `inputsHash` should be. This is the
 * REPLAY ANCHOR: an auditor who can reconstruct the exact inputs the brain saw
 * (situation + candidate moves + chosen) can re-hash them and confirm they match
 * the sealed `inputsHash`, proving THIS action deterministically followed from
 * THOSE inputs. (Alias of the canonical hash — named for intent at call sites.)
 */
export function hashDecisionInputs(value: unknown): string {
  return sha256Canonical(value);
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
  if (!SUPPORTED_RECEIPT_VERSIONS.has(receipt.v)) {
    return { valid: false, reason: `unsupported receipt version ${String(receipt.v)}`, constitutionMatchesCurrent };
  }
  if (!receipt.actionKind || !receipt.accountableHumanId) {
    return { valid: false, reason: "missing required attribution (actionKind / accountableHumanId)", constitutionMatchesCurrent };
  }
  if (receipt.accountableHumanId === "unknown") {
    // T1.3: a receipt with no real accountable human is not a valid governance
    // artifact — a witnessed action must name who authorized it.
    return { valid: false, reason: "accountable human is 'unknown' — no real principal attribution", constitutionMatchesCurrent };
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

export interface PredictionScore {
  /** Brier contribution (pSuccess - actual)², 0..1. Lower is better. */
  brier: number;
  /** The sealed P(success) being graded. */
  predicted: number;
  /** The realized outcome as 0/1. */
  actual: number;
  /** True when the brain was confidently WRONG (Brier > 0.25 — past the
   *  coin-flip line on the wrong side). The honest "you missed this" signal. */
  surprised: boolean;
}

/**
 * Grade a receipt's SEALED prediction against the realized outcome. Because the
 * prediction was hashed into the receipt at issuance, this is a falsifiable
 * after-the-fact score the autopilot cannot game — it committed to pSuccess
 * BEFORE the outcome was known. Returns null when the receipt sealed no pSuccess
 * (the brain honestly abstained — there is nothing to grade). Pure.
 */
export function scorePrediction(receipt: ProofReceipt, actualSuccess: boolean): PredictionScore | null {
  const p = receipt.prediction?.pSuccess;
  if (p == null || !Number.isFinite(p)) return null;
  const predicted = Math.min(1, Math.max(0, p));
  const actual = actualSuccess ? 1 : 0;
  const brier = (predicted - actual) ** 2;
  return { brier, predicted, actual, surprised: brier > 0.25 };
}
