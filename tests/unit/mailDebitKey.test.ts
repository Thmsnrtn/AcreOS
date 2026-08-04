import { describe, it, expect } from "vitest";
import { mailDebitIdempotencyKey } from "../../server/services/mail/mailDebitKey";

/**
 * ASP-3 regression guard. The mail-queue pool debit key used to embed
 * Date.now(), so a client retry minted a new key and DOUBLE-DEBITED the pool.
 * The key must now be deterministic from stable request CONTENT so retries
 * collapse to a single debit.
 *
 * It is deliberately content-ONLY: an earlier version also honored a client
 * Idempotency-Key header, but the browser mints a fresh random UUID per call,
 * so honoring it made every double-click a different key — the double-charge
 * guard never fired. The key is now derived purely from the send's content.
 */
describe("mail debit idempotency key", () => {
  const base = {
    orgId: 7,
    audienceFilter: { status: "new", county: "Polk" },
    pieceType: "postcard",
    provider: "lob",
    pieceCount: 250,
  };

  it("is stable across identical requests (a retry does not double-debit)", () => {
    expect(mailDebitIdempotencyKey(base)).toBe(mailDebitIdempotencyKey(base));
  });

  it("ignores object key ORDER in the audience filter", () => {
    const reordered = { ...base, audienceFilter: { county: "Polk", status: "new" } };
    expect(mailDebitIdempotencyKey(reordered)).toBe(mailDebitIdempotencyKey(base));
  });

  it("differs when the send genuinely changes", () => {
    const k0 = mailDebitIdempotencyKey(base);
    expect(mailDebitIdempotencyKey({ ...base, pieceCount: 251 })).not.toBe(k0);
    expect(mailDebitIdempotencyKey({ ...base, pieceType: "letter" })).not.toBe(k0);
    expect(mailDebitIdempotencyKey({ ...base, provider: "postgrid" })).not.toBe(k0);
    expect(mailDebitIdempotencyKey({ ...base, audienceFilter: { status: "hot" } })).not.toBe(k0);
    expect(mailDebitIdempotencyKey({ ...base, orgId: 8 })).not.toBe(k0);
  });

  it("is always the content-hash form — no per-request client key can override it", () => {
    // The key is content-derived regardless of how many times it is requested;
    // there is no client-key escape hatch that a random per-call UUID could use
    // to defeat the double-charge collapse. Two identical sends always match.
    const a = mailDebitIdempotencyKey(base);
    const b = mailDebitIdempotencyKey({ ...base });
    expect(a).toBe(b);
    expect(a).toMatch(/^mail:queue:7:c:[0-9a-f]{32}$/);
    expect(a).not.toContain(":ck:");
  });

  it("never embeds a timestamp (deterministic given the same inputs)", () => {
    const k1 = mailDebitIdempotencyKey(base);
    // Different call, same inputs — must match; a Date.now() key never would.
    const k2 = mailDebitIdempotencyKey({ ...base });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^mail:queue:7:c:[0-9a-f]{32}$/);
  });
});
