/**
 * W10.3 — ONE county status vocabulary (shared/geo/countyStatus.ts), adopted
 * by the coverage route's resolveStatus as well as the list builder.
 *
 * Driven through GET /api/county-coverage/status with the reads stubbed, so
 * what is asserted is what the route actually answers — not the shared
 * helper's answer to its own inputs. Before this, an unreviewed county read
 * "covered" here while the list builder could not save it, and the route's
 * declared union named a `pending` it never returned.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { getTableName } from "drizzle-orm";
import {
  COUNTY_LIST_STATUSES,
  COUNTY_SOURCE_WENT_DARK_MESSAGE,
  COUNTY_STATUS_COPY,
  countyLiveSourceCopy,
  countyQueueStatusCopy,
  countyStatusForLiveSource,
} from "@shared/geo/countyStatus";

const H = vi.hoisted(() => ({
  endpoints: [] as Array<{ id: number; redistributable: string | null }>,
  queue: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth/clerkAuth", () => ({ isAuthenticated: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown; user?: unknown }, _s: unknown, n: () => void) => {
    req.organization = { id: 7 };
    req.user = { id: "u1" };
    n();
  },
}));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/db-replica", () => ({
  dbForReads: async () => ({
    select: () => {
      let table = "";
      const chain: Record<string, unknown> = {
        from: (t: Parameters<typeof getTableName>[0]) => ((table = getTableName(t)), chain),
        where: () => chain,
        limit: () => chain,
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve(table === "county_gis_endpoints" ? H.endpoints : table === "county_discovery_queue" ? H.queue : []).then(res),
      };
      return chain;
    },
  }),
}));

const { registerCountyCoverageRoutes } = await import("../../server/routes-county-coverage");
const app = express();
app.use(express.json());
registerCountyCoverageRoutes(app);

const status = async () => (await request(app).get("/api/county-coverage/status?state=TX&county=Harris")).body;

beforeEach(() => {
  H.endpoints = [];
  H.queue = [];
});

describe("resolveStatus speaks the shared vocabulary", () => {
  it("an active source whose licence is unreviewed is VIEW ONLY, not covered", async () => {
    H.endpoints = [{ id: 1, redistributable: "review-required" }];
    const b = await status();
    expect(b.status).toBe("view_only");
    expect(b.covered).toBe(true); // lookups still answer; saving does not
    expect(b.message).toBe(COUNTY_STATUS_COPY.view_only.message);
    expect(b.label).toBe(COUNTY_STATUS_COPY.view_only.label);
  });

  it("a source the founder REVIEWED and marked 'no' is view only — and says it was reviewed, not that it is pending review", async () => {
    // W10.3 second audit, finding 4: 'no' fell into the view_only copy, which
    // tells the customer the terms "haven't been reviewed yet" — false for a
    // county whose terms were read and declined.
    H.endpoints = [{ id: 1, redistributable: "no" }];
    const b = await status();
    expect(b.status).toBe("view_only");
    expect(b.message).toBe(countyLiveSourceCopy(["no"]).message);
    expect(b.message).toMatch(/were reviewed and don't permit saving/);
    expect(b.message).not.toMatch(/haven't been reviewed/);
    // One unreviewed source alongside it: the county is still pending review.
    H.endpoints = [{ id: 1, redistributable: "no" }, { id: 2, redistributable: "review-required" }];
    expect((await status()).message).toBe(COUNTY_STATUS_COPY.view_only.message);
  });

  it("an active source with a saveable licence is covered", async () => {
    H.endpoints = [{ id: 1, redistributable: "review-required" }, { id: 2, redistributable: "attribution" }];
    expect((await status()).status).toBe("covered");
  });

  it("requested but never searched is queued; searched-and-retrying is discovering", async () => {
    H.queue = [{ id: 9, status: "pending", attempts: 0, demandCount: 3 }];
    expect(await status()).toMatchObject({ status: "queued", covered: false, queueId: 9, demandCount: 3 });
    H.queue = [{ id: 9, status: "pending", attempts: 2, demandCount: 3 }];
    expect((await status()).status).toBe("discovering");
    H.queue = [{ id: 9, status: "in_progress", attempts: 1, demandCount: 3 }];
    expect((await status()).status).toBe("discovering");
  });

  it("exhausted and gone-dark are unavailable; never requested is none", async () => {
    H.queue = [{ id: 9, status: "exhausted", attempts: 5, demandCount: 1 }];
    expect((await status()).status).toBe("unavailable");
    H.queue = [{ id: 9, status: "resolved", attempts: 1, demandCount: 1 }];
    const dark = await status();
    expect(dark.status).toBe("unavailable");
    expect(dark.message).toMatch(/no longer responding/);
    // The list builder speaks the shared sentence (countyQueueStatusCopy); the
    // coverage route must say the SAME words, so a county never reads
    // differently on the two surfaces.
    expect(dark.message).toBe(COUNTY_SOURCE_WENT_DARK_MESSAGE);
    H.queue = [];
    expect((await status()).status).toBe("none");
  });

  it("every status the route can return is in the vocabulary — `pending` is not", async () => {
    const seen = new Set<string>();
    const cases: Array<() => void> = [
      () => { H.endpoints = [{ id: 1, redistributable: null }]; H.queue = []; },
      () => { H.endpoints = [{ id: 1, redistributable: "yes" }]; },
      ...["pending", "in_progress", "failed", "resolved", "exhausted", "weird"].map((s) => () => {
        H.endpoints = [];
        H.queue = [{ id: 1, status: s, attempts: 0, demandCount: 1 }];
      }),
      () => { H.endpoints = []; H.queue = []; },
    ];
    for (const set of cases) {
      set();
      seen.add((await status()).status);
    }
    for (const s of seen) expect(COUNTY_LIST_STATUSES).toContain(s);
    expect(seen.has("pending")).toBe(false);
    expect([...seen].sort()).toEqual([...COUNTY_LIST_STATUSES].sort());
  });
});

describe("the shared mappings", () => {
  it("an unknown or missing licence is never read as permission", () => {
    for (const r of [null, undefined, "", "no", "review-required", "YES-ish"]) expect(countyStatusForLiveSource(r)).toBe("view_only");
    for (const r of ["yes", "attribution", " YES "]) expect(countyStatusForLiveSource(r)).toBe("covered");
  });
  it("an unknown queue status is never promoted to a source", () => {
    expect(countyQueueStatusCopy({ status: "mystery", attempts: 9 }).status).toBe("queued");
    expect(countyQueueStatusCopy(null).status).toBe("none");
  });
  it("countyQueueStatusCopy: a gone-dark source says so; every other status uses its own copy", () => {
    expect(countyQueueStatusCopy({ status: "resolved", attempts: 1 })).toEqual({
      status: "unavailable",
      label: COUNTY_STATUS_COPY.unavailable.label,
      message: COUNTY_SOURCE_WENT_DARK_MESSAGE,
    });
    expect(countyQueueStatusCopy({ status: "exhausted" }).message).toBe(COUNTY_STATUS_COPY.unavailable.message);
    for (const q of [null, { status: "pending", attempts: 0 }, { status: "in_progress" }]) {
      const c = countyQueueStatusCopy(q);
      expect(c.message).toBe(COUNTY_STATUS_COPY[c.status].message);
    }
  });

  it("every status has a label and a sentence", () => {
    for (const s of COUNTY_LIST_STATUSES) {
      expect(COUNTY_STATUS_COPY[s].label.length).toBeGreaterThan(2);
      expect(COUNTY_STATUS_COPY[s].message).toMatch(/\.$/);
    }
  });
});
