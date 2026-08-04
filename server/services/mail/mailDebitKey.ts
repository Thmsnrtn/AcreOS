/**
 * Deterministic idempotency key for the outreach-mail credit-pool debit.
 *
 * The queue endpoint debits the customer's credit pool for the piece count
 * BEFORE persisting the shipment. That debit's `externalEventId` is the ONLY
 * double-charge guard on the mail path (the route is not behind the shared
 * idempotency middleware). It previously embedded `Date.now()`, so every
 * network retry / double-click minted a new key and DOUBLE-DEBITED the pool.
 *
 * Fix (ASP-3): derive the key PURELY from stable request content — the org, the
 * audience filter that resolves the recipient set, and the piece type/provider/
 * count. Two identical queue requests (a double-click / lost-response retry)
 * produce the SAME key, so the pool debit's ON CONFLICT collapses them to a
 * single debit; a genuinely different send (different audience, piece type,
 * provider, or count) gets its own key. Deliberate identical re-sends are
 * already suppressed upstream by preMailDedupe's 90-day re-mail filter, so
 * content-hashing does not create an under-charge path in practice.
 *
 * NOTE: an earlier version also honored a client `Idempotency-Key` header. That
 * was actively wrong for THIS path: the browser (apiRequest {idempotent:true})
 * mints a FRESH random UUID per call, so two clicks carried two different keys
 * and the content hash was never reached — the double-charge guard did not
 * exist in production. The client key is deliberately NOT consulted here; the
 * content IS the idempotency identity of a mail send.
 */
import { createHash } from "node:crypto";

/** Recursively key-sorted JSON so object key order can't change the hash. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export interface MailDebitKeyInput {
  orgId: number;
  /** The audience filter that deterministically resolves the recipient set. */
  audienceFilter: unknown;
  pieceType: string;
  provider: string;
  pieceCount: number;
}

export function mailDebitIdempotencyKey(input: MailDebitKeyInput): string {
  const canonical = stableStringify({
    audienceFilter: input.audienceFilter,
    pieceType: input.pieceType,
    provider: input.provider,
    pieceCount: input.pieceCount,
  });
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 32);
  return `mail:queue:${input.orgId}:c:${hash}`;
}
