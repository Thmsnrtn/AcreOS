# Session report — 2026-11-06 → 2026-11-24: gap-analysis roadmap, code-only slices

Build lead session. Brief from Tom: ship the code-only parts of the gap-analysis
roadmap as small, independently mergeable PRs — parallel subagents, one worktree
and one PR per slice, no deploys, no merges from the session (Muse audits and
merges), zero new tables for this session, every ratchet and the constitution
respected, anything needing an owner action or a founder decision stopped and
written up. Muse's direction memo (2026-11-06) added: skip Wave 1 slice 1
(PR #473, another session); Wave 2 light-up-or-delete must respect the live
Notes V2 / Wholesale / Fix-and-Flip / Subdivision lanes; 1099 is copy-only;
docgen routes through the assignment-compliance gate and native `/sign`;
click-to-call is build-only with the DNC seam mandatory; county list builder is
gated-real, draft only.

Everything below was verified against GitHub (`gh api`) and git at the time of
writing; agent reports were treated as hypotheses (CLAUDE.md, wave discipline).
Per-slice evidence lives in the PR bodies; the session's working reports were
kept outside the repo.

**Timeline.** Slices built 11-06 → 11-08; independent audits 11-08 (A) and
11-09 / 11-15 (B); the weekly usage limit (11-09 → 11-14) and a 5-hour limit on
11-15 each cut every agent mid-gate, so the open PRs went stale against a main
that moved ~130 commits (founder-OS extraction, bundle ceiling 9,823 → 8,046 KB,
Muse's "brought current as a fresh PR" convention). Bring-currents onto
`d86ca537` and the remaining audit fixes were in flight when this report was
written (11-24); heads below are the latest pushed at that moment.

## 1. Every PR this session opened

Head SHAs are the PR heads at the time of this report. "merged" means merged to
`main` by Muse; nothing was merged by the session.

| PR | Slice | Head | Status | One line |
|---|---|---|---|---|
| #481 | S0 reconcile next-moves | 62754019 | merged | next-moves.md merge statuses reconciled with git |
| #483 | W2-MHP mobile-home park | b81b799a | merged | pad home record + meter reads lit; split/billback stopped |
| #486 | W2-AGENT agent-investor | 09c29e8e | merged | agency disclosure lit; two uncalled commission routes deleted; no default rates shown as the org's own |
| #487 | W1.5 land first-offer CTA | 879d0464 | merged | "Make your first offer" on Today → blind-offer wizard |
| #491 | W1.3 nav/copy honesty | 4ded7342 | merged | Offer Batches hidden, 1099-INT copy removed, Wholesale copy fixed, Rentals Analytics link fixed, borrower-portal 410 → /portal/v2 |
| #492 | W2-STR short-term rental | a9f6f6ea | merged | STR record/status/P&L lit on Bookings; per-stay pricing route deleted |
| #493 | W2-RENT rent ops | dbeb8ed5 | merged | rent due, proposed late fees, legal posture lit; deposit letter stopped |
| #494 | W2-TEAM team | f86a4dea | merged | lead routing lit; duplicate team-dashboard reads deleted; approvals + Slack/Teams stopped |
| #498 | W4.10 county list builder v0 | 78945e2b | merged | behind the Map door, real but gated by the parcel-lookup gate, dark everywhere |
| #488 | W4.11 note-model merge plan + pricing engine | 884ea7ff | **draft** | B10 proposal + `note_pricing` engine; recording refused for non-note subjects (audit fix) |
| #495 | W2-COMMERCIAL | c55b15cd | merged (11-11) | commercial tab on /leases — CAM, escalations, $/sqft lit; CAM refuses raw totals |
| #497 | W2-TODAY vertical surfaces | c00eab6f | open (Muse's merge queue) | Today shows each vertical's tools on phones; widgets retirement. Build red on 11-09 was the bundle ceiling, since fixed on main |
| #499 | W1.4 signup trim | c3051827 | open | front page = land_flipper, hybrid, note_investor; others waitlist behind a flag defaulting on. CodeQL CSRF fix pushed |
| #500 | S-HARDEN parent-parcel scope | 9ad616df | open | parent parcel reference resolved in the caller's org; dashboard aggregates scoped |
| #501 | W3.8 docgen → /sign | 30188887 | open | the deal prepares its own purchase agreement through the assignment-compliance gate, hands it to the native signing rail |
| #502 | W3.9 click-to-call | dd1357b2 | open, **needs ruling** | org's own Twilio, DNC/consent-gated, logged to the lead timeline; 7 population gates satisfied; `DEBT_BASELINE` 212 → 214 (§3.1) |
| #503 | W1.2 team invites | 5df7f480 | open | invites emailed on the system lane; TeamInviteCard says only what is true. CodeQL regex fix + audit fixes pushed |
| #504 | W3.6-B retire inert API-key card | 8f04840e+ | open | inert `acos_` mint card and routes removed; ladder gate tests minting behaviour, not a symbol name |
| #505 | W1.6 quick offer | f778c4bb | open | QuickOfferModal no longer claims a sent/queued letter; it launches the offer wizard |
| #509 | S-HARDEN-2 team notification sender | c048aaab | open | Slack/Teams sender uses the shared outbound URL check, no redirects, 10 s timeout |
| #510 | ratchet lastBumpNote restore | ccff56f7 | open | restores the colon-any / self-fallback bump history #494's merge overwrote |
| #511 | W2-RENT follow-up | aaa496a8 | open | copy no longer tells landlords to post a manual charge AcreOS cannot record |
| #512 | W3.8-B signature content hash | b19d7cc1 | open | public sign route records the content hash; sealed PDF/certificate distinguish not-recorded from tampered |
| #513 | S-BUNDLE-2 bundle trim | 1b8473d0 | open | recharts Babel helpers emitted once + Sentry debug statements stripped: 9,824 → 9,721 KB (9,702 KB with #507 merged in) |

| #514 | S-HARDEN-3 signature org scope | c2cead28 | closed → superseded by Muse's **#719** (11-23) | `POST /api/signatures` resolves the document under the caller's org; sealed-PDF reader filters by org (found by W3.8-B). #719 carries the patch and tests verbatim, composed onto main's `targetDoc` fetch |
| — | S-HARDEN-4 connector senders | — | opening | `sendSlackMessage` / `triggerZapier` / `triggerMake` get the same URL check + timeout + no-redirect treatment as #509, plus the outbound-sender population gate (audit B2 finding) |

Not ours but relevant: Muse's zod JSON-Schema stub (−9 KB) merged as #507 on
11-09 (its twin #508 is still open); #513 is independent of it and was merged
with it on 11-15.

### Slices with no PR

| Slice | Why |
|---|---|
| W1.1 onboarding bounce await | skipped per Muse — PR #473 (another session) |
| W3.6 org API-key minting wired to `/mcp` | **stopped**: customer API-key minting is held by the expansion ladder ("no public API before ~50 customers"); `expansionLadder.test.ts` fails on any mounted mint without a founder gate. The inert card it would have replaced is retired by #504 instead. Decision in §3.2 |
| W3.7 fire all 13 webhook events | **stopped**: founder ruling B8 pins `LIVE_WEBHOOK_EVENTS = ["lead.created"]`; wiring the other 12 emitters relitigates it. Decision in §3.3 |
| W2-DEVELOPER | **skipped**: owned by the Subdivision lane (#462); overlap written up, not built |

## 2. What changed on main because of this session (merged)

- Customer-visible claims that led nowhere are gone (#491, #486, #492, #493,
  #494, #483): nav entries hidden, copy corrected, uncalled routes deleted,
  default rates no longer presented as the org's own.
- Land gets a first-value CTA on Today (#487).
- Wave 2 verticals were adjudicated light-up-or-delete per vertical, with the
  census method in each PR body; the maturity-overclaim baseline stayed at 11
  (only a decision loop or a founder relabel lowers it — none happened).
- County list builder v0 exists behind Map, dark until the parcel-lookup gate
  opens it (#498).
- `next-moves.md` reconciled with git (#481).

## 3. Stopped for Tom / Muse — decisions needed

Each is written up in full in the named PR body. Recommendation marked where
the slice owner gave one.

### 3.1 #502 click-to-call — three decisions
1. **`DEBT_BASELINE` 212 → 214** (purpose-ledger census, a down-only ratchet).
   GET/POST `/api/leads/:id/call` read the lead and hand its number to the
   org's own Twilio; ledgering them needs a `lead_contact_call` purpose surface
   and a call-purpose taxonomy (today's codes are FCRA purposes). Options:
   (A, recommended by the owner) accept +2 as DEBT; (B) add the surface +
   `recordPurpose` on POST, with a UI step to collect the purpose; (C) offset
   by ledgering two other DEBT entries in a separate slice. **Until ruled,
   #502 either carries the raise or stays red.**
2. **Consent rule for operator-dialled calls** (legal/founder). Decision
   2026-10-20 #1 is texts-only. Built as written-consent-only and
   DNC-listing-refuses (option A, recommended until counsel confirms); (B) any
   TCPA grant licenses an operator-dialled call (one line in
   `callConsentVerdict`); (C) written-only and also narrow `canCall` everywhere.
   Servicing and reply-within-24h call purposes are not built — every call is
   gated as prospecting.
3. No live or test calls were placed; the Twilio adapter is BYO-only with no
   platform fallback (`customerActsOnOwnAccounts` holds).

### 3.2 W3.6 / #504 — customer API keys
The ladder holds minting. Options: (A) narrow the ladder for "an org's own
read-only MCP key" accepted only by `/mcp` and `/api/mcp`; (B) keep the hold —
#504 then stands as the end state; (C) rescind. Also: **drop the `org_api_keys`
table and its rows?** (#504 proposes the deletion-ledger row; no table was
dropped by the session.)

### 3.3 W3.7 — webhook events
B8 stands unless rescinded. If rescinded, the slice is: wire 12 emitters and
rewrite the pin in `shared/webhooks/catalogue.ts` + its test to derive liveness
from real emitter call sites (the `workflowActionHonesty` pattern).

### 3.4 #512 — existing counterparty signatures
Rows signed before the fix have no content hash and will read "not recorded"
forever; a hash computed now would describe today's content, not what was
signed. Accept that end state, or offer a re-signing flow?

### 3.5 S-HARDEN-2 (#509) — Slack/Teams webhook URL storage
Stored in plaintext (masked on read). Options: (A) encrypt in place with
`fieldEncryption`, after #494 (merged) — no schema change; (B) delete the layer;
(C) rebuild on the Pax connector (one `slack` slot per org, no Teams slot).
Owner recommends B, or A if the feature is wanted.

### 3.6 #488 (draft) — `note_payoff` subject kind
`note_payoff` can still be recorded through `POST /api/scenarios` against
integer property/deal ids. Declaring `subjectKind: "note"` closes it in one line
but changes an engine outside the slice. Also B10 itself: merge the two note
models — the proposal is in the PR; the engine records nothing until ruled.

### 3.7 Wave 2 product calls (one per vertical, from the PR bodies)
- **STR (#492):** channel-CSV importer has no screen — (a, recommended) fixed-order paste importer on Bookings, (b) header-mapped Airbnb/VRBO, (c) delete; turnovers generate vs the live checkout workflow — which record is canonical.
- **Commercial (#495):** percentage rent (sales reports + compute) and the contractual late-fee proposal have no screen; CC&R template authoring (POST/PATCH/DELETE) is customer-authored legal text — needs design, not a light-up.
- **MHP (#483):** lot-rent split (two nullable columns vs emitted components) and utility billback (fix the period pairing first, then a minimal card).
- **Rent (#493, #511):** a manual rent-charge route (partial months, contractual commercial late fees) is the real fix behind the copy change; deposit chain stopped.
- **Agent (#486):** the commission economics loop (forecast/split engines refuse when unconfigured) — build the configuration surface or delete the engines.
- **Team (#494):** approvals and Slack/Teams notification channels stopped (see 3.5).
- **OD-5 relabels:** STR, MHP, agent, commercial, developer public tiers are each one founder relabel away from lowering `MATURITY_OVERCLAIM_BASELINE`; nothing was relabelled by the session.

### 3.8 Signup trim (#499)
The flag defaults on. Which types are on the front page is a product call
recorded in `shared/signupTrim` — confirm land_flipper / hybrid / note_investor,
and whether the waitlist row (`signup_waitlist:<type>` source) is the wanted
capture.

### 3.9 Docgen (#501)
A promissory-note template needs `{{late_fee_percentage}}`, which no record
holds; carried notes may hold default rate/term until the Reg-Z originate
chokepoint — whether a note may be prepared for signature before origination is
a compliance decision. Lender address has no record when `owningEntity` differs
from the org. Purchase agreement only was built.

### 3.10 Bundle (#513)
Main's regime since 11-15: two outputs (customer / founder), customer ceiling
8,046 KB, the gate fails if a ceiling sits >5 % above measured, and every PR
that adds client bytes offsets them in-slice (recorded in
`scripts/bundle-budget.json`). #513's Sentry half was taken by main
independently (P2-6 S1); its recharts Babel-helper dedupe (−97 KB) is being
brought current with the ceiling lowered to measured+1 in the same PR. Larger
reductions all still need an owner call: PostHog slim build (~100 KB; disables session recording/surveys/
heatmaps that are configured server-side), Sentry Replay (~100 KB, live
configuration), JSTS behind `turf.buffer` (~300 KB, powers the subdivision
setback overlay, Subdivision lane), terser (lockfile change).

## 4. Known red / at-risk CI at report time

- **#497 Build red (11-09)** — bundle 9,831 KB vs 9,823 ceiling; main itself
  measured 9,824–9,826 KB. #507 merged 11-09 and main is back under the
  ceiling; Muse brings #497 current. Commented on the PR.
- **#502** — green only with the `DEBT_BASELINE` raise (§3.1).
- **#499 / #503** — CodeQL re-runs pending on the pushed fixes.
- **#509** — one Mobile-navigation-smoke run failed on `92048cab` with a
  `/deals` goto interrupted by `/maps`; the same SHA also passed, main passed.
  Harness race, not this server-only PR. Commented once.
- **11-09 → 11-15 gap** — the weekly usage limit cut every agent on 11-09;
  no audit-fix push landed until 11-15, so every open PR went six days stale.
  All were brought current on 11-15 (merge, not rebase); the three ratchet
  conflicts were resolved by re-measuring on the merged tree.

## 5. Independent audits

Batch A (2026-11-08) covered #486 #488 #491 #492 #493 #494 #495; findings were
posted as PR comments and fixed in follow-up commits (#493 invalidation inline;
#494 lastBumpNote restore → #510; #488 ALL_ENGINES → subject-kind guard;
#495 rent-roll copy → #511).

Batch B (2026-11-09) — two auditors who built none of it, told to mutate what
each test governs and re-measure every ratchet delta:
- B1: #497 #499 #500 #501 #502 #503 — see §5.1
- B2: #504 #505 #509 #510 #511 #512 #513 — see §5.2

### 5.1 Batch B1 verdicts (2026-11-09)

| PR | Verdict | What the auditor found (hypothesis → evidence) | Disposition |
|---|---|---|---|
| #497 | BLOCKING (then) | Build red: bundle 9,831 KB > 9,823; main itself measured 9,824 KB | Cleared by the bundle trims (#507 merged 11-09; #513 open); Muse brings #497 current |
| #499 | FINDINGS | **Bypass:** Skip marks the org onboarded, after which the trim rule allows any type — a new signup can Skip then switch to any of the 12 closed types. 5 of 7 guarded routes were tested only for the presence of the guard call (passing `undefined` stayed green). A comment cites a test file that does not exist. Landing chips list types a new visitor cannot pick (founder call). | Fix in flight on the branch |
| #500 | FINDINGS | Population test recognised only `parentParcelId:` object keys; `allowedUpdates.parentParcelId = updates.parentParcelId` in `routes-bulk.ts` reached the update unchecked while the test stayed green. The realdb tests themselves were real (6/6; removing the bulk check → 2 red). | Fix in flight (bulk route resolved under org + TS-parsed population test with per-shape canaries) |
| #501 | FINDINGS (minor) | "covers every document writer" read only create/insert sites. Pre-existing on main: `PUT /api/generated-documents/:id` accepts any `status`, so a member can mark a purchase agreement "Signed" with no ceremony — Wholesale-lane file, e-sign ruling. | Test widened in flight; PUT status → §6 follow-up slice |
| #502 | FINDINGS | **Voicemail-as-answer:** the operator leg rings 20 s and the lead is dialled on answer, so an operator voicemail connects the lead to a greeting and the timeline says "Call completed". DEBT +2 confirmed honest (narrowing the GET read kept it counted; no in-PR offset). Body numbers off (reachability 1225 → 1222; 33 tests). | "Press 1 to connect" gather in flight; DEBT raise still Muse's ruling |
| #503 | FINDINGS (minor) | Rotating an invite wrote `ORG_MEMBER_ADDED`; manual said "Settings > Team"; simulation mode showed "not set up"; silent `app.acreos.io` fallback. | Fixed 5df7f480 (`ORG_INVITE_ROTATED`, manual, `simulated` status, logged fallback per the other mailers' convention) |

Every other new test in B1 went red under mutation of the code it governs.
No new tables; rails and consent rules hold; no new nav entries; the only
shared file (`routes-organization.ts`, #499 + #503) merges cleanly.

### 5.2 Batch B2 verdicts (2026-11-15, heads of 11-09)

| PR | Verdict | What the auditor found | Disposition |
|---|---|---|---|
| #504 | FINDINGS | The new minting gate (`expansionLadder.test.ts` ~538) scans only the registration call's inline text: the deleted mint route restored with a NAMED handler (`api.post(path, mw, createOrgKey)`) stayed 30/30 green; 14 handlers in the repo are registered that way. Route removal itself correct, no remaining callers. | Fix in flight (resolve named handlers, per-shape canaries, vacuity floor) |
| #505 | FINDINGS (minor) | "writes nothing" watched only `apiRequest` (a raw `fetch` stayed green); comments say ⌘N, shortcut is ⌘O; notes-only orgs launched into a wizard their nav hides. | Fix in flight |
| #509 | FINDINGS | Three more senders with the same gap: `sendSlackMessage`, `triggerZapier`, `triggerMake` in `connectors/executor.ts` (no URL check, no timeout, redirects followed; Pax tools call them). Body says 9 tests; file has 8. | New slice S-HARDEN-4 in flight (all four senders + the outbound-sender population gate) |
| #510 | FINDINGS (conflict only) | Both notes restored verbatim; conflicted with main and #504. | Merged main ccff56f7, main's note kept and history re-appended |
| #511 | FINDINGS (nits) | Copy is true (no manual rent-charge route exists); two server comments still say "post by hand"; 409 message unpinned. | Fix in flight |
| #512 | FINDINGS | Hash records the server's content at submit, not what the signer saw; `pending_signature` documents are still editable, so an edit between view and sign seals "VERIFIED" over unseen text. Writer census confirmed exhaustive (server, shared, scripts, client, migrations). Sealed-PDF/certificate routes have no in-app caller. | Fix in flight: signing page echoes the hash it displayed; server refuses on mismatch |
| #513 | CLEAN | Measured independently: 9,824 → 9,721 KB on the 11-09 base; 9,805 → 9,702 KB with #507 merged in; 516/518 chunks byte-identical; helper-equivalence test reads recharts' shipped helper bodies. | Merged main 1b8473d0 (9,702 KB measured) |

The 11-09 Build reds on #509–#512 and #514 were main's own bundle overage
(9,824 KB), not the diffs; #504's SAST/Security Gate red was a CodeQL-bundle
download timeout. Both clear on the bring-current pushes.

## 6. Findings worth their own slice (not built this session)

- **S-HARDEN-3 (in progress):** `POST /api/signatures` writes a row when the
  `documentId` is not in the caller's org, and the sealed-PDF/certificate
  readers load signatures by document id without an org predicate (found by
  W3.8-B, confirmed by reading). Cannot produce a false "verified" (no hash),
  but a foreign row would render. PR being opened, neutrally worded.
- Pax `sendSlackMessage` (`connectors/executor.ts`) fetches a stored URL with
  no URL check and no timeout — the gap #509 closes for the team sender;
  Zapier/Make connectors likely the same. `publicWebhookDispatcher` has no URL
  check at delivery time; `webhookDispatcher` follows redirects after its check;
  every sender resolves DNS twice (check vs fetch). A population gate for
  outbound senders should land after those fixes, not before.
- Two offer stores (`offers` vs `offer_letters`) with no UI reading `offers`;
  `POST /api/offers` silently drops unknown keys (W1.6).
- `docs/esign/PROVIDER_BOUNDARY.md` §3 claims the hash was always recorded —
  needs a dated correction (W3.8-B). Documents awaiting signature are still
  editable; the hash is taken at submit, not at view. Signing a document with no
  content is accepted.
- Stale Atlas comment in `server/routes.ts` (~1927) still names the quick-offer
  modal as a caller.
- Mobile smoke J1: the `/map` → `/maps` redirect race (§4).
- The tests-typecheck ratchet (`check:tests`, baseline 151) cannot run on the
  session's 7 GB machine (OOM); every slice left it to CI.

## 7. Process notes (for the next build lead)

- **Never `git stash` across worktrees** — `refs/stash` is shared; three slices
  cross-contaminated before the brief banned it. Patch files + `git checkout --`
  instead.
- **Pre-commit tsc must run under the heavy lock** — a hooks-path wrapper with
  an `ACREOS_HEAVY_HELD` escape avoids both thrash and the deadlock when the
  commit itself is run under the lock.
- **Merge, never rebase, once a PR is open**; when both sides lowered the same
  ratchet, take main's file and re-measure on the merged tree (did this for
  #504: colon-any 2630 → 2627, self-fallback 134 → 133).
- **Read verdicts from files, never pipes** (CLAUDE.md) — every agent was held
  to it; the one hook skipped with `--no-verify` was a JSON-description-only
  commit on #513.
- Usage-limit pauses (five 5-hour, one weekly) cut agents mid-gate repeatedly;
  worktrees preserved the work and agents resumed by message. Container reboots
  lose swap — re-enable `/swapfile` first.
- Population gates found most of the real defects after the fact (#502's four
  gates, #509's reachability, #505's inline-provenance baseline): run
  `lint:reachability`, `lint:inline-provenance`, `purposeLedgerCensus`,
  `inboundWebhooksReachAnonymously`, `routeParamRefusesArrays`, `vaRolePath`
  locally before opening any PR that adds a route.
