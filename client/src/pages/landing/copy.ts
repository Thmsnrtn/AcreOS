/**
 * Central copy for the public landing page.
 *
 * Voice: mechanics-first, third-person. Describes what the system
 * does, not why it was built. No "I built this", no founder-letter
 * tone, no audience-flattering rhetorical hooks.
 *
 * Primary positioning: built for Land Investors, actively expanding to
 * other investor types (note investors, fix-and-flippers, etc.).
 * Roadmap framing keeps the verticals visible without diluting focus.
 *
 * The previous `founder` block (a first-person letter from Thomas) and
 * its FounderNote section have been removed entirely.
 */

export const LANDING_COPY = {
  hero: {
    eyebrow: "Built for Land Investors",
    title: [
      "The operating system",
      "for land investors.",
      "From lead to closed.",
    ] as const,
    sub:
      "AcreOS pulls lists, runs comps, sends mail, drafts replies, and tracks every deal through closing — in one place. Built for land investors. Actively expanding to note investors, fix-and-flippers, and other investor types.",
    cta1: "Start free trial",
    cta2: "See how it works",
    ctaSub: "14 days free. No credit card required.",
    proof: "Active early-access. Founding cohort onboarding now.",
  },
  positioning: {
    primary: "Built for Land Investors.",
    roadmap:
      "Actively expanding to note investors, fix-and-flippers, and other investor types.",
  },
  how: {
    eyebrow: "How it works",
    title: "Three steps. Most happens on its own.",
    steps: [
      {
        n: 1,
        t: "Define the buy-box",
        b: "Counties, acreage, price band, parcel criteria. AcreOS filters every new lead against it.",
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
      "Pax monitors the pipeline overnight: pulls comps, scores leads, drafts replies, books follow-ups. Every action is shown with the data it used. Nothing happens behind your back.",
  },
  day: {
    eyebrow: "A Tuesday in May",
    title: "Two versions of the same week.",
    sub:
      "Before AcreOS, a typical Tuesday looks like the left column. With AcreOS, it looks like the right.",
  },
  features: {
    eyebrow: "What's in the box",
    title: "Every tool a land operator needs, in one place.",
    sub: "Find, analyze, reach, close, service. No tab-juggling.",
  },
  quotes: {
    eyebrow: "From investors using it",
    title: "What investors are saying.",
  },
  pricing: {
    eyebrow: "Pricing",
    title: "Transparent pricing.",
    sub:
      "Numbers on the page. No \"contact us\" wall. Pick a tier that matches operation size.",
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
