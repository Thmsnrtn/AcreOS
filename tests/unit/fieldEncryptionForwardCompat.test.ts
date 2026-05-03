/**
 * Forward-compatibility tests for the consolidated field encryption module.
 *
 * Verifies that the canonical decrypt at server/services/fieldEncryption.ts
 * round-trips ciphertexts produced by the THREE pre-consolidation paths:
 *
 *   A) services/encryption.ts (legacy "credentials") — 4-segment envelope
 *   B) services/encryption.ts v1                     — 3-segment org-derived salt
 *   C) services/configManager.encryptValue           — 3-segment direct hex key
 *
 * If any of these fail to round-trip, already-encrypted DB rows would
 * become unreadable after the consolidation lands. That is the failure
 * mode this test guards.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "crypto";

// We need a deterministic key for the canonical module. FIELD_ENCRYPTION_KEY
// is checked at first use, so set it before importing.
const FIELD_KEY_HEX = "a".repeat(64); // 32 bytes
const ENCRYPTION_KEY_UTF8 = "legacy-master-key-utf8-source-32"; // arbitrary utf8 master

const originalFieldKey = process.env.FIELD_ENCRYPTION_KEY;
const originalEncKey = process.env.ENCRYPTION_KEY;

beforeAll(() => {
  process.env.FIELD_ENCRYPTION_KEY = FIELD_KEY_HEX;
  process.env.ENCRYPTION_KEY = ENCRYPTION_KEY_UTF8;
});

afterAll(() => {
  if (originalFieldKey === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
  else process.env.FIELD_ENCRYPTION_KEY = originalFieldKey;
  if (originalEncKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalEncKey;
});

// Hand-construct ciphertexts in the legacy shapes so we don't depend on the
// pre-refactor implementations still existing in tree.

function legacy4Segment(plaintext: string): string {
  // services/encryption.ts v2 shape: <salt>:<iv>:<tag>:<ct>
  // key = scrypt(masterKey_utf8, salt, 32)
  const salt = crypto.randomBytes(32);
  const masterKey = Buffer.from(ENCRYPTION_KEY_UTF8, "utf8");
  const key = crypto.scryptSync(masterKey, salt, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let enc = cipher.update(plaintext, "utf8", "hex");
  enc += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return `${salt.toString("hex")}:${iv.toString("hex")}:${tag.toString("hex")}:${enc}`;
}

function legacy3SegmentOrgSalt(plaintext: string, orgId: number): string {
  // services/encryption.ts v1 shape: <iv>:<tag>:<ct>
  // key = scrypt(masterKey_utf8, "org-${orgId}-credentials", 32)
  const salt = Buffer.from(`org-${orgId}-credentials`, "utf8");
  const masterKey = Buffer.from(ENCRYPTION_KEY_UTF8, "utf8");
  const key = crypto.scryptSync(masterKey, salt, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let enc = cipher.update(plaintext, "utf8", "hex");
  enc += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc}`;
}

function legacy3SegmentConfigManager(plaintext: string): string {
  // configManager.encryptValue shape: <iv>:<tag>:<ct>
  // key = first 32 bytes of FIELD_ENCRYPTION_KEY interpreted as hex
  const key = Buffer.from(FIELD_KEY_HEX.slice(0, 64), "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

describe("fieldEncryption — forward-compatible decrypt", () => {
  it("round-trips canonical envelopes (encrypt → decrypt)", async () => {
    const { encrypt, decrypt, isEncrypted } = await import(
      "../../server/services/fieldEncryption"
    );
    const plaintext = "sk-live-canonical-value-123";
    const ct = encrypt(plaintext);
    expect(ct.startsWith("enc:v1:")).toBe(true);
    expect(isEncrypted(ct)).toBe(true);
    expect(decrypt(ct)).toBe(plaintext);
  });

  it("decrypts legacy 4-segment envelope from services/encryption.ts (v2 random salt)", async () => {
    const { decrypt } = await import("../../server/services/fieldEncryption");
    const plaintext = "legacy-credentials-blob-v2";
    const ct = legacy4Segment(plaintext);
    expect(ct.split(":").length).toBe(4);
    expect(decrypt(ct)).toBe(plaintext);
  });

  it("decrypts legacy 3-segment envelope from services/encryption.ts (v1 org-derived salt)", async () => {
    const { decrypt } = await import("../../server/services/fieldEncryption");
    const ORG_ID = 7;
    const plaintext = "legacy-credentials-blob-v1";
    const ct = legacy3SegmentOrgSalt(plaintext, ORG_ID);
    expect(ct.split(":").length).toBe(3);
    // Must pass orgId so the canonical decoder can derive the v1 salt.
    expect(decrypt(ct, ORG_ID)).toBe(plaintext);
  });

  it("decrypts legacy 3-segment envelope from configManager.encryptValue", async () => {
    const { decrypt } = await import("../../server/services/fieldEncryption");
    const plaintext = "legacy-config-tin-or-skiptrace-blob";
    const ct = legacy3SegmentConfigManager(plaintext);
    expect(ct.split(":").length).toBe(3);
    expect(decrypt(ct)).toBe(plaintext);
  });

  it("returns plaintext as-is when value is not encrypted (gradual migration)", async () => {
    const { decrypt } = await import("../../server/services/fieldEncryption");
    expect(decrypt("not-encrypted-value")).toBe("not-encrypted-value");
  });

  it("isAnyEncryptedEnvelope recognizes all three envelope shapes", async () => {
    const { encrypt, isAnyEncryptedEnvelope } = await import(
      "../../server/services/fieldEncryption"
    );
    expect(isAnyEncryptedEnvelope(encrypt("x"))).toBe(true);
    expect(isAnyEncryptedEnvelope(legacy4Segment("x"))).toBe(true);
    expect(isAnyEncryptedEnvelope(legacy3SegmentConfigManager("x"))).toBe(true);
    expect(isAnyEncryptedEnvelope("plaintext")).toBe(false);
    expect(isAnyEncryptedEnvelope(null)).toBe(false);
  });

  it("configManager.encryptValue/decryptValue still round-trip after delegation", async () => {
    const { encryptValue, decryptValue } = await import(
      "../../server/services/configManager"
    );
    const plaintext = "platform-credential-value";
    const ct = encryptValue(plaintext);
    // After consolidation, configManager emits the canonical envelope.
    expect(ct.startsWith("enc:v1:")).toBe(true);
    expect(decryptValue(ct)).toBe(plaintext);
    // And decryptValue still accepts legacy shapes for at-rest rows:
    expect(decryptValue(legacy3SegmentConfigManager(plaintext))).toBe(plaintext);
  });
});
