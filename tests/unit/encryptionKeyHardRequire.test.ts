/**
 * Encryption key hard-require — Beatrice / compliance-debt §3.
 *
 * fieldEncryption previously fell back to a STATIC all-0x42 key (a public
 * constant — effectively plaintext) whenever NODE_ENV !== "production" and the
 * key was unset. A worker / migrate process booting without NODE_ENV=production
 * would silently use it against prod data. The fix:
 *   (a) the dev fallback now derives an EPHEMERAL random key per boot, and
 *   (b) requireEncryptionKey() hard-requires FIELD_ENCRYPTION_KEY (or legacy
 *       ENCRYPTION_KEY) for any process that touches encrypted columns,
 *       INDEPENDENT of NODE_ENV.
 *
 * This test pins (b): the guard throws when no key is present, and passes when
 * either key is set — regardless of NODE_ENV. We never assert on key VALUES.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { requireEncryptionKey } from "../../server/utils/validateEnv";

const SAVED = {
  field: process.env.FIELD_ENCRYPTION_KEY,
  legacy: process.env.ENCRYPTION_KEY,
  node: process.env.NODE_ENV,
};

beforeEach(() => {
  delete process.env.FIELD_ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;
});

afterEach(() => {
  if (SAVED.field === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
  else process.env.FIELD_ENCRYPTION_KEY = SAVED.field;
  if (SAVED.legacy === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = SAVED.legacy;
  if (SAVED.node === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = SAVED.node;
});

describe("requireEncryptionKey", () => {
  it("throws when NEITHER key is set (dev — NODE_ENV not production)", () => {
    process.env.NODE_ENV = "development";
    expect(() => requireEncryptionKey()).toThrow(/FIELD_ENCRYPTION_KEY/);
  });

  it("throws when NEITHER key is set even with NODE_ENV unset (worker/migrate boot)", () => {
    delete process.env.NODE_ENV;
    expect(() => requireEncryptionKey()).toThrow(/regardless of NODE_ENV/);
  });

  it("passes when FIELD_ENCRYPTION_KEY is present", () => {
    process.env.FIELD_ENCRYPTION_KEY = "a".repeat(64);
    expect(() => requireEncryptionKey()).not.toThrow();
  });

  it("passes when only the legacy ENCRYPTION_KEY is present", () => {
    process.env.ENCRYPTION_KEY = "b".repeat(64);
    expect(() => requireEncryptionKey()).not.toThrow();
  });
});
