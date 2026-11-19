/**
 * The outward-action boundary — idempotency for consequential side effects.
 *
 * Canonical law 8: consequential actions require explicit authority, durable
 * execution, idempotency and receipts. BI74 puts idempotency at the
 * ACTION/PROVIDER boundary, not at the HTTP request: "retrying orchestration
 * must never duplicate consequential side effects."
 *
 * The concrete defect this closes: `directMailService.sendLetter()` deducts
 * credits, posts the piece cost to the ledger, and calls Lob. If the process
 * dies after Lob accepted the letter but before the result was recorded, the
 * retry deducts credits again, posts cost again, and prints a SECOND physical
 * letter to a real seller. No HTTP request is involved, so
 * `server/middleware/idempotency.ts` never sees it.
 *
 * SHAPE
 * -----
 *   const result = await withOutwardAction(
 *     { organizationId, actionKind: "physical_mail.letter", idempotencyKey, payload },
 *     async () => callTheProvider(),
 *   );
 *
 * The claim is atomic (`INSERT … ON CONFLICT DO NOTHING` against a unique
 * index), so two concurrent workers cannot both send. A second call with the
 * same key REPLAYS the recorded outcome instead of re-executing.
 *
 * WHY `classifyExisting` IS EXPORTED AND PURE
 * -------------------------------------------
 * The decision "execute / replay / refuse" is the entire safety property, and a
 * property that can only be tested against a live database is a property that
 * will not be tested. It is a pure function of (existing row, request hash), so
 * every branch — including the ones that are hard to produce for real, like a
 * concurrent in-flight claim or a key reused with different content — is
 * exhaustively covered in tests/unit/outwardActionIdempotency.test.ts.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not a receipt. A receipt is immutable proof that an action occurred
 * (`server/services/autopilot/proofReceipt.ts` — hash-chained,
 * prediction-sealed). This is the mutable CLAIM that stops the action happening
 * twice. BI76 is explicit that audit events, decision snapshots, action
 * receipts and outcomes are four different things and must not collapse into
 * one log; the claim ledger is a fifth, and it is operational state rather than
 * history, which is why this table is the only one in the canonical set that is
 * legitimately mutable.
 */

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  outwardActions,
  type OutwardActionRow,
  type OutwardActionStatus,
} from "@shared/schema";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";

// ── Errors ────────────────────────────────────────────────────────────────

/** Base class so callers can catch the whole family. */
export class OutwardActionError extends Error {}

/** A send for this key is already underway in another worker/process. */
export class ActionInFlightError extends OutwardActionError {
  constructor(kind: string, key: string) {
    super(
      `Outward action ${kind}:${key} is already in flight. Refusing a concurrent ` +
        `send — two workers must never both call the provider for one logical action.`,
    );
  }
}

/**
 * The previous attempt's outcome is UNKNOWN. Retrying could duplicate a real
 * side effect, so this refuses until a human or a reconciliation job resolves
 * it (AU28). This is the error that stops a double-printed letter.
 */
export class ActionAmbiguousError extends OutwardActionError {
  constructor(kind: string, key: string, externalId: string | null) {
    super(
      `Outward action ${kind}:${key} has an AMBIGUOUS prior outcome` +
        (externalId ? ` (external id ${externalId})` : "") +
        `. Refusing to retry: the provider may already have performed it. ` +
        `Reconcile against the provider, then resolve the claim explicitly.`,
    );
  }
}

/**
 * The action provably never reached the provider, so retrying is SAFE.
 *
 * This exists because "ambiguous" is the right DEFAULT and the wrong ANSWER for
 * a whole class of failures. A transport's exec body typically runs several
 * steps before it touches the provider — resolving credentials, checking a
 * credit balance, validating an address — and every one of those can throw. An
 * unclassified throw is recorded as `ambiguous`, which permanently refuses every
 * later attempt on that key until a human reconciles.
 *
 * For a genuine mid-flight timeout that is exactly right. For "insufficient
 * credits" it is a trap: nothing was sent, nothing was charged, no provider was
 * contacted — and yet topping up the balance and retrying would hit
 * `ActionAmbiguousError` forever, with a message telling the operator to
 * reconcile against a provider that never heard of the request. A recoverable
 * refusal becomes a permanent dead end, and the letter can never be sent under
 * its own durable key.
 *
 * THE POLARITY IS DELIBERATE. A transport must PROVE it did not contact the
 * provider by throwing this type; everything else stays ambiguous. Defaulting
 * the other way — assuming no contact unless proven otherwise — is how a second
 * letter reaches a real mailbox.
 *
 * Throw this ONLY from code that runs strictly before the provider call. If a
 * request has left the process, it is not this error, however certain the
 * failure looks.
 */
export class ProviderNotContactedError extends OutwardActionError {
  constructor(message: string, readonly cause?: Error) {
    super(message);
    this.name = "ProviderNotContactedError";
  }
}

/**
 * True when an error carries the mail lane's structured billing verdict:
 * `withBillingVerdict` (server/services/mail/mailLane.ts) stamps
 * `providerNotBilled: true` only when the provider CERTAINLY did not accept
 * the piece — it was never contacted, or it answered with a rejection
 * status (e.g. Lob's 422 for an undeliverable recipient address: nothing
 * was created, printed or billed). The flag is a proof attached by the
 * transport that made the call, the same trust level as throwing
 * ProviderNotContactedError; the absence of the flag proves nothing and
 * the caller stays `ambiguous`. A timeout, a dropped connection or a 5xx
 * carries no such verdict and stays `ambiguous`.
 */
function hasProviderNotBilledVerdict(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { providerNotBilled?: unknown }).providerNotBilled === true
  );
}

/**
 * The same idempotency key was reused for materially different content in a
 * state where the earlier content may already have been sent (or may have
 * been — `ambiguous`). The message is operator language on purpose: this
 * text is written onto the letter/message record the operator reads, so it
 * names what happened and what to do next, not the rail's internals.
 */
export class ActionKeyReusedError extends OutwardActionError {
  /** Kept for logs/diagnostics; deliberately NOT in the operator message. */
  readonly actionKind: string;
  readonly idempotencyKey: string;

  constructor(kind: string, key: string) {
    super(
      `This can't be sent with changed content: an earlier version of this ` +
        `item was already recorded with different content, and sending a ` +
        `changed version under the same record could hide a duplicate. ` +
        `To send the changed version, create a new item with the corrected ` +
        `details. To send the original, restore its original content and ` +
        `try again.`,
    );
    this.actionKind = kind;
    this.idempotencyKey = key;
  }
}

// ── Request hashing ───────────────────────────────────────────────────────

/**
 * Stable hash of a request payload.
 *
 * Object keys are sorted recursively so that two structurally identical
 * payloads hash the same regardless of construction order — otherwise a
 * harmless reordering would look like key reuse and refuse a legitimate retry.
 */
export function requestHash(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

// ── The decision ──────────────────────────────────────────────────────────

export type ClaimVerdict =
  | { verdict: "execute"; reason: string }
  | { verdict: "replay"; reason: string; externalId: string | null }
  | { verdict: "refuse"; reason: string; error: OutwardActionError };

/**
 * Decide what to do about an existing claim row. PURE — no I/O, no clock.
 *
 * The precedence matters and is deliberate:
 *   1. `failed` is decided FIRST, before the payload check. A `failed` row
 *      exists only where the attempt PROVABLY never performed the action
 *      (the provider was never contacted, or it definitively rejected the
 *      request before accepting it — see ProviderNotContactedError and the
 *      `providerNotBilled` verdict below). Nothing was sent under the old content, so a
 *      corrected payload may supersede it under the same key: this is the
 *      L-DEF-3 cure — a letter whose send failed because the recipient
 *      address was wrong can be fixed and re-sent, instead of refusing
 *      forever and forcing the operator to recreate it by hand.
 *   2. For every other status, a payload mismatch refuses FIRST. A key
 *      reused for different content where a send happened (`succeeded`) or
 *      may have happened (`ambiguous`) must never execute or replay: letting
 *      a `succeeded` row replay a stale result for new content would
 *      silently suppress a send the caller genuinely wanted, and retrying
 *      an `ambiguous` row with changed content could print a second letter.
 *   3. `succeeded` replays — the whole point.
 *   4. `ambiguous` refuses — never guess with someone else's money.
 *   5. `in_flight` refuses — a concurrent worker owns it.
 */
export function classifyExisting(
  existing: Pick<
    OutwardActionRow,
    "actionKind" | "idempotencyKey" | "requestHash" | "status" | "externalId"
  >,
  incomingHash: string,
): ClaimVerdict {
  const { actionKind: kind, idempotencyKey: key } = existing;

  // A provably-unperformed attempt may be superseded by corrected content
  // under the same key (precedence note 1 above). The re-claim in
  // withOutwardAction stores the incoming hash, so from here on the key is
  // bound to the corrected content exactly as strictly as before.
  if (existing.status === "failed") {
    return {
      verdict: "execute",
      reason:
        existing.requestHash === incomingHash
          ? "prior attempt failed before any side effect; safe to retry"
          : "prior attempt provably never performed the action; corrected content may supersede it under the same key",
    };
  }

  if (existing.requestHash !== incomingHash) {
    return {
      verdict: "refuse",
      reason: "idempotency key reused for a different payload",
      error: new ActionKeyReusedError(kind, key),
    };
  }

  switch (existing.status) {
    case "succeeded":
      return {
        verdict: "replay",
        reason: "already performed; returning the recorded outcome",
        externalId: existing.externalId,
      };
    case "ambiguous":
      return {
        verdict: "refuse",
        reason: "prior outcome unknown; retry could duplicate a real side effect",
        error: new ActionAmbiguousError(kind, key, existing.externalId),
      };
    case "in_flight":
      return {
        verdict: "refuse",
        reason: "another worker is performing this action now",
        error: new ActionInFlightError(kind, key),
      };
    default: {
      // An unrecognised status is not a reason to send. Refuse loudly rather
      // than fall through to execute — the failure mode of guessing here is a
      // duplicate consequential action.
      const unknown: never = existing.status;
      return {
        verdict: "refuse",
        reason: `unrecognised claim status ${String(unknown)}`,
        error: new OutwardActionError(
          `Outward action ${kind}:${key} has unrecognised status ` +
            `"${String(unknown)}" — refusing rather than guessing.`,
        ),
      };
    }
  }
}

/**
 * How the executed provider call turned out.
 *
 * `ambiguous` is not an error the caller invents — it is what a timeout or a
 * dropped connection AFTER the request left genuinely means.
 */
export type ExecOutcome<T> =
  | { status: "succeeded"; externalId: string; result: T }
  | { status: "failed"; error: Error }
  | { status: "ambiguous"; error: Error; externalId?: string };

export interface OutwardActionSpec {
  organizationId: number;
  /** e.g. "physical_mail.letter". Namespaced so kinds cannot collide. */
  actionKind: string;
  /** Derived from durable domain identity — NEVER a random value. */
  idempotencyKey: string;
  /** Everything that materially defines the request. Hashed, not stored raw. */
  payload: unknown;
}

/**
 * Run a consequential action at most once per (org, kind, key).
 *
 * @param exec must classify its own outcome. A provider call that throws AFTER
 *   the request was accepted is `ambiguous`, not `failed` — getting that
 *   distinction right is the difference between a safe retry and a second
 *   letter in someone's mailbox.
 * @param onReplay produces the return value when the action already happened.
 *   Given the recorded externalId. Callers that cannot reconstruct a result
 *   from an id should return a typed "already sent" marker rather than lie.
 */
export async function withOutwardAction<T>(
  spec: OutwardActionSpec,
  exec: () => Promise<ExecOutcome<T>>,
  onReplay: (externalId: string | null) => T,
): Promise<T> {
  const hash = requestHash(spec.payload);

  // ── Atomic claim. ON CONFLICT DO NOTHING means exactly one caller wins. ──
  const inserted = await db
    .insert(outwardActions)
    .values({
      organizationId: spec.organizationId,
      actionKind: spec.actionKind,
      idempotencyKey: spec.idempotencyKey,
      requestHash: hash,
      status: "in_flight",
    })
    .onConflictDoNothing()
    .returning({ id: outwardActions.id });

  let claimId: number;

  if (inserted.length > 0) {
    claimId = inserted[0].id;
  } else {
    // Someone already claimed this key. Decide what that means.
    const [existing] = await db
      .select()
      .from(outwardActions)
      .where(
        and(
          eq(outwardActions.organizationId, spec.organizationId),
          eq(outwardActions.actionKind, spec.actionKind),
          eq(outwardActions.idempotencyKey, spec.idempotencyKey),
        ),
      )
      .limit(1);

    if (!existing) {
      // The row vanished between the failed insert and this read (a delete, or
      // a tenant cascade). Refusing is the safe reading: we cannot prove the
      // action has not already happened.
      throw new OutwardActionError(
        `Outward action ${spec.actionKind}:${spec.idempotencyKey} conflicted on ` +
          `claim but no row was found. Refusing rather than risking a duplicate.`,
      );
    }

    const decision = classifyExisting(existing, hash);
    if (decision.verdict === "refuse") {
      logger.warn(
        `[outward-action] refusing ${spec.actionKind}:${spec.idempotencyKey} — ${decision.reason}`,
      );
      throw decision.error;
    }
    if (decision.verdict === "replay") {
      logger.info(
        `[outward-action] replaying ${spec.actionKind}:${spec.idempotencyKey} — ${decision.reason}`,
      );
      return onReplay(decision.externalId);
    }

    // verdict === "execute": a previous attempt provably never performed the
    // action. The re-claim is CONDITIONAL on the row still being `failed` (DEFECT-0105):
    // an UPDATE by id alone let two workers that both read `failed` both flip
    // it to in_flight and both run exec() — two letters, two charges. Exactly
    // one UPDATE matches; the loser refuses rather than executing.
    // The re-claim also SUPERSEDES the stored request hash with the incoming
    // one (L-DEF-3): when the retry carries corrected content, the key is
    // re-bound to that content in the same conditional update, so a third
    // attempt is judged against the corrected payload, never the failed one.
    claimId = existing.id;
    const reclaimed = await db
      .update(outwardActions)
      .set({
        status: "in_flight",
        requestHash: hash,
        attempts: sql`${outwardActions.attempts} + 1`,
        lastError: null,
        claimedAt: clock.now(),
        completedAt: null,
      })
      .where(
        and(
          eq(outwardActions.id, claimId),
          eq(outwardActions.organizationId, spec.organizationId),
          eq(outwardActions.status, "failed"),
        ),
      )
      .returning({ id: outwardActions.id });
    if (reclaimed.length === 0) {
      throw new ActionInFlightError(spec.actionKind, spec.idempotencyKey);
    }
  }

  // ── We own the claim. Execute. ──
  let outcome: ExecOutcome<T>;
  try {
    outcome = await exec();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    // A transport that PROVES the action was not performed gets `failed`,
    // which is retryable — including with the cause corrected (L-DEF-3).
    // Two proofs count, and only these: the provider was never contacted
    // (ProviderNotContactedError), or the error carries the transport's
    // structured verdict that the provider did not bill/accept the piece
    // (`providerNotBilled: true`, stamped by withBillingVerdict — e.g. Lob
    // answering 422 for a bad recipient address, a definitive rejection
    // before acceptance). Without this, a pre-flight refusal (no credits,
    // no credentials) or a definitive provider rejection permanently
    // poisons the key: every later attempt would meet
    // ActionAmbiguousError and be told to reconcile against a provider
    // that never accepted anything.
    if (
      error instanceof ProviderNotContactedError ||
      hasProviderNotBilledVerdict(error)
    ) {
      await markClaim(claimId, "failed", null, error.message);
      logger.warn(
        `[outward-action] ${spec.actionKind}:${spec.idempotencyKey} provably not ` +
          `performed — recorded FAILED (retryable): ${error.message}`,
      );
      throw error;
    }

    // Anything else that escaped `exec` without being classified is, by
    // definition, an outcome we do not know. Treat it as AMBIGUOUS rather than
    // failed — the conservative reading is the one that does not double-send.
    await markClaim(claimId, "ambiguous", null, error.message);
    logger.error(
      `[outward-action] ${spec.actionKind}:${spec.idempotencyKey} threw without ` +
        `classifying its outcome — recorded AMBIGUOUS, not failed`,
      error,
    );
    throw error;
  }

  if (outcome.status === "succeeded") {
    await markClaim(claimId, "succeeded", outcome.externalId, null);
    return outcome.result;
  }
  if (outcome.status === "ambiguous") {
    await markClaim(claimId, "ambiguous", outcome.externalId ?? null, outcome.error.message);
    throw outcome.error;
  }
  await markClaim(claimId, "failed", null, outcome.error.message);
  throw outcome.error;
}

async function markClaim(
  id: number,
  status: OutwardActionStatus,
  externalId: string | null,
  lastError: string | null,
): Promise<void> {
  await db
    .update(outwardActions)
    .set({ status, externalId, lastError, completedAt: clock.now() })
    .where(eq(outwardActions.id, id));
}
