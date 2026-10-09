/**
 * The three account endpoints serve explicit allowlists, per caller role.
 *
 *   GET /api/auth/user     (server/auth/routes.ts)
 *   GET /api/organization  (server/routes-organization.ts)
 *   GET /api/team          (server/routes-organization.ts)
 *
 * Each test drives the REAL registered handler with a fixture row in which
 * EVERY column of the drizzle table is populated (plus one key that is not a
 * column today, standing in for a column added later), and asserts the served
 * keys EQUAL a key set written out in this file, per endpoint and per role.
 *
 * The expected sets are hard-coded here and deliberately not imported from
 * shared/accountViews.ts: a test that derives "what may be served" from the
 * allowlist it is checking agrees with any widening of that allowlist. These
 * sets are the client's reads (enumerated from the consumers named beside
 * each field in shared/accountViews.ts), so widening the allowlist goes red
 * here, and so does trimming it under a reader. The client hooks are typed to
 * the views, so a reader of an unserved field is a type error in
 * `npm run check`.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";
import { getTableColumns, type Table } from "drizzle-orm";
import { organizations, teamMembers } from "@shared/schema";
import { users } from "@shared/models/auth";
import type { ViewerRole } from "@shared/accountViews";
import { stripComments, REPO_SWEEP_TIMEOUT_MS } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROLES: ViewerRole[] = ["owner", "admin", "member", "va", "viewer"];
const ORG_ID = 77;
const FUTURE_COLUMN = "aColumnAddedLater";

const h = vi.hoisted(() => {
  const state = {
    user: null as Record<string, unknown> | null,
    org: null as Record<string, unknown> | null,
    roster: [] as Array<Record<string, unknown>>,
  };
  const passUser = (req: any, _res: any, next: any) => {
    req.user = state.user;
    next();
  };
  const passOrg = (req: any, _res: any, next: any) => {
    req.organization = state.org;
    req.organizationId = (state.org as any)?.id;
    next();
  };
  return { state, passUser, passOrg };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: h.passUser,
  requireFounder: (_req: any, res: any) => res.status(404).end(),
  getOrCreateOrg: h.passOrg,
}));
vi.mock("../../server/auth/clerkAuth", () => ({
  isAuthenticated: h.passUser,
  requireFounder: (_req: any, res: any) => res.status(404).end(),
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: h.passOrg,
  ACTIVE_ORG_COOKIE: "acreos_active_org",
  ACTIVE_ORG_COOKIE_OPTS: {},
}));
vi.mock("../../server/utils/auditLog", () => ({
  auditFromRequest: vi.fn(async () => undefined),
  AuditActions: new Proxy({}, { get: (_t, k) => String(k) }),
}));
vi.mock("../../server/middleware/botSignals", () => ({
  recordSignupSignals: vi.fn(async () => undefined),
  computeReqIpBucket: () => "bucket",
}));
vi.mock("../../server/storage", () => ({
  storage: {
    getTeamMembers: vi.fn(async (orgId: number) =>
      h.state.roster.filter((m) => m.organizationId === orgId),
    ),
    // The membership read behind getUserPermissionContext.
    getTeamMember: vi.fn(async (orgId: number, userId: string) =>
      h.state.roster.find((m) => m.organizationId === orgId && m.userId === userId),
    ),
    // PATCH /api/organization writes through these and serves the updated row.
    updateOrganization: vi.fn(async (_orgId: number, updates: Record<string, unknown>) => ({ ...h.state.org, ...updates })),
    createAuditLogEntry: vi.fn(async () => undefined),
  },
  db: {},
}));
vi.mock("../../server/db", () => ({ db: {} }));

import { registerAuthRoutes } from "../../server/auth/routes";
import { registerOrganizationRoutes } from "../../server/routes-organization";

/** Every column of `table`, each set to a distinct non-null value. */
function fullRow(table: Table, overrides: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of Object.keys(getTableColumns(table))) row[key] = `value-of-${key}`;
  row[FUTURE_COLUMN] = "value-of-a-later-column";
  return { ...row, ...overrides };
}

function columnsOf(table: Table): string[] {
  return Object.keys(getTableColumns(table));
}

/** The served keys, sorted, for an exact comparison. */
const keysOf = (body: Record<string, unknown>) => Object.keys(body).sort();

// The exact key set each endpoint serves, per role — the client's reads,
// written out here (see the header for why they are not imported).
const EXPECTED_USER_KEYS: Record<ViewerRole, string[]> = Object.fromEntries(
  ROLES.map((r) => [
    r,
    ["email", "firstName", "id", "lastName", "paxDisclosureAcknowledgedAt", "persona"],
  ]),
) as Record<ViewerRole, string[]>;
const EXPECTED_ORG_KEYS: Record<ViewerRole, string[]> = Object.fromEntries(
  ROLES.map((r) => [
    r,
    [
      "id",
      "investorType",
      "isFounder",
      "name",
      "onboardingCompleted",
      "onboardingData",
      "settings",
      "subscriptionStatus",
      "subscriptionTier",
      "trialUsed",
    ],
  ]),
) as Record<ViewerRole, string[]>;
// The projection's columns, plus (merged with #330) the EFFECTIVE assigned-only
// flag and its stored override — computed by the server's resolver, not
// columns of the projection, and needed by the Settings toggle.
const EXPECTED_TEAM_KEYS = ["displayName", "email", "id", "isActive", "role", "userId", "viewOnlyAssignedLeads", "viewOnlyAssignedLeadsOverride"];

// Named so that widening an allowlist to one of these is its own red line.
const NEVER_SERVED_USER = ["passwordResetToken", "passwordResetExpiresAt", "failedLoginAttempts", "lockedUntil"];
const NEVER_SERVED_ORG = [
  "ein",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "churnRiskScore",
  "dunningStage",
  "founderDailyAttentionCap",
];

const SELF_ID = "user-self";

function seed(role: ViewerRole) {
  h.state.user = fullRow(users, { id: SELF_ID, email: "self@example.com" });
  h.state.org = fullRow(organizations, {
    id: ORG_ID,
    // The caller owns the org only in the owner case.
    ownerId: role === "owner" ? SELF_ID : "user-someone-else",
  });
  h.state.roster = [
    fullRow(teamMembers, { id: 1, organizationId: ORG_ID, userId: SELF_ID, role, isActive: true, email: "self@example.com" }),
    fullRow(teamMembers, { id: 2, organizationId: ORG_ID, userId: "user-b", role: "member", isActive: true, email: "b@example.com" }),
    fullRow(teamMembers, { id: 3, organizationId: ORG_ID, userId: "user-c", role: "admin", isActive: true, email: "c@example.com" }),
  ];
}

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerAuthRoutes(app);
  registerOrganizationRoutes(app);
});

beforeEach(() => {
  seed("member");
});

describe("the fixture is complete (vacuity guard)", () => {
  it("each table has columns and the fixture populates every one of them", () => {
    for (const table of [users, organizations, teamMembers] as Table[]) {
      const cols = columnsOf(table);
      expect(cols.length).toBeGreaterThan(5);
      const row = fullRow(table, {});
      for (const c of cols) expect(row[c], c).toBeDefined();
    }
    // The secrets named above are real columns — a rename would empty the list.
    for (const c of NEVER_SERVED_USER) expect(columnsOf(users)).toContain(c);
    for (const c of NEVER_SERVED_ORG) expect(columnsOf(organizations)).toContain(c);
  });
});

describe("GET /api/auth/user", () => {
  for (const role of ROLES) {
    it(`${role}: serves the client's fields and no other column`, async () => {
      seed(role);
      const res = await request(app).get("/api/auth/user");
      expect(res.status).toBe(200);
      expect(keysOf(res.body)).toEqual(EXPECTED_USER_KEYS[role]);
      for (const k of NEVER_SERVED_USER) expect(res.body).not.toHaveProperty(k);
      expect(res.body.id).toBe(SELF_ID);
      expect(res.body).not.toHaveProperty("isFounder");
    });
  }

  it("a founder identity gets isFounder: true and still no other column", async () => {
    seed("owner");
    h.state.user = fullRow(users, { id: SELF_ID, email: "founder@test.com" });
    const res = await request(app).get("/api/auth/user");
    expect(res.status).toBe(200);
    expect(res.body.isFounder).toBe(true);
    expect(keysOf(res.body)).toEqual([...EXPECTED_USER_KEYS.owner, "isFounder"].sort());
  });
});

describe("GET /api/organization", () => {
  for (const role of ROLES) {
    it(`${role}: serves the client's fields and no other column`, async () => {
      seed(role);
      const res = await request(app).get("/api/organization");
      expect(res.status).toBe(200);
      expect(keysOf(res.body)).toEqual(EXPECTED_ORG_KEYS[role]);
      for (const k of NEVER_SERVED_ORG) expect(res.body).not.toHaveProperty(k);
      expect(res.body.id).toBe(ORG_ID);
    });
  }

  it("a caller with no readable membership row gets the least-privileged view, not an error", async () => {
    seed("member");
    h.state.roster = h.state.roster.filter((m) => m.userId !== SELF_ID);
    const res = await request(app).get("/api/organization");
    expect(res.status).toBe(200);
    expect(keysOf(res.body)).toEqual(EXPECTED_ORG_KEYS.viewer);
  });
});

describe("PATCH /api/organization", () => {
  it("serves the updated organization through the same view, not the updated row", async () => {
    seed("owner");
    const res = await request(app).patch("/api/organization").send({ name: "Renamed Co" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed Co");
    expect(keysOf(res.body)).toEqual(EXPECTED_ORG_KEYS.owner);
    for (const k of NEVER_SERVED_ORG) expect(res.body).not.toHaveProperty(k);
  });
});

describe("GET /api/team", () => {
  const SEES_TEAMMATE_EMAILS: Record<ViewerRole, boolean> = {
    owner: true,
    admin: true,
    member: true,
    va: false,
    viewer: false,
  };

  for (const role of ROLES) {
    it(`${role}: roster rows carry only the served columns; teammate emails ${SEES_TEAMMATE_EMAILS[role] ? "shown" : "hidden"}`, async () => {
      seed(role);
      const res = await request(app).get("/api/team");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      for (const row of res.body as Array<Record<string, unknown>>) {
        expect(keysOf(row)).toEqual(EXPECTED_TEAM_KEYS);
        expect(typeof row.displayName).toBe("string");
        expect(typeof row.role).toBe("string");
      }
      const self = res.body.find((r: any) => r.userId === SELF_ID);
      expect(self.email).toBe("self@example.com");
      const others = res.body.filter((r: any) => r.userId !== SELF_ID);
      for (const other of others) {
        if (SEES_TEAMMATE_EMAILS[role]) expect(other.email).toMatch(/@example\.com$/);
        else expect(other.email).toBeNull();
      }
    });
  }
});

describe("the client reads these endpoints through the served types", () => {
  const read = (p: string) => stripComments(fs.readFileSync(path.resolve(__dirname, "../..", p), "utf8"));

  it("useAuth's user is AuthUserView, useOrganization is OrganizationView, the roster is TeamMemberView", () => {
    const auth = read("client/src/hooks/use-auth.ts");
    expect(auth).toMatch(/export type AuthUser = AuthUserView;/);
    const org = read("client/src/hooks/use-organization.ts");
    expect(org).toMatch(/export function useOrganization\(\) \{\s*return useQuery<OrganizationView>\(/);
    expect(org).toMatch(/export interface TeamMember extends Omit<TeamMemberView, "role">/);
  });
});
