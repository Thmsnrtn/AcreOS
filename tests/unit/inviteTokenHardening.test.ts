/**
 * Invite-token hardening tests (Pelle G/H/I).
 *
 *   - Hash roundtrip: same plaintext → same hash; different plaintext → different.
 *   - Last4 helper returns the rightmost 4 chars.
 *   - tokenMatchesRow: hash row matches; legacy row matches; no-token row fails.
 *   - timing-safe compare returns false on mismatch (and same length compared).
 *   - Per-org create rate limit: 100/day.
 *   - Per-user accept rate limit: 10/hr.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  generateInviteToken,
  hashInviteToken,
  inviteTokenLast4,
  redactToken,
  timingSafeEqualStr,
  tokenMatchesRow,
} from "../../server/utils/inviteTokens";
import {
  checkInviteCreateLimit,
  checkInviteAcceptLimit,
  _resetInviteRateLimitMemory,
  INVITE_CREATE_LIMITS,
  INVITE_ACCEPT_LIMITS,
} from "../../server/services/inviteRateLimit";

describe("inviteTokens primitives", () => {
  it("generates URL-safe tokens of expected length", () => {
    const t = generateInviteToken();
    expect(typeof t).toBe("string");
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    // 24 bytes -> 32 base64url chars
    expect(t.length).toBe(32);
  });

  it("generates unique tokens across calls", () => {
    const set = new Set<string>();
    for (let i = 0; i < 50; i++) set.add(generateInviteToken());
    expect(set.size).toBe(50);
  });

  it("hash is stable and different from plaintext", () => {
    const t = "hello-token";
    expect(hashInviteToken(t)).toBe(hashInviteToken(t));
    expect(hashInviteToken(t)).not.toBe(t);
    expect(hashInviteToken(t)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashInviteToken("a")).not.toBe(hashInviteToken("b"));
  });

  it("inviteTokenLast4 returns rightmost 4", () => {
    expect(inviteTokenLast4("abcdefgh")).toBe("efgh");
    expect(inviteTokenLast4("abc")).toBe("abc");
  });

  it("redactToken returns ***last4", () => {
    expect(redactToken("xxx-yyyy-zzzz")).toBe("***zzzz");
    expect(redactToken(null)).toBe("<none>");
  });

  it("timingSafeEqualStr equal and unequal", () => {
    expect(timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(timingSafeEqualStr("abc", "abd")).toBe(false);
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false);
    expect(timingSafeEqualStr("", "")).toBe(true);
  });

  it("tokenMatchesRow accepts hash and legacy plaintext rows", () => {
    const plaintext = "the-token";
    const hash = hashInviteToken(plaintext);
    expect(tokenMatchesRow(plaintext, { token: null, inviteTokenHash: hash })).toBe(true);
    expect(tokenMatchesRow("nope", { token: null, inviteTokenHash: hash })).toBe(false);
    expect(tokenMatchesRow(plaintext, { token: plaintext, inviteTokenHash: null })).toBe(true);
    expect(tokenMatchesRow("other", { token: plaintext, inviteTokenHash: null })).toBe(false);
    expect(tokenMatchesRow(plaintext, { token: null, inviteTokenHash: null })).toBe(false);
  });
});

describe("inviteRateLimit", () => {
  beforeEach(() => {
    _resetInviteRateLimitMemory();
  });

  it("per-org create limit allows up to 100/day", async () => {
    const orgId = 12345;
    // Burn 99 in one shot
    const r1 = await checkInviteCreateLimit(orgId, 99);
    expect(r1.allowed).toBe(true);
    expect(r1.limit).toBe(INVITE_CREATE_LIMITS.limit);
    // 100th allowed
    const r2 = await checkInviteCreateLimit(orgId, 1);
    expect(r2.allowed).toBe(true);
    // 101st blocked
    const r3 = await checkInviteCreateLimit(orgId, 1);
    expect(r3.allowed).toBe(false);
    expect(r3.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("per-org create limit isolates orgs", async () => {
    const a = await checkInviteCreateLimit(1, 100);
    expect(a.allowed).toBe(true);
    const b = await checkInviteCreateLimit(2, 100);
    expect(b.allowed).toBe(true);
  });

  it("bulk-cost is correctly enforced (no sneaking past via single request)", async () => {
    const r = await checkInviteCreateLimit(99, 101);
    expect(r.allowed).toBe(false);
  });

  it("per-user accept limit allows up to 10/hr", async () => {
    const userId = "user-test-1";
    for (let i = 0; i < INVITE_ACCEPT_LIMITS.limit; i++) {
      const r = await checkInviteAcceptLimit(userId);
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkInviteAcceptLimit(userId);
    expect(blocked.allowed).toBe(false);
  });

  it("per-user accept limit isolates users", async () => {
    for (let i = 0; i < INVITE_ACCEPT_LIMITS.limit; i++) {
      await checkInviteAcceptLimit("alice");
    }
    const blocked = await checkInviteAcceptLimit("alice");
    expect(blocked.allowed).toBe(false);
    const fresh = await checkInviteAcceptLimit("bob");
    expect(fresh.allowed).toBe(true);
  });
});
