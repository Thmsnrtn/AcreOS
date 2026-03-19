import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
// Random salt length stored alongside ciphertext (replaces the predictable org-ID salt)
const SALT_LENGTH = 32;

function getMasterKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY must be set for credential encryption. " +
      "Generate one with: openssl rand -hex 32"
    );
  }
  return Buffer.from(key, "utf8");
}

/**
 * Derives a 32-byte key using scrypt with a random per-record salt.
 * The salt is returned so it can be stored alongside the ciphertext.
 */
function deriveKey(salt: Buffer): Buffer {
  return crypto.scryptSync(getMasterKey(), salt, 32);
}

/**
 * Encrypts plaintext with AES-256-GCM.
 * Output format: <saltHex>:<ivHex>:<authTagHex>:<ciphertextHex>
 * (v2 format — 4 segments; legacy 3-segment format is handled in decryptCredentials)
 */
export function encryptCredentials(plaintext: string, _organizationId?: number): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return `${salt.toString("hex")}:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts a credential string produced by encryptCredentials.
 * Supports both the v2 format (4 segments, random salt) and the legacy v1 format
 * (3 segments, org-ID-derived salt) so existing records continue to work.
 */
export function decryptCredentials(ciphertext: string, organizationId?: number): string {
  const parts = ciphertext.split(":");

  if (parts.length === 4) {
    // v2: saltHex:ivHex:authTagHex:ciphertextHex
    const [saltHex, ivHex, authTagHex, encrypted] = parts;
    const salt = Buffer.from(saltHex, "hex");
    const key = deriveKey(salt);
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  if (parts.length === 3 && organizationId !== undefined) {
    // v1 legacy: ivHex:authTagHex:ciphertextHex with org-ID-derived salt
    const [ivHex, authTagHex, encrypted] = parts;
    const legacySalt = Buffer.from(`org-${organizationId}-credentials`, "utf8");
    const key = crypto.scryptSync(getMasterKey(), legacySalt, 32);
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  throw new Error("Invalid encrypted credential format");
}

export function encryptJsonCredentials(credentials: Record<string, unknown>, organizationId: number): string {
  return encryptCredentials(JSON.stringify(credentials), organizationId);
}

export function decryptJsonCredentials<T extends Record<string, unknown>>(ciphertext: string, organizationId: number): T {
  const decrypted = decryptCredentials(ciphertext, organizationId);
  return JSON.parse(decrypted) as T;
}

export function maskApiKey(key: string | undefined | null): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
