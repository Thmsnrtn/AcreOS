/**
 * Quality directive 2026-09-29 (setup durability) — a member's personal
 * persona is theirs; the organization's business type is the org's.
 *
 * `PUT /api/me/persona` rewrote `organizations.onboardingData.businessType`
 * and `investorType` for ANY member who changed their own persona, so one
 * teammate's view preference re-shaped the whole workspace for everyone.
 * Only the owner (or an admin) moves the org now.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { organizations, teamMembers } from "@shared/schema";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown }, _res: unknown, next: () => void) => {
    req.organization = { id: 5 };
    next();
  },
}));

const S = vi.hoisted(() => ({
  org: { onboardingData: { businessType: "land_flipper" }, ownerId: "u_owner" } as Record<string, unknown>,
  role: null as null | string,
  orgUpdates: [] as unknown[],
  userUpdates: 0,
}));
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: (t: unknown) => ({
        where: () => ({
          limit: async () =>
            t === organizations ? [S.org] : t === teamMembers ? (S.role ? [{ role: S.role }] : []) : [],
        }),
      }),
    }),
    update: (t: unknown) => ({
      set: (v: unknown) => ({
        where: async () => {
          if (t === organizations) S.orgUpdates.push(v);
          else S.userUpdates++;
        },
      }),
    }),
  },
}));

async function app(userId: string) {
  const { default: router } = await import("../../server/routes-persona");
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as unknown as { user: { id: string } }).user = { id: userId };
    next();
  });
  a.use("/api/me/persona", router);
  return a;
}

beforeEach(() => {
  S.role = null;
  S.orgUpdates = [];
  S.userUpdates = 0;
});

describe("a member's persona does not re-shape the organization", () => {
  it("a plain member changes only their own persona", async () => {
    S.role = "member";
    const r = await request(await app("u_member")).put("/api/me/persona").send({ persona: "note_investor" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ persona: "note_investor", organizationUpdated: false });
    expect(S.userUpdates).toBe(1);
    expect(S.orgUpdates).toEqual([]);
  });

  it("the org owner moves the org with them", async () => {
    const r = await request(await app("u_owner")).put("/api/me/persona").send({ persona: "note_investor" });
    expect(r.body.organizationUpdated).toBe(true);
    expect(S.orgUpdates).toHaveLength(1);
  });

  it("an admin does too", async () => {
    S.role = "admin";
    const r = await request(await app("u_admin")).put("/api/me/persona").send({ persona: "note_investor" });
    expect(r.body.organizationUpdated).toBe(true);
  });
});
