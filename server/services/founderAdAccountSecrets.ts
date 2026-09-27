/**
 * Founder ad-account secrets at rest (DEFECT-0054, 2026-09-27).
 *
 * `founder_ad_accounts.access_token` and `.app_secret` hold AcreOS's own Meta
 * and TikTok advertising credentials — a token that can spend AcreOS's money.
 * They were written and read in plain text by five call sites. They are now
 * sealed with the canonical field encryption (AES-256-GCM, fieldEncryption.ts)
 * on the one write path and opened on every read path.
 *
 * Rows written before this change still hold plain text. `openAdAccountSecret`
 * passes a value through unchanged when it is not an encrypted envelope, so
 * those rows keep working, and the next save through
 * `upsertFounderAdAccount` seals them. Nothing here rewrites stored rows on
 * its own.
 *
 * `founderAdAccountSecretsAreSealed.test.ts` enumerates every place the table
 * is read or written and holds each to this module.
 */

import { encrypt, decrypt, isAnyEncryptedEnvelope } from "./fieldEncryption";

/** Seal a secret for storage. Already-sealed values are left as they are. */
export function sealAdAccountSecret(value: string): string;
export function sealAdAccountSecret(value: string | null | undefined): string | null;
export function sealAdAccountSecret(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return isAnyEncryptedEnvelope(value) ? value : encrypt(value);
}

/** Open a stored secret. A legacy plain-text value passes through. */
function openAdAccountSecret(value: string): string;
function openAdAccountSecret(value: string | null): string | null;
function openAdAccountSecret(value: string | null): string | null {
  if (value === null || value === "") return value;
  return isAnyEncryptedEnvelope(value) ? decrypt(value) : value;
}

/** A row as read, with its secrets opened for use. */
export function openFounderAdAccount<T extends { accessToken: string; appSecret: string | null }>(row: T): T {
  return { ...row, accessToken: openAdAccountSecret(row.accessToken), appSecret: openAdAccountSecret(row.appSecret) };
}

/** Last four characters for display; never the secret itself. */
export function maskAdAccountSecret(value: string | null): string | null {
  return value ? "••••••••" + value.slice(-4) : null;
}
