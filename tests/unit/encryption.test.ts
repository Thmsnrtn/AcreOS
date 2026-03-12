/**
 * T282 — Encryption Service Tests
 * Tests credential encryption/decryption and API key masking.
 */

import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";

// ─── Inline pure logic ────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function deriveOrgKey(masterKey: Buffer, organizationId: number): Buffer {
  const orgSalt = `org-${organizationId}-credentials`;
  return crypto.scryptSync(masterKey, orgSalt, 32);
}

function encryptCredentials(plaintext: string, organizationId: number, masterKey: Buffer): string {
  const key = deriveOrgKey(masterKey, organizationId);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

function decryptCredentials(ciphertext: string, organizationId: number, masterKey: Buffer): string {
  const key = deriveOrgKey(masterKey, organizationId);
  const [ivHex, authTagHex, encrypted] = ciphertext.split(":");

  if (!ivHex || !authTagHex || !encrypted) {
    throw new Error("Invalid encrypted credential format");
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function encryptJsonCredentials(credentials: Record<string, unknown>, organizationId: number, masterKey: Buffer): string {
  return encryptCredentials(JSON.stringify(credentials), organizationId, masterKey);
}

function decryptJsonCredentials<T extends Record<string, unknown>>(ciphertext: string, organizationId: number, masterKey: Buffer): T {
  return JSON.parse(decryptCredentials(ciphertext, organizationId, masterKey)) as T;
}

function maskApiKey(key: string | undefined | null): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const MASTER_KEY = Buffer.from("test-master-key-for-encryption-testing-32b", "utf8").slice(0, 32);
const ORG_ID = 42;

describe("encryptCredentials / decryptCredentials", () => {
  it("encrypts and decrypts a simple string", () => {
    const plaintext = "my-secret-api-key";
    const ciphertext = encryptCredentials(plaintext, ORG_ID, MASTER_KEY);
    const decrypted = decryptCredentials(ciphertext, ORG_ID, MASTER_KEY);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const plaintext = "same-secret";
    const c1 = encryptCredentials(plaintext, ORG_ID, MASTER_KEY);
    const c2 = encryptCredentials(plaintext, ORG_ID, MASTER_KEY);
    expect(c1).not.toBe(c2);
    // But both decrypt to the same value
    expect(decryptCredentials(c1, ORG_ID, MASTER_KEY)).toBe(plaintext);
    expect(decryptCredentials(c2, ORG_ID, MASTER_KEY)).toBe(plaintext);
  });

  it("uses org-specific keys (different orgs produce different ciphertext)", () => {
    const plaintext = "test";
    const c1 = encryptCredentials(plaintext, 1, MASTER_KEY);
    const c2 = encryptCredentials(plaintext, 2, MASTER_KEY);
    // Org 1's key can't decrypt org 2's ciphertext
    expect(() => decryptCredentials(c2, 1, MASTER_KEY)).toThrow();
  });

  it("throws on invalid ciphertext format", () => {
    expect(() => decryptCredentials("invalid", ORG_ID, MASTER_KEY)).toThrow("Invalid encrypted credential format");
  });

  it("handles strings with special characters", () => {
    const secret = "key=abc&secret=def!@#$%^&*()";
    const c = encryptCredentials(secret, ORG_ID, MASTER_KEY);
    expect(decryptCredentials(c, ORG_ID, MASTER_KEY)).toBe(secret);
  });
});

describe("encryptJsonCredentials / decryptJsonCredentials", () => {
  it("encrypts and decrypts JSON objects", () => {
    const creds = { apiKey: "abc123", secret: "xyz789", region: "us-east-1" };
    const c = encryptJsonCredentials(creds, ORG_ID, MASTER_KEY);
    const decrypted = decryptJsonCredentials<typeof creds>(c, ORG_ID, MASTER_KEY);
    expect(decrypted).toEqual(creds);
  });

  it("handles nested objects", () => {
    const creds = { auth: { key: "abc", token: "xyz" } };
    const c = encryptJsonCredentials(creds, ORG_ID, MASTER_KEY);
    expect(decryptJsonCredentials(c, ORG_ID, MASTER_KEY)).toEqual(creds);
  });
});

describe("maskApiKey", () => {
  it("masks a long API key showing first 4 and last 4", () => {
    expect(maskApiKey("sk-abcdefgh12345678")).toBe("sk-a...5678");
  });

  it("returns **** for short keys (8 chars or less)", () => {
    expect(maskApiKey("12345678")).toBe("****");
    expect(maskApiKey("short")).toBe("****");
  });

  it("returns empty string for null/undefined", () => {
    expect(maskApiKey(null)).toBe("");
    expect(maskApiKey(undefined)).toBe("");
    expect(maskApiKey("")).toBe("");
  });

  it("handles exactly 9 char key (shows mask)", () => {
    expect(maskApiKey("123456789")).toBe("1234...6789");
  });
});
