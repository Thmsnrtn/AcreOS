/**
 * Team invites through the REAL routes: delivery is reported honestly, and a
 * new link can be made only by the org's admins, only for their own pending
 * invitations.
 *
 * The fake `db` evaluates the predicate drizzle actually built against rows of
 * two organizations, so an unscoped update would reach the other tenant's row
 * here exactly as it would in production.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { Column, Param, SQL, Table, is, getTableColumns } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { organizationInvitations } from "@shared/schema";
import { hashInviteToken } from "../../server/utils/inviteTokens";

const MINE = 42;
const OTHER = 7;
type Row = Record<string, any>;

const h = vi.hoisted(() => ({
  org: { id: 42, name: "Acme", subscriptionTier: "scale", seatCount: 10 } as Record<string, any>,
  role: "admin",
  rows: [] as Array<Record<string, any>>,
  nextId: 100,
  sendCalls: [] as any[],
  deliver: "sent" as string,
  limitAllowed: true,
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: "user-1", firstName: "Pat", lastName: "Owner", email: "pat@example.com" };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: unknown, next: () => void) => {
    req.organization = h.org;
    req.organizationId = h.org.id;
    next();
  },
}));
// The role gate is REAL; only the membership lookup (storage.getTeamMember) is faked.
vi.mock("../../server/services/inviteRateLimit", () => ({
  checkInviteCreateLimit: async () => ({ allowed: h.limitAllowed, limit: 100, retryAfterSeconds: 60 }),
  checkInviteAcceptLimit: async () => ({ allowed: true }),
}));
vi.mock("../../server/services/teamInviteEmail", () => ({
  sendTeamInviteEmails: async (req: any) => {
    h.sendCalls.push(req);
    return req.invites.map((i: any) => ({ invitationId: i.invitationId, status: h.deliver }));
  },
}));
vi.mock("../../server/utils/auditLog", async () => {
  const actual = await vi.importActual<Record<string, any>>("../../server/utils/auditLog");
  return { ...actual, auditFromRequest: async () => undefined };
});
vi.mock("../../server/utils/customerAudit", async () => {
  const actual = await vi.importActual<Record<string, any>>("../../server/utils/customerAudit");
  return { ...actual, customerAuditFromRequest: async () => undefined };
});

const KEYS = new Map<string, string>(
  Object.entries(getTableColumns(organizationInvitations as any)).map(([k, c]) => [(c as { name: string }).name, k]),
);
const dialect = new PgDialect();
function equalities(node: unknown): Array<[string, unknown]> {
  const tokens: Array<{ kind: "col" | "param"; v: unknown }> = [];
  const seen = new WeakSet<object>();
  const walk = (n: any): void => {
    if (n === null || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) return n.forEach(walk);
    if (is(n, Column)) return void tokens.push({ kind: "col", v: n.name });
    if (is(n, Param)) return void tokens.push({ kind: "param", v: n.value });
    if (is(n, Table)) return;
    if (is(n, SQL)) return (n as any).queryChunks.forEach(walk);
    if (typeof n.getSQL === "function") return walk(n.getSQL());
  };
  walk(node);
  const out: Array<[string, unknown]> = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].kind === "col" && tokens[i + 1].kind === "param") out.push([String(tokens[i].v), tokens[i + 1].v]);
  }
  return out;
}
const matches = (row: Row, predicate: unknown) => {
  const sqlText = dialect.sqlToQuery((predicate as SQL).getSQL()).sql.toLowerCase();
  if (/\bor\b/.test(sqlText)) throw new Error("fake db models conjunctions only");
  return equalities(predicate).every(([col, v]) => String(row[KEYS.get(col)!]) === String(v));
};

vi.mock("../../server/storage", () => {
  const db = {
    select: (fields?: Record<string, unknown>) => ({
      from: () => ({
        where: (pred: unknown) => {
          if (fields && "count" in fields) return Promise.resolve([{ count: 0 }]);
          const out = h.rows.filter((r) => matches(r, pred)).map((r) => ({ ...r }));
          return Object.assign(Promise.resolve(out), { limit: async () => out });
        },
        orderBy: async () => h.rows.map((r) => ({ ...r })),
      }),
    }),
    insert: () => ({
      values: (vals: any[] | any) => ({
        returning: async () => {
          const list = (Array.isArray(vals) ? vals : [vals]).map((v) => ({ id: h.nextId++, createdAt: new Date(), acceptedAt: null, ...v }));
          h.rows.push(...list);
          return list.map((r) => ({ ...r }));
        },
      }),
    }),
    update: () => ({
      set: (vals: Row) => ({
        where: (pred: unknown) => ({
          returning: async () => {
            const hit = h.rows.filter((r) => matches(r, pred));
            hit.forEach((r) => Object.assign(r, vals));
            return hit.map((r) => ({ ...r }));
          },
        }),
      }),
    }),
  };
  return {
    storage: {
      createAuditLogEntry: async () => undefined,
      getTeamMember: async (orgId: number, userId: string) =>
        h.role === "none" ? undefined : { id: 1, organizationId: orgId, userId, role: h.role, isActive: true, viewOnlyAssignedLeads: null },
    },
    db,
  };
});

const OLD_TOKEN = "OLDtokenOLDtokenOLDtoken0123456789";
const seed = (over: Row = {}) => {
  const r = {
    id: h.nextId++, organizationId: MINE, email: "invitee@example.com", role: "member", token: "legacyplain",
    inviteTokenHash: hashInviteToken(OLD_TOKEN), inviteTokenLast4: OLD_TOKEN.slice(-4), status: "pending",
    createdAt: new Date(), expiresAt: new Date("2020-01-01T00:00:00Z"), ...over,
  };
  h.rows.push(r);
  return r;
};
async function app() {
  const { registerOrganizationRoutes } = await import("../../server/routes-organization");
  const a = express();
  a.use(express.json());
  registerOrganizationRoutes(a);
  return a;
}

beforeEach(() => {
  h.org = { id: MINE, name: "Acme", subscriptionTier: "scale", seatCount: 10 };
  h.role = "admin";
  h.rows = [];
  h.sendCalls = [];
  h.deliver = "sent";
  h.limitAllowed = true;
});

describe("creating an invite reports delivery per invite", () => {
  it.each(["sent", "not_configured", "suppressed", "failed"])("%s is returned as reported, with the link", async (status) => {
    h.deliver = status;
    const res = await request(await app()).post("/api/organization/invitations").send({ email: "New@Example.com", role: "member" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.invitations[0].delivery).toBe(status);
    expect(res.body.invitations[0].link).toContain("/auth?invite=");
    expect(h.sendCalls).toHaveLength(1);
    expect(h.sendCalls[0].invites[0].email).toBe("new@example.com");
    expect(h.sendCalls[0].inviterName).toBe("Pat Owner");
    // The emailed token is the one whose hash was stored.
    const stored = h.rows[0];
    expect(stored.inviteTokenHash).toBe(hashInviteToken(h.sendCalls[0].invites[0].token));
    expect(stored.token).toBeNull();
  });
});

describe("regenerate", () => {
  it("rotates the token (old hash and legacy plaintext gone), restarts expiry, and emails when asked", async () => {
    const row = seed();
    const res = await request(await app()).post(`/api/organization/invitations/${row.id}/regenerate`).send({ sendEmail: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.invitation.delivery).toBe("sent");
    const token = new URL(res.body.invitation.link).searchParams.get("invite")!;
    const stored = h.rows[0];
    expect(stored.inviteTokenHash).toBe(hashInviteToken(token));
    expect(stored.inviteTokenHash).not.toBe(hashInviteToken(OLD_TOKEN));
    expect(stored.token).toBeNull();
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(h.sendCalls[0].invites[0]).toMatchObject({ invitationId: row.id, reissued: true, token });
  });

  it("without sendEmail it emails nothing and reports no delivery", async () => {
    const row = seed();
    const res = await request(await app()).post(`/api/organization/invitations/${row.id}/regenerate`).send({});
    expect(res.status).toBe(200);
    expect(res.body.invitation.delivery).toBeNull();
    expect(h.sendCalls).toHaveLength(0);
  });

  it("another organization cannot rotate it: 404, and the row is untouched", async () => {
    const theirs = seed({ organizationId: OTHER });
    const res = await request(await app()).post(`/api/organization/invitations/${theirs.id}/regenerate`).send({ sendEmail: true });
    expect(res.status).toBe(404);
    expect(h.rows[0].inviteTokenHash).toBe(hashInviteToken(OLD_TOKEN));
    expect(h.rows[0].token).toBe("legacyplain");
    expect(h.sendCalls).toHaveLength(0);
  });

  it("a non-admin member is refused by the role gate", async () => {
    const row = seed();
    h.role = "member";
    const res = await request(await app()).post(`/api/organization/invitations/${row.id}/regenerate`).send({});
    expect(res.status).toBe(403);
    expect(h.rows[0].inviteTokenHash).toBe(hashInviteToken(OLD_TOKEN));
  });

  it.each(["revoked", "accepted", "expired"])("a %s invitation is not revived (no seat is added)", async (status) => {
    const row = seed({ status });
    const res = await request(await app()).post(`/api/organization/invitations/${row.id}/regenerate`).send({});
    expect(res.status).toBe(422);
    expect(h.rows[0].status).toBe(status);
    expect(h.rows[0].inviteTokenHash).toBe(hashInviteToken(OLD_TOKEN));
  });

  it("the daily invite budget refuses an emailed new link BEFORE rotating", async () => {
    const row = seed();
    h.limitAllowed = false;
    const res = await request(await app()).post(`/api/organization/invitations/${row.id}/regenerate`).send({ sendEmail: true });
    expect(res.status).toBe(429);
    expect(h.rows[0].inviteTokenHash).toBe(hashInviteToken(OLD_TOKEN));
    expect(h.sendCalls).toHaveLength(0);
  });
});
