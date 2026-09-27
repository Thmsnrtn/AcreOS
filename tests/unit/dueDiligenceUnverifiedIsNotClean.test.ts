/**
 * DEFECT-0126 — a due-diligence finding nobody checked is not clean.
 *
 * The dossier pods (server/services/dueDiligencePods.ts, run from the
 * properties page's "Generate AI dossier") each look a parcel up through the
 * data-source broker. When no source answered — no coordinates, or every
 * provider failing without throwing — each pod returned a CLEAN verdict:
 * title clear, taxes current, access legal ("Road Access"), zoning
 * "Agricultural/Residential", comps at $2,500/acre, and no environmental
 * concerns. Those became the green flags "Clear title", "Taxes current",
 * "Legal access confirmed", 100-point sub-scores, and the input to a
 * buy/pass recommendation — for a parcel nothing had examined.
 *
 * The file's own ERROR branches already said the right thing ("manual review
 * required"). These tests drive the real pods with the broker answering
 * nothing and assert the no-data branches now agree with them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/utils/openaiClient", () => ({ getOpenAIClient: () => null }));

const BROKER = vi.hoisted(() => ({
  answer: (_kind: string): { success: boolean; data?: Record<string, unknown> } => ({ success: false }),
}));
vi.mock("../../server/services/data-source-broker", () => ({
  DataSourceBroker: class {
    async lookup(kind: string) {
      return BROKER.answer(kind);
    }
  },
}));

const PROPERTY = vi.hoisted(() => ({
  row: { id: 11, organizationId: 5, latitude: "30.1", longitude: "-97.2", state: "TX", county: "Bastrop", sizeAcres: "12" } as Record<string, unknown> | null,
}));
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (PROPERTY.row ? [PROPERTY.row] : []) }),
      }),
    }),
  },
}));

const { dueDiligencePodService: pods } = await import("../../server/services/dueDiligencePods");

beforeEach(() => {
  BROKER.answer = () => ({ success: false });
});

describe("DEFECT-0126 — no data source answered", () => {
  it("title is NOT clear, and says it was not verified", async () => {
    const t = await pods.researchTitle(11, 5);
    expect(t.clear).toBe(false);
    expect(t.unverified).toBe(true);
  });

  it("taxes are NOT current", async () => {
    const t = await pods.researchTax(11, 5);
    expect(t.current).toBe(false);
    expect(t.unverified).toBe(true);
  });

  it("the parcel is NOT environmentally clean", async () => {
    const e = await pods.researchEnvironmental(11, 5);
    expect(e.clean).toBe(false);
    expect(e.unverified).toBe(true);
  });

  it("zoning is Unknown, not Agricultural/Residential", async () => {
    const z = await pods.researchZoning(11, 5);
    expect(z.current).toBe("Unknown");
    expect(z.allowedUses ?? []).toEqual([]);
    expect(z.unverified).toBe(true);
  });

  it("access is NOT legal", async () => {
    const a = await pods.researchAccess(11, 5);
    expect(a.legal).toBe(false);
    expect(a.unverified).toBe(true);
  });

  it("comps carry no price", async () => {
    const c = await pods.researchComps(11, 5);
    expect(c.pricePerAcre).toBeUndefined();
    expect(c.medianPrice).toBeUndefined();
    expect(c.trend).toBe("Unable to determine");
  });

  it("the recommendation raises a 'not verified' red flag and awards no green flag for unchecked facts", async () => {
    const findings = {
      titleStatus: await pods.researchTitle(11, 5),
      taxStatus: await pods.researchTax(11, 5),
      environmental: await pods.researchEnvironmental(11, 5),
      zoning: await pods.researchZoning(11, 5),
      access: await pods.researchAccess(11, 5),
      comps: await pods.researchComps(11, 5),
    };
    const scores = pods.calculateScores(findings);
    const rec = await pods.generateRecommendation(scores, findings);
    expect(rec.greenFlags).not.toContain("Clear title");
    expect(rec.greenFlags).not.toContain("Taxes current");
    expect(rec.greenFlags).not.toContain("Legal access confirmed");
    expect(rec.greenFlags).not.toContain("No environmental concerns");
    expect(rec.redFlags.join(" ")).toMatch(/Not verified.*title.*taxes.*environmental.*zoning.*access/);
    expect(scores.breakdown.titleScore).toBeLessThan(100);
    expect(scores.breakdown.accessScore).toBeLessThan(90);
  });
});

describe("DEFECT-0126 — a source that answered but said nothing about the question", () => {
  it("a parcel record with no lien or encumbrance fields does not make title clear", async () => {
    BROKER.answer = (kind) => (kind === "parcel_data" ? { success: true, data: { apn: "123-45", owner: "J. Doe" } } : { success: false });
    const t = await pods.researchTitle(11, 5);
    expect(t.clear).toBe(false);
    expect(t.unverified).toBe(true);
  });

  it("a tax record with no delinquency flag does not make taxes current", async () => {
    BROKER.answer = (kind) => (kind === "tax_assessment" ? { success: true, data: { assessedValue: 40000 } } : { success: false });
    const t = await pods.researchTax(11, 5);
    expect(t.current).toBe(false);
  });

  it("an access record with no legal flag is not legal access, and invents no road type", async () => {
    BROKER.answer = (kind) => (kind === "parcel_data" ? { success: true, data: { access: { easements: [] } } } : { success: false });
    const a = await pods.researchAccess(11, 5);
    expect(a.legal).toBe(false);
    expect(a.type).toBe("Unknown");
    expect(a.roadMaintenance).toBe("Unknown");
  });

  it("and a source that DOES answer is still believed", async () => {
    BROKER.answer = (kind) =>
      kind === "parcel_data"
        ? { success: true, data: { liens: [], encumbrances: [], access: { type: "Gravel", legal: true, maintenance: "County" } } }
        : kind === "tax_assessment"
          ? { success: true, data: { delinquent: false, amountDue: 0 } }
          : { success: false };
    expect((await pods.researchTitle(11, 5)).clear).toBe(true);
    expect((await pods.researchTax(11, 5)).current).toBe(true);
    const a = await pods.researchAccess(11, 5);
    expect(a.legal).toBe(true);
    expect(a.type).toBe("Gravel");
  });
});
