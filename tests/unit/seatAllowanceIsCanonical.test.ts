/**
 * A plan's included seats are usable without support, add-on billing counts
 * only the seats beyond them, and every seat reader goes through ONE rule.
 *
 * THE DEFECT. `organizations.seat_count` defaults to 1 and nothing raised it,
 * while TIER_LIMITS says Pro includes 2 seats and Scale 10 (founder decision
 * 2026-07-08). The invite check compared projected seats with seat_count, so
 * a Pro owner could not invite a first teammate. The add-on math billed every
 * seat past the FIRST (`seatCount - 1`) — in the bill preview and in the
 * quantity synced to Stripe — and the seat ceiling came from a second table
 * (tier-pricing.ts `maxSeats: null`) that disagreed with tier-limits.ts (Pro 5,
 * Scale 100).
 *
 * WHAT IS PINNED.
 *   1. The rule itself (shared/billing/seats.ts), for every tier, from
 *      TIER_LIMITS — not a copy of the numbers.
 *   2. The Stripe quantity syncSeatAddon actually sends, through the real
 *      function (law 2: the surface, not the helper).
 *   3. Adoption over the whole server population (law 3): every read of the
 *      stored seat columns (`.seatCount`, `.additionalSeats`) is handed straight
 *      to a canonical seat function, or sits in the one registered loader.
 *      Canaries hide each defect shape in a fixture; a floor proves the walker
 *      read the tree.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { listServerSources, parseSource, rel, ownerFunctionName, unwrap } from "../helpers/serverPopulation";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const h = vi.hoisted(() => {
  process.env.STRIPE_PRICE_OPERATOR_SEAT_MONTHLY = "price_test_pro_seat_monthly";
  process.env.STRIPE_PRICE_EMPIRE_SEAT_MONTHLY = "price_test_scale_seat_monthly";
  return {
    org: null as null | Record<string, unknown>,
    existingSeatItem: null as null | { id: string },
    calls: [] as Array<{ op: string; quantity?: number }>,
  };
});

vi.mock("../../server/storage", () => ({
  storage: {},
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(h.org ? [h.org] : []) }) }),
  },
}));
vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: async () => ({
    subscriptions: {
      retrieve: async () => ({
        items: { data: h.existingSeatItem ? [{ id: h.existingSeatItem.id, price: { id: "price_test_pro_seat_monthly" } }] : [] },
      }),
    },
    subscriptionItems: {
      create: async (a: { quantity: number }) => (h.calls.push({ op: "create", quantity: a.quantity }), { id: "si_new" }),
      update: async (_id: string, a: { quantity: number }) => (h.calls.push({ op: "update", quantity: a.quantity }), { id: "si_upd" }),
      del: async () => (h.calls.push({ op: "del" }), { id: "si_del" }),
    },
  }),
}));

import { TIER_LIMITS, type SubscriptionTier } from "@shared/billing/tier-limits";
import { TIER_PRICES_CENTS, type Tier } from "@shared/billing/tier-pricing";
import {
  effectiveSeatAllowance,
  billableExtraSeats,
  planAdmitsSeats,
  seatAddonCents,
  totalMonthlyBillCents,
} from "@shared/billing/seats";
import { syncSeatAddon } from "../../server/services/billing/seatBilling";

const TIERS = Object.keys(TIER_LIMITS) as SubscriptionTier[];
const PAID: Tier[] = ["starter", "pro", "scale"];

describe("the seat rule reads TIER_LIMITS", () => {
  it("an org on the default seat_count can fill every seat its plan includes", () => {
    for (const t of TIERS) {
      expect(effectiveSeatAllowance(t, 1), t).toBe(TIER_LIMITS[t].includedSeats);
      expect(effectiveSeatAllowance(t, null), t).toBe(TIER_LIMITS[t].includedSeats);
      expect(planAdmitsSeats(t, TIER_LIMITS[t].includedSeats), t).toBe(true);
    }
    // The founder-decided numbers this rests on (2026-07-08 memo).
    expect(effectiveSeatAllowance("pro", 1)).toBe(2);
    expect(effectiveSeatAllowance("scale", 1)).toBe(10);
    // Legacy tier names fold to the tier they bill as.
    expect(effectiveSeatAllowance("operator", 1)).toBe(TIER_LIMITS.pro.includedSeats);
  });

  it("a stored seat_count above the included seats raises the allowance; legacy additional seats add on top", () => {
    expect(effectiveSeatAllowance("pro", 4)).toBe(4);
    expect(effectiveSeatAllowance("pro", 1, 1)).toBe(TIER_LIMITS.pro.includedSeats + 1);
  });

  it("add-on billing counts only the seats beyond the included ones", () => {
    for (const t of PAID) {
      const inc = TIER_LIMITS[t].includedSeats;
      const per = TIER_PRICES_CENTS[t].priceMonthlyPerSeatCents;
      expect(billableExtraSeats(t, inc), t).toBe(0);
      expect(seatAddonCents(t, inc), t).toBe(0);
      expect(totalMonthlyBillCents(t, inc), t).toBe(TIER_PRICES_CENTS[t].priceMonthlyCents);
      if (per !== null) {
        expect(billableExtraSeats(t, inc + 1), t).toBe(1);
        expect(seatAddonCents(t, inc + 1), t).toBe(per);
        expect(seatAddonCents(t, inc + 1, "yearly"), t).toBe(per * 10);
      }
    }
  });

  it("the seat ceiling is TIER_LIMITS.maxSeats — the pricing table carries no second one", () => {
    for (const t of TIERS) {
      const max = TIER_LIMITS[t].maxSeats;
      if (max !== null) {
        expect(planAdmitsSeats(t, max), t).toBe(true);
        expect(planAdmitsSeats(t, max + 1), t).toBe(false);
      } else {
        expect(planAdmitsSeats(t, 10_000), t).toBe(TIER_LIMITS[t].seatPriceCents !== null);
      }
    }
    for (const t of PAID) expect(Object.keys(TIER_PRICES_CENTS[t]), t).not.toContain("maxSeats");
  });
});

describe("syncSeatAddon sends Stripe only the seats beyond the included ones", () => {
  beforeEach(() => {
    h.calls = [];
    h.existingSeatItem = null;
  });
  const org = (seatTier: string) => ({
    id: 7,
    subscriptionTier: seatTier,
    stripeSubscriptionId: "sub_test",
    billingInterval: "monthly",
  });

  it("Pro at its included seats bills no add-on (and removes a stale one)", async () => {
    h.org = org("pro");
    expect((await syncSeatAddon(7, TIER_LIMITS.pro.includedSeats)).quantity).toBe(0);
    expect(h.calls).toEqual([]);
    h.existingSeatItem = { id: "si_old" };
    await syncSeatAddon(7, TIER_LIMITS.pro.includedSeats);
    expect(h.calls).toEqual([{ op: "del" }]);
  });

  it("Pro one past its included seats bills exactly one add-on seat", async () => {
    h.org = org("pro");
    const r = await syncSeatAddon(7, TIER_LIMITS.pro.includedSeats + 1);
    expect(r.quantity).toBe(1);
    expect(h.calls).toEqual([{ op: "create", quantity: 1 }]);
  });

  it("refuses a seat count the plan's ceiling does not admit", async () => {
    h.org = org("pro");
    await expect(syncSeatAddon(7, (TIER_LIMITS.pro.maxSeats ?? 0) + 1)).rejects.toThrow(/upgrade first/);
    expect(h.calls).toEqual([]);
  });
});

// ── Adoption over the server population ────────────────────────────────────

/** Functions a stored seat column may be handed to directly. */
const CANONICAL_SEAT_FUNCTIONS = new Set([
  "effectiveSeatAllowance",
  "billableExtraSeats",
  "seatAddonCents",
  "totalMonthlyBillCents",
  "describeSeatPricing",
]);

/**
 * (file::function) sites allowed to read a stored seat column for another
 * purpose, and why. Anything new here needs the same justification.
 */
const REGISTERED_SEAT_READERS: Record<string, string> = {
  "server/services/usageLimits.ts::getOrganizationSeatData":
    "the loader for getSeatInfo, which hands both columns to effectiveSeatAllowance",
};

const SEAT_COLUMNS = new Set(["seatCount", "additionalSeats"]);
/** Receivers that are not a stored seat value: the column itself, and the request body. */
const NOT_A_STORED_VALUE = new Set(["organizations", "parsed.data"]);

function seatReads(fileName: string, text: string): { all: number; offenders: string[] } {
  const sf = parseSource(fileName, text);
  let all = 0;
  const offenders: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && SEAT_COLUMNS.has(node.name.text)) {
      const receiver = unwrap(node.expression).getText(sf);
      if (!NOT_A_STORED_VALUE.has(receiver)) {
        all++;
        let arg: ts.Node = node;
        while (arg.parent && (ts.isParenthesizedExpression(arg.parent) || ts.isAsExpression(arg.parent) || ts.isNonNullExpression(arg.parent))) {
          arg = arg.parent;
        }
        const call = arg.parent;
        const handedToCanonical =
          call !== undefined &&
          ts.isCallExpression(call) &&
          call.arguments.includes(arg as ts.Expression) &&
          CANONICAL_SEAT_FUNCTIONS.has(
            ts.isIdentifier(call.expression)
              ? call.expression.text
              : ts.isPropertyAccessExpression(call.expression)
                ? call.expression.name.text
                : "",
          );
        const site = `${fileName}::${ownerFunctionName(node)}`;
        if (!handedToCanonical && !(site in REGISTERED_SEAT_READERS)) offenders.push(`${site} (${node.getText(sf)})`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { all, offenders };
}

describe("every server read of a stored seat column goes through the seat rule", () => {
  it("canaries: each defect shape is seen, the canonical shape is not", () => {
    expect(seatReads("x.ts", "function f(org){ return org.seatCount - 1; }").offenders).toHaveLength(1);
    expect(seatReads("x.ts", "function f(org){ const n = (org as any).seatCount ?? 1; return n; }").offenders).toHaveLength(1);
    expect(seatReads("x.ts", "function f(org){ return 2 + org.additionalSeats; }").offenders).toHaveLength(1);
    expect(seatReads("x.ts", "function f(org){ return effectiveSeatAllowance(org.subscriptionTier, org.seatCount, org.additionalSeats); }").offenders).toHaveLength(0);
    expect(seatReads("x.ts", "function f(org, i){ return seatAddonCents(t, (org.seatCount as number), i); }").offenders).toHaveLength(0);
    // A comment naming the old arithmetic is not a read.
    expect(seatReads("x.ts", "// org.seatCount - 1\nfunction f(){}").all).toBe(0);
  });

  it("over every non-test server source", () => {
    const files = listServerSources();
    expect(files.length, "population floor: the walker did not read the server tree").toBeGreaterThan(1000);
    let reads = 0;
    const offenders: string[] = [];
    const readersPerFile = new Map<string, number>();
    for (const f of files) {
      const r = seatReads(rel(f), fs.readFileSync(f, "utf8"));
      reads += r.all;
      if (r.all) readersPerFile.set(rel(f), r.all);
      offenders.push(...r.offenders);
    }
    expect(offenders, "a stored seat column is read outside the seat rule (shared/billing/seats.ts)").toEqual([]);
    // Vacuity: the known readers are still being found.
    for (const f of ["server/routes-organization.ts", "server/routes-team-readiness.ts", "server/services/usageLimits.ts"]) {
      expect(readersPerFile.get(f) ?? 0, `${f}: no seat read found — has the parser stopped matching?`).toBeGreaterThan(0);
    }
    expect(reads).toBeGreaterThanOrEqual(8);
  });
});
