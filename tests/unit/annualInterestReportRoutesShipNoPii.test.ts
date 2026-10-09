/**
 * Both bookkeeping report routes ship the projected report, never the raw one.
 *
 * The service's annual interest report carries borrower contact and tax
 * fields that only the server-side 1099 path uses. Both routes that serve it —
 * GET /api/bookkeeping/annual-report (bookkeeping router) and
 * GET /api/bookkeeping/annual-interest-report (elite-features) — send
 * `projectAnnualInterestReport` through the shared contract.
 *
 * No database: the report is mocked with every PII field populated, and each
 * route's REAL registered handler is driven. The exact key set of the response
 * is asserted, so a field that rides along is caught by name.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const REPORT = vi.hoisted(() => ({
  taxYear: 2025,
  organizationId: 7,
  totalInterestIncome: 1234.56,
  totalPrincipalReceived: 10000,
  totalLateFeesCollected: 25.5,
  notesWith1099Required: 1,
  requires1099Note: "review flag",
  generatedAt: "2026-01-01T00:00:00.000Z",
  notes: [
    {
      noteId: 11,
      borrowerId: 3,
      borrowerName: "Ada Lovelace",
      borrowerEmail: "ada@example.com",
      borrowerAddress: { street: "12 Analytical Way", city: "Austin", state: "TX", zip: "78701" },
      borrowerTaxIdCiphertext: "v1:cipher",
      borrowerTaxIdType: "SSN",
      propertyAddress: "1 Ranch Rd",
      yearOpeningBalance: 50000,
      yearClosingBalance: 40000,
      principalCollected: 10000,
      interestCollected: 1234.56,
      lateFeeCollected: 25.5,
      paymentsCount: 3,
      requires1099: true,
    },
  ],
}));

vi.mock("../../server/services/bookkeeping", async (orig) => ({
  ...(await orig<typeof import("../../server/services/bookkeeping")>()),
  generateAnnualInterestReport: async () => structuredClone(REPORT),
}));

const TOP_KEYS = ["notes", "notesWith1099Required", "taxYear", "totalInterestIncome", "totalLateFeesCollected", "totalPrincipalReceived"];
const NOTE_KEYS = ["borrowerName", "interestCollected", "noteId", "principalCollected", "requires1099"];

function res() {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => ((r.statusCode = c), r);
  r.json = (b: unknown) => ((r.body = b), r);
  return r;
}
const req = { organization: { id: 7 }, query: { year: "2025" }, user: { id: "u" } };

function assertProjected(body: any) {
  expect(Object.keys(body).sort()).toEqual(TOP_KEYS);
  expect(body.notes).toHaveLength(1);
  expect(Object.keys(body.notes[0]).sort()).toEqual(NOTE_KEYS);
  const text = JSON.stringify(body);
  for (const leaked of ["v1:cipher", "Analytical Way", "ada@example.com", "SSN", "1 Ranch Rd"]) expect(text).not.toContain(leaked);
}

describe("bookkeeping report routes send no borrower PII", () => {
  it("GET /api/bookkeeping/annual-interest-report (elite-features)", async () => {
    const { registerEliteFeatureRoutes } = await import("../../server/routes-elite-features");
    const handlers: Record<string, (q: unknown, s: unknown) => Promise<unknown>> = {};
    const app: Record<string, unknown> = {};
    for (const m of ["get", "post", "patch", "put", "delete", "use"]) {
      app[m] = (path: string, ...args: unknown[]) => {
        if (typeof path === "string") handlers[`${m.toUpperCase()} ${path}`] = args[args.length - 1] as never;
      };
    }
    await registerEliteFeatureRoutes(app as never);
    const h = handlers["GET /api/bookkeeping/annual-interest-report"];
    expect(h, "route not registered").toBeDefined();
    const r = res();
    await h(req, r);
    expect(r.statusCode).toBe(200);
    assertProjected(r.body);
  });

  it("GET /api/bookkeeping/annual-report (bookkeeping router)", async () => {
    const router = (await import("../../server/routes-bookkeeping")).default as any;
    const layer = router.stack.find((l: any) => l.route?.path === "/annual-report" && l.route.methods.get);
    const r = res();
    await layer.route.stack[layer.route.stack.length - 1].handle(req, r);
    expect(r.statusCode).toBe(200);
    assertProjected(r.body);
  });
});
