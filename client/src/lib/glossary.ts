/**
 * AcreOS glossary tooltip registry.
 *
 * Land-investing has dense vocabulary (yellow letter, AVM, ALTA, executory
 * contract, §5.069, etc.). Every prominent first-use of a term should be
 * wrapped with `<GlossaryTerm slug="...">label</GlossaryTerm>` so the
 * definition is one hover/tap away.
 *
 * Voice rules: see `docs/voice.md`.
 */

export interface GlossaryEntry {
  /** The display name of the term — sentence-case, no trailing punctuation. */
  term: string;
  /** Plain-English definition. One or two sentences. */
  definition: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  yellow_letter: {
    term: "Yellow letter",
    definition:
      "A handwritten-style direct-mail letter to landowners. High response rate, low scale.",
  },
  decision_queue: {
    term: "Decision queue",
    definition:
      "The /today list of items needing your attention — surfaces from leads, inbox, alerts.",
  },
  pulse: {
    term: "Pulse",
    definition:
      "AcreOS's heartbeat metric — combines deal flow + customer engagement.",
  },
  last_touch: {
    term: "Last touch",
    definition: "The most recent communication you sent to a lead.",
  },
  skip_trace: {
    term: "Skip trace",
    definition:
      "Find phone/email contact info from a property address. Each lookup uses credits.",
  },
  comp: {
    term: "Comp",
    definition: "Comparable property — used to estimate market value.",
  },
  AVM: {
    term: "AVM",
    definition: "Automated Valuation Model — a computed estimate of property value.",
  },
  blind_offer: {
    term: "Blind offer",
    definition:
      "A pre-calculated offer mailed to landowners without an inquiry.",
  },
  buy_box: {
    term: "Buy box",
    definition:
      "Your saved criteria for which deals match — county, acreage, price, etc.",
  },
  underwriting: {
    term: "Underwriting",
    definition:
      "Verifying a property's value, title, and risk before making an offer.",
  },
  due_diligence: {
    term: "Due diligence",
    definition:
      "The verification phase between offer-accepted and closing.",
  },
  earnest_money: {
    term: "Earnest money",
    definition:
      "A deposit paid by the buyer to show good faith. Typically refundable during due diligence.",
  },
  title_commitment: {
    term: "Title commitment",
    definition:
      "A title company's binding commitment to insure clear title at closing.",
  },
  ALTA: {
    term: "ALTA",
    definition:
      "American Land Title Association — sets standards for title insurance and surveys.",
  },
  encumbrance: {
    term: "Encumbrance",
    definition:
      "Anything that limits your free use of a property — liens, easements, restrictions.",
  },
  easement: {
    term: "Easement",
    definition:
      "Someone else's legal right to use part of your land (utility access, road access, etc.).",
  },
  lien: {
    term: "Lien",
    definition:
      "A claim against the property for an unpaid debt — must be cleared before closing.",
  },
  MRR: {
    term: "MRR",
    definition:
      "Monthly recurring revenue — your subscription income, normalized to a monthly amount.",
  },
  ARR: {
    term: "ARR",
    definition: "Annual recurring revenue — MRR × 12.",
  },
  NRR: {
    term: "NRR",
    definition:
      "Net revenue retention — how much existing customer revenue grows after expansion and churn.",
  },
  churn_risk: {
    term: "Churn risk",
    definition:
      "A 0–100 score of disengagement signals — logins, feature use, support tickets, failed payments — where higher means more likely to cancel.",
  },
  RVO: {
    term: "RVO",
    definition:
      "Reasonable Verified Owner — a verified property owner identified via skip trace.",
  },
  dunning: {
    term: "Dunning",
    definition:
      "Retry sequence for failed payments — emails the customer to update their card.",
  },
  "1099-INT": {
    term: "1099-INT",
    definition:
      "IRS form for interest income — issued to your borrowers/lenders annually.",
  },
  borrower: {
    term: "Borrower",
    definition:
      "The person paying on a note you hold — they buy the land via owner-financing.",
  },
  executory_contract: {
    term: "Executory contract",
    definition:
      "A contract being performed over time — like a contract-for-deed.",
  },
  section_5_069: {
    term: "TX §5.069",
    definition:
      "Texas law requiring specific buyer disclosures on contracts-for-deed (Property Code §5.069).",
  },
  land_status: {
    term: "Land status",
    definition:
      "Whether a parcel is fee-simple, tribal trust, or restricted-fee — affects what you can do with it.",
  },
  tribal_trust: {
    term: "Tribal trust",
    definition:
      "Land held by the federal government for tribal benefit — title transfers require BIA approval.",
  },
  BIA: {
    term: "BIA",
    definition:
      "Bureau of Indian Affairs — approves transfers of trust land.",
  },
};

export type GlossarySlug = keyof typeof GLOSSARY;

/** Look up a glossary entry by slug. Returns undefined for unknown slugs. */
export function getGlossaryEntry(slug: string): GlossaryEntry | undefined {
  return GLOSSARY[slug];
}
