/**
 * fieldEncryption — Canonical Field/Credential Encryption (AcreOS)
 *
 * Consolidates the three formerly-parallel encryption code paths:
 *
 *   1. server/services/encryption.ts        (legacy "credentials" — DEPRECATED)
 *   2. server/middleware/fieldEncryption.ts (canonical field encryption)
 *   3. server/services/configManager.ts     (encryptValue/decryptValue — kept,
 *                                            now delegates here for new writes)
 *
 * Algorithm: AES-256-GCM (authenticated, tamper-evident)
 * Key:       process.env.FIELD_ENCRYPTION_KEY (hex-encoded 32 bytes)
 *            Falls back to ENCRYPTION_KEY for backward compatibility.
 *
 * Wire format (all NEW writes):
 *   "enc:v1:" + base64(JSON({ v: 1, iv: <hex>, tag: <hex>, ct: <hex> }))
 *
 * Forward-compatible decrypt:
 *   `decrypt()` accepts THREE envelope shapes so existing rows in the DB
 *   continue to round-trip during the natural drain period:
 *
 *     A) enc:v1:<base64>             — canonical (this module)
 *     B) <salt>:<iv>:<tag>:<ct>      — legacy 4-segment from services/encryption.ts
 *                                       (scrypt-derived key with random per-record salt)
 *     C) <iv>:<tag>:<ct>             — legacy 3-segment from configManager.encryptValue
 *                                       and services/encryption.ts v1 (org-derived salt)
 *
 *   Detection is by shape, not by trial-and-error.
 *
 * Migration target: server/services/encryption.ts is @deprecated. Delete on
 * or after 2026-06-02 (30 days from 2026-05-03) once production has fully
 * drained.
 */

import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

// ─── Constants ────────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;   // 256 bits
const IV_BYTES  = 12;   // 96-bit nonce (recommended for GCM)
const TAG_BYTES = 16;   // 128-bit authentication tag
const FORMAT_VERSION = 1;
const ENCRYPTED_PREFIX = "enc:v1:";

// ─── Key management ───────────────────────────────────────────────────────────

function loadEncryptionKey(): Buffer {
  const hexKey = process.env.FIELD_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  if (!hexKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[fieldEncryption] FIELD_ENCRYPTION_KEY is required in production. " +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
      );
    }
    logger.warn("[fieldEncryption] FIELD_ENCRYPTION_KEY not set — using insecure dev key. " +
      "Set FIELD_ENCRYPTION_KEY in production.");
    return Buffer.alloc(KEY_BYTES, 0x42); // dev-only all-0x42 key
  }

  const key = Buffer.from(hexKey.slice(0, KEY_BYTES * 2), "hex");
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

// ─── Pillar D / D5 — Multi-version key ring ──────────────────────────────────
//
// Supports key rotation without re-encrypting every record on the day a new
// key takes effect. Operate the ring like this:
//
//   1. Generate a new key. Add it to FIELD_ENCRYPTION_KEYS keyed by a new
//      kid (e.g. "2026q3"). Keep the old kids in the ring during the
//      rotation window so old records still decrypt.
//   2. Set FIELD_ENCRYPTION_CURRENT_KID to the new kid. From now on,
//      `encrypt()` stamps the envelope with that kid; new records use it.
//   3. Run scripts/rotate-encrypted-fields.ts (deferred — future iteration)
//      to re-encrypt old records into the new kid over time.
//   4. Once every record is on the new kid, remove the old kid from the
//      ring + delete the old key material.
//
// Env var format:
//   FIELD_ENCRYPTION_KEYS={"2026q1":"<64hex>","2026q3":"<64hex>"}
//   FIELD_ENCRYPTION_CURRENT_KID=2026q3
//
// Backwards-compat: if FIELD_ENCRYPTION_KEYS is unset, the legacy single
// FIELD_ENCRYPTION_KEY is treated as the only kid ("default") and the
// envelope's `kid` field is omitted on encrypt (matches existing rows).

const LEGACY_KID = "default";

interface KeyRing {
  currentKid: string;
  keys: Map<string, Buffer>;
  isMultiKey: boolean;
}

let _keyRing: KeyRing | null = null;

function loadKeyRing(): KeyRing {
  const ringRaw = process.env.FIELD_ENCRYPTION_KEYS;
  if (!ringRaw) {
    // Legacy single-key mode — same behavior as before this commit.
    const key = getKey();
    const ring = new Map<string, Buffer>([[LEGACY_KID, key]]);
    return { currentKid: LEGACY_KID, keys: ring, isMultiKey: false };
  }

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(ringRaw);
  } catch {
    throw new Error("[fieldEncryption] FIELD_ENCRYPTION_KEYS must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("[fieldEncryption] FIELD_ENCRYPTION_KEYS must be an object kid → hex");
  }

  const ring = new Map<string, Buffer>();
  for (const [kid, hex] of Object.entries(parsed)) {
    if (typeof hex !== "string" || hex.length !== KEY_BYTES * 2) {
      throw new Error(
        `[fieldEncryption] FIELD_ENCRYPTION_KEYS[${kid}] must be ${KEY_BYTES * 2} hex chars`,
      );
    }
    const buf = Buffer.from(hex, "hex");
    if (buf.length !== KEY_BYTES) {
      throw new Error(`[fieldEncryption] FIELD_ENCRYPTION_KEYS[${kid}] hex parse failed`);
    }
    ring.set(kid, buf);
  }
  if (ring.size === 0) {
    throw new Error("[fieldEncryption] FIELD_ENCRYPTION_KEYS is empty");
  }

  const currentKid = process.env.FIELD_ENCRYPTION_CURRENT_KID;
  if (!currentKid) {
    throw new Error(
      "[fieldEncryption] FIELD_ENCRYPTION_CURRENT_KID must be set when FIELD_ENCRYPTION_KEYS is set",
    );
  }
  if (!ring.has(currentKid)) {
    throw new Error(
      `[fieldEncryption] FIELD_ENCRYPTION_CURRENT_KID=${currentKid} not present in keyring`,
    );
  }

  // Also include the legacy FIELD_ENCRYPTION_KEY as the "default" kid so
  // pre-rotation rows still decrypt during the migration window.
  if (!ring.has(LEGACY_KID)) {
    try {
      ring.set(LEGACY_KID, getKey());
    } catch {
      /* legacy key absent — fine, ring-only mode */
    }
  }
  return { currentKid, keys: ring, isMultiKey: true };
}

function getKeyRing(): KeyRing {
  if (!_keyRing) _keyRing = loadKeyRing();
  return _keyRing;
}

// Legacy "master key" path used by services/encryption.ts (utf8-encoded, scrypt-derived).
// Required for forward-compat decrypt of envelopes B and C written by the legacy module.
function getLegacyMasterKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  return Buffer.from(raw, "utf8");
}

// ─── Core encrypt / decrypt ───────────────────────────────────────────────────

interface EncryptedPayload {
  v: number;
  iv: string;
  tag: string;
  ct: string;
  // Pillar D / D5 — optional key-ring identifier. When present, decrypt
  // looks the key up in the ring; when absent, decrypt falls back to the
  // legacy single FIELD_ENCRYPTION_KEY for backwards-compat with rows
  // written before the keyring landed.
  kid?: string;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Always emits the canonical "enc:v1:" envelope.
 *
 * In multi-key mode (FIELD_ENCRYPTION_KEYS set), the envelope is stamped
 * with the current kid. In single-key (legacy) mode, kid is omitted.
 */
export function encrypt(plaintext: string): string {
  if (plaintext === null || plaintext === undefined) {
    throw new Error("[fieldEncryption] Cannot encrypt null or undefined");
  }

  const ring = getKeyRing();
  const key = ring.keys.get(ring.currentKid);
  if (!key) {
    throw new Error("[fieldEncryption] current key missing from ring");
  }
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
  if (ring.isMultiKey) {
    payload.kid = ring.currentKid;
  }

  return ENCRYPTED_PREFIX + Buffer.from(JSON.stringify(payload)).toString("base64");
}

/**
 * Forward-compatible decrypt.
 *
 * Accepts:
 *   A) enc:v1:<base64>             — canonical
 *   B) <salt>:<iv>:<tag>:<ct>      — legacy services/encryption.ts (4-segment, scrypt+salt)
 *   C) <iv>:<tag>:<ct>             — legacy configManager.encryptValue (3-segment)
 *
 * Pass `legacyOrganizationId` to decrypt the oldest 3-segment shape produced
 * by services/encryption.ts v1 (where the salt was `org-${orgId}-credentials`).
 */
export function decrypt(ciphertext: string, legacyOrganizationId?: number): string {
  // Pass-through: never-encrypted values are returned as-is so callers can
  // handle gradual migration without crashing.
  if (typeof ciphertext !== "string") return ciphertext as unknown as string;

  // Shape A — canonical envelope
  if (ciphertext.startsWith(ENCRYPTED_PREFIX)) {
    return decryptCanonical(ciphertext);
  }

  const parts = ciphertext.split(":");

  // Shape B — legacy 4-segment <salt>:<iv>:<tag>:<ct>
  if (parts.length === 4 && parts.every((p) => /^[0-9a-f]*$/i.test(p))) {
    return decryptLegacy4Segment(parts);
  }

  // Shape C — 3-segment <iv>:<tag>:<ct> (configManager) OR legacy v1 with org salt
  if (parts.length === 3 && parts.every((p) => /^[0-9a-f]*$/i.test(p))) {
    return decryptLegacy3Segment(parts, legacyOrganizationId);
  }

  // No marker, not segmented — assume plaintext (legacy un-encrypted row).
  return ciphertext;
}

function decryptCanonical(ciphertext: string): string {
  const ring = getKeyRing();
  const base64Part = ciphertext.slice(ENCRYPTED_PREFIX.length);

  let payload: EncryptedPayload;
  try {
    payload = JSON.parse(Buffer.from(base64Part, "base64").toString("utf8"));
  } catch {
    throw new Error("[fieldEncryption] Invalid encrypted payload format");
  }

  if (payload.v !== FORMAT_VERSION) {
    throw new Error(
      `[fieldEncryption] Unsupported encryption version: ${payload.v}. Expected ${FORMAT_VERSION}.`
    );
  }

  // Pillar D / D5 — pick the right key from the ring. If the envelope
  // names a kid, use that. Else fall back to the legacy single key (which
  // is registered in the ring as LEGACY_KID).
  const kid = payload.kid ?? LEGACY_KID;
  const key = ring.keys.get(kid);
  if (!key) {
    throw new Error(
      `[fieldEncryption] No key for kid=${kid}. Add it to FIELD_ENCRYPTION_KEYS or restore the previous key during rotation.`
    );
  }

  const iv  = Buffer.from(payload.iv,  "hex");
  const tag = Buffer.from(payload.tag, "hex");
  const ct  = Buffer.from(payload.ct,  "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(
      "[fieldEncryption] Decryption failed — authentication tag mismatch. " +
      "Data may have been tampered with or the wrong key is in use."
    );
  }
}

function decryptLegacy4Segment(parts: string[]): string {
  // services/encryption.ts v2: <saltHex>:<ivHex>:<authTagHex>:<ciphertextHex>
  // Key = scrypt(masterKey, salt, 32). masterKey is the utf8-encoded ENCRYPTION_KEY.
  const masterKey = getLegacyMasterKey();
  if (!masterKey) {
    throw new Error(
      "[fieldEncryption] Cannot decrypt legacy 4-segment envelope: ENCRYPTION_KEY not set"
    );
  }
  const [saltHex, ivHex, authTagHex, encrypted] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const key = crypto.scryptSync(masterKey, salt, 32);
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function decryptLegacy3Segment(parts: string[], legacyOrganizationId?: number): string {
  // Two possible producers wrote 3-segment envelopes:
  //   (a) configManager.encryptValue — key = first 32 bytes of FIELD_ENCRYPTION_KEY
  //       interpreted as hex. This is the canonical 3-segment path used by
  //       skip-trace + tax-1099 fixes.
  //   (b) services/encryption.ts v1 — key = scrypt(masterKey, "org-<id>-credentials").
  //       Only attempted if `legacyOrganizationId` is provided.
  const [ivHex, tagHex, encHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const encrypted = Buffer.from(encHex, "hex");

  // Path (a): direct hex key
  try {
    const key = getKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
  } catch {
    // Fall through to path (b) only if we have an org id and a master key.
  }

  // Path (b): legacy org-derived scrypt
  const masterKey = getLegacyMasterKey();
  if (legacyOrganizationId !== undefined && masterKey) {
    const legacySalt = Buffer.from(`org-${legacyOrganizationId}-credentials`, "utf8");
    const key = crypto.scryptSync(masterKey, legacySalt, 32);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  throw new Error("[fieldEncryption] Failed to decrypt 3-segment legacy envelope");
}

/**
 * Returns true if `value` looks like an output of `encrypt()` (canonical envelope).
 */
export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Returns true if `value` is any recognized encrypted envelope (canonical or legacy).
 * Useful for migration tooling.
 */
export function isAnyEncryptedEnvelope(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.startsWith(ENCRYPTED_PREFIX)) return true;
  const parts = value.split(":");
  if ((parts.length === 3 || parts.length === 4) &&
      parts.every((p) => /^[0-9a-f]+$/i.test(p))) {
    return true;
  }
  return false;
}

// ─── Object-level helpers ────────────────────────────────────────────────────

export function encryptFields<T extends Record<string, unknown>>(
  obj: T,
  fields: Array<keyof T>
): T {
  const out = { ...obj };
  for (const field of fields) {
    const value = out[field];
    if (value === null || value === undefined) continue;
    if (isEncrypted(value)) continue;
    out[field] = encrypt(String(value)) as T[keyof T];
  }
  return out;
}

export function decryptFields<T extends Record<string, unknown>>(
  obj: T,
  fields: Array<keyof T>
): T {
  const out = { ...obj };
  for (const field of fields) {
    const value = out[field];
    if (value === null || value === undefined) continue;
    if (!isEncrypted(value)) continue;
    try {
      out[field] = decrypt(value) as T[keyof T];
    } catch (err) {
      logger.error(`[fieldEncryption] Failed to decrypt field "${String(field)}"`, err);
    }
  }
  return out;
}

// ─── Domain-specific helpers ──────────────────────────────────────────────────

export const LAND_SENSITIVE_FIELDS = [
  "creditScore",
  "landCreditScore",
  "financialProjections",
  "cashflowModel",
  "internalNotes",
] as const;

export const CONTACT_SENSITIVE_FIELDS = [
  "ssn",
  "taxId",
  "bankAccountNumber",
  "routingNumber",
  "creditScore",
] as const;

export function encryptLandRecord<T extends Record<string, unknown>>(record: T): T {
  return encryptFields(record, LAND_SENSITIVE_FIELDS as unknown as Array<keyof T>);
}

export function decryptLandRecord<T extends Record<string, unknown>>(record: T): T {
  return decryptFields(record, LAND_SENSITIVE_FIELDS as unknown as Array<keyof T>);
}

export function encryptContactRecord<T extends Record<string, unknown>>(record: T): T {
  return encryptFields(record, CONTACT_SENSITIVE_FIELDS as unknown as Array<keyof T>);
}

export function decryptContactRecord<T extends Record<string, unknown>>(record: T): T {
  return decryptFields(record, CONTACT_SENSITIVE_FIELDS as unknown as Array<keyof T>);
}

// ─── Credential helpers (back-compat with services/encryption.ts API) ─────────
//
// These exist so call-sites that previously imported from services/encryption.ts
// can switch to importing from services/fieldEncryption with a one-line change.
// New writes go through the canonical envelope; reads tolerate legacy envelopes
// transparently.

/**
 * Encrypt a credential string (back-compat shim for services/encryption.ts).
 * The `_organizationId` parameter is accepted but ignored — keys are no
 * longer per-org-derived. Existing legacy ciphertexts that DID use a
 * per-org key remain decryptable via `decrypt()` if the original
 * organizationId is passed.
 */
export function encryptCredentials(plaintext: string, _organizationId?: number): string {
  return encrypt(plaintext);
}

/**
 * Decrypt a credential string (back-compat shim).
 * Accepts canonical, 4-segment, and 3-segment envelopes. The optional
 * `organizationId` is only used as a fallback to decrypt the very oldest
 * 3-segment v1 envelopes from services/encryption.ts where the salt was
 * derived from the org id.
 */
export function decryptCredentials(ciphertext: string, organizationId?: number): string {
  return decrypt(ciphertext, organizationId);
}

export function encryptJsonCredentials(
  credentials: Record<string, unknown>,
  organizationId?: number,
): string {
  return encryptCredentials(JSON.stringify(credentials), organizationId);
}

export function decryptJsonCredentials<T extends Record<string, unknown>>(
  ciphertext: string,
  organizationId?: number,
): T {
  return JSON.parse(decryptCredentials(ciphertext, organizationId)) as T;
}

export function maskApiKey(key: string | undefined | null): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// ─── Express middleware ───────────────────────────────────────────────────────

export function encryptionMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    getKey();
    (req as any).encrypt = encrypt;
    (req as any).decrypt = decrypt;
    (req as any).isEncrypted = isEncrypted;
    (req as any).encryptFields = encryptFields;
    (req as any).decryptFields = decryptFields;
  } catch (err) {
    logger.error("[fieldEncryption] Encryption middleware error", err);
    if (process.env.NODE_ENV === "production") {
      next(err);
      return;
    }
  }
  next();
}

// ─── Key rotation helper ──────────────────────────────────────────────────────

export function rotateEncryption(
  encryptedValue: string,
  oldKeyHex: string,
  newKeyHex: string,
): string {
  const oldKey = Buffer.from(oldKeyHex, "hex");
  const newKey = Buffer.from(newKeyHex, "hex");

  if (oldKey.length !== KEY_BYTES || newKey.length !== KEY_BYTES) {
    throw new Error("[fieldEncryption] Keys must be 32 bytes (64 hex chars)");
  }

  const savedKey = _key;
  _key = oldKey;
  let plaintext: string;
  try {
    plaintext = decrypt(encryptedValue);
  } finally {
    _key = savedKey;
  }

  _key = newKey;
  let reEncrypted: string;
  try {
    reEncrypted = encrypt(plaintext);
  } finally {
    _key = savedKey;
  }

  return reEncrypted;
}
