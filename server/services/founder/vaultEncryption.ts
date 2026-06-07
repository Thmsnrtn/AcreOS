/**
 * vaultEncryption — Founder Life-Cockpit encrypted-vault helper (FOUNDER-SIDE ONLY).
 *
 * Thin, founder-scoped wrapper over the canonical server/services/fieldEncryption
 * (AES-256-GCM, "enc:v1:" envelope). It exists so the founder personal-document /
 * income vault has ONE obvious, well-documented seam for encrypting:
 *
 *   - document blobs (binary file bytes → base64 → encrypted envelope)
 *   - dollar amounts (rounded whole-dollar string → encrypted envelope)
 *
 * SECURITY CONTRACT (non-negotiable — Beatrice + Quinn):
 *   - The DB NEVER sees plaintext SSNs, raw file bytes, or raw dollar amounts.
 *     Callers encrypt BEFORE the value reaches a column.
 *   - We NEVER log, echo, or return a decrypted value from any verification /
 *     debug path. Verify by length / prefix only (see assertEncrypted).
 *   - This data must NEVER be used to train or shape any customer feature.
 *
 * Reuses the existing key-ring so document blobs survive key rotation exactly
 * like every other encrypted field in the system.
 */

import { encrypt, decrypt, isEncrypted } from "../fieldEncryption";

/** The key-ring kid that will seal NEW writes (for the encryption_kid column). */
export function currentEncryptionKid(): string {
  return process.env.FIELD_ENCRYPTION_CURRENT_KID || "default";
}

/**
 * Encrypt raw file bytes for the document vault.
 * Bytes → base64 → AES-256-GCM envelope. Returns the "enc:v1:" string to store
 * in founder_documents.encrypted_blob.
 */
export function encryptDocumentBytes(bytes: Buffer): string {
  if (!Buffer.isBuffer(bytes)) {
    throw new Error("[vaultEncryption] encryptDocumentBytes requires a Buffer");
  }
  return encrypt(bytes.toString("base64"));
}

/**
 * Decrypt a stored document envelope back to raw file bytes.
 * Founder-only call sites; the result is streamed to the founder and never logged.
 */
export function decryptDocumentBytes(envelope: string): Buffer {
  const base64 = decrypt(envelope);
  return Buffer.from(base64, "base64");
}

/**
 * Encrypt a whole-dollar amount. We round to the nearest whole dollar (cents are
 * never decision-relevant for the income overview and we avoid float drift), then
 * encrypt the integer as a string. Returns the "enc:v1:" envelope.
 */
export function encryptAmount(dollars: number): string {
  if (typeof dollars !== "number" || !Number.isFinite(dollars)) {
    throw new Error("[vaultEncryption] encryptAmount requires a finite number");
  }
  return encrypt(String(Math.round(dollars)));
}

/**
 * Decrypt an amount envelope back to a whole-dollar number.
 * Returns null for null/undefined input so callers can render "not set".
 */
export function decryptAmount(envelope: string | null | undefined): number | null {
  if (envelope === null || envelope === undefined || envelope === "") return null;
  const raw = decrypt(envelope);
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Verification helper for tests / debug paths. Asserts a value is a sealed
 * envelope WITHOUT ever revealing the plaintext. Returns shape metadata only
 * (prefix + ciphertext length) — never the decrypted bytes. This is the only
 * sanctioned way to "inspect" vault data outside an authorized founder read.
 */
export function assertEncrypted(value: unknown): { sealed: boolean; prefix: string; length: number } {
  const sealed = isEncrypted(value);
  const str = typeof value === "string" ? value : "";
  return {
    sealed,
    prefix: str.slice(0, 7), // "enc:v1:" — safe, contains no secret material
    length: str.length,
  };
}
