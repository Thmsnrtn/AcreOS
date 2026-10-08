/**
 * Pax's account reads (server/services/paxAccountReads.ts) read ONE
 * organization's rows — proven on the SQL they emit, not on their signatures.
 *
 * The tenancy lint (scripts/check-org-scoped-fetch.mjs) requires each unit to
 * MENTION an org; its own header names the gap this file closes: "a method
 * that ACCEPTS an orgId but forgets to apply the predicate is not caught".
 * So every query these reads issue is captured, rendered to SQL by drizzle's
 * own dialect, and required to carry `"<table>"."organization_id" = $n` bound
 * to the caller's org — for the FROM table AND every joined table.
 *
 * POPULATION: every exported reader that touches the database directly is
 * listed in DIRECT_READERS and must issue at least one query here (vacuity),
 * and the export list of the module is compared to the union of the lists
 * below, so a new reader cannot be added without being enrolled.
 *
 * Mutations recorded (reverted after each red run):
 *   - readInboxRepliesForPax: drop `eq(inboxMessages.organizationId, …)` → red.
 *   - readInboxRepliesForPax: drop the org predicate on the conversations
 *     JOIN → red.
 *   - readTeamActivityForPax: drop `eq(activityLog.organizationId, …)` → red.
 *   - readFinanceSummaryForPax: drop `eq(payments.organizationId, …)` or
 *     `eq(costBasis.organizationId, …)` → red (one query each, so each is read).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";

const ORG = 4242;

type Captured = { from: string; where: SQL | null; joins: Array<{ table: string; on: SQL }> };
const queries: Captured[] = [];

vi.mock("../../server/db", () => {
  const select = (_fields?: unknown) => {
    const q: Captured = { from: "?", where: null, joins: [] };
    queries.push(q);
    const chain: any = {
      from(t: any) {
        q.from = getTableName(t);
        return chain;
      },
      innerJoin(t: any, on: SQL) {
        q.joins.push({ table: getTableName(t), on });
        return chain;
      },
      leftJoin(t: any, on: SQL) {
        q.joins.push({ table: getTableName(t), on });
        return chain;
      },
      where(w: SQL) {
        q.where = w;
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit() {
        return chain;
      },
      then(resolve: (rows: unknown[]) => void) {
        resolve(q.from === "team_members" ? [{ id: 1, userId: "u_va", displayName: "Val", role: "va", isActive: true, viewOnlyAssignedLeads: true }] : []);
      },
    };
    return chain;
  };
  return { db: { select } };
});

const { creditService, getAllUsageLimits, getSeatInfo, readSendRails, getDefaultMailSenderIdentity } = vi.hoisted(() => ({
  creditService: {
    isFounder: vi.fn(async () => false),
    getBalance: vi.fn(async () => 20000),
    getTransactionHistory: vi.fn(async () => [
      { type: "debit", amountCents: -2, balanceAfterCents: 20000, description: "AI chat", createdAt: new Date("2026-10-06T00:00:00Z") },
    ]),
  },
  getAllUsageLimits: vi.fn(async () => ({
    tier: "pro",
    isFounder: false,
    usage: { leads: { current: 6, limit: 5000, percentage: 0 } },
    aiTurns: { current: 3, threshold: 2500 },
  })),
  getSeatInfo: vi.fn(async () => ({ usedSeats: 1, totalSeats: 3, includedSeats: 3, availableSeats: 2, maxSeats: 10, canAddSeats: true, seatPriceCents: 1500 })),
  // stands in for orgHasConnectedSmsIdentity — the SMS send path's own resolver
  readSendRails: vi.fn(async () => false),
  getDefaultMailSenderIdentity: vi.fn(async () => undefined),
}));
vi.mock("../../server/services/credits", () => ({ creditService }));
vi.mock("../../server/services/usageLimits", () => ({ getAllUsageLimits, getSeatInfo }));
vi.mock("../../server/services/emailService", () => ({
  counterpartyEmailIdentityStatus: vi.fn(async () => ({ canSend: false, ownSesCredentials: false, verifiedDomain: false })),
}));
vi.mock("../../server/services/smsService", () => ({ orgHasConnectedSmsIdentity: readSendRails }));
vi.mock("../../server/services/directMail", () => ({ directMailService: { hasOrgLobCredentials: vi.fn(async () => false) } }));
vi.mock("../../server/storage", () => ({ storage: { getDefaultMailSenderIdentity } }));
vi.mock("../../server/utils/permissions", () => ({
  getPermissionsForRole: () => ({ viewOnlyAssignedLeads: false, canImportData: true, canExportData: true, canManageTeam: true, canManageBilling: true, canAssignLeads: true, canEditLeads: true }),
  getRoleLabel: (r: string) => r,
}));

import * as reads from "../../server/services/paxAccountReads";

const dialect = new PgDialect();
function render(s: SQL) {
  return dialect.sqlToQuery(s);
}

/** True when `cond` pins `table` to ORG. */
function pinsOrg(cond: SQL | null, table: string): boolean {
  if (!cond) return false;
  const { sql, params } = render(cond);
  const re = new RegExp(`"${table}"\\."organization_id" = \\$(\\d+)`, "g");
  for (const m of sql.matchAll(re)) {
    if (params[Number(m[1]) - 1] === ORG) return true;
  }
  return false;
}

const DIRECT_READERS: Record<string, () => Promise<unknown>> = {
  readCampaignsForPax: () => reads.readCampaignsForPax(ORG, {}),
  readInboxRepliesForPax: () => reads.readInboxRepliesForPax(ORG, {}),
  readTeamActivityForPax: () => reads.readTeamActivityForPax(ORG, { role: "va" }),
  countContactableLeadsForPax: () => reads.countContactableLeadsForPax(ORG, "text"),
  readFinanceSummaryForPax: () => reads.readFinanceSummaryForPax(ORG, { period: "this_year" }),
};
const DELEGATING_READERS: Record<string, () => Promise<unknown>> = {
  readCreditsForPax: () => reads.readCreditsForPax(ORG),
  readPlanLimitsForPax: () => reads.readPlanLimitsForPax(ORG),
  readSendingIdentityForPax: () => reads.readSendingIdentityForPax(ORG, "pro"),
  readSendRails: () => reads.readSendRails(ORG),
};

beforeEach(() => {
  queries.length = 0;
  vi.clearAllMocks();
});

describe("population", () => {
  it("every exported reader is enrolled in this file", () => {
    const exported = Object.entries(reads).filter(([, v]) => typeof v === "function").map(([k]) => k).sort();
    expect(exported).toEqual([...Object.keys(DIRECT_READERS), ...Object.keys(DELEGATING_READERS)].sort());
  });
});

describe.each(Object.entries(DIRECT_READERS))("%s pins every table it reads to the caller's org", (_name, run) => {
  it("issues queries (vacuity) and each FROM and JOIN carries organization_id = the org", async () => {
    await run();
    expect(queries.length, "the reader issued no query — the capture is not reading it").toBeGreaterThan(0);
    for (const q of queries) {
      expect(pinsOrg(q.where, q.from), `${q.from}: WHERE does not pin organization_id = ${ORG}`).toBe(true);
      for (const j of q.joins) {
        expect(pinsOrg(j.on, j.table), `JOIN ${j.table}: ON does not pin organization_id = ${ORG}`).toBe(true);
      }
    }
  });
});

describe("the finance summary reports only what is recorded", () => {
  it("no rows -> zeros and the window, never an estimate, and it refuses to compute profit", async () => {
    const out: any = await reads.readFinanceSummaryForPax(ORG, { period: "last_year", now: new Date("2026-10-07T12:00:00Z") });
    expect(out.from).toBe("2025-01-01");
    expect(out.to).toBe("2025-12-31");
    expect(out.incomeRecorded).toMatchObject({ payments: 0, totalReceived: 0, interest: 0 });
    expect(out.costsRecorded).toMatchObject({ propertiesWithCosts: 0, acquisitionPrice: 0 });
    expect(out.notComputed).toMatch(/not computed/i);
    expect(out).not.toHaveProperty("profit");
    expect(out).not.toHaveProperty("netIncome");
  });

  it("an unknown period falls back to this year (no invented window)", async () => {
    const out: any = await reads.readFinanceSummaryForPax(ORG, { period: "forever", now: new Date("2026-10-07T12:00:00Z") });
    expect(out.period).toBe("this_year");
    expect(out.from).toBe("2026-01-01");
  });

  it("income is completed payments only, inside the window", async () => {
    await reads.readFinanceSummaryForPax(ORG, { period: "this_year" });
    const q = queries.find((x) => x.from === "payments")!;
    const { sql } = render(q.where!);
    expect(sql).toContain('"payments"."status" = $');
    expect(sql).toContain('"payments"."payment_date" >= $');
    expect(sql).toContain('"payments"."payment_date" < $');
  });
});

describe("the delegating readers pass the caller's org to the canonical service", () => {
  it("credits read the org's balance and history", async () => {
    const out: any = await reads.readCreditsForPax(ORG, { limit: 3 });
    expect(creditService.getBalance).toHaveBeenCalledWith(ORG);
    expect(creditService.getTransactionHistory).toHaveBeenCalledWith(ORG, 3);
    expect(out.balanceCredits).toBe(20000);
    expect(out.balanceDollars).toBe("$200.00");
    expect(out.recent[0].dollars).toBe("-$0.02");
  });

  it("a founder org reports 'not metered' instead of a 999,999,999 balance", async () => {
    creditService.isFounder.mockResolvedValueOnce(true);
    const out: any = await reads.readCreditsForPax(ORG);
    expect(out.metered).toBe(false);
    expect(JSON.stringify(out)).not.toContain("999999999");
  });

  it("plan limits read the org's usage and seats", async () => {
    const out: any = await reads.readPlanLimitsForPax(ORG);
    expect(getAllUsageLimits).toHaveBeenCalledWith(ORG);
    expect(getSeatInfo).toHaveBeenCalledWith(ORG);
    expect(out.seats.available).toBe(2);
    expect(out.imports.rowsPerFile).toBe(500);
  });

  it("sending identity asks the send paths' own resolvers for the org", async () => {
    const out: any = await reads.readSendingIdentityForPax(ORG, "pro");
    expect(readSendRails).toHaveBeenCalledWith(ORG);
    expect(getDefaultMailSenderIdentity).toHaveBeenCalledWith(ORG);
    expect(out.sms.ownTwilioConnected).toBe(false);
    expect(out.sms.planAllowsConnectingTwilio).toBe(true);
    expect(out.email.canSendCampaignEmail).toBe(false);
  });

  it("team activity names the role filter and the members it matched", async () => {
    const out: any = await reads.readTeamActivityForPax(ORG, { role: "va" });
    expect(out.membersMatchingRole).toBe(1);
    expect(out.members[0]).toMatchObject({ name: "Val", role: "va", seesOnlyAssignedLeads: true });
  });
});
