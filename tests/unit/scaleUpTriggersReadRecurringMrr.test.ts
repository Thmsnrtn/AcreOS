/**
 * Quality directive 2026-09-29 (money/cost truth) — a scale-up trigger is
 * crossed on recurring MRR, and says when it was crossed only if a snapshot
 * recorded it.
 *
 * The founder "MRR" was the sum of every revenue row posted in the last 30
 * days: one annual signup counted a year of revenue as a month of run rate and
 * could cross several spend rungs at once. `crossedAt` was the moment of the
 * read. Both are fixed at the route the founder cockpit reads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { financialLedger, founderAudit, mrrSnapshots } from "@shared/schema";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const S = vi.hoisted(() => ({
  revenue30d: 0,
  recurring: 0,
  snapshots: [] as Array<{ capturedAt: Date; mrrCents: number }>,
  audit: [] as Array<{ targetId: string; action: string; createdAt: Date; after: unknown }>,
}));

function rows(t: unknown): unknown[] {
  if (t === financialLedger) return [{ total: S.revenue30d }];
  if (t === founderAudit) return S.audit;
  if (t === mrrSnapshots) {
    // Only the $50 rung is crossed in the case that reads this, so every
    // fixture snapshot is at or above its threshold.
    return S.snapshots
      .slice()
      .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())
      .slice(0, 1);
  }
  return [];
}
function chain(t: unknown) {
  const c: Record<string, unknown> = {};
  c.where = () => c;
  c.leftJoin = () => c;
  c.orderBy = () => c;
  c.limit = () => c;
  c.groupBy = () => c;
  c.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(rows(t)).then(f, r);
  return c;
}
vi.mock("../../server/db", () => ({ db: { select: () => ({ from: (t: unknown) => chain(t) }) } }));
vi.mock("../../server/services/finance/runwayModel", () => ({
  liveMrrDetail: async () => ({ cents: S.recurring, payingOrgs: 1 }),
}));

async function app() {
  const { default: router } = await import("../../server/routes-finance-ledger");
  const a = express();
  a.use(express.json());
  a.use("/api/founder/finance", router);
  return a;
}

beforeEach(() => {
  S.revenue30d = 0;
  S.recurring = 0;
  S.snapshots = [];
  S.audit = [];
});

describe("scale-up triggers read the run rate", () => {
  it("one $6,000 annual signup is $500 of MRR — it crosses $50, not $500", async () => {
    S.revenue30d = 600_000; // the annual plan, posted this month
    S.recurring = 49_999;
    const r = await request(await app()).get("/api/founder/finance/triggers/active");
    expect(r.status).toBe(200);
    const ids = r.body.items.map((i: { thresholdId: string }) => i.thresholdId);
    expect(ids).toEqual(["mrr-50", "mrr-200"]);
    expect(r.body.recurringMrrCents).toBe(49_999);
    expect(r.body.trailing30dRevenueCents).toBe(600_000);
  });

  it("crossedAt is a recorded snapshot, or null — never the moment of the read", async () => {
    S.recurring = 6_000;
    const r1 = await request(await app()).get("/api/founder/finance/triggers/active");
    expect(r1.body.items[0].crossedAt).toBeNull();
    S.snapshots = [{ capturedAt: new Date("2026-08-03T00:00:00Z"), mrrCents: 5_200 }];
    const r2 = await request(await app()).get("/api/founder/finance/triggers/active");
    expect(r2.body.items[0].crossedAt).toBe("2026-08-03T00:00:00.000Z");
  });
});

describe("a deferral lasts as long as it was deferred for (audit of 92bf405)", () => {
  it("'defer for 30 days' keeps the rung hidden past day 7", async () => {
    S.recurring = 6_000;
    S.audit = [{ targetId: "mrr-50", action: "defer", createdAt: new Date(Date.now() - 10 * 86_400_000), after: { deferDays: 30 } }];
    const r = await request(await app()).get("/api/founder/finance/triggers/active");
    expect(r.body.items.map((i: { thresholdId: string }) => i.thresholdId)).not.toContain("mrr-50");
  });

  it("a deferral that named no length is 7 days", async () => {
    S.recurring = 6_000;
    S.audit = [{ targetId: "mrr-50", action: "defer", createdAt: new Date(Date.now() - 8 * 86_400_000), after: { action: "defer" } }];
    const r = await request(await app()).get("/api/founder/finance/triggers/active");
    expect(r.body.items.map((i: { thresholdId: string }) => i.thresholdId)).toContain("mrr-50");
  });
});

describe("the chat's approve confirmation is not a card offering to approve again", () => {
  it("approve_trigger returns a text confirmation, never a trigger_card without a trigger", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/services/founder-chat/tools/action.ts"), "utf8"));
    const start = src.indexOf('name: "approve_trigger"');
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("registerTool(", start));
    expect(body).toMatch(/type: "text"/);
    // Any trigger_card this tool ever returns must carry `trigger`.
    if (/type: "trigger_card"/.test(body)) expect(body).toMatch(/\btrigger:\s*\{/);
  });
});

describe("the MRR endpoint names its two numbers apart", () => {
  it("posted revenue is not reported as MRR", async () => {
    S.revenue30d = 600_000;
    S.recurring = 50_000;
    const r = await request(await app()).get("/api/founder/finance/mrr");
    expect(r.status).toBe(200);
    expect(r.body.recurringMrrCents).toBe(50_000);
    expect(r.body.trailing30dRevenueCents).toBe(600_000);
    expect(r.body).not.toHaveProperty("currentMrr");
  });
});
