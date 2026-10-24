/**
 * P1 false-claims sweep — a 1099-NEC is never printed with a placeholder payer.
 *
 * POST /api/contractors/1099-nec-batch filled the payer block with
 * "(payer address not configured)" / "—" and a "—" TIN whenever the org had
 * no tax address / EIN on file. This drives the REAL route against an org
 * without payer details: it must refuse before generating a single PDF, and
 * with full details it must generate with the real payer.
 *
 * The org fixture stores the payer TIN the way production does —
 * organizations.ein holds a fieldEncryption ENVELOPE produced by the real
 * encrypt() (PATCH /api/organization/tax-identity writes `ein: cipher`). The
 * first version of this test stored plaintext "12-3456789", which hid that
 * the resolver stripped non-digits from ciphertext: every correctly-stored
 * org was refused as "TIN not on file".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => {
  // Deterministic key for the real fieldEncryption module.
  process.env.FIELD_ENCRYPTION_KEY = "a".repeat(64);
  return {
  org: {} as Record<string, unknown>,
  execute: vi.fn(),
  generate: vi.fn(() => Buffer.from("%PDF")),
  };
});

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
import { encrypt, isEncrypted } from "../../server/services/fieldEncryption";

const ADDRESS = { line1: "1 Main", city: "Austin", state: "TX", zip: "78701" };
const EIN_CIPHER = encrypt("12-3456789");

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

type PayerForm = { payer: { name: string; address: { line1: string }; taxIdMasked: string } };
const firstForm = () => (h.generate.mock.calls[0] as unknown as [PayerForm])[0];

async function post() {
  return request(app()).post("/api/contractors/1099-nec-batch?taxYear=2025").send({});
}

describe("1099-NEC batch payer details", () => {
  it("the fixture TIN is a real encrypted envelope, not plaintext", () => {
    expect(isEncrypted(EIN_CIPHER)).toBe(true);
    expect(EIN_CIPHER).not.toContain("3456789");
  });

  for (const [label, org, missingTin, missingAddress] of [
    ["no tax address or EIN", { name: "Acre Holdings" }, true, true],
    ["an address but no EIN", { name: "Acre Holdings", taxAddress: ADDRESS }, true, false],
    ["an encrypted EIN but a partial address", { name: "Acre Holdings", ein: EIN_CIPHER, taxAddress: { line1: "1 Main" } }, false, true],
    ["an encrypted EIN but no address at all", { name: "Acre Holdings", ein: EIN_CIPHER, taxIdType: "EIN" }, false, true],
    ["an encrypted PLACEHOLDER EIN", { name: "Acre Holdings", ein: encrypt("00-0000000"), taxIdType: "EIN", taxAddress: ADDRESS }, true, false],
    ["an envelope that does not decrypt", { name: "Acre Holdings", ein: "enc:v1:" + Buffer.from("{}").toString("base64"), taxAddress: ADDRESS }, true, false],
  ] as const) {
    it(`refuses with ${label}, generating nothing`, async () => {
      h.org = { ...org };
      const res = await post();
      expect(res.status).toBe(400);
      expect(res.body.details?.reason).toBe("payer_details_missing");
      const missing: string[] = res.body.details?.missing ?? [];
      expect(missing.some((m) => /payer TIN/.test(m))).toBe(missingTin);
      expect(missing.some((m) => /payer address/.test(m))).toBe(missingAddress);
      expect(h.generate).not.toHaveBeenCalled();
      expect(JSON.stringify(res.body)).not.toMatch(/payer address not configured/);
    });
  }

  it("generates with the real payer when name, address and an ENCRYPTED EIN are on file", async () => {
    h.org = { name: "Acre Holdings", legalEntityName: "Acre Holdings LLC", ein: EIN_CIPHER, taxIdType: "EIN", taxAddress: ADDRESS };
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.formCount).toBe(1);
    const form = firstForm();
    expect(form.payer.name).toBe("Acre Holdings LLC");
    expect(form.payer.address.line1).toBe("1 Main");
    expect(form.payer.taxIdMasked).toBe("XX-XXX6789");
    // Ciphertext never reaches the form or the response.
    expect(JSON.stringify(form)).not.toContain(EIN_CIPHER);
    expect(JSON.stringify(res.body)).not.toContain(EIN_CIPHER);
    // The threshold is unchanged and flagged for the K13 tax reviewer.
    expect(NEC_THRESHOLD_CENTS).toBe(60000);
    expect(res.body.thresholdNote).toMatch(/not been confirmed/);
  });

  it("masks an SSN payer as an SSN, not an EIN", async () => {
    h.org = { name: "Jane Doe", ein: encrypt("123-45-6789"), taxIdType: "SSN", taxAddress: ADDRESS };
    const res = await post();
    expect(res.status).toBe(200);
    expect(firstForm().payer.taxIdMasked).toBe("XXX-XX-6789");
  });
});
