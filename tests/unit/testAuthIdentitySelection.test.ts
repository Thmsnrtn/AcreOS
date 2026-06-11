import { describe, it, expect } from "vitest";
import {
  resolveTestUserId,
  E2E_TEST_USER_ID,
  E2E_FOUNDER_USER_ID,
  E2E_FOUNDER_COOKIE,
} from "../../server/auth/testAuth";

/**
 * The E2E bypass maps `__session` cookie values to one of two seeded
 * identities (customer vs founder). The founder gate is constitution-critical
 * — customers must never see founder tabs/codenames — so the selection logic
 * gets direct coverage: anything that is not the exact founder sentinel MUST
 * resolve to the customer identity (fail-closed toward non-founder).
 */
describe("resolveTestUserId — E2E identity selection", () => {
  it("defaults to the customer identity with no cookie header", () => {
    expect(resolveTestUserId(undefined)).toBe(E2E_TEST_USER_ID);
    expect(resolveTestUserId("")).toBe(E2E_TEST_USER_ID);
  });

  it("resolves the customer identity for the standard spec cookie", () => {
    expect(resolveTestUserId("__session=e2e")).toBe(E2E_TEST_USER_ID);
  });

  it("resolves the founder identity ONLY for the exact sentinel value", () => {
    expect(resolveTestUserId(`__session=${E2E_FOUNDER_COOKIE}`)).toBe(
      E2E_FOUNDER_USER_ID,
    );
    // Prefix / suffix / case variants fail closed to customer.
    expect(resolveTestUserId("__session=e2e-founder-extra")).toBe(E2E_TEST_USER_ID);
    expect(resolveTestUserId("__session=E2E-FOUNDER")).toBe(E2E_TEST_USER_ID);
    expect(resolveTestUserId("__session=xe2e-founder")).toBe(E2E_TEST_USER_ID);
  });

  it("finds the sentinel among other cookies", () => {
    expect(
      resolveTestUserId(`theme=dark; __session=${E2E_FOUNDER_COOKIE}; lang=en`),
    ).toBe(E2E_FOUNDER_USER_ID);
  });

  it("ignores suffixed Clerk-style cookie names (__session_<hash>=…)", () => {
    // Only the bare `__session` cookie selects identity — a suffixed
    // `__session_abc123` must not match and falls back to customer.
    expect(
      resolveTestUserId(`__session_abc123=${E2E_FOUNDER_COOKIE}`),
    ).toBe(E2E_TEST_USER_ID);
  });

  it("does not treat a sentinel inside another cookie's value as a match", () => {
    expect(
      resolveTestUserId(`note=__session=${E2E_FOUNDER_COOKIE}`),
    ).toBe(E2E_TEST_USER_ID);
  });
});
