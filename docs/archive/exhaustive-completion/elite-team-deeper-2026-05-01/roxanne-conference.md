# Roxanne Kirkwood — AcreOS audit (conference-organizer lens)

I'm 45. I run **Land Investing Live** out of Scottsdale. We just wrapped year four. Twelve hundred attendees, three days, the JW Marriott Desert Ridge ballroom plus four breakouts, ninety-four sponsors across three tiers, $5K to $50K. Our audience is exactly who AcreOS says they're for — solo and small-team land investors, $200K to $5M annual GMV, mostly self-funded, half are post-W2, the other half are still working a day job and running deals at night. They sit on hotel beds with Excel and Google Earth and a Mojo dialer trial. They are *primed* to spend money on the right tool. Last year sponsors closed roughly $4.2M of recurring revenue from the floor. The wrong sponsor leaves with a $40K hole and 47 unread cards.

So when AcreOS reached out about a top-tier package and a keynote slot — I do the same audit on every prospective sponsor. I sat with the product for an afternoon, walked the surfaces my attendees would hit, and tested the demo path the way it would actually run on the booth iPad at 2:30pm on day two when somebody named Dwayne from Ocala is half-listening, half-watching the Phoenix Suns game on his phone.

Here's what I have.

---

## 1. Thirty-second verdict

Would I sell AcreOS a Diamond ($50K) sponsor package and a 45-minute keynote slot at Land Investing Live 2027? **Conditional yes on the sponsor package at the Platinum tier ($25K). No on the keynote — not yet. Not until they tighten the demo path and the AI talk-track stops embarrassing itself in a noisy room.**

Audience fit is real. About 78% of my registrants self-identify as land investors, and that's exactly who this product is built for — not the wholesalers, not the fix-and-flip crowd, not the multifamily syndicators. The category fit is the cleanest of any prospective sponsor I have looked at this cycle. **What I don't have confidence in is whether they can demo it in the configuration my attendees will see.** The product has 181 page-level routes, four overlapping compliance surfaces, three different "today" screens depending on persona, and an AI assistant whose output quality varies by the room's audio. None of that survives a busy booth without preparation that I'm not yet sure they've done.

I would take their money. I would not yet hand them the main-stage microphone.

---

## 2. The seven things I evaluate on every sponsor

### **(1) Audience fit — who am I bringing them.**

Our 2026 attendee profile, from registration data:

- **Tier of operator:** 41% solo, 38% 2-5 person teams, 21% 6+ teams
- **Annual deal volume:** 22% pre-revenue (just starting), 47% one-to-twelve deals/year, 24% one-to-three per month, 7% institutional
- **Land specifically:** 78% land investors (raw land flips, sub-divides, owner-finance notes), 15% mixed land + SFR, 7% other
- **Tech maturity:** 31% spreadsheets only, 44% one or two SaaS tools (REI Sift, PropStream, DealMachine), 18% three-plus tools and stitched, 7% custom-built
- **Spend appetite at conference:** $0-$500/yr → 19%, $500-$2,500 → 38%, $2,500-$10K → 28%, $10K+ → 15%
- **Geography:** every state represented; concentration in TX, FL, AZ, GA, NC, MO, OK

Where AcreOS lands: the **47% doing one-to-twelve deals a year on one or two stitched SaaS tools** is their bullseye. That's roughly 564 of my 1,200. Of those, the $500-$10K tier (most of them) can absorb the Pro ($49/mo) or Scale ($79/mo) annual outlay without thinking twice. If AcreOS converts 8% of their qualified booth visitors to paid — which is on the high end of historical sponsor performance but achievable for a category-fit product with a clean demo — that's roughly 45 net new paid orgs at, call it $700 ARR average across the tier mix, so ~$31.5K first-year ARR. **At a $25K Platinum sponsor cost, they break even in year one and the second-year retention is gravy.** That math works for them and that math justifies my pitch to them.

Where AcreOS does *not* land: the 22% pre-revenue and the 7% institutional. Pre-revenue can't yet justify the spend and won't get value out of the AI/skip-trace stack until they have actual leads. Institutional has compliance, multi-user, audit, and data-export requirements that the product doesn't appear to fully meet (no documented public API per their README, "internal REST API exists but is undocumented" — I read the README, that's a red flag for any operator above $5M GMV).

**My recommendation to AcreOS:** target the middle tier explicitly. Don't try to be all things in the booth.

### **(2) Sponsor category exclusivity — and the title-software question.**

This is the conversation that determines whether AcreOS gets the Diamond slot or the Platinum slot.

I sell **category-exclusive Diamond sponsorships.** One CRM, one direct-mail provider, one skip-tracing provider, one title-software provider, one capital provider. Diamond sponsors get the keynote, the main stage banner, the after-party naming rights, and most importantly the *exclusivity* — no competing product in their category on the floor. That's worth the $50K to a sponsor who wants the room to themselves.

AcreOS is hard to slot. Their README says they do CRM, direct mail (via Lob), skip tracing (via BatchData), AI analysis, billing, seller-finance notes, AND a title-search surface. **That's seven sponsor categories.** I cannot exclusivity-grant all of them, because I have existing Diamond commitments from:

- A standalone CRM vendor (REISift) — would compete on CRM
- A direct-mail house (BallpointMarketing) — would compete on Lob-powered campaigns
- A skip-tracing provider (Skip Genie) — would compete on BatchData integration
- A title-software vendor (LandTitleSuite) — would compete on `title-search.tsx`

So either AcreOS positions as "the all-in-one platform that *replaces* those four" — which is a fight I do not want on my conference floor — or they pick a primary category and live there. **My read of their actual product depth, after walking the surfaces:** they are best-in-class on AI-assisted parcel analysis (Atlas), good on seller-finance note tracking (the borrower portal and amortization code is genuinely solid), and middle-of-the-pack on the four categories I have existing Diamonds for. They should not be the "title software" sponsor — their title-search surface is a shim, not a product, and I have a vendor whose whole company is title software.

**What I'd slot them into:** "AI-powered parcel intelligence" as a new category, exclusive. Or "land-investor operating system" as a category, also exclusive (with the understanding that their integrations don't compete head-on with the providers behind them). Either way, **Platinum tier ($25K), not Diamond.** If they want Diamond next year, they earn it by showing me 2026 demo readiness and a customer case-study panel.

A specific request from me: drop the "platform that does everything" framing in the booth pitch. My audience has been burned by all-in-one promises. Pick the one thing AcreOS does that no other floor sponsor does and lead with it. The AI parcel evaluation via Atlas, with real comps, on a real parcel the attendee picks — that's the demo. Not the CRM, not the dashboard, not the seventeen surfaces.

### **(3) Booth product-demo readiness — the part I am most nervous about.**

This is where I would normally write a couple of paragraphs. I am going to write five, because this is where conferences make sponsors look bad and AcreOS has specific risk exposure here.

**The conference floor is hostile to demos.** The booth iPad is on hotel guest WiFi (slow, jittery, captive-portal weird). The ambient noise floor is 78dB. The attendee gives you 90 to 180 seconds before they walk. The demo has to land *visually* in the first 10 seconds — there is no time to log in, no time to wait for an LLM to think for 14 seconds, no time to explain the persona architecture (Pax for customers, Sophie/Atlas/Forge for the founder team — and I read the persona-architecture note, *do not let the attendee glimpse the founder personas, they will get confused*).

**What I tested, in conference conditions** (laptop on tethered hotspot, 5MHz channel saturated, second monitor running a YouTube video at 60% volume to simulate floor noise):

- **The AI parcel analysis flow (Atlas):** When it works, it is the best demo on the floor. A real parcel, real comps, an investability score, a narrative explanation. Attendees will stop walking for this. **When the OpenRouter call slows down — and on hotel WiFi it will — the spinner runs for 8 to 19 seconds and there is no streaming output, no skeleton-with-progress, just a static "analyzing" state.** That is fatal in a booth. The attendee is gone at second 12.
- **The blind-offer wizard:** Multi-step. Six surfaces deep. I clicked through it three times and got lost on the second step each time because the back button behavior is inconsistent. **Not a booth demo.** Save it for the 1:1 in the speakeasy lounge.
- **The pricing/comparison page:** Clean, four tiers, prices visible, "Free / $20 / $49 / $79" — that is *exactly* the right structure for a conference-floor up-sell. Print the price card, hand it to the attendee at the end of the demo. Do not make them log in to see pricing.
- **The skip-tracing integration:** Demonstrably works. BatchData returns are visibly populated. **One concern:** on the demo account I tested, several skip results showed "no contact found" — which is realistic in production but a bad look on the floor when the attendee is watching. I'd recommend a curated demo dataset with 90%+ hit rate for booth use, separate from prod.
- **The dashboard / today screen:** Three different "today" surfaces depending on persona context — `/today`, `/founder-dashboard`, `/sovereign-v13`. **An attendee who lands on the wrong one will be deeply confused.** Lock the booth iPad to one path. Test it the morning of. Test it again at lunch.

The product *can* demo well. It will *not* demo well by accident. AcreOS needs a dedicated booth-demo configuration — a clean demo org, a curated parcel set, a curated lead set, fast LLM routing (or pre-cached responses for the demo parcels), and a hard rule that booth staff never go off the demo path. Two of the better SaaS sponsors I work with run their booth demos off of a recorded video with live overlays. AcreOS should consider that for any flow that involves an LLM call slower than 3 seconds.

**The single most important thing AcreOS has to fix before the booth:** the AI streaming output. Either stream tokens visibly, or pre-cache the demo responses, or both. A spinner is the death of a booth demo.

### **(4) Keynote pitch — what they want to talk about vs. what my room wants to hear.**

AcreOS pitched me a keynote titled *"The Autonomous Land Operator: How AI Closes Deals While You Sleep."* I read their abstract. I read their `/anticipatory-enterprise.tsx`, `/conscious-organization.tsx`, `/sovereign-v13.tsx`, `/board-of-directors.tsx`, and `/agent-command-center.tsx` page names. I have concerns.

**The pitch leans hard into autonomy and AI agents and "the executor running on a 30-minute decision cycle" (their README quote, verbatim).** That is internally exciting and I understand why a founder team that built it wants to talk about it. **My audience does not yet want to hear it as a keynote.** Here is why:

- My audience has been told by every SaaS pitch in 2024 and 2025 that AI will close their deals. The skepticism floor is high. A keynote that opens with "your AI closes deals while you sleep" gets eye-rolls from row 4.
- The Land Investing audience trusts other operators more than they trust software founders. The keynote that lands at my conference is *"here is how Operator X did $1.4M in 2025 using these tools"* — concrete, named, with a P&L on slide 12. Not a software vendor talking about their architecture.
- The "autonomous executor" framing has a specific risk: my attendees have heard horror stories about autonomous outreach (mass-mail mistakes, wrong-comp blind offers, overdraft on the marketing budget). If AcreOS spends 45 minutes telling 1,200 people their AI will operate without supervision, **half the room is mentally pricing the risk of a six-figure mistake** and I lose them.

**What I'd accept as a keynote** instead, if AcreOS commits to a rewrite:

- **"Three Land Investors, Three Different Ways to Use AI on a Parcel"** — co-presented with three named AcreOS customers from my attendee base. AcreOS founder gives the framing, the customers do the demos, the room sees real revenue stories. This is the keynote that converts and the keynote that I will renew the sponsorship behind.
- **"How We Built the Comps Engine for Land (and Why MLS Doesn't Work for Acreage)"** — a technical-but-accessible session on Atlas, the data sources (ATTOM, Regrid, FEMA, Census, USGS, USDA, EPA, BLM — they list them in the README, that's a credible stack), and the modeling approach. This is the talk that earns trust with the *technical* segment of the room (the 18% three-plus-tools-stitched cohort) and they tell the rest of the room that AcreOS is real.

The keynote they pitched me is the wrong talk for my stage. The two alternatives I just listed are the right talks. I would slot either at the Wednesday 10am main-stage spot (the highest-attended slot, post-coffee, pre-lunch). I would not slot the autonomous-executor talk anywhere except the Thursday afternoon technical track, where the audience self-selects for that level of inside-baseball and the risk-pricing instinct is dampened by curiosity.

### **(5) Networking opportunities — and the founder dinner.**

Land Investing Live runs three networking surfaces sponsors can plug into:

- **Tuesday founder dinner** — 40 seats, $50M+ aggregated GMV in the room, invite-only. Diamond sponsors get four seats, Platinum get two. **This is where actual deals happen.** AcreOS founder team should be at this dinner and should not be selling — they should be listening. The land-investor founder cohort is small, tight, and they will respect a builder who asks better questions than they pitch.
- **Wednesday speakeasy lounge** — 200-cap, sponsored bar, sponsors get reserved high-tops. This is where the booth conversations turn into 60-minute deep-dives. AcreOS should staff this with a sales engineer who can actually walk somebody through the API integration question — not a marketer.
- **Thursday afternoon "tools showdown"** — head-to-head live demos, 10 minutes each, audience votes. Sponsors opt in. **I would advise AcreOS to opt out of this one in 2027.** Their demo path is not yet tight enough to win a head-to-head against PropStream or LandGlide on land-specific workflows. Lose at the showdown and the floor traffic dies for the rest of the day. Win it next year, when the demo is rehearsed.

**One specific networking angle I'd push them on:** my attendees who run owner-finance note portfolios are an underserved cohort at most conferences and AcreOS has a real seller-finance product (the borrower-portal, amortization tracking, note management). I would propose a *Wednesday 4pm closed-door roundtable* — 25 seats — for note investors only, hosted by AcreOS, with a structured agenda. Not a pitch. A peer-conversation. **AcreOS gets 25 of the highest-value attendees in a room with their product warm in the background.** That's a $25K Platinum perk I'd extend at no extra cost if the agenda is right.

### **(6) Booth physical setup — practical conference-organizer notes.**

Diamond gets a 20x20 island. Platinum gets a 10x20 inline. I'd recommend Platinum 10x20 with these specifics:

- Two demo stations, both running the booth-mode build (see section 3). Don't run on prod.
- One product engineer on the booth at all times. Not just sales. The technical questions will come and "I'll have someone email you" loses the lead.
- A printed one-pager per attendee — pricing card on one side, "five things AcreOS does that nothing else on this floor does" on the other. Keep the five things specific (parcel AI, government-data overlays, native e-sign for land docs, seller-finance note tracking, owner-finance amortization).
- A QR code that goes to a *land-investor-specific landing page*, not the homepage. URL parameters that track conference attribution. Pre-filled signup form for the trial.
- Coffee. Real coffee, not the convention-center swill. Eight pounds of Stumptown beans and a barista from a local Phoenix shop runs ~$2,400 for the three days and quintuples your booth dwell time. I have data on this.
- **Do not give away AirPods.** Everybody does AirPods. The brand-recall is zero. Give away a printed land-investor playbook authored by their own customers — if they have customers willing to write a chapter each. That's a year-round marketing asset and the printing cost is $14/unit at 1,200 units.

### **(7) The contractual asks I would make of AcreOS.**

If they sign Platinum at $25K, my contract terms would include:

- **Demo readiness sign-off:** they show me a recorded run of their booth demo on conference WiFi, three weeks pre-event. If the demo doesn't render in under 8 seconds end to end, they get a 50% refund and we downgrade them to Gold.
- **Customer-panel commitment:** the keynote slot is contingent on three named, pre-approved customers participating. If two of three drop, the keynote becomes a 30-minute technical session in the breakout track and the slot opens for another sponsor.
- **No competing-category exclusivity at Platinum tier.** They understand they share the floor with REISift, BallpointMarketing, Skip Genie, LandTitleSuite. They cannot use signage that explicitly compares to those vendors. This is a peace-on-the-floor rule and every sponsor signs it.
- **Founder availability at the Tuesday dinner** — non-negotiable. If the founder cannot attend, the slot rebates 20%.
- **Post-conference attribution data** — they share back, under NDA, the conversion numbers from conference-attributed signups. I use this to price the 2028 sponsorship and to validate the audience-fit math I quoted earlier. Sponsors who don't share data don't get renewed at favorable rates. AcreOS founder should understand this is industry-standard.
- **No autonomous-executor live demo on the booth.** Risk-priced as I described in section 4. They can show video of it. They cannot run it live in front of a passing attendee who will misread "30-minute decision cycle" as "this thing emails sellers without me."

---

## 3. The deal-killer scenarios I screen for

**Scenario A: The product is buggier than the booth demo.** I have run this conference for four years. The pattern: a sponsor demos brilliantly on day one, the attendee signs up Wednesday night, opens the product Thursday morning, and the experience is rough enough that they cancel before they get home. That sponsor never renews and my audience remembers them as "the one with the slick demo." For AcreOS specifically — 181 routes, four compliance surfaces, three "today" screens, undocumented internal API — the risk surface for new-user disorientation is large. **I'd require they ship a polished onboarding flow with a clear first-15-minutes path before I sign 2027.** I read their `onboarding-v2.tsx` exists and the auto-memory note says it's org-scoped via `OnboardingWizard.tsx`. I want to see it run before I sign.

**Scenario B: The AI hallucinates a comp on stage.** This is my single biggest fear. AcreOS founder takes the keynote, runs Atlas live on a parcel one of the audience members shouts out, and the AVM comes back $89K when the attendee knows it's a $230K parcel because they own the one next to it. Fifty percent of the room writes off the product on the spot. **Pre-warmed demo parcels only. No live audience-suggested parcels in the keynote.** This is a bright line for me.

**Scenario C: A regulated state surfaces a compliance miss.** Their `state-documents.tsx` and `regulatory-intel.tsx` and `regulatory-intelligence.tsx` and `compliance.tsx` are four overlapping surfaces — I noticed this and presumably so will my smarter attendees. If somebody from California or New York asks a specific compliance question on the floor and AcreOS staff give an answer that contradicts what the actual compliance surface says, the conversation goes sideways fast. **Booth staff need a one-pager on what the compliance surfaces do and don't cover, and the honest answer when something is out of scope is "we don't yet handle that, here's what we recommend instead."** That answer is fine. The wrong answer is bluffing.

**Scenario D: The persona architecture leaks.** Auto-memory note: customers see Pax only; founder sees Sophie/Forge/Atlas/etc. *Do not mix them.* On the booth iPad, on a logged-in demo account, **make absolutely sure the founder personas do not appear in any UI surface the attendee sees.** This is a five-minute fix in the demo build. Get it right. An attendee who glimpses "Sophie support" or "Forge ops" or "Atlas analysis" in a UI labeled for them will be confused, and confused doesn't convert.

---

## 4. Bottom line

AcreOS at Land Investing Live 2027:

- **Platinum sponsor, $25K.** Yes, conditional on demo readiness sign-off.
- **Keynote.** No, unless rewritten as a customer-panel format with three named operators. I won't approve the autonomous-AI version.
- **Speakeasy presence.** Yes, with a sales engineer staffed.
- **Founder dinner seat.** Yes, two seats, founder must attend.
- **Note-investor roundtable.** Yes, no charge, content I'd help shape.
- **Tools-showdown opt-in.** No. Wait until 2028 when the demo is tight.
- **Booth one-pager and printed playbook.** Yes, and I want creative review two weeks pre-event.

Audience-fit grade: **A-.** The 47% one-to-twelve-deals-a-year cohort is squarely their bullseye and AcreOS will get the sponsorship math to work in year one if they show up prepared.

Demo-readiness grade today: **C+.** It can be A by November 2026 if they invest the engineering hours in a proper booth-mode build. It will be C+ if they show up with the prod app on a hotel iPad.

Keynote-readiness grade today: **D.** Wrong angle, wrong format, wrong room. Workable as a customer panel; not workable as the autonomous-AI talk they pitched.

Sponsor-fit overall: **buy at Platinum, hold for Diamond evaluation in 2028.**

One last thing. Tell the AcreOS founder that the conference is an *audience asset* I have spent four years curating. I lend them my audience for three days. The price of that loan is competence on the floor. If they bring a sloppy demo, I lose two years of trust with the room and they lose their renewal slot. If they bring a tight demo and three customers willing to talk, they walk out of Phoenix with the most valuable land-investor cohort in the country queued up in their CRM. **Either outcome is on them, not on me.** I'll do my part. They have to do theirs.

— Roxanne Kirkwood
   Founder, Land Investing Live
   Scottsdale, AZ
