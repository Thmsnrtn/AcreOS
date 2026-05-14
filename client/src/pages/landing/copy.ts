/**
 * Central copy for the public landing page.
 *
 * Voice: mechanics-first, third-person. Describes what the system
 * does, not why it was built. No "I built this", no founder-letter
 * tone, no audience-flattering rhetorical hooks.
 *
 * Positioning: AcreOS is a multi-vertical operating system. Land
 * Investors are the founding vertical and remain the prevailing
 * framing in deep product surfaces, but the public landing speaks to
 * every persona we serve — land flippers, note investors,
 * fix-and-flippers, wholesalers, subdividers, tax-delinquent buyers,
 * buy-and-hold landlords. The hero headline cycles through them via
 * RotatingVertical so a wholesaler or note investor reading the page
 * isn't visually told "this is for someone else."
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
    eyebrow: "Built for property investors",
    // The headline reads "The operating system / for <ROTATOR>." Hero.tsx
    // composes it with the <RotatingVertical /> component to keep the
    // line stable while the vertical label cycles every ~2.6s.
    title: [
      "The operating system",
      // Kept as a single fallback string so the OpenGraph + JsonLd
      // surfaces have a static phrase to lead with.
      "for land investors.",
    ] as const,
    titleForPrefix: "for ",
    titleSuffix: ".",
    sub:
      "One platform for every real-estate operator — pull lists, run comps, send mail, draft replies, and track every deal through closing. Whether you flip land, buy notes, rehab houses, wholesale contracts, subdivide, or buy-and-hold, AcreOS does the busy work so the operator only handles judgment calls.",
    cta1: "Start free trial",
    cta2: "See how it works",
    ctaSub: "14 days free. No credit card required.",
    proof: "",
  },
  positioning: {
    primary: "One operating system. Every investor type.",
    roadmap:
      "Land flippers, note investors, fix-and-flippers, wholesalers, subdividers, tax-delinquent buyers, and buy-and-hold landlords — each gets the vocabulary, workflows, and compliance their vertical needs.",
  },
  how: {
    eyebrow: "How it works",
    title: "Three steps. Most happens on its own.",
    steps: [
      {
        n: 1,
        t: "Define the buy-box",
        b: "Your criteria — geography, deal type, price band, condition, yield. AcreOS filters every new lead against it.",
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
      "Pax monitors the pipeline overnight: pulls comps, scores leads, drafts replies, books follow-ups, services notes, tracks rehabs. Every action is shown with the data it used. Nothing happens behind your back.",
  },
  day: {
    eyebrow: "A Tuesday in May",
    title: "Two versions of the same week.",
    sub:
      "Before AcreOS, a typical Tuesday looks like the left column. With AcreOS, it looks like the right — regardless of whether you're underwriting a parcel, a note, a rehab, or a rental.",
  },
  features: {
    eyebrow: "What's in the box",
    title: "Every tool a real-estate operator needs, in one place.",
    sub: "Find, analyze, reach, close, service. No tab-juggling, no vertical-locked tools.",
  },
  quotes: {
    eyebrow: "What the system does",
    title: "Mechanics, not marketing.",
  },
  pricing: {
    eyebrow: "Pricing",
    title: "Transparent pricing.",
    sub:
      "Numbers on the page. No \"contact us\" wall. Pick a tier that matches operation size — same price regardless of which vertical you operate in.",
  },
  faq: {
    eyebrow: "Common questions",
    title: "Frequently asked.",
  },
  cta: {
    eyebrow: "Ready when you are",
    title: "Try AcreOS for two weeks.",
    sub:
      "No card, no calls, no pressure. Full feature access during the trial — across every vertical.",
    cta1: "Start free trial",
    cta2: "Email us first",
  },
};

export type LandingCopy = typeof LANDING_COPY;
