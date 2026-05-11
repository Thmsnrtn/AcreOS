/**
 * Prototype reference: /acreos-landing/copy.jsx
 *
 * Letter tone (founder voice — first-person, warm). Per the prototype
 * default and AcreOS founder's preference (saved in user memory),
 * this is the canonical voice for the public landing.
 *
 * The other two tones from the prototype (plain "operator" and
 * aspirational "OS") are not yet ported — Phase 9 coherence pass can
 * decide whether to add a tone toggle or stay with the letter voice
 * permanently.
 */

export const LANDING_COPY = {
  hero: {
    eyebrow: "A letter from Thomas",
    title: ["I built this", "because I needed it.", "Maybe you do too."] as const,
    sub:
      "I've closed 200 land deals. The last 50 were on AcreOS. It's an honest piece of software — I wrote the spec, I review every release, I'll answer if you email. If you're a land investor and the spreadsheet life is wearing thin, give it 14 days.",
    cta1: "Start free trial",
    cta2: "Read the letter",
    ctaSub: "No credit card. Email me with questions: thomas@acreos.io",
    proof: "12 investors in private beta. $1.4M closed. 0 of them have left.",
  },
  how: {
    eyebrow: "How it works",
    title: "Three steps. Most happen on their own.",
    steps: [
      {
        n: 1,
        t: "Tell us your buy-box",
        b: "Counties, acreage, price. The same conversation you'd have with a partner.",
      },
      {
        n: 2,
        t: "We do the busy work",
        b: "List pulled, mail sent, replies drafted. Atlas, Pax, and Sophie work overnight.",
      },
      {
        n: 3,
        t: "You make the calls",
        b: "Hit send on the offers you like. Skip the ones you don't. Keep your judgment where it belongs.",
      },
    ],
  },
  agents: {
    eyebrow: "Three coworkers",
    title: "I named them after people I trust.",
    sub:
      "Atlas does the math. Pax handles the conversation. Sophie watches the paper. They each tell you what they did and why — no black boxes.",
  },
  day: {
    eyebrow: "A Tuesday in May",
    title: "Two versions of the same week.",
    sub:
      "Before I built AcreOS, my Tuesdays looked like the left side. Now they look like the right.",
  },
  features: {
    eyebrow: "What's in the box",
    title: "Every tool I needed, in one place.",
    sub: "I built each piece because I missed a deal without it. Nothing is here for show.",
  },
  quotes: {
    eyebrow: "From investors using it",
    title: "What investors are saying.",
  },
  founder: {
    eyebrow: "Why I built this",
    title: "A land investor with a systems problem.",
    body: [
      "I got into land because I love the work — walking parcels, talking to sellers, doing the math on a deal that nobody else has looked at properly. I stayed up late building things because I love that too. The two halves of me have always been arguing about which one was the day job.",
      "For a long time, my operation ran the way most do. PropStream in one tab, Pebble in another. A spreadsheet I trusted more than I should have. A Mailchimp account doing things it wasn't designed for. AI tools that were genuinely smart but couldn't see any of my context, so I'd find myself re-explaining the same deal three times in a morning.",
      "I started building AcreOS because I was tired of being the integration layer. Tired of the busywork that wasn't the work. The first version was a tool for me. Then a couple of investor friends asked to use it. Now there's a small group of us, and we're opening the door wider.",
      "It's built honestly. Every agent shows what it did and what it used to do it. Nothing happens behind your back. You can pause any of it in a click and run the deal yourself if you want — the way I still do, on the deals that matter most.",
      "If you've been feeling the same friction, I'd love to have you on.",
    ] as const,
    sig: "Thomas",
    sigSub: "Investor · Founder",
  },
  pricing: {
    eyebrow: "Pricing",
    title: "Honest pricing for honest work.",
    sub:
      "I priced it the way I'd want it priced as a customer. No tiers designed to upsell. No \"contact us\" wall. The numbers are right here.",
  },
  faq: {
    eyebrow: "Things people ask me",
    title: "Real questions from real conversations.",
  },
  cta: {
    eyebrow: "Ready when you are",
    title: "Try it for two weeks. See what you think.",
    sub:
      "No card, no calls, no pressure. If it's not for you, no hard feelings — and you can email me to tell me what was missing.",
    cta1: "Start free trial",
    cta2: "Email me first",
  },
};

export type LandingCopy = typeof LANDING_COPY;
