# Geoffrey Lane — Land Investing Weekly, Sponsorship + Guest Slot Decision

**Persona:** Geoffrey Lane, 42, host of *Land Investing Weekly*. 12K weekly listeners, 220 episodes shipped, niche-dominant in "boots-on-the-ground rural land flippers." Five-figure quarterly sponsor reads. Boise studio, Riverside FaceTime mic, Descript editor.
**Stack today:** Buzzsprout for hosting, ConvertKit for the newsletter (8.4K subscribers, 38% open), Patreon for the $9 tier (412 patrons), Stripe for the course ($497). I've sponsored DataTree, Pebble, REI Pebble, RentRedi, and Land Elephant. I've turned down twelve more.
**Wave 3 audit. 2026-05-01.**

I read Cyrus's note (1,200 deals/yr, MAX_BATCH=100 will kill him), Wendell's note (the note ledger has to compute), and Penelope's note (RBAC or bust). What none of them are wired to think about is **the meta-question**: would I let AcreOS rent my audience's trust for a 90-second mid-roll? That question has a totally different answer matrix than "should I, an operator, buy this."

Sponsorship is a different hat than usage. I am not the buyer. I am the introducer. **My career is a stack of trust I've spent six years building. I light it on fire one bad sponsor at a time.** Last year I dropped a CRM sponsor mid-contract because three listeners DM'd me that the export feature lost their data. That was $14K I returned on principle. So when AcreOS reaches out for sponsorship + guest slot, my filter is not "is the product good." It's "if I send 12,000 land investors at this URL, what happens to them, and what happens to me."

---

## 1. Thirty-second verdict

**Sponsorship: yes, but not yet.** I'd run a four-episode test flight at $4,500/episode (my niche-CPM rate) once three trust gates clear. They have not all cleared as of this audit.

**Guest slot for Thomas: yes, immediately.** The story arc is unusually strong — solo founder, ex-operator, building the tool he wished he'd had at 60 deals/year, persona-architecture choice (Pax visible to customers, Sophie/Forge/Atlas hidden internally) is the kind of inside-baseball my audience will eat with a spoon. **That episode writes itself; I'd record next month.**

**Audience recommendation: not yet.** I won't tell my list "go buy AcreOS" until the gates below clear. I will tell my list "Thomas Norton is building something interesting, here's the conversation, decide for yourself." That's a different bar and AcreOS clears it today.

The order matters: **guest first, sponsorship second, recommendation third.** Most founders try to flip that order and it never works.

---

## 2. The trust threshold — three gates

### Gate 1: data export must be real and obvious

When I sponsored Pebble in 2023, the question I got back from listeners eight times in the first month was *"can I get my contacts out if I leave."* Pebble's answer was a hard-to-find CSV export with no SMS history. I had to write it up as a clarifier in episode 147. Audience trusted me less the next quarter.

For AcreOS the answer needs to be **a single page, accessible from a top-level nav link, that exports every entity (leads, deals, parcels, offers, mailers, messages, documents, notes, activity log) as a zip of CSVs with no engineer required.** The audit shows `data-export.tsx` exists at 296 lines. I haven't loaded it. **Before I sign, I want a 60-second screen recording of a free-tier user opening that page, clicking one button, and getting a zip with their full account in 12 CSVs.** That recording becomes a slide in my mid-roll: "Here's the export page. You own your data."

If the export is partial — leads only, no SMS log, no offer history — my answer is no. The land investing world is paranoid about lock-in. They've all been burned by a "tool" that turned into a hostage situation.

### Gate 2: founder must be reachable, named, and on-camera

Mark from Pebble never came on. I asked twice. He sent his head of marketing instead. The episode aired but it landed as a marketing episode, not a craft episode, and it converted at a quarter of my normal sponsorship rate.

Thomas Norton, by the audit, is **on-camera in `FounderNote.tsx`** — there's a portrait component, his name on the landing page, a hand-signed letter ("the founder explaining why he built this — it's the most personal piece of copy on the landing"). That's the right posture. **What I need additionally:** a public commit history showing he's still the one writing core code, a phone number my audience can text if their account breaks, and a willingness to come on the pod and answer the hard questions I'll ask.

The hard questions: **Why isn't there round-trip amortization yet (Wendell's note)? Why is `MAX_BATCH = 100` (Cyrus's note)? Why are there three sequence surfaces (`automation.tsx`, `drip-sequences.tsx`, `sequences.tsx`)? When will RBAC ship for the team buyer (Penelope)?** I don't ask these to embarrass — I ask because my audience hears the founder face into the gap honestly, and that's the moment trust transfers. A founder who deflects gets one episode. A founder who answers gets four.

### Gate 3: one customer I can interview independently

Sponsor reads where the host says "I tried this myself" beat sponsor reads where the host reads ad copy by 3–4× on click-through. I've measured this on my own pod. **What converts even better: a third customer voice, taped, 30 seconds in the mid-roll.**

For AcreOS I need **one operator doing 60–250 deals/year on it, willing to give me a 20-minute interview I can pull a clip from**. Not a beta tester. Not a friend of Thomas. A paying customer at the Operator tier who has been on for at least 90 days and switched off something else. If that customer doesn't exist yet, the sponsorship conversation is six months early and I'd rather wait.

If that customer is *Cyrus or Wendell from the audit*, even better — those are exactly the operator profiles my audience ladders toward. The audit-as-customer-interview pipeline writes my mid-roll for me.

---

## 3. Founder-as-guest — the story arc

I've outlined the episode. 52 minutes, three acts.

**Act 1 — The hole he was trying to fill (12 min).** Thomas at 60 deals/year, juggling Pebble + Zoho + a Google Sheet for note amortization + Open Letter Marketing on a separate browser tab. The moment he realized the tool didn't exist. The decision to build instead of duct-tape. *This is the act my audience self-identifies with.* Every operator listening has the same Sheet. They want permission to admit it's broken.

**Act 2 — The persona-architecture bet (18 min).** This is the act nobody else in the niche could do, because nobody else built it this way. **Customers see one assistant, "Pax." Internally there are six — Sophie, Forge, Atlas, others — each routed to its own model and prompt.** That's a craft decision with real product trade-offs and Thomas should walk through (a) why he split the internal cast, (b) why he merged the customer-facing surface, (c) what he learned the first time a customer saw "Sophie" in an error message. *This is the act that earns the "build in public" credibility.* It's also the act that explains AcreOS's whole posture to a non-technical operator: "the AI does six different jobs but you only have to know one name." That sentence is the mid-roll.

**Act 3 — The honest gap (14 min).** What's *not* shipped. The note ledger that Wendell wants. The bulk operations Cyrus wants. The RBAC Penelope wants. Thomas walking through which of these is on the 90-day roadmap, which is on the 12-month roadmap, and which he's deliberately said no to. **Founders who won't say "no" to features sound dishonest. Founders who say "no, here's why" sound like operators.** This act is what makes the sponsorship that follows believable, because I haven't pretended the product is finished.

**Closer (8 min).** Pricing reality, the BYOK story (Cyrus's $5K/yr in his pocket because he keeps his own DataTree contract), the founder's promise on data export, and a soft CTA: free trial code, 60-day money-back, my own discount link tracking.

I'd record this in the next four weeks. The script is doing 70% of the work for me.

---

## 4. Would I recommend AcreOS to my audience?

Three different audiences, three different answers.

### My core listeners (60% — operators at 20–80 deals/yr)

**Yes, with caveats, after gates clear.** This is the AcreOS sweet spot — the audit's "50–250 deals/year with a small team" posture maps directly onto my median listener. I'd send them at the **Solo $199** or **Operator $499** tier with a clear note: "if you do more than 200 deals/yr, talk to Cyrus's review first; if you carry seller-financed paper at scale, wait for the note ledger."

The caveat is the friction. My audience will email me about every dead-end. I need a customer-success channel that doesn't drop their tickets. **What I'd want to verify before recommending:** support response time SLA, public changelog cadence, and a status page. If those three are missing or stale, I send my list at a *different* tool and revisit AcreOS in two quarters.

### My patron tier (8% — solo flippers, $9/mo on Patreon, hands-on)

**Yes, immediately.** These are the highest-engagement listeners. They're the ones who'll forgive rough edges because they like watching a founder iterate. They're also the ones who give me the field reports I use in episode 221 to tell my core list whether AcreOS held up. **The patron tier is my de-risking layer for the whole sponsorship.** I'd offer them an extra 30% off through a host-specific code and ask for written feedback in exchange. That's 40-ish operators, real signal, real testimonials.

### My course buyers (3% — newer, paid $497 to learn the craft)

**Not yet.** Course buyers haven't done their first deal. They need a $19 spreadsheet, not a $499 platform. Sending them at AcreOS is overshooting their stage and burning their wallet on a tool they won't fully use. I'd rather they buy AcreOS in month 9 of their journey, not month 1. **Telling new operators "buy the platform now" is how I lose course-buyer trust.** The right move: a free-tier or "starter at $79" SKU that's a clear ramp. The audit doesn't show one. That's a hole.

---

## 5. Competitive products vs AcreOS — what's the honest narrative

This is the question my audience cares about most and most sponsors botch. The right answer is not "AcreOS beats everyone." The right answer is "here's where AcreOS belongs in your stack and here's where it doesn't."

### vs. Pebble (SMS-first land CRM)

**AcreOS wins on breadth, Pebble wins on SMS depth.** Pebble's SMS console is mature; AcreOS's is unknown to me from the audit. **What I'd say on-air:** "If SMS is 80% of your acquisition motion, stay on Pebble for now and revisit AcreOS in six months. If SMS is one of four channels and you also need parcels, offers, deals, mailers, and a GIS view, AcreOS is the consolidator." That framing is honest and won't get me sued by either side.

### vs. Land Elephant / generic land CRMs

**AcreOS wins on tooling depth, the generics win on simplicity.** A first-week land flipper opening AcreOS will see `/today`, `/leads`, `/parcels`, `/offers`, `/deals`, `/mailers`, `/messages`, `/automation`, `/data-export`, and probably 12 more surfaces. That's *necessary at scale and overwhelming at start*. **The narrative I'd run:** "Generic CRMs are a tablecloth. AcreOS is a workshop. Don't open the workshop until you've outgrown the tablecloth." My new-investor listeners will self-sort.

### vs. spreadsheet + duct tape

**The honest comparison.** This is what 70% of my audience actually uses. The mid-roll narrative is *not* "AcreOS is better than Sheets" — that's a feature war I'd lose to listeners who like their macros. The narrative is *"AcreOS is the day you stop being your own ops engineer."* Thomas built the workshop because he was tired of being the engineer. The pitch is identity-shift, not feature-list. **That's the pitch I'd record.**

### vs. Zoho/HubSpot/Salesforce horizontal CRMs

**AcreOS wins, no asterisk.** Land has too much vocabulary — APN, parcel, county tax-status, owner of record, deed type, encumbrance, easement, mineral rights — for a horizontal CRM to ever model right. My audience that tried Zoho came back. **This is the safest comparison to make on-air.** I'd lean on it in episode one and let the listener fill in the rest.

### vs. DocuSign / e-sign add-ons

The note in MEMORY.md — *AcreOS ships its own native signing stack; don't propose DocuSign/HelloSign as a fix* — tells me Thomas has thought about this. **That's a story beat.** Most CRMs farm out signing to a $25/mo add-on per user. If AcreOS includes native e-sign in the platform price, that's $300/yr/seat saved for my team-buyer listeners. Thomas should put that on the landing page in a comparison table I haven't seen yet (I checked `Pricing.tsx` and the landing components — no comparison table component exists). **Build it. I'll screenshot it in the show notes.**

---

## 6. Sponsorship economics — the real numbers

My niche CPM is $35–45 (industry baseline is $18–25; land investing is high-intent and small-list, so we run hot). My pre-roll is $1,500/episode at 12K listens, mid-roll is $4,500, post-roll is $1,200, full read with founder interview is $9,500. **A four-episode flight is $18K minimum.** I'd add one promoted newsletter blast (8.4K subscribers, 38% open, 6% CTR on average — so 192 clicks if AcreOS lands their CTA right) at $2,200.

**What I sell that no one else can sell:** 220 episodes of context. When I say "this is the first CRM I've recommended on the show in 14 months" my audience treats that as a credentialed claim. **That credential dies the day I recommend a bad tool.** Which is why gate 1, gate 2, gate 3 are not negotiable.

**Term I'd offer Thomas:** $14K for the four-episode flight (a $4K friend's discount because he's a real builder and I want this product to exist), 50% upfront, second 50% after episode two airs, with a clause that I can return the back half if listener feedback in the first two weeks turns negative. **No CRM I've sponsored has ever asked about that clause. Most balk.** The ones who agree end up being the long-term sponsors.

---

## 7. What I'd want from Thomas before saying yes

1. **A 60-second screen recording of `/data-export` exporting a full account.** Sent to me, unlisted YouTube link. I'll show my producer.
2. **One paying-customer reference at Operator tier, 90+ days in, willing to do a 20-min phone call.** Ideally a profile that maps to Cyrus or Wendell from the audit.
3. **A signed letter (literally signed, scanned PDF) committing to: data export remains free forever, no rug-pull on existing customer pricing for 24 months from sponsorship date, support response under 24 hours business-days.** This becomes a slide in my mid-roll. *"Here's the founder's written promise."* That's a moat.
4. **The Pax-vs-internal-cast story written down in three paragraphs.** Sent to me by email so I can pre-read before recording. I'll know if Thomas can land the act-2 monologue.
5. **A host-specific URL with promo code, click tracking, conversion attribution back to me.** Not optional. If I can't measure, I can't renew.
6. **An honest list of what's broken or missing.** Not marketing-speak. The Wendell/Cyrus/Penelope gaps, named, with rough timelines. **If Thomas hands me his own audit unflinchingly, that's the moment I sign.**

---

## 8. Risks I'm tracking

1. **Sponsoring before RBAC ships.** Penelope's note says team buyers churn fast without seat permissions. If 20% of my recommendation flow is team-buyers and they bounce in week three, I get the angry DMs. **I'd time the sponsorship for after RBAC lands** or carve team-buyers explicitly out of my recommendation language.
2. **Sponsoring before the bulk story tightens.** Cyrus's audit lists 20 friction points for the volume operator. If I send my heavy-volume listeners (probably 8% of my list, so ~960 people) at AcreOS today, they'll bounce by Friday. **I'd pre-segment my mid-roll** — language that pushes 20–80 deals/yr listeners and explicitly waves off 200+ deals/yr listeners until v2.
3. **The note ledger.** If even *one* of my listeners carries seller-financed paper and AcreOS's amortization is off by pennies, that's a viral negative tweet. Wendell's note flagged this is unfinished. **I'd hold the sponsorship until that ledger has a passing audit from a CPA.** This is a hard line.
4. **Founder burnout.** Thomas is solo-technical-founder by every signal in the audit. **Six months into a $14K sponsorship contract he can't be MIA.** I'd want to know he has at least one engineer hired or co-founder on board within 60 days of the sponsorship signing. This is a sponsor-protection clause more than a personal one.
5. **Confused positioning.** The MEMORY.md notes "Land Investors framing — v6 positioning; use 'Land Investors,' not 'real estate professional.'" That's the right call. **What I'd push Thomas on:** the landing page and ad copy must use "Land Investors" exclusively. If a single "real estate professional" leaks in, my audience smells the pivot and disengages. I'd review the landing copy myself before the first episode airs.

---

## 9. The headline takeaway

**Guest episode: yes, schedule next month, the story arc is the strongest in my niche this year.**
**Sponsorship: yes, in 90–120 days, after the three gates clear and I've taped the customer reference call.**
**Audience recommendation: yes for my core 20–80-deals/yr operators, no for course buyers, no for 200+/yr volume operators until v2.**
**Competitive narrative: workshop vs tablecloth. Identity shift, not feature war. That sells.**

Thomas, when you read this — the thing that makes me lean in is not the surface count or the persona architecture or the BYOK story. It's that you wrote a `FounderNote.tsx` with your face on it, signed your name, and shipped that on the landing page. **Founders who put their face on the front door tend to take customer pain personally.** That's the only filter that survives the next four years.

I'm in. After the gates clear.

— Geoffrey
