/**
 * PX-7 — PATCH /api/pax/controls { mySites } and GET /api/pax/controls, through
 * the real route handlers (the router's own layers are called with a stub
 * request/response; the database write is captured, never performed).
 *
 *   - the list is a FULL replacement: hosts normalised (case, one trailing dot),
 *     labels trimmed, duplicates by host dropped (first wins);
 *   - a host that is not a bare public host is 422 and NOTHING is written —
 *     never silently rewritten into a different host;
 *   - more than 50 entries, an extra key, a wrong type: 422, nothing written;
 *   - omitting `mySites` keeps the stored list, and the other stored keys
 *     (stance, switches, rails) ride along unchanged — the write is the whole
 *     column, so a dropped key would be a silent reset;
 *   - a non-admin is refused 403 and nothing is written;
 *   - GET returns the list.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  set: vi.fn((_v: Record<string, unknown>) => undefined as unknown),
  update: vi.fn(),
  current: { mySites: [] as Array<{ host: string; label: string }> },
}));

vi.mock("../../server/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit", "groupBy"]) chain[m] = vi.fn(() => chain);
  chain.then = (onFulfilled: (rows: unknown) => unknown, onRejected?: (e: unknown) => unknown) => Promise.resolve([]).then(onFulfilled, onRejected);
  return {
    db: {
      select: vi.fn(() => chain),
      update: (...a: unknown[]) => {
        H.update(...a);
        return {
          set: (v: Record<string, unknown>) => {
            H.set(v);
            return { where: async () => undefined };
          },
        };
      },
    },
  };
});
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/paxControls", async () => {
  const shared = await import("../../shared/pax-controls");
  return {
    getPaxControls: vi.fn(async () => ({
      stance: "ask_before_everything",
      leadScoring: false,
      borrowerReminders: true,
      inboxDrafts: true,
      rails: { ...shared.defaultPaxRails(), sends: "draft" },
      mySites: H.current.mySites,
      paused: false,
      pausedUntil: null,
      pausedBy: null,
      checkFailed: false,
      timezone: "America/Chicago",
    })),
  };
});
vi.mock("../../server/services/approvalKernel", () => ({ countPendingActions: vi.fn(async () => 0) }));
vi.mock("../../server/services/paxReceipts", () => ({ recordPaxEffect: vi.fn(async () => ({ written: true })) }));
vi.mock("../../server/services/paxReceiptsReader", () => ({ listPaxReceipts: vi.fn(async () => ({ items: [], nextCursor: null })) }));
vi.mock("../../server/services/financeAgent", () => ({ REMINDER_STATUS: { awaitingApproval: "awaiting_approval" } }));
vi.mock("../../server/utils/permissions", () => ({
  getUserPermissionContext: vi.fn(async () => null),
  isAdminOrAbove: vi.fn(() => false),
}));

import router from "../../server/routes-pax-controls";
import { PAX_MY_SITES_MAX } from "../../shared/pax-controls";

type Handler = (req: unknown, res: unknown) => Promise<unknown>;

function handlerFor(method: "get" | "patch", routePath: string): Handler {
  const stack = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> } }> }).stack;
  const layer = stack.find((l) => l.route?.path === routePath && l.route.methods[method]);
  if (!layer?.route) throw new Error(`no ${method.toUpperCase()} ${routePath} on the router`);
  return layer.route.stack[0].handle;
}

function stubRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

const req = (body: unknown, userId = "u-1") => ({
  body,
  query: {},
  organization: { id: 7, ownerId: "u-1" },
  user: { id: userId },
});

const patch = async (body: unknown, userId?: string) => {
  const res = stubRes();
  await handlerFor("patch", "/controls")(req(body, userId), res);
  return res;
};
const written = () => H.set.mock.calls.map((c) => (c[0] as { paxControls: Record<string, unknown> }).paxControls);

beforeEach(() => {
  vi.clearAllMocks();
  H.current.mySites = [];
});

describe("PATCH /controls { mySites }", () => {
  it("replaces the whole list: hosts normalised, labels trimmed, duplicates by host dropped", async () => {
    const res = await patch({
      mySites: [
        { host: "Assessor.Example.GOV.", label: "  Cochise assessor  " },
        { host: "assessor.example.gov", label: "duplicate" },
        { host: "recorder.example.gov", label: "Recorder" },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(written()).toHaveLength(1);
    expect(written()[0].mySites).toEqual([
      { host: "assessor.example.gov", label: "Cochise assessor" },
      { host: "recorder.example.gov", label: "Recorder" },
    ]);
    // the write is the WHOLE column: the stored stance, switches and rails ride along
    expect(written()[0]).toMatchObject({ stance: "ask_before_everything", leadScoring: false, borrowerReminders: true, inboxDrafts: true });
    expect((written()[0].rails as { sends: string }).sends).toBe("draft");
  });

  it("an empty list clears the sites", async () => {
    H.current.mySites = [{ host: "assessor.example.gov", label: "A" }];
    const res = await patch({ mySites: [] });
    expect(res.statusCode).toBe(200);
    expect(written()[0].mySites).toEqual([]);
  });

  it.each([
    ["a scheme", "https://assessor.example.gov"],
    ["a path", "assessor.example.gov/search"],
    ["credentials", "user:pw@assessor.example.gov"],
    ["a port", "assessor.example.gov:8443"],
    ["a wildcard", "*.example.gov"],
    ["an IPv4 address", "10.0.0.1"],
    ["an internal name", "localhost"],
    ["whitespace inside", "assessor example.gov"],
    ["nothing", ""],
  ])("refuses a host with %s (422) and writes nothing", async (_name, host) => {
    const res = await patch({ mySites: [{ host, label: "Assessor" }] });
    expect(res.statusCode).toBe(422);
    expect(H.set).not.toHaveBeenCalled();
  });

  it("refuses an over-long list, an extra key, an empty label and wrong types (422), writing nothing", async () => {
    const tooMany = Array.from({ length: PAX_MY_SITES_MAX + 1 }, (_, i) => ({ host: `s${i}.example.gov`, label: `S${i}` }));
    for (const body of [
      { mySites: tooMany },
      { mySites: [{ host: "assessor.example.gov", label: "A", path: "/search" }] },
      { mySites: [{ host: "assessor.example.gov", label: "   " }] },
      { mySites: [{ host: "assessor.example.gov", label: "x".repeat(61) }] },
      { mySites: [{ host: 5, label: "A" }] },
      { mySites: ["assessor.example.gov"] },
      { mySites: "assessor.example.gov" },
      { mySites: null },
      { sites: [{ host: "assessor.example.gov", label: "A" }] },
    ]) {
      const res = await patch(body);
      expect(res.statusCode, JSON.stringify(body).slice(0, 80)).toBe(422);
    }
    expect(H.set).not.toHaveBeenCalled();
  });

  it("accepts exactly the cap", async () => {
    const full = Array.from({ length: PAX_MY_SITES_MAX }, (_, i) => ({ host: `s${i}.example.gov`, label: `S${i}` }));
    const res = await patch({ mySites: full });
    expect(res.statusCode).toBe(200);
    expect((written()[0].mySites as unknown[]).length).toBe(PAX_MY_SITES_MAX);
  });

  it("a PATCH that omits mySites keeps the stored list", async () => {
    H.current.mySites = [{ host: "assessor.example.gov", label: "Assessor" }];
    const res = await patch({ leadScoring: true });
    expect(res.statusCode).toBe(200);
    expect(written()[0].mySites).toEqual([{ host: "assessor.example.gov", label: "Assessor" }]);
    expect(written()[0].leadScoring).toBe(true);
  });

  it("a member (not an owner or admin) is refused and nothing is written", async () => {
    const res = await patch({ mySites: [{ host: "assessor.example.gov", label: "A" }] }, "u-2");
    expect(res.statusCode).toBe(403);
    expect(H.set).not.toHaveBeenCalled();
  });
});

describe("GET /controls", () => {
  it("returns the org's sites (an empty list when none are listed)", async () => {
    H.current.mySites = [{ host: "assessor.example.gov", label: "Assessor" }];
    const res = stubRes();
    await handlerFor("get", "/controls")(req(undefined), res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { mySites: unknown }).mySites).toEqual([{ host: "assessor.example.gov", label: "Assessor" }]);

    H.current.mySites = [];
    const empty = stubRes();
    await handlerFor("get", "/controls")(req(undefined), empty);
    expect((empty.body as { mySites: unknown }).mySites).toEqual([]);
  });
});
