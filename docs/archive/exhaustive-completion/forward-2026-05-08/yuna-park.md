# Yuna Park — Activation / hour-one value

**Reading list (what I read before writing):**
- `docs/exhaustive-completion/MASTER-FINDINGS-RECONCILIATION.md` (P0 summary: 21/24 shipped; P1-35..46 AI eval deferred)
- `docs/exhaustive-completion/REMAINING-WORK-INVENTORY.md` (Onboarding v2 redesign deferred pending per-step telemetry; step instrumentation shipped 2026-05-06)
- Yuna-activation.md — original audit from 2026-05-01 (time-to-first-value currently ~7:30, target ~1:30 aha; zero activation events tracked)
- `client/src/pages/onboarding-v2.tsx:1064-1147` (path picker; 1,543 lines monolith), `client/src/pages/today.tsx:213-217` (`isNewUserMode` logic)
- `client/src/components/GettingStartedChecklist.tsx` (5 items, server-backed), `client/src/lib/telemetry.ts` (exposed but unused in onboarding)
- `docs/exhaustive-completion/founder-dashboard-extraction-queue.md` (pre-condition telemetry shipped; per-step events now live in activation_events table)

---

## State read

Five weeks ago Yuna diagnosed three competing onboarding systems (setup wizard, product tour overlay, checklist) and measured time-to-first-value at 7:30 minutes (passive scan card read, not an owned action). The pre-condition work shipped: `activation_events` table exists, step-instrumentation telemetry (county_picked, first_lead_owned, first_artifact_generated) is live and accumulating data. `isNewUserMode` logic is present but only hiding Business Pulse; Pax-suggests and AI-queue sections still punish new users with "Pax is monitoring" empty state copy. No persona-aware onboarding exists yet — all paths use generic land-flipper framing regardless of whether the user picked "note_investor" or "wholesaler."

---

## Push forward — my 5 moves (ranked)

1. **Persona-aware first-day checklist and aha step** — The highest-leverage single change. `GettingStartedChecklist.tsx` has 5 items; Yuna called for 3 visible + expand. Right now the list is persona-agnostic (shows "notePayment" to a land_flipper who will never use it). Refactor: render `PERSONA_CHECKLIST_ITEMS` keyed by `usersPersona` (already set in `onboarding-v2.tsx:1030-1041`). For land_investor: (1) Pick county + run scan, (2) Convert scan card to owned lead, (3) Generate Pax offer letter. For note_investor: (1) Upload note CSV, (2) Review payment history + yields, (3) Flag at-risk borrowers. For wholesaler: (1) Set target state + motivation, (2) Auto-assign contract list, (3) Generate assignment-fee breakdown. The aha step itself (instant_hunt for land, portfolio-upload for notes, assignment-fee-calc for wholesale) becomes persona-specific in `onboarding-v2.tsx:111-282`. Two weeks. This move alone collapses time-to-aha from 7:30 to ~2:30 for each persona because the first checklist item IS the aha moment.

2. **Kill the duplicate checklist + render completed as collapsed pill** — Yuna flagged `OnboardingChecklist` (localStorage-backed, 7 items) vs `GettingStartedChecklist` (org-backed, 5 items). Delete `OnboardingChecklist.tsx` entirely. Consolidate into `GettingStartedChecklist.tsx`. Refactor the "completed items" behavior: don't show completed items at 50% opacity inline. Instead: when a user hits 3/3 items, show "+3 completed" pill (collapsed) with expand toggle. When they expand, show the completed trio underneath. Notion does this; it communicates "you've made progress" without cluttering the active list. One week. Unblocks the checklist as a real activation funnel (currently it's visual noise).

3. **Empty-state affordance pass on `/today` using isNewUserMode extension** — `isNewUserMode` already hides Business Pulse when org has <3 leads. Extend it to hide: "Pax noticed" section (replace with "Ask me to find tax-delinquent parcels"), "AI action queue" (replace with "Try uploading your existing leads to see actions"), "Start here today" (replace with checklist). The "new user mode" label itself should vanish at 3 leads + 1 action completed (not just 3 leads). This is a toggle in `today.tsx:213-217`, not new code. Audit empty states on `/leads`, `/properties`, `/deals` (should either hide or invite). One week. Kills the "all zero, all sarcastic" impression.

4. **Pax in-onboarding hello message (one persona-flexed chat bubble)** — Yuna said Pax is described in onboarding but never speaks. Build a one-message injection after the `instant_hunt` step (or after the persona's aha step for other personas). For land_investor: *"I scanned 1,847 parcels in Hudspeth County and surfaced these three. Want me to draft an offer letter for the top one?"* Yes/No toggle. If yes, generate using `routes-ai-draft.ts` reused for offers, drop in their lead timeline. For note_investor: *"Upload your notes and I'll calculate yield-to-maturity for each one. Which would you like to see first?"* The message becomes the introduction moment + first artifact in one. Two weeks. Persona-flexing is key; a note investor doesn't care about tax-delinquent scans.

5. **First-week email arc: day 0 (welcome), day 3 (try feature X), day 7 (upgrade prompt)** — Yuna called for five first-week milestones in §7. Build: day-0 email at signup ("Your overnight scan starts at 11pm"), day-3 email (persona-flexed: land gets "try the offer-letter generator," note gets "review your first payment batch"), day-7 email (upgrade prompt + cohort comparison: "You've reviewed 12 opportunities; top operators review 20+"). Wire to a `server/jobs/activation-emails.ts` worker keyed on `activation_events.onboarding_completed` timestamp. Three weeks. This is the retention flywheel; without it, signups fade to silence.

---

## What I'd defer (and why)

- **Onboarding redesign (full visual refresh).** Yuna's original plan was a 3-4 day rebuild against the prototype. Defer until per-step telemetry shows a step with >50% drop-off. Right now signup volume is ~8/month (n too small to read signal). The prototype is ready; telemetry is now live; revisit at month-end when you have 20-30 signups in the data.
- **Pricing wall removal (move to day 7).** Tempting (reduces signup friction). But you're pre-revenue; tier information is not a blocker. Keep the 14-day free trial at signup; move the pricing prompt to the day-7 email instead. The nudge works better after they've experienced aha.

---

## What scares me most (one named risk + mitigation)

**Persona logic breaks silently and users get the wrong onboarding.** You're now writing persona-flexed aha steps, checklists, and Pax messages keyed on `usersPersona` (enum: land_investor / note_investor / wholesaler). If `mapBusinessTypeToPersona` (in `onboarding-v2.tsx:1047-1061`) has a bug — e.g., "flipping" → undefined instead of "land_investor" — new users get a None-flavored aha step or no checklist at all. Mitigation: (a) before shipping, QA each persona path end-to-end (county pick → scan → offer draft for land; CSV upload → yield calc for note; etc.); (b) add a `personaMismatchAlert` event to telemetry (fired if `usersPersona` is undefined after path selection); (c) founder manually spot-checks the first 5 signups from each persona path.

---

**Bottom line for the founder:** Time-to-first-value is the only metric that matters for activation. Right now it's 7:30 (passive read). The five moves above get it to 2:30 (owned action + artifact). That move from passive→active + the persona-flexing (not everyone wants tax-delinquent scans) is the difference between "another CRM" and "I can't imagine going back to spreadsheets." The checklist, the empty-state pass, and the first-week emails are the retention moat. Get persona-aware aha + persona-aware checklist live this sprint. That's the only blocking call.
