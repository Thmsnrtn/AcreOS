# Whitfield Amos — Can I sell AcreOS into the mid-market for you?

I'm Whitfield. Fifty-three. I run Amos & Klein out of a third-floor walk-up on West Loop in Chicago — eleven SDRs, four AEs, a RevOps lead, and a fractional CRO who used to run sales at Procore. We do outbound-sales-as-a-service. Customers hire us when they have a working product, an unclear go-to-market, and no internal sales team to build the motion. We open the door, we run the demo, we close to a pilot, we hand off to customer success. Average engagement is $28K-$45K/month for six months minimum. We've sold software into property managers, contractor back-offices, ag-co-ops, and a couple of forestry tech firms. So: land investing isn't *foreign* to us, but it's not our wheelhouse either. The question Thomas put to me: could Amos & Klein outbound-sell AcreOS into the Penelope-tier — ten-person Land Investor shops doing 60-200 deals a year — and would the engagement work?

I spent two days reading the codebase, the landing copy, the pricing page, and the demo script. The answer is: *yes, sellable.* But there are five gaps that make the first ninety days harder than they should be, and one structural decision Thomas hasn't made yet that determines whether I run a clean motion or a messy one. Below is the audit.

---

## 1. The thirty-second verdict

The product is *demonstrably real* — `client/src/pages/pricing.tsx` ships an honest four-tier card with a monthly/annual toggle and a 20% annual discount; `shared/schema.ts:2937-3133` defines six SUBSCRIPTION_TIERS with hard limits, feature flags, and credit allotments; `acreos-landing/copy.jsx` carries three voice variants (default, aspirational, letter); `content/demo/demo-script.md` is an 87-line founder-recorded demo flow. That's more polish than most $5M-ARR companies have when they hire us. The pieces are there.

What's *not* there is the mid-market sales kit: no one-pager I can leave with a prospect after a discovery call, no ROI calculator I can hand to a CFO-style decision-maker, no comparison sheet against the obvious incumbent stack (PropStream + DocuSign + Mailchimp + a spreadsheet), no case studies with named customers and dollar outcomes, no MSA template, no published Enterprise pricing other than a `mailto:support@acreos.io` link, no contract-term flexibility surface, and no decision-maker access path on the landing page beyond the same "Start free trial" CTA that a solo investor sees. The motion AcreOS is built for is product-led-growth-into-a-self-serve-Stripe-checkout. The motion *I* run is consultative outbound into a buying committee. The two motions can coexist, but the collateral asymmetry means my AEs walk into discovery calls underprepared on the third or fourth question every time.

Net: I'd take the engagement. I'd ask Thomas to commit to building five collateral pieces in the first thirty days alongside us, and I'd ask him to make one structural decision about how Enterprise pricing works *before* we start dialing. Without that decision, every deal above $899/mo turns into a custom negotiation that bottlenecks on the founder.

---

## 2. ICP clarity — what I'd dial against

The landing copy says "Land Investors" consistently (matches the persona-architecture rule from the memory note — no "real estate professional" framing, no competitor refs, good). The aspirational hero says "Trusted by 12 founding investors closing $1.4M+ in their first 90 days." The letter variant says "12 investors in private beta. $1.4M closed. 0 of them have left." Both are usable proof points for a top-of-funnel email. Neither names a customer. For outbound into the Penelope tier — ten-person shops, $5M-$30M GMV, two acquisitions managers, a marketing lead, a transaction coordinator, a closer or two — I need at least three named customers in that tier with quotable outcomes. Twelve beta investors might be solo operators or duos; for the mid-market dial I have to know which of those twelve look like the prospects I'm targeting. Otherwise the proof point doesn't *prove* anything to the buyer I'm calling.

The pricing-tier names tell me AcreOS hasn't picked a clean mid-market wedge: free / Sprout ($29) / Starter ($59) / Pro ($179) / Scale ($449) / Enterprise ($899). The ten-person shop probably lands on Scale ($449/mo, up to 25 team members, unlimited leads, AI portfolio management) — but the marketing on Pro says "Most popular solo," Scale says "For serious operators," and Enterprise says "For funds & teams." That's the right *vibe*, but the buying committee at a ten-person shop will look at "Scale: operate like a fund" and ask "are we a fund? Should we be on Enterprise?" — and Enterprise is *2x the price* with no clear feature delta beyond white-label, SSO, multi-org, and unlimited seats. SSO will close some of those calls, but for the mid-market I want a "Team" tier between Scale and Enterprise priced at $649-$799/mo that bundles SSO, audit-log export, dedicated onboarding, and a quarterly business review without forcing them into the white-label-empire shape. That's the tier my AEs would close 60% of their pipeline into.

The businessType enum at `shared/schema.ts:41` lists fourteen onboarding paths — flipper, wholesaler, buyer, seller-financer, etc. The mid-market shop is rarely *one* of those; they do all of them. The onboarding wizard wants a "team / multi-strategy" branch that signals to the buying committee "you're not boxed into one motion." Today they pick whichever option the loudest acquisitions manager prefers, the workspace gets configured for that motion, and the marketing lead opens it the next day and feels left out. Sales-killing.

---

## 3. Sales-collateral readiness

What exists, what doesn't, ranked by how often my AEs would reach for it:

**Exists, usable as-is:**
- Pricing page (`client/src/pages/pricing.tsx`) — clean, tabular numbers, monthly/annual toggle, 20% annual discount, 14-day free trial, no card. Good.
- Landing copy in three voices (`acreos-landing/copy.jsx` default/aspirational/letter) — I'd use *letter* for cold outbound (founder-personal, low-friction), *aspirational* for inbound landing, *default* for paid acquisition.
- Demo script (`content/demo/demo-script.md`) — 87 lines, founder-recorded, 3-5 minute target. Real. I'd repurpose it as the AE's first-call structure.
- Onboarding wizard with sample data — closes the "I want to see it before I commit" objection without us scheduling a custom demo. Self-serve trial *works.*
- Tier feature lists in `schema.ts:2937-3133` — granular enough to build a comparison sheet.

**Missing, painful:**
- **Two-page leave-behind.** What I send after a discovery call to give the prospect something to circulate internally. Should be PDF, branded, with: problem statement (the spreadsheet/four-tools-and-a-Notion-doc life), AcreOS one-paragraph, three named customer outcomes, pricing summary, what-you-get-in-30-days, signature box for the AE. AcreOS has no PDF export of any of this. Today my AE would have to build it themselves the night before. They wouldn't.
- **ROI calculator.** A spreadsheet (or a hosted page at `/roi`) that says: "Enter your acquisitions per year, marketing spend, and team size. We'll show you AcreOS's expected impact in dollars." Mid-market buyers run the math before they sign. Without it, they run *their own* math and they always run it conservatively.
- **Comparison page.** "AcreOS vs. PropStream + a spreadsheet + Mailchimp + DocuSign + Calendly." I do not need to name competitors directly — the memory note says zero references to Land Geek/GeekPay/etc. — but the *category replacement* story is what mid-market buyers respond to. The current landing copy hints at it ("the 5 tools I was using"); it doesn't compute the replacement cost. If a ten-person shop is paying $290/mo for PropStream, $97/mo for an alternative, $99/mo for Mailchimp, $480/mo for DocuSign Business Pro, $40/mo for Calendly — that's $1,006/mo, and AcreOS Scale at $449 cuts that by 55% before talking about productivity. That math should be on a page I can link to.
- **Three named case studies.** Customer name (or initials + state), team size, acquisitions per year before/after, time-to-close before/after, a one-paragraph quote from the principal. Twelve beta investors should yield three of these. Today the proof points are aggregate ("$1.4M closed") and unnamed — that closes solo investors but doesn't move buying committees.
- **MSA + DPA template.** Mid-market shops have an in-house counsel or a part-time lawyer. They want a DocuSign-able MSA they can redline, a DPA for state-level data privacy (Georgia, Texas, Florida, California all have flavors), and a standard support SLA. The Stripe checkout flow and the click-through ToS work for solos and Sprout/Starter; they break at Scale and above. AcreOS has none of this in `/legal` or anywhere in the repo I could find.
- **Security one-pager.** SOC2 status (current, in-progress, planned), data-retention policy, data-residency options, customer-data export path, breach-notification timing, sub-processor list. The mid-market security questionnaire takes my AE an hour the first time and ten minutes every time after if there's a one-pager. Without it, every deal stalls four to seven days while we file Vanta or Drata answers manually.
- **Founder-recorded objection-handling videos.** Five 90-second clips, indexed by objection. Sent in email after discovery to keep the deal warm before the second call. Thomas has the on-camera comfort (the demo script reads founder-voiced); he hasn't recorded these.

I can ship some of these from our shop — we've built sales kits before — but the security one-pager and the MSA require Thomas's input. Not negotiable.

---

## 4. A Tuesday on the dial — what one of my AEs actually experiences

Let me make this concrete. Tuesday, 9:15 AM, my AE Marcus is dialing into a Penelope-tier shop — Greene Land Holdings out of Lakeland, Florida, eleven employees, 140 acquisitions in 2025. Marcus pulled the company from a list our RevOps lead built off LinkedIn Sales Navigator filtered on "land investing" + 5-25 employees + Florida/Georgia/Tennessee/North Carolina. The principal, Carla Greene, is ex-Wells Fargo commercial banking, 47, owns the shop with her husband. Marcus sends a six-line cold email pulling from the *letter* voice variant — "I'm reaching out because I work with a software company built by a Land Investor, for Land Investors. The founder runs his own land business on it" — and books a 30-minute discovery for Wednesday.

**Wednesday discovery call.** Marcus opens at the dashboard demo (per the restructured flow). Carla's head of acquisitions is on the call — Roger, 38. They like the deal-feed UI. Roger asks: "How does this compare to PropStream? We pay $290 a month for it." Marcus: "PropStream is a data subscription. AcreOS is the operating layer that turns that data into deals — it has its own data on top of public records, and it stitches in mailers, e-sign, and the CRM. Want me to send the comparison?" *He has no comparison page to send.* He improvises in email afterward: "Here's a rough breakdown" + a Notion doc he typed up. Carla forwards it to her CFO. CFO emails back: "What's the contract?" Marcus: "Stripe self-serve, monthly or annual, 20% off annual." CFO: "We don't sign click-through agreements over $10K/yr. Send me the MSA." *Marcus has no MSA.* He punts: "I'll get that to you by end of week." He emails Thomas. Thomas drafts something over the weekend. Carla's CFO redlines it on Monday. Two more rounds. Deal closes the following Friday — twenty-three days from first dial. Should have been ten.

That's the cost of missing collateral, dialed in for one deal. Multiply by the 30 SQLs we'd run in a quarter and that's roughly 200 AE-hours of friction that should have been spent on net-new dials.

---

## 5. Demo flow — what works, what I'd change

The 87-line demo script in `content/demo/demo-script.md` is *founder-shaped* — it's how Thomas demos the product to another investor at a meetup. That's the right voice for letter-variant inbound. For mid-market outbound, my AE needs a different structure: discovery first, demo second, and the demo needs to start at the *outcome* the buying committee cares about, not at onboarding.

What I'd restructure:
- **Open with the dashboard, not the login screen.** Mid-market buyers want to see the operator-in-flight. Start at `/dashboard` with sample data populated, walk through the morning briefing, end at the deal feed. Onboarding is a five-second mention ("setup takes seven minutes"), not a 30-second segment.
- **Show the AI agents earlier and concretely.** The current script gets to the AI implicitly through the property intelligence walk-through. The mid-market buyer is sold or unsold by minute two on whether the AI is real or theatre — show Pax drafting an outbound mailer in real time with a parcel-specific hook (not a generic "[Owner Name], I'm interested in your property at [Address]" template). The demo needs a moment where the prospect goes "oh — that's not a Mailchimp template, that's actually written for *that* parcel."
- **Show the multi-user surface.** Ten-person shop = "where do my acquisitions managers live, where do my closers live, how does work hand off between them?" Demo script today is single-user. The team-collaboration moment is the closing argument for Scale tier and above.
- **Don't show pricing in the demo.** The current script is good about this — it doesn't pitch tiers — but the AE script should explicitly defer pricing to the second call. Mid-market buyers ask early; the answer is "I'll send a tailored proposal after this call once I understand your team size and target volume." Not "Scale is $449."

There's a `LiveDemoMode` component (`client/src/components/live-demo-mode.tsx`) — if it's a guided in-app tour, my AEs would screen-share it instead of a slide deck for second meetings. That's a real asset if it exists in working order.

---

## 6. Objections + responses (the ones I'd hear in the first hundred dials)

Compiled from the equivalent motions I've sold (PM software, contractor back-offices, ag-co-ops):

**"We already use [the tab-stack — PropStream + DocuSign + Mailchimp + a spreadsheet]."** — Response: "Right, and you probably also use Calendly and a Notion doc holding it together. AcreOS replaces the whole stack with one tool. Want me to send you the comparison?" *I'd want the comparison page to exist before saying this.*

**"AI-written letters won't work — sellers see through them."** — Response: send the prospect a Pax-drafted sample letter for a parcel they own (cold-outbound trick: pull a parcel from their portfolio that's public-record, have Pax draft, send as proof). High effort, high close-rate. *Requires Pax to be available in the trial workspace before the prospect signs — needs verification it is.*

**"$449/mo × N seats is too expensive for a ten-person shop."** — Response: "Scale is $449 for the org, not per seat — up to 25 team members included. You're comparing it to the wrong shape." This is the *most important objection-response* and the pricing page does not make this seat-included math obvious. The tier card says "team members: 25" in the unlocks list but doesn't *anchor* it visually as "all 25 seats included." A "per-org, all-seats" callout on the pricing page would close 15% more deals at this objection alone.

**"What happens when we leave?"** — Response: "Full data export, all parcels and leads and deal documents, in CSV and PDF, no charge, within 24 hours. It's in our DPA." *DPA does not exist. This response is unsupported today.*

**"We have an in-house counsel who needs to review the contract."** — Response: send the MSA + DPA + SLA. *None exist.* Today my AE punts to "we'll work with you on terms" which signals "founder will negotiate one-off" which slows everything by two weeks.

**"Is this SOC2?"** — Response: "We're [in progress / completed / planned for Q3]." I don't know the answer. Neither will my prospect after the call. *Needs a clear public answer.*

**"How do I know this won't be abandoned in two years?"** — Response: "Thomas is a Land Investor first, software builder second. He's not a VC-backed founder pivoting to whatever's hot. He owns the company; he's running his own land business on it. Read his founder letter — `letter` voice variant in `acreos-landing/copy.jsx` is verbatim true." This is actually a *strength* for AcreOS that most B2B SaaS can't claim. We should lean on it.

**"Can we white-label it?"** — Response: "Enterprise tier, $899/mo, includes white-label portal, custom domain, and brand customization." *That answer is in the pricing page; it works.* This objection is rare in the Penelope tier (ten-person shops don't usually need it) but common one tier up.

---

## 7. Decision-maker access

For a ten-person Land Investor shop, the buying committee is: principal/founder (final yes/no), head of acquisitions (operational sponsor), marketing lead (mailers, lead-gen — biggest workflow change), transaction coordinator (closing process — second-biggest change). My ICP entry point is the principal — they sign — but the *unblocker* is whichever of the other three brings it to the principal. In our motion that's almost always the head of acquisitions, because they feel the spreadsheet-tabbing pain most acutely.

The landing page CTAs today are all "Start free trial" or "Talk with us" or "Schedule a demo" — generic, undifferentiated, and they all route the same place (Stripe self-serve checkout or `mailto:`). For mid-market outbound I want a separate path on the landing page: *"For teams of 5+, talk to a strategist"* with a Calendly link going to my AE (or to Thomas in the early days). Without that path, every mid-market lead comes in through the same self-serve funnel and I have to retroactively reach out — which means I'm chasing people who already started a free trial, which is the *worst* time to outbound them. The right outbound moment is *before* they self-serve. Two CTAs on the landing page; one for solo, one for teams. Doesn't exist today.

The persona-architecture rule (Pax customer-facing, Sophie/Forge/Atlas founder-only per the memory note) means my AE shouldn't pitch "Atlas does X for you" to a prospect — Atlas is founder-internal, Pax is the customer-facing AI. I'd have to retrain my AEs on the language. That's a one-page playbook, not a hard problem, but it's a required piece of onboarding our team.

---

## 8. Pricing transparency

The pricing page is one of AcreOS's *strongest* sales assets. Most B2B SaaS in the mid-market hides pricing behind a contact form. AcreOS publishes six tiers with hard limits, feature lists, and a 20% annual discount. That alone makes my outbound 30% easier — when a prospect asks "what's it cost?" on a cold call I send them the pricing URL and they have a real answer in ten seconds. Most of my engagements I have to *negotiate* the pricing reveal with the founder; here it's a non-issue.

What needs work:

- **Annual discount inconsistency.** The marketing-site pricing in `acreos-landing/sections-3.jsx:83` says "Save 17%"; the in-app pricing page (`client/src/pages/pricing.tsx`) Badge says "Save 20%." Two surfaces, two numbers. I'd be asked which is right and I'd have to guess. Pick one.
- **No team-tier sweet-spot.** Gap between Scale ($449) and Enterprise ($899) is $450 with no intermediate. The mid-market lands awkwardly. Add "Team" at $649-$799 with SSO + audit logs + onboarding included. (See ICP section.)
- **Enterprise pricing is a `mailto:`.** The pricing page footer says "Need custom enterprise pricing? Email support@acreos.io." That routes to the support inbox, not a sales inbox, with no SLA. Mid-market buyers who hit that link expect a 24-hour response with a tailored quote. Today they get the support-AI auto-responder. Replace with a Calendly to a sales-qualified human (or to Thomas in the early days), set a 24-hour SLA, and route to a real `sales@acreos.io` mailbox.
- **Per-seat math under Scale tier is invisible.** Scale gets 25 seats included; Pro gets 10; Enterprise unlimited. None of that is foregrounded on the pricing card — it's buried in the unlocks list. Pull it up to the tier headline: *"Scale — $449/mo — up to 25 team seats."* This single change closes deals.
- **Annual savings example.** "Save 20%" is abstract. Show the dollar: *"Annual: $4,310 — save $1,078/yr vs monthly."* Mid-market CFOs anchor on dollars, not percentages.

---

## 9. Contract terms — annual vs monthly

Self-serve Stripe handles monthly and annual cleanly for tiers up to Scale. That's fine for Sprout/Starter/Pro buyers. For Scale and above, mid-market buyers want a *signed* agreement — not a click-through — for three reasons: their accounting wants a counter-signed PDF; their procurement requires it; their counsel wants negotiation rights on liability, indemnification, and data-handling clauses.

What's needed:
- **Annual auto-renew with 30-day cancellation.** Standard mid-market term. Today the Stripe annual flow is presumably auto-renew — the cancellation window isn't documented anywhere I could find.
- **Multi-year discounts (12 / 24 / 36 months).** Mid-market buyers will ask. Standard is 20% / 25% / 30% off list for 12 / 24 / 36-month commits with annual prepay. AcreOS publishes 20% for annual; nothing for 24 or 36. If Thomas isn't ready to commit to 36-month pricing (rational — too early), my AE handles this with "we don't publish 36-month rates yet, but I can ask." Workable.
- **Pilot terms.** First 30-60 days, prorated, exit clause if X seats aren't onboarded. Mid-market buyers respond to this. AcreOS's 14-day free trial is a *consumer* pilot; the *enterprise* pilot is a paid 60-day with success criteria. Doesn't exist as a product offering today; my AE would have to construct it ad-hoc per deal.
- **Refund and credit policy.** What happens if AcreOS goes down for 48 hours? What's the SLA? Status-page exists somewhere I assume; the SLA in dollars does not. Mid-market buyers ask. Today the answer is "we'll work with you" — better than nothing, worse than a documented 99.9% uptime credit.

---

## 10. Enterprise pricing flexibility

The Enterprise tier at $899/mo is what most platforms call "Team" pricing. It's underpriced for what it includes (white-label, multi-org, SSO, unlimited seats, custom integrations) and underbuilt for what genuine enterprise buyers want (dedicated CSM, custom SLA in dollars, SAML SSO with a specific IdP, data-residency options, named environment with dedicated DB, professional services for migration). For my mid-market motion that's *fine* — we'd sell into the $449-$899 band — but if AcreOS wants me to also work the upper end (multi-state operators, family-office back-offices, agency firms), I need a *real* Enterprise tier with a *real* sales process: discovery → custom proposal → 60-day pilot → multi-year commit.

The structural question I mentioned at the top: *does Thomas want me to negotiate Enterprise pricing on his behalf, or does every Enterprise deal route to him personally?* If me: I need a published pricing range ("Enterprise: $1,500-$5,000/mo, custom"), a written deal-desk policy on what I can flex (annual prepay discounts, free seats, custom integrations as paid SOWs), and Thomas approving anything below floor. If him: I'm a lead-gen engine for him, my AEs hand off at qualification, and we don't compensate for closes — we compensate for SQLs. Two completely different engagements with two different pricing models for me. I'd need that decision before signing.

---

## 11. Sellability verdict — and the engagement I'd quote

Sellable. The product is real, the pricing is honest, the founder is on-camera and articulate, the trial is frictionless, the early proof points are usable. The motion is mid-market outbound at $28K-$35K/month for 6 months. Goal: 30 SQLs, 12 paid pilots, 6 closed-won at Scale or Team tier in the first 90 days. Realistic, not aggressive.

My pre-conditions:
1. Thomas decides on Enterprise pricing flexibility (me-negotiate vs. him-negotiate). One sentence in writing.
2. Five collateral pieces ship in 30 days: two-page leave-behind, ROI calculator, comparison page, three named case studies, security one-pager.
3. MSA + DPA + SLA template ships in 45 days. (I can write the first draft if Thomas's counsel reviews.)
4. Pricing page gets four edits: 17%/20% inconsistency fixed, "all seats included" callout, annual dollar example, sales-routed Enterprise CTA replacing the `mailto:`.
5. Add a "For teams of 5+" CTA to the landing page routing to my AE's calendar.
6. New "Team" tier at $649-$799/mo or commit to keeping the Scale-Enterprise gap. Either is fine; the indecision is what I can't sell against.

If those land, AcreOS runs a clean mid-market motion. If they don't, my AEs spend half their cycles improvising collateral that should already exist, and the close rate drops 30-40%. That's the difference between a successful engagement and a referenceable one.

P.S. — One non-obvious wedge: the persona-architecture rule means I can pitch *Pax* to prospects as "the customer-facing AI" without ever mentioning Atlas/Sophie/Forge. That's actually clean. Most AI-products muddle their internal-vs-external personas; AcreOS already drew the line. My AEs would love it. Less to memorize, less to mis-say in front of a buyer.

— Whitfield
