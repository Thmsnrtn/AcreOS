/**
 * Andrei (2026-06-06) — tests for the hallucination-guard source extractor.
 *
 * Verifies that extractSourceContext pulls the right numbers + entity IDs out
 * of the toolCallsExecuted shape executive.ts produces, so guardPaxOutput is
 * fed real source context instead of being called blind.
 */
import { describe, expect, it } from "vitest";
import { extractSourceContext } from "./paxSourceExtraction";

describe("extractSourceContext", () => {
  it("returns empty context for no tool calls (pure-conversational turn)", () => {
    expect(extractSourceContext(undefined)).toEqual({
      sourceNumbers: [],
      claimedPropertyIds: [],
      claimedLeadIds: [],
      claimedDealIds: [],
    });
    expect(extractSourceContext([])).toEqual({
      sourceNumbers: [],
      claimedPropertyIds: [],
      claimedLeadIds: [],
      claimedDealIds: [],
    });
  });

  it("extracts acreage + price numeric facts from a research_property result", () => {
    const ctx = extractSourceContext([
      {
        name: "research_property",
        arguments: { property_id: 12 },
        result: {
          success: true,
          data: {
            propertyId: 12,
            apn: "234-56-789",
            enrichment: { floodZone: "AE", sizeAcres: 9.3, marketValue: 18000 },
            completenessScore: 80,
          },
        },
      },
    ]);
    // acreage, market value, completeness score are all source numbers
    expect(ctx.sourceNumbers).toEqual(expect.arrayContaining([9.3, 18000, 80]));
    // propertyId is collected as a claimed property id
    expect(ctx.claimedPropertyIds).toContain(12);
  });

  it("parses stringified JSON tool results", () => {
    const ctx = extractSourceContext([
      {
        name: "get_comps",
        result: JSON.stringify({
          success: true,
          data: [{ pricePerAcre: 2400 }, { pricePerAcre: 3800 }],
        }),
      },
    ]);
    expect(ctx.sourceNumbers).toEqual(expect.arrayContaining([2400, 3800]));
  });

  it("does NOT treat ids / coordinates / timestamps as source numbers", () => {
    const ctx = extractSourceContext([
      {
        name: "create_property",
        result: {
          success: true,
          data: {
            property: {
              id: 7,
              apn: "111-22-333",
              latitude: 31.5,
              longitude: -110.3,
              sizeAcres: 5,
            },
            createdAt: 1717000000000,
          },
        },
      },
    ]);
    // sizeAcres counts; id, lat/lng, createdAt timestamp do not
    expect(ctx.sourceNumbers).toContain(5);
    expect(ctx.sourceNumbers).not.toContain(7);
    expect(ctx.sourceNumbers).not.toContain(31.5);
    expect(ctx.sourceNumbers).not.toContain(1717000000000);
    // id on a property-shaped object IS collected as a property id
    expect(ctx.claimedPropertyIds).toContain(7);
  });

  it("collects lead and deal ids from their id-bearing keys", () => {
    const ctx = extractSourceContext([
      { name: "get_deals", result: { success: true, data: [{ id: 3, propertyId: 7, offerAmount: 9000 }] } },
      { name: "get_leads", result: { success: true, data: [{ leadId: 42 }] } },
      { name: "create_deal", result: { success: true, data: { deal: { dealId: 55 } } } },
    ]);
    expect(ctx.claimedPropertyIds).toContain(7);
    expect(ctx.claimedLeadIds).toContain(42);
    expect(ctx.claimedDealIds).toContain(55);
    expect(ctx.sourceNumbers).toContain(9000);
  });

  it("ignores tool calls with no result", () => {
    const ctx = extractSourceContext([{ name: "noop", arguments: { x: 1 } }]);
    expect(ctx.sourceNumbers).toEqual([]);
  });

  it("parses currency / percent strings into numbers", () => {
    const ctx = extractSourceContext([
      { name: "calc", result: { success: true, data: { price: "$12,000", margin: "45%" } } },
    ]);
    expect(ctx.sourceNumbers).toEqual(expect.arrayContaining([12000, 45]));
  });
});
