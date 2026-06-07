# Maren — CPO elevation brief (2026-06-07)

> Lens: product coherence + depth. The end-to-end land-deal lifecycle across the five
> doors; persona/vertical tailoring depth; deepen vs. cut; the activation → habit →
> retention arc; what makes AcreOS *indispensable* rather than merely complete.

Framing note. My job is not to count features — we have plenty (~180 page files in
`client/src/pages/`). My job is to make a coherent, opinionated *product* out of them.
Right now AcreOS is a remarkably capable toolbox with a beautifully honest data layer
and a clean five-door shell. What it is not yet is a **system of record for the
land-investor's deal lifecycle** — the thing that, once you put a deal in, you cannot
afford to leave. Everything below is in service of that one transition.

Every item is framed the way I work: **hypothesis → smallest test → expected signal →
success threshold → kill criterion.** If I can't frame it that way, it isn't ready.

---

## The single biggest product-coherence gap (the thing that would embarrass us)

**The lifecycle breaks at the seam between a closed deal and a serviced note.**

A seller-finance land business is, fundamentally, one loop:
`parcel → owner → offer → contract → close → **carry the note** → collect → payoff`.

We have built both ends superbly and left the middle disconnected:

- The Deals door (`client/src/components/deal-detail-content.tsx`, 908 lines) takes a
  deal through stages `offer_sent → … → closed`, generates document packages
  (`/api/document-packages/deal/:id`), runs a checklist and analysis tab. Good.
- The Finance door has a full servicing book — `notes` with `amortizationSchedule`,
  `interestRate`, `downPayment`, dunning stages, 1099-INT readiness
  (`shared/schema.ts:1365-1417`, `client/src/pages/notes.tsx`,
  `/notes/tax-readiness`). Also good.
- **But there is no bridge.** `grep` for `convertDeal` / `deal → note` / `fromDeal`
  returns nothing. `createNoteSchema` (`server/routes-notes.ts:55`) is a manual,
  blank-form create. When a Land Investor closes a seller-financed sale in the Deals
  door, they then re-key the buyer, price, down payment, rate, and term into a brand-new
  note in the Finance door. The two halves of their business don't know about each
  other.

This is the defect a sharp first customer notices in week one — *"I just closed this
deal here, why am I typing it all again over there?"* — and it's also the exact moment
the product could become un-leaveable. The deal IS the note's origination record. They
should be one continuous object.

Fixing this seam is my #1 and my boldest bet, below.

---

## Top ideas (most important first)

### 1. The Deal→Note lifecycle bridge ("Close & Carry")  · develop · both · L
**Hypothesis:** if closing a seller-financed deal one-click-originates the serviced note
(buyer, sale price, down, rate, term, amortization, first-payment date pre-filled from
the deal), retention at day-90 rises materially vs. orgs that re-key, because their
entire active book now lives in AcreOS and leaving means abandoning their ledger.
**What "great" looks like:** the deal-detail "closed" state shows a "Carry this note"
action; one confirm screen (editable) writes the `notes` row + `amortizationSchedule`,
links `deal.id ↔ note.id`, copies the document package as the note's origination
folder, and drops the buyer into the borrower portal flow. The reverse view: a note
shows its origination deal. No re-keying, ever.
**Smallest test first:** before the full build, instrument it as a fake-door — add the
"Carry this note" button on closed deals that opens the *existing* blank note form with
fields pre-populated via querystring. Measure click-through and completion.
**Expected signal / threshold:** >60% of closed seller-finance deals get carried into a
note within 7 days. **Kill criterion:** <25% after 60 days → the two halves are used by
different customers and the bridge is a vanity feature; keep them separate.
**First step:** add `originatingDealId` to the notes schema (`shared/schema.ts` near
1365) and a `POST /api/notes/from-deal/:dealId` that maps the fields; surface the button
in `deal-detail-content.tsx` closed branch.

### 2. Make `/today` the daily habit, not a digest  · elevate · customer · M
**Hypothesis:** the Decision Queue (`server/routes-today.ts:200-337`,
`client/src/components/today/DecisionQueue.tsx`) is currently *informational* — it
surfaces stale leads, expiring offers, Pax observations — but most items route the user
*away* ("Follow up" → `/leads`, "View deal" → `/deals`). A queue you can't *clear in
place* is a notification list, not a habit loop. If the operator can act on a queue item
without leaving Today (log the call, snooze 3 days, dismiss, "Pax, draft the follow-up"),
daily-active usage compounds.
**What "great" looks like:** every queue item has an inline primary action that resolves
it on the spot and shrinks the queue to zero — the Superhuman / Linear "inbox zero" dopamine.
The reward state ("You're clear for today") is the thing they come back for.
**Smallest test first:** add inline "Done / Snooze 3d / Dismiss" to the *stale-lead* item
type only; measure whether queue-clears-per-session rises and whether DAU follows.
**Threshold:** median queue items resolved-in-place per session ≥ 3; **kill:** if users
keep clicking through to the deep page anyway (<10% inline resolution), the deep pages
are where the work belongs — revert.
**First step:** add an `inlineAction` discriminated union to the `DecisionItem` type and
a `PATCH /api/today/queue/:id` resolver; the rank/sort substrate already exists.

### 3. Persona depth: a real *vertical home screen*, not vocabulary swaps  · improve · customer · M
**Hypothesis:** today persona = vocabulary substitution (`personaVocabulary.ts`, 232
lines, "Lead" → "Note opportunity") + a `businessTypeOnly` nav module. That's the *label*
of tailoring, not the *substance*. Brigid's quote in the nav comments nails it:
*"a persona-driven nav that hides what I don't need would do more for my onboarding than
any AI feature."* The Today door is still the generic land-investor briefing for every
persona. A tax-lien operator's Today should lead with the **redemption clock**; a
landlord's with **rent due / late**; a note investor's with **payments due + delinquency**.
**What "great" looks like:** `/today` reads `businessType` and swaps its lead widget set,
not just its words. The vertical's most fiduciary obligation is the first thing they see.
**Smallest test first:** ship the tax-lien Today variant only (we already have
`/redemption-clock`); measure 7-day retention of tax-lien orgs vs. the generic baseline.
**Threshold:** vertical-Today cohort week-2 retention > generic baseline by a clear
margin. **Kill:** no difference → vocabulary was enough, stop building variants.
**First step:** a `TodayLayout` registry keyed by `businessType` that composes existing
widgets (`ParcelAlerts`, `CashStrip`, plus a `RedemptionClockStrip`).

### 4. Decide the persona surface area — *cut* the long tail before customers see it  · improve · both · M
**Hypothesis:** we have verticals at very different maturity (note/land are deep;
tax-lien/wholesaler/landlord/flip/subdivider exist with 3-5 child surfaces each;
`businessType` enum in `schema.ts:105` lists 14 types but nav only gates 5). Offering a
persona we can't make *excellent* is worse than not offering it — it sets an expectation
we fail. Pre-first-customer is exactly when to make the cut honestly.
**What "great" looks like:** a documented tier — **Flagship** (land + note seller-finance,
the founder's actual domain), **Supported** (1-2 verticals we'll stand behind),
**Hidden** (everything else, code retained, persona not selectable at signup until it
clears a depth bar). Onboarding only offers what we can be best-in-class at.
**Smallest test first:** this is a decision, not a build — audit each vertical's surface
count vs. "would I demo this to a paying customer in that vertical?" and write the tier.
**Threshold:** signup persona-picker offers ≤ 3 verticals at launch. **Kill:** n/a —
this is a prioritization call, and the kill is "we kept everything and diluted."
**First step:** an honest depth audit table per `businessType`; gate the signup persona
list to the Flagship + Supported set; the `businessTypeOnly` machinery already hides nav.

### 5. The Land Snapshot → action loop (close the "so what?")  · elevate · customer · M
**Hypothesis:** the Land Snapshot (`client/src/components/parcels/land-snapshot.tsx`,
`/api/properties/.../land-profile`, `services/landProfile.ts`) is our distinctive,
honest, decision-grade artifact — provenance chips, gaps, confidence. But a *snapshot*
is a noun. The product wins when the snapshot ends in a **verb**: from this parcel, in
one tap, "Make a blind offer" / "Add as lead" / "Run the seller-finance numbers." Right
now the aha (the data) and the action (the deal) are adjacent but not stitched.
**What "great" looks like:** the Snapshot's confidence-weighted fields *feed* the blind-
offer wizard (`blind-offer-wizard.tsx`) — assessed value, acreage, comps pre-load — so
the highest-friction step (data entry) is gone and the operator goes parcel → offer in
under a minute.
**Smallest test first:** wire one button ("Make an offer with these numbers") from the
Snapshot to the blind-offer wizard with fields pre-filled. Measure parcel-to-offer conversion.
**Threshold:** >15% of Snapshot views that have a confident value produce a started
offer. **Kill:** <5% → the snapshot is a reference artifact, not an action launcher.
**First step:** pass `LandProfileFields` as initial state into the blind-offer wizard route.

### 6. A coherent activation arc tied to the *aha*, not a generic checklist  · improve · both · S
**Hypothesis:** the getting-started checklist (`getting-started-checklist.tsx`) is
correct-but-generic ("Look up your first property → Add a lead → Send a mailer → Track a
deal"). The real aha for THIS product is the honest-data moment: *"I looked up a parcel I
already own and AcreOS told me something true I didn't have to verify."* Activation
should be measured against that single event, and the checklist should drive to it first.
**What "great" looks like:** activation = "ran a Land Snapshot on a real parcel and saw
provenance" as step 1 and the headline metric; everything else is secondary. The
`/founder/activation` funnel (`server/services/activation.ts`) measures *to that event*.
**Smallest test first:** add a single `activation_event` `first_land_snapshot_viewed` and
make it the checklist's first, visually-primary step. Track signup→that-event time.
**Threshold:** median signup → first-Snapshot < 90s (the charter's own bar).
**Kill:** n/a — instrumentation, always keep.
**First step:** emit the event from the land-profile route; reorder the checklist.

### 7. Finance door coherence: one "Book" view that *is* the business  · elevate · customer · M
**Hypothesis:** the Finance door (`finance.tsx`, 2119 lines, plus portfolio / cash-flow /
capital-markets / analytics overflow) is broad but fragmented across tabs and overflow
routes. The land-note investor has one question every morning: *"what's my book worth,
what's coming in this month, and who's behind?"* That should be one screen, the way Today
is one screen — not five overflow links.
**What "great" looks like:** Finance's default view answers worth / inflow / delinquency
at a glance, with the existing deep surfaces (portfolio, cash-flow, capital-markets) as
drill-downs behind it — mirroring the Today-door consolidation discipline.
**Smallest test first:** a single "Book" summary header on `/money` composed from existing
queries; measure whether overflow-route visits *drop* (good — the summary answered it).
**Threshold:** the Book header satisfies the morning question for >50% of sessions
(overflow click-through falls). **Kill:** overflow usage unchanged → the detail is the value.
**First step:** a `BookSummary` component over existing finance hooks; place atop `/money`.

---

## Boldest elevation bet

**"Close & Carry" — make AcreOS the system of record for the seller-finance lifecycle by
welding the Deals door and the Finance door into one continuous object (idea #1).**

This is the bet because it's the one feature that converts AcreOS from *a set of good
tools a land investor visits* into *the ledger a land investor cannot leave*. The deal is
the note's origination; the note is the deal's afterlife. Once a customer's live book of
carried notes lives here — with the origination documents, the amortization, the dunning
state, the 1099-INT readiness all stitched to the deal that created them — switching cost
becomes structural, not emotional. Retention stops being a UX problem and becomes a
data-gravity fact. Every other idea in this brief makes the product *better*; this one
makes it *indispensable*, and it's buildable from substrate we already have on both ends.

---

## Small, high-ROI polish refinements

- **`deal.id ↔ note.id` linkage display** even before the full bridge: if a note was
  manually created for a parcel that also has a deal, show a "related deal" link. Cheap
  coherence win.
- **Snapshot empty/gap copy:** ensure `land-snapshot.tsx` gap reasons read as *next
  actions* ("Request county coverage") not just states ("unavailable").
- **Decision Queue "all clear" state:** Today should have a designed, rewarding zero-state
  ("Nothing needs you right now") — not an empty list. The habit-loop reward.
- **Persona vocabulary coverage audit:** `personaVocabulary.ts` covers entities but spot-
  check the high-traffic pages for un-substituted hardcoded "Lead/Property/Deal" strings
  that leak the generic vocabulary to a note/tax-lien operator.
- **Checklist persona accuracy:** the note-investor checklist points "Record your first
  payment" → `/finance` but "Track a note buy or sell" → `/deals`; verify those land on
  the *right tab*, not the door root, so the aha isn't one extra click away.
- **`businessType` enum vs. nav gap:** 14 enum values, 5 gated nav modules. Either gate
  signup to the 5 we serve or document the 9 as roadmap — don't let signup offer a
  persona that gets the generic experience.
- **Deal stage vocabulary per persona:** `DEAL_STAGES` in `deal-detail-content.tsx` say
  "Offer Sent / Closed" — a wholesaler "assigns," a note investor "acquires." Run stage
  labels through `useTerm` like the rest of the surface.

---

## The one thing that would most embarrass us

A first customer who runs a seller-finance land business closes a deal in the **Deals**
door, then walks to the **Finance** door to start carrying the note — and has to type the
buyer, price, down payment, rate, and term *all over again*, because the two doors that
together describe their entire business have no idea the other exists. For a product whose
whole pitch is "the honest, coherent home for the land-note lifecycle," that re-keying
seam is the tell that we built features, not a product. (See top idea #1 / the boldest bet.)
