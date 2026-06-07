/**
 * Founder Life-Cockpit foundation tests (FOUNDER-SIDE ONLY).
 *
 * Two security-critical guarantees:
 *
 *   1. vaultEncryption round-trips document bytes + dollar amounts AND never
 *      leaves plaintext in the sealed envelope (the DB must never see a raw
 *      SSN / file byte / amount). We verify by shape, never by printing a value.
 *
 *   2. The founder-only access guard (requireFounder) blocks a non-founder with
 *      404 (not 403 — we don't even acknowledge the surface exists) and lets a
 *      founder through.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Deterministic key set BEFORE importing the encryption module (key is loaded
// lazily at first use).
const FIELD_KEY_HEX = "b".repeat(64); // 32 bytes
const originalFieldKey = process.env.FIELD_ENCRYPTION_KEY;

beforeAll(() => {
  process.env.FIELD_ENCRYPTION_KEY = FIELD_KEY_HEX;
});
afterAll(() => {
  if (originalFieldKey === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
  else process.env.FIELD_ENCRYPTION_KEY = originalFieldKey;
});

describe("vaultEncryption — document bytes", () => {
  it("round-trips arbitrary binary bytes", async () => {
    const { encryptDocumentBytes, decryptDocumentBytes } = await import(
      "../../server/services/founder/vaultEncryption"
    );
    const original = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10, 0x42]); // %PDF + binary
    const sealed = encryptDocumentBytes(original);
    const back = decryptDocumentBytes(sealed);
    expect(back.equals(original)).toBe(true);
  });

  it("produces a sealed enc:v1: envelope that contains NO plaintext bytes", async () => {
    const { encryptDocumentBytes, assertEncrypted } = await import(
      "../../server/services/founder/vaultEncryption"
    );
    // A recognizable plaintext marker that must NOT survive into the envelope.
    const marker = "SSN-123-45-6789-SECRET-MARKER";
    const sealed = encryptDocumentBytes(Buffer.from(marker, "utf8"));

    expect(sealed.startsWith("enc:v1:")).toBe(true);
    // The plaintext (and its base64 form) must not appear in the envelope.
    expect(sealed.includes(marker)).toBe(false);
    expect(sealed.includes(Buffer.from(marker).toString("base64"))).toBe(false);

    const shape = assertEncrypted(sealed);
    expect(shape.sealed).toBe(true);
    expect(shape.prefix).toBe("enc:v1:");
    expect(shape.length).toBeGreaterThan(0);
  });
});

describe("vaultEncryption — amounts", () => {
  it("round-trips a whole-dollar amount and rounds cents away", async () => {
    const { encryptAmount, decryptAmount } = await import(
      "../../server/services/founder/vaultEncryption"
    );
    expect(decryptAmount(encryptAmount(120000))).toBe(120000);
    expect(decryptAmount(encryptAmount(99999.49))).toBe(99999);
    expect(decryptAmount(encryptAmount(99999.5))).toBe(100000);
  });

  it("returns null for null/empty amount envelopes", async () => {
    const { decryptAmount } = await import(
      "../../server/services/founder/vaultEncryption"
    );
    expect(decryptAmount(null)).toBeNull();
    expect(decryptAmount(undefined)).toBeNull();
    expect(decryptAmount("")).toBeNull();
  });

  it("never leaves the raw amount visible in the envelope", async () => {
    const { encryptAmount } = await import(
      "../../server/services/founder/vaultEncryption"
    );
    const sealed = encryptAmount(123456);
    expect(sealed.startsWith("enc:v1:")).toBe(true);
    expect(sealed.includes("123456")).toBe(false);
  });
});

describe("founder-only access guard (requireFounder)", () => {
  function mkRes() {
    const res: any = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    return res;
  }

  it("blocks a non-founder with 404 and does not call next", async () => {
    // Configure founder identity so the non-founder email is definitively NOT a founder.
    const prevEmails = process.env.FOUNDER_EMAILS;
    process.env.FOUNDER_EMAILS = "founder@acreos.test";
    vi.resetModules();
    try {
      const { requireFounder } = await import("../../server/auth/clerkAuth");
      const req: any = { user: { email: "stranger@example.com" }, auth: { userId: "u_stranger" } };
      const res = mkRes();
      let nextCalled = false;
      requireFounder(req, res as any, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(404);
      expect(req.isFounder).not.toBe(true);
    } finally {
      if (prevEmails === undefined) delete process.env.FOUNDER_EMAILS;
      else process.env.FOUNDER_EMAILS = prevEmails;
    }
  });

  it("blocks a request with no authenticated user (404)", async () => {
    vi.resetModules();
    const { requireFounder } = await import("../../server/auth/clerkAuth");
    const req: any = {};
    const res = mkRes();
    let nextCalled = false;
    requireFounder(req, res as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(404);
  });

  it("lets a founder through and stamps req.isFounder", async () => {
    const prevEmails = process.env.FOUNDER_EMAILS;
    process.env.FOUNDER_EMAILS = "founder@acreos.test";
    vi.resetModules();
    try {
      const { requireFounder } = await import("../../server/auth/clerkAuth");
      const req: any = { user: { email: "founder@acreos.test" }, auth: { userId: "u_founder" } };
      const res = mkRes();
      let nextCalled = false;
      requireFounder(req, res as any, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
      expect(req.isFounder).toBe(true);
    } finally {
      if (prevEmails === undefined) delete process.env.FOUNDER_EMAILS;
      else process.env.FOUNDER_EMAILS = prevEmails;
    }
  });
});
