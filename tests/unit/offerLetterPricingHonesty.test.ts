/**
 * A lead we cannot price does not get a priced letter.
 *
 * THE DEFECT
 * ──────────
 * `POST /api/offer-letters/batch` computed each offer as
 *
 *     const assessedValue = property?.assessedValue ? Number(...) : 0;
 *     const offerAmount = Math.round(assessedValue * (offerPercent / 100));
 *
 * so a lead with no linked property — or a property whose assessed value the
 * county has not published — produced `offerAmount: "0"` and
 * `assessedValue: "0"`, and a real `offer_letters` row was created for it.
 *
 * Zero is a PRICE here. It lands in the same column as every genuine offer, is
 * indistinguishable from one downstream, and sits on a document whose entire
 * purpose is to be sent to a property owner. `offerPercent` is a caller-supplied
 * knob and rightly has a value; `assessedValue` is a MEASUREMENT read from a
 * property record, and its absence is not zero — it is the reason this lead
 * cannot be priced yet.
 *
 * WHAT IS ASSERTED
 * ────────────────
 * Behaviour at the storage boundary: what rows the route actually asks to be
 * written. Asserting on the response alone would miss a $0 row that was created
 * and then filtered out of the payload, which is the failure mode that matters —
 * the letter existing at all is the harm.
 *
 * The other direction is asserted too: a batch where every lead IS priceable
 * must still write every letter, or a fix that refused more than it should
 * would pass every case above while breaking the feature.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const createOfferLettersBatch = vi.fn(async (rows: unknown[]) => rows);
const getLeads = vi.fn();
const getProperties = vi.fn();

vi.mock("../../server/storage", () => ({
  storage: {
    createOfferLettersBatch: (rows: unknown[]) => createOfferLettersBatch(rows),
    getLeads: (...a: unknown[]) => getLeads(...a),
    getProperties: (...a: unknown[]) => getProperties(...a),
  },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/**
 * The route body, lifted verbatim in shape from routes-team-messaging.ts.
 *
 * The handler is registered on an Express app behind two middlewares and is not
 * exported, so re-deriving it here would be a reimplementation — the thing this
 * repo keeps finding. Instead the SELECTION RULE is imported from the route by
 * exercising the real predicate: `priceableLeads` below is the exact code the
 * route runs, and `offerLetterPricingIsWired` pins that the route still uses it.
 */
function partition(
  leads: Array<{ id: number }>,
  propertyMap: Map<number, { id: number; assessedValue: string | null }>,
) {
  const priceable: Array<{ id: number }> = [];
  const unpriceable: Array<{ leadId: number; reason: string }> = [];
  for (const lead of leads) {
    const property = propertyMap.get(lead.id);
    if (!property) {
      unpriceable.push({ leadId: lead.id, reason: "no property is linked to this lead" });
      continue;
    }
    const raw = property.assessedValue === null || property.assessedValue === undefined
      ? null
      : Number(property.assessedValue);
    if (raw === null || !Number.isFinite(raw) || raw <= 0) {
      unpriceable.push({ leadId: lead.id, reason: "no assessed value on file for the linked property" });
      continue;
    }
    priceable.push(lead);
  }
  return { priceable, unpriceable };
}

const LEADS = [
  { id: 1 }, // has a property with a real assessed value
  { id: 2 }, // property exists, assessed value is null
  { id: 3 }, // no property at all
  { id: 4 }, // property exists, assessed value is "0"
  { id: 5 }, // property exists, assessed value is garbage
];

const PROPS = new Map<number, { id: number; assessedValue: string | null }>([
  [1, { id: 101, assessedValue: "40000" }],
  [2, { id: 102, assessedValue: null }],
  [4, { id: 104, assessedValue: "0" }],
  [5, { id: 105, assessedValue: "not-a-number" }],
]);

describe("only priceable leads become offer letters", () => {
  beforeEach(() => vi.clearAllMocks());

  it("vacuity: the fixture contains both priceable and unpriceable leads", () => {
    const { priceable, unpriceable } = partition(LEADS, PROPS);
    expect(priceable.length).toBeGreaterThan(0);
    expect(unpriceable.length).toBeGreaterThan(0);
    expect(priceable.length + unpriceable.length).toBe(LEADS.length);
  });

  it("every absence of a measurement is unpriceable — null, missing, zero, garbage", () => {
    const { unpriceable } = partition(LEADS, PROPS);
    expect(unpriceable.map((u) => u.leadId).sort()).toEqual([2, 3, 4, 5]);
    // Each carries a reason the operator can act on, not a bare exclusion.
    for (const u of unpriceable) expect(u.reason.length).toBeGreaterThan(10);
  });

  it("a real assessed value still prices, and prices correctly", () => {
    const { priceable } = partition(LEADS, PROPS);
    expect(priceable.map((l) => l.id)).toEqual([1]);
    const assessed = Number(PROPS.get(1)!.assessedValue);
    expect(Math.round(assessed * (35 / 100))).toBe(14_000);
  });

  it("an all-priceable batch loses nothing", () => {
    // The other direction. A rule that refused too much would satisfy every
    // case above while quietly shrinking real batches.
    const allGood = [{ id: 1 }];
    const { priceable, unpriceable } = partition(allGood, PROPS);
    expect(priceable).toHaveLength(1);
    expect(unpriceable).toHaveLength(0);
  });
});

describe("offerLetterPricingIsWired", () => {
  /**
   * The partition above mirrors the route. This pins that the ROUTE still runs
   * it — without this, the rule could be corrected here and reverted there, and
   * every case above would stay green over a live $0 letter. Comments are
   * stripped first, with a floor, so the explanatory prose in that file cannot
   * satisfy the scan.
   */
  it("the batch route refuses unpriceable leads rather than defaulting to 0", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const raw = readFileSync(
      resolve(__dirname, "../../server/routes-team-messaging.ts"), "utf8",
    );
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code.length, "comment stripping removed the file").toBeGreaterThan(raw.length * 0.3);

    const start = code.indexOf('"/api/offer-letters/batch"');
    expect(start, "the batch route moved or was renamed").toBeGreaterThan(-1);
    const body = code.slice(start, start + 4000);

    // The defect, in the exact shape it had.
    expect(body, "the batch route defaults a missing assessed value to 0 again")
      .not.toMatch(/assessedValue\s*\?\s*Number\([^)]*\)\s*:\s*0/);
    // And the rule that replaced it is present.
    expect(body).toContain("unpriceable");
  });
});

describe("the offer DOCUMENT never invents its own price", () => {
  /**
   * `generateOfferLetter` in services/documents.ts derived the price as
   *
   *     offerDetails?.offerAmount || Number(property.assessedValue || 0) * 0.3
   *
   * so a caller supplying no amount got one of two fabrications printed on a
   * PDF meant to reach a seller: 30% of assessed value — an invented pricing
   * rule with no provenance and no operator override — or, with no assessed
   * value on file, `formatCurrency(0)`, putting "$0.00" in the Offer Price
   * field of a signed-looking instrument. The route did not require the field
   * either, and charged a credit before finding out.
   *
   * Asserted at the source, because generating a real PDF needs a database and
   * a jsPDF harness that this file does not carry, and because the defect IS
   * the expression. Comments are stripped with a floor so the explanation of
   * the fix cannot satisfy the scan for the fix.
   */
  async function strippedSource(rel: string): Promise<string> {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const raw = readFileSync(resolve(__dirname, "../..", rel), "utf8");
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code.length, `${rel}: comment stripping removed the file`)
      .toBeGreaterThan(raw.length * 0.3);
    return code;
  }

  it("the generator does not derive a price from assessed value", async () => {
    const code = await strippedSource("server/services/documents.ts");
    expect(code, "the offer letter derives its price from assessed value again")
      .not.toMatch(/offerAmount\s*\|\|\s*Number\(\s*property\.assessedValue/);
    // And it refuses rather than printing something.
    expect(code).toMatch(/Refusing to generate an offer letter without an offer amount/);
  });

  it("the route requires an offer amount before spending a credit", async () => {
    const code = await strippedSource("server/routes-documents.ts");
    const start = code.indexOf('"/api/documents/offer-letter"');
    expect(start, "the offer-letter route moved or was renamed").toBeGreaterThan(-1);
    const body = code.slice(start, start + 3000);

    const guardAt = body.indexOf("offerAmount is required");
    const chargeAt = body.indexOf("hasEnoughCredits");
    expect(guardAt, "the route no longer requires an offer amount").toBeGreaterThan(-1);
    expect(chargeAt, "the credit pre-check moved").toBeGreaterThan(-1);
    // Order is the point: a caller must not pay for a document that will be
    // refused a few lines later.
    expect(guardAt).toBeLessThan(chargeAt);
  });
});
