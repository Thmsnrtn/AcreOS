/**
 * R3 — skip-trace PII at-rest encryption regression tests.
 *
 * Guards three behaviors of server/services/skipTraceEncryption.ts:
 *
 *   1. Round-trip: encryptSkipTracePayload → decryptSkipTracePayload returns
 *      a structurally-equal value, with the on-disk shape being an
 *      `{ _enc, _v }` envelope rather than the plaintext PII.
 *
 *   2. Tolerant read: a legacy row whose `inputData` / `results` are still
 *      plaintext JSON (pre-fix data) is returned verbatim — we MUST NOT
 *      crash skip-trace listing endpoints during the rollout window.
 *
 *   3. NULL passthrough: null/undefined inputs round-trip to null without
 *      writing an empty envelope.
 *
 * If any of these regress, skip-trace storage may either leak PII at rest
 * or 500 the listing endpoint after deploy.
 */
import { describe, it, expect, vi } from "vitest";

// We need real crypto round-tripping, so set up a deterministic key for
// configManager BEFORE importing the helpers under test.
process.env.FIELD_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// Silence logger during the negative-decryption test path.
vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  encryptSkipTracePayload,
  decryptSkipTracePayload,
  decryptSkipTraceRow,
  isEncryptedSkipTracePayload,
} from "../../server/services/skipTraceEncryption";

describe("skipTraceEncryption — round trip", () => {
  it("encrypts a results payload into an opaque envelope and decrypts back", () => {
    const results = {
      phones: [{ number: "+15125550123", type: "mobile", verified: true }],
      emails: [{ email: "jane@example.com", verified: false }],
      addresses: [
        { address: "200 Oak Ln, Houston TX 77001", type: "current", current: true },
      ],
      relatives: [{ name: "John Doe", relationship: "spouse" }],
      ageRange: "45-55",
    };

    const envelope = encryptSkipTracePayload(results);

    // Envelope shape: must NOT carry plaintext PII fields at the top level.
    expect(envelope).not.toBeNull();
    expect(envelope).toHaveProperty("_enc");
    expect(envelope).toHaveProperty("_v");
    expect(envelope).not.toHaveProperty("phones");
    expect(envelope).not.toHaveProperty("emails");
    expect(isEncryptedSkipTracePayload(envelope)).toBe(true);

    // The ciphertext must not contain any of the obvious PII substrings.
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain("5125550123");
    expect(serialized).not.toContain("jane@example.com");
    expect(serialized).not.toContain("Oak Ln");
    expect(serialized).not.toContain("John Doe");

    // Round-trip recovers the exact value.
    const decrypted = decryptSkipTracePayload<typeof results>(envelope);
    expect(decrypted).toEqual(results);
  });

  it("encrypts an inputData payload and round-trips fields", () => {
    const inputData = {
      name: "Jane Borrower",
      address: "200 Oak Ln, Houston TX",
      apn: "12-345-678",
      mailingAddress: "PO Box 99",
    };

    const envelope = encryptSkipTracePayload(inputData);
    expect(isEncryptedSkipTracePayload(envelope)).toBe(true);
    expect(JSON.stringify(envelope)).not.toContain("Jane Borrower");

    const decrypted = decryptSkipTracePayload<typeof inputData>(envelope);
    expect(decrypted).toEqual(inputData);
  });

  it("produces a different envelope each call (random IV) but both decrypt", () => {
    const value = { name: "deterministic input" };
    const a = encryptSkipTracePayload(value);
    const b = encryptSkipTracePayload(value);
    expect(a?._enc).not.toEqual(b?._enc);
    expect(decryptSkipTracePayload(a)).toEqual(value);
    expect(decryptSkipTracePayload(b)).toEqual(value);
  });
});

describe("skipTraceEncryption — tolerant read for legacy plaintext rows", () => {
  it("returns a legacy plaintext results object verbatim (no envelope)", () => {
    const legacyResults = {
      phones: [{ number: "+15125550000", type: "mobile", verified: true }],
      emails: [{ email: "legacy@example.com", verified: true }],
    };

    // Caller passes a plain JSONB object (what's currently in the DB).
    const out = decryptSkipTracePayload<typeof legacyResults>(legacyResults);
    expect(out).toEqual(legacyResults);
  });

  it("returns a legacy plaintext inputData object verbatim", () => {
    const legacyInput = { name: "Plaintext Owner", address: "1 Old Way" };
    const out = decryptSkipTracePayload<typeof legacyInput>(legacyInput);
    expect(out).toEqual(legacyInput);
  });

  it("decryptSkipTraceRow handles a mixed row (encrypted inputData, plaintext results)", () => {
    const inputData = { name: "Mixed Owner", apn: "00-001" };
    const legacyResults = { phones: [{ number: "+15555555555", type: "landline", verified: false }] };

    const row = {
      id: 7,
      organizationId: 1,
      leadId: 99,
      inputData: encryptSkipTracePayload(inputData),
      results: legacyResults, // simulate a row that was inserted before the fix
      provider: "batch",
      status: "completed",
    };

    const decrypted = decryptSkipTraceRow(row);
    expect(decrypted).not.toBeNull();
    expect(decrypted!.inputData).toEqual(inputData);
    expect(decrypted!.results).toEqual(legacyResults);
    // Other fields untouched
    expect(decrypted!.id).toBe(7);
    expect(decrypted!.status).toBe("completed");
  });
});

describe("skipTraceEncryption — null / undefined passthrough", () => {
  it("encryptSkipTracePayload(null) returns null (no empty envelope written)", () => {
    expect(encryptSkipTracePayload(null)).toBeNull();
    expect(encryptSkipTracePayload(undefined)).toBeNull();
  });

  it("decryptSkipTracePayload(null) returns null", () => {
    expect(decryptSkipTracePayload(null)).toBeNull();
    expect(decryptSkipTracePayload(undefined)).toBeNull();
  });

  it("decryptSkipTraceRow passes through null / undefined rows", () => {
    expect(decryptSkipTraceRow(null)).toBeNull();
    expect(decryptSkipTraceRow(undefined)).toBeUndefined();
  });
});

describe("skipTraceEncryption — corrupted ciphertext does not 500", () => {
  it("returns null when the envelope is structurally valid but undecryptable", () => {
    const bogus = {
      _enc: "deadbeef:cafebabe:0000",
      _v: 1,
    };
    // Should not throw.
    expect(() => decryptSkipTracePayload(bogus)).not.toThrow();
    expect(decryptSkipTracePayload(bogus)).toBeNull();
  });
});
