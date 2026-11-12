/**
 * E2 slice 1 leg 2 — the sectioned morning brief, proved on a REAL Postgres
 * built from this repository (package 2026-11-03 §Tests 2, and the tenant-
 * isolation gate row for the new table).
 *
 * Through the mounted /api/today router, not the composer alone:
 *   - seeded state lands in the right section, with provenance on every item;
 *     a sample-book lead and an EXPIRED ask are not counted;
 *   - an org with no data gets the honest empty brief and no archive row;
 *   - dismiss → stays dismissed across a refresh → restore; the archive lists
 *     the day and reopens it;
 *   - with the AI composition switched ON and the provider failing, the
 *     deterministic sections still render, and the headline is the template;
 *   - a second org can neither read, list, reopen, dismiss nor restore the
 *     first org's brief — by id or by list.
 */
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("morningBriefSections.realdb.test.ts");

// Provider-down: the flagged AI composition is ON for this file, and the
// provider throws on every call. The sections must not care.
process.env.PAX_COMPOSED_BRIEF = "1";
const aiCalls = { n: 0 };
vi.mock("../../server/services/aiRouter", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    routeAITask: async () => {
      aiCalls.n++;
      throw new Error("provider unavailable (test)");
    },
  };
});

// A switchable kernel-read failure: a failed read must surface as
// "unreadable", never as "nothing waiting for your tap".
const kernel = { fail: false };
vi.mock("../../server/services/approvalKernel", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    countPendingActionsByTool: async (orgId: number) => {
      if (kernel.fail) throw new Error("kernel read failed (test)");
      return (actual.countPendingActionsByTool as (id: number) => Promise<Record<string, number>>)(orgId);
    },
  };
});

const tag = `brief-${randomUUID().slice(0, 8)}`;
const ids = { a: 0, b: 0, briefA: 0 };

describe.runIf(realDbAvailable)("morning brief sections + archive on PostgreSQL", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
  let app: express.Express;

  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations, leads, pendingActions } = await import("@shared/schema");
    const mk = async (suffix: string) =>
      (await db.insert(organizations).values({ name: `${tag}-${suffix}`, slug: `${tag}-${suffix}`, ownerId: `${tag}-${suffix}-o` } as never).returning())[0];
    const orgA = await mk("a");
    const orgB = await mk("b");
    ids.a = orgA.id;
    ids.b = orgB.id;

    // Org A: two real leads (one dead) and one sample-book lead created now; two live
    // asks of different tools; one EXPIRED ask that must not be counted.
    await db.insert(leads).values([
      { organizationId: ids.a, type: "seller", firstName: "Real", lastName: "Lead", source: "manual" },
      { organizationId: ids.a, type: "seller", firstName: "Sample", lastName: "Lead", source: "sample_data" },
      // A real lead already closed out: new today, but not one to contact.
      { organizationId: ids.a, type: "seller", firstName: "Dead", lastName: "Lead", source: "manual", status: "dead" },
    ] as never);
    const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
    await db.insert(pendingActions).values([
      { organizationId: ids.a, toolName: "send_email", args: { to: "x@example.test" }, contentHash: `${tag}-1`, expiresAt: inAnHour },
      { organizationId: ids.a, toolName: "send_borrower_reminder", args: {}, contentHash: `${tag}-2`, expiresAt: inAnHour },
      { organizationId: ids.a, toolName: "send_sms", args: {}, contentHash: `${tag}-3`, expiresAt: new Date(Date.now() - 60_000) },
    ] as never);

    const orgs: Record<string, unknown> = { a: orgA, b: orgB };
    const { default: router } = await import("../../server/routes-today");
    const { default: briefsRouter } = await import("../../server/routes-today-briefs");
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      const which = String(req.headers["x-test-org"] ?? "a");
      req.organization = orgs[which];
      req.organizationId = (orgs[which] as { id: number }).id;
      req.user = { id: `${tag}-${which}-o` };
      next();
    });
    // Same order as server/routes.ts: the archive ahead of /api/today.
    app.use("/api/today/briefs", briefsRouter);
    app.use("/api/today", router);
  });

  afterAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations, leads, pendingActions, paxMorningBriefs } = await import("@shared/schema");
    const { inArray } = await import("drizzle-orm");
    const orgIds = [ids.a, ids.b].filter(Boolean);
    if (orgIds.length === 0) return;
    await db.delete(paxMorningBriefs).where(inArray(paxMorningBriefs.organizationId, orgIds)).catch(() => undefined);
    await db.delete(pendingActions).where(inArray(pendingActions.organizationId, orgIds)).catch(() => undefined);
    await db.delete(leads).where(inArray(leads.organizationId, orgIds)).catch(() => undefined);
    await db.delete(organizations).where(inArray(organizations.id, orgIds)).catch(() => undefined);
  });

  it("renders seeded real state into the right sections, with provenance, provider down", async () => {
    const res = await request(app).get("/api/today?tz=0").set("x-test-org", "a");
    expect(res.status).toBe(200);
    const card = res.body.briefCard;
    expect(card).toBeTruthy();
    expect(typeof card.id).toBe("number");
    ids.briefA = card.id;
    expect(card.dismissed).toBe(false);

    const byId = (section: string) =>
      Object.fromEntries((card.sections[section] as Array<{ id: string }>).map((i) => [i.id, i]));
    // Real leads count; the sample-book lead does not — on BOTH lead counts.
    // The dead lead is new today but is not one to contact.
    expect(byId("changed")["leads-created-24h"]).toMatchObject({ count: 2, text: "2 new leads in the last 24 hours" });
    expect(byId("needsYou")["leads-uncontacted-14d"]).toMatchObject({ count: 1, text: "1 lead not contacted in 14+ days" });
    // The two LIVE asks, named for what they are; the expired send_sms is absent.
    const prepared = byId("prepared");
    expect(Object.keys(prepared).sort()).toEqual(["prepared-send_borrower_reminder", "prepared-send_email"]);
    expect(prepared["prepared-send_email"]).toMatchObject({ count: 1, text: "1 email prepared, waiting for your tap", source: "pending_actions" });
    expect(card.sections.empty).toBe(false);
    // Provenance on every item, every section.
    for (const section of ["changed", "needsYou", "prepared"]) {
      for (const item of card.sections[section]) {
        expect(item.source).toMatch(/\S/);
        expect(Number.isNaN(Date.parse(item.asOf))).toBe(false);
      }
    }
    // The AI composition was attempted and failed; the headline is the
    // deterministic default-persona template, never a fabricated summary.
    expect(aiCalls.n).toBeGreaterThan(0);
    expect(card.headline).toMatch(/^(Pax has \d+ items? in your queue( — [^.]+)?\. \d+ open alerts?\.|Quiet morning — nothing urgent from Pax\. Good time to plan the next move\.)$/);
  });

  it("gives an org with no data an honest empty brief and archives nothing", async () => {
    const res = await request(app).get("/api/today?tz=0").set("x-test-org", "b");
    expect(res.status).toBe(200);
    expect(res.body.briefCard.sections).toMatchObject({ changed: [], needsYou: [], prepared: [], empty: true });
    expect(res.body.briefCard.id).toBeNull();
    const list = await request(app).get("/api/today/briefs").set("x-test-org", "b");
    expect(list.body.briefs).toEqual([]);
  });

  it("another org cannot read, list, reopen, dismiss or restore the brief", async () => {
    expect(ids.briefA).toBeGreaterThan(0);
    const list = await request(app).get("/api/today/briefs").set("x-test-org", "b");
    expect((list.body.briefs as Array<{ id: number }>).map((b) => b.id)).not.toContain(ids.briefA);
    expect((await request(app).get(`/api/today/briefs/${ids.briefA}`).set("x-test-org", "b")).status).toBe(404);
    expect((await request(app).post(`/api/today/briefs/${ids.briefA}/dismiss`).set("x-test-org", "b")).status).toBe(404);
    expect((await request(app).post(`/api/today/briefs/${ids.briefA}/restore`).set("x-test-org", "b")).status).toBe(404);
    // Org A's row is untouched by B's attempt.
    const { db } = await import("../../server/db");
    const { paxMorningBriefs } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(paxMorningBriefs).where(eq(paxMorningBriefs.id, ids.briefA));
    expect(row.organizationId).toBe(ids.a);
    expect(row.dismissedAt).toBeNull();
  });

  it("dismiss persists across a refresh, restore brings it back, and the archive reopens it", async () => {
    // Self-contained: today's row id comes from its own GET.
    ids.briefA = (await request(app).get("/api/today?tz=0").set("x-test-org", "a")).body.briefCard.id;
    expect(ids.briefA).toBeGreaterThan(0);
    const d = await request(app).post(`/api/today/briefs/${ids.briefA}/dismiss`).set("x-test-org", "a");
    expect(d.body).toEqual({ id: ids.briefA, dismissed: true });

    // A refresh re-composes the day's content but keeps the dismissal.
    const again = await request(app).get("/api/today?tz=0").set("x-test-org", "a");
    expect(again.body.briefCard).toMatchObject({ id: ids.briefA, dismissed: true });

    const list = await request(app).get("/api/today/briefs").set("x-test-org", "a");
    const mine = (list.body.briefs as Array<{ id: number; dismissed: boolean; counts: { prepared: number } }>).find((b) => b.id === ids.briefA);
    expect(mine).toMatchObject({ dismissed: true, counts: { prepared: 2 } });

    const reopened = await request(app).get(`/api/today/briefs/${ids.briefA}`).set("x-test-org", "a");
    expect(reopened.status).toBe(200);
    expect(reopened.body.sections.prepared).toHaveLength(2);

    const r = await request(app).post(`/api/today/briefs/${ids.briefA}/restore`).set("x-test-org", "a");
    expect(r.body).toEqual({ id: ids.briefA, dismissed: false });
    const back = await request(app).get("/api/today?tz=0").set("x-test-org", "a");
    expect(back.body.briefCard.dismissed).toBe(false);
  });

  it("archives nothing for a request without the viewer's zone, and survives a bogus one", async () => {
    // CashStrip shares GET /api/today with no tz; a UTC guess would file
    // tomorrow's row every US evening. Use a fresh org-B-like path: org A's
    // count of rows must not change.
    const { db } = await import("../../server/db");
    const { paxMorningBriefs } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const count = async () =>
      (await db.select({ id: paxMorningBriefs.id }).from(paxMorningBriefs).where(eq(paxMorningBriefs.organizationId, ids.a))).length;
    const before = await count();
    for (const q of ["", "?tz=1e12", "?tz=abc", "?tz=30.5"]) {
      const res = await request(app).get(`/api/today${q}`).set("x-test-org", "a");
      expect(res.status).toBe(200);
      expect(res.body.briefCard).toMatchObject({ id: null, date: null, dismissed: false });
      // The sections still render — they do not depend on the zone.
      expect(res.body.briefCard.sections.prepared).toHaveLength(2);
    }
    expect(await count()).toBe(before);
    // A New York evening (offset +300) keys the row to the local day.
    const ny = await request(app).get("/api/today?tz=300").set("x-test-org", "a");
    const expected = new Date(Date.now() - 300 * 60_000).toISOString().slice(0, 10);
    expect(ny.body.briefCard.date).toBe(expected);
  });

  it("reports a failed prepared-work read as unreadable, never as nothing waiting", async () => {
    kernel.fail = true;
    try {
      const res = await request(app).get("/api/today?tz=0").set("x-test-org", "a");
      expect(res.status).toBe(200);
      const sections = res.body.briefCard.sections;
      expect(sections.unreadable).toEqual(["prepared"]);
      expect(sections.prepared).toEqual([]);
      expect(sections.empty).toBe(false);
    } finally {
      kernel.fail = false;
    }
  });

  it("refuses a malformed id rather than guessing", async () => {
    expect((await request(app).get("/api/today/briefs/abc").set("x-test-org", "a")).status).toBe(400);
    expect((await request(app).post("/api/today/briefs/0/dismiss").set("x-test-org", "a")).status).toBe(400);
  });
});
