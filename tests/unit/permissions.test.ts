/**
 * permissions.test.ts — the org role→permission table and its accessors.
 *
 * These pure helpers decide what each team role may do inside its org
 * (delete the org, manage billing, edit vs view-only, assigned-leads-only).
 * They are a tenant-authorization surface, so the least-privilege shape must
 * not drift silently. The async getUserPermissionContext + Express middleware
 * (which need a DB/request) are covered separately; this pins the pure core.
 */

import { describe, it, expect } from "vitest";
import {
  getPermissionsForRole,
  hasPermission,
  isAdminOrAbove,
  isOwner,
  getRoleLabel,
  getRoleColor,
} from "../../server/utils/permissions";

describe("getPermissionsForRole — least-privilege shape", () => {
  it("owner can do the org-destroying things", () => {
    const p = getPermissionsForRole("owner");
    expect(p.canDeleteOrg).toBe(true);
    expect(p.canManageBilling).toBe(true);
    expect(p.canManageTeam).toBe(true);
    expect(p.canAccessSettings).toBe(true);
  });

  it("admin manages the team but CANNOT delete the org or manage billing (owner-only)", () => {
    const p = getPermissionsForRole("admin");
    expect(p.canManageTeam).toBe(true);
    expect(p.canAccessSettings).toBe(true);
    expect(p.canDeleteOrg).toBe(false);
    expect(p.canManageBilling).toBe(false);
  });

  it("member operates but has no settings/billing/team access", () => {
    const p = getPermissionsForRole("member");
    expect(p.canEditDeals).toBe(true);
    expect(p.canCreateLeads).toBe(true);
    expect(p.canAccessSettings).toBe(false);
    expect(p.canManageTeam).toBe(false);
    expect(p.canDeleteLeads).toBe(false);
    expect(p.viewOnlyAssignedLeads).toBe(false);
  });

  it("va is an operational member defaulted to assigned-leads-only", () => {
    const p = getPermissionsForRole("va");
    expect(p.canEditDeals).toBe(true);
    expect(p.viewOnlyAssignedLeads).toBe(true);
    expect(p.canAccessSettings).toBe(false);
  });

  it("viewer can view everything but mutate nothing", () => {
    const p = getPermissionsForRole("viewer");
    expect(p.canViewLeads).toBe(true);
    expect(p.canViewDeals).toBe(true);
    for (const perm of [
      "canEditLeads", "canEditDeals", "canCreateLeads",
      "canDeleteLeads", "canDeleteDeals", "canExportData",
    ] as const) {
      expect(p[perm]).toBe(false);
    }
  });

  it("an unknown role falls back to member permissions (fail-safe default)", () => {
    const p = getPermissionsForRole("not-a-real-role");
    expect(p.canViewLeads).toBe(true);
    expect(p.canAccessSettings).toBe(false);
    expect(p.canDeleteOrg).toBe(false);
  });
});

describe("hasPermission", () => {
  it("owner deletes the org; admin does not", () => {
    expect(hasPermission("owner", "canDeleteOrg")).toBe(true);
    expect(hasPermission("admin", "canDeleteOrg")).toBe(false);
  });
  it("member cannot access settings; owner can", () => {
    expect(hasPermission("member", "canAccessSettings")).toBe(false);
    expect(hasPermission("owner", "canAccessSettings")).toBe(true);
  });
});

describe("isAdminOrAbove / isOwner", () => {
  it("isAdminOrAbove is true only for owner and admin", () => {
    expect(isAdminOrAbove("owner")).toBe(true);
    expect(isAdminOrAbove("admin")).toBe(true);
    expect(isAdminOrAbove("member")).toBe(false);
    expect(isAdminOrAbove("va")).toBe(false);
    expect(isAdminOrAbove("viewer")).toBe(false);
  });
  it("isOwner is true only for owner", () => {
    expect(isOwner("owner")).toBe(true);
    expect(isOwner("admin")).toBe(false);
    expect(isOwner("member")).toBe(false);
  });
});

describe("getRoleLabel / getRoleColor", () => {
  it("labels each known role and defaults unknowns to Member", () => {
    expect(getRoleLabel("owner")).toBe("Owner");
    expect(getRoleLabel("admin")).toBe("Admin");
    expect(getRoleLabel("member")).toBe("Member");
    expect(getRoleLabel("viewer")).toBe("Viewer");
    expect(getRoleLabel("va")).toBe("VA");
    expect(getRoleLabel("mystery")).toBe("Member");
  });
  it("colors each known role; unknowns normalize to member (blue)", () => {
    expect(getRoleColor("owner")).toBe("amber");
    expect(getRoleColor("admin")).toBe("purple");
    expect(getRoleColor("member")).toBe("blue");
    expect(getRoleColor("viewer")).toBe("slate");
    expect(getRoleColor("va")).toBe("teal");
    // normalizeRole() maps any unrecognized role to "member" before the
    // switch, so an unknown gets member's colour, not the switch default.
    expect(getRoleColor("mystery")).toBe("blue");
  });
});
