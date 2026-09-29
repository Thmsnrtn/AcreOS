/**
 * Founder ruling 2026-09-29 #3 — the 90-day borrower wind-down (DEFECT-0106).
 *
 * One policy for every borrower money path, keyed on when the lender's
 * subscription ENDED: full servicing while it has not; autopay, the portal and
 * statements continue for 90 days after; then no NEW payment starts and the
 * borrower is told to pay the lender directly.
 *
 * Before: statements ran only for `subscription_status = 'active'`, while ACH
 * autopay and the portal card routes ignored the subscription entirely — a
 * cancelled lender's borrower kept being debited while their statements
 * stopped, and a paused lender's borrowers lost statements they were owed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";

const h = vi.hoisted(() => ({
  orgs: [] as Array<Record<string, unknown>>,
  book: [] as Array<Record<string, unknown>>,
  owner: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ table: string; set: Record<string, unknown>; where: string }>,
  sent: [] as Array<Record<string, unknown>>,
  sendResult: { success: true } as { success: boolean; errorType?: string },
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/emailService", () => ({
  emailService: {
    sendEmail: vi.fn(async (o: Record<string, unknown>) => {
      h.sent.push(o);
      return h.sendResult;
    }),
  },
}));
vi.mock("../../server/db", () => {
  const dialect = new PgDialect();
  const render = (w: unknown) => (w ? dialect.sqlToQuery(w as SQL).sql : "");
  const select = () => {
    let table = "";
    const q: Record<string, unknown> = {};
    q.from = (t: unknown) => {
      table = getTableName(t as never);
      return q;
    };
    q.leftJoin = () => q;
    q.where = () => q;
    q.limit = () => q;
    q.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) =>
      Promise.resolve(table === "organizations" ? h.orgs : table === "notes" ? h.book : table === "team_members" ? h.owner : []).then(f, r);
    return q;
  };
  const update = (t: unknown) => ({
    set: (set: Record<string, unknown>) => ({
      where: (w: unknown) => {
        const rec = { table: getTableName(t as never), set, where: render(w) };
        h.updates.push(rec);
        return { returning: async () => h.orgs.filter((o) => !o.subscriptionEndedAt).map((o) => ({ id: o.id, subscriptionEndedAt: new Date("2026-09-29T00:00:00Z") })) };
      },
    }),
  });
  return { db: { select, update } };
});

import {
  WIND_DOWN_DAYS,
  servicingPhaseFor,
  subscriptionEndedPatch,
  lenderServicingPhase,
  orgsStillServiced,
} from "../../server/services/borrower/servicingPhase";
import { runServicingWindDownPass } from "../../server/services/borrower/servicingWindDown";

const NOW = new Date("2026-09-29T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

beforeEach(() => {
  h.orgs = [];
  h.book = [];
  h.owner = [{ email: "owner@lender.test" }];
  h.updates = [];
  h.sent = [];
  h.sendResult = { success: true };
});

describe("the phase rule", () => {
  it("a subscription that has not ended is full servicing — whatever its billing state", () => {
    for (const s of ["active", "trialing", "past_due", "paused", "suspended", "unpaid"]) {
      expect(servicingPhaseFor({ subscriptionStatus: s, subscriptionEndedAt: daysAgo(400) }, NOW).phase, s).toBe("full");
    }
  });

  it("wind-down for 90 days after it ended, then ended — both spellings Stripe and AcreOS use", () => {
    expect(WIND_DOWN_DAYS).toBe(90);
    for (const s of ["cancelled", "canceled"]) {
      expect(servicingPhaseFor({ subscriptionStatus: s, subscriptionEndedAt: daysAgo(89) }, NOW).phase).toBe("wind_down");
      expect(servicingPhaseFor({ subscriptionStatus: s, subscriptionEndedAt: daysAgo(90) }, NOW).phase).toBe("ended");
    }
    const p = servicingPhaseFor({ subscriptionStatus: "cancelled", subscriptionEndedAt: daysAgo(10) }, NOW);
    expect(p).toMatchObject({ phase: "wind_down", windDownEndsAt: new Date(daysAgo(10).getTime() + 90 * 86_400_000) });
  });

  it("every writer that ends a subscription stamps the clock", () => {
    expect(subscriptionEndedPatch(NOW)).toEqual({ subscriptionEndedAt: NOW });
  });
});

describe("a lender cancelled before the clock existed", () => {
  it("is stamped NOW on first sight — the notice period starts, it is not retroactively spent", async () => {
    h.orgs = [{ id: 7, subscriptionStatus: "cancelled", subscriptionEndedAt: null }];
    const phase = await lenderServicingPhase(7, NOW);
    expect(phase.phase).toBe("wind_down");
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].table).toBe("organizations");
    // COALESCE: a concurrent stamp wins, both callers agree on one date.
    const stamp = new PgDialect().sqlToQuery(h.updates[0].set.subscriptionEndedAt as SQL).sql;
    expect(stamp).toMatch(/^COALESCE\("organizations"\."subscription_ended_at", \$1\)$/);
    // …for this lender only.
    expect(h.updates[0].where).toMatch(/"organizations"\."id" = \$1/);
  });
});

describe("which lenders' borrowers still get statements", () => {
  it("everyone except lenders whose wind-down is over (was: only 'active')", async () => {
    h.orgs = [
      { id: 1, subscriptionStatus: "active", subscriptionEndedAt: null },
      { id: 2, subscriptionStatus: "paused", subscriptionEndedAt: null },
      { id: 3, subscriptionStatus: "past_due", subscriptionEndedAt: null },
      { id: 4, subscriptionStatus: "cancelled", subscriptionEndedAt: daysAgo(30) },
      { id: 5, subscriptionStatus: "cancelled", subscriptionEndedAt: daysAgo(120) },
    ];
    expect(await orgsStillServiced(NOW)).toEqual([1, 2, 3, 4]);
  });
});

describe("the notices", () => {
  it("during the wind-down the LENDER is told, once per end date, on the system lane", async () => {
    h.orgs = [{ id: 7, name: "Mesa Land", subscriptionStatus: "cancelled", subscriptionEndedAt: daysAgo(10) }];
    h.book = [{ noteId: 1, email: "b@x.test", firstName: "Bea" }];
    const r = await runServicingWindDownPass(NOW);
    expect(r).toMatchObject({ lendersInWindDown: 1, lenderNoticesSent: 1, borrowerNoticesSent: 0 });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ purpose: "system", to: "owner@lender.test", organizationId: 7 });
    expect(h.sent[0].idempotencyKey).toBe(`servicing-wind-down:lender:7:${daysAgo(10).toISOString()}`);
    expect(String(h.sent[0].text)).toMatch(/1 active note/);
  });

  it("after it, each BORROWER is told to pay the lender directly, on the lender's own (counterparty) lane", async () => {
    h.orgs = [{ id: 7, name: "Mesa Land", subscriptionStatus: "cancelled", subscriptionEndedAt: daysAgo(95) }];
    h.book = [
      { noteId: 1, email: "b@x.test", firstName: "Bea" },
      { noteId: 2, email: null, firstName: null },
    ];
    const r = await runServicingWindDownPass(NOW);
    expect(r).toMatchObject({ borrowerNoticesSent: 1, borrowersWithoutEmail: 1, lenderNoticesSent: 0 });
    expect(h.sent[0]).toMatchObject({ purpose: "counterparty", to: "b@x.test", organizationId: 7 });
    expect(h.sent[0].idempotencyKey).toBe(`servicing-wind-down:borrower:7:1:${daysAgo(95).toISOString()}`);
    expect(String(h.sent[0].text)).toMatch(/Mesa Land no longer services your loan through AcreOS/);
  });

  it("a refused send is counted as not sent, never as sent", async () => {
    h.orgs = [{ id: 7, name: "Mesa Land", subscriptionStatus: "cancelled", subscriptionEndedAt: daysAgo(95) }];
    h.book = [{ noteId: 1, email: "b@x.test", firstName: "Bea" }];
    h.sendResult = { success: false, errorType: "no_org_identity" };
    const r = await runServicingWindDownPass(NOW);
    expect(r).toMatchObject({ borrowerNoticesSent: 0, borrowerNoticesNotSent: 1 });
  });

  it("no live book, nothing to tell; an active lender is never touched", async () => {
    h.orgs = [{ id: 7, name: "Mesa Land", subscriptionStatus: "cancelled", subscriptionEndedAt: daysAgo(10) }];
    h.book = [];
    expect((await runServicingWindDownPass(NOW)).lenderNoticesSent).toBe(0);
    expect(h.sent).toEqual([]);
  });

  it("borrower notices stop being attempted 30 days after the wind-down ends", async () => {
    h.orgs = [{ id: 7, name: "Mesa Land", subscriptionStatus: "cancelled", subscriptionEndedAt: daysAgo(90 + 31) }];
    h.book = [{ noteId: 1, email: "b@x.test", firstName: "Bea" }];
    await runServicingWindDownPass(NOW);
    expect(h.sent).toEqual([]);
  });
});
