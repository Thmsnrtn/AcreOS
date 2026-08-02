import { describe, it, expect } from "vitest";
import { mailDebitIdempotencyKey } from "../../server/services/mail/mailDebitKey";

/**
 * ASP-3 regression guard. The mail-queue pool debit key used to embed
 * Date.now(), so a client retry minted a new key and DOUBLE-DEBITED the pool.
 * The key must now be deterministic from stable request content (and honor a
 * client Idempotency-Key), so retries collapse to a single debit.
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

  it("honors a client Idempotency-Key verbatim, independent of content", () => {
    const a = mailDebitIdempotencyKey({ ...base, clientKey: "abc-123" });
    const b = mailDebitIdempotencyKey({ ...base, pieceCount: 999, clientKey: "abc-123" });
    expect(a).toBe(b);
    expect(a).toContain(":ck:abc-123");
  });

  it("never embeds a timestamp (deterministic given the same inputs)", () => {
    const k1 = mailDebitIdempotencyKey(base);
    // Different call, same inputs — must match; a Date.now() key never would.
    const k2 = mailDebitIdempotencyKey({ ...base });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^mail:queue:7:c:[0-9a-f]{32}$/);
  });
});
