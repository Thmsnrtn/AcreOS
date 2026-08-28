# AcreOS — the live frontier

**This is a FRONTIER, not a backlog.** It is recomputed from repository truth,
not worked through in order. Nothing here has to be finished before a
higher-value intervention discovered tomorrow. When an item stops being true,
it is edited out — not struck through and kept.

Read `docs/acreos-institution/DEVELOPMENT_INSTITUTION.md` first if you have not.

Branch: `claude/acreos-canonical-implementation-1asgvc`
Verified at: `b22475b6`, 2026-08-28. Working tree clean; **976 test files /
12,937 tests green**; `npm run check` green; production serves `b22475b6`
(deploy #7, probed twice at /api/version).

**Rule-1 tenancy register: adjudicated everywhere anything reaches it
(2026-08-27, ledgers 78-79).** 151 units across three waves (90 route, 11
job, 50 service-internal); one confirmed defect (`investInSecurity` — deleted,
route 501s, hard-gate test pins the refusal under opt-in) and one latent hole
closed at the write (`createJob` template ownership in the query). The 127
caller-less keys are reachability/deletion debt, kept in the register until
actually deleted.

**Route shadowing is CLOSED at zero (2026-08-27).** The shadowing program that
began with 34 shadowed routes ended with `scripts/ratchets/route-shadowing.json`
at `"baseline": 0` — it must stay 0. Winners were picked by evidence (client
callers, correct table, correct auth), never registration order, and four live
UI bugs fell out of the last batch alone: the A/B-test create button (two
engines collided; the UI's was the dead one), the feedback button (enum
rejected 4 of its 7 categories), the AI-memory admin panel (read the wrong
table), and lead bulk-delete (hard delete shadowing the soft-delete + audit
path). Residue: `unknownHandlerBaseline` 43, down-only.

**Run BOTH.** `npm run check` does not execute the suite — its `check:tests` step
is a TYPE ratchet over test files, not a test run. A commit went out on 2026-08-20
on the strength of a green 26/26 with three tests failing. `npx vitest run` and
`npm run check` are two separate obligations.

**Keep `main` current — standing founder directive (2026-08-28).** The founder:
"As you continue to work through your loops I want you to always maintain an up
to date main repo. Don't let this get tangled up like it has before and continue
your work." This is standing, informed authorization to fast-forward `main` after
each verified-green loop turn — informed because the founder watched this very
session's deploy pipeline end-to-end, including the outage. Operational meaning:
(1) a turn is not DONE until `npm run check` and the suite are green AND `main`
is fast-forwarded; (2) pushing `main` triggers the Fly deploy — WATCH it through
to the served SHA, never assume (this session's outage began as an unwatched
assumption); (3) never let the branch drift dozens of commits ahead again —
production was once 304 commits behind and nobody knew. If a deploy fails, fixing
it becomes the immediate frontier, before new work.

**Mirror CI's heap, don't just strip the ambient one (refined 2026-08-27).**
The first form of this rule said `env -u NODE_OPTIONS`. That is right for
`npm run check` (its heavy steps carry explicit ceilings) but WRONG for the
suite: a GitHub 16 GB runner gives Node a ~4096 MB default, while this
container's cgroup gives ~2096 MB — so a bare strip runs vitest's transform
pipeline (vite:esbuild, in-process) HARSHER than CI, and it OOM'd
timing-dependently at ~2043 MB, killing a different test file each run with
zero assertion failures. The faithful mirror is
`NODE_OPTIONS=--max-old-space-size=4096 npx vitest run` — CI's effective
default, inherited by every fork. The original point stands unchanged:
**Run them with `env -u NODE_OPTIONS`, or you are measuring the container.**
(2026-08-25.) This dev container exports an ambient
`NODE_OPTIONS=--max-old-space-size=8192`. `npm run check` was written as
`NODE_OPTIONS=…=6144 tsc … && npm run check:tests && …`, and in POSIX sh a
`VAR=x` prefix binds to ONE simple command — so the ceiling reached the first
tsc and nothing else. Locally the ambient 8192 covered the gap and the gate
exited 0; on CI, where nothing sets `NODE_OPTIONS`, `check:tests` ran at Node's
default (2,096 MB measured here) against a program needing ~5.1 GB and aborted
with **exit 134** on *every* `main` deploy from 2026-08-17. Steps 7 (vitest) and
8 (build) were SKIPPED behind it, so 140 commits reached `main` without their
tests or build ever running there.

Three things this cost, worth keeping:

1. **A local proof of a MEMORY property is worthless without stripping the
   environment.** X-4 in `EXTERNAL_PROOF_AND_OWNER_ACTIONS.md` was recorded as
   "LOCAL PROOF COMPLETE — It does NOT abort" on **2026-08-17**, the same day CI
   was aborting on that exact step. It has been corrected in place. This is the
   third law — *a gate proves its property only over the population it actually
   reads* — where the population was the ENVIRONMENT.
2. **The ceiling is now a value a child RECEIVES**, not one hoped to propagate:
   `scripts/lib/heap-ceiling.mjs` (`HEAP_CEILING_MB`, `withHeapCeiling`), passed
   at `check-tests-typecheck.mjs`'s and `lint-eslint-ratchet.mjs`'s spawn sites.
   Four workflow comments asserting the ceiling was global were false and are
   corrected. `testsAreTypeChecked.test.ts` guards it, driven — it strips
   `NODE_OPTIONS` and reads what the spawned child actually got. Falsified three
   ways (remove the `env:`, lower the ceiling, restore the old prefix); all three
   go red.
3. **The refusal was the only correct actor.** `check-tests-typecheck.mjs` saw
   status 134, refused to report a count, and said so. Had it interpreted the
   truncated run it would have reported ~1 error against a baseline of 162 and
   invited a baseline drop. Do NOT add 134 to `TSC_KNOWN_GOOD_EXIT`.

**Production currency is RESOLVED (2026-08-28).** The "production is 304
commits behind / partially-applied migrations" era ended with the recovery
program: seven watched deploys have landed since (through `b22475b6`,
deploy #7), each confirmed at the served SHA, migrations included (the
`varchar`→`uuid` FK fix `bbcd2c13` applied cleanly during the catch-up
deploy). The standing directive above keeps it resolved: every green turn
fast-forwards `main` and watches the deploy through.

---

## Where truth lives, in this order

1. **The repo at HEAD.** Everything below is a hypothesis until re-checked.
2. `CLAUDE.md` + `shared/governance/constitution.ts` — founder decisions.
3. `shared/architecture/canon.ts` — the machine-readable architecture: 7 layers,
   the 9-stage loop, 15 laws, 18 canonical objects, 12 fitness functions.
   `canonicalArchitecture.test.ts` proves every table it names exists and every
   enforcement ref resolves. Extend that registry; do not re-derive it.
4. `docs/acreos-institution/` — product, architecture, experience, data/AI/
   economics, proof, and current implementation state.
5. `docs/implementation/EXECUTION_LEDGER.md` — the long record of what landed.

---

## Current coherent work

### The competing-brains consolidation (surveyed 2026-08-28; the directive's centerpiece)

Three independent surveys mapped every "brain" against the incumbent
autopilot plane (`services/autopilot/` 88 modules + `services/solene/` 45).
**Eleven capability areas are duplicated 3-4 ways**: episodic memory (three
separate stores: `solene/memoryRetrieval` + `autopilot/memory`,
`companyMind`, `cognitiveMemoryV13`), decision execution (four planes:
`autopilot/act`+hands, `solene/dispatchRunner`,
`autonomousDecisionExecutor`, `sagaOrchestratorV12`/`reactiveOrchestrationV14`),
trust/authority (four lanes: `autopilot/domainAutonomy`+`witnessGrant`,
`companyAgents.trustScore`, `trustEnforcementV12`, `delegationTokensV11` —
the last two both reimplementing "time-bounded delegable authority"),
calibration, telemetry/heartbeat, narrative/briefing, incident/immune,
governance gates, forecasting, cost throttling, and override→learning.

**The wiring is uneven, and that decides the stages:**

- **Live through jobs** (consolidate, do NOT delete): `eventMeshV12`
  (10s drain, `runScheduledJobs.ts:4572`), `adaptiveStrategyV13` /
  `cognitiveMemoryV13` / `selfHealingMeshV13` / `reactiveOrchestrationV14`
  (all via `autonomyBootstrap`, job at `:5040`),
  `collaborationProtocolV13` (via `autonomyFinalMile`, job at `:4589`),
  `delegationTokensV11` (consulted by `executionEngine.ts:436`),
  `confidenceCascadeV14` (via `founderTodo`/`agentActionExecutors`),
  `companyMind` (sole consumer: `autonomousDecisionExecutor`, 30-min job),
  `companyAgents` (boot seeding `:1687`, nightly evolution `:1770`,
  briefing `:2174` — but self-declared LEGACY fork, roster disjoint from
  the canonical 13 codenames the live Solene tick dispatches;
  "no new consumers" per its own header).
- **Client-page-only**: v10's eight services (page
  `founder/scenarios.tsx` covers 7), v11's negotiations/attribution/
  delegations (`use-sovereign-dashboard.ts`, `founder/governance.tsx`),
  v12/v13/v14 reads in the sovereign dashboard (several fetch paths
  don't exist server-side; the hook documents the gap and degrades to
  empty deliberately).
- **Zero callers of any kind** (router-registered, nothing fetches):
  `ceoCognitiveModelV11`, `temporalKnowledgeDecayV11`,
  `agentResourceGovernorV11`, `decisionCausalityV11`,
  `predictiveOrchestrationV11`; plus `autonomyScoreV14` and
  `founderIntentV14` are router-only. Nothing schedules v10/v11 at all —
  their "decay cycles" and "monthly reports" never run unattended.

**Staged ladder (verify each claim at HEAD before acting; per-service
caller proof before any deletion; table drops are founder territory):**

1. **Record the plane.** The autopilot+solene plane is THE brain; the
   unique capabilities that live only there (DomainPack seam, ProofReceipt
   chain, gated self-patch, real dispatch runner) are the reasons.
   Everything else converges toward it or leaves.
2. **The zero-caller five (v11) + router-only v14 pair**: delete services
   and routes after re-proving zero callers; their ~10 tables go on the
   founder table-drop decision list (precedent: `agentOrchestration`,
   `negotiation_sessions`). Lowers the founder-route ratchet.
3. **The v10/v11 client surfaces**: decide per page whether the surface
   earns feeding from the incumbent plane or retires behind the four
   doors. This is a founder-legibility question, not a code question.
4. **The live-wired V13/V14 + eventMesh cluster**: real consolidation
   engineering — one memory store, one trust lane, one execution plane.
   Needs its own design pass; do not start it as a side effect.
5. **companyAgents/companyMind**: the kernel-restructure step 4 already
   names this; the roster shim (`agentCodenameAlias.ts`) is the seam.

**The Reality Graph is the unfinished layer.** 9 of 18 canonical objects have a
canonical home; the 9 that do not are almost all layer 2.

| status | objects |
|---|---|
| canonical (9) | organization, user, deal, evidence-claim, scenario, decision-snapshot, workflow-run, outcome, opportunity |
| conflated (3) | property, parcel, document — all inside the `properties` god table |
| role-table (5) | party, holding, instrument (layer 2) · plan, action-receipt (layer 6) |
| absent (1) | relationship (layer 2) |

Ratchet: `OBJECTS_WITHOUT_CANONICAL_HOME_BASELINE = 9`, down-only.

Two facts that shape the work and were verified rather than assumed:

- **Both layer-6 role-tables are FOUNDER-PLANE ONLY.** `plan_proposals` has no
  `organization_id` at all, and every `proofReceipt` reference sits under
  `autopilot/` or `governance/`. The customer side of `plan` and
  `action-receipt` is unbuilt, not merely blurred — so that work is a build, not
  a refactor, and it can proceed in parallel with layer 2.
  `canonicalArchitecture.test.ts` pins the tenancy claim in both directions.
- **Parcel identity is addressed at the KEY level, not the table level.**
  `shared/parcel/parcelRef.ts` is the one definition of "the same parcel" and
  every call site routes through it (adoption ratchet at 0). What remains is
  that cadastral identity is still welded to economic state on `properties`,
  with direct `sellerId`/`buyerId` FKs into `leads`.

Until identity separates from economics: assemblage (one Property spanning many
Parcels) is inexpressible, `relationship` cannot be modelled without duplicating
the FK mess, and multi-strategy evaluation of one physical asset is not
representable at the PROPERTY level — though `opportunities` now expresses it at
the parcel level.

Dependency order: `parcel_snapshots`-as-evidence → `relationship` (needs a real
first consumer) → party/holding/instrument → a thin parcel identity table, only
if still needed by then.

---

## Highest-value frontier candidates

Not a queue. Each is a live gap with its evidence; pick by value at the time.
Items 1–6 come from a whole-product reassessment on 2026-08-19 — six independent
lenses, then one owner ranking by consequence-over-effort with instructions to
spot-check and demolish. It demolished one finding and refused to endorse five it
had not verified; those are deliberately absent below.

1. ~~**Pax's skip-trace tool bypasses the FCRA permissible-purpose gate.**~~
   CLOSED as ledger 38. Two things the entry above understated. The registry's
   own declaration was WRONG, not merely unenforced — `batch_leads_skip_trace`
   was tagged `deal_read`, the weakest scope in the ladder, for an operation
   whose REST door requires `tenant_pii_write`; "enforce the declarations" alone
   would have changed nothing. And the reason nothing enforced them was
   structural: `appIntents/catalog.ts` imports `executeTool`, so `ai/tools.ts`
   could not import the catalog back — the declarations sat in a module the
   chokepoint could not reach. Now a type-only leaf both sides import.
   Pax refuses skip-trace outright rather than collecting purpose +
   justification + attestation, because the justification would be a
   model-authored sentence persisted as the operator's stated reason in a legal
   record.

2. ~~**`schedule_background_job` schedules nothing and reports `status: "queued"`.**~~
   CLOSED as ledger 39 — deleted, not wired. The survey around it is the part
   worth keeping: all 61 switch cases scanned for the shape (returns
   `success: true`, calls nothing that can have an effect) found exactly ONE
   offender, which is when a rule is cheap enough to install rather than after
   the second occurrence. `paxToolsReportRealEffects.test.ts` now holds it.

3. ~~**52 bare `gpt-4o`-style ids sent to an OpenRouter-only client.**~~ CLOSED
   as ledger 36 — and the count was wrong in the safe direction only by accident.
   The real figure was **59 literals across 31 files**: this entry's number came
   from a grep for `model: "gpt-4o"` with double quotes, and nine files use
   single quotes. A quote-biased grep is a sample presented as a census. The gate
   that replaced it (`lint:model-prefix`, `npm run check` step 26) matches on the
   KEY and accepts either quote. What remains from this item is the non-chat
   endpoint question, which is now item 12.

4. ~~**Buyer-qualification IDOR.**~~ CLOSED as ledger 40 — and the tenancy debt
   register already named it. `estimateClosingProbability` was in
   `check-org-scoped-fetch.mjs`'s BASELINE_UNUSED_ORG, so the fix was confirmed
   by the gate going stale on its own entry rather than by a test mock. The
   `propertyId` half was worse than this entry recorded: it came off the query
   string with no org check at all, so any authenticated user reached any
   property row. Register now 538.

5. ~~**`POST /api/clear-demo-data` has no permission gate.**~~ CLOSED as ledger
   40 — `requirePermission("canDeleteOrg")`, owner-only. The test pins the RULE
   over the real permission table (every role denied the unit delete is denied
   the bulk one), not the one route.

6. ~~**Settings → Account claims a GDPR export and deletion that never
   happened.**~~ CLOSED as ledger 41 on the client half — the surface now says
   "queued", downloads nothing, and does not sign the user out. Two things this
   entry did not have: the honest implementation already existed one page over
   (`pages/privacy-settings.tsx`), and the founder end was already honest too
   (the erasure fulfiller returns **501 NOT_IMPLEMENTED** by design). The
   operator UI was truthful about a capability the customer UI was claiming.
   **Still open, and deliberately not taken there:** the server promises "within
   24 hours" and nothing fulfils it. Softening that is a policy statement with
   legal weight (GDPR allows a month; AcreOS advertised a day) — founder/counsel,
   not engineering. The DUPLICATE-SURFACE half is CLOSED as ledger 48: it was
   never a nav question, it was two implementations of one control, and Settings
   now renders the canonical component rather than a copy of it.

7. ~~**A land-OWNED surface that decides.**~~ CLOSED as ledger 43. The
   blind-offer wizard now commits: it records a canonical decision and freezes
   the `land_deal` scenario behind it, with the two tiers not taken as real
   alternatives. Found on the way in: `maps.tsx` and `parcel-detail.tsx` had
   always linked in with `?propertyId=`, and the prefill contract did not carry
   it — the parcel identity crossed the link and landed nowhere, which is
   harmless for a calculator and fatal for a commit point.

8. ~~**`check-org-scoped-fetch.mjs` has no `--root`, so its canary still writes
   into the live tree.**~~ CLOSED as ledger 47. It was the last of three probe
   writers; with it moved to a fixture tree the repository no longer rewrites
   itself under a test run at all, and the `.gitignore` block that existed to
   catch abandoned probes is gone — replaced by a note saying that if you are
   about to add such a rule, add `--root` to the gate instead.

   Harder than the other two only because a fixture is a different KIND of tree
   and three things had to be told so: the vacuity floors (sized for 906 files,
   unmeetable by two), the staleness checks on five registers (every key names a
   real file, so all ~540 look stale at once against a fixture), and rule 3's
   own chain floor. Everything that ENFORCES runs identically, which is what
   keeps the canary meaningful — and a second fixture was added that must PASS,
   because a canary satisfied by "any tree fails" is a red that means nothing.

9. ~~**`lint-reachability` cannot see `shared/**`**~~ CLOSED 2026-08-23. The lens was widened and the newly-visible population frozen in FOUR PER-ROOT baselines rather than folded into the server ones (+54 into 390 would let a server regression hide inside a shared improvement); the server counts did not move. The decision the item asked for is recorded in the allowlist itself: a test-only canonical registry is the INTENDED shape for canon.ts / constitution.ts / statuteRegister.ts — they are indexes of enforcement, satisfying authoritative semantics and drift prevention while forgoing production adoption because there is nothing at runtime to adopt. The exemption names its own revocation condition. rmloAdvisor and sentinel-ids stayed COUNTED as real debt; rmloAdvisor has since been wired (ledger 77), leaving one.

9. *(Edited out 2026-08-28: a stale OPEN copy of the item the strikethrough
   above already records as CLOSED 2026-08-23 — the widening, the per-root
   baselines, and the test-only-registry decision are all verified present in
   `scripts/lint-reachability.mjs` at HEAD. The duplicate had survived one
   revision past its own closure.)*

10. ~~**The tenancy register's rule 1**~~ CLOSED 2026-08-21 (ledger 61). All 271 unique entries adjudicated — 142 deliberate cross-org, 62 parent-verified, 52 unreachable, 8 platform/self-inserted, 8 suspected. Five confirmed and fixed; a sixth (getRecurringTasksDue — any authenticated user could insert a task into EVERY other organization) was caught only because the refutation cap REPORTED its overflow instead of dropping it. Coverage verified by diffing keys sent against keys returned: zero unclassified.

10. **The tenancy register's two RISK rules are adjudicated in full; rule 1 and a
   gate blind spot remain.** Rule 2 (140 entries) and rule 3 (120) were both
   worked on 2026-08-20 — classifiers, two independent refuters per claim, then
   hand-verification of every survivor. **11 real cross-tenant defects, all
   fixed**; baselines rule-2 function-shape 78 → 73 and rule-3 127 → 115.

   | rule | entries | claims | confirmed |
   |---|---|---|---|
   | 2 (has an org, resolves by id anyway) | 140 | 42 | 6 |
   | 3 (scoped unit, unscoped query) | 120 | 5 | 5 |

   Rule 3's 5-for-5 versus rule 2's 6-of-42 is the calibration transferring: the
   rule-3 classifiers were given rule 2's lesson and returned 39
   DELIBERATE_CROSS_ORG, 17 SAFE_PARENT_VERIFIED, 12 NOT_REACHABLE and 7
   SAFE_SELF_INSERTED instead of guessing. Ledgers 49 and 51.

   **~40 OF THE 120 RULE-3 ENTRIES ARE THE GATE'S OWN BLIND SPOT, NOT DEBT.**
   The audit returned them as "already scoped — free reductions"; the gate
   reports 0 stale. Both are right, and acting on the report would have produced
   40 new offenders and a red gate. Those queries DO name the organization —
   built into a local `conditions` array and spread into
   `.where(and(...conditions))` — and the extractor only reads the text inside
   the `.where(` call, so it cannot follow the indirection. `leadRepo.getLeads`,
   `auditRepo.getAuditLogs`, `automationRepo.getNotifications` and
   `vaRepo.getVaActions` are all this shape.

   **DONE 2026-08-20 (ledger 52).** The extractor follows both indirections now —
   `...ident` spread into the chain, and `.where(ident)` — and the register fell
   115 → 72 with 0 new offenders. The restriction to those two shapes is the
   safety property, not a simplification: the mutation that resolves arbitrary
   identifiers makes an unscoped `conditions` array PASS, and a fixture pins
   that. The remaining 72 are the population worth reading.

   **Rule 1: the reachable population is DONE (2026-08-27, ledger 78).** All
   278 register keys were caller-censused; the 90 route-reachable + 11
   job-scheduled units were adjudicated in full against their calling code:
   45 deliberate cross-org (all founder-gated or platform tables), 40
   parent-verified, 5 name-collision phantoms, **1 confirmed defect —
   `investInSecurity`, deleted and replaced with a 501** (it added an
   unvalidated amount to another org's loan-performance column behind the
   dormant securities rails). `getPendingReminders` also got its org predicate
   moved into the WHERE (platform-wide limit was starving org lists).
   **The service-internal 50 are DONE too (2026-08-27, ledger 79):** chains
   walked to entry points, 0 suspects — 32 deliberate (founder-chat mount,
   platform jobs, the documented-global email-suppression list, shared parcel
   cache, Stripe-signature tenant resolution), 5 safe, 13 dead. One latent
   hole closed at the write: `createJob` now ownership-checks `templateId` in
   the query (`browserAutomationJobOwnership.test.ts`, falsified by disabling
   the guard). Rule 1 is adjudicated everywhere anything can reach it: 151
   units, one confirmed defect (`investInSecurity`, entry 78).
   **Remaining: 127 caller-less keys** — reachability/deletion debt, not
   tenancy risk; they stay in the register until actually deleted.

11. ~~**88 exports are certified "reached" by a COMMENT.**~~ CLOSED as ledger 45
    — and the triage that unblocked it is the part worth keeping. The item had
    sat unstarted because "88 must be adjudicated in one commit" reads as one
    indivisible cost. Reading all 86 revealed symbols rather than counting them
    showed **0** had an external reference the strip would miss, **20** were the
    accusation, and **66** were a DIFFERENT RULE — exported, then used only
    inside their own module. So the strip landed with a split:
    `internal-only-exports` is its own family with its own down-only baseline.
    Repo-wide the split moved 1,005 pre-existing findings, leaving
    unreachedExports 390 against internalOnlyExports 1188 — which is exactly why
    merging them made the real accusations unreadable. A second narrowing fell
    out of it: opacity exempts from the DEATH accusation only, so
    `internal-only` looks through it, reclaiming 97 of the 120 opaque exports.
    Blind spot now 23.

    What the 20 turned out to be is on the record in ledger 45; the one that
    generalises is that **nine had real behavioural tests and no production
    caller**. A green unit test is the strongest possible evidence that code
    WORKS and no evidence whatever that anything RUNS it.

12. ~~**The Pax model picker 422s on every option except Auto.**~~ CLOSED as
    ledger 37 / OD-7 — the picker is removed, not repaired. The two defects were
    each other's camouflage: six of the seven server-side enum ids were names no
    provider serves and the seventh is the cheapest model in the registry, so
    the ceiling bypass underneath was real and unreachable at once — and would
    have become reachable the moment someone made the enum match the picker,
    which is the obvious repair.

13. ~~**Four connector executors bypass the provider registry**~~ CLOSED 2026-08-23 (ledger, deletion 2026-08-23). Reading them changed the answer for three of four. PropStream was DELETED, not migrated: the repo held two mutually incompatible auth contracts for one vendor and the executor conceded it guessed the endpoint, so routing it through the registry would have bought governance for a guess. MLS was real RESO and was kept and fixed — get_mls_comps returned the SUBJECT PROPERTY (an exact-address filter) and now refuses; OData literals are escaped; the silent vendor-host fallback is gone.

13. *(Edited out 2026-08-28: a stale OPEN copy of the item the strikethrough
   above closes — verified at HEAD that PropStream's executors are deleted
   (doc-comment mentions only), `getMlsComps` refuses honestly, and
   `searchMlsListings` is the one live executor: org-BYO RESO, OData-escaped,
   no vendor-host fallback. Whether that one search-shaped caller should force
   a registry `LookupInput` widening is a decision the no-interface-before-a-
   second-consumer precedent answers NO for now; revisit when a second
   search-shaped consumer exists.)*

14. **Four non-chat OpenAI endpoints run on the OpenRouter-only client.**
    `openaiClient.ts`'s docblock forbids exactly this and names
    `routes-field-scout.ts` as the sanctioned pattern (read `OPENAI_API_KEY`
    directly). `voiceCallAI.ts:171` and `routes-ai.ts:1859` call
    `audio.transcriptions.create({ model: "whisper-1" })`;
    `adCreativeService.ts:243` calls `images.generate({ model: "dall-e-3" })`;
    `dealPatternCloning.ts:745` calls
    `embeddings.create({ model: "text-embedding-3-small" })`.
    Measured 2026-08-19: all four OpenRouter routes EXIST (401/400 unauthenticated,
    against a 404 control on `POST /api/v1/models`), so the docblock's premise is
    stale — but no whisper/dall-e/embedding id appears in the 415-model
    catalogue, and what those endpoints accept cannot be enumerated without a
    key. Both rewrites are guesses. Registered in `check-model-prefix.mjs` with
    the measurement and its limit. **Needs one provider key to settle**, then it
    is a small fix.

15. ~~**`routes-ai.ts` keeps a SECOND cost table and prices unknown models as the
    most expensive one.**~~ CLOSED as ledger 42, and it was worse than this
    entry recorded: beneath the stale table sat `AVG_TOKENS_PER_CALL = 1000`,
    which priced calls carrying NO evidence at all and added the result to the
    customer's "what you paid". Now a pure `summariseCostSavings` that refuses
    to price what it cannot, and reports `unpricedCalls` so the gap is visible
    rather than filled.

16. **Per-org AI cost governance EXISTS and this entry described it wrongly for
    two revisions.** Kept, corrected, because the correction is the useful part.

    The entry said `assertAiSpendAllowed` "resolves to `assertWithinAiCostCeiling`,
    which is ONE global daily counter for the whole platform" and that there is
    "no per-ORG cap on this path". Read at HEAD 2026-08-20: `assertWithinAiCostCeiling`
    runs the platform envelope FIRST and then a per-org **daily and monthly**
    ceiling — tier-proportional defaults (`free` $2/day, `pro` $50/day),
    founder overrides in `ai_cost_ceiling_overrides`, a 10-minute
    last-known-good spend cache so a telemetry hiccup enforces against recent
    truth, and a fail-CLOSED posture for autonomous callers. Building the
    per-org cap this entry asked for would have been building it twice.

    A frontier entry is a hypothesis. This is the second time that has bitten
    (ledger 44 was the first), and both times the entry read as a note rather
    than a claim.

    **What was actually wrong there, found by reading it:** `DEFAULT_RATE` —
    the price the ceiling applies to a model id it does not recognise — was
    hand-set BELOW most of the table, so the gate under-counted the spend it
    exists to bound. Closed as ledger 46; see "Recent verified changes".

    **What remains genuinely open, and it is small:** there is no per-USER cap
    (`userAiCostControls` was deleted in ledger 35 as unwired and fail-open), so
    one member of a multi-seat org can consume the whole org allowance. That is
    an intra-tenant fairness question, not a platform-risk one, and it should
    wait for a real customer with real seats to say whether it matters.

17. **Two modules the gate could not see until 2026-08-20, each owed a different
    decision.** Revealed by ledger 45's comment strip; `moduleOrphans` was raised
    28 → 30 to hold them in view rather than allowlisted, because an allowlist
    entry that means "TODO" is the gate laundering its own findings. They are not
    one item and must not be batched.

    - **`server/services/lateFees/index.ts` — WIRE, do not delete.** A correct
      12 C.F.R. §1026.36(c)(2) non-pyramiding late-fee assessor with a pure
      algorithm (`shouldAssessLateFee`), a DB writer (`assessLateFee`), a unique
      index enforcing one fee per cycle, and two test files beside it. Zero
      production callers. It is the ORIGINAL worked example in the reachability
      gate's own description, still sitting there. The live path,
      `jobs/acquiredNoteAging.ts` (registered, daily), computes a `lateFeeAdvisory`
      and its header states it "touches no ledger, and moves nothing" — advisory
      BY DESIGN. So the wiring is not a gate fix: turning an advisory into a
      ledger-writing fee assessment is a product ruling with money attached, and
      the founder's call. Frame it that way when raising it, with the reg cite.
    - **`server/services/agentOrchestration.ts` — 1,317 lines, zero importers,
      zero tests, DELETE probably right, cascade real.** Session/step/event
      orchestration superseded by the live autopilot, solene and Pax surfaces.
      It is the EXCLUSIVE toucher of `agentSessions` and `agentSessionSteps`
      (everything else it imports — `agentEvents`, `outcomeTelemetry`,
      `agentTasks`, `eventSubscriptions` — has other live readers). Deleting the
      code alone makes two tables writerless AND readerless, raising two other
      ratchets; the honest version includes a DROP migration, and dropping tables
      whose contents nobody has inspected is founder territory under the
      customer-data hard stop. Precedent for the shape is already in the
      allowlist: `negotiation_sessions` is retained, un-baselined and visible for
      exactly this reason.

18. **Prose in a STRING LITERAL is still prose, and the identifier pass still
    reads it.** Ledger 45 stopped `lint-reachability` counting a symbol named in
    a COMMENT as a call site. The same concealment survives one representation
    over, and there is a verified worked example — the same symbol, in the same
    registry entry, as the case that motivated the comment fix:

    `shared/governance/constitution.ts`'s hard-stop entry names
    `spendIsAutonomous()` three times inside a `note:` STRING. That symbol has
    exactly ONE occurrence in its own module (its declaration) and no production
    caller anywhere; it is exported so `spendHardStop.test.ts` can pin the $500
    autonomous-spend hard stop, which is a deliberate and documented seam. The
    gate calls it REACHED today, on the strength of three sentences about it.
    `financialAuthorityGate.ts`'s own docblock records the whole history and has
    been corrected to say the concealment survived its own fix.

    **Do not attempt this with a regex.** Measured and thrown away on 2026-08-20:
    a three-line strip of `"…"` / `'…'` / `` `…` `` produced unreached 390 → 1526
    and internal-only 1188 → 593, which is not a finding, it is the stripper
    tripping on the first apostrophe inside a double-quoted sentence and
    swallowing code to the next one. The population is UNMEASURED. Closing this
    needs a real tokeniser (or TypeScript's own scanner), and the adjudication is
    then the same all-at-once cost the comment strip had — with one difference
    that makes it harder: some string references are GENUINE, since a
    string-keyed registry or a computed `m[name]` really does reach a symbol, so
    this direction produces false accusations where the comment strip produced
    none. Read the population before landing it, exactly as ledger 45 did.

---

## Recent verified changes

Most recent first. Each was falsified against the semantic defect before landing.
Full reasoning in the cross-pollination ledger, entries 23–52.

- **a third of a security list was the gate's own blind spot** — rule 3 reads the
  text between `.from(table)` and the `;`, and this repo's commonest idiom builds
  the org predicate in a local array spread in later. 43 of 115 baselined entries
  were correctly-scoped code reported as offenders. The extractor now follows
  that indirection, restricted to the two shapes that unambiguously mean "this
  variable IS the predicate" — the mutation that resolves arbitrary identifiers
  instead makes the gate go BLIND, which is why the restriction is the fix.
  Baseline 115 → 72. Ledger 52.
- **Pax could tell one customer about another** — a support-agent tool ran an
  unscoped `LIKE` over every tenant's tickets, on a pattern the MODEL composes
  from the user's own message, and returned other orgs' ids to the user. The
  route above it guards the ticket; the agent went around it one layer down. Its
  neighbour had already been patched to reject foreign org ids — this is where
  the model got them. Scoping it also made a "System-wide issue detected" claim
  uncomputable, so that arithmetic was rewritten rather than left to lie.
  Ledger 51.
- **the column that recorded which strategy shaped a decision always said
  "none"** — all four canonical `recordDecision` call sites are vertical
  surfaces, and all four wrote `strategyPackId: null`, which the type's own
  docblock defines as "no pack applied". Discarding provenance you hold is the
  mirror of inventing provenance you do not. Closed WITHOUT a second taxonomy: a
  strategy pack IS a business type, so `StrategyPackId` is an alias of
  `BusinessTypeId` and an invented id is now a compile error. Version stays null
  — no versioned artifact exists. Ledger 50.
- **seven live cross-tenant paths, found by working the register instead of
  admiring it** — the rule-2 population (140 entries) adjudicated in full: 42
  claims, 35 refuted, 6 real defects fixed. Any authenticated user could read
  another org's lead and its seller-negotiation messages; every tenant's
  calibration report was computed over every tenant's data; two writes
  re-pointed another org's outbound sender identity. The register's own header
  named two worked examples and both were wrong. Ledger 49.
- **one GDPR control, not two** — Settings carried a 257-line near-copy of the
  privacy surface, on the same two endpoints; it was the copy that lied, and the
  test written to hold the two in sync was titled "both privacy surfaces agree,
  in source" and passed throughout. The copy is gone (three lines rendering the
  canonical component) and the test now asserts a property instead of a chore.
  Deduplication exposed three live divergences no source-agreement check looked
  at: different test ids, different transports, different status shapes. Ledger 48.
- **the repository no longer rewrites itself under a test run** — the last of
  three gate self-tests that wrote a probe into `server/services/` and deleted
  it now builds a throwaway tree, so an unrelated suite walking `server/**` can
  no longer die on a file that vanished mid-walk. The `.gitignore` block for
  abandoned probes is gone. Ledger 47.
- **the unknown model was the cheapest thing in the ledger** — `DEFAULT_RATE`,
  the price applied to a model id nothing recognises, was hand-set BELOW ten of
  the table's rows, so the org AI cost ceiling under-counted the spend it exists
  to bound by up to 8×. It had already survived one fix: the router's docblock
  names `{input:1,output:3}` as the defect it replaced with "the central
  conservative DEFAULT_RATE", and that constant WAS `{input:1,output:3}`. Now
  derived from the table's dearest row, so there is no number left to set below
  it. Ledger 46.
- **the accusing scan was the one still reading prose** — `lint-reachability`'s
  identifier pass counted a symbol NAMED in a comment as a call site. Landing the
  strip meant reading all 86 revealed symbols, which showed 66 of them were a
  different rule; `internal-only-exports` is now its own family, and the blind
  spot fell 120 → 23. Nine of the twenty real accusations have passing unit tests
  and no production caller. Ledger 45.
- **two skip-trace paths, one governed** — the ungoverned one (bare `fetch`, no
  cache, no breaker, no license flag on a non-redistributable feed) was the one
  Pax could reach. Deleted; and the frontier claim that described it was itself
  partly wrong, which is recorded. Ledger 44.
- **land can decide, not only calculate** — the blind-offer wizard commits a
  canonical decision with its scenario frozen behind it; land was the only
  strategy that could produce a number and never a decision. Ledger 43.
- **"conservative estimate" is still a number nobody spent** — the AI
  cost-savings card priced evidence-free calls at an assumed 1,000 tokens on an
  assumed model, and kept a second cost table with ids no provider serves.
  Ledger 42.
- **the client said deleted, the server said queued** — the privacy surface
  downloaded a 202 receipt as the user's data export and announced a deletion
  that nothing performs. Ledger 41.
- **the guard did not match the authority** — a buyer-profile IDOR the tenancy
  register already named, and a whole-workspace wipe any member could call.
  Ledger 40.
- **`status: "queued"`, nothing queued** — the one Pax tool of 61 that reported
  an effect it never had, deleted; the shape is now scanned for. Ledger 39.
- **two doors on one operation** — skip-trace's REST door required a PII scope,
  a purpose, a justification and an FCRA attestation; its Pax door required
  nothing, and the registry that declared a scope for all ~60 intents was read
  by nothing on that path. Ledger 38.
- **the tier ceiling is the ceiling** — a customer-settable `modelOverride` sat
  ahead of the paid-tier ceiling and its soft-cap downgrade, on a picker that
  422'd on every option. Removed rather than repaired. Ledger 37 / OD-7.
- **the client's name was not its provider** — `getOpenAIClient()` returns an
  OpenRouter client, and 59 literals across 31 files sent it OpenAI's bare ids,
  which 404. Three services decide their provider from a secret at runtime, so
  their id now follows the client. Ledger 36.
- **the gate was reading comments** — `lint-reachability` scanned raw source, so
  a specifier inside a comment granted its two strongest exemptions. Three
  services whose own docblocks showed a usage example were reading as
  self-imported; nothing loaded any of them. Ledger 35.
- **model ids** — the cheap tier was pinned to models that do not exist. All
  three Anthropic ids and the reasoner used naming the catalogue does not use
  (hyphenated versions, a dated slug); the only guard checked that a PRICE row
  existed. Ledger 34.
- **absence in forecasts** — the cash-flow forecast omitted carrying costs it
  could not price; the due-diligence report printed a page of $0 projections.
  Ledger 33.
- **land closes its loop** — the offer-letter batch records a canonical decision,
  and the vertical readiness ratchet was deliberately NOT moved to say so.
  Ledger 32.
- **offer pricing** — a lead with no assessed value got a $0 offer letter, and
  the offer PDF derived a price from assessed value or printed $0.00. Ledger 31.
- **land economics** — two implementations of land-deal economics, the canonical
  one unreached; ROI computed on purchase price rather than total cost.
  Ledger 30.
- **executor receipts** — five of 28 company-agent executors reported effects
  they never had, two of them inventing counts. Ledger 28–29.
- **the unknown resolves toward caution** — the autonomy classifier's residue
  resolved downward; four more places read omission as permission. Ledger 24–27.
- **posture-gate exemptions** — textual prefixes, not path prefixes. Ledger 23.

---

## Blocked — owner

`docs/autonomous/OWNER_DECISIONS_PENDING.md`. **Two open. OD-9** (2026-08-20)
asks whether the tracking-number pool is shared across tenants — the conservative
reading is already implemented, so it asks whether to REVERSE, not whether to
act; the shared version would need an active-assignment exclusion, an
inbound-attribution rule, and an answer on whose BYO carrier account pays.
**OD-8** (same day) —
does AcreOS ASSESS late fees or only advise on them? A complete, tested
§1026.36(c)(2) non-pyramiding assessor has never had a caller, while the live
daily job computes the advisory and says in its own header that it "touches no
ledger, and moves nothing". Recommendation is a default-OFF per-org opt-in.
Nothing is blocked on it. The other seven are made: OD-2/3/4/5 implemented, OD-1
a live hold (0236 stays unregistered), OD-6 needed no code and names Customer #1
as the trigger to revisit, OD-7 raised and closed on 2026-08-19 — the owner
returned it to the session to decide, and the reasoning is recorded rather than
assumed.

Two items are recorded there awaiting a ruling rather than blocking work:
`scoreCountyForTargeting` (sellerMotivationEngine.ts:703) and the five
`campaignEnhancements.ts` exports.

## Blocked — external

Everything here needs evidence or an account that does not exist inside this
repository. None of it is engineering work waiting to be done; each is a fact
AcreOS does not have.

1. **E-sign validation — a DocuSign account, and per-org connected accounts.**
   Availability stays `planned`; the connect route refuses before encrypting a
   customer's key. Owner decision 2026-08-24 defers the setup until Customer #1
   or production proof needs it. When that arrives, the minimum external setup
   splits in two and the split is the whole point: the AcreOS-owned OAuth /
   integration registration (one-time, ours) versus each customer organization's
   own connected DocuSign account and signing identity (theirs, per org). The
   ceremony and signer authentication stay on their rail — that is the
   orchestrate-not-provider boundary, not an implementation detail.

2. **Usury — authoritative jurisdiction evidence for 28 of 51 jurisdictions.**
   AcreOS's three tables disagree there, and `usuryConsensus` now refuses rather
   than guessing (ledger 77). Resolving it is legal research against actual
   statutes, per state, with effective dates. Owner decision 2026-08-24 is
   explicit that this is external legal proof debt and must not be settled by
   preferring one internal implementation.

3. **The canonical usury source.** Blocked behind (2). It must be single,
   versioned, source-backed and jurisdiction/effective-date aware; the duplicate
   is retired only after the underlying legal evidence is verified. Neither
   `usuryCeiling.ts` nor `usury.ts` inherits authority from current usage.

4. **The three transaction-fee tables — production state.** `fee_audit_log`,
   `fee_payout_schedules`, `transaction_fee_settlements` are registered deletion
   candidates. The precondition AcreOS can satisfy locally is satisfied and
   written down: no reachable consumer anywhere in `server/`. The two it cannot
   are whether they carry a required historical/migration purpose and whether
   they hold live production rows. Unknown production state means KEEP.

5. **One provider key**, to settle whether the four non-chat OpenAI endpoints
   (whisper, dall-e, embeddings) work through the OpenRouter client. Both
   candidate rewrites are guesses without it; the measurement and its limit are
   recorded in `check-model-prefix.mjs`.

6. **Production database access**, which (4) needs and which would also settle
   whether the 19 registered ORM-unmodelled tables hold data.

## Proof debt

- `lint-reachability` scan roots exclude `shared/**` (see frontier candidate 8).
- The measurement-defaults register still holds its baseline; the largest
  remaining family is LLM-parse confidence (`parsed.confidence || 50`), which is
  also the lowest individual consequence.
- `scripts/no-fabrication.allowlist.json` is keyed on `file:line`, and it broke
  TWICE on 2026-08-19 from edits that had nothing to do with it (a 9-line
  comment inserted above two `makeSeededRng(` sites; a client edit that shifted
  one `Math.random` by one line). Each time the fix is mechanical renumbering,
  which is exactly the habit that lets a genuinely new fabrication slide into a
  vacated slot — the gate checks the TOKEN at the line matches, so the damage is
  bounded, but the category and the note are not re-read. Keying on the enclosing
  symbol, or on a hash of the matched expression, would survive line shifts. 57
  entries, so it is a real but bounded migration.
- A deliberate NEGATIVE result, recorded so it is not re-litigated: the
  fail-open catch class was surveyed (524 empty catches, 133 in gate context)
  and is handled correctly almost everywhere. No gate was built — a register of
  133 mostly-correct sites would freeze noise. Individual instances are fixed as
  found, which is how ledger 27 happened.

---

## Next session starts here

**READ THIS FIRST — the state at the close of the 2026-08-24 goal.**

The frontier is thin, and that is a finding rather than a mood. Rules 1, 2 and 3
of the tenancy register are adjudicated to completion (544 entries), and so is
the route population the gate had never read (64 more). The ghost-field class has
a gate covering both cast forms, and 42 of its original 100 are closed. The
release path has been RUN, not read.

**What is left locally is real but marginal**, and it is worth naming precisely
so the next session does not mistake volume for value:

  - The ghost-field backlog stands at 58. The last lens-widening returned ONE
    ghost in 27 judgeable reads, and roughly half of everything closed so far
    turned out to be a contract that was simply never written down rather than a
    fabrication. Grinding the tail is honest work with a poor yield.
  - `shared/constitution/sentinel-ids.ts` is the last shared module orphan: 54
    lines, zero references anywhere, built for "future safety gates" never
    written.
  - Assorted type hygiene in ones and twos.

**Do not manufacture work here to avoid the external boundary.** Six items in
"Blocked — external" above need evidence or an account that does not exist in
this repository. That list is the honest frontier; the local tail is not a
substitute for it.

If you do pick up local work, the highest-yield lens by a wide margin has been
RUNNING things: a real Postgres found a one-directional mirror gate, an endpoint
that had never once executed, and — twice — a bug of mine that static reading had
just endorsed.

**Stand up a local PostgreSQL first if the work touches schema, migrations, or
the release path.** Every material finding in the 2026-08-17/18 rebuild work came
from standing one up and RUNNING the release command, not from reading it. The
static gates were green over all four defects it found.

```bash
apt-get install -y postgresql-16-pgvector
useradd -m pgtest
su pgtest -c "initdb -D /home/pgtest/pgdata -U postgres --auth=trust"
su pgtest -c "pg_ctl -D /home/pgtest/pgdata -o '-p 55432 -k /tmp' -l /tmp/pg.log start"
# rebuild procedure: docs/reliability/dr-runbook-postgres-restore.md
```

Otherwise: ORIENT on this file and `docs/acreos-institution/IMPLEMENTATION_STATE.md`,
VERIFY the frontier candidates above still hold at HEAD, and pick by value.

Historical phase write-ups from the 2026-08 campaign are archived at
`docs/archive/autonomous/CAMPAIGN_PHASES_2026-08.md`. They are evidence, not
context — read one when you need the reasoning behind a specific change.
