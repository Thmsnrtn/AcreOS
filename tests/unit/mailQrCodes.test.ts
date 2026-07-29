/**
 * Per-piece mail attribution codes (server/services/mail/qrCodes.ts).
 *
 * Wave B shipped this module as "the PURE half of the fix … so it can be
 * unit-tested without DATABASE_URL" and then shipped no test for it. These
 * are the properties the public `/r/:code` redirect actually depends on:
 * a forged code must be rejected by arithmetic BEFORE any database query, and
 * an unsigned deployment must mint nothing at all rather than mint something
 * guessable (a guessable code lets anyone inflate a stranger's campaign).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mintQrCode,
  parseQrCode,
  qrSigningConfigured,
  qrRedirectUrl,
  qrLandingUrl,
  scanFingerprint,
  scanSuppressionReason,
  SCAN_DEDUPE_WINDOW_MS,
} from "../../server/services/mail/qrCodes";

const SECRET_KEYS = [
  "MAIL_QR_SIGNING_SECRET",
  "FIELD_ENCRYPTION_KEY",
  "SESSION_SECRET",
  "MAIL_QR_LANDING_URL",
  "APP_URL",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of SECRET_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of SECRET_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("mint / parse", () => {
  it("round-trips a piece id under a configured secret", () => {
    process.env.MAIL_QR_SIGNING_SECRET = "s3cret-signing-material";
    expect(qrSigningConfigured()).toBe(true);
    const code = mintQrCode(4242);
    expect(code).toBeTruthy();
    expect(code).toMatch(/^[0-9a-z]{1,12}-[0-9a-z]{8}$/);
    expect(parseQrCode(code as string)).toEqual({ pieceId: 4242 });
    // Case-insensitive: a code read off paper may be typed in caps.
    expect(parseQrCode((code as string).toUpperCase())).toEqual({ pieceId: 4242 });
  });

  it("mints NOTHING when no signing material is configured", () => {
    expect(qrSigningConfigured()).toBe(false);
    expect(mintQrCode(1)).toBeNull();
    // …and cannot verify either, so no unsigned code is ever honoured.
    expect(parseQrCode("1-aaaaaaaa")).toBeNull();
  });

  it("falls back to FIELD_ENCRYPTION_KEY then SESSION_SECRET", () => {
    process.env.SESSION_SECRET = "session-only";
    expect(qrSigningConfigured()).toBe(true);
    const viaSession = mintQrCode(7);
    expect(viaSession).toBeTruthy();

    process.env.FIELD_ENCRYPTION_KEY = "field-key";
    const viaField = mintQrCode(7);
    // Different key ⇒ different tag: a rotated secret cannot silently
    // validate codes minted under the old one.
    expect(viaField).not.toBe(viaSession);
    expect(parseQrCode(viaSession as string)).toBeNull();
  });

  it("rejects forged, malformed and wrong-key codes without a lookup", () => {
    process.env.MAIL_QR_SIGNING_SECRET = "key-a";
    const real = mintQrCode(99) as string;

    expect(parseQrCode("99-00000000")).toBeNull(); // guessed tag
    expect(parseQrCode("2r")).toBeNull(); // no tag at all
    expect(parseQrCode("")).toBeNull();
    expect(parseQrCode("-".repeat(20))).toBeNull();
    expect(parseQrCode("0-aaaaaaaa")).toBeNull(); // piece id 0
    // Same tag, different claimed piece — the id is inside the HMAC.
    const [, tag] = real.split("-");
    expect(parseQrCode(`98-${tag}`)).toBeNull();

    process.env.MAIL_QR_SIGNING_SECRET = "key-b";
    expect(parseQrCode(real)).toBeNull();
  });

  it("refuses invalid piece ids", () => {
    process.env.MAIL_QR_SIGNING_SECRET = "k";
    expect(mintQrCode(0)).toBeNull();
    expect(mintQrCode(-3)).toBeNull();
    expect(mintQrCode(1.5)).toBeNull();
  });
});

describe("URLs", () => {
  it("builds the redirect from APP_URL and never double-slashes", () => {
    process.env.APP_URL = "https://app.example.com/";
    expect(qrRedirectUrl("ab-12345678")).toBe("https://app.example.com/r/ab-12345678");
  });

  it("lands every code at ONE constant destination (no org side channel)", () => {
    process.env.APP_URL = "https://app.example.com";
    const a = qrLandingUrl();
    const b = qrLandingUrl();
    expect(a).toBe(b);
    process.env.MAIL_QR_LANDING_URL = "https://respond.example.com/offer";
    expect(qrLandingUrl()).toBe("https://respond.example.com/offer");
    // A non-absolute override is ignored rather than emitted as a relative
    // (and therefore broken) redirect target.
    process.env.MAIL_QR_LANDING_URL = "javascript:alert(1)";
    expect(qrLandingUrl()).toBe("https://app.example.com/tools/parcel-check");
  });
});

describe("fingerprint + suppression", () => {
  it("fingerprints are stable, non-reversible and absent without a secret", () => {
    expect(scanFingerprint("1.2.3.4", "Mozilla")).toBeNull(); // no secret
    process.env.MAIL_QR_SIGNING_SECRET = "k";
    const fp = scanFingerprint("1.2.3.4", "Mozilla") as string;
    expect(fp).toHaveLength(32);
    expect(fp).toBe(scanFingerprint("1.2.3.4", "Mozilla"));
    expect(fp).not.toBe(scanFingerprint("1.2.3.5", "Mozilla"));
    expect(fp).not.toContain("1.2.3.4");
    // Nothing to fingerprint at all → null, not a constant bucket that would
    // collapse every anonymous scanner into one "repeat" client.
    expect(scanFingerprint(undefined, undefined)).toBeNull();
  });

  it("counts a first human scan and suppresses machines + rapid repeats", () => {
    const now = new Date("2026-07-20T12:00:00Z");
    expect(
      scanSuppressionReason({ signals: { userAgent: "Mozilla/5.0 iPhone" }, lastCountedScanAt: null, now }),
    ).toBeNull();

    expect(
      scanSuppressionReason({ signals: { method: "HEAD" }, lastCountedScanAt: null, now }),
    ).toBe("prefetch");
    expect(
      scanSuppressionReason({ signals: { purpose: "prefetch" }, lastCountedScanAt: null, now }),
    ).toBe("prefetch");
    expect(
      scanSuppressionReason({ signals: { userAgent: "Slackbot-LinkExpanding" }, lastCountedScanAt: null, now }),
    ).toBe("bot");

    const justNow = new Date(now.getTime() - 60_000);
    expect(
      scanSuppressionReason({ signals: { userAgent: "Mozilla" }, lastCountedScanAt: justNow, now }),
    ).toBe("duplicate_window");

    const longAgo = new Date(now.getTime() - SCAN_DEDUPE_WINDOW_MS - 1000);
    expect(
      scanSuppressionReason({ signals: { userAgent: "Mozilla" }, lastCountedScanAt: longAgo, now }),
    ).toBeNull();
  });
});
