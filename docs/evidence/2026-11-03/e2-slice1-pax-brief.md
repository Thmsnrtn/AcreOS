# E2 slice 1 (Pax core): step-0 inventory, three legs stopped, leg 2 (morning brief) built as an extend

Package: `claude-package-e2-slice1-pax-core-2026-11.md` (Muse, 2026-11-03), implementing P1 of the ratified sequence.
Branch: `claude/e2-slice1-pax-brief`, off main `f7f2e3f`. Built 2026-11-03 (EST).

## Step 0: the spec's "missing" checklist checked against the tree

| Spec premise (§Problem) | What main holds | Leg outcome |
|---|---|---|
| Memory of the business: MISSING | **Exists.** `pax_memory` is org-scoped. It has a customer panel (`client/src/components/pax-memory-panel.tsx`, opened from the copilot rail) over `GET` and `DELETE /api/ai/memory` (`server/routes-admin.ts`). It is read by 6 server modules. There are about 17 write sites, including silent model writes: `remember_fact` (`server/ai/tools.ts`, classed `looks_and_drafts`, so it runs while paused), support `save_user_memory`, and `paxMemoryTriggers.ts`. Two more stores exist: `ai_memory` and `agent_memory`. | **Leg 1 STOPPED.** The spec's own rule ("Pax never writes memory silently; no other write path") contradicts the live writers. A new table beside `pax_memory` is the parallel implementation step 0 forbids. |
| Morning brief: MISSING | **Exists.** `MorningBrief.tsx` sits on /today above the queue. `composeBrief` and the flagged `composeBriefWithPax` in `server/routes-today.ts` produce one line from real counts, with a template fallback. | **Leg 2 BUILT AS EXTEND** (below). |
| Rails, trust ledger and stand-down are MISSING; `routes-pax-controls.ts` behaviour is Unknown | **Classified** (rulings below). It implements stances (`ask_before_sending` is the default, under which chat record writes run without a tap; and `ask_before_everything`), each tied to a dated founder ruling in `STANCE_RULINGS`. It has an org-wide, time-limited **Pause** with a coverage ratchet derived from `UNATTENDED_PATHS`, and a "What Pax did" receipts ledger (`recordPaxEffect` writes to `activity_log`). | **Leg 5 STOPPED.** This is the spec's own stop condition 1. See the conflicts below. |
| Prepared-work surfaces: MISSING | Correct, no packet surface exists. `pax-artifact.tsx` is an in-chat table, document and card renderer with no provenance and no lifecycle. | **Legs 3 + 4 HELD.** They depend on leg 5 (see below). |

### Leg 5: the conflicts

1. **Presets vs stances.** D2 makes "Prepare-only" the default for every org. The live default stance, `ask_before_sending`, lets Pax's chat record writes run without a tap. Labelling that default "Prepare-only" would be false. Changing it means a new stance, which needs a dated founder ruling (`paxControlsOffered.test.ts` refuses a stance without one) and changes live behaviour that the package says stays "exactly as today".
2. **Stand-down vs Pause.**
   - The Pause is the obvious single choke point: one reader (`getPaxControls`) and a ratchet in both directions.
   - It differs from the stand-down the spec describes in two ways. The Pause expires (tomorrow 8am, 3 days or 30 days). By design it does not stop drafting (`inbox_drafts`: "a draft is not an action"). The spec's stand-down is open-ended and must halt brief generation, preparation and shadow accrual.
   - Reusing the Pause changes its semantics. A second switch would be a parallel surface.
3. **Trust ledger vs receipts.** Pause, resume and controls changes are already receipted (`pax_paused`, `pax_resumed`, `pax_controls_changed` in `activity_log`). A new ledger table would record those events a second time. Extending receipts means adding packet, rail and shadow events to a ledger whose stated contract is "effects on records".

### Legs 3 + 4: why they are held, not built

- The spec says the packet lifecycle is "recorded in the trust ledger (§5)", and which ledger that is remains open (conflict 3).
- The only packet producers the spec defines are memory proposals (leg 1, stopped) and rails-scoped preparation (leg 5, stopped).
- Building now would either quietly settle the §5 questions or ship a packet store, API and pane with no production producer, which is the "built but unwired" defect CLAUDE.md names as this repo's most common.
- No contradiction was found in legs 3 and 4 themselves. When §5 is decided, `pending_actions` plus `approvePendingAction` is the kernel path, so a send-type packet needs no second approval path (stop condition 2 does not trip).

## Inventory rulings (reuse / extend / retire)

| File | Actual behaviour | Ruling |
|---|---|---|
| `server/routes-pax-controls.ts` | The Settings → Pax surface: GET and PATCH controls (stance plus 3 switches; owner or admin; strict zod), POST pause and resume (org-wide; any member may pause, admins resume everyone), GET receipts. Every number comes from a row; a failed read is refused, not guessed. | **Reuse.** It is the rails, stance and stand-down home. Leg 5 is stopped on the conflicts above rather than built beside it. |
| `shared/pax-controls.ts` | Registries: `OFFERED_STANCES` with `STANCE_RULINGS`, `PAX_CONTROLS_DEFAULTS`, `PAX_TOOL_GROUPS` (both dispatch switches), `UNATTENDED_PATHS` (the Pause population), `PARKED_STATES`. | **Reuse**, unchanged. |
| `server/services/approvalKernel.ts` | Freeze-and-tap: `proposePendingAction`, `approvePendingAction` / `rejectPendingAction` / `revisePendingAction`, live predicate, TTL sweep, `pax_sends` audit. | **Extend**, read-only: `countPendingActionsByTool` uses the same live predicate as the badge. |
| `shared/schema/autonomy-ops.ts` | Agent-platform tables (connectors, projects, scheduled-task runs, autonomy rules). | **No change.** It agrees with the spec: this is not E2 memory. |
| `server/ai/supportAgent.ts` | The support dispatch switch (about 91 cases). It writes `pax_memory` silently in several handlers. | **No change.** Its memory writes are part of the leg-1 conflict. |
| `server/routes-pax-insights.ts` | Greeting, nudges, observations, and the needs-you list, count and approve/reject/revise (the queue's kernel surface). | **Reuse.** The brief reads the same live predicate. |
| `server/routes-pax-appeals.ts` | Customer refusal and appeal surface. | Unaffected; reuse. |
| `server/routes-pax-audit.ts` | Founder continuous-audit reads. | Unaffected (founder-side). |
| `server/routes-pax-calibration.ts` | Founder confidence calibration over `pax_observations`. | Unaffected. A future input to the confidence UI. |
| `server/routes-pax-context.ts` | Onboarding user-context capture. | Unaffected. |
| `server/routes-pax-disclosure.ts` | Disclosure acknowledgement (evidentiary row). | Unaffected. |
| `server/routes-pax-quality.ts` | Founder quality metrics. | Unaffected (founder-side). |
| `server/routes-pax-traces.ts` | Founder trace viewer. | Unaffected (founder-side). |
| `client/src/pages/pax.tsx` | Chat, health and conversations. | No change. It agrees with the spec. |
| /today: `MorningBrief.tsx` | One-line brief. | **Extend** (leg 2). |
| /today: `DecisionQueue.tsx`, `usePaxNeedsYou` | The work queue, including kernel asks. | Reuse, unchanged. |
| /today: `ReceiptsStrip.tsx` | Completed events since the last visit. | Reuse, unchanged. |
| `pax-memory-panel.tsx`, `/api/ai/memory` | Memory panel: list and delete. | **Leg-1 decision needed.** Also: `remember_fact` writes `value.content` but the route projects `value.summary ?? key`, so a model-saved fact shows only its first 100 characters (an existing defect, left unchanged). |
| `pax-artifact.tsx` | In-chat artifact renderer. | Candidate base for the leg-4 pane. Held with legs 3 and 4. |
| `client/src/components/user-morning-briefing.tsx` | Another "morning briefing" component. | **No importer in `client/src`.** Retire candidate, not touched here (out of scope). |

## Leg 2: what shipped

- **`server/services/morningBriefSections.ts`** (new, pure). It composes three sections:
  - *What changed* (24 hours): payments posted, new leads (sample book excluded), deals created or updated.
  - *What needs you*: notes late or delinquent, note payments due in 7 days, open alerts, real leads not contacted in 14+ days (sample book and closed, dead or converted leads excluded).
  - *What Pax prepared*: live kernel asks per tool, each named for what it is.

  The rules:
  - An item exists only when its count is above 0, and every item carries `source` and `asOf`.
  - A section whose input failed to read is returned in `unreadable` and rendered as "could not be read", never as "nothing". `empty` is true only when every input was read and every section is empty.
  - `parseTzOffset` accepts only real offsets (−840 to +720, whole minutes). No model is called and none is named.
- **`approvalKernel.countPendingActionsByTool`**: read-only, using the same live predicate as the queue badge.
- **GET /api/today** also returns `briefCard`. The headline is unchanged: still `composeBrief`, or the flagged AI line over the existing `routeAITask`, which consumes the per-org quota as before. The sections are deterministic.
  - It upserts one `pax_morning_briefs` row per org per viewer-local day, only when the org has data AND the request carries a real offset. Without the viewer's zone there is no "their day", and `CashStrip`'s shared fetch carries no `tz`.
  - A refresh updates the content and keeps a dismissal.
- **`server/routes-today-briefs.ts`** (new). `GET /api/today/briefs`, `GET /:id`, `POST /:id/dismiss` and `POST /:id/restore`, all org-scoped; another org's id gets a 404. Dismissal is a stamp, never a deletion, and is org-wide (the UI says so).
  - It is mounted ahead of `/api/today` **without `todayGuard`**, because these routes call no model. The AI budget must not be able to refuse a dismissal, and browsing the archive must not use up the page's 10-per-minute burst cap.
  - It is listed in `routeManifest.ts`.
- **Schema.** `pax_morning_briefs` is declared in `shared/schema/pax-morning-briefs.ts` (barrel-exported; the monolith count is unchanged). It comes with `migrations/0301_pax_morning_briefs.sql` and its mirror in `scripts/migrate.mjs`. The table-count ratchet goes from 748 to 749, **pending approval**.
- **UI.** `MorningBrief.tsx`:
  - The headline line works as before.
  - Expanding it shows the three sections. Each "none" line names exactly what was counted, and an unreadable section says so. It also shows "Counted from your records at …", and the controls link, "Past briefs" and "Dismiss for the team today" (failures show a toast).
  - Dismissed, it collapses to one line with "Show it again" and "Past briefs".
  - Position is unchanged: after the hero CTA and FirstDealCard, before receipts and the queue. Empty orgs still see only the empty-state CTA, so P0's first-value call to action is not displaced.
- **Not done in leg 2, and why.**
  - Stand-down state on /today, and halting brief generation while stood down, depend on the leg-5 decision. Gating on the existing Pause would decide that the Pause is the stand-down, and add a consumer to the pause population ratchet.
  - Archive search is cut, per A3.

## Independent audit (a fresh reviewer that did not build it) and what was done

| Finding | Verified? | Resolution |
|---|---|---|
| `CashStrip` fetches `/api/today` with no `tz`, so a UTC-keyed archive row is written; US evenings file tomorrow's row | Yes (`CashStrip.tsx` queryKey `["/api/today"]`) | No archive write without a real offset; test covers missing, `1e12`, `abc` and `30.5`, plus New York day keying |
| A failed kernel or payments read was shown as "nothing" | Yes | `unreadable` sections; route test injects a kernel failure |
| "None" lines claimed more than was counted; archive wording wrong; sample leads in "not contacted" | Yes | Scoped wording; "as it read the last time Today was opened"; real-book filter plus closed, dead and converted excluded on both lead counts |
| `?tz=1e12` made GET /api/today return 500 | Yes (would throw `RangeError` in `toISOString`) | `parseTzOffset` refuses it; covered by a test |
| Dismissal is org-wide | Yes, by design (row per org per day) | UI says "for your team today" |
| Archive and dismiss sat behind `todayGuard` (10/min plus the AI daily budget); no `onError` | Yes (`routes.ts` mount) | Separate router mounted without the guard; toast on error |
| Sweep missed direct kernel-table writes; weak headline assertion; test order dependency | Yes | `KERNEL_TABLE_WRITE` sweep with canaries; headline pinned to the template's shape; the dismiss test is self-contained |
| Table-count +1 not approved | Yes | Flagged; needs Tom's yes |

## Proof

| Property | How proved | Result |
|---|---|---|
| Sections from real state; sample lead, dead lead and expired ask handled; provenance on every item | `morningBriefSections.realdb.test.ts`, run on real Postgres 16 (UTC) built by `npm run db:build-from-repo` through both mounted routers | pass |
| Empty org gets an honest empty brief and no archive row | the same | pass |
| Dismiss survives a refresh; restore; the archive lists and reopens | the same | pass |
| Provider down (AI composition on and throwing): sections render and the headline is the template | the same, with `PAX_COMPOSED_BRIEF=1` and `routeAITask` throwing | pass |
| A failed kernel read is reported as unreadable | the same, with a kernel read failure injected | pass |
| No archive row without a real viewer zone; a bogus zone never returns 500; day keyed to the viewer's zone | the same | pass |
| A second org cannot list, reopen, dismiss or restore (by id or by list); org A's row is untouched | the same | pass |
| Composer: right section, words match what is counted, zeros omitted, provenance present, every parkable tool named, unreadable is never empty, offsets validated | `morningBriefSections.test.ts` | pass |
| No send transport, no kernel call or kernel-table write and no model identifier in the leg's population (composer, card, brief span of `routes-today.ts`, `routes-today-briefs.ts`), each with a vacuity floor and canaries | the same | pass |

**Mutants, 15 of 15 red:**

1. reopen unscoped
2. dismiss unscoped
3. list unscoped
4. sample leads counted
5. refresh clears dismissal
6. kernel live predicate dropped
7. zeros emitted
8. provenance dropped
9. empty org archived
10. no-zone request archived
11. failed kernel read reads as nothing
12. unreadable ignored by `empty`
13. any `tz` accepted
14. stalled-lead status filter dropped
15. a parked tool's words deleted

Local notes:
- The scratch Postgres cluster first ran in America/New_York. The kernel's `expires_at > now()` over a `timestamp without time zone` column then counted a just-expired ask. CI's and Fly's Postgres run in UTC; the runs above are on UTC. This is an existing property of the kernel predicate, not of this change.
- `npm run db:build-from-repo` fails one post-build check, `senses-on-built-schema` ("a tick recorded only in job_health_logs is the heartbeat"). It fails identically on clean main `f7f2e3f` (both were run here), so it predates this change.

## Gates (branch head, read from files)

Measured on this machine (2 cores, 7 GB plus swap), each verdict read from a file, never through a pipe.

| Gate | Result |
|---|---|
| `npm run check` | exit 0. `check:tests` 151 test type errors (baseline 151), 9259 files loaded; `table-count` 749 (baseline 749, +1 flagged); `schema-monolith-tables` 358 (unchanged); `internal-only-exports` 1226 (unchanged); `unregistered-routes` 4 (unchanged) |
| `npm run lint` | exit 0 (`--max-warnings 0`) |
| `npm run build` + `scripts/check-bundle-size.js` | exit 0. Total JS **9804 KB** (ceiling 9823 KB, untouched); largest chunk vendor-map 1068 KB (ceiling 1090 KB) |
| Full vitest (real DB enabled, as in CI's Test job) | See the PR body for the run at the PR head. Pre-fix run: 1613 files, 19788 tests: **19782 passed, 5 failed, 1 skipped**. Two of the failures were this change's (`requestSchemasNeverCarryServerFields` could not see a template-path route; the `routeManifest` snapshot needed the new file). Both are fixed. The other three (`forecastIsContractNotAssumption`, `noteRecordPanels`, `serverOwnedTimestampsStayServerOwned.realdb`) fail identically on clean main `f7f2e3f` here, and all pass on the branch under `TZ=UTC`. They depend on this box's America/New_York process time zone. |
| Governance suites (package §Tests 8) | `approvalKernel` 26/26; `paxAccountReadsAreOrgPinned` 16/16; `paxToolsPerformNoDeletion` 10/10; `crossTenantPathsClosed2026_09_04` 11/11; `promptInjectionResistance` 18/18; `paxControlsOffered` 20/20; `paxPauseCoverage` 59/59; `paxToolsReportRealEffects` 13/13; `todayBriefStatesCountsAsTheyAre` 11/11 |
| This leg's suites | `morningBriefSections.test.ts` 23/23; `morningBriefSections.realdb.test.ts` 7/7 |

## Staging proof: not yet run

Per the package's Rollout §3, done needs the brief observed on staging: it renders from staging state; dismiss, archive and reopen work; a cross-org id returns 404. That can only run after merge, which deploys staging only. Until then **no Atlas row claims this capability**. The proposed row, to fold once the staging proof lands:

> **Pax morning brief (in-app): three sections from real state, with provenance; dismiss, archive and reopen; org-scoped.** Evidence: this file, plus `docs/evidence/<date>/e2-slice1-pax-brief-staging.md` (pending). Not claimed: email brief (G12), stand-down gating (leg-5 decision), archive search (A3).

