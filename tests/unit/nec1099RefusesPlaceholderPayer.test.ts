/**
 * P1 false-claims sweep — a 1099-NEC is never printed with a placeholder payer.
 *
 * POST /api/contractors/1099-nec-batch filled the payer block with
 * "(payer address not configured)" / "—" and a "—" TIN whenever the org had
 * no tax address / EIN on file — and the organizations table carries neither,
 * so every generated form had a placeholder payer. This drives the REAL route
 * against an org without payer details: it must refuse before generating a
 * single PDF, and with full details it must generate with the real payer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => ({
  org: {} as Record<string, unknown>,
  execute: vi.fn(),
  generate: vi.fn(() => Buffer.from("%PDF")),
}));

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [h.org] }) }),
    execute: h.execute,
  },
}));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization: unknown; user: unknown }, _s: unknown, n: () => void) => {
    req.organization = { id: 7, ...h.org };
    req.user = { id: "u1" };
    n();
  },
}));
vi.mock("../../server/middleware/roleGuard", () => ({ requireRole: () => (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/services/form1099NecPdf", () => ({ generate1099NecPdf: h.generate }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerContractorRoutes } from "../../server/routes-contractors";
import { NEC_THRESHOLD_CENTS } from "../../server/services/form1099NecPayer";

const CONTRACTOR_ROW = {
  id: "c1",
  name: "Marcus",
  legal_entity_name: "Marcus Construction LLC",
  business_name: null,
  email: null,
  address: { line1: "9 Oak St", city: "Austin", state: "TX", zip: "78701" },
  tax_id_encrypted: "123456789",
  tax_id_type: "ein",
  total_cents: 150000,
};

function app() {
  const a = express();
  a.use(express.json());
  registerContractorRoutes(a);
  return a;
}

beforeEach(() => {
  h.execute.mockReset();
  h.execute.mockResolvedValue({ rows: [CONTRACTOR_ROW] });
  h.generate.mockClear();
});

describe("1099-NEC batch payer details", () => {
  for (const [label, org] of [
    ["no tax address or EIN (the shape of every org today)", { name: "Acre Holdings" }],
    ["an address but no EIN", { name: "Acre Holdings", taxAddress: { line1: "1 Main", city: "Austin", state: "TX", zip: "78701" } }],
    ["an EIN but a partial address", { name: "Acre Holdings", ein: "12-3456789", taxAddress: { line1: "1 Main" } }],
  ] as const) {
    it(`refuses with ${label}, generating nothing`, async () => {
      h.org = { ...org };
      const res = await request(app()).post("/api/contractors/1099-nec-batch?taxYear=2025").send({});
      expect(res.status).toBe(400);
      expect(res.body.details?.reason).toBe("payer_details_missing");
      expect(h.generate).not.toHaveBeenCalled();
      expect(JSON.stringify(res.body)).not.toMatch(/payer address not configured/);
    });
  }

  it("generates with the real payer when name, address and EIN are on file", async () => {
    h.org = { name: "Acre Holdings", ein: "12-3456789", taxAddress: { line1: "1 Main", city: "Austin", state: "TX", zip: "78701" } };
    const res = await request(app()).post("/api/contractors/1099-nec-batch?taxYear=2025").send({});
    expect(res.status).toBe(200);
    expect(res.body.formCount).toBe(1);
    const form = (h.generate.mock.calls[0] as unknown as [{ payer: { address: { line1: string }; taxIdMasked: string } }])[0];
    expect(form.payer.address.line1).toBe("1 Main");
    expect(form.payer.taxIdMasked).toBe("XX-XXX6789");
    // The threshold is unchanged and flagged for the K13 tax reviewer.
    expect(NEC_THRESHOLD_CENTS).toBe(60000);
    expect(res.body.thresholdNote).toMatch(/not been confirmed/);
  });
});
