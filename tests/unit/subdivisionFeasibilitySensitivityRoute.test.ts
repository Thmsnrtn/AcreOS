/**
 * POST /api/scenarios/subdivision-feasibility/sensitivity (server/routes-scenarios.ts).
 * Pins: an org is required; bad inputs map to 400 / 422 with the engine's
 * reason; the grid is exactly feasibilitySensitivity over the wire inputs; the
 * route records nothing (the db stub has no write methods — any write throws).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import router from "../../server/routes-scenarios";
import { feasibilitySensitivity } from "../../shared/subdivision/feasibility";
import { feasibilityInputsFromWire } from "../../server/services/economics/engines/subdivisionFeasibility";

const PATH = "/subdivision-feasibility/sensitivity";
const layer = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack.find(
  (l) => l.route?.path === PATH && l.route.methods.post,
)!;

async function call(body: unknown, org: number | null = 7) {
  const req: any = { body, organizationId: org ?? undefined, organization: org ? { id: org } : undefined };
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  await layer.route!.stack[0].handle(req, res, () => undefined);
  return res;
}

const WIRE = {
  landCostCents: 10_000_000, lotCount: 10, grossProceedsCents: 40_000_000, absorptionLotsPerMonth: 5, wastewater: "septic",
  gradingCents: 2_000_000, roadsCents: 5_000_000, waterCents: 1_000_000, septicCents: 3_000_000, stormwaterCents: 500_000, utilitiesCents: 1_500_000, landscapingCents: 0,
  engineeringSurveyCents: 1_200_000, legalCents: 300_000, permittingFeesCents: 1_000_000, financingCents: 0, marketingCents: 2_000_000, contingencyCents: 500_000,
  timelineP50Days: 60, timelineP90Days: 90, holdingCostMonthlyCents: 100_000,
};

describe("POST /api/scenarios/subdivision-feasibility/sensitivity", () => {
  it("is mounted on the scenarios router", () => {
    expect(layer).toBeDefined();
  });

  it("returns exactly the pure grid over the wire inputs, with the engine version", async () => {
    const res = await call({ inputs: WIRE });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ engineVersion: "subdivision-feasibility v1", cells: feasibilitySensitivity(feasibilityInputsFromWire(WIRE)) });
  });

  it("an engine refusal is a 400 naming it; a malformed body is a 422", async () => {
    const bad = await call({ inputs: { ...WIRE, sewerCents: 1 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.body.message).toMatch(/not applicable/);
    expect((await call({ inputs: { ...WIRE, sneaky: 1 } })).statusCode).toBe(400);
    expect((await call({ nope: true })).statusCode).toBe(422);
  });

  it("no organization: refused (500 from getOrganizationId's throw is mapped to an error, never a grid)", async () => {
    const res = await call({ inputs: WIRE }, null);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.body?.cells).toBeUndefined();
  });
});
