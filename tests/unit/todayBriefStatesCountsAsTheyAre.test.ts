/**
 * The Today brief may only describe a number as what it counts
 * (best-in-class audit 2026-10-20, §3 P1 #13).
 *
 * It used to relabel: Pax-sourced queue items became "sellers wrote back
 * overnight", active alerts "you almost lost yesterday, saved", seller-finance
 * NOTE lateness became landlords' "rents hadn't landed", and a 30-day
 * projection money that "cleared this month". The falsifiable property: with
 * a distinct value per input, every number that appears in a persona's brief
 * appears next to the phrase that names its input, and no phrase that implies
 * a measurement this route does not take appears at all.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

const { composeBrief } = await import("../../server/routes-today");

const inputs = {
  paxQueueItems: 11,
  topCounter: null,
  openAlerts: 22,
  lateNotes: 33,
  postedLast24h: 44,
  noteIncomeDue30: 5500,
  leadsUncontacted14d: 66,
  openDealsValue: 77000,
  firstClosePrefix: null,
};

const PERSONAS = [
  "wholesaler", "note_investor", "note_originator", "note_servicer", "land_investor",
  "fix_flipper", "landlord", "subdivider", "tax_delinquent", undefined,
] as const;

// What each value may be called. A number in the brief must sit beside its name.
const NAMES: Array<[RegExp, RegExp]> = [
  [/\b11\b/, /11 items? in your queue/],
  [/\b22\b/, /22 open alerts?/],
  [/\b33\b/, /33 notes? late or delinquent/],
  [/\b44\b/, /44 payments? posted in the last 24 hours/],
  [/\$5,500/, /\$5,500 (in note payments )?scheduled over the next 30 days/],
  [/\b66\b/, /66 leads? not contacted in 14\+ days/],
  [/\$77,000/, /\$77,000 in open deals/],
];

// Measurements GET /api/today does not take.
const FORBIDDEN = /wrote back|overnight|saved|almost lost|rent|hadn'?t landed|cleared|clears|surfaced|ticked over|split candidate|swung|still warm|in reach|wobbled|slipped/i;

describe("Today brief states counts as they are", () => {
  for (const persona of PERSONAS) {
    it(`${persona ?? "default"}: every number is named for what it counts`, () => {
      const brief = composeBrief(persona as any, inputs);
      expect(brief).not.toMatch(FORBIDDEN);
      for (const [num, named] of NAMES) {
        if (num.test(brief)) expect(brief).toMatch(named);
      }
      // Something real is said.
      expect(NAMES.some(([num]) => num.test(brief))).toBe(true);
    });
  }

  it("a landlord's brief never shows seller-finance note lateness as rent", () => {
    expect(composeBrief("landlord" as any, inputs)).not.toMatch(/\b33\b/);
  });
});
