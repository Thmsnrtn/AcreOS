# Yuna Park — Activation Audit, AcreOS

**Lens:** ex-Notion onboarding lead. The first 5 minutes determine 80% of churn. A new Land Investor should reach a "you've now done X" milestone every 60–90 seconds for the first ten minutes, and hit "I can't go back to Excel" inside hour one.

I read the full activation spine: `client/src/pages/landing.tsx`, `client/src/pages/onboarding-v2.tsx`, `client/src/pages/today.tsx`, the two competing checklists (`client/src/components/onboarding-checklist.tsx`, `client/src/components/getting-started-checklist.tsx`), and `client/src/components/onboarding/ProductTour.tsx`. Below is a Notion-style breakdown.

---

## 1. Activation arc map — what AcreOS asks of a new Land Investor today

Current path, in order:

1. **Marketing landing** (`client/src/pages/landing.tsx:39`) — Hero/HowItWorks/Agents/DayInLife/Features/Quotes/FounderNote/Pricing/FAQ/FinalCTA. Eleven sections of letter-tone copy. Strong but doesn't preview the product moment.
2. **Pricing decision** (`client/src/pages/pricing.tsx:13-50`) — four tiers (Free / Starter $20 / Pro $49 / Scale $79). The CTA "Start 14-day free trial" implies a card on file. Friction.
3. **Auth** — Clerk-proxied sign-in.
4. **Onboarding-v2 path picker** (`onboarding-v2.tsx:1064-1147`) — beginner / active / enterprise. Three radically different flows. Copy is good ("No credit card required to start").
5. **Setup wizard** — 6 steps per path (`STEPS_BY_PATH`, `onboarding-v2.tsx:65-90`). Beginner: path → target_county → instant_hunt → strategy → pax_tour → complete. Active: path → portfolio_import → target_counties → instant_hunt → automation → complete. Enterprise: path → team → integrations → instant_hunt → workflows → complete.
6. **`/dashboard` (which redirects to `/today`)** — `client/src/pages/today.tsx:191`. Onboarding banner (`today.tsx:492-522`), zero-data hero (`today.tsx:607-636`), `GettingStartedChecklist` (5-item, server-backed), then 8+ dense sections.
7. **Two checklists run in parallel**:
   - `GettingStartedChecklist` — 5 items, org-scoped, dismissed via org settings (`getting-started-checklist.tsx:29-65`).
   - `OnboardingChecklist` — **7 items**, localStorage-backed, dismissable per browser (`onboarding-checklist.tsx:24-75`). Not currently mounted on /today, but exists and conflicts.
8. **`ProductTour`** — 6-step overlay (`ProductTour.tsx:37-90`), auto-starts on first login, separate from onboarding-v2.

**Verdict:** AcreOS has *three competing first-run systems*: setup wizard (onboarding-v2), product tour (overlay), and checklist (two variants). The brief's §14 "walk-into-a-workspace feel, not a tour overlay" is half-implemented — the wizard exists but the tour overlay also fires, and neither one ends with the user in a workspace populated with their own data.

---

## 2. Time-to-first-value

**Current minutes (estimated, beginner path):**

| Phase | Action | Time |
|-------|--------|------|
| 0:00 | Land on marketing site | — |
| 1:30 | Click "Start free trial," reach pricing | +1:30 |
| 2:30 | Pick a tier, hit auth | +1:00 |
| 4:00 | Complete Clerk sign-up + verify email | +1:30 |
| 4:30 | Path picker | +0:30 |
| 5:00 | "Pax is ready" filler card (`onboarding-v2.tsx:1196-1216`) | +0:30 |
| 6:30 | Type a target state + county manually (no autocomplete) | +1:30 |
| 7:30 | **InstantDealHunt scan** — first real value, but scoped to one county and three placeholder cards (`onboarding-v2.tsx:111-282`) | +1:00 |
| 9:00 | Pick strategy from 14-card grid (`onboarding-v2.tsx:1278-1316`) | +1:30 |
| 9:30 | Pax tour filler | +0:30 |
| 10:30 | Complete screen with stats theatre (`onboarding-v2.tsx:1382-1474`) | +1:00 |
| 11:00 | `/today` — empty pulse, empty alerts, empty Pax noticed, empty AI queue | +0:30 |

**Real first-value moment today:** ~minute 7:30 — the `InstantDealHunt` opportunity cards. *That is the only "you couldn't do this in Excel" moment in the entire flow.* And it's a passive read, not an action they took.

**Target minutes (Notion-grade):**

| Phase | Action | Target |
|-------|--------|--------|
| 0:00 | Sign up (no pricing wall — push pricing to day 7) | 0:00 |
| 0:45 | One question: "Where do you want to invest?" (autocomplete county+state) | 0:45 |
| 1:30 | **Aha #1**: Live deal scan begins streaming (`InstantDealHunt`) — first opportunity card animates in at 1:45 | 1:30 |
| 2:30 | **Aha #2**: User clicks one card → opens *real* `/leads/:id` detail with enriched parcel data, comps, motivation breakdown — *they now own a lead they can act on* | 2:30 |
| 4:00 | **Aha #3**: One-click "Generate offer letter" — Pax drafts a letter using their actual data; user can copy/paste or send | 4:00 |
| 6:00 | Land in `/today` with that lead pinned in "Start here today" + checklist showing 1/3 complete | 6:00 |

**Goal: aha at minute 1:30, owned artifact at 2:30, generated artifact at 4:00.**

---

## 3. Empty-state opportunity inventory — pages that punish vs invite

Surveyed `/today` and counted empty-state quality:

| Surface | File:line | Empty-state quality |
|---------|-----------|---------------------|
| `/today` zero-data hero | `today.tsx:607-636` | **Good.** "Ready to find your first deal?" with two CTAs. |
| `/today` Business Pulse | `today.tsx:738-812` | **Punishes.** Renders even when pipeline = $0, hot deals = 0, win prob = "—". An all-zero pulse card is demoralizing to a brand-new user. Currently *is* hidden by `isNewUserMode` (`today.tsx:213-217`) — this is the right pattern, extend it. |
| `/today` "Start here today" priorities | `today.tsx:837-868` | **Acceptable** — falls back to "Nothing pressing today" with a check. But a new user has nothing pressing because they have nothing. Replace empty state with onboarding tasks. |
| `/today` Pax suggests | `today.tsx:1122-1128` | **Punishes.** "No proactive suggestions right now. Pax is monitoring your pipeline." A new user has no pipeline — Pax should suggest *exploration tasks*, not stay silent. |
| `/today` AI action queue | `today.tsx:1225-1231` | **Punishes.** "You're all caught up!" reads sarcastic when you've never done anything. |
| `/today` Cash position | `today.tsx:1257-1334` | **Hidden when no notes** (correct). |
| `/leads` (inferred) | — | Empty list with "Import" / "Add" — likely OK but should celebrate the first add. |
| `/properties`, `/deals`, `/finance`, `/campaigns` | — | All cited in checklist hrefs but I did not verify their empty states. Audit needed. |

**Pattern fix:** every empty surface should either (a) hide entirely in new-user mode (Eleanor's `isNewUserMode` is the right kernel — extend it), or (b) become an onboarding affordance ("Pax suggests" while empty = "Try asking me to find tax-delinquent parcels in your county").

---

## 4. First-day milestones — five concrete events that should fire

Right now, *zero* activation events are tracked from onboarding. `client/src/lib/telemetry.ts` exposes `trackEvent` but neither `onboarding-v2.tsx` nor `today.tsx` nor the checklists call it. We are flying blind.

The five milestones that should fire in day one, with what each unlocks:

| # | Event | Trigger | Unlocks (in product) | Unlocks (mentally) |
|---|-------|---------|----------------------|--------------------|
| 1 | `activation.county_picked` | County selected in onboarding (`onboarding-v2.tsx:1258`) | Live `InstantDealHunt` scan | "AcreOS knows my market" |
| 2 | `activation.first_lead_owned` | User clicks an opportunity card → it persists as their first `lead` row | Lead detail page with enrichment | "I have a real lead, not a demo" |
| 3 | `activation.first_artifact_generated` | Pax drafts an offer letter, comp report, or motivation analysis | Saved artifact in `/pax/history` + lead timeline entry | "AcreOS made me look smart in 30 seconds" |
| 4 | `activation.first_import_celebrated` | CSV import returns ≥1 lead, full-screen confetti moment with count + parcel-on-map preview | Dashboard now has data; Pulse switches on | "All my Excel work just moved" |
| 5 | `activation.first_deal_decision` | User accepts/rejects a Pax suggestion or Pax-Hunter opportunity | Decision queue populates, Today's Actions activates | "This is my workflow now" |

Wire these to an `activation_events` table; cohort dashboard already exists (`cohort-retention-dashboard.tsx`) but without these events it has nothing to plot for new-user activation.

---

## 5. Persona-adaptive onboarding

**The good news:** `onboarding-v2.tsx:1030-1041` now writes `users.persona` based on `businessType`, and `mapBusinessTypeToPersona` (lines 1047-1061) does the translation. `useTerm` from `@/hooks/use-persona` is already wired into `today.tsx:196` (`propertyLabelPlural`).

**The bad news:** the onboarding flow itself does **not** adapt after the persona is set. The strategy step (`onboarding-v2.tsx:1275-1345`) writes the persona, but every subsequent step uses generic land-investing copy. Specifically:

- `pax_tour` step (`onboarding-v2.tsx:1347-1380`) lists four bullets that are pure land-flipper framing ("Finds deals every night," "5-touch system," "Morning Briefing"). A `note_investor` should hear "Tracks every payment, alerts you on late notes." A `wholesaler` should hear "Auto-assigns contracts." A `landlord` should hear "Rent roll, vacancies, lease renewals."
- `complete` step (`onboarding-v2.tsx:1382-1474`) hardcodes "What to do first" links: `/leads`, `/campaigns`, `/ai`. For `note_investor` these should be `/finance`, `/notes`, `/pax`. For `landlord`: `/portfolio`, `/leases`.
- The `instant_hunt` step assumes tax-delinquency motivation signals — meaningless to a `landlord` or `fix_flipper`.

**What should branch by persona** (priority-ordered):

1. **The aha step itself.** Land investor → tax-delinquent scan. Note investor → upload existing note portfolio + show YTD payment chart. Wholesaler → motivated-seller list with assignment-fee calculator. Fix-flipper → ARV analysis on a sample. Each persona needs *its* "couldn't do this in Excel" moment.
2. **`pax_tour` capabilities** — pull from `personaVocabulary.ts` capability list per persona.
3. **`complete` "What to do first"** — three persona-specific hrefs, pulled from a `PERSONA_FIRST_MOVES` constant.
4. **`/today` empty-state hero** (`today.tsx:614-616`) — currently says "evaluating parcels and closing deals." For a note investor it should read "tracking payments and managing your note portfolio." Already has `useTerm` available.
5. **GettingStartedChecklist items** (`getting-started-checklist.tsx:29-65`) — `notePayment` is irrelevant to a wholesaler; `import` (CSV leads) is irrelevant to a landlord seeding from rent rolls.

**Persona-aware checklist** is the single highest-leverage day-one fix.

---

## 6. Pax in onboarding — natural or forced?

**Where Pax meets the user today:**

- Path picker bottom card: "Pax is ready to help" with one paragraph (`onboarding-v2.tsx:1196-1216`). Static text, not a chat.
- `pax_tour` step: feature bullet list (`onboarding-v2.tsx:1347-1380`). Not a conversation.
- `/today` "Pax noticed" + "Pax suggests" sections (`today.tsx:991-1160`). Empty for new users.
- `/pax` route — full chat surface, not entered during onboarding.

**Verdict: forced.** Pax is *described* in onboarding but never *speaks*. The first time a new user actually interacts with Pax is after onboarding ends, and the empty-state Pax sections on /today read as "Pax is monitoring." That's a missed introduction.

**Fix — Pax says hello inside onboarding, once:**

- After the `instant_hunt` step, inject a one-message Pax bubble: *"I scanned 1,847 parcels in Hudspeth County and surfaced these three. Want me to draft an offer letter for the top one?"* — yes/no. If yes, generate, drop in their lead timeline. That's a first-touch artifact (milestone #3) inside onboarding, in under 90 seconds.
- Persona-flexed: a note investor's first Pax moment should be *"Upload your note CSV and I'll calculate yield-to-maturity for each one and flag the at-risk borrowers."*

**Memory rule respected:** customers see "Pax" only — never Atlas/Sophie/Forge in the customer-side. Already correct in `onboarding-checklist.tsx:53-62` and `ProductTour.tsx:72-81` (recently fixed).

---

## 7. The "first 5 minutes / first day / first week" arc

Notion designs these three windows deliberately. AcreOS hasn't.

### First 5 minutes (signup → aha)
- Single question: target county.
- Live scan animates in.
- One opportunity becomes their first lead with one click.
- Pax drafts an offer letter.
- **Milestone copy at 5:00:** "You just did in 5 minutes what most investors do in a week. Welcome aboard."

### First day (aha → workflow)
- Email at +1 hour: "Your overnight scan starts at 11pm — here's what to expect."
- In-app: getting-started checklist shows 3 immediate items (not 5, not 7), persona-flexed.
- Mid-day prompt: "Want to import your existing leads/notes? Here's the format." → drag-drop → celebration.
- End of day: `/today` populated with their first scan results + a Pax recap.

### First week (workflow → habit)
- Day 2: morning briefing email at 7am with overnight finds (already designed in copy at `onboarding-v2.tsx:1471-1473` — verify it actually fires).
- Day 3: "Try the offer-letter generator" prompt with a real lead from their list.
- Day 5: cohort milestone — "You've reviewed 12 opportunities. Here's how that compares to top operators."
- Day 7: pricing/upgrade prompt (this is when paywall lands, *not* at signup).
- Day 7: re-engagement email if `last_visit > 3d` — already partially designed via `WELCOME_BACK_THRESHOLD_DAYS` (`today.tsx:189`).

---

## 8. Activation metrics gap

What's tracked: `client/src/lib/telemetry.ts` exposes `pageView`, `featureUsed`, `actionCompleted`, `aiUsed`, `error`, `sessionStart`. Generic.

What's **not** tracked, and should be:

| Event | Where to fire |
|-------|---------------|
| `signup_started` | Clerk callback in App shell |
| `onboarding_path_picked` | `onboarding-v2.tsx:1116` |
| `onboarding_county_picked` | `onboarding-v2.tsx:1258` |
| `onboarding_scan_completed` (with opportunity count) | `InstantDealHunt` success — `onboarding-v2.tsx:130` |
| `onboarding_strategy_picked` | `onboarding-v2.tsx:1323` |
| `onboarding_completed` | `completeMutation.onSuccess` (`onboarding-v2.tsx:1012`) |
| `first_lead_created` | server-side on first `leads` insert per org |
| `first_lead_owned_from_scan` | when a scan card is converted to a lead |
| `first_pax_message_sent` | `/pax` first message per user |
| `first_artifact_generated` | offer letter / comp report / motivation summary first generation |
| `first_import_completed` (with row count) | `/api/import/leads` success |
| `first_decision_made` | first accept/reject in decision queue |
| `checklist_item_completed` (per item id) | both checklists |
| `checklist_dismissed` | both checklists |
| `tour_step_advanced`, `tour_completed`, `tour_skipped` | `ProductTour.tsx:298-321` |
| `dashboard_full_mode_unlocked` | `today.tsx:218-223` |
| `time_to_first_lead`, `time_to_first_artifact` | derived server-side |

Persist to a typed `activation_events` table; surface in `cohort-retention-dashboard.tsx`. Without these, "what % of signups reach aha?" is unknowable.

---

## 9. Empty-checklist anxiety — checklist count problem

We currently have **two checklists with overlapping but inconsistent items**:

- `OnboardingChecklist` (`onboarding-checklist.tsx`): **7 items** — profile, first_lead, first_campaign, first_property, explore_pax, setup_integrations, explore_avm. localStorage-backed. Notion's threshold is 3-5.
- `GettingStartedChecklist` (`getting-started-checklist.tsx`): **5 items** — lead, import, campaign, deal, notePayment. Org-settings-backed. Currently the one mounted on `/today:634`.

**Issues:**
- Two checklists is one too many. Pick `GettingStartedChecklist` (it's server-backed, persona-eligible, already used).
- 5 items including `notePayment` is wrong for the default `land_investor` persona (note payments aren't part of the canonical land-flipping motion).
- Both checklists list completed items at 50% opacity but still in the list, growing visual debt as the user makes progress. Notion collapses completed items to a single "✓ 3 complete" pill.
- Neither checklist celebrates completion of an item — no animation, no toast, no "you unlocked X."

**Recommended structure: 3 active items, persona-flexed, with a "+more" expand:**

For `land_investor` (default):
1. Pick a target county and run your first scan
2. Convert one opportunity to a lead
3. Generate your first Pax offer letter

After all 3 done, the next 3 unfold:
4. Import your existing list (CSV)
5. Set up the nightly Deal Hunter
6. Send your first mailer

That's the Notion arc — never show more than 3 incomplete items at once.

---

## 10. The "I get it" milestone — designed?

**Currently:** no. The closest thing is the `complete` step's stats theatre (`onboarding-v2.tsx:1382-1474`) — three big numbers (Counties: 1, Deals Found: 3+, Deal Machine: Active). It's a graphic, not an experience.

**The "I can't go back to Excel" moment is one of these three, and we should pick one and design it deliberately:**

- **Candidate A (recommended): the imported lead celebration.** User uploads a CSV of 247 leads from their spreadsheet. AcreOS streams: "Reading file… enriching parcels… scoring motivation… 247/247." Then a full-page moment: "Your portfolio is now in AcreOS. **89 of these 247 score 70+ on motivation.** You'd never have known that in Excel." With one click, "Show me the 89." That is the irreversible moment.
- **Candidate B: the offer-letter generation.** They watch Pax draft a personalized letter in 8 seconds with their lead's name, county, motivation reasoning, and an offer band. "I just did 30 minutes of work in 8 seconds."
- **Candidate C: the morning briefing the day after.** They wake up to an email: "Last night, AcreOS scanned 41,832 parcels in your three counties and found 7 new opportunities scoring 75+. Top one is ready for you." If they open it and click through, they're in.

Candidate A is the most reproducible (most users have a spreadsheet to upload) and the most measurable. Pick it. Design it. Make it the apex of week one.

---

## Pre-launch activation sprint — 8 items, 2 weeks

| # | Item | File(s) | Effort |
|---|------|---------|--------|
| 1 | Wire `lib/telemetry.ts` events through onboarding-v2 + checklists + ProductTour. Define `activation_events` table + emit from server. | `onboarding-v2.tsx`, `today.tsx`, both checklists, `ProductTour.tsx`, new server route | M (3d) |
| 2 | Kill duplicate checklist. Keep `GettingStartedChecklist`, retire `OnboardingChecklist`. Make checklist persona-aware (3 visible + expand). | `getting-started-checklist.tsx`, delete `onboarding-checklist.tsx`, persona vocab | M (2d) |
| 3 | Persona-flex the `pax_tour` and `complete` onboarding steps using `personaVocabulary.ts`. | `onboarding-v2.tsx:1347-1474`, `personaVocabulary.ts` | S (1d) |
| 4 | Build "scan → first lead owned" conversion: clicking an `InstantDealHunt` card creates a real `leads` row + opens detail. | `InstantDealHunt`, `/api/leads` POST, lead detail | M (2d) |
| 5 | Add Pax in-onboarding moment: after instant_hunt, one-message Pax bubble with "Draft offer letter" → generates artifact, lands in lead timeline. | new `OnboardingPaxBubble.tsx`, `/api/pax/draft-offer`, `onboarding-v2.tsx` | M (2d) |
| 6 | Imported-data celebration: full-screen "247 leads, 89 high-motivation" moment after CSV import. | `PortfolioImportStep` (`onboarding-v2.tsx:288-480`), new `ImportCelebration.tsx` | M (2d) |
| 7 | Empty-state pass on `/today`: extend `isNewUserMode` (`today.tsx:213-217`) to hide Pax-suggests/AI-queue when zero data; replace empty-state copy with onboarding affordances. Audit empty states on /leads, /properties, /deals, /campaigns, /finance. | `today.tsx`, plus 5 surface pages | M (2d) |
| 8 | Move pricing wall from signup to day 7. Replace pricing CTA with "Start free" → onboarding → soft pricing prompt at day 7 in-app + email. | `landing.tsx`, `pricing.tsx`, auth router, day-7 cron | S-M (1-2d) |
| 9 | First-week email arc: day 0 (welcome + scan starting), day 1 (morning briefing), day 3 (try offer-letter), day 5 (cohort milestone), day 7 (upgrade prompt). | new `server/jobs/activation-emails.ts`, email templates | M (3d) |
| 10 | Activation cohort dashboard: time-to-first-aha, day-1/3/7 retention, drop-off by step. Plug into `cohort-retention-dashboard.tsx`. | `cohort-retention-dashboard.tsx`, server activation queries | M (2d) |

**Two-week order**: 1 → 7 → 2 → 3 → 4 → 5 → 6 → 8 → 9 → 10. Telemetry first (you can't fix what you can't measure). Then empty-states + checklist (kills demotivation). Then the persona/aha/Pax/celebration core. Then commercial (pricing move + email arc). Cohort dashboard last.

---

## One-line summary for the founder

Today, a brand-new Land Investor reaches "first value" at minute 7:30 — and it's a passive read, not an action they own. With this sprint they reach it at minute 1:30, *own* an artifact at 2:30, and walk into a populated workspace by 6:00. That's the difference between "another CRM" and "I can't go back to Excel."
