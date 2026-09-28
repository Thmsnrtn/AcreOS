/**
 * DEFECT-0179 — buyer qualification says "verified" only about what it
 * verified, and reads only the org's own lead.
 *
 * Found by the independent audit of DEFECT-0177 (same defect family):
 *  - `proofOfFundsVerified` was true whenever the buyer TYPED a budget, and
 *    the assessment listed "Proof of funds verified" as a strength;
 *  - a self-reported pre-approval checkbox became status "approved",
 *    "Pre-approved for financing", and ticked `preApprovalLetter`;
 *  - a lead with an email and a phone was "Identity verified via contact
 *    information"; two inquiries were "references" verified;
 *  - the background check read the profile's lead by id alone, so a profile
 *    carrying another org's leadId read that tenant's lead.
 * Nothing in this bot inspects a document, a letter, an ID or a reference.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";

const h = vi.hoisted(() => ({
  profile: null as null | Record<string, unknown>,
  leadSql: "",
  lead: { id: 5, organizationId: 7, email: "b@example.com", phone: "5550100" } as Record<string, unknown>,
  written: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../server/db", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const select = () => {
    let table = "";
    const q: Record<string, unknown> = {};
    q.from = (t: Parameters<typeof getTableName>[0]) => {
      table = getTableName(t);
      return q;
    };
    q.where = async (w: SQL) => {
      if (table === "buyer_qualifications")
        return [{ id: 1, organizationId: 7, buyerProfileId: 11, checks: {}, financingReadiness: {} }];
      if (table === "buyer_profiles") return h.profile ? [h.profile] : [];
      if (table === "leads") {
        h.leadSql = dialect.sqlToQuery(w).sql;
        // Answer only a read that names the organization.
        return /"leads"\."organization_id" = \$/.test(h.leadSql) ? [h.lead] : [{ ...h.lead, organizationId: 99 }];
      }
      return [];
    };
    return q;
  };
  const update = () => ({
    set: (v: Record<string, unknown>) => ({
      where: async () => {
        h.written.push(v);
      },
    }),
  });
  const insert = () => ({ values: async () => undefined });
  return { db: { select, update, insert } };
});
vi.mock("../../server/services/aiRouter", () => ({
  generateWithAutoRouting: vi.fn(async () => {
    throw new Error("no model in tests");
  }),
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { buyerQualificationBotService as bot } from "../../server/services/buyerQualificationBot";

const selfReported = {
  id: 11,
  organizationId: 7,
  leadId: 5,
  profileType: "individual",
  financialInfo: { budget: 40000, preApproved: true, preApprovalAmount: 50000, downPaymentCapacity: 0.2 },
  engagement: { inquiriesMade: 3 },
  intent: {},
};

beforeEach(() => {
  h.profile = { ...selfReported };
  h.leadSql = "";
  h.written = [];
});

describe("nothing self-reported is called verified", () => {
  it("a typed budget is not proof of funds", async () => {
    const r = await bot.runFinancialCheck(1);
    expect(r.proofOfFundsVerified).toBe(false);
    expect(r.notes.join(" | ")).toMatch(/self-reported/);
  });

  it("a pre-approval checkbox is reported, not approved, and ticks no letter", async () => {
    const r = await bot.runFinancialCheck(1);
    expect(r.preApprovalStatus).toBe("reported");
    const checks = h.written.find((w) => w.checks)?.checks as Record<string, unknown>;
    expect(checks.preApprovalLetter).toBe(false);
  });

  it("contact details are not identity, and inquiries are not references", async () => {
    const r = await bot.runBackgroundChecks(1);
    expect(r.identityVerified).toBe(false);
    expect(r.referencesVerified).toBe(false);
    expect(r.notes.join(" | ")).not.toMatch(/Identity verified/);
  });

  it("the assessment's strengths never claim a verification that did not happen", async () => {
    const a = await bot.generateAssessment(1);
    const text = [...a.strengths, ...a.concerns].join(" | ");
    expect(text).not.toMatch(/Proof of funds verified|Pre-approved for financing|Identity verified|Eligible for owner financing/);
    expect(text).toMatch(/not verified|no letter on file|not a credit decision/);
  });
});

describe("the background check reads only the org's own lead", () => {
  it("the lead read names the organization", async () => {
    await bot.runBackgroundChecks(1);
    expect(h.leadSql).toMatch(/"leads"\."organization_id" = \$/);
  });
});
