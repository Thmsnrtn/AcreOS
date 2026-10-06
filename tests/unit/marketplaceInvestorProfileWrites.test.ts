/**
 * An investor-profile write carries only the customer-editable columns.
 *
 * `investor_profiles` mixes what an organization says about itself (display
 * name, bio, specialties) with what the platform says about it: the row's id
 * and tenant key, the verification state, and the reputation figures other
 * organizations read as trust signals (rating, deals closed, reliability). The
 * two write routes — POST /api/marketplace/investor-profile and
 * PATCH /api/marketplace/investors/me — are driven here through the real
 * router and the real marketplace service; only the database is faked, and
 * every `.set()` / `.values()` payload it receives is captured. The assertion
 * is on those payloads: no platform-owned key may reach a write.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const VIEWER_ORG = 20;

const DB = vi.hoisted(() => {
  const writes: Array<{ op: "set" | "values"; payload: Record<string, unknown> }> = [];
  const selectQueue: unknown[][] = [];
  const chain = (result: () => unknown) => {
    const target = function () {} as unknown as object;
    const proxy: any = new Proxy(target, {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
        }
        return (...args: unknown[]) => {
          if (prop === "set" || prop === "values") writes.push({ op: prop, payload: args[0] as Record<string, unknown> });
          return proxy;
        };
      },
    });
    return proxy;
  };
  const row = () => ({ id: 1, organizationId: 20, displayName: "Acme Land" });
  const db = {
    select: () => chain(() => selectQueue.shift() ?? []),
    update: () => chain(() => [row()]),
    insert: () => chain(() => [row()]),
  };
  return { writes, selectQueue, db };
});

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", () => ({ db: DB.db, withTransaction: async (fn: (tx: unknown) => unknown) => fn(DB.db) }));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock("../../server/services/matchmaking", () => ({ matchmaking: {} }));

const { default: marketplaceRouter } = await import("../../server/routes-marketplace");
const { marketplaceService, investorProfileEdits } = await import("../../server/services/marketplace");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    Object.assign(req, { organization: { id: VIEWER_ORG } });
    next();
  });
  a.use("/api/marketplace", marketplaceRouter);
  return a;
}

/**
 * The columns a customer edits — written out independently of the service's
 * own list, from the "Public info" and "Specialization" blocks of
 * shared/schema/marketplace.ts. `updatedAt` is the server's own stamp.
 */
const EDITABLE = ["displayName", "bio", "location", "website", "specialties", "preferredStates", "investmentRange"];
const SERVER_STAMP = ["updatedAt"];

/** A body that names every platform-owned column, each with a value a caller would want. */
const HOSTILE_BODY = {
  displayName: "Acme Land",
  bio: "We buy land.",
  location: "Austin, TX",
  website: "https://acme.example",
  specialties: ["raw_land"],
  preferredStates: ["TX"],
  investmentRange: { min: 1000, max: 50000 },
  id: 999,
  organizationId: 77,
  isVerified: true,
  verifiedAt: "2020-01-01T00:00:00.000Z",
  verificationDocuments: ["https://example.com/doc.pdf"],
  dealsClosed: 500,
  avgResponseTimeHours: "0.1",
  reliabilityScore: "100",
  rating: "5",
  reviewCount: 900,
  lastActiveAt: "2020-01-01T00:00:00.000Z",
  createdAt: "2001-01-01T00:00:00.000Z",
  updatedAt: "2001-01-01T00:00:00.000Z",
};

function writtenKeys(): string[] {
  return [...new Set(DB.writes.flatMap((w) => Object.keys(w.payload)))].sort();
}

beforeEach(() => {
  DB.writes.length = 0;
  DB.selectQueue.length = 0;
});

describe("investor-profile writes carry customer-editable columns only", () => {
  it("POST /investor-profile: the write holds exactly the editable fields plus the server's timestamp", async () => {
    const res = await request(app()).post("/api/marketplace/investor-profile").send(HOSTILE_BODY);
    expect(res.status).toBe(200);
    expect(DB.writes.length).toBeGreaterThan(0);
    expect(writtenKeys()).toEqual([...EDITABLE, ...SERVER_STAMP].sort());
    const set = DB.writes[0].payload;
    expect(set.displayName).toBe("Acme Land");
    expect(set.updatedAt).toBeInstanceOf(Date);
  });

  it("PATCH /investors/me (existing profile): the write holds exactly the editable fields plus the server's timestamp", async () => {
    DB.selectQueue.push([{ id: 1 }]);
    const res = await request(app()).patch("/api/marketplace/investors/me").send(HOSTILE_BODY);
    expect(res.status).toBe(200);
    expect(DB.writes.length).toBeGreaterThan(0);
    expect(writtenKeys()).toEqual([...EDITABLE, ...SERVER_STAMP].sort());
  });

  it("PATCH /investors/me (no profile yet): the default row is the server's, and the edit is still editable-only", async () => {
    DB.selectQueue.push([], [], [{ id: VIEWER_ORG, name: "Acme" }]);
    const res = await request(app()).patch("/api/marketplace/investors/me").send(HOSTILE_BODY);
    expect(res.status).toBe(200);
    const inserted = DB.writes.find((w) => w.op === "values")!.payload;
    expect(inserted.organizationId).toBe(VIEWER_ORG);
    expect(inserted.isVerified).toBe(false);
    const updates = DB.writes.filter((w) => w.op === "set").flatMap((w) => Object.keys(w.payload));
    expect([...new Set(updates)].sort()).toEqual([...EDITABLE, ...SERVER_STAMP].sort());
  });

  it("the service method itself writes no platform-owned column, whatever its caller hands it", async () => {
    await marketplaceService.updateInvestorProfile(VIEWER_ORG, HOSTILE_BODY as never);
    expect(writtenKeys()).toEqual([...EDITABLE, ...SERVER_STAMP].sort());
  });

  it("a body that is not an object yields no edit", () => {
    expect(investorProfileEdits(null)).toEqual({});
    expect(investorProfileEdits([1, 2])).toEqual({});
    expect(investorProfileEdits("displayName")).toEqual({});
  });
});
