/**
 * Task #231 — Field-Level Encryption Unit Tests
 *
 * Tests AES-256-GCM encrypt/decrypt, IV uniqueness, tamper detection,
 * and the domain-specific helper functions.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Set a test encryption key (64 hex chars = 32 bytes)
const TEST_KEY = "a".repeat(64);

beforeEach(() => {
  process.env.FIELD_ENCRYPTION_KEY = TEST_KEY;
  // Force module re-import with new key
  vi.resetModules();
});

afterEach(() => {
  delete process.env.FIELD_ENCRYPTION_KEY;
  vi.resetModules();
});

async function getModule() {
  return await import("../../server/middleware/fieldEncryption");
}

describe("encrypt / decrypt round-trip", () => {
  it("encrypts and decrypts a simple string", async () => {
    const { encrypt, decrypt } = await getModule();
    const plaintext = "sensitive-ssn-123456789";
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("handles unicode strings", async () => {
    const { encrypt, decrypt } = await getModule();
    const plaintext = "José's account: €1,234.56 💰";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it("handles empty string", async () => {
    const { encrypt, decrypt } = await getModule();
    expect(decrypt(encrypt(""))).toBe("");
  });

  it("handles long strings (credit report text)", async () => {
    const { encrypt, decrypt } = await getModule();
    const long = "x".repeat(10_000);
    expect(decrypt(encrypt(long))).toBe(long);
  });

  it("throws when encrypting null", async () => {
    const { encrypt } = await getModule();
    expect(() => encrypt(null as any)).toThrow();
  });

  it("throws when encrypting undefined", async () => {
    const { encrypt } = await getModule();
    expect(() => encrypt(undefined as any)).toThrow();
  });
});

describe("IV uniqueness (AES-GCM nonce)", () => {
  it("produces different ciphertext for same plaintext on each call", async () => {
    const { encrypt } = await getModule();
    const plaintext = "same-credit-score-750";
    const results = new Set(Array.from({ length: 50 }, () => encrypt(plaintext)));
    // All 50 should be unique (random IV per call)
    expect(results.size).toBe(50);
  });

  it("each ciphertext decrypts to the same value", async () => {
    const { encrypt, decrypt } = await getModule();
    const plaintext = "test";
    for (let i = 0; i < 10; i++) {
      expect(decrypt(encrypt(plaintext))).toBe(plaintext);
    }
  });
});

describe("isEncrypted", () => {
  it("returns true for encrypted values", async () => {
    const { encrypt, isEncrypted } = await getModule();
    expect(isEncrypted(encrypt("hello"))).toBe(true);
  });

  it("returns false for plain strings", async () => {
    const { isEncrypted } = await getModule();
    expect(isEncrypted("plain text")).toBe(false);
    expect(isEncrypted("")).toBe(false);
    expect(isEncrypted("enc:v0:not-valid")).toBe(false);
  });

  it("returns false for non-strings", async () => {
    const { isEncrypted } = await getModule();
    expect(isEncrypted(42)).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
  });
});

describe("Tamper detection (GCM auth tag)", () => {
  it("throws on modified ciphertext", async () => {
    const { encrypt, decrypt } = await getModule();
    let ct = encrypt("secret");
    // Corrupt a character in the middle of the base64 payload to ensure
    // actual ciphertext bytes are changed (avoids base64 padding issues at end).
    const prefix = "enc:v1:";
    const b64 = ct.slice(prefix.length);
    const midIdx = Math.floor(b64.length / 2);
    const flipped = b64[midIdx] === "A" ? "B" : "A";
    ct = prefix + b64.slice(0, midIdx) + flipped + b64.slice(midIdx + 1);
    expect(() => decrypt(ct)).toThrow();
  });
});

describe("encryptFields / decryptFields", () => {
  it("encrypts named fields in an object", async () => {
    const { encryptFields, isEncrypted } = await getModule();
    const obj = { name: "John", ssn: "123-45-6789", email: "john@example.com" };
    const encrypted = encryptFields(obj, ["ssn"]);
    expect(isEncrypted(encrypted.ssn)).toBe(true);
    expect(encrypted.name).toBe("John"); // not encrypted
    expect(encrypted.email).toBe("john@example.com"); // not encrypted
  });

  it("decrypts named fields in an object", async () => {
    const { encryptFields, decryptFields } = await getModule();
    const obj = { creditScore: "720", name: "Acme Corp" };
    const enc = encryptFields(obj, ["creditScore"]);
    const dec = decryptFields(enc, ["creditScore"]);
    expect(dec.creditScore).toBe("720");
  });

  it("skips null/undefined fields gracefully", async () => {
    const { encryptFields, isEncrypted } = await getModule();
    const obj = { ssn: null as any, name: "test" };
    const result = encryptFields(obj, ["ssn"]);
    expect(result.ssn).toBe(null);
  });

  it("does not double-encrypt already-encrypted values", async () => {
    const { encryptFields, encrypt, isEncrypted } = await getModule();
    const alreadyEncrypted = encrypt("720");
    const obj = { score: alreadyEncrypted };
    const result = encryptFields(obj, ["score"]);
    // Should still start with the enc: prefix (not double-encoded)
    expect(isEncrypted(result.score)).toBe(true);
    expect(result.score).toBe(alreadyEncrypted);
  });
});

describe("decrypt — pass-through for non-encrypted values", () => {
  it("returns plain values as-is (gradual migration support)", async () => {
    const { decrypt } = await getModule();
    expect(decrypt("plain text")).toBe("plain text");
  });
});
