/**
 * Central copy for the public landing page.
 *
 * Voice: mechanics-first, third-person. Describes what the system
 * does, not why it was built. No "I built this", no founder-letter
 * tone, no audience-flattering rhetorical hooks.
 *
 * Positioning: AcreOS leads with Land Investors as the founding
 * vertical (per v6 positioning). Other verticals — note investors,
 * fix-and-flippers, wholesalers, subdividers, tax-delinquent buyers,
 * buy-and-hold landlords — are roadmap-framed under the positioning
 * band, with no active CTAs. The earlier 7-persona rotating headline
 * was removed because it diluted the wedge and made the page read as
 * a generic "real estate investor suite" rather than the consolidation
 * play it actually is.
 *
 * 10-second test: a reader should understand within 10 seconds who
 * the platform is for, what it does, and how it works. Every section
 * is written to that bar.
 *
 * The previous `founder` block (a first-person letter from Thomas) and
 * its FounderNote section have been removed entirely.
 */

export const LANDING_COPY = {
  hero: {
    eyebrow: "Built for Land Investors",
    // Static two-line headline. The italic brand-color line two is
    // rendered by .lp-hero-line:nth-child(2). No rotation — Land
    // Investors is the wedge and we name it.
    title: [
      "The operating system",
      "for Land Investors.",
    ] as const,
    // The wedge sentence: one defensible line that names the
    // consolidation. Five verbs map 1:1 to the lifecycle the product
    // owns end-to-end — find, mail, reply, close, service. Nothing
    // else on the market does the last two for a land operator.
    wedge:
      "The only platform that finds parcels, sends the mail, drafts the replies, closes the deal, and services the note after.",
    sub:
      "AcreOS pulls lists, runs comps with 14 per parcel, sends direct mail, drafts seller replies, and tracks parcels from cold lead through closed note in one thread. The operator handles judgment calls; the system handles the busy work.",
    cta1: "See Pax run on your county — free for 14 days",
    cta2: "Watch a 90-second demo first",
    ctaSub: "Pax pulls your first list inside 10 minutes.",
    proof: "",
  },
  positioning: {
    primary: "Built for Land Investors.",
    roadmap:
      "Note investors, fix-and-flippers, wholesalers, subdividers, tax-delinquent buyers, and buy-and-hold landlords land next — each built around how that operator actually works. Land investors first, because that's where the receipts are.",
  },
  how: {
    eyebrow: "How it works",
    title: "Three steps. Most happens on its own.",
    steps: [
      {
        n: 1,
        t: "Define the buy-box",
        b: "Counties, acreage, price band, owner profile. AcreOS filters new leads against it within 90 seconds of ingest.",
      },
      {
        n: 2,
        t: "AcreOS does the busy work",
        b: "Lists pulled, mail sent, replies drafted overnight. Every action is logged and reviewable.",
      },
      {
        n: 3,
        t: "Operator makes the calls",
        b: "Approve offers, edit drafts, skip what doesn't fit. Human judgment stays on the deals that matter.",
      },
    ],
  },
  agents: {
    eyebrow: "Meet Pax",
    title: "Pax — your AI operations partner.",
    sub:
      "Pax monitors the pipeline overnight: pulls comps, scores leads, drafts replies, books follow-ups, services notes. Every action is shown with the data it used. Nothing happens behind your back.",
  },
  day: {
    eyebrow: "A Tuesday in May",
    title: "Two versions of the same week.",
    sub:
      "Before AcreOS, a typical Tuesday looks like the left column. With AcreOS, it looks like the right.",
  },
  features: {
    eyebrow: "What's in the box",
    title: "Every tool a Land Investor needs, in one place.",
    sub: "Find, analyze, reach, close, service. No tab-juggling, no per-step subscriptions.",
  },
  quotes: {
    eyebrow: "What the system does",
    title: "Mechanics, not marketing.",
  },
  pricing: {
    eyebrow: "Pricing",
    title: "Transparent pricing.",
    sub:
      "Numbers on the page. No \"contact us\" wall. Pro at $41/mo (billed annually) unlocks the full Pax assistant, unlimited counties, and bring-your-own-key for the parcel and skip-trace data costs you already pay.",
  },
  faq: {
    eyebrow: "Common questions",
    title: "Frequently asked.",
  },
  cta: {
    eyebrow: "Ready when you are",
    title: "Try AcreOS for two weeks.",
    sub:
      "No card, no calls, no pressure. Full feature access during the trial.",
    cta1: "Start free trial",
    cta2: "Email us first",
  },
};

export type LandingCopy = typeof LANDING_COPY;
