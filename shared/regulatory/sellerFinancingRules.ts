/**
 * Seller-financing / contract-for-deed rules by state — CITED STATUTES ONLY.
 *
 * Sits beside rmloAdvisor.ts (licensing, Reg-Z, usury). This module answers a
 * different question: when an investor sells land on a contract for deed
 * (an executory contract, a land installment contract), what does the state's
 * statute require of the SELLER, and what does it do to the seller's remedy on
 * default?
 *
 * The rule of this file: every requirement names the section it comes from,
 * and every section was read from the statute text (verified 2026-10-09 against
 * texas.public.law, codes.ohio.gov, azleg.gov and revisor.mn.gov). A state with
 * no entry here is NOT "no rules" — it is "not yet covered", and the checker
 * says exactly that. Nothing is inferred for an uncovered state.
 *
 * Not legal advice; callers render DISCLAIMER beside the output.
 */

export interface StatuteRule {
  /** e.g. "Tex. Prop. Code § 5.076". */
  cite: string;
  /** What the section requires or does, in plain words. */
  rule: string;
}

export interface ContractForDeedInput {
  state: string;
  /** Will the purchaser (or a close relative) live on the property? */
  purchaserResidence?: boolean;
  /** Lot size; Texas presumes a lot of one acre or less is residential. */
  lotAcres?: number;
  /** Days from signing until the seller delivers the deed (Texas: ≤180 days is outside the subchapter). */
  deedDeliveryWithinDays?: number;
  /** Does the seller own the land in fee simple, free of liens? */
  sellerOwnsFreeAndClear?: boolean;
  /** Share of the purchase price paid so far (0–100), for default remedies. */
  percentPaid?: number;
  /** Monthly payments made so far, for default remedies. */
  monthlyPaymentsMade?: number;
  /** Years since the first payment (Ohio's 5-year line). */
  yearsSinceFirstPayment?: number;
  /** Is the contract recorded? (Texas: recording changes the remedy.) */
  recorded?: boolean;
  /** Minnesota: is the seller an "investor seller"? */
  investorSeller?: boolean;
}

export type ContractForDeedResult =
  | {
      covered: true;
      state: string;
      /** Does the state's contract-for-deed statute apply to this deal? */
      applies: boolean;
      appliesWhy: string;
      requirements: StatuteRule[];
      /** Things in THIS deal that conflict with the statute. */
      problems: StatuteRule[];
      /** What the seller may do on a default, given the facts supplied. */
      defaultRemedy: StatuteRule | null;
      disclaimer: string;
    }
  | { covered: false; state: string; message: string; disclaimer: string };

export const DISCLAIMER =
  "Not legal advice. Statute summaries for orientation only — read the cited section and confirm with a real-estate attorney licensed in the state before you sign or enforce a contract for deed.";

const TX: StatuteRule[] = [
  { cite: "Tex. Prop. Code § 5.069", rule: "Before the purchaser signs: a survey (or plat of a current survey) under a year old, copies of every encumbrance (restrictive covenants, easements), and the statutory property-condition notice attached to the contract." },
  { cite: "Tex. Prop. Code § 5.070", rule: "Before the purchaser signs: a tax certificate from each taxing unit and a copy of the insurance policy or binder." },
  { cite: "Tex. Prop. Code § 5.071", rule: "Before the purchaser signs: a written statement of the price, the interest rate, the total interest, the total principal and interest, any late charge, and that no prepayment penalty may be charged." },
  { cite: "Tex. Prop. Code § 5.072", rule: "The contract must be written and signed; oral agreements are merged and void; the statutory notice in 14-point bold type is required." },
  { cite: "Tex. Prop. Code § 5.068", rule: "If the negotiations were mainly in another language, every document (contract, disclosures, annual statements, default notice) must also be given in that language." },
  { cite: "Tex. Prop. Code § 5.073", rule: "No late fee above the lesser of 8% of the monthly payment or the actual cost of processing it, no prepayment penalty, and no ban on pledging the purchaser's interest to finance improvements." },
  { cite: "Tex. Prop. Code § 5.074", rule: "The purchaser may cancel for any reason until the 14th day after the contract date; the seller then returns every payment within 10 days." },
  { cite: "Tex. Prop. Code § 5.076", rule: "The seller records the contract (with the § 5.069 disclosure) on or before the 30th day after it is executed." },
  { cite: "Tex. Prop. Code § 5.077", rule: "An annual accounting statement every January (postmarked by January 31 if mailed): amount paid, amount owed, payments remaining, taxes and insurance paid on the purchaser's behalf." },
  { cite: "Tex. Prop. Code § 5.081", rule: "The purchaser may convert the contract into recorded legal title at any time, without penalty." },
  { cite: "Tex. Prop. Code § 5.079", rule: "A recorded contract is a deed with a vendor's lien; an unrecorded one requires the seller to transfer recorded title within 30 days after the final payment." },
  { cite: "Tex. Prop. Code § 5.085", rule: "The seller must own the property in fee simple, free of liens and encumbrances, when signing and for the whole contract." },
];

const OH: StatuteRule[] = [
  { cite: "Ohio Rev. Code § 5313.02", rule: "Every land installment contract is executed in duplicate and must state, at least, the parties' names and addresses, the signing dates, the legal description, the price, separate charges, and the other provisions the section lists." },
];

const AZ: StatuteRule[] = [
  { cite: "Ariz. Rev. Stat. § 33-742(D)", rule: "Forfeiture for unpaid money only after a grace period measured from the due date: 30 days if under 20% of the price is paid, 60 days for 20–30%, 120 days for 30–50%, nine months for 50% or more." },
  { cite: "Ariz. Rev. Stat. § 33-742(A)", rule: "A seller who accelerates the balance may only foreclose the contract as a mortgage (§ 33-748), not forfeit it." },
];

const MN: StatuteRule[] = [
  { cite: "Minn. Stat. § 559.21, subd. 2a", rule: "To terminate a contract for deed after default, the seller serves a notice; the contract ends 60 days after service unless the purchaser cures (pays what is due, costs, and the statutory fees) before then." },
  { cite: "Minn. Stat. § 559.21, subd. 4(a)", rule: "The notice is required whatever the contract says; a contract for deed executed by an investor seller is terminated on 90 days' notice." },
];

function txApplies(i: ContractForDeedInput): { applies: boolean; why: string } {
  if (i.deedDeliveryWithinDays != null && i.deedDeliveryWithinDays <= 180) {
    return { applies: false, why: "the deed is delivered within 180 days of signing (Tex. Prop. Code § 5.062(c))" };
  }
  if (i.purchaserResidence) return { applies: true, why: "the property is to be the purchaser's residence (Tex. Prop. Code § 5.062(a))" };
  if (i.lotAcres != null && i.lotAcres <= 1) return { applies: true, why: "a lot of one acre or less is presumed residential (Tex. Prop. Code § 5.062(a)(1))" };
  if (i.purchaserResidence === false) return { applies: false, why: "the property is not to be anyone's residence, so Subchapter D does not apply (Tex. Prop. Code § 5.062(a)) — confirm the buyer's intended use in writing" };
  return { applies: true, why: "the buyer's intended use is unknown; treat the deal as residential until it is documented otherwise (Tex. Prop. Code § 5.062(a))" };
}

function txRemedy(i: ContractForDeedInput): StatuteRule | null {
  if (i.percentPaid == null && i.monthlyPaymentsMade == null && i.recorded == null) return null;
  const equity = (i.percentPaid ?? 0) >= 40 || (i.monthlyPaymentsMade ?? 0) >= 48 || i.recorded === true;
  return equity
    ? { cite: "Tex. Prop. Code § 5.066", rule: "The purchaser has paid 40% or more, or 48 monthly payments, or the contract is recorded: no forfeiture or rescission. The seller's remedy is a trustee sale after a default notice giving at least 60 days to cure." }
    : { cite: "Tex. Prop. Code §§ 5.063–5.065", rule: "Rescission or forfeiture only after a written notice by certified or registered mail in the statutory form, and only if the purchaser does not cure within 30 days." };
}

function ohRemedy(i: ContractForDeedInput): StatuteRule | null {
  if (i.percentPaid == null && i.yearsSinceFirstPayment == null) return null;
  return (i.yearsSinceFirstPayment ?? 0) >= 5 || (i.percentPaid ?? 0) >= 20
    ? { cite: "Ohio Rev. Code § 5313.07", rule: "Paid for five years or more, or 20% or more of the price: the vendor recovers the property only by foreclosure and judicial sale." }
    : { cite: "Ohio Rev. Code § 5313.08", rule: "In effect under five years: after the notice periods of §§ 5313.05–5313.06 the vendor may sue for forfeiture and restitution." };
}

function azRemedy(i: ContractForDeedInput): StatuteRule | null {
  if (i.percentPaid == null) return null;
  const p = i.percentPaid;
  const wait = p < 20 ? "30 days" : p < 30 ? "60 days" : p < 50 ? "120 days" : "nine months";
  return { cite: "Ariz. Rev. Stat. § 33-742(D)", rule: `With ${p}% of the price paid, forfeiture for non-payment may be enforced only ${wait} after the missed payment was due, after the notice of election to forfeit (§ 33-743).` };
}

function mnRemedy(i: ContractForDeedInput): StatuteRule | null {
  return i.investorSeller
    ? { cite: "Minn. Stat. § 559.21, subd. 4(a)(2)", rule: "An investor seller terminates only on 90 days' notice, served like a summons." }
    : { cite: "Minn. Stat. § 559.21, subd. 2a", rule: "Termination takes effect 60 days after the notice is served, unless the purchaser cures first." };
}

export const COVERED_STATES = ["TX", "OH", "AZ", "MN"] as const;

export function checkContractForDeed(input: ContractForDeedInput): ContractForDeedResult {
  const state = (input.state ?? "").trim().toUpperCase();
  if (state === "TX") {
    const a = txApplies(input);
    const problems: StatuteRule[] = [];
    if (a.applies && input.sellerOwnsFreeAndClear === false) problems.push(TX.find((r) => r.cite.endsWith("5.085"))!);
    return { covered: true, state, applies: a.applies, appliesWhy: a.why, requirements: a.applies ? TX : [], problems, defaultRemedy: a.applies ? txRemedy(input) : null, disclaimer: DISCLAIMER };
  }
  if (state === "OH") {
    return { covered: true, state, applies: true, appliesWhy: "a land installment contract (Ohio Rev. Code ch. 5313)", requirements: OH, problems: [], defaultRemedy: ohRemedy(input), disclaimer: DISCLAIMER };
  }
  if (state === "AZ") {
    return { covered: true, state, applies: true, appliesWhy: "a contract for conveyance of real property (Ariz. Rev. Stat. §§ 33-741 to 33-749)", requirements: AZ, problems: [], defaultRemedy: azRemedy(input), disclaimer: DISCLAIMER };
  }
  if (state === "MN") {
    return { covered: true, state, applies: true, appliesWhy: "a contract for the conveyance of real estate (Minn. Stat. § 559.21)", requirements: MN, problems: [], defaultRemedy: mnRemedy(input), disclaimer: DISCLAIMER };
  }
  return {
    covered: false,
    state,
    message: `Not yet covered: AcreOS has no cited contract-for-deed rule for ${state || "this state"}. That is not the same as no rules — read the state's statute and confirm with a local attorney before using a contract for deed.`,
    disclaimer: DISCLAIMER,
  };
}

/** One line for a state profile: cited when covered, "not yet covered" otherwise. */
export function contractForDeedSummary(state: string): string {
  const r = checkContractForDeed({ state });
  if (!r.covered) return r.message;
  return r.requirements.map((q) => `${q.cite}: ${q.rule}`).join(" ");
}
