/**
 * Founder decision 2026-10-17 B: "I should never be in the red for offering
 * mailer service." For EVERY spec AcreOS house mail prints, and for EVERY
 * price list a house piece can be charged from:
 *
 *   credits charged × CREDIT_PRICE_CENTS ≥ provider cost × (1 + card fee) × (1 + margin floor)
 *
 * The population is the cost table itself (HOUSE_MAIL_COST_TABLE) crossed
 * with the price lists that can charge a house piece — the credit weights
 * (per-piece lanes, outreach queue) and the campaign send's DIRECT_MAIL_COSTS.
 * A row added to the table is checked automatically; a price list added
 * without being added to PRICE_LISTS fails the coverage check below.
 *
 * Canary rows (a cost the listing cannot cover) prove the inequality is a
 * real predicate, and the floor is what rescues them.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  HOUSE_MAIL_COST_TABLE,
  HOUSE_MAIL_CARD_FEE_ALLOWANCE,
  HOUSE_MAIL_MARGIN_FLOOR,
  houseMailChargeIsSelfFunding,
  houseMailCreditsPerPiece,
  houseMailMinimumCredits,
  houseMailSpecKey,
  type HouseMailSpecKey,
} from "@shared/billing/house-mail-pricing";
import { CREDIT_PRICE_CENTS, CREDIT_PACK_CATALOG } from "@shared/billing/credit-packs";
import { CREDIT_WEIGHTS } from "@shared/billing/credit-weights";
import { DIRECT_MAIL_COSTS } from "../../server/services/sendPricing";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

/** Every price list a house piece can be charged from, per spec it can price. */
const PRICE_LISTS: Record<string, Partial<Record<HouseMailSpecKey, number>>> = {
  // mailLane.listedCreditsFor: postcards list at postcard_lob, letters at letter_lob.
  "credit weights (per-piece lanes, outreach queue)": {
    postcard_4x6: CREDIT_WEIGHTS.postcard_lob,
    postcard_6x9: CREDIT_WEIGHTS.postcard_lob,
    postcard_6x11: CREDIT_WEIGHTS.postcard_lob,
    letter_bw: CREDIT_WEIGHTS.letter_lob,
    letter_color: CREDIT_WEIGHTS.letter_lob,
  },
  // routes-campaigns send-direct-mail: listedCredits = DIRECT_MAIL_COSTS[pieceType].
  "campaign send (DIRECT_MAIL_COSTS)": {
    postcard_4x6: DIRECT_MAIL_COSTS.postcard_4x6,
    postcard_6x9: DIRECT_MAIL_COSTS.postcard_6x9,
    postcard_6x11: DIRECT_MAIL_COSTS.postcard_6x11,
    letter_bw: DIRECT_MAIL_COSTS.letter_1_page,
  },
};

describe("the constants are the founder's stated numbers", () => {
  it("card fee covers Stripe's worst case on the smallest pack; margin floor is 10%", () => {
    const smallest = Math.min(...Object.values(CREDIT_PACK_CATALOG).map((p) => p.priceCents));
    expect(smallest).toBe(1000);
    const stripeWorstCaseCents = smallest * 0.029 + 30;
    expect(HOUSE_MAIL_CARD_FEE_ALLOWANCE).toBeGreaterThanOrEqual(stripeWorstCaseCents / smallest - 1e-9);
    expect(HOUSE_MAIL_CARD_FEE_ALLOWANCE).toBe(0.059);
    expect(HOUSE_MAIL_MARGIN_FLOOR).toBe(0.1);
    expect(CREDIT_PRICE_CENTS).toBe(1.5);
  });
});

describe("every spec in the cost table pays for itself, on every price list", () => {
  it("the table is not empty and every row has a positive cost (vacuity)", () => {
    expect(HOUSE_MAIL_COST_TABLE.length).toBeGreaterThanOrEqual(5);
    for (const row of HOUSE_MAIL_COST_TABLE) expect(row.providerCostCents, row.key).toBeGreaterThan(0);
  });

  for (const [list, prices] of Object.entries(PRICE_LISTS)) {
    for (const row of HOUSE_MAIL_COST_TABLE) {
      const listed = prices[row.key];
      if (listed === undefined) continue;
      it(`${list}: ${row.key} — charged credits × ${CREDIT_PRICE_CENTS}¢ ≥ ${row.providerCostCents}¢ × fee × margin`, () => {
        const charged = houseMailCreditsPerPiece(listed, row.providerCostCents);
        expect(houseMailChargeIsSelfFunding(charged, row.providerCostCents)).toBe(true);
        expect(charged * CREDIT_PRICE_CENTS).toBeGreaterThanOrEqual(
          row.providerCostCents * (1 + HOUSE_MAIL_CARD_FEE_ALLOWANCE) * (1 + HOUSE_MAIL_MARGIN_FLOOR) - 1e-6,
        );
        // Never below the listing: the floor only ever RAISES a price.
        expect(charged).toBeGreaterThanOrEqual(listed);
      });
    }
  }

  it("each price list covers every spec it can be asked to charge", () => {
    expect(Object.keys(PRICE_LISTS["credit weights (per-piece lanes, outreach queue)"]).sort()).toEqual(
      HOUSE_MAIL_COST_TABLE.map((r) => r.key).sort(),
    );
  });

  it("the minimum is the LEAST passing whole credit count", () => {
    for (const row of HOUSE_MAIL_COST_TABLE) {
      const min = houseMailMinimumCredits(row.providerCostCents);
      expect(houseMailChargeIsSelfFunding(min, row.providerCostCents), row.key).toBe(true);
      expect(houseMailChargeIsSelfFunding(min - 1, row.providerCostCents), row.key).toBe(false);
    }
  });

  it("the raises the rule makes are exactly the ones reported (6×11 postcard at the weight: 75 → 86)", () => {
    const raised: string[] = [];
    for (const [list, prices] of Object.entries(PRICE_LISTS)) {
      for (const row of HOUSE_MAIL_COST_TABLE) {
        const listed = prices[row.key];
        if (listed === undefined) continue;
        const charged = houseMailCreditsPerPiece(listed, row.providerCostCents);
        if (charged !== listed) raised.push(`${list}|${row.key}|${listed}->${charged}`);
      }
    }
    expect(raised).toEqual(["credit weights (per-piece lanes, outreach queue)|postcard_6x11|75->86"]);
  });
});

describe("canaries — rows that MUST fail the inequality", () => {
  const CANARIES = [
    { key: "canary_listing_below_cost", listed: 75, providerCostCents: 200 },
    { key: "canary_exact_cost_no_margin", listed: 80, providerCostCents: 120 }, // 120¢ revenue = cost: no fee, no margin
    { key: "canary_margin_only_no_fee", listed: 89, providerCostCents: 120 }, // 133.5¢ < 139.79¢
  ];
  for (const c of CANARIES) {
    it(`${c.key}: the listed price fails, the floored charge passes`, () => {
      expect(houseMailChargeIsSelfFunding(c.listed, c.providerCostCents)).toBe(false);
      const charged = houseMailCreditsPerPiece(c.listed, c.providerCostCents);
      expect(charged).toBeGreaterThan(c.listed);
      expect(houseMailChargeIsSelfFunding(charged, c.providerCostCents)).toBe(true);
    });
  }

  it("a non-positive or non-finite cost is never 'self-funding'", () => {
    expect(houseMailChargeIsSelfFunding(1000, 0)).toBe(false);
    expect(houseMailChargeIsSelfFunding(1000, Number.NaN)).toBe(false);
    expect(houseMailChargeIsSelfFunding(Number.NaN, 75)).toBe(false);
  });
});

describe("a spec with no cost row is refused, never guessed", () => {
  it("known specs resolve to their row", () => {
    expect(houseMailSpecKey({ kind: "postcard", size: "4x6" })).toBe("postcard_4x6");
    expect(houseMailSpecKey({ kind: "postcard", size: "6x11" })).toBe("postcard_6x11");
    expect(houseMailSpecKey({ kind: "letter", color: false, pages: 1 })).toBe("letter_bw");
    expect(houseMailSpecKey({ kind: "letter", color: true, pages: 1 })).toBe("letter_color");
    expect(houseMailSpecKey({ kind: "letter", pages: 1, mailClass: "usps_first_class", extraService: null })).toBe("letter_bw");
  });

  it.each([
    ["an unknown postcard size", { kind: "postcard" as const, size: "5x7" }],
    ["a two-page letter", { kind: "letter" as const, pages: 2 }],
    ["a letter whose page count is not confirmed", { kind: "letter" as const }],
    ["a letter that only carries its HTML", { kind: "letter" as const, file: "<p>Dear owner</p>" }],
    ["standard mail", { kind: "letter" as const, mailClass: "usps_standard" }],
    ["certified mail", { kind: "letter" as const, extraService: "certified" }],
    ["registered postcard", { kind: "postcard" as const, size: "4x6", extraService: "registered" }],
  ])("%s → no row", (_label, spec) => {
    expect(houseMailSpecKey(spec)).toBeNull();
  });
});

describe("one source of AcreOS's mail cost", () => {
  it("the COGS ledger posting reads the lane's price (from the canonical table), not its own literals", () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, "server/services/directMailService.ts"), "utf8"));
    const start = src.indexOf("function lobPieceCostCents(lane: SendableMailLane)");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n}", start));
    expect(body).toMatch(/lane\.price\.providerCostCents/);
    expect(body).not.toMatch(/\b(?:65|75|85|95|110|120)\b/);
    // …and the lane's price is read from the table by houseMailProviderCostCents.
    const lane = stripComments(fs.readFileSync(path.join(ROOT, "server/services/mail/mailLane.ts"), "utf8"));
    expect(lane).toMatch(/houseMailProviderCostCents\(key\)/);
  });
});
