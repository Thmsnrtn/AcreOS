# Founder decisions — 2026-07-28

Recorded verbatim from the founder's answers (decision picker, this date).
These are the rulings for the four decision cards seeded in `/founder/decisions`
(`railSunsetDecisionCards.ts`, `evaluationHorizonCards.ts`). The in-app cards
remain until tapped or reconciled; **this file is the authoritative record**.
Only the founder can rescind a ruling, explicitly.

## 1. Rail sunset order — ALL FOUR RAILS AT ONCE

Ruling: bring-your-own is the standard for all four rails (property data,
letter mail, email, SMS) from day one, rather than a phased migration.

Founder's reasoning (paraphrased from their own words): with **zero customers
signed up yet**, there is nobody to migrate gently — phasing existed to soften
friction for existing users. Launching directly into the BYO model is the
simpler, cleaner story. (Confirmed sound on review: this is not a cutover, it
is launching with the right model. SMS additionally requires A2P carrier
registration before it can send at all, so it is BYO-by-necessity regardless.)

## 2. Free-taste allowance shape — MONTHLY INCLUDED ALLOWANCE

Ruling: every plan includes a monthly allowance of platform sends/lookups per
rail; past it (or on higher tiers) the customer connects their own account.
Mirrors the proven AI-key threshold model. The exact per-rail numbers remain
the founder's to set in the cost panel — no number is decided here.

## 3. Mail-program evaluation horizon — BOTH, WHICHEVER FIRST

Ruling: the mail program is judged at **6 months of sending OR when total
mail+data spend crosses a dollar line the founder will set — whichever comes
first**. Pre-committed now, while calm, so that normal early variance (few or
zero converted customers early is normal for cold acquisition) is never
adjudicated emotionally mid-drawdown. Until that horizon, drawdown alone is
not grounds to revoke autonomy; at the horizon, the program is judged on the
pre-agreed frame.

Vocabulary clarification (founder, this date): there is exactly ONE founder —
the platform owner running AcreOS as a business. Customers run their own land
operations inside the product and are never "founders" in this vocabulary.
The "mail program" here is AcreOS's own customer-acquisition + free-taste
spend, never customers' land deals.

## 4. Outreach stop-loss shape — MONTHLY SPEND LINE PAUSES

Ruling: a **monthly** mail+data spend line (dollar amount to be set by the
founder in the cost panel); crossing it pauses outreach until the founder
looks. Resets monthly so a bad month can never compound silently.

Implementation status: the pause is now wired (same-date follow-up PR, the
one carrying this edit) — a monthly mail+data spend line gates the mail
flusher and the direct-mail send paths; crossing it pauses outreach (skip,
never drop) and pages the founder once per pause event. The line defaults to
the founder's $500/month ruling (#5) and is founder-adjustable in the cost
panel; the machine never picks the number (money hard-stop).

---

# Addendum — second picker round, same date

## 5. Outreach stop-loss dollar line — $500/MONTH TO START

Ruling: the monthly mail+data spend line starts at **$500/month**, coherent
with the constitutional $500 autonomous-spend scale. Raisable by the founder
anytime from the cost panel. The pause wiring ships as a reviewed PR.

## 6. Free-taste allowance sizing — MARGIN-TIED RULE

Ruling: each plan's monthly included allowance is derived, not hand-set:
whatever quantity of platform sends/lookups costs the platform **≤ ~20% of
that plan's monthly price**, computed from live provider prices. Margin-safe
by construction; auto-adjusts with any future price change. Implementation
derives counts mechanically; no number is ever hand-invented.

## 7. Letter cadence — QUIET-DAY MODE NOW

Ruling: on green mornings (nothing needs the founder, vitals fine) The Letter
renders three lines — needed-line · money line · step-away line — with the
full letter one tap away. Weekly cadence remains a FUTURE decision, gated on
measured unattended runway existing first.

## 8. External watchdog + break-glass — SCAFFOLD NOW, FOUNDER PROVISIONS LATER

Ruling: build the break-glass card content ("if AcreOS is dark" one-pager),
a Controls section with exact copy-paste steps for the two GitHub secrets
that arm the dormant external watchdogs, and a quarterly email-the-card job.
The founder provisions the secrets when ready. NOTHING is presented as armed
until it actually is (no-fabrication).

Implementation status: rulings 5–8 shipped as one same-date implementation
PR (the one carrying this edit): stop-loss pause wiring at $500/month
default (5), margin-tied allowance engine deriving counts from live provider
unit costs (6), quiet-day Letter mode (7), and the break-glass card +
dormant-watchdog Controls section + email-the-card route (8) — the watchdog
secrets remain unprovisioned and NOTHING is shown as armed until they are.

---

# Addendum — open-data intelligence program, same date

## 9. Open-data intelligence program — ALL FOUR MOVES, IN SEQUENCE

Ruling: pursue the full reasoning-fabric program in order: (1) Truth Loop
(close every ingested-but-unread circuit: LCS real inputs, county momentum
consumers, real 3DEP slope, dead-endpoint fixes), (2) Corroboration Engine
(cross-source triangulation; contradictions surfaced as findings, never
smoothed), (3) Temporal Spine (snapshots + diffs — open data as events),
(4) Self-Healing Data Plane (canary→auto-discovery→decision-card repair,
then coverage expansion). Shipped as reviewed PRs, wave by wave.

## 10. Data expansion — WEAVE INTO THE WAVES

Ruling: drastically expand open-source coverage (toward 50+ independent
instruments) but sequenced INSIDE the intelligence waves rather than as a
separate sprint: Tier-1 new per-parcel signals (wildfire WHP, FCC broadband,
SSURGO septic suitability, EPA ECHO/UST/radon depth, mining claims, TX/OK
wells, rail) ride with Wave 2; bulk public-domain corpora ownership (NAIP,
3DEP 1m terrain, statewide parcel bulk, annual NLCD, PLSS, TIGER, NAD,
Overture — ~$10–30/mo storage) rides with Wave 3; the county/state GIS
discovery engine (systematic discover→verify→license-review→seed toward
3,000+ counties) rides with Wave 4. Confirmed-unusable sources (HUD USPS
vacancy, First Street, GreatSchools, U-Haul, PHMSA bulk, ND wells, OSM tile
hotlinking, Stadia free tier) stay excluded; license-verified or it doesn't
ship.

---

# Addendum — vertical completeness program, same date

## 11. VERTICALS: BUILD ALL FULLY AND ACTIVATE ALL

Ruling: every vertical already registered in the architecture (live, beta,
waitlisted, or frozen — the set the landing page promises) is to be built
to genuine completeness — per-persona onboarding, door content, domain
models, services, vocabulary, intelligence, tests — AND activated: the
founder EXPLICITLY RESCINDS the frozen vertical-pack checkout and the
one-at-a-time conveyor activation gate. All verticals open for
signup/purchase once their build passes the same honesty bar as the land
wedge (no stub presented as live, refuse-not-fabricate everywhere).

What this ruling does NOT change: "no NEW persona verticals" stays (this
completes the registered set only); the five customer doors and four
founder doors stay; vertical content lives behind existing doors; the
marketplace (~25 customers) and public API (~50) ladder stays; all four
hard-stops stay. Implementation ships as reviewed PRs, wave by wave, and
any vertical that cannot honestly reach the bar ships gated with its gap
stated rather than activated on hope.

Implementation status (2026-07-29): waves V1 + V2 shipped as reviewed PRs.
**V1 (PR #250, `f2704d17`)** — taxonomy truth pass (`shared/business-types.ts`:
buy_and_hold roadmap → beta on cited build evidence; creative_finance
honestly demoted beta → roadmap pending a real surface; dangling
workflow-template ids replaced with real `tpl_*` ids verified in
`workflow-engine.ts`); Pax persona completeness (all 9 personas resolve to
their own voice, incl. new note_servicer / note_originator / subdivider
contexts); pack-commerce surface (`GET /api/billing/packs` + the pricing
page's Vertical Packs section); landing tiers derived from the registry
(Beta badges, waitlist chips); landlord-family reachability (the Rentals
module now serves buy_and_hold + short_term_rental + multifamily +
mobile_home). **V2 (PR #251, `c1368eff`)** — beta-four completion:
certificates-book Finance hero (tax_lien_deed) + lot-economics hero
(subdivider); SubdividerStrip + truthful landlord map-strip labels; widget
fabrication purge (all `*_MOCK` constants deleted + `noMockWidgets`
ratchet); creative_finance's first real surface (sidebar module, Today
cluster, Close & Carry deal → note bridge) and promotion roadmap → beta;
wholesaling Pax voice to production (`productionReady: true`). **V3**
(record/doc alignment — the wave carrying this edit) and **V4** are in
flight. fix_and_flip remains roadmap-gated with its gap stated (2026-07-11
residential-comps decision) — the ruling's gated-with-gap-stated path, not
a freeze.
