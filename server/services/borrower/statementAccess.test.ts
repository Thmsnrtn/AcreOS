/**
 * statementAccess tests.
 *
 * Covers the F3.4 fix surface:
 *   - signSession + verifySignedSession round-trip
 *   - verifySignedSession rejects mutated payload
 *   - verifySignedSession reports expired correctly
 *   - verifyBorrowerSession rejects IP mismatch
 *   - exchangeForBorrowerSession happy path
 *   - exchangeForBorrowerSession invalid grant → ok=false, no cookie
 *   - missing BORROWER_SESSION_SECRET → throws on first call (fail-closed)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  signSession,
  verifySignedSession,
  verifyBorrowerSession,
  exchangeForBorrowerSession,
  SESSION_TTL_SECONDS,
  type BorrowerGrantResolver,
} from "./statementAccess";

const TEST_SECRET = "test-borrower-session-secret-32bytes";

describe("statementAccess — signing", () => {
  let originalSecret: string | undefined;

  beforeEach(() => {
    originalSecret = process.env.BORROWER_SESSION_SECRET;
    process.env.BORROWER_SESSION_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.BORROWER_SESSION_SECRET;
    } else {
      process.env.BORROWER_SESSION_SECRET = originalSecret;
    }
  });

  it("signSession + verifySignedSession round-trip", () => {
    const cookie = signSession({
      scope: "note:abc-123",
      expSeconds: 60,
      ip: "203.0.113.5",
    });
    const verified = verifySignedSession(cookie);
    expect(verified.valid).toBe(true);
    expect(verified.scope).toBe("note:abc-123");
    expect(verified.ip).toBe("203.0.113.5");
    expect(verified.expired).toBeUndefined();
  });

  it("verifySignedSession rejects a mutated payload", () => {
    const cookie = signSession({
      scope: "note:abc-123",
      expSeconds: 60,
      ip: "203.0.113.5",
    });
    // Flip the last char of the payload (before the dot) — signature
    // covers the encoded payload so any byte change invalidates it.
    const dotIdx = cookie.lastIndexOf(".");
    const tampered =
      cookie.slice(0, dotIdx - 1) +
      (cookie[dotIdx - 1] === "A" ? "B" : "A") +
      cookie.slice(dotIdx);
    expect(verifySignedSession(tampered).valid).toBe(false);
  });

  it("verifySignedSession rejects a tampered signature", () => {
    const cookie = signSession({
      scope: "note:abc-123",
      expSeconds: 60,
      ip: "203.0.113.5",
    });
    const tampered = cookie.slice(0, -1) + (cookie.slice(-1) === "A" ? "B" : "A");
    expect(verifySignedSession(tampered).valid).toBe(false);
  });

  it("verifySignedSession reports expired=true for a past-exp cookie", () => {
    const cookie = signSession({
      scope: "note:abc-123",
      expSeconds: -10, // already expired
      ip: "203.0.113.5",
    });
    const verified = verifySignedSession(cookie);
    expect(verified.valid).toBe(false);
    expect(verified.expired).toBe(true);
  });

  it("verifySignedSession rejects garbage with no dot", () => {
    expect(verifySignedSession("nope").valid).toBe(false);
    expect(verifySignedSession("").valid).toBe(false);
  });
});

describe("statementAccess — IP binding", () => {
  beforeEach(() => {
    process.env.BORROWER_SESSION_SECRET = TEST_SECRET;
  });

  it("verifyBorrowerSession accepts matching IP", () => {
    const cookie = signSession({
      scope: "note:abc-123",
      expSeconds: 60,
      ip: "203.0.113.5",
    });
    const out = verifyBorrowerSession(cookie, "203.0.113.5");
    expect(out.valid).toBe(true);
    expect(out.statementSetScope).toBe("note:abc-123");
  });

  it("verifyBorrowerSession rejects IP mismatch", () => {
    const cookie = signSession({
      scope: "note:abc-123",
      expSeconds: 60,
      ip: "203.0.113.5",
    });
    const out = verifyBorrowerSession(cookie, "198.51.100.7");
    expect(out.valid).toBe(false);
    expect(out.reason).toBe("ip_mismatch");
  });

  it("verifyBorrowerSession reports expired for past-exp", () => {
    const cookie = signSession({
      scope: "note:abc-123",
      expSeconds: -10,
      ip: "203.0.113.5",
    });
    const out = verifyBorrowerSession(cookie, "203.0.113.5");
    expect(out.valid).toBe(false);
    expect(out.reason).toBe("expired");
  });
});

describe("statementAccess — exchangeForBorrowerSession", () => {
  beforeEach(() => {
    process.env.BORROWER_SESSION_SECRET = TEST_SECRET;
  });

  it("happy path returns sessionCookie that round-trips", async () => {
    const resolver: BorrowerGrantResolver = {
      async resolve() {
        return { ok: true, scope: "note:abc-123" };
      },
    };
    const out = await exchangeForBorrowerSession(
      {
        accessToken: "tok-xyz",
        email: "borrower@example.com",
        ip: "203.0.113.5",
      },
      resolver,
    );
    expect(out.ok).toBe(true);
    expect(out.scope).toBe("note:abc-123");
    expect(out.sessionCookie).toBeTruthy();
    const verified = verifyBorrowerSession(out.sessionCookie!, "203.0.113.5");
    expect(verified.valid).toBe(true);
    expect(verified.statementSetScope).toBe("note:abc-123");
  });

  it("rejects when grant resolver returns not_found", async () => {
    const resolver: BorrowerGrantResolver = {
      async resolve() {
        return { ok: false, reason: "not_found" };
      },
    };
    const out = await exchangeForBorrowerSession(
      {
        accessToken: "tok-xyz",
        email: "borrower@example.com",
        ip: "203.0.113.5",
      },
      resolver,
    );
    expect(out.ok).toBe(false);
    expect(out.sessionCookie).toBeUndefined();
    expect(out.reason).toBe("not_found");
  });

  it("rejects when grant resolver returns email_mismatch", async () => {
    const resolver: BorrowerGrantResolver = {
      async resolve() {
        return { ok: false, reason: "email_mismatch" };
      },
    };
    const out = await exchangeForBorrowerSession(
      {
        accessToken: "tok-xyz",
        email: "wrong@example.com",
        ip: "203.0.113.5",
      },
      resolver,
    );
    expect(out.ok).toBe(false);
    expect(out.sessionCookie).toBeUndefined();
    expect(out.reason).toBe("email_mismatch");
  });

  it("rejects when input fields are missing (no resolver call)", async () => {
    let called = false;
    const resolver: BorrowerGrantResolver = {
      async resolve() {
        called = true;
        return { ok: true, scope: "note:abc-123" };
      },
    };
    const out = await exchangeForBorrowerSession(
      { accessToken: "", email: "borrower@example.com", ip: "203.0.113.5" },
      resolver,
    );
    expect(out.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("SESSION_TTL_SECONDS is 30 minutes", () => {
    expect(SESSION_TTL_SECONDS).toBe(30 * 60);
  });
});

describe("statementAccess — fail-closed on missing secret", () => {
  let originalSecret: string | undefined;

  beforeEach(() => {
    originalSecret = process.env.BORROWER_SESSION_SECRET;
    delete process.env.BORROWER_SESSION_SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.BORROWER_SESSION_SECRET;
    } else {
      process.env.BORROWER_SESSION_SECRET = originalSecret;
    }
  });

  it("signSession throws when BORROWER_SESSION_SECRET is unset", () => {
    expect(() =>
      signSession({ scope: "note:abc", expSeconds: 60, ip: "1.2.3.4" }),
    ).toThrow(/BORROWER_SESSION_SECRET/);
  });

  it("exchangeForBorrowerSession throws when secret is unset (fail-closed)", async () => {
    const resolver: BorrowerGrantResolver = {
      async resolve() {
        return { ok: true, scope: "note:abc-123" };
      },
    };
    await expect(
      exchangeForBorrowerSession(
        {
          accessToken: "tok",
          email: "borrower@example.com",
          ip: "203.0.113.5",
        },
        resolver,
      ),
    ).rejects.toThrow(/BORROWER_SESSION_SECRET/);
  });
});
