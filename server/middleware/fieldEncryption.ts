/**
 * Field-Level Encryption Middleware
 *
 * Provides AES-256-GCM symmetric encryption for sensitive fields before they
 * are written to the database, and transparent decryption on read.
 *
 * Sensitive fields covered:
 *   - Land credit scores
 *   - Financial projections / cashflow models
 *   - SSNs / tax IDs stored on contact records
 *   - Bank account details
 *
 * Algorithm: AES-256-GCM (authenticated encryption, tamper-evident)
 * Key source: process.env.FIELD_ENCRYPTION_KEY (hex-encoded 32-byte key)
 *             Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Wire format (Base64 of JSON):
 *   { v: 1, iv: "<hex>", tag: "<hex>", ct: "<hex>" }
 *
 * Exports:
 *   encrypt(plaintext)          — encrypt a string value
 *   decrypt(ciphertext)         — decrypt back to plaintext
 *   isEncrypted(value)          — detect encrypted values
 *   encryptFields(obj, fields)  — encrypt named fields in a plain object
 *   decryptFields(obj, fields)  — decrypt named fields in a plain object
 *   encryptionMiddleware        — Express middleware (attaches helpers to req)
 */

import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

// ─── Constants ────────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;   // 256 bits
const IV_BYTES  = 12;   // 96-bit nonce (recommended for GCM)
const TAG_BYTES = 16;   // 128-bit authentication tag
const FORMAT_VERSION = 1;

// ─── Key management ───────────────────────────────────────────────────────────

function loadEncryptionKey(): Buffer {
  const hexKey = process.env.FIELD_ENCRYPTION_KEY;
  if (!hexKey) {
    // In development, use a deterministic dev key with a clear warning.
    // In production, the secretsValidation middleware will have already
    // blocked startup if the key is missing.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[fieldEncryption] FIELD_ENCRYPTION_KEY is required in production. " +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
      );
    }
    console.warn(
      "[fieldEncryption] FIELD_ENCRYPTION_KEY not set — using insecure dev key. " +
      "Set FIELD_ENCRYPTION_KEY in production."
    );
    return Buffer.alloc(KEY_BYTES, 0x42); // dev-only all-0x42 key
  }

  const key = Buffer.from(hexKey, "hex");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `[fieldEncryption] FIELD_ENCRYPTION_KEY must be ${KEY_BYTES * 2} hex characters (${KEY_BYTES} bytes). ` +
      `Got ${key.length} bytes.`
    );
  }
  return key;
}

// Lazy-load key once so errors surface at first use, not at module load time.
let _key: Buffer | null = null;
function getKey(): Buffer {
  if (!_key) _key = loadEncryptionKey();
  return _key;
}

// ─── Encrypted value marker ───────────────────────────────────────────────────

interface EncryptedPayload {
  v: number;      // format version
  iv: string;     // hex-encoded IV
  tag: string;    // hex-encoded GCM auth tag
  ct: string;     // hex-encoded ciphertext
}

const ENCRYPTED_PREFIX = "enc:v1:";

// ─── Core encrypt / decrypt ───────────────────────────────────────────────────

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a prefixed Base64 string safe to store in any text column.
 *
 * @throws if plaintext is null/undefined or encryption fails.
 */
export function encrypt(plaintext: string): string {
  if (plaintext === null || plaintext === undefined) {
    throw new Error("[fieldEncryption] Cannot encrypt null or undefined");
  }

  const key = getKey();
  const iv  = crypto.randomBytes(IV_BYTES);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ctBuf  = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    v:   FORMAT_VERSION,
    iv:  iv.toString("hex"),
    tag: tag.toString("hex"),
    ct:  ctBuf.toString("hex"),
  };

  return ENCRYPTED_PREFIX + Buffer.from(JSON.stringify(payload)).toString("base64");
}

/**
 * Decrypts a value previously produced by `encrypt()`.
 * Returns the original plaintext string.
 *
 * @throws if the value is not a valid encrypted payload or authentication fails.
 */
export function decrypt(ciphertext: string): string {
  if (!isEncrypted(ciphertext)) {
    // Value was never encrypted — return as-is to support gradual migration.
    return ciphertext;
  }

  const key = getKey();
  const base64Part = ciphertext.slice(ENCRYPTED_PREFIX.length);

  let payload: EncryptedPayload;
  try {
    payload = JSON.parse(Buffer.from(base64Part, "base64").toString("utf8"));
  } catch (err) {
    throw new Error("[fieldEncryption] Invalid encrypted payload format");
  }

  if (payload.v !== FORMAT_VERSION) {
    throw new Error(
      `[fieldEncryption] Unsupported encryption version: ${payload.v}. Expected ${FORMAT_VERSION}.`
    );
  }

  const iv  = Buffer.from(payload.iv,  "hex");
  const tag = Buffer.from(payload.tag, "hex");
  const ct  = Buffer.from(payload.ct,  "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    return plaintext;
  } catch {
    throw new Error(
      "[fieldEncryption] Decryption failed — authentication tag mismatch. " +
      "Data may have been tampered with or the wrong key is in use."
    );
  }
}

/**
 * Returns true if `value` looks like an output of `encrypt()`.
 */
export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

// ─── Object-level helpers ────────────────────────────────────────────────────

/**
 * Encrypts the named fields on a plain object in-place.
 * Fields that are null, undefined, or already encrypted are skipped.
 *
 * @example
 *   const row = { creditScore: "720", name: "Acme Corp" };
 *   encryptFields(row, ["creditScore"]);
 *   // row.creditScore is now "enc:v1:..."
 */
export function encryptFields<T extends Record<string, unknown>>(
  obj: T,
  fields: Array<keyof T>
): T {
  const out = { ...obj };
  for (const field of fields) {
    const value = out[field];
    if (value === null || value === undefined) continue;
    if (isEncrypted(value)) continue; // already encrypted
    out[field] = encrypt(String(value)) as T[keyof T];
  }
  return out;
}

/**
 * Decrypts the named fields on a plain object in-place.
 * Fields that are null, undefined, or not encrypted are returned as-is.
 *
 * @example
 *   const row = { creditScore: "enc:v1:..." };
 *   decryptFields(row, ["creditScore"]);
 *   // row.creditScore is now "720"
 */
export function decryptFields<T extends Record<string, unknown>>(
  obj: T,
  fields: Array<keyof T>
): T {
  const out = { ...obj };
  for (const field of fields) {
    const value = out[field];
    if (value === null || value === undefined) continue;
    if (!isEncrypted(value)) continue; // not encrypted, skip
    try {
      out[field] = decrypt(value) as T[keyof T];
    } catch (err) {
      console.error(`[fieldEncryption] Failed to decrypt field "${String(field)}":`, err);
      // Leave the encrypted value in place rather than crashing
    }
  }
  return out;
}

// ─── Domain-specific helpers ──────────────────────────────────────────────────

/** Fields in land/property records that require encryption. */
export const LAND_SENSITIVE_FIELDS = [
  "creditScore",
  "landCreditScore",
  "financialProjections",
  "cashflowModel",
  "internalNotes",
] as const;

/** Fields in contact/lead records that require encryption. */
export const CONTACT_SENSITIVE_FIELDS = [
  "ssn",
  "taxId",
  "bankAccountNumber",
  "routingNumber",
  "creditScore",
] as const;

/**
 * Encrypt sensitive land/property fields before DB write.
 */
export function encryptLandRecord<T extends Record<string, unknown>>(record: T): T {
  return encryptFields(record, LAND_SENSITIVE_FIELDS as unknown as Array<keyof T>);
}

/**
 * Decrypt sensitive land/property fields after DB read.
 */
export function decryptLandRecord<T extends Record<string, unknown>>(record: T): T {
  return decryptFields(record, LAND_SENSITIVE_FIELDS as unknown as Array<keyof T>);
}

/**
 * Encrypt sensitive contact/lead fields before DB write.
 */
export function encryptContactRecord<T extends Record<string, unknown>>(record: T): T {
  return encryptFields(record, CONTACT_SENSITIVE_FIELDS as unknown as Array<keyof T>);
}

/**
 * Decrypt sensitive contact/lead fields after DB read.
 */
export function decryptContactRecord<T extends Record<string, unknown>>(record: T): T {
  return decryptFields(record, CONTACT_SENSITIVE_FIELDS as unknown as Array<keyof T>);
}

// ─── Express middleware ───────────────────────────────────────────────────────

/**
 * Express middleware that attaches encryption helpers to the request object.
 * Downstream handlers can use req.encrypt() / req.decrypt() without importing
 * this module directly.
 *
 * Also validates that the encryption key is loadable at startup so misconfigured
 * deployments fail fast rather than silently storing plaintext.
 */
export function encryptionMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    // Validate key is available (will throw in production if missing)
    getKey();

    // Attach convenience helpers
    (req as any).encrypt = encrypt;
    (req as any).decrypt = decrypt;
    (req as any).isEncrypted = isEncrypted;
    (req as any).encryptFields = encryptFields;
    (req as any).decryptFields = decryptFields;
  } catch (err) {
    console.error("[fieldEncryption] Encryption middleware error:", err);
    // In production, propagate; in dev, allow the app to start
    if (process.env.NODE_ENV === "production") {
      next(err);
      return;
    }
  }

  next();
}

// ─── Key rotation helper ──────────────────────────────────────────────────────

/**
 * Re-encrypts a value under a new key.
 * Used during key rotation: decrypt with old key, re-encrypt with new key.
 *
 * @param encryptedValue — value encrypted under `oldKey`
 * @param oldKeyHex      — hex-encoded old 32-byte key
 * @param newKeyHex      — hex-encoded new 32-byte key
 */
export function rotateEncryption(
  encryptedValue: string,
  oldKeyHex: string,
  newKeyHex: string
): string {
  const oldKey = Buffer.from(oldKeyHex, "hex");
  const newKey = Buffer.from(newKeyHex, "hex");

  if (oldKey.length !== KEY_BYTES || newKey.length !== KEY_BYTES) {
    throw new Error("[fieldEncryption] Keys must be 32 bytes (64 hex chars)");
  }

  // Temporarily swap the module-level key for decryption
  const savedKey = _key;
  _key = oldKey;
  let plaintext: string;
  try {
    plaintext = decrypt(encryptedValue);
  } finally {
    _key = savedKey;
  }

  // Encrypt with new key
  _key = newKey;
  let reEncrypted: string;
  try {
    reEncrypted = encrypt(plaintext);
  } finally {
    _key = savedKey;
  }

  return reEncrypted;
}
