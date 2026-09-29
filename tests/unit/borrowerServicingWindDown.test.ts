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
  selects: [] as Array<{ table: string; where: string }>,
  noteUpdates: [] as Array<{ noteId: number; patch: Record<string, unknown>; orgId: number }>,
  revokes: [] as Array<Record<string, unknown>>,
  stampReturns: true,
}));

vi.mock("../../server/storage", () => ({
  storage: {
    updateNote: async (noteId: number, patch: Record<string, unknown>, orgId: number) => {
      h.noteUpdates.push({ noteId, patch, orgId });
    },
  },
}));
vi.mock("../../server/services/achMandateSetup", () => ({
  revokeAchMandatesForNote: async (input: Record<string, unknown>) => {
    h.revokes.push(input);
    return 1;
  },
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
    q.where = (w: unknown) => {
      h.selects.push({ table, where: render(w) });
      return q;
    };
    q.orderBy = () => q;
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
        return {
          returning: async () =>
            h.stampReturns
              ? h.orgs.filter((o) => !o.subscriptionEndedAt).map((o) => ({ id: o.id, subscriptionEndedAt: set.subscriptionEndedAt }))
              : [],
        };
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
  h.selects = [];
  h.noteUpdates = [];
  h.revokes = [];
  h.stampReturns = true;
});

describe("the phase rule", () => {
  it("a subscription that has not ended is full servicing — whatever its billing state", () => {
    for (const s of ["active", "trialing", "past_due", "paused", "suspended", "unpaid"]) {
      expect(servicingPhaseFor({ subscriptionStatus: s, subscriptionEndedAt: daysAgo(400) }, NOW).phase, s).toBe("full");
    }
  });

  it("wind-down for 90 days after it ended, then ended — every spelling of an end", () => {
    expect(WIND_DOWN_DAYS).toBe(90);
    for (const s of ["cancelled", "canceled", "expired", "incomplete_expired"]) {
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
    expect(phase).toMatchObject({ phase: "wind_down", endedAt: NOW });
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].table).toBe("organizations");
    expect(h.updates[0].set.subscriptionEndedAt).toBe(NOW);
    // …for this lender only, and only over a NULL stamp — a concurrent
    // caller's stamp is never overwritten.
    expect(h.updates[0].where).toMatch(/"organizations"\."id" = \$1/);
    expect(h.updates[0].where).toMatch(/"organizations"\."subscription_ended_at" is null/);
  });

  it("the sweep stamps only ENDED subscriptions with no stamp (never an active one, never re-stamps)", async () => {
    const { stampUnstampedSubscriptionEnds } = await import("../../server/services/borrower/servicingPhase");
    await stampUnstampedSubscriptionEnds(NOW);
    const where = h.updates[0].where;
    expect(where).toMatch(/"organizations"\."subscription_status" in \(\$1, \$2, \$3, \$4\)/);
    expect(where).toMatch(/"organizations"\."subscription_ended_at" is null/);
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
  it("during the wind-down the LENDER is told, once per end date and address, on the system lane", async () => {
    h.orgs = [
      { id: 7, name: "Mesa Land", subscriptionStatus: "cancelled", subscriptionEndedAt: daysAgo(10) },
      { id: 8, name: "Active Co", subscriptionStatus: "active", subscriptionEndedAt: null },
    ];
    h.book = [{ noteId: 1, autoPayEnabled: true, email: "b@x.test", firstName: "Bea" }];
    const r = await runServicingWindDownPass(NOW);
    expect(r).toMatchObject({ lendersInWindDown: 1, lenderNoticesSent: 1, borrowerNoticesSent: 0, autopayStopped: 0 });
    expect(h.sent).toHaveLength(1); // the active lender is never touched
    expect(h.sent[0]).toMatchObject({ purpose: "system", to: "owner@lender.test", organizationId: 7 });
    expect(h.sent[0].idempotencyKey).toBe(`servicing-wind-down:lender:7:${daysAgo(10).toISOString()}:owner@lender.test`);
    expect(h.noteUpdates).toEqual([]); // autopay keeps running during the wind-down
    // The owner must be an ACTIVE owner WITH an address.
    const ownerQuery = h.selects.find((q) => q.table === "team_members")!.where;
    expect(ownerQuery).toMatch(/"team_members"\."role" = \$\d/);
    expect(ownerQuery).toMatch(/"team_members"\."is_active" = \$\d/);
    expect(ownerQuery).toMatch(/"team_members"\."email" is not null/);
  });

  it("the lender notice is byte-identical from one day to the next, even as the book changes (its idempotency claim hashes it)", async () => {
    h.orgs = [{ id: 7, name: "Mesa Land", subscriptionStatus: "cancelled", subscriptionEndedAt: daysAgo(10) }];
    h.book = [{ noteId: 1, autoPayEnabled: false, email: "b@x.test", firstName: "Bea" }];
    await runServicingWindDownPass(NOW);
    h.book = [...h.book, { noteId: 2, autoPayEnabled: false, email: "c@x.test", firstName: "Cy" }];
    await runServicingWindDownPass(new Date(NOW.getTime() + 86_400_000));
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].html).toBe(h.sent[0].html);
    expect(h.sent[1].text).toBe(h.sent[0].text);
    expect(h.sent[1].idempotencyKey).toBe(h.sent[0].idempotencyKey);
  });

  it("after it, each BORROWER is told to pay the lender directly, on the lender's own (counterparty) lane", async () => {
    h.orgs = [{ id: 7, name: "Mesa Land", subscriptionStatus: "cancelled", subscriptionEndedAt: daysAgo(95) }];
    h.book = [
      { noteId: 1, autoPayEnabled: true, email: "B@x.test", firstName: "Bea" },
      { noteId: 3, autoPayEnabled: false, email: "b@x.test", firstName: "Bea" }, // same borrower, second note
      { noteId: 2, autoPayEnabled: false, email: null, firstName: null },
    ];
    const r = await runServicingWindDownPass(NOW);
    expect(r).toMatchObject({ borrowerNoticesSent: 1, borrowersWithoutEmail: 1, lenderNoticesSent: 0, autopayStopped: 1 });
    expect(h.sent).toHaveLength(1); // one notice per address, not per note
    expect(h.sent[0]).toMatchObject({ purpose: "counterparty", to: "b@x.test", organizationId: 7 });
    expect(h.sent[0].idempotencyKey).toBe(`servicing-wind-down:borrower:7:b@x.test:${daysAgo(95).toISOString()}`);
    expect(String(h.sent[0].text)).toMatch(/Mesa Land no longer services your loan through AcreOS/);
  });

  it("at the end, autopay is switched off and the AcreOS bank authorization withdrawn — 'has stopped' is true in state", async () => {
    h.orgs = [{ id: 7, name: "Mesa Land", subscriptionStatus: "cancelled", subscriptionEndedAt: daysAgo(95) }];
    h.book = [
      { noteId: 1, autoPayEnabled: true, email: "b@x.test", firstName: "Bea" },
      { noteId: 2, autoPayEnabled: false, email: "c@x.test", firstName: "Cy" },
    ];
    await runServicingWindDownPass(NOW);
    expect(h.noteUpdates).toEqual([{ noteId: 1, patch: { autoPayEnabled: false }, orgId: 7 }]);
    expect(h.revokes).toEqual([{ organizationId: 7, noteId: 1, reason: "lender_servicing_ended", at: NOW }]);
  });

  it("a refused send is counted as not sent, never as sent", async () => {
    h.orgs = [{ id: 7, name: "Mesa Land", subscriptionStatus: "cancelled", subscriptionEndedAt: daysAgo(95) }];
    h.book = [{ noteId: 1, autoPayEnabled: false, email: "b@x.test", firstName: "Bea" }];
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
    h.book = [{ noteId: 1, autoPayEnabled: false, email: "b@x.test", firstName: "Bea" }];
    await runServicingWindDownPass(NOW);
    expect(h.sent).toEqual([]);
  });
});
