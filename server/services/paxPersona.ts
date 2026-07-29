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
 *
 * 2026-07-29 (wave V1, founder ruling #11): the registry is now keyed by
 * the FULL PaxVerticalContextKey union from shared/models/persona-mapping
 * — the 7 contextProfile InvestorType buckets PLUS note_servicer /
 * note_originator / subdivider, so all 9 personas resolve to their own
 * domain voice (PAX_CONTEXT_BY_PERSONA) instead of collapsing lossily
 * (servicer/originator → generic note voice, subdivider → developer).
 * Because the record is typed against the union, adding a key without a
 * voice entry here is a compile error.
 */

import { contextProfileService, type InvestorType } from "./contextProfile";
import type { PaxVerticalContextKey } from "../../shared/models/persona-mapping";

export const VERTICAL_CONTEXTS: Record<PaxVerticalContextKey, {
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
  // ── Persona-resolved voices (wave V1) ─────────────────────────────
  // Grounded in what the schema/services actually support — see
  // shared/schema/reg-z.ts + notes-vertical.ts (servicer), the
  // rmloAdvisor + doddFrankChecker (originator), and
  // shared/schema/subdivision.ts (subdivider).
  note_servicer: {
    noun: "Note Servicer",
    domain:
      "servicing operations on notes — payment application order, suspense balances, escrow administration, Reg-Z §1026.41 periodic statements, RESPA §1024.39 early-intervention clocks, per-owner remittances, state servicer licensing",
    vocabularyNotes:
      "Use 'payment application,' 'suspense balance,' 'escrow analysis,' 'periodic statement,' 'early intervention (day 36),' 'remittance,' 'ownership of record,' 'loss mitigation.' Compliance deadlines are the spine — frame work against the statement cycle and the §1024.39 clock, never against deal-hunting. Avoid acquisition talk ('offer,' 'comps,' 'flip') — the servicer administers loans, they don't chase deals.",
  },
  note_originator: {
    noun: "Note Originator",
    domain:
      "seller-financed origination — structuring a compliant note at closing: Dodd-Frank seller-financer exclusions (the 1-property natural-person and 3-property safe harbors, 12 CFR 1026.36(a)(4)), RMLO involvement, Reg-Z applicability, balloon restrictions, state usury caps",
    vocabularyNotes:
      "Use 'RMLO,' '3-property exemption,' '1-property natural-person exemption,' 'balloon,' 'usury cap,' 'business-purpose vs consumer-purpose,' 'SCRA,' 'HOEPA threshold.' Frame answers as a compliance posture plus a checklist, and always flag that posture output is not legal advice — verify with counsel.",
  },
  subdivider: {
    noun: "Subdivider",
    domain:
      "parent-parcel splits — plat lifecycle (draft → county submitted → recorded), county permit gates, lot pricing premiums, basis-per-lot allocation, CC&R templates, county approval lead times",
    vocabularyNotes:
      "Use 'preliminary plat,' 'final plat,' 'permit gate,' 'percolation test,' 'lot premium,' 'basis allocation,' 'CC&Rs,' 'county lead time (p50/p90).' Frame decisions against the county approval calendar — a recorded plat is the moment lots become sellable. Avoid flip/rehab vocabulary; the subdivider's project is horizontal, measured in gates and recording dates.",
  },
};

/**
 * Produce a block of system-prompt text that tells Pax how to address
 * this particular investor. Call once per conversation/letter and
 * paste into the system prompt.
 */
export function paxVerticalContext(
  investorType: PaxVerticalContextKey | InvestorType | null | undefined,
): string {
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
export function readerNoun(
  investorType: PaxVerticalContextKey | InvestorType | null | undefined,
): string {
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
