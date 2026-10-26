/**
 * The skip-trace purpose refusal cites the right FCRA subsection for each
 * purpose: written_consent is §1681b(a)(2) (the consumer's written
 * instruction); collection, legitimate_business_need and account_review are
 * §1681b(a)(3). It used to attribute all four to (a)(3). Reads the REAL thrown
 * message (the refusal fires before any database read).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

describe("FCRA purpose refusal citation", () => {
  it("cites (a)(2) for written_consent and (a)(3) only for the other three", async () => {
    const { assertSkipTracePermitted, SKIP_TRACE_PURPOSES } = await import("../../server/services/fcraAttestation");
    expect([...SKIP_TRACE_PURPOSES].sort()).toEqual(["account_review", "collection", "legitimate_business_need", "written_consent"]);
    const err = await assertSkipTracePermitted({ organizationId: 1, userId: "u", purposeOfUse: "not_a_purpose", justification: "x".repeat(20) }).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toMatch(/§1681b\(a\)\(2\) \(written_consent\)/);
    expect(err?.message).toMatch(/§1681b\(a\)\(3\) \(collection, legitimate_business_need, account_review\)/);
  });
});
