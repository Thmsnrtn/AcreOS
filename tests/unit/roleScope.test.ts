/**
 * roleScope.test.ts — the tenant-authorization gate.
 *
 * roleScope.ts decides which team member can see/do what within an org
 * (financial_read, tenant_pii_read, deal_write, …). It is a cross-org access
 * boundary, so its least-privilege map and its fail-closed behaviour must not
 * regress silently. ROLE_SCOPES is module-private, so we exercise it THROUGH
 * hasRoleScope with a mocked team-members lookup — which also covers the
 * founder bypass, the org-owner shortcut, and the fail-closed error path.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Controllable team-members lookup. `db.select().from().where().limit()`
// resolves to `mockRows` (or rejects when `mockThrows`).
let mockRows: Array<{ role: string }> = [];
let mockThrows = false;

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            mockThrows
              ? Promise.reject(new Error("db unavailable"))
              : Promise.resolve(mockRows),
        }),
      }),
    }),
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { hasRoleScope, requireScope, type Scope } from "../../server/middleware/roleScope";
import type { AuthenticatedRequest } from "../../server/types/request";

function reqAs(overrides: Record<string, unknown> = {}): AuthenticatedRequest {
  return {
    user: { id: "user-1" },
    organization: { id: 1, ownerId: "owner-9" },
    isFounder: false,
    ...overrides,
  } as unknown as AuthenticatedRequest;
}

function memberOf(role: string) {
  mockRows = [{ role }];
  mockThrows = false;
}

beforeEach(() => {
  mockRows = [];
  mockThrows = false;
});

describe("hasRoleScope — bypasses and guards", () => {
  it("grants everything to a founder without a lookup", async () => {
    mockThrows = true; // prove no DB call is needed
    expect(await hasRoleScope(reqAs({ isFounder: true }), "settings_write")).toBe(true);
  });

  it("grants everything to the org owner (ownerId === user.id)", async () => {
    mockThrows = true;
    const req = reqAs({ user: { id: "owner-9" }, organization: { id: 1, ownerId: "owner-9" } });
    expect(await hasRoleScope(req, "financial_write")).toBe(true);
  });

  it("denies when there is no user or no organization on the request", async () => {
    expect(await hasRoleScope(reqAs({ user: undefined }), "deal_read")).toBe(false);
    expect(await hasRoleScope(reqAs({ organization: undefined }), "deal_read")).toBe(false);
  });

  it("denies when the requester is not an active member", async () => {
    mockRows = []; // no member row
    expect(await hasRoleScope(reqAs(), "deal_read")).toBe(false);
  });

  it("fails CLOSED when the lookup throws", async () => {
    mockThrows = true;
    expect(await hasRoleScope(reqAs(), "deal_read")).toBe(false);
  });

  it("denies an unknown role (empty scope set)", async () => {
    memberOf("wizard");
    expect(await hasRoleScope(reqAs(), "deal_read")).toBe(false);
  });
});

describe("hasRoleScope — least-privilege map", () => {
  const cases: Array<{ role: string; granted: Scope; denied: Scope }> = [
    // A VA runs comms + deals but must NOT see the books.
    { role: "va", granted: "deal_write", denied: "financial_read" },
    // A bookkeeper sees the books but NOT tenant PII / screening.
    { role: "bookkeeper", granted: "financial_write", denied: "tenant_pii_read" },
    // A screening specialist sees ONLY tenant PII, nothing else.
    { role: "screening_specialist", granted: "tenant_pii_read", denied: "deal_read" },
    // A family co-owner is comment-only + can see finances, never edits deals.
    { role: "family_co_owner", granted: "annotation_only", denied: "deal_write" },
    // A viewer reads deals but cannot write them.
    { role: "viewer", granted: "deal_read", denied: "deal_write" },
    // An attorney/advisor sees the audit log but cannot move money.
    { role: "attorney_advisor", granted: "audit_read", denied: "financial_write" },
    // A property manager handles tenant PII but not the org's books.
    { role: "property_manager", granted: "tenant_pii_write", denied: "financial_read" },
    // A plain member can write deals but cannot change org settings.
    { role: "member", granted: "deal_write", denied: "settings_write" },
  ];

  for (const { role, granted, denied } of cases) {
    it(`${role}: grants ${granted}, denies ${denied}`, async () => {
      memberOf(role);
      expect(await hasRoleScope(reqAs(), granted)).toBe(true);
      memberOf(role);
      expect(await hasRoleScope(reqAs(), denied)).toBe(false);
    });
  }

  it("admin carries every scope, including settings_write and audit_read", async () => {
    for (const scope of ["financial_write", "tenant_pii_write", "deal_write", "settings_write", "audit_read"] as Scope[]) {
      memberOf("admin");
      expect(await hasRoleScope(reqAs(), scope)).toBe(true);
    }
  });
});

describe("requireScope middleware", () => {
  function resSpy() {
    const res: Record<string, unknown> = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    res.setHeader = vi.fn(() => res);
    return res as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } & Record<string, unknown>;
  }

  it("calls next() when the scope is granted", async () => {
    const next = vi.fn();
    const res = resSpy();
    await requireScope("settings_write")(reqAs({ isFounder: true }), res as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 403 and does NOT call next() when the scope is denied", async () => {
    memberOf("viewer"); // viewer lacks financial_read
    const next = vi.fn();
    const res = resSpy();
    await requireScope("financial_read")(reqAs(), res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
