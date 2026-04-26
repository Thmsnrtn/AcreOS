// acreos-landing/copy.jsx — All copy in one place, indexed by tone.
// Three tones: 'plain' (operator), 'aspirational' (OS for land), 'letter' (founder)

const COPY = {
  plain: {
    hero: {
      eyebrow: 'For solo investors, partners, and small teams',
      title: ['Find motivated sellers.', 'Send mail. Close deals.', 'All in one place.'],
      sub: 'AcreOS is the operating system for land investors. Three AI agents do the busy work — comping, replying, servicing notes — so you spend your hours on the deals that matter.',
      cta1: 'Start free trial',
      cta2: 'See how it works',
      ctaSub: '14 days free · no card · cancel anytime',
      proof: 'In private beta with 12 land investors. $1.4M closed in 90 days.',
    },
    how: {
      eyebrow: 'How it works',
      title: 'Three steps. Most happen on their own.',
      steps: [
        { n: 1, t: 'Define your buy-box', b: 'Counties, acreage, price band, deal type. Takes 4 minutes.' },
        { n: 2, t: 'AcreOS pulls your list', b: 'Skip-traced, deduped, sorted by likelihood. Mail goes out the next morning.' },
        { n: 3, t: 'You make decisions', b: 'Replies come in. Pax drafts answers. You hit send. Most days take 20 minutes.' },
      ],
    },
    agents: {
      eyebrow: 'The agents',
      title: 'Three coworkers who work while you sleep.',
      sub: 'Each one does one thing well. They check each other\'s work. They tell you what they did and why.',
    },
    day: {
      eyebrow: 'A day in the life',
      title: 'What a Tuesday looks like.',
      sub: 'Before AcreOS, after AcreOS. Same investor, same deals, very different week.',
    },
    features: {
      eyebrow: 'What\'s inside',
      title: 'Everything a land investor actually does.',
      sub: 'No fluff. Each tool exists because someone running deals needed it on a Tuesday.',
    },
    quotes: {
      eyebrow: 'From the beta',
      title: 'What 12 land investors said after 90 days.',
    },
    founder: {
      eyebrow: 'Why we built this',
      title: 'A land investor who couldn’t stop building systems.',
      body: [
        'I’m a land investor, and I’m the kind of person who can’t leave a broken system alone. For years, my operation ran on a spreadsheet, a dozen browser tabs, AI assistants that didn’t know what I was working on, and a stack of emails and voicemails that kept growing while I tried to close deals.',
        'It mostly worked. But the leaks were everywhere. A reply missed by a day. A skip-trace I’d already paid for. A mailer to a seller who told me no six months ago. Each one was small. Together they were the difference between a good year and a great one.',
        'AcreOS is what came out the other side. Three agents — Atlas, Pax, Sophie — that handle the parts of the job that should never have been manual. Comping, replies, loan servicing, follow-ups. They run in the background. You stay on the decisions only you should make.',
        'The rule is honesty. Every agent shows its work — what it did, what it used, how confident it is, what it skipped. You can pause anything, edit anything, override anything, in one click.',
        'If you’re running a land business and the seams are starting to show, this is built for you.',
      ],
      sig: 'Thomas Norton',
      sigSub: 'Founder, AcreOS',
    },
    pricing: {
      eyebrow: 'Pricing',
      title: 'Pay for what you use.',
      sub: 'Every plan includes all three agents and unlimited mailers. Pricing scales with your buy-box size and team.',
    },
    faq: {
      eyebrow: 'Questions',
      title: 'Things investors ask before signing up.',
    },
    cta: {
      eyebrow: 'Ready when you are',
      title: 'Start finding sellers tomorrow morning.',
      sub: '14 days free. No credit card. Bring your own buy-box, or pick a county and we\'ll suggest one.',
      cta1: 'Start free trial',
      cta2: 'Talk with us',
    },
  },

  aspirational: {
    hero: {
      eyebrow: 'The land investor\'s OS',
      title: ['The only software', 'land investors', 'will ever need.'],
      sub: 'AcreOS is a complete operating system for finding, analyzing, mailing, closing, and servicing land deals. Built around three AI agents that turn a 60-hour week into a 20-hour one.',
      cta1: 'Start free trial',
      cta2: 'Watch the 2-min demo',
      ctaSub: '14 days · no card · keep your data',
      proof: 'Trusted by 12 founding investors closing $1.4M+ in their first 90 days.',
    },
    how: {
      eyebrow: 'How AcreOS works',
      title: 'Three layers. One operating system.',
      steps: [
        { n: 1, t: 'Define', b: 'Your buy-box becomes a permanent agent that monitors millions of parcels in real time.' },
        { n: 2, t: 'Discover', b: 'Atlas pulls and ranks your list. Pax writes the mail. Sophie watches title and notes.' },
        { n: 3, t: 'Decide', b: 'You stay in your zone of judgment. The agents handle everything else.' },
      ],
    },
    agents: {
      eyebrow: 'Your AI workforce',
      title: 'Three specialists. One operating system.',
      sub: 'Atlas, Pax, and Sophie each master one domain — analysis, communication, servicing. They share context. They double-check each other. You stay in command.',
    },
    day: {
      eyebrow: 'Before & after',
      title: 'Reclaim 40 hours of your week.',
      sub: 'The same deals. The same outcomes. Without the tool churn, the missed replies, the spreadsheet labyrinth.',
    },
    features: {
      eyebrow: 'The platform',
      title: 'Every land investor workflow, redesigned.',
      sub: 'CRM, comp engine, mail platform, e-sign, loan servicing, automation builder — unified under one operating model.',
    },
    quotes: {
      eyebrow: 'Trusted by serious investors',
      title: 'Voices from our founding cohort.',
    },
    founder: {
      eyebrow: 'A note from the founder',
      title: 'I’m a land investor who couldn’t stop building.',
      body: [
        'I run a land business, and I think about systems a lot. Probably too much. The way most investors operate — spreadsheets, browser tabs, AI assistants that don’t share context, communication scattered across four inboxes — wasn’t a tooling problem to me. It was a foundation problem.',
        'You can’t scale on a foundation that loses its place every time you close a tab. The work doesn’t compound. Each new deal starts from cold.',
        'AcreOS is the foundation I wanted. One model of your business that every agent and every workflow runs on top of. Atlas knows what Pax wrote yesterday. Pax knows what Sophie collected last week. Nothing has to be re-explained.',
        'That’s what an operating system actually is — a place where every action you take makes the next one cheaper.',
        'If you’ve been feeling the same friction, I’d like to have you on.',
      ],
      sig: 'Thomas Norton',
      sigSub: 'Founder, AcreOS',
    },
    pricing: {
      eyebrow: 'Investment',
      title: 'Pricing that scales with you.',
      sub: 'Flexible plans for every stage — solo investor, partnership, or full operation. Every tier includes the full platform.',
    },
    faq: {
      eyebrow: 'Common questions',
      title: 'What investors ask before joining.',
    },
    cta: {
      eyebrow: 'Welcome aboard',
      title: 'Your operating system is ready.',
      sub: 'Join 12 founding investors building their playbook on AcreOS. The next 90 days could change how you operate.',
      cta1: 'Start free trial',
      cta2: 'Schedule a demo',
    },
  },

  letter: {
    hero: {
      eyebrow: 'A letter from Thomas',
      title: ['I built this', 'because I needed it.', 'Maybe you do too.'],
      sub: 'I\'ve closed 200 land deals. The last 50 were on AcreOS. It\'s an honest piece of software — I wrote the spec, I review every release, I\'ll answer if you email. If you\'re a land investor and the spreadsheet life is wearing thin, give it 14 days.',
      cta1: 'Start free trial',
      cta2: 'Read the letter',
      ctaSub: 'No credit card. Email me with questions: thomas@acreos.io',
      proof: '12 investors in private beta. $1.4M closed. 0 of them have left.',
    },
    how: {
      eyebrow: 'How it works',
      title: 'Three steps. Most happen on their own.',
      steps: [
        { n: 1, t: 'Tell us your buy-box', b: 'Counties, acreage, price. The same conversation you\'d have with a partner.' },
        { n: 2, t: 'We do the busy work', b: 'List pulled, mail sent, replies drafted. Atlas, Pax, and Sophie work overnight.' },
        { n: 3, t: 'You make the calls', b: 'Hit send on the offers you like. Skip the ones you don\'t. Keep your judgment where it belongs.' },
      ],
    },
    agents: {
      eyebrow: 'Three coworkers',
      title: 'I named them after people I trust.',
      sub: 'Atlas does the math. Pax handles the conversation. Sophie watches the paper. They each tell you what they did and why — no black boxes.',
    },
    day: {
      eyebrow: 'A Tuesday in May',
      title: 'Two versions of the same week.',
      sub: 'Before I built AcreOS, my Tuesdays looked like the left side. Now they look like the right.',
    },
    features: {
      eyebrow: 'What\'s in the box',
      title: 'Every tool I needed, in one place.',
      sub: 'I built each piece because I missed a deal without it. Nothing is here for show.',
    },
    quotes: {
      eyebrow: 'From investors using it',
      title: 'What the beta cohort said.',
    },
    founder: {
      eyebrow: 'Why I built this',
      title: 'A land investor with a systems problem.',
      body: [
        'I got into land because I love the work — walking parcels, talking to sellers, doing the math on a deal that nobody else has looked at properly. I stayed up late building things because I love that too. The two halves of me have always been arguing about which one was the day job.',
        'For a long time, my operation ran the way most do. PropStream in one tab, Pebble in another. A spreadsheet I trusted more than I should have. A Mailchimp account doing things it wasn’t designed for. AI tools that were genuinely smart but couldn’t see any of my context, so I’d find myself re-explaining the same deal three times in a morning.',
        'I started building AcreOS because I was tired of being the integration layer. Tired of the busywork that wasn’t the work. The first version was a tool for me. Then a couple of investor friends asked to use it. Now there’s a small group of us, and we’re opening the door wider.',
        'It’s built honestly. Every agent shows what it did and what it used to do it. Nothing happens behind your back. You can pause any of it in a click and run the deal yourself if you want — the way I still do, on the deals that matter most.',
        'If you’ve been feeling the same friction, I’d love to have you on.',
      ],
      sig: 'Thomas',
      sigSub: 'Investor · Founder',
    },
    pricing: {
      eyebrow: 'Pricing',
      title: 'Honest pricing for honest work.',
      sub: 'I priced it the way I\'d want it priced as a customer. No tiers designed to upsell. No "contact us" wall. The numbers are right here.',
    },
    faq: {
      eyebrow: 'Things people ask me',
      title: 'Real questions from real conversations.',
    },
    cta: {
      eyebrow: 'Ready when you are',
      title: 'Try it for two weeks. See what you think.',
      sub: 'No card, no calls, no pressure. If it\'s not for you, no hard feelings — and you can email me to tell me what was missing.',
      cta1: 'Start free trial',
      cta2: 'Email me first',
    },
  },
};

window.LP_COPY = COPY;
