/**
 * Negotiation Enhancements — Items 71-85
 * Counter-offer templates, analytics, multi-property offers, follow-up sequences, etc.
 */

import { db } from "../db";
import { deals, offers, leads } from "@shared/schema";
import { eq, and, sql, count, avg, desc } from "drizzle-orm";

// Item 71: Counter-offer templates
export const COUNTER_OFFER_TEMPLATES: Record<string, { name: string; tone: string; template: string }> = {
  firm: {
    name: "Firm Counter",
    tone: "professional",
    template: "Thank you for your counter. After careful analysis, our offer of {{offer_amount}} reflects fair market value based on comparable sales in {{county}}. We're confident in this price and would love to move forward at this number.",
  },
  flexible: {
    name: "Flexible Counter",
    tone: "collaborative",
    template: "I appreciate your counter-offer. Let me see if we can meet in the middle. Would {{counter_amount}} work for you? I'm motivated to close this quickly and can offer {{closing_timeline}} closing.",
  },
  walkaway: {
    name: "Walk-Away Counter",
    tone: "final",
    template: "Thank you for considering our offer. Unfortunately, {{counter_amount}} is beyond our budget for this property. Our final offer is {{offer_amount}}. If this works for you, we're ready to close within {{closing_timeline}}. Otherwise, we wish you the best with the sale.",
  },
};

/**
 * Item 73: Negotiation analytics.
 *
 * Every field is `number | null`, and null means the org has no data to
 * compute it from — never 0, which here would read as a measured zero
 * (a 0% win rate, no discount, no rounds) rather than an empty pipeline.
 *
 * What this used to return
 * ────────────────────────
 *   avgDiscountFromAsking: 25,  // Would be calculated from offer vs asking price
 *   avgNegotiationRounds:  2.3, // Would be calculated from offer history
 *
 * — two literals in the same object as two genuinely computed figures,
 * identically shaped, on a live authenticated endpoint
 * (`GET /api/enhancements/negotiation-analytics`). That packaging is the
 * dangerous kind: a caller cannot tell which half is real.
 *
 * Both are now derived from `offers`. One rename came with the derivation and
 * is deliberate: AcreOS has no counterparty asking price on the acquisition
 * side — `property_listings.asking_price` is the asking on AcreOS's OWN
 * disposition listings, a different thing. What `offers` does carry is
 * `offer_percentage`, the offer as a percentage of estimated market value. So
 * the field is `avgDiscountFromMarketValuePct` and measures what the column
 * actually holds, rather than keeping a name no data supports.
 *
 * `avgOffersToClose` was also not what its name said: it was
 * `deals(status != 'new') / deals(status = 'closed_won')`, a deal-stage ratio
 * that never touched the offers table. It now counts offers per closed-won
 * deal.
 */
export async function getNegotiationAnalytics(orgId: number): Promise<{
  avgOffersToClose: number | null;
  avgDiscountFromMarketValuePct: number | null;
  avgNegotiationRounds: number | null;
  winRate: number | null;
  basis: {
    dealsConsidered: number;
    dealsClosedWon: number;
    offersRecorded: number;
    offersWithMarketValuePct: number;
    leadsWithOffers: number;
  };
}> {
  const [closedDeals] = await db.select({ count: count() })
    .from(deals)
    .where(and(eq(deals.organizationId, orgId), sql`${deals.status} = 'closed_won'`));

  const [totalDeals] = await db.select({ count: count() })
    .from(deals)
    .where(and(eq(deals.organizationId, orgId), sql`${deals.status} != 'new'`));

  const total = totalDeals?.count ?? 0;
  const closed = closedDeals?.count ?? 0;

  // Offers as a percentage of estimated market value. Rows without the column
  // populated are excluded from BOTH the numerator and the denominator — an
  // offer with no recorded percentage is not a 0% offer.
  const [pctAgg] = await db
    .select({
      avgPct: avg(offers.offerPercentage),
      n: count(offers.offerPercentage),
    })
    .from(offers)
    .where(and(eq(offers.organizationId, orgId), sql`${offers.offerPercentage} IS NOT NULL`));

  const [offerTotals] = await db
    .select({
      offersRecorded: count(),
      leadsWithOffers: sql<number>`count(distinct ${offers.leadId})`,
    })
    .from(offers)
    .where(and(eq(offers.organizationId, orgId), sql`${offers.leadId} IS NOT NULL`));

  const offersRecorded = Number(offerTotals?.offersRecorded ?? 0);
  const leadsWithOffers = Number(offerTotals?.leadsWithOffers ?? 0);
  const offersWithPct = Number(pctAgg?.n ?? 0);
  const avgPct = pctAgg?.avgPct === null || pctAgg?.avgPct === undefined
    ? null
    : Number(pctAgg.avgPct);

  // Offers written per deal that actually closed. Requires at least one
  // closed-won deal AND at least one recorded offer; without a closed deal
  // there is no "to close" to average over.
  // Joined on PROPERTY, not lead: `deals` has no `lead_id` column (the same
  // gap noted in routes-compliance.ts's evidence pack), while both tables
  // carry `property_id` and `deals.property_id` is NOT NULL. Offers with no
  // property recorded cannot be attributed to a deal and are excluded rather
  // than spread across all of them.
  const [offersOnClosedWon] = await db
    .select({ n: count() })
    .from(offers)
    .innerJoin(deals, eq(deals.propertyId, offers.propertyId))
    .where(and(
      eq(offers.organizationId, orgId),
      eq(deals.organizationId, orgId),
      sql`${offers.propertyId} IS NOT NULL`,
      sql`${deals.status} = 'closed_won'`,
    ));
  const offersToClose = Number(offersOnClosedWon?.n ?? 0);

  return {
    avgOffersToClose: closed > 0 && offersToClose > 0
      ? Math.round((offersToClose / closed) * 10) / 10
      : null,
    // Discount = how far below estimated market value the offers sit.
    avgDiscountFromMarketValuePct:
      avgPct === null || !Number.isFinite(avgPct)
        ? null
        : Math.round((100 - avgPct) * 10) / 10,
    // A "round" is one recorded offer on a lead. A lead with a single offer
    // and no counter is one round, which is the honest reading of the data —
    // `offers.counter_offer` records the counterparty's number, not a
    // separate row, so rounds cannot be counted more finely than this.
    avgNegotiationRounds: leadsWithOffers > 0
      ? Math.round((offersRecorded / leadsWithOffers) * 10) / 10
      : null,
    winRate: total > 0 ? Math.round((closed / total) * 100) : null,
    basis: {
      dealsConsidered: total,
      dealsClosedWon: closed,
      offersRecorded,
      offersWithMarketValuePct: offersWithPct,
      leadsWithOffers,
    },
  };
}

// Item 79: Offer acceptance prediction
export function predictOfferAcceptance(motivationScore: number, offerPercent: number): {
  probability: number;
  confidence: "low" | "medium" | "high";
  factors: string[];
} {
  let probability = 30; // base
  const factors: string[] = [];

  if (motivationScore > 80) { probability += 25; factors.push("Very high seller motivation"); }
  else if (motivationScore > 60) { probability += 15; factors.push("High seller motivation"); }
  else if (motivationScore > 40) { probability += 5; factors.push("Moderate motivation"); }

  if (offerPercent > 80) { probability += 20; factors.push("Offer above 80% of asking"); }
  else if (offerPercent > 60) { probability += 10; factors.push("Reasonable offer range"); }
  else { probability -= 10; factors.push("Low offer may need negotiation"); }

  probability = Math.max(5, Math.min(95, probability));

  return {
    probability,
    confidence: probability > 70 ? "high" : probability > 40 ? "medium" : "low",
    factors,
  };
}

// Item 83: All active offers view
export async function getActiveOffers(orgId: number): Promise<any[]> {
  return db.select()
    .from(deals)
    .where(and(
      eq(deals.organizationId, orgId),
      sql`${deals.status} IN ('offer_sent', 'negotiating', 'under_contract')`,
    ))
    .orderBy(desc(deals.updatedAt))
    .limit(50);
}

// Item 85: Quick offer from lead
export async function quickOfferData(leadId: number, orgId: number): Promise<any> {
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, leadId), eq(leads.organizationId, orgId)),
  });
  if (!lead) return null;

  // TODO(tsc): leads table has no estimatedValue/county/acreage columns —
  // these are property attributes. Until leads are linked to a property here,
  // only the fields that exist on the lead row are returned.
  return {
    lead,
    suggestedOffer: null,
    county: null,
    state: lead.state,
    acreage: null,
  };
}
