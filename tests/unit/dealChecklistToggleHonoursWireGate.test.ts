/**
 * DEFECT-0176 — the deal page's checklist toggle writes the SAME row as the
 * closing checklist, so the wire interlock has to hold there too: a
 * one-click tick of the "fraud_gate" item is refused, and a complete
 * attestation is passed through to storage with who recorded it.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
  updateItem: vi.fn(async () => ({ items: [] })),
  refusal: vi.fn(async () => null as string | null),
  seal: vi.fn((_a: unknown, by: string | null) => ({ phoneNumber: "5550102030", numberSource: "website", spokeWith: "Dana", confirmedBy: by, confirmedAt: "t" })),
  stamp: vi.fn(async () => undefined),
  withdraw: vi.fn(async () => undefined),
  order: [] as string[],
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: { user?: unknown }, _r: unknown, n: () => void) => {
    req.user = { id: "user-a" };
    n();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown }, _r: unknown, n: () => void) => {
    req.organization = { id: 42 };
    n();
  },
}));
vi.mock("../../server/storage", () => ({
  storage: {
    getDeal: async (orgId: number, id: number) => (orgId === 42 && id === 4 ? { id: 4, organizationId: 42 } : undefined),
    getDealChecklist: async (orgId: number, dealId: number) => (orgId === 42 && dealId === 4 ? { id: 1, items: h.items } : undefined),
    updateDealChecklistItem: async (...a: unknown[]) => {
      h.order.push("write");
      return (h.updateItem as (...x: unknown[]) => unknown)(...a);
    },
  },
}));
vi.mock("../../server/services/closingEvidence", () => ({
  fraudGateRefusal: h.refusal,
  sealWireAttestation: h.seal,
  stampWireConfirmation: async (...a: unknown[]) => {
    h.order.push("stamp");
    return (h.stamp as (...x: unknown[]) => unknown)(...a);
  },
  withdrawWireConfirmation: h.withdraw,
}));
vi.mock("../../server/db", () => ({ db: {}, withTransaction: async (fn: (tx: unknown) => unknown) => fn({}) }));
vi.mock("../../server/services/leadScoring", () => ({ leadScoringService: {} }));
vi.mock("../../server/services/propertyEnrichment", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/services/usageLimits", () => ({ checkUsageLimit: vi.fn() }));
vi.mock("../../server/services/usury", () => ({ checkUsury: vi.fn() }));
vi.mock("../../server/services/dealHandoffService", () => ({
  getAllHandoffs: vi.fn(),
  getHandoffsForDeal: vi.fn(),
  initiateHandoff: vi.fn(),
  updateHandoffChecklist: vi.fn(),
  completeHandoff: vi.fn(),
}));

import { registerDealRoutes } from "../../server/routes-deals";

const WIRE = { id: "verify-wire-two-channel", category: "fraud_gate", required: true };
const ATTESTATION = { phoneNumber: "(555) 010-2030", numberSource: "website", spokeWith: "Dana" };
let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerDealRoutes(app);
});
beforeEach(() => {
  h.items = [{ ...WIRE }];
  h.updateItem.mockClear();
  h.refusal.mockReset();
  h.stamp.mockClear();
  h.seal.mockClear();
  h.withdraw.mockClear();
  h.order = [];
});

describe("PATCH /api/deals/:id/checklist/items/:itemId", () => {
  it("a refused tick writes nothing", async () => {
    h.refusal.mockResolvedValue("This is the wire-fraud step: record the phone number you called.");
    const res = await request(app).patch("/api/deals/4/checklist/items/verify-wire-two-channel").send({ checked: true });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/wire-fraud step/);
    expect(h.refusal).toHaveBeenCalledWith(42, 4, expect.objectContaining({ category: "fraud_gate" }), undefined);
    expect(h.updateItem).not.toHaveBeenCalled();
  });

  it("an attested tick is stamped and the stamp is what storage receives", async () => {
    h.refusal.mockResolvedValue(null);
    const res = await request(app)
      .patch("/api/deals/4/checklist/items/verify-wire-two-channel")
      .send({ checked: true, verification: ATTESTATION });
    expect(res.status).toBe(200);
    expect(h.seal).toHaveBeenCalledWith(ATTESTATION, "user-a");
    expect(h.stamp).toHaveBeenCalledWith(42, 4);
    expect(h.order).toEqual(["write", "stamp"]);
    expect(h.updateItem).toHaveBeenCalledWith(
      42,
      4,
      "verify-wire-two-channel",
      expect.objectContaining({ checked: true, verification: expect.objectContaining({ confirmedBy: "user-a" }) }),
    );
  });

  it("unticking needs no evidence, and withdraws the wire confirmation", async () => {
    const res = await request(app).patch("/api/deals/4/checklist/items/verify-wire-two-channel").send({ checked: false });
    expect(res.status).toBe(200);
    expect(h.refusal).not.toHaveBeenCalled();
    expect(h.withdraw).toHaveBeenCalledWith(42, 4);
    expect(h.stamp).not.toHaveBeenCalled();
  });
});
