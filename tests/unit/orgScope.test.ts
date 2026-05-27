/**
 * Lens 48 — Behavioral IDOR Probe regression tests.
 *
 * Verifies the org-scope helper bound to the routes we just patched.
 * These tests don't need a live DB — they mock the `db` module the
 * helper imports. Each test asserts a tenant-boundary invariant
 * (entity exists in tenant A, attacker in tenant B asks for it).
 *
 * idempotent: true — pure read-only assertion of helper behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the drizzle db module before importing the SUT so the helper
// reads our stub chain instead of trying to open a real connection.
const selectMock = vi.fn();

vi.mock("../../server/db", () => ({
  db: {
    select: (...args: unknown[]) => selectMock(...args),
  },
}));

// Also mock the schema imports (helper destructures table refs at
// module-load time; these only need to be truthy).
vi.mock("@shared/schema", () => {
  const noop = { id: "id", organizationId: "organizationId", userId: "userId", isActive: "isActive" } as any;
  return {
    properties: noop,
    rehabs: noop,
    rehabLineItems: noop,
    deals: noop,
    leads: noop,
    contractors: noop,
    dispositionRecommendations: noop,
    rentalLeases: noop,
    teamMembers: noop,
  };
});

// Build the .from().where().limit() chain that drizzle returns. Resolves
// to the array we configure per test.
function chainReturning(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  };
}

import { assertEntityBelongsToOrg, assertUserIsOrgMember } from "../../server/utils/orgScope";

beforeEach(() => {
  selectMock.mockReset();
});

describe("assertEntityBelongsToOrg", () => {
  it("returns true when the entity exists in the requested org", async () => {
    selectMock.mockReturnValue(chainReturning([{ id: 42 }]));
    const ok = await assertEntityBelongsToOrg("property", 42, 7);
    expect(ok).toBe(true);
  });

  it("returns false when no row matches (cross-tenant access attempt)", async () => {
    selectMock.mockReturnValue(chainReturning([]));
    const ok = await assertEntityBelongsToOrg("property", 42, 999);
    expect(ok).toBe(false);
  });

  it("returns false for an unknown entity type", async () => {
    // Helper guards against the registry miss before hitting the db.
    selectMock.mockReturnValue(chainReturning([{ id: 1 }]));
    const ok = await assertEntityBelongsToOrg("definitely-not-a-real-type" as any, 1, 1);
    expect(ok).toBe(false);
  });

  it("accepts UUID-string ids (rehab/contractor/etc.) without coercion errors", async () => {
    selectMock.mockReturnValue(chainReturning([{ id: "abc-123" }]));
    const ok = await assertEntityBelongsToOrg("rehab", "abc-123", 7);
    expect(ok).toBe(true);
  });
});

describe("assertUserIsOrgMember", () => {
  it("returns true for null/undefined userId so callers don't need a null guard", async () => {
    expect(await assertUserIsOrgMember(null, 1)).toBe(true);
    expect(await assertUserIsOrgMember(undefined, 1)).toBe(true);
    expect(await assertUserIsOrgMember("", 1)).toBe(true);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns true when the user is an active team member of the org", async () => {
    selectMock.mockReturnValue(chainReturning([{ id: 1 }]));
    const ok = await assertUserIsOrgMember("user_123", 7);
    expect(ok).toBe(true);
  });

  it("returns false when the user is NOT a member of the org", async () => {
    selectMock.mockReturnValue(chainReturning([]));
    const ok = await assertUserIsOrgMember("user_attacker", 7);
    expect(ok).toBe(false);
  });

  it("returns false when the membership exists but is inactive", async () => {
    // The helper's WHERE clause requires isActive=true; an inactive seat
    // surfaces as zero rows just like a non-member would.
    selectMock.mockReturnValue(chainReturning([]));
    const ok = await assertUserIsOrgMember("user_revoked", 7);
    expect(ok).toBe(false);
  });
});
