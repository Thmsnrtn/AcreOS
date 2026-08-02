/**
 * Deterministic idempotency key for the outreach-mail credit-pool debit.
 *
 * The queue endpoint debits the customer's credit pool for the piece count
 * BEFORE persisting the shipment. That debit's `externalEventId` is the ONLY
 * double-charge guard on the mail path (the route is not behind the shared
 * idempotency middleware). It previously embedded `Date.now()`, so every
 * network retry / double-click minted a new key and DOUBLE-DEBITED the pool.
 *
 * Fix (ASP-3): derive the key from stable request content, honoring a
 * client-supplied Idempotency-Key when present. Two identical queue requests
 * (a retry) collapse to one debit; a genuinely different send (different
 * audience, piece type, provider, or count) gets its own key. Deliberate
 * identical re-sends are already suppressed upstream by preMailDedupe's 90-day
 * re-mail filter, so content-hashing does not create an under-charge path in
 * practice.
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
  /** Value of the request's Idempotency-Key header, if any. */
  clientKey?: string | null;
  /** The audience filter that deterministically resolves the recipient set. */
  audienceFilter: unknown;
  pieceType: string;
  provider: string;
  pieceCount: number;
}

export function mailDebitIdempotencyKey(input: MailDebitKeyInput): string {
  const clientKey = input.clientKey?.trim();
  if (clientKey) {
    return `mail:queue:${input.orgId}:ck:${clientKey}`;
  }
  const canonical = stableStringify({
    audienceFilter: input.audienceFilter,
    pieceType: input.pieceType,
    provider: input.provider,
    pieceCount: input.pieceCount,
  });
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 32);
  return `mail:queue:${input.orgId}:c:${hash}`;
}
