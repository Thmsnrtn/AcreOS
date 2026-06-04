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

// ────────────────────────────────────────────────────────────────────────────
// Phase D3 (Beatrice) — additive coverage for paths the original tests
// didn't probe. The 15 cases above stay verbatim; these 5 widen the gate.
// ────────────────────────────────────────────────────────────────────────────

describe("statementAccess — D3 additive coverage", () => {
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

  // (1) Tampered email — exchange path must REJECT case/whitespace
  // variants that the borrower never typed. The grant resolver does
  // `.toLowerCase()` on both sides at lookup; what we pin here is that
  // the SERVICE layer DOES NOT trim/normalize whitespace before handing
  // off to the resolver. Borrowers shouldn't get an exchange success
  // for "  borrower@example.com  " — the resolver receives the raw
  // padded string and must miss. This is "document the current behavior
  // and lock it" rather than "change it" — a future trim would need to
  // also revisit this test.
  it("exchange passes the raw email to the resolver (no service-side trim/normalize)", async () => {
    let seenEmail: string | undefined;
    const resolver: BorrowerGrantResolver = {
      async resolve({ email }) {
        seenEmail = email;
        // Simulate the real route handler: case-insensitive compare,
        // whitespace-strict. Padded input is not the canonical email.
        if (email.toLowerCase().trim() !== email.toLowerCase()) {
          return { ok: false, reason: "email_mismatch" };
        }
        return { ok: true, scope: "note:abc-123" };
      },
    };
    const out = await exchangeForBorrowerSession(
      {
        accessToken: "tok-xyz",
        email: "  Borrower@Example.com  ",
        ip: "203.0.113.5",
      },
      resolver,
    );
    expect(seenEmail).toBe("  Borrower@Example.com  ");
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("email_mismatch");
  });

  // (2) Scope-mismatch — a cookie minted for note:42 must NOT verify
  // when the caller is operating against note:99. The base verify
  // helper returns the scope; the route is responsible for the final
  // comparison. We pin that the cookie carries the original scope
  // verbatim and never leaks an attacker-controlled scope.
  it("verifySignedSession returns the minted scope verbatim (caller can compare)", () => {
    const cookieFor42 = signSession({
      scope: "note:42",
      expSeconds: 60,
      ip: "203.0.113.5",
    });
    const verified = verifySignedSession(cookieFor42);
    expect(verified.valid).toBe(true);
    expect(verified.scope).toBe("note:42");
    // Caller's comparison against an unrelated scope must fail.
    expect(verified.scope === "note:99").toBe(false);
  });

  // (3) signSession determinism — same input fed twice yields the same
  // output. (The {exp} embedded in the payload uses Date.now(), so the
  // determinism contract only holds when the wall clock is pinned. We
  // pin it via a single Date.now() snapshot taken under a vi.useFakeTimers
  // freeze.)
  it("signSession is deterministic when the wall clock is frozen", async () => {
    const { vi } = await import("vitest");
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-04T00:00:00.000Z"));
      const a = signSession({
        scope: "note:42",
        expSeconds: 600,
        ip: "203.0.113.5",
      });
      const b = signSession({
        scope: "note:42",
        expSeconds: 600,
        ip: "203.0.113.5",
      });
      expect(a).toBe(b);
    } finally {
      vi.useRealTimers();
    }
  });

  // (4) Truncated cookie — chopping the last 5 chars of a valid cookie
  // destroys the signature and must fail verification (no soft-pass
  // path, no panic).
  it("verifySignedSession rejects a truncated cookie", () => {
    const cookie = signSession({
      scope: "note:42",
      expSeconds: 60,
      ip: "203.0.113.5",
    });
    const truncated = cookie.slice(0, -5);
    const out = verifySignedSession(truncated);
    expect(out.valid).toBe(false);
  });

  // (5) IP-binding format flexibility — IPv4 vs IPv4-mapped-IPv6 should
  // compare functionally equal so a borrower whose carrier rewrites the
  // L7 source isn't 401'd on every fetch. Current implementation does
  // strict string equality. This test documents that behavior — current
  // contract is STRICT EQUALITY (the canonicalization is a future fix,
  // and when it lands this test should flip to assert the relaxed match).
  //
  // The corollary: when canonicalization DOES land, the
  // bind-different-format failure mode is hand-controllable here. For
  // now we encode the "strict equality" contract so any drift to lossy
  // canonicalization gets caught.
  it("IP-binding currently uses strict string equality (IPv4 vs ::ffff:IPv4 mismatch)", () => {
    const cookie = signSession({
      scope: "note:42",
      expSeconds: 60,
      ip: "127.0.0.1",
    });
    // IPv4-mapped-IPv6 form of the same address — functionally equal at
    // the L3 layer, but textually distinct.
    const verifiedV6 = verifyBorrowerSession(cookie, "::ffff:127.0.0.1");
    expect(verifiedV6.valid).toBe(false);
    expect(verifiedV6.reason).toBe("ip_mismatch");
    // Truly different IP — also mismatch.
    const verifiedOther = verifyBorrowerSession(cookie, "198.51.100.7");
    expect(verifiedOther.valid).toBe(false);
    expect(verifiedOther.reason).toBe("ip_mismatch");
    // Exact match still passes.
    const verifiedExact = verifyBorrowerSession(cookie, "127.0.0.1");
    expect(verifiedExact.valid).toBe(true);
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
