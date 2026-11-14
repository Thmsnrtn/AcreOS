/**
 * P1-15 / TAIL-A2 — cross-tenant quarantine of the autonomous deal machine,
 * against a real Postgres.
 *
 * The defect (CR-033 lineage): `sendEnhancedMorningBriefings` read the latest
 * platform-wide `background_jobs` row — no org filter, and the table has no
 * org column — and rendered that one aggregate into EVERY org's briefing.
 * The engine was safe only because its BullMQ registration path has no
 * caller, so the row was never produced. This test invokes the briefing
 * sender and the follow-up engine directly (the wiring the quarantine must
 * survive) and proves:
 *
 *   1. With a run row carrying per-org slices plus a poisoned aggregate,
 *      each org's briefing shows ONLY its own totals — never the aggregate,
 *      never the other org's.
 *   2. With a legacy aggregate-only row as the latest run, every org gets
 *      zeros: the aggregate is not a fallback.
 *   3. The follow-up engine, invoked for an org with a qualifying cold lead,
 *      enrols nothing: no campaign created, no campaignLeads rows — campaign
 *      enrolment without a tap is quarantined inside the engine.
 *
 * Only the outbound mail transport is stubbed (no live sends).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";

useRealDb("autonomousDealMachineTenantQuarantine.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const sent = vi.hoisted(() => ({ mail: [] as Array<{ to: string; subject: string; html: string }> }));
vi.mock("../../server/services/emailService", () => ({
  emailService: {
    sendEmail: async (o: { to: string; subject: string; html: string }) => {
      sent.mail.push(o);
      return { success: true, messageId: `m-${o.to}` };
    },
  },
}));

const tag = `p115-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const emailA = `${tag}-a@example.com`;
const emailB = `${tag}-b@example.com`;
const ids = { orgA: 0, orgB: 0, jobRows: [] as number[], leadA: 0 };

describe.runIf(realDbAvailable)("autonomous deal machine tenant quarantine (real database)", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations, teamMembers, backgroundJobs, leads } = await import("@shared/schema");

    for (const [key, email] of [
      ["orgA", emailA],
      ["orgB", emailB],
    ] as const) {
      const [org] = await db
        .insert(organizations)
        .values({ name: `${tag}-${key}`, slug: `${tag}-${key}`, ownerId: `${tag}-${key}-owner`, subscriptionStatus: "active" } as any)
        .returning();
      ids[key] = org.id;
      await db.insert(teamMembers).values({
        organizationId: org.id,
        userId: `${tag}-${key}-owner`,
        email,
        displayName: "Owner",
        role: "owner",
        isActive: true,
      } as any);
    }

    // A qualifying cold lead for org A: under the pre-quarantine engine this
    // lead (score ≥ 50, touchCount 0, 60 days untouched) WOULD have been
    // enrolled into a sending campaign with no tap.
    const [lead] = await db
      .insert(leads)
      .values({
        organizationId: ids.orgA,
        firstName: "Cold",
        lastName: "Lead",
        email: `${tag}-lead@example.com`,
        score: 90,
        status: "new",
        createdAt: new Date(Date.now() - 60 * 86_400_000),
      } as any)
      .returning();
    ids.leadA = lead.id;

    // Run row 1: per-org slices + a poisoned aggregate that matches neither.
    const [row1] = await db
      .insert(backgroundJobs)
      .values({
        type: "autonomous_deal_machine",
        status: "completed",
        scheduledFor: new Date("2099-01-01T01:00:00Z"),
        payload: { testTag: tag, leg: 1 },
        result: {
          orgsProcessed: 2,
          newDealsFound: 999,
          hotDealsFound: 888,
          leadsAutoEnrolled: 777,
          followUpsScheduled: 666,
          perOrg: {
            [String(ids.orgA)]: { newDealsFound: 11, hotDealsFound: 3, leadsAutoEnrolled: 5, followUpsScheduled: 7 },
            [String(ids.orgB)]: { newDealsFound: 22, hotDealsFound: 0, leadsAutoEnrolled: 1, followUpsScheduled: 2 },
          },
        },
      } as any)
      .returning();
    ids.jobRows.push(row1.id);
  });

  afterAll(async () => {
    if (!ids.orgA) return;
    const { db } = await import("../../server/db");
    const { organizations, backgroundJobs, leads } = await import("@shared/schema");
    const { eq, inArray } = await import("drizzle-orm");
    await db.delete(leads).where(eq(leads.organizationId, ids.orgA));
    if (ids.jobRows.length) await db.delete(backgroundJobs).where(inArray(backgroundJobs.id, ids.jobRows));
    await db.delete(organizations).where(eq(organizations.id, ids.orgA));
    await db.delete(organizations).where(eq(organizations.id, ids.orgB));
  });

  it("each org's briefing shows only its own overnight totals", async () => {
    const { sendEnhancedMorningBriefings } = await import("../../server/jobs/autonomousDealMachine");
    sent.mail.length = 0;
    await sendEnhancedMorningBriefings();

    const toA = sent.mail.find((m) => m.to === emailA);
    const toB = sent.mail.find((m) => m.to === emailB);
    expect(toA, "org A received a briefing").toBeTruthy();
    expect(toB, "org B received a briefing").toBeTruthy();

    // Org A: its own slice — 3 hot deals in the subject, 11 scanned.
    expect(toA!.subject).toContain("3 hot deal");
    expect(toA!.html).toContain(">11<");
    // …and never org B's totals or the platform aggregate.
    expect(toA!.html).not.toContain(">22<");
    expect(toA!.html).not.toContain(">999<");
    expect(toA!.html).not.toContain(">888<");

    // Org B: its own slice — 0 hot deals (plain subject), 22 scanned.
    expect(toB!.subject).not.toContain("hot deal");
    expect(toB!.html).toContain(">22<");
    expect(toB!.html).not.toContain(">11<");
    expect(toB!.html).not.toContain(">999<");
    expect(toB!.html).not.toContain(">888<");
  });

  it("a legacy aggregate-only run row yields zeros for every org (no fallback)", async () => {
    const { db } = await import("../../server/db");
    const { backgroundJobs } = await import("@shared/schema");
    const [row2] = await db
      .insert(backgroundJobs)
      .values({
        type: "autonomous_deal_machine",
        status: "completed",
        scheduledFor: new Date("2099-01-02T01:00:00Z"),
        payload: { testTag: tag, leg: 2 },
        result: { orgsProcessed: 2, newDealsFound: 555, hotDealsFound: 444, leadsAutoEnrolled: 333, followUpsScheduled: 222 },
      } as any)
      .returning();
    ids.jobRows.push(row2.id);

    const { sendEnhancedMorningBriefings } = await import("../../server/jobs/autonomousDealMachine");
    sent.mail.length = 0;
    await sendEnhancedMorningBriefings();

    const toA = sent.mail.find((m) => m.to === emailA);
    const toB = sent.mail.find((m) => m.to === emailB);
    expect(toA, "org A received a briefing").toBeTruthy();
    expect(toB, "org B received a briefing").toBeTruthy();
    for (const m of [toA!, toB!]) {
      expect(m.subject).not.toContain("hot deal");
      expect(m.html).not.toContain("555");
      expect(m.html).not.toContain("444");
      expect(m.html).not.toContain("Overnight Activity");
    }
  });

  it("the follow-up engine enrols nothing without a tap, even when invoked directly", async () => {
    const { runAutoFollowUpEngine } = await import("../../server/jobs/autonomousDealMachine");
    const result = await runAutoFollowUpEngine(ids.orgA);
    expect(result).toEqual({ leadsReenraged: 0, touchesScheduled: 0, campaignsCreated: 0 });

    const { db } = await import("../../server/db");
    const { campaigns, campaignLeads } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const orgCampaigns = await db.select().from(campaigns).where(eq(campaigns.organizationId, ids.orgA));
    expect(orgCampaigns.filter((c) => c.name === "Auto Follow-Up Sequence")).toEqual([]);
    const enrolments = await db.select().from(campaignLeads).where(eq(campaignLeads.organizationId, ids.orgA));
    expect(enrolments).toEqual([]);
  });
});
