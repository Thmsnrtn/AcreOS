/**
 * Land status: the refusal says only what is known, and only real statuses
 * are stored.
 *
 * ── THE DEFECTS ─────────────────────────────────────────────────────────────
 *   1. `LandStatusBlockError` said "Federal trust property — title transfers
 *      require BIA approval" for EVERY non-fee parcel. The default status is
 *      "unknown", so the first automation a customer ran against a parcel
 *      nobody had looked at told them it was federal trust land — a legal
 *      characterisation the system had no basis for. Restricted-fee and
 *      fee-within-reservation parcels got the same trust sentence.
 *   2. `PUT /api/properties/:id` validated with drizzle-zod's insert schema,
 *      which types the free-text `land_status` column as any string, so a
 *      typo — or "fee " with a trailing space — was stored as the parcel's
 *      land status. POST and bulk-update were unvalidated as well, and so was every
 *      non-route writer that reaches the repository (workflow `update_record`).
 *
 * ── WHAT IS NOT CHANGED ─────────────────────────────────────────────────────
 * The safety gate: only `fee` unblocks automation. Pinned below for every
 * status, so splitting the messages cannot have loosened it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { LAND_STATUS_VALUES } from "@shared/schema";
import { landStatusCategory, landStatusHoldReason } from "@shared/land-status-copy";
import {
  LandStatusBlockError,
  InvalidLandStatusError,
  assertFeeSimpleOrThrow,
  assertWritableLandStatus,
} from "../../server/utils/landStatus";
import { Errors } from "../../server/utils/errors";

const ROOT = path.resolve(__dirname, "../..");
const TRUST_CLAIM = /federal trust/i;

function blockMessage(status: string | null | undefined): string {
  try {
    assertFeeSimpleOrThrow({ landStatus: status }, "valuation");
  } catch (e) {
    expect(e).toBeInstanceOf(LandStatusBlockError);
    return (e as Error).message;
  }
  throw new Error(`status ${String(status)} was NOT blocked`);
}

describe("the gate is unchanged: only fee unblocks", () => {
  it.each(LAND_STATUS_VALUES.filter((s) => s !== "fee"))("%s is blocked", (status) => {
    expect(() => assertFeeSimpleOrThrow({ landStatus: status }, "valuation")).toThrow(LandStatusBlockError);
  });
  it("fee passes; missing / null / unrecognised values are blocked", () => {
    expect(() => assertFeeSimpleOrThrow({ landStatus: "fee" }, "valuation")).not.toThrow();
    for (const v of [undefined, null, "", "fee ", "FEE", "garbage"]) {
      expect(() => assertFeeSimpleOrThrow({ landStatus: v }, "valuation")).toThrow(LandStatusBlockError);
    }
    expect(() => assertFeeSimpleOrThrow(null, "valuation")).toThrow(LandStatusBlockError);
  });
});

describe("the refusal describes the status it actually has", () => {
  it("an unverified parcel is never called trust property", () => {
    for (const v of ["unknown", undefined, null, "garbage", "fee "]) {
      const msg = blockMessage(v);
      expect(msg, `${String(v)}: claimed trust status for a parcel nobody verified`).not.toMatch(TRUST_CLAIM);
      expect(msg).toMatch(/hasn't been verified/);
    }
  });

  it("trust statuses say trust", () => {
    for (const v of ["tribal_trust", "individual_trust", "off_reservation_trust"]) {
      expect(blockMessage(v)).toMatch(TRUST_CLAIM);
    }
  });

  it("restricted-fee and fee-within-reservation get their own words, not the trust sentence", () => {
    expect(blockMessage("restricted_fee")).toMatch(/Restricted-fee land/);
    expect(blockMessage("restricted_fee")).not.toMatch(TRUST_CLAIM);
    expect(blockMessage("fee_within_reservation")).toMatch(/inside reservation boundaries/);
    expect(blockMessage("fee_within_reservation")).not.toMatch(TRUST_CLAIM);
  });

  it("population: every schema status has a category, and only fee maps to fee", () => {
    // The shared copy module may not import @shared/schema (client bundle), so
    // it matches status strings itself. Pin them to the schema's list.
    const categories = new Set(LAND_STATUS_VALUES.map((s) => landStatusCategory(s)));
    expect([...categories].sort()).toEqual(
      ["fee", "fee_within_reservation", "restricted_fee", "trust", "unverified"],
    );
    for (const s of LAND_STATUS_VALUES) {
      if (s !== "fee") expect(landStatusCategory(s), s).not.toBe("fee");
    }
    expect(landStatusCategory("unknown")).toBe("unverified");
    // The parcel page renders the same sentence the server refuses with.
    const page = stripComments(fs.readFileSync(path.join(ROOT, "client/src/pages/parcel-detail.tsx"), "utf8"));
    expect(page).toContain("landStatusHoldReason(category)");
    expect(page).not.toMatch(/Federal trust property — title transfers/);
    expect(landStatusHoldReason("trust")).toMatch(TRUST_CLAIM);
  });
});

describe("writes: only a real land status is stored", () => {
  it("the write check refuses a non-status and accepts every real one", () => {
    expect(() => assertWritableLandStatus({ landStatus: "garbage" })).toThrow(InvalidLandStatusError);
    expect(() => assertWritableLandStatus({ landStatus: null })).toThrow(InvalidLandStatusError);
    expect(() => assertWritableLandStatus({ landStatus: "fee " })).toThrow(InvalidLandStatusError);
    for (const s of LAND_STATUS_VALUES) expect(() => assertWritableLandStatus({ landStatus: s })).not.toThrow();
    expect(() => assertWritableLandStatus({ status: "owned" } as never)).not.toThrow();
  });

  it("Errors.internal turns the write refusal into a 400 with the allowed values", () => {
    const res: any = { statusCode: 0, body: null, status(c: number) { res.statusCode = c; return res; }, json(b: unknown) { res.body = b; return res; }, getHeader: () => undefined };
    Errors.internal(res, new InvalidLandStatusError("garbage"));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("INVALID_LAND_STATUS");
    expect(res.body.message).toContain("tribal_trust");
  });
});

// ── The repository chokepoint, for real ────────────────────────────────────

const h = vi.hoisted(() => ({
  writes: [] as string[],
  storage: {
    getProperty: vi.fn(async () => ({ id: 3, organizationId: 7, status: "owned", landStatus: "unknown" })),
    updateProperty: vi.fn(async (_id: number, u: Record<string, unknown>) => ({ id: 3, organizationId: 7, status: "owned", ...u })),
    createProperty: vi.fn(async (p: Record<string, unknown>) => ({ id: 4, ...p })),
    bulkUpdateProperties: vi.fn(async () => 2),
    createAuditLogEntry: vi.fn(async () => undefined),
  },
}));

vi.mock("../../server/db", () => {
  const chain = (kind: string) => {
    h.writes.push(kind);
    const q: Record<string, unknown> = {};
    q.values = () => q;
    q.set = () => q;
    q.where = () => q;
    q.returning = async () => [{ id: 1, organizationId: 7, status: "owned" }];
    return q;
  };
  return { db: { insert: () => chain("insert"), update: () => chain("update") } };
});

import { propertyRepo } from "../../server/storage/propertyRepo";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

describe("the repository refuses before it writes", () => {
  beforeEach(() => {
    h.writes.length = 0;
  });
  const self = { logActivity: async () => undefined } as never;

  it("createProperty / updateProperty / bulkUpdateProperties never reach the table with a non-status", async () => {
    await expect(
      propertyRepo.createProperty.call(self, { organizationId: 7, apn: "1", county: "C", state: "TX", sizeAcres: "1", landStatus: "garbage" } as never),
    ).rejects.toBeInstanceOf(InvalidLandStatusError);
    await expect(propertyRepo.updateProperty.call(self, 3, { landStatus: "garbage" } as never, 7)).rejects.toBeInstanceOf(
      InvalidLandStatusError,
    );
    await expect(propertyRepo.bulkUpdateProperties.call(self, 7, [3], { landStatus: "garbage" } as never)).rejects.toBeInstanceOf(
      InvalidLandStatusError,
    );
    expect(h.writes, "a write reached the table before the check").toEqual([]);
  });

  it("a real status goes through", async () => {
    await propertyRepo.updateProperty.call(self, 3, { landStatus: "restricted_fee" } as never, 7);
    expect(h.writes).toEqual(["update"]);
  });
});

// ── The routes, for real ───────────────────────────────────────────────────

async function app() {
  vi.resetModules();
  vi.doMock("../../server/auth", () => ({ isAuthenticated: (req: any, _s: unknown, n: () => void) => { req.user = { id: "u1" }; n(); } }));
  vi.doMock("../../server/middleware/getOrCreateOrg", () => ({
    getOrCreateOrg: (req: any, _s: unknown, n: () => void) => {
      req.organization = { id: 7, subscriptionTier: "pro" };
      n();
    },
  }));
  vi.doMock("../../server/storage", () => ({ storage: h.storage, db: {} }));
  vi.doMock("../../server/services/usageLimits", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("../../server/services/usageLimits");
    return { ...actual, checkUsageLimit: async () => ({ allowed: true, current: 0, limit: null, resourceType: "properties", tier: "pro" }) };
  });
  const { registerPropertyRoutes } = await import("../../server/routes-properties");
  const a = express();
  a.use(express.json());
  registerPropertyRoutes(a);
  return a;
}

describe("POST / PUT / bulk-update validate landStatus against landStatusSchema", () => {
  beforeEach(() => {
    for (const fn of Object.values(h.storage)) fn.mockClear();
  });

  it("PUT /api/properties/:id refuses a string that is not a status, and stores nothing", async () => {
    const res = await request(await app()).put("/api/properties/3").send({ landStatus: "federal-ish" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.details)).toContain("landStatus");
    expect(h.storage.updateProperty).not.toHaveBeenCalled();
  });

  it("PUT accepts a real status", async () => {
    const res = await request(await app()).put("/api/properties/3").send({ landStatus: "tribal_trust" });
    expect(res.status).toBe(200);
    expect(h.storage.updateProperty).toHaveBeenCalledWith(3, expect.objectContaining({ landStatus: "tribal_trust" }), 7);
  });

  it("POST /api/properties refuses a non-status before creating", async () => {
    const res = await request(await app())
      .post("/api/properties")
      .send({ apn: "1-2-3", county: "Bastrop", state: "TX", sizeAcres: "5", landStatus: "fee " });
    expect(res.status).toBe(400);
    expect(h.storage.createProperty).not.toHaveBeenCalled();
  });

  it("bulk-update refuses a non-status before writing any row", async () => {
    const res = await request(await app())
      .post("/api/properties/bulk-update")
      .send({ ids: [3, 4], updates: { landStatus: "garbage" } });
    expect(res.status).toBe(400);
    expect(h.storage.bulkUpdateProperties).not.toHaveBeenCalled();
  });
});

// ── Population: every direct writer of the properties table ─────────────────

describe("population: writers that bypass the repository cannot store an arbitrary status", () => {
  /**
   * Every non-repository `.insert(properties)` / `.update(properties)` in
   * server/, with why it cannot carry a caller-supplied land status. Derived
   * and compared, so a new direct writer fails here until it is classified.
   */
  const DIRECT_WRITERS: Record<string, "names-no-land-status" | "folds-to-real-status"> = {
    "server/routes-subdivisions.ts": "folds-to-real-status",
    "server/jobs/featureEngineeringJob.ts": "names-no-land-status",
    "server/routes-lot-basis.ts": "names-no-land-status",
    "server/services/dueDiligence.ts": "names-no-land-status",
    "server/routes-lot-pricing.ts": "names-no-land-status",
    "server/routes-bulk.ts": "names-no-land-status",
    "server/api-v1/properties.ts": "names-no-land-status",
    // server/services/import.ts was deleted as unreferenced (#328).
  };

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
    }
    return out;
  }
  const WRITE = /\.(insert|update)\(\s*properties\s*\)/;
  const found = walk(path.join(ROOT, "server"))
    .map((abs) => ({ rel: path.relative(ROOT, abs).split(path.sep).join("/"), src: stripComments(fs.readFileSync(abs, "utf8")) }))
    .filter(({ src }) => WRITE.test(src))
    .filter(({ rel }) => rel !== "server/storage/propertyRepo.ts");

  it("the derived set of direct writers is exactly the classified set", () => {
    expect(found.length, "vacuity: no direct writer found — the scan went blind").toBeGreaterThanOrEqual(5);
    expect(found.map((f) => f.rel).sort()).toEqual(Object.keys(DIRECT_WRITERS).sort());
  });

  it("each direct writer holds its classification", () => {
    for (const { rel, src } of found) {
      if (DIRECT_WRITERS[rel] === "names-no-land-status") {
        expect(/\blandStatus\b/.test(src), `${rel} now names landStatus — route it through the repository or validate it`).toBe(false);
      } else {
        expect(src, `${rel} copies a land status without checking it is one`).toContain("landStatusSchema.safeParse(");
      }
    }
  });

  it("the repository's writers all run the check", () => {
    const repo = stripComments(fs.readFileSync(path.join(ROOT, "server/storage/propertyRepo.ts"), "utf8"));
    expect(repo.match(/assertWritableLandStatus\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
