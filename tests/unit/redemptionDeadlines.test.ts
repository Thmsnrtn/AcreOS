/**
 * Redemption-clock math — the deadline arithmetic, the refusal paths, and
 * the cross-registry agreement gate.
 *
 * statuteRegister `state.tax-lien-redemption` was `prose-only` and the
 * truth-sweep verification (2026-09-01) reproduced FOUR live defects behind
 * that green: (1) computeRedemptionDeadline added months via an unclamped
 * setUTCMonth — sale 2025-08-31 + 3 months returned 2025-12-01, while
 * wonBidToCertificate used the CLAMPED sibling, so the same certificate got
 * deadlines up to 3 days apart depending on which door created it; (2) a
 * bare new Date() parse rolled "2026-02-30" to March 2; (3) the two
 * registries the entry lists disagree (TN rate, TX period); (4)
 * taxLienStateRules' DE row encodes 60 MONTHS against its own "60-day"
 * note. This file pins the fixes to (1)-(2) and turns (3)-(4) into a dated
 * conflict register that can only shrink — the conflicts are LEGAL-JUDGMENT
 * questions recorded for attorney review, never adjudicated here.
 *
 * NOT PINNED: that any encoded period or rate is the correct reading of the
 * statute (attorney review; every rule carries attorneyReviewedAt: null and
 * the register entry stays UNREVIEWED), and SCRA tolling remains
 * unimplemented (its own register entry).
 */

import { describe, it, expect } from "vitest";
import {
  STATE_REDEMPTION_RULES,
  addMonthsIso,
  redemptionDeadlineFromAnchor,
  computeRedemptionDeadline,
  computeRedemptionAmount,
} from "../../server/services/redemptionClock";
import { STATE_TAX_LIEN_RULES } from "@shared/regulatory/taxLienStateRules";

describe("month arithmetic is clamped (the lost-parcel defect)", () => {
  it("clamps to the last day of the target month", () => {
    expect(addMonthsIso("2025-08-31", 3)).toBe("2025-11-30"); // not Dec 1
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28"); // not Mar 3
    expect(addMonthsIso("2024-01-31", 1)).toBe("2024-02-29"); // leap year
    expect(addMonthsIso("2025-08-15", 3)).toBe("2025-11-15"); // mid-month unchanged
  });

  it("computeRedemptionDeadline uses the clamped math end-to-end (TX both branches)", () => {
    // TX non-owner-occupied: 6 months. 2025-08-31 + 6 → 2026-02-28 (2026 is
    // not a leap year), NEVER 2026-03-03.
    expect(
      computeRedemptionDeadline({ state: "TX", saleDate: "2025-08-31", ownerOccupied: false }),
    ).toBe("2026-02-28");
    // TX owner-occupied: 24 months.
    expect(
      computeRedemptionDeadline({ state: "TX", saleDate: "2025-08-31", ownerOccupied: true }),
    ).toBe("2027-08-31");
  });
});

describe("refusal paths — never a date computed from a lie", () => {
  it("a calendar-impossible sale date is refused, never rolled over", () => {
    expect(
      computeRedemptionDeadline({ state: "TX", saleDate: "2026-02-30", ownerOccupied: false }),
    ).toBeNull();
  });

  it("no-redemption and unknown states return null", () => {
    expect(
      computeRedemptionDeadline({ state: "NC", saleDate: "2026-01-15", ownerOccupied: false }),
    ).toBeNull();
    expect(
      computeRedemptionDeadline({ state: "ZZ", saleDate: "2026-01-15", ownerOccupied: false }),
    ).toBeNull();
  });

  it("deed_recordation anchors refuse — we hold a sale date, not a recordation date", () => {
    // No production rule uses this anchor yet; the core is driven directly
    // so the refusal exists BEFORE the first such rule lands (until
    // 2026-09-01 the anchor silently computed from the sale date).
    expect(redemptionDeadlineFromAnchor("2026-01-15", 12, "deed_recordation")).toBeNull();
  });

  it("computeRedemptionAmount throws on calendar-impossible dates instead of NaN money", () => {
    expect(() =>
      computeRedemptionAmount({
        state: "AL",
        saleDate: "2026-02-30",
        asOfDate: "2026-06-01",
        purchaseAmountCents: 100_000,
      }),
    ).toThrow(/Invalid sale date/);
    expect(() =>
      computeRedemptionAmount({
        state: "AL",
        saleDate: "2026-01-15",
        asOfDate: "not-a-date",
        purchaseAmountCents: 100_000,
      }),
    ).toThrow(/Invalid as-of date/);
  });
});

describe("anchor semantics", () => {
  it("first_monday_after_sale: a mid-week sale rolls forward to Monday", () => {
    // 2026-09-01 is a Tuesday; the next Monday is 2026-09-07.
    expect(redemptionDeadlineFromAnchor("2026-09-01", 3, "first_monday_after_sale")).toBe(
      "2026-12-07",
    );
  });

  it("first_monday_after_sale: a Monday sale anchors on the sale day itself", () => {
    // Pinned explicitly because the loop's while-condition encodes this
    // reading; if the statute means the FOLLOWING Monday, this pin is where
    // that legal question surfaces.
    expect(redemptionDeadlineFromAnchor("2026-09-07", 3, "first_monday_after_sale")).toBe(
      "2026-12-07",
    );
  });

  it("sale_date anchors compute directly from the sale date", () => {
    expect(redemptionDeadlineFromAnchor("2026-09-01", 12, "sale_date")).toBe("2027-09-01");
  });
});

describe("amount models (spot pins on the encoded semantics)", () => {
  it("TX flat_first_period: redeeming on day 1 still owes the full 25%", () => {
    const amt = computeRedemptionAmount({
      state: "TX",
      saleDate: "2026-01-01",
      asOfDate: "2026-01-02",
      purchaseAmountCents: 1_000_000,
    });
    expect(amt.interestCents).toBe(250_000);
    expect(amt.totalRedemptionCents).toBe(1_250_000);
    expect(amt.preliminary).toBe(true); // attorneyReviewedAt is null
  });

  it("unknown-state fallback is labeled preliminary and uses the documented 12%", () => {
    const amt = computeRedemptionAmount({
      state: "ZZ",
      saleDate: "2025-01-01",
      asOfDate: "2026-01-01",
      purchaseAmountCents: 1_000_000,
    });
    expect(amt.preliminary).toBe(true);
    expect(amt.appliedRateBps).toBe(1_200);
  });
});

/**
 * The two registries the statute entry lists as codeSites must agree — or
 * disagree ON THE RECORD. Same doctrine as depositRegistriesAgree: two
 * numbers cannot both be shown as the law, and deciding which reading is
 * right is legal judgement, so a disagreement becomes a dated conflict
 * entry for attorney review rather than a silent pick. This register may
 * only SHRINK, and shrinking requires a recorded resolution.
 */
const KNOWN_CONFLICTS: Record<string, string> = {
  "TN:rate":
    "redemptionClock 1200 bps vs taxLienStateRules 1000 bps (Tenn. Code Ann. §67-5-2701 " +
    "vs §67-5-2010 readings). Recorded 2026-09-01 — attorney review decides; not adjudicated here.",
  "TX:period":
    "redemptionClock branches 6/24 months by owner-occupancy (Tex. Tax Code §34.21) vs " +
    "taxLienStateRules flat 24. Recorded 2026-09-01 — the branched reading matches the cited " +
    "statute's structure but the flat row is not corrected here; attorney review decides.",
  "IA:rate":
    "redemptionClock 200 bps/MONTH (interestModel monthly) vs taxLienStateRules 2400 bps/YEAR — " +
    "a unit difference (2%/month = 24%/year), numerically consistent. Recorded 2026-09-01.",
};

describe("cross-registry agreement (redemptionClock vs taxLienStateRules)", () => {
  const overlap = Object.keys(STATE_REDEMPTION_RULES).filter((s) => STATE_TAX_LIEN_RULES[s]);

  it("the overlap is non-trivial (vacuity guard)", () => {
    expect(overlap.length).toBeGreaterThanOrEqual(8);
  });

  it("periods and rates agree, or the disagreement is on the dated conflict register", () => {
    const surprises: string[] = [];
    for (const s of overlap) {
      const clock = STATE_REDEMPTION_RULES[s];
      const lien = STATE_TAX_LIEN_RULES[s];
      if (clock.interestModel === "no_redemption") continue;
      const lienMonths = lien.redemptionPeriodMonths ?? lien.postSaleRedemptionMonths;
      if (lienMonths !== null && lienMonths !== clock.redemptionPeriodMonths) {
        if (!KNOWN_CONFLICTS[`${s}:period`]) {
          surprises.push(`${s}:period — clock ${clock.redemptionPeriodMonths}mo vs lien table ${lienMonths}mo`);
        }
      }
      if (
        lien.statutoryYieldBps !== null &&
        lien.statutoryYieldBps !== clock.defaultRateBps &&
        !KNOWN_CONFLICTS[`${s}:rate`]
      ) {
        surprises.push(`${s}:rate — clock ${clock.defaultRateBps} bps vs lien table ${lien.statutoryYieldBps} bps`);
      }
    }
    expect(
      surprises,
      "the two registries disagree about a state with NO conflict record. Do not pick a side " +
        "— add a dated KNOWN_CONFLICTS entry naming both readings for attorney review, or fix " +
        "an actual typo with the citation checked:\n" + surprises.join("\n"),
    ).toEqual([]);
  });

  it("every recorded conflict still exists (the register may only shrink honestly)", () => {
    // A resolved conflict must remove its entry in the same commit — a stale
    // conflict record is the same defect as a stale baseline.
    for (const key of Object.keys(KNOWN_CONFLICTS)) {
      const [s, kind] = key.split(":");
      const clock = STATE_REDEMPTION_RULES[s];
      const lien = STATE_TAX_LIEN_RULES[s];
      expect(clock, `${key}: state gone from redemptionClock`).toBeTruthy();
      expect(lien, `${key}: state gone from taxLienStateRules`).toBeTruthy();
      if (kind === "rate") {
        expect(
          lien.statutoryYieldBps !== clock.defaultRateBps,
          `${key} is recorded as a conflict but the values now AGREE — remove the entry`,
        ).toBe(true);
      }
      if (kind === "period") {
        const lienMonths = lien.redemptionPeriodMonths ?? lien.postSaleRedemptionMonths;
        expect(
          lienMonths !== clock.redemptionPeriodMonths,
          `${key} is recorded as a conflict but the values now AGREE — remove the entry`,
        ).toBe(true);
      }
    }
  });
});

describe("prose/number coherence in taxLienStateRules notes", () => {
  // "N-year redemption" / "N-month" / "N-day redemption" in a row's own note
  // must agree with its encoded months. DE fails today (60 months vs its own
  // "60-day redemption" note) — recorded below, never adjudicated.
  const NOTE_CONFLICTS: Record<string, string> = {
    DE: "encodes redemptionPeriodMonths 60 while its own note says '60-day redemption after sale' — 5 years vs 60 days (9 Del. C. §8728/§8729 readings). Recorded 2026-09-01; attorney review decides.",
    TX: "encodes redemptionPeriodMonths 24 while its own note says '6-month redemption' — the note agrees with redemptionClock's non-homestead 6-month branch (Tex. Tax Code §34.21) but the encoded row is the 24-month homestead figure. Found by this gate 2026-09-01; attorney review decides which single value the flat row should carry.",
  };

  it("every N-year/N-month/N-day redemption phrase matches the encoded months", () => {
    let matched = 0;
    const surprises: string[] = [];
    for (const [s, r] of Object.entries(STATE_TAX_LIEN_RULES)) {
      const months = r.redemptionPeriodMonths ?? r.postSaleRedemptionMonths;
      const m = r.notes?.match(/(\d+(?:\.\d+)?)[- ](year|month|day)s?[- ']?s? (?:redemption|post-sale)/i)
        ?? r.notes?.match(/(\d+(?:\.\d+)?)[- ](year|month|day) (?:minimum )?(?:redemption|post-sale|window)/i);
      if (!m || months === null) continue;
      matched += 1;
      const n = parseFloat(m[1]);
      const unit = m[2].toLowerCase();
      const noteMonths = unit === "year" ? n * 12 : unit === "month" ? n : n / 30;
      const agrees = Math.abs(noteMonths - months) < 1.5;
      if (!agrees && !NOTE_CONFLICTS[s]) {
        surprises.push(`${s}: note says ${m[0]} but encodes ${months} months`);
      }
      if (agrees && NOTE_CONFLICTS[s]) {
        surprises.push(`${s}: recorded as a note conflict but now agrees — remove the entry`);
      }
    }
    // Vacuity floor: the parser must actually read a meaningful share of the
    // registry, or this whole describe is decoration.
    expect(matched, "note parser went blind").toBeGreaterThanOrEqual(15);
    expect(surprises, surprises.join("\n")).toEqual([]);
  });
});
