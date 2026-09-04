/**
 * Marketplace mutations must derive their authority from the data, not the request.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `POST /api/marketplace/transactions/complete` took `{ listingId, salePrice }`
 * from the request body, passed the caller's org as the BUYER, and then:
 * marked that listing `sold`, wrote a `marketplace_transactions` row asserting a
 * sale at the caller's chosen price, computed the 1.5% platform fee from that
 * same number, and closed the deal room.
 *
 * Nothing established that the caller had ever bid, that a bid had been
 * accepted, or that the listing was even under offer. Any authenticated member
 * of any organization could mark a COMPETITOR'S listing sold — at any price —
 * and close the counterparties' deal room with it.
 *
 * It was latent only because the marketplace mount fails closed behind
 * `requireLadderFlag("feature_marketplace")` (2026-09-03, and pinned by
 * marketplaceLadderIsClosed.test.ts). A flag is a door; this is the authority
 * check behind it. It surfaced on 2026-09-04, when the tenancy gate learned to
 * recognise a NOT NULL foreign key to organizations.id under ANY column name:
 * these tables key their tenant by ROLE (`seller_organization_id`,
 * `buyer_organization_id`, `bidder_organization_id`), so no spelling of
 * "organization_id" had ever matched them and all three sat outside the
 * population every rule ran over.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 * Three properties, each of which was false before this commit:
 *
 *   1. completeTransaction requires an ACCEPTED BID from the caller's org.
 *   2. The sale price — and with it the platform fee — comes from that bid,
 *      never from the request.
 *   3. Every mutation on a marketplace listing NAMES the seller organization in
 *      its own WHERE, rather than resolving by bare id after a guard above it.
 *
 * These are source assertions because the methods need a database; the effect
 * they guard is nonetheless exact. Comments are STRIPPED first — a scan that
 * reads the paragraph above would find "salePrice" in it and pass forever,
 * which is a defect this repository has shipped four times in one day.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

/**
 * Body of a method, from its signature to the matching closing brace.
 *
 * The opening brace is found AFTER the parameter list closes, not by taking the
 * first `{` after the name. `respondToBid(sellerOrgId, bidId, action, data?: {
 * counterOffer?: number })` declares an object type IN ITS PARAMETERS, so the
 * naive version matched that brace, closed on its `}`, and returned the
 * parameter list as "the body" — after which every assertion about the method
 * was really an assertion about its signature, and two of them passed. That is
 * the unit-boundary failure CLAUDE.md records, reproduced inside the test
 * written to catch an authority defect.
 */
function methodBody(src: string, name: string): string {
  const start = src.indexOf(`async ${name}(`);
  expect(
    start,
    `${name}() is gone from the service, or was renamed. Re-point this test — ` +
      "do not delete it: the authority check it pins has no other home.",
  ).toBeGreaterThan(-1);
  // Walk the parameter list to its closing paren, then take the next `{`.
  let parenDepth = 0;
  let afterParams = -1;
  for (let i = src.indexOf("(", start); i < src.length; i++) {
    if (src[i] === "(") parenDepth += 1;
    else if (src[i] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) { afterParams = i; break; }
    }
  }
  expect(afterParams, `could not find the end of ${name}()'s parameter list`).toBeGreaterThan(-1);
  const open = src.indexOf("{", afterParams);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces walking ${name}()`);
}

describe("marketplace authority", () => {
  it("completeTransaction requires an ACCEPTED bid from the caller's organization", () => {
    const body = methodBody(read("server/services/marketplace.ts"), "completeTransaction");

    expect(
      body,
      "completeTransaction no longer filters on an accepted bid. Without that " +
        "predicate the caller's only claim to the listing is the id they typed, " +
        "which is how any org could mark any tenant's listing sold.",
    ).toContain('eq(marketplaceBids.status, "accepted")');
    expect(
      body,
      "the accepted bid is no longer matched to the CALLER's organization. A " +
        "bid by anyone would then authorise a sale to anyone.",
    ).toContain("eq(marketplaceBids.bidderOrganizationId, buyerOrgId)");
    expect(
      body,
      "the bid is no longer matched to the listing being completed.",
    ).toContain("eq(marketplaceBids.listingId, listingId)");
  });

  it("takes the sale price — and so the platform fee — from the bid, not the request", () => {
    const service = read("server/services/marketplace.ts");
    const body = methodBody(service, "completeTransaction");

    expect(
      /async completeTransaction\(\s*listingId:\s*number,\s*buyerOrgId:\s*number\s*\)/.test(service),
      "completeTransaction accepts a third parameter again. The signature IS " +
        "the fix: a caller who names the price of their own transaction names " +
        "the platform fee too.\n" + service.slice(service.indexOf("async completeTransaction("), service.indexOf("async completeTransaction(") + 200),
    ).toBe(true);
    expect(
      body,
      "the sale price is no longer derived from the accepted bid amount.",
    ).toMatch(/salePrice\s*=\s*Number\(\s*accepted\.bid\.counterOffer\s*\?\?\s*accepted\.bid\.bidAmount\s*\)/);

    const route = read("server/routes-marketplace.ts");
    const handler = route.slice(
      route.indexOf("'/transactions/complete'"),
      route.indexOf("'/transactions/complete'") + 700,
    );
    expect(
      handler,
      "the route reads salePrice from req.body again. Even if the service " +
        "ignores it, an accepted-and-ignored input is how the next author " +
        "reinstates the parameter.",
    ).not.toContain("salePrice");
  });

  it("every listing mutation names the seller organization in its own WHERE", () => {
    const service = read("server/services/marketplace.ts");
    // The population is DERIVED: every `update(marketplaceListings)` in the
    // file, so a mutation added later is covered without anyone editing a list.
    const updates: string[] = [];
    const re = /update\(marketplaceListings\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(service)) !== null) {
      // Slice to the end of this statement — the terminating `;` at paren depth 0.
      let depth = 0;
      let end = service.length;
      for (let i = m.index; i < service.length; i++) {
        const ch = service[i];
        if (ch === "(") depth += 1;
        else if (ch === ")") depth -= 1;
        else if (ch === ";" && depth <= 0) { end = i; break; }
      }
      updates.push(service.slice(m.index, end));
    }

    expect(
      updates.length,
      "no `update(marketplaceListings)` statements were found at all. The " +
        "extractor has stopped matching, which reads exactly like every " +
        "mutation being correct.",
    ).toBeGreaterThanOrEqual(4);

    // TWO shapes are legitimate without the seller predicate, and they are
    // discriminated by WHAT THEY WRITE rather than by where they sit: the
    // public engagement counters. `views` is incremented by the org VIEWING a
    // listing and `inquiries` by the org BIDDING on one — neither of whom is
    // the seller, and demanding the seller's id there would be demanding that
    // a marketplace only count its owner's own visits. They are monotonic
    // counters on a listing the caller is already permitted to see; nothing
    // about the listing's state, price or lifecycle is reachable through them.
    const COUNTER_ONLY = /\.set\(\s*\{\s*(views|inquiries):\s*sql`[^`]*`\s*,?\s*\}\s*\)/;

    let stateMutations = 0;
    for (const stmt of updates) {
      if (COUNTER_ONLY.test(stmt)) continue;
      stateMutations += 1;
      expect(
        stmt,
        "a marketplace_listings STATE mutation resolves by bare id. A guard " +
          "above it is not the same thing: it leaves a window, and it leaves " +
          "the next reader — and the tenancy gate — unable to tell a checked " +
          "mutation from a forgotten one:\n" + stmt.slice(0, 400),
      ).toContain("marketplaceListings.sellerOrganizationId");
    }
    expect(
      stateMutations,
      "every update(marketplaceListings) in the file was waved through as a " +
        "counter. The COUNTER_ONLY pattern has become a blanket exemption, " +
        "which is the same as deleting this test.",
    ).toBeGreaterThanOrEqual(4);
  });

  it("respondToBid resolves the bid through the seller's own listing", () => {
    const body = methodBody(read("server/services/marketplace.ts"), "respondToBid");
    expect(
      body,
      "respondToBid fetches the bid by bare id again and checks ownership in " +
        "JavaScript afterwards. A row you may not act on is a row you should " +
        "not have fetched.",
    ).toContain("eq(marketplaceListings.sellerOrganizationId, sellerOrgId)");
    expect(
      body,
      "the join went back to leftJoin, so a bid whose listing is missing " +
        "yields a null listing rather than no row.",
    ).toContain("innerJoin(marketplaceListings");
  });

  it("findBuyersForListing is scoped to the seller and returns no verification documents", () => {
    const src = read("server/services/matchmaking.ts");
    const body = methodBody(src, "findBuyersForListing");
    expect(
      body,
      "the listing is no longer resolved against the caller's organization, so " +
        "any org can enumerate the buyer interest in another tenant's listing.",
    ).toContain("eq(marketplaceListings.sellerOrganizationId, sellerOrganizationId)");
    expect(
      body,
      "matches carry the raw profile row again. That row includes " +
        "verificationDocuments — the counterparty's identity and accreditation " +
        "paperwork.",
    ).toContain("publicInvestorFields(profile)");
    expect(
      src,
      "publicInvestorFields leaks verificationDocuments. It is written as an " +
        "explicit PICK so a column added to investor_profiles later is private " +
        "by default; naming the field here undoes that.",
    ).not.toContain("verificationDocuments");
  });
});
