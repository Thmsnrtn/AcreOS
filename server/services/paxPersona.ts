/**
 * Pax Persona — vertical-aware voice shaping.
 *
 * Customers across the platform see one AI brand (Pax), but the vocabulary
 * Pax uses should adapt to the investor's vertical. A wholesaler is not
 * a "Land Investor"; a fix-and-flipper is not a note investor.
 *
 * Call `paxVerticalContext(investorType)` and append it to any Pax
 * system prompt. It injects:
 *   - The reader's noun (what Pax calls them)
 *   - The domain focus (what Pax should prioritize)
 *   - Vertical-specific vocabulary Pax should use / avoid
 *
 * If investorType is null/unknown, returns an empty string so the base
 * prompt still works. The base prompts default to "Land Investor" since
 * that's the launch vertical.
 *
 * Roadmap: supports the "future user-type expansion" principle —
 * adding a new vertical is one row in VERTICAL_CONTEXTS and a new
 * investor type in contextProfile.
 */

import { contextProfileService, type InvestorType } from "./contextProfile";

const VERTICAL_CONTEXTS: Record<InvestorType, {
  noun: string;
  domain: string;
  vocabularyNotes: string;
}> = {
  wholesaler: {
    noun: "Wholesaler",
    domain: "volume buyer/seller focused on motivated-seller lead flow, fast offers, and assignment fees",
    vocabularyNotes:
      "Use 'motivated seller,' 'buyer list,' 'assignment,' 'EMD,' 'contract-to-close.' Avoid 'hold period' or 'cash flow' — wholesalers flip contracts, not properties.",
  },
  note_investor: {
    noun: "Note Investor",
    domain: "seller-financed note portfolio — borrower management, payment cadence, delinquency watch, note performance",
    vocabularyNotes:
      "Use 'promissory note,' 'borrower,' 'amortization,' 'ITV,' 'loss mitigation.' Avoid 'resale' or 'flip' — notes are held for yield.",
  },
  fix_and_flip: {
    noun: "Fix-and-Flipper",
    domain: "rehab + resale — acquisition price, exit comps, timeline, rehab budget, holding cost",
    vocabularyNotes:
      "Use 'ARV,' 'rehab budget,' 'days on market,' 'holding cost,' 'exit strategy.' Frame timelines in weeks, not months.",
  },
  portfolio_builder: {
    noun: "Portfolio Builder",
    domain: "long-term hold portfolio — cap rate, cash-on-cash, net operating income, tenant management",
    vocabularyNotes:
      "Use 'cap rate,' 'NOI,' 'DSCR,' 'cash-on-cash,' 'occupancy,' 'CapEx.' Frame returns annualized.",
  },
  auction_hunter: {
    noun: "Auction Hunter",
    domain: "foreclosure + tax-lien + sheriff-sale acquisition — distress signals, bid caps, redemption periods",
    vocabularyNotes:
      "Use 'opening bid,' 'upset price,' 'redemption period,' 'right of redemption,' 'junior lien.' Speed matters — auction windows are tight.",
  },
  developer: {
    noun: "Developer",
    domain: "entitlement + subdivision + infill — zoning, permit timelines, subdivision yield, horizontal development",
    vocabularyNotes:
      "Use 'entitlement,' 'subdivision,' 'zoning code,' 'variance,' 'horizontal development,' 'carrying cost.' Frame decisions against the entitlement calendar.",
  },
  new_investor: {
    noun: "Land Investor",
    domain: "land investing — acquiring vacant parcels cheap, closing quickly, selling cash or seller-financed",
    vocabularyNotes:
      "Use 'parcel,' 'APN,' 'blind offer,' 'seller-financed note,' 'closing.' Explain jargon on first use — they're learning.",
  },
};

/**
 * Produce a block of system-prompt text that tells Pax how to address
 * this particular investor. Call once per conversation/letter and
 * paste into the system prompt.
 */
export function paxVerticalContext(investorType: InvestorType | null | undefined): string {
  if (!investorType) return "";
  const ctx = VERTICAL_CONTEXTS[investorType];
  if (!ctx) return "";
  return [
    "",
    "READER CONTEXT:",
    `- The person you are writing to is a ${ctx.noun}.`,
    `- Their business is: ${ctx.domain}.`,
    `- Vocabulary: ${ctx.vocabularyNotes}`,
    "- Address them by their vertical role — do not default to 'Land Investor' if they are not one.",
  ].join("\n");
}

/**
 * Lookup the noun Pax should use for a reader. Useful for email
 * templates, letter greetings, etc. where we don't want to inline the
 * full prompt context.
 */
export function readerNoun(investorType: InvestorType | null | undefined): string {
  if (!investorType) return "Land Investor";
  return VERTICAL_CONTEXTS[investorType]?.noun ?? "Land Investor";
}

/**
 * Fetch the current investor type for an organization (cached by the
 * context-profile service). Safe to call from anywhere — returns null
 * on error instead of throwing so prompt generation never fails.
 */
export async function getOrgInvestorType(organizationId: number): Promise<InvestorType | null> {
  try {
    const profile = await contextProfileService.getProfile(organizationId);
    return profile.investorType;
  } catch {
    return null;
  }
}
