/**
 * Rehab scope templates are a starting SCOPE, not market estimates (P1-C item 8).
 *
 * server/routes-rehabs.ts shipped an "Atlanta starter" template with hardcoded
 * Atlanta costs ("~$50-65K total at 1500 sqft (Devon's typical project)" —
 * Devon is a review persona) that were written into ANY market's budget, a
 * "10% contingency reserve" line that was really a flat $6/sqft, and a silent
 * 1,500 sqft default. Drives the REAL exported templates and the REAL seeding
 * projection.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { SCOPE_TEMPLATES, templateLineItems } from "../../server/routes-rehabs";

const PERSONAS = /\b(devon|brigid|imelda|aniyah|magnus|mae|krieger|soren)\b/i;
const MARKETS = /\b(atlanta|nashville|austin|phoenix|dallas|houston|metro)\b/i;

describe("rehab scope templates", () => {
  it("has templates to check (vacuity floor)", () => {
    expect(SCOPE_TEMPLATES.length).toBeGreaterThanOrEqual(4);
  });

  for (const tpl of SCOPE_TEMPLATES) {
    describe(tpl.key, () => {
      it("seeds every line with a $0 budget for the operator to price", () => {
        const items = templateLineItems(tpl);
        expect(items.length).toBe(tpl.lines.length);
        expect(items.length).toBeGreaterThan(0);
        for (const it of items) expect(it.budgetCents).toBe(0);
        // No cost fields survive on the template itself.
        for (const line of tpl.lines as any[]) {
          expect(line.fixedCents).toBeUndefined();
          expect(line.perSqftCents).toBeUndefined();
        }
      });

      it("names no persona, no market, and no dollar estimate", () => {
        const text = [tpl.key, tpl.label, tpl.description, ...tpl.lines.map((l) => l.scope)].join(" ");
        expect(text).not.toMatch(PERSONAS);
        expect(text).not.toMatch(MARKETS);
        expect(text).not.toMatch(/\$\s?\d|\d+\s?K\b/);
        expect(tpl.description).toMatch(/enter your own cost/i);
      });

      it("has no contingency line claiming a percentage it does not compute", () => {
        for (const line of tpl.lines) {
          if (line.category === "contingency" || /contingenc/i.test(line.scope)) {
            expect(line.scope).not.toMatch(/%/);
          }
        }
      });
    });
  }
});
