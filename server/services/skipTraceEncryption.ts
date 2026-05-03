/**
 * R3 — Skip-trace PII at-rest encryption helpers.
 *
 * `skip_traces.input_data` and `skip_traces.results` carry PII returned by
 * skip-trace providers (DOB hints, last-4 SSN, phone numbers, prior
 * addresses, relatives). Storing them as plaintext JSONB violates the same
 * threat model that drove encryption of `organizations.ein` /
 * `leads.tax_id` (see commit 1229826 — tax 1099 fix).
 *
 * Strategy
 * ────────
 * Both columns are JSONB. Rather than alter the column type (a destructive,
 * reversible-only-with-care change) we store a small JSON envelope:
 *
 *     { "_enc": "<iv>:<tag>:<ct>", "_v": 1 }
 *
 * Plaintext is `JSON.stringify(value)` then run through
 * `configManager.encryptValue()` (AES-256-GCM, same key/format used for
 * `organizations.ein`). The envelope is unambiguously distinguishable from
 * a legacy plaintext row, which always carries the domain-shaped fields
 * (`phones`, `emails`, `addresses`, `name`, `apn`, ...).
 *
 * Read path is tolerant — if a row is still plaintext (legacy / pre-fix)
 * we return it as-is rather than crash. This mirrors the
 * `decryptStoredTin` pattern from `server/services/bookkeeping.ts` and
 * lets us land the fix without a destructive bulk re-write of existing
 * rows. A backfill script can be run later if desired, but the application
 * is correct in either state.
 *
 * Anything new we *write* from this point on is encrypted.
 */

import { encryptValue, decryptValue } from "./configManager";
import { logger } from "../utils/logger";

const ENVELOPE_VERSION = 1;

interface EncryptedEnvelope {
  _enc: string;
  _v: number;
}

/**
 * True if `value` is the encrypted envelope shape produced by
 * `encryptSkipTracePayload()`.
 *
 * Recognizes both:
 *   • the legacy 3-segment shape ("iv:tag:ct") written by the previous
 *     configManager.encryptValue, and
 *   • the canonical "enc:v1:<base64>" envelope written after the
 *     encryption-consolidation refactor (Aravind audit §3.1).
 */
export function isEncryptedSkipTracePayload(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== "object") return false;
  const enc = (value as any)._enc;
  if (typeof enc !== "string") return false;
  if (enc.startsWith("enc:v1:")) return true;
  return enc.split(":").length === 3;
}

/**
 * Encrypt a skip-trace JSON value (input_data or results) for at-rest
 * storage in a JSONB column. Returns the envelope object that should be
 * passed straight to Drizzle `.values({ inputData: <here> })`.
 *
 * Returns `null` for null/undefined so we don't store an empty envelope
 * over a NULL column.
 */
export function encryptSkipTracePayload<T>(value: T | null | undefined): EncryptedEnvelope | null {
  if (value === null || value === undefined) return null;
  const plaintext = JSON.stringify(value);
  return {
    _enc: encryptValue(plaintext),
    _v: ENVELOPE_VERSION,
  };
}

/**
 * Decrypt a skip-trace JSON value read from `inputData` or `results`.
 *
 * Tolerant of three legitimate row states:
 *   1. NULL              → returns null
 *   2. Encrypted envelope (post-R3 writes) → returns parsed plaintext T
 *   3. Plaintext object  (pre-R3 legacy)   → returns the object as-is
 *
 * If decryption itself fails (key mismatch / corruption) we log and return
 * null rather than 500 the request. A 500 here would leak that the row
 * exists; a quiet null lets the UI treat the row as "no result" and keeps
 * skip-trace listing endpoints alive after a key rotation mistake.
 */
export function decryptSkipTracePayload<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;

  if (isEncryptedSkipTracePayload(value)) {
    try {
      const plaintext = decryptValue(value._enc);
      return JSON.parse(plaintext) as T;
    } catch (err) {
      logger.error(
        "[skipTraceEncryption] Failed to decrypt skip-trace payload",
        err instanceof Error ? err : undefined,
      );
      return null;
    }
  }

  // Legacy plaintext row — return verbatim. New writes will overwrite the
  // row with an encrypted envelope the next time the trace is updated.
  return value as T;
}

/**
 * Decrypts both PII fields of a single skip_traces row in-place.
 * Safe to call on rows that are already plaintext (legacy) — they're
 * returned unchanged.
 */
export function decryptSkipTraceRow<
  R extends { inputData?: unknown; results?: unknown },
>(row: R | null | undefined): R | null | undefined {
  if (!row) return row;
  return {
    ...row,
    inputData: decryptSkipTracePayload(row.inputData),
    results: decryptSkipTracePayload(row.results),
  };
}
