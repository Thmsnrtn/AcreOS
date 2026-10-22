import { describe, it, expect } from "vitest";
import {
  resolveSyntheticTestProfile,
  resolveTestUserId,
  personaTestUserId,
  E2E_TEST_USER_ID,
  E2E_FOUNDER_USER_ID,
  E2E_FOUNDER_COOKIE,
} from "../../server/auth/testAuth";

// Regression coverage for the customer-journey audit's permanent red:
// hydrateUser auto-provisioning used to call clerkClient.users.getUser()
// for the synthetic E2E identities. Clerk has never heard of them, so the
// call threw a Clerk 404 and EVERY authenticated request 404'd with it —
// the SPA then pinned its loading splash forever. These profiles are what
// hydrateUser now provisions locally for bypass-authenticated identities.
// The emails must mirror tests/e2e-mobile/global-setup.ts.
describe("resolveSyntheticTestProfile", () => {
  it("maps the customer test identity to the seeded profile", () => {
    expect(resolveSyntheticTestProfile(E2E_TEST_USER_ID)).toEqual({
      email: "e2e@acreos.test",
      firstName: "E2E",
      lastName: "Customer",
    });
  });

  it("maps the founder test identity to the seeded founder profile", () => {
    expect(resolveSyntheticTestProfile(E2E_FOUNDER_USER_ID)).toEqual({
      email: "founder-e2e@acreos.test",
      firstName: "E2E",
      lastName: "Founder",
    });
  });

  it("maps persona identities to per-slug profiles", () => {
    const id = personaTestUserId("land-buyer-1");
    expect(resolveSyntheticTestProfile(id)).toEqual({
      email: "e2e-persona-land_buyer_1@acreos.test",
      firstName: "E2E",
      lastName: "Persona",
    });
  });

  it("returns null for real Clerk user ids", () => {
    expect(resolveSyntheticTestProfile("user_2nF8kQ1xyzABC")).toBeNull();
    expect(resolveSyntheticTestProfile("")).toBeNull();
  });

  it("covers every identity resolveTestUserId can produce", () => {
    // The bypass must never resolve to an identity it cannot provision.
    const cookieCases: (string | undefined)[] = [
      undefined,
      "__session=e2e",
      `__session=${E2E_FOUNDER_COOKIE}`,
      "__session=e2e-persona-wholesaler",
      "other=1; __session=e2e-customer-journey",
    ];
    for (const cookie of cookieCases) {
      const id = resolveTestUserId(cookie);
      expect(
        resolveSyntheticTestProfile(id),
        `identity ${id} from cookie ${cookie} must be provisionable`,
      ).not.toBeNull();
    }
  });
});
