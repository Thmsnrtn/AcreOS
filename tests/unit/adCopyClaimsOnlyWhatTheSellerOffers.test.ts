/**
 * Pax's generateAdCopy skill claims only what the seller offers.
 *
 * Best-in-class audit 2026-10-20 (marketing): every style of generated ad
 * promised owner financing ("No banks, no credit checks", "No credit check
 * required"), and the investment style asserted "strong appreciation
 * potential. Land values in this area have been steadily increasing" for any
 * parcel — claims no data behind the skill could back.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/storage", () => ({
  storage: {
    getProperty: vi.fn(async (org: number, id: number) =>
      org === 5 && id === 11
        ? { id: 11, organizationId: 5, sizeAcres: "5", county: "Pima", state: "AZ", city: "Tucson", zoning: "RU" }
        : undefined,
    ),
  },
  db: {},
}));
vi.mock("../../server/db", () => ({ db: {} }));

const { skillRegistry } = await import("../../server/services/agent-skills");
const ctx = { organizationId: 5 } as Parameters<NonNullable<ReturnType<typeof skillRegistry.getSkillById>>["execute"]>[1];

async function ad(style: "story" | "features" | "investment", sellerFinancingOffered?: boolean): Promise<string> {
  const skill = skillRegistry.getSkillById("generateAdCopy")!;
  const r = await skill.execute({ propertyId: 11, style, sellerFinancingOffered }, ctx);
  expect(r.success).toBe(true);
  return (r.data as { fullAd: string }).fullAd;
}

describe("generateAdCopy", () => {
  for (const style of ["story", "features", "investment"] as const) {
    it(`${style}: no financing, credit or appreciation claim unless the seller offers terms`, async () => {
      const text = await ad(style);
      expect(text).not.toMatch(/financ|down payment|monthly payment|credit check|no banks/i);
      expect(text).not.toMatch(/apprecia|values .* increasing|ROI/i);
    });
    it(`${style}: names owner financing when the seller offers it`, async () => {
      expect(await ad(style, true)).toMatch(/owner financing/i);
    });
  }
});
