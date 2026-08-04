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
 * audience, piece type, provider, or count) gets its own key.
 *
 * KNOWN LIMITATION — DO NOT "fix" this naively (a content-only permanent key
 * was tried in this branch and REVERTED after an adversarial review):
 *   • The browser (apiRequest {idempotent:true}) mints a FRESH random UUID per
 *     call, so in production the `ck:` branch below is what actually runs and a
 *     lost-response → re-click still double-debits + double-ships. The content
 *     hash is effectively dead on the live path.
 *   • But making the key content-ONLY (dropping the client key) is WRONG the
 *     other way: `financial_ledger.external_event_id` is a PERMANENT unique, so
 *     a deliberate second-touch campaign to the same audience/piece/provider/
 *     count weeks later collides with the first send's key and is silently
 *     dropped — and a retry after a (refunded) persist failure is misread as a
 *     completed replay. There is NO upstream preMailDedupe guard on this route
 *     (runPreMailDedupe is only wired into routes-campaigns.ts), so nothing
 *     rescues those cases.
 *   • The correct fix bounds send-idempotency to the RETRY WINDOW (a coarse
 *     time bucket or a per-submit nonce), makes the SHIPMENT itself idempotent
 *     (unique index on (organization_id, debit_event_key) + ON CONFLICT), and
 *     scopes replay detection to "debit row exists AND not refunded". That
 *     needs a migration + integration testing against a real DB, so it is left
 *     for a session that has one rather than shipped as another static guess.
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
