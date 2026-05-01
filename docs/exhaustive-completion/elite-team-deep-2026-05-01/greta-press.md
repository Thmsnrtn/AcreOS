# Greta Lindqvist — Press Readiness Audit

**For:** Thomas Norton, founder, AcreOS
**Persona:** Greta Lindqvist — 8 yrs VP Comms at Stripe, ex-Wired editor
**Date:** 2026-05-01
**Wave:** 2 of 87-persona deep audit (none of the prior 12 covered press readiness)

---

## 1. One-Line Verdict

**You have a strong product story and a believable founder, but zero press infrastructure — and you are about to spend your one launch moment on Product Hunt instead of saving it for the milestone that would actually earn coverage.**

---

## 2. Press-Kit Inventory

### What exists

| Asset | Status | Where |
|---|---|---|
| Competitive landscape | Yes, strong | `docs/strategy/competitive-landscape.md` |
| Product-Hunt launch plan | Yes | `content/strategy/product-hunt-plan.md` |
| 30-day post-launch playbook | Yes | `content/strategy/30-day-playbook.md` |
| Founder voice (first-person comment) | Drafted | `product-hunt-plan.md` "First comment from maker" |
| Landing page copy | Yes | `client/src/pages/acreos-landing/copy.jsx` |
| Persona architecture (Sophie/Forge/Atlas vs Pax) | Documented internally | MEMORY: `project_persona_architecture.md` |
| Native e-sign positioning | Documented | MEMORY: `project_native_esign.md` |

### What is missing — the actual press kit

| Asset | Status | Priority |
|---|---|---|
| `/press` page on acreos.com | **Missing** | P0 |
| One-page fact sheet (PDF) — what / who / when / numbers | **Missing** | P0 |
| Founder bio — short (50w), medium (150w), long (400w) | **Missing** | P0 |
| Founder headshot — square + landscape, 2000px, transparent + on-brand bg | **Missing** | P0 |
| Logo lockups — wordmark, mark only, dark/light, SVG + PNG | **Unclear / not exported** | P0 |
| Brand guidelines — colors, type, do/don't | **Missing externally** | P1 |
| Product screenshots — hero shots, 5 surfaces, 2x retina | Some exist as PNG but not packaged | P0 |
| 15-30s product walkthrough video | **Missing** | P1 |
| Boilerplate "About AcreOS" — 75 words, copy-paste | **Missing** | P0 |
| Press contact (press@acreos.com → routed) | **Missing** | P0 |
| Embargo policy + spokesperson availability | **Missing** | P1 |
| Customer reference list (with permission) | **Missing — no testimonials captured yet** | P0 |
| Crisis comms playbook | **Missing** | P1 |
| Industry analyst briefing deck | **Missing** | P2 |

**Coverage:** roughly 15% of a credible Series-A-ready press kit. Acceptable for a pre-launch solo founder, but the gap between "Product Hunt comment" and "press kit a journalist can pull from in 4 minutes on deadline" is the entire delta you need to close.

---

## 3. Founder Narrative — Drafted 3-Paragraph Version

This is the version a journalist would lift from. Plain, specific, no founder-hagiography.

> **Paragraph 1 — The personal observation.**
> Thomas Norton started buying rural land two years ago and immediately ran into a problem the residential real-estate world had solved a decade earlier: the tools didn't exist. To run a small land business, he was paying for five separate products — a CRM built for house wholesalers, a data platform priced for hedge funds, a campaign tool, a spreadsheet for due diligence, and another spreadsheet for the seller-financed notes — and still missing follow-ups. The land-investor community is roughly 80,000 people in the U.S., growing fast, and almost universally underserved by software. The few products built for them either covered a sliver of the workflow or were repurposed from house-flipping CRMs that don't understand acreage, easements, or seller-financed paper.

> **Paragraph 2 — The build.**
> So Norton, a solo technical founder, spent eighteen months building AcreOS — a single operating system that takes a land investor from "I just got a list of 4,000 parcels" to "I'm collecting monthly payments on a seller-financed note" without leaving the app. AcreOS pulls from eighteen free government data sources to do due diligence in seconds instead of hours, scores every parcel on a FICO-like 300-to-850 scale called the Land Credit Score, and ships its own e-signature stack so investors don't have to glue DocuSign onto their closings. There is also a small team of named AI agents — internally Sophie, Forge, Atlas — that take action on the user's behalf: drafting offers in the user's own writing style, flagging deals at risk, generating 1098s at year-end. Customers see a single AI assistant called Pax; the multi-agent architecture stays under the hood.

> **Paragraph 3 — Why now.**
> Two things make this moment specific. First, county GIS data and parcel APIs have only been broadly machine-readable for about three years — a land operating system literally could not have been built in 2020. Second, the land-investing community has crossed a threshold where it has its own podcasts, conferences, and a generation of investors who now treat it as a real career instead of a side hustle. They have outgrown spreadsheets. AcreOS is the first software product designed from the parcel up for how they actually work — and it arrives at the moment they're ready to pay for it.

**Notes for use:**
- Ground rule: never use the words "Uber for X," "disrupt," or "platform-of-platforms." Greta has banned them.
- Replace any number above with verified figures before pitching. "Eighteen months," "80,000 investors," "18 data sources" — confirm each.
- Norton's competitor MEMORY rule applies: the published narrative names *categories* (residential CRMs, data platforms), never specific competitors. Internal pitch docs can be more specific; press copy stays category-level.

---

## 4. Launch Story Options — Three Angles, Ranked

### Angle A — "The first AI operating system for an 80,000-person trade nobody has heard of" *(RECOMMENDED)*

**Hook:** A tiny, profitable, fast-growing community of land investors has been quietly running a billion dollars of seller-financed paper on spreadsheets. A solo founder built them an operating system.

**Why it wins:**
- Reporters love "industry you didn't know existed." It is essentially the Stripe-for-X structure.
- Numbers carry it: 80K investors, $X billion seller-financed paper, 18 government data sources.
- Lets you avoid head-on combat with bigger PropTech narratives.
- The AI angle is *evidence*, not the headline — which is what sophisticated reporters prefer.

**Best outlets:** TechCrunch, The Information (PropTech beat), Inman, Wall Street Journal Real Estate, a16z's blog if you ever raise.

**Risk:** "Niche" can read as "small TAM." Mitigate with the adjacent-expansion narrative (which your strategy docs already support).

---

### Angle B — "Solo founder, 400K lines of TypeScript, 276 tables, no co-founder, no funding"

**Hook:** Counter-narrative to AI-fueled vibes-coding hype. A real, full-stack, production system built by one person.

**Why it could win:**
- Hacker News loves it. Technically credible.
- Pairs naturally with engineering-blog content — first technical post writes itself.
- Differentiates from the "I shipped an MVP in a weekend" noise.

**Best outlets:** Hacker News, Lenny's Newsletter, The Pragmatic Engineer, IndieHackers, dev.to, Software Engineering Daily.

**Risk:** Founder-centric stories age fast and don't drive land-investor signups. Use this as a *secondary* track to recruit engineers and investors, not the primary launch.

---

### Angle C — "The AI agents that actually do the work" *(NOT RECOMMENDED AS PRIMARY)*

**Hook:** While other tools "added an AI chat box," AcreOS ships autonomous agents that draft offers, score deals, and run the back office.

**Why it loses as the headline:**
- Every PropTech, fintech, and SaaS launch in 2026 leads with this. You will not stand out.
- Your persona architecture (Pax for customers; Sophie/Forge/Atlas internal) is *specifically designed* not to be the surface story.
- Risks invoking the "AI hype" frame, which sophisticated reporters increasingly distrust.

Use the AI angle as **paragraph 3 evidence** in Angle A. Never as the lede.

---

**Greta's call:** Lead with A. Park B for engineering channels. Demote C to a feature, not the headline.

---

## 5. Industry-Placement Targets — Top 10

Ranked by *fit × reach × ease of access*. Land-investor community first; mainstream PropTech second.

| # | Outlet | Show / Surface | Fit | Approach |
|---|---|---|---|---|
| 1 | **The Land Investing Podcast** (or strongest current land-vertical pod — verify in 2026) | Founder interview, 60 min | Very high — your exact audience | Cold email + customer-referral intro; offer beta access for the host |
| 2 | **BiggerPockets** | "On The Market" or "Real Estate Rookie" | High — BP listeners include land curious | Pitch as "the niche they don't cover" angle |
| 3 | **The Real Estate Guys Radio Show** | Robert Helms / Russell Gray | High — older, accredited audience | Pitch the seller-financed-note angle |
| 4 | **Inman** | News + Inman Connect | High — PropTech industry standard | Embargoed first-look pitch |
| 5 | **Land Investing Online community / Land Conference** | Sponsorship + speaking slot | Very high — direct user funnel | Sponsorship + founder talk |
| 6 | **HousingWire** | Tech track | Medium — broader RE | Embargo pitch, focus on note-management angle |
| 7 | **The Pragmatic Engineer** (Gergely Orosz) | Newsletter / podcast | Medium — for Angle B | Engineering deep-dive pitch |
| 8 | **Lenny Rachitsky's Newsletter** | Founder feature | Medium — solo-founder angle | Pitch the "PMF in a vertical" lens |
| 9 | **Hacker News** | Show HN | High for engineers, low for buyers | Coordinate with Angle B |
| 10 | **Local / state RE association podcasts** (TX, FL, AZ, OK) | Guest spots | Medium — high-intent audience | Bulk outreach via VA |

**Conferences worth pursuing in person (sponsor or speak, not booth):**
- Land Investor Summit (TX)
- The Land Conference
- Inman Connect (smaller booth, sit on panels — don't buy a big booth)

**Greta's rule:** *Three* well-placed pieces of coverage in your vertical beat thirty in TechCrunch. Vertical first.

---

## 6. Crisis Comms Playbook — Sketch

### Scenario: A customer's deal goes wrong. Journalist calls AcreOS for comment.

This will happen. Land deals fail because of title issues, undisclosed easements, off-grid water rights, seller fraud, and buyer mistakes — and AcreOS will be in the loop on every one. You need a posture *before* the first call.

### The 3 categories of incoming calls

| Category | Example | Posture |
|---|---|---|
| **A. Product was the cause** | "Your DD report missed a recorded easement and my customer lost $40K." | Take seriously. Investigate within 24h. Public response within 72h. |
| **B. Product was used, not the cause** | "User skipped the DD step and bought blind." | Statement that explains the workflow, defends the product, doesn't trash the user. |
| **C. Industry-wide story, AcreOS quoted as expert** | Reporter writing about land-fraud trends. | Best case. Always say yes (founder or designated spokesperson). |

### The first 60 minutes

1. **Acknowledge receipt within 60 minutes**, even if it's "We received your inquiry, will respond by [time]." Never ghost a reporter on deadline.
2. **Get the deadline.** "What time do you need this by?" — this single question buys you legitimacy and time.
3. **Get the specifics in writing.** Every claim, every name, every number — confirm via email, never just phone.
4. **Pull the data.** AcreOS has audit logs (`server/utils/logger.ts`, structured). Use them. You will know exactly what the user did and didn't do.
5. **Decide: comment, decline, or background.** Default to *comment*. Declining is read as guilt.

### Holding statements (drafts — refine later)

> **Category A (product implicated):**
> "We take this seriously. AcreOS is investigating the incident with the customer involved. Land due diligence pulls from 18 public data sources and we're verifying which sources, if any, contained the missing information at the time of the report. We'll share what we learn."

> **Category B (user error):**
> "AcreOS provides due-diligence tools that surface 18 government data sources for every parcel. We don't have specifics on this particular transaction we can share without the customer's consent, but we're committed to making the process clearer for every investor on the platform."

> **Category C (industry context):**
> Founder says yes to the interview. Stay in your lane: product, workflow, what you see across the platform. Never speculate on a specific named transaction you weren't part of.

### Don'ts

- **Never** quote one customer's transaction to a reporter without written consent.
- **Never** "no comment." Use a holding statement.
- **Never** let an engineer or support rep speak to press — single spokesperson (founder), single email (press@acreos.com), single phone line.
- **Never** trash the customer publicly even if they're wrong on facts.
- **Never** discuss other customers' situations to defend yourself.

### The 30-day cooling rule

If a piece is unfair and you weren't given fair chance to respond: corrections request → editor escalation → public response on your own blog. Do not feud on social. Greta has watched this destroy three otherwise-credible founders.

---

## 7. The 1-Week Press Readiness Sprint

You can credibly close the gap in 5 working days. This is the sprint.

### Day 1 — Assets

- [ ] Carve out `/press` route on acreos.com (static page, no auth)
- [ ] Write boilerplate "About AcreOS" — 75 words exactly
- [ ] Write founder bio — 50w / 150w / 400w versions
- [ ] Book founder headshot session (square, landscape, transparent bg)
- [ ] Export logo lockups: wordmark, mark, dark/light, SVG + PNG @ 1x/2x/3x
- [ ] Set up press@acreos.com → routes to founder + one backup

### Day 2 — Fact sheet + screenshots

- [ ] One-page fact sheet PDF: what / who / when / numbers / contact
- [ ] Capture 5 hero screenshots at 2x retina: Dashboard, Property + LCS, DD report, Offer wizard, Freedom Meter
- [ ] Record 30-second product walkthrough (1080p, MP4 + GIF)
- [ ] Verify every number used in narrative — no rounded guesses

### Day 3 — Founder narrative + spokesperson prep

- [ ] Lock the 3-paragraph narrative (Section 3 above) — circulate to 2 trusted readers
- [ ] Founder media training: 5 mock interviews, 30 min each, recorded and reviewed
- [ ] Build the **30-question briefing doc** — every question a reporter will ask, with one-sentence answer + supporting fact
- [ ] Decide on competitor language policy (per MEMORY: zero direct competitor name-drops in press)

### Day 4 — Customer references + crisis playbook

- [ ] Identify 5 beta users willing to be quoted on the record. Get **written consent** for: name, business, quote, photo
- [ ] Capture *one* anchor case study: 1 page, before/after numbers, quote, photo
- [ ] Lock the crisis comms playbook (Section 6) — print, save offline, share with one backup human
- [ ] Stand up the audit-log query you'd run in a Category-A incident — pre-build the SQL

### Day 5 — Outlets + pitch list

- [ ] Build a 30-outlet pitch CRM (Notion or spreadsheet): outlet, reporter, beat, last 3 stories, angle, contact
- [ ] Draft three pitch emails — one per angle (A/B/C). Subject lines under 8 words.
- [ ] Decide launch trigger: **what milestone justifies pressing the button?** (See below.)
- [ ] Schedule weekly "press posture" review — 30 min, recurring

### The milestone debate

Greta's strongest non-negotiable opinion:

**Do not spend your launch oxygen on shipping. Spend it on a milestone reporters can write a story about.**

Candidate milestones, in order of press-worthiness:

1. **First $1M of seller-financed notes managed on AcreOS** — concrete, reportable, defensible.
2. **First 100 paying land investors** — small but tangible.
3. **First customer who used AcreOS to fully replace 5 tools and saved $X/mo** — anchor case study.
4. **Adjacent-vertical expansion** (the strategy docs mention this) — "AcreOS expands from land to [X]" is its own story.
5. Plain "we launched" — weakest. Save it for the blog.

**The rule:** Product Hunt is not a press launch. It is a community launch. Reporters will not write about it. Do PH for the leaderboard and the email list; reserve real press pitches for milestone #1 above.

---

## Closing — Greta's Two-Sentence Memo

You have built the rarest thing in startups: a real product in a real underserved market with a credible solo-founder narrative. Don't waste it announcing the building — wait until you can announce *what was built with it*, and have the press kit ready so when a reporter asks for the founder bio at 4:47pm on a Friday, the link is one click away.

— GL
