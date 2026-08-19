# ACREOS AUTONOMOUS CAMPAIGN STATE

**Operational file. Kept short on purpose — git history is the diary and
`docs/implementation/EXECUTION_LEDGER.md` is the long record. Do not turn this
into a novel.**

Branch: `claude/acreos-canonical-implementation-1asgvc`
Restarted from `origin/main` after PR #279 merged (main `4b6b9557`).

---

## Where truth lives (read in this order)

1. The repo at HEAD.
2. `CLAUDE.md` + `shared/governance/constitution.ts` — founder decisions.
3. `shared/architecture/canon.ts` — the machine-readable architecture: 7 layers,
   the 9-stage loop, 15 laws, 18 canonical objects, 12 fitness functions. It is
   verified by `tests/unit/canonicalArchitecture.test.ts`, which proves every
   table it names exists and every enforcement ref is a real file.
4. `docs/implementation/NEXT_UP.md` — narrative frontier.
5. `docs/implementation/EXECUTION_LEDGER.md` — what landed and what proves it.

The autonomous directive's seven layers and canonical loop are ALREADY encoded
in canon.ts. Do not re-derive them; extend that registry.

---

## CURRENT FRONTIER

**The Reality Graph is the unfinished layer.** 9 of 18 canonical objects are
canonical; the 9 that are not are almost all layer 2:

| status | objects |
|---|---|
| canonical (9) | organization, user, deal, evidence-claim, scenario, decision-snapshot, workflow-run, outcome, **opportunity** |
| conflated (3) | property, parcel, document — all inside the `properties` god table |
| role-table (5) | party, holding, instrument (layer 2) · plan, action-receipt (layer 6) |
| absent (1) | relationship (layer 2) |

Ratchet: `OBJECTS_WITHOUT_CANONICAL_HOME_BASELINE = 9`, down-only.

**Both layer-6 role-tables are FOUNDER-PLANE ONLY — verified, not assumed.**
`plan_proposals` has no `organization_id` at all (agent_role, dispatch ids, cost
estimate: the Solene orchestration plane), and every `proofReceipt` reference is
under `autopilot/` or `governance/`, with `actions/outwardAction.ts` explicitly
disclaiming being a receipt. So the CUSTOMER side of both objects is unbuilt,
not merely blurred. `canonicalArchitecture.test.ts` pins the tenancy claim in
both directions so the gap text cannot rot.

**Parcel identity is now addressed at the KEY level, not the table level.**
`shared/parcel/parcelRef.ts` is the one definition of "the same parcel" and
every call site routes through it (adoption ratchet at 0). What remains is that
cadastral identity is still welded to economic state on `properties`, with
direct `sellerId`/`buyerId` FKs into `leads`. Until identity separates from
economics:

- one Property spanning many Parcels is inexpressible (assemblage);
- `relationship` cannot be modelled without duplicating the FK mess;
- multi-strategy evaluation of the same physical asset is not representable at
  the PROPERTY level — though `opportunities` now expresses it at the parcel
  level, which is what BI93 actually asked for.

---

## READY WORK (unblocked, dependency-ordered)

See "NEXT SESSION START HERE" below for the current package and what is already
done. In short: `parcel_snapshots`-as-evidence, then `relationship` (needs a real
first consumer), then party/holding/instrument, then — only if still needed — a
thin parcel identity table. Layer 6 (`plan`, `action-receipt`) is independent and
can proceed in parallel; note both are FOUNDER-PLANE ONLY today, so that work is
a build, not a refactor.

## BLOCKED — OWNER
See `OWNER_DECISIONS_PENDING.md`.

## BLOCKED — EXTERNAL
See `EXTERNAL_PROOF_AND_OWNER_ACTIONS.md`.

## PROOF DEBT
- `lint-reachability` scans `server/services/**` and `server/jobs/**` for
  exported symbols — **`shared/**` is not scanned at all**. A new shared module
  with no production caller is therefore invisible to the "built but unwired"
  gate (directive §33). Measured 2026-08-17 while adding
  `shared/parcel/parcelRef.ts`: the gate stayed at baseline 1401 with six new
  unadopted exports in the tree. Adoption there has to be checked by hand until
  the scan roots widen — and widening them will re-seed the count upward.
- ~~Full-project `tsc --noEmit` cannot complete in this container~~ —
  **RESOLVED 2026-08-17.** It completes under `npm run check`
  (`--max-old-space-size=6144`, `--incremental false`) and found a real error
  that had been hiding: `dueDiligence.ts` returned a `dataSource` value outside
  its own union, shipped in `26517723` while tsc was OOMing. Run the full gate,
  do not assume it will abort.
- ~~335 `async function` bodies invisible to the tenancy gate~~ — **RESOLVED
  2026-08-17** (OD-3 approved). `findBodyBrace` is wired into BOTH extractors;
  the gate reads every declaration and prints its own coverage on every run
  (`declarations whose body could not be located: 0`). Registers re-seeded once,
  hand-verified, down-only again: 171→196, 59→69, 114→130, 67→84.
  **The 58 newly-visible units are frozen DEBT, not fixed code** — the rule-2
  entries first, since each is a live path where a caller-supplied id can reach
  another tenant's row (`campaignOptimizer.optimizeCampaign` UPDATEs `campaigns`
  by primary key alone with the org right there on the object).

## NEXT SESSION START HERE

**A local PostgreSQL is the single highest-leverage tool available here, and it
is not in the container by default.** Every material finding below came from
standing one up and RUNNING the release command, not from reading it. Do this
first:

```bash
apt-get install -y postgresql-16-pgvector
useradd -m pgtest
su pgtest -c "initdb -D /home/pgtest/pgdata -U postgres --auth=trust"
su pgtest -c "pg_ctl -D /home/pgtest/pgdata -o '-p 55432 -k /tmp' -l /tmp/pg.log start"
# rebuild procedure: docs/reliability/dr-runbook-postgres-restore.md
```

The static gates were green over all four defects below. Executing was what
found them.

### LANDED 2026-08-17 (later session)

1. **The database can be rebuilt from this repository.** Mirror-gate gaps
   **83 → 0**, and `schemaMigrationDrift.test.ts`'s independent baseline
   **83 → 0** as well. Proved by rebuilding a real PostgreSQL 16 and diffing the
   live table list against the schema: 746 of 746. The 83 existed in prod only
   via a hand-run `drizzle-kit push`; their DDL was GENERATED from the Drizzle
   definitions (`scripts/generate-schema-ddl.ts`), never transcribed.
   **Two passes are required** — the dependency graph is genuinely circular.
2. **The deploy could not tell an empty database from a healthy one.**
   `migrate.mjs` exited **0** having created 193 of 747 tables with no
   `organizations`. Every statement's dependency was missing, so every failure
   classified as "expected". It now refuses when foundational tables are absent
   — which also gives the DR runbook's restore check (step 5, `--dry-run`) teeth
   it never had.
3. **Seven unimplementable foreign keys** (varchar → uuid), making seven tables
   uncreatable on any database while 54+ server call sites referenced them.
   `migrateForeignKeyTypes.test.ts` now proves every FK is implementable.
4. **No organization could be deleted, ever.** `earnest_money_events` was made
   append-only with rewrite RULES; a rule rewrites Postgres's OWN foreign-key
   check queries, so `DELETE FROM organizations` aborted **for an org with zero
   escrow rows**. That statement is the GDPR erasure path
   (`orgDeletion.ts:122`). Replaced with a trigger; verified working.
5. **`evidence_claims` had zero constraints** behind an "APPEND-ONLY BY
   CONTRACT" docstring (0238), and **three source files were binary to
   ripgrep** — including `shared/evidence/claim.ts`, so the file defining the
   Evidence Fabric's laws was invisible to every repo-wide search.
6. **Vertical maturity is now a projection of evidence** (`readiness.ts`).
   13 of 15 overclaim, frozen and down-only. The shape is the finding: every
   vertical HAS a surface; thirteen stop before a recorded decision. **The gap
   is the loop, not the surface.**
7. **`FOUNDRY_ACREOS_CROSS_POLLINATION.md`** — 3 dispositioned, 5 open.

**THE OWNER-DECISION QUEUE IS EMPTY.** All six are decided; OD-2/3/4/5 are also
implemented. OD-1 is a live hold (0236 stays unregistered). OD-6 needed no code
— 0239 already behaves that way — and names Customer #1 as the trigger to
revisit.

What OD-4 and OD-5 turned out to be, since both were larger than the queue said:

* **OD-4** was not a stale constant reading nothing. `saveReport` INSERTs with
  the id, so the write failed its foreign key on every weekly run while the
  catch logged it at INFO with the error discarded — meaning
  `GET /api/admin/index-analysis` answered "No analysis run yet" indefinitely
  while the job computed a report and threw it away. Repointed; the catch is
  now a WARN carrying the error.
* **OD-5** landed as `shared/business-types/publicClaims.ts` — 13 dated
  demotions, one channel for every public surface. The landing now renders 2
  core chips and 12 Beta. `GET /api/trust/verticals` was retired (zero callers;
  its own comment named a consumer that never called it). The public-claim
  assertion is a **hard zero, not a ratchet**: the registry ratchet stays at 13
  because `maturity` still says `core` deliberately, but nothing published to
  strangers may outrun the evidence, and it fails in both directions.

### THE OD-4/5/6 WORK WAS AUDITED, AND THE AUDIT WAS RIGHT

An independent adversarial pass over `833726a8` raised 31 findings; **24
survived refutation**, and the worst were in the new work, not the old:

* **The gate I wrote was keyed on a NAME.** It asserted indexAnalyzer no longer
  declares `PLATFORM_ORG_ID`. The audit reintroduced the defect by writing the
  literal `0` into all four queries and the test stayed green. It now asserts
  the VALUE — `organizationId` in that file may not be a numeric literal.
  **Third time this session I made this mistake** (trigger name, exemption
  substring, this). If you write a gate, mutate the thing it guards, not the
  thing it mentions.
* **The OD-5 enforcement scanned no public surface.** It mapped over the
  registry and called `publicMaturityOf` itself, proving the map coherent and
  nothing about what any surface renders — while two comments I wrote promised
  it would catch exactly that. It now scans landing/marketing/public routes for
  a direct `.maturity` read. `publicMaturityOf()` also had **zero production
  call sites**: the landing re-implemented its one-line body inline.
* **Three more org-0 defects.** Two founder-push jobs called
  `sendPushToUser(0, …)` (one as `0 as any`); subscriptions are stored under
  the subscriber's real org, so the founder has never received one of those
  notifications, and `{sent:0,failed:0}` read as success. Two services still
  declared private `SYSTEM_ORG_ID = 1` that a five-file allowlist never scanned.
* **A three-way customer-facing contradiction.** Onboarding called
  `fix_and_flip` "(waitlist)" running on land data, three weeks after the
  registry recorded that fixed and promoted it to `core`, while /pricing sold
  its pack at $150/mo and the landing called it fully supported.
* **The Beta badge failed WCAG AA** at 3.96:1 — in the only theme the landing
  has. Invisible until OD-5, because the beta tier had been empty; the
  demotions put a failing 10px label on the public landing twelve times.

All fixed and mutation-tested. **Run an audit like this after any wave** — it
cost ~3M subagent tokens and found defects that eight gates and 12,000 tests
did not.

**Left undone, deliberately:** `BusinessTypeMeta.shortDescription` and
`.integrations` lost their last readers when `/api/trust/verticals` was retired.
They are deletion candidates, but they are human-authored product copy rather
than dead code, so the call belongs with the deletion ledger, not a tidy-up.

### WHAT TO DO NEXT

1. **43 migration files still fail on a clean first pass** (17 on the second).
   Most are ordering: `migrations/*.sql` ALTERs tables that only `migrate.mjs`
   creates. The rebuild SUCCEEDS regardless because every statement is
   idempotent, but the two-pass requirement is a workaround, not a fix. Making
   one pass sufficient is the real close-out.
2. **Run the two remaining static gates against a live DB.** `migrate.mjs
   --dry-run` now has a preflight; a restore drill (runbook step 5) would be the
   first end-to-end proof of the DR path itself.
3. Continue the forensic priority order — **inert sovereign architecture
   (delete)** and **email idempotency (0 of 67 call sites)** are the
   next-largest.

**CORRECTION — the `vaService` finding was WRONG, do not act on it.** The
audit recorded "`vaService` = 0 Pax guards vs `executive.ts` = 20,
customer-reachable from 4 handlers." That counted REFERENCES and read them as
COVERAGE. Checked site by site:

| file | tool-result sites | guarded |
|---|---|---|
| `executive.ts` | 4 | 4 |
| `vaService.ts` | 1 | 1 |
| `supportAgent.ts` | 1 | 1 |
| `paxSupportResolver.ts` | 3 | 1 + 2 constant literals (`{success:true}`) |
| `routes-founder-chat.ts` | 2 | 2 (via `wrapUntrustedFields`) |

`vaService` has fewer references because it has ONE tool-call site, and that
site is enveloped; it also carries `USER_DATA_SYSTEM_CLAUSE`. Its second prompt
path builds from aggregate counts, not free text. There was no gap there.

The gap the correct measurement found is one line, and it was in
`routes-founder-chat.ts`: the success path wrapped customer content while the
error path directly below fed a raw tool-error string into the model channel. A
tool error is not automatically ours — it can be a provider echoing the record
it choked on, or a validation error quoting the offending value. Fixed.

Two lessons for whoever picks this up: a metric that counts helper references
will misrank files by size rather than risk, and the failure path of a guarded
function is where the guard usually goes missing.

Then read `shared/architecture/canon.ts` — the `parcel`, `plan` and
`opportunity` entries were all CORRECTED or landed on 2026-08-17.

**DONE so far in this campaign** (each verified against code, not against a
report — the `parcel` and `plan` entries were both WRONG when checked):

1. **`shared/parcel/parcelRef.ts` — one definition of "the same parcel."**
   Replaced FOUR competing normalisations. Adopted at `dueDiligence.ts`,
   `publicParcelReport.ts`, `taxDelinquentPipeline.ts` and `storage/gisRepo.ts`.
   Two live defects fixed: dueDiligence wrote duplicate snapshots into the
   null-org SHARED cache, and gisRepo merged "12-345" with "12345" while
   dueDiligence kept them apart — two writers to one table disagreeing about
   which row is which. Adoption ratchet in `parcelRefAdoption.test.ts`: **0**,
   down-only, from 10.
2. **`opportunity` is canonical** — `opportunities`, migration 0237 REGISTERED,
   exported, read by `decisionStore` and written by `routes-opportunities.ts`.
   It fixed a real cross-entity defect: `decisionStore` resolved an
   `opportunity` subjectId AS a `properties.id`, so a decision against
   opportunity #5 froze PROPERTY #5's evidence into an immutable record.

3. **Every open-coded parcel key is retired** — the adoption ratchet reached 0
   from 10, across five files and four mutually-inconsistent rules. Two of those
   were DROPPING REAL ROWS, not just untidy: the tax-sale import deduped on the
   APN alone, so a state-level list rejected the second county's identically
   numbered parcel as "already on this worksheet"; the lead CSV import did the
   same across STATES. Both fixed with tests in both directions.
4. **§55 reconciliation started — two material survivors so far.**
   (a) "No new persona verticals" — a DO-NOT-DO founder decision that had never
   reached `shared/governance/constitution.ts` at all. Registered, and the
   structural hole closed: the DO-NOT-DO bullet count is now pinned, so a new
   standing decision cannot be added to CLAUDE.md without being mirrored.
   (b) "The knowledge graph must never become a path around tenancy" — NOT
   satisfied. `getAgentKnowledge` filtered on `agent_type` alone over a NOT NULL
   tenant column, feeding every org's agent memory into what its docstring calls
   "the agent's context for AI calls"; and three writers had never persisted a
   row at all, each writing a `content` column that does not exist and omitting
   NOT NULLs behind an `as any` and an empty `catch {}`. Fixed, plus the prompt
   boundary that fix opened (customer-controlled `org.name` reaching another
   agent's prompt — now sanitized).

   **Both were found by READING an invariant and checking it by hand. No gate
   caught either.** The knowledge-graph functions sit inside the 335-function
   tenancy blind spot, which is the strongest argument for approving OD-3.

**HOW TO CONTINUE §55.** The corpus is at
`/tmp/.../scratchpad/prompt/ACREOS_CLAUDE_CODE_ONE_THING_AUTONOMOUS_FINAL_STATE.md`
(re-upload if the container was recycled). It is 20,976 lines; §55 is at 1507
and the Master Handoff begins ~1569. Do NOT read it in order — grep it for
absolute invariants (`must never`, `never (moves|holds|touch)`, `should never`)
and check each against code, which is what produced both survivors above.
Dispositioned so far: idempotency keys (line 11992 — VERIFIED HOLDING: the
unique index is org-leading and a changed `requestHash` refuses).

**Do not build a new `parcels` table as the first move.** Parcel identity still
has TWO owners: `properties` and `parcel_snapshots`. A third makes it worse.

**`relationship` is now the ONLY `absent` object, and its premise is verified:**
`properties.sellerId` and `properties.buyerId` BOTH reference `leads.id`
(shared/schema.ts:1228-1229), so one real person in two roles needs two rows,
and 13 role-specific person tables exist (`borrower_*`, `buyer_*`, `seller_*`,
`investor_profiles`). It was deliberately NOT built in this campaign: a
`relationships` table with no first consumer is the built-but-unwired defect
this repo keeps finding, and its only honest first consumer is the
`properties` dual-FK migration — a large, risky refactor of a live god table
that deserves its own wave rather than a tail-end addition.

The work package, in dependency order:

1. **Re-frame `parcel_snapshots` as observation, not identity.** It is
   vendor-sourced with a `source` column already ("county_gis", "regrid",
   "manual"). That is precisely an evidence claim with provenance and observation
   time, and the Evidence Fabric (`evidence_claims`) already exists to hold it.
   Until then two tables assert cadastral facts with no conflict resolution
   between them — the thing `resolveClaims` was built to do.
2. **`relationship`** — the last `absent` object, and the one BI184 says the
   role-table sprawl is waiting on. Needs a real first consumer; see above.
3. **Party / holding / instrument** — role-table → canonical. Needs 2.
4. **Only then** consider a thin parcel identity table, if 1 leaves a real need.

Layer 6 (`plan`, `action-receipt`) is independent of the reality graph and can
proceed whenever layer 2 is blocked — but note the correction above: on the
CUSTOMER plane both are absent, not partial, so that work is a build and not a
refactor of what Solene/autopilot already has.


---

## PHASE 2 — FOUNDRY → ACREOS CROSS-POLLINATION (2026-08-18)

The full record is `docs/autonomous/FOUNDRY_ACREOS_CROSS_POLLINATION.md`, which
is the canonical artifact for this phase — entries 1–19 with the ten-point
admission test applied to each. This section is the campaign-level summary only.

**Foundry is READ-ONLY in this phase.** Nothing was committed to it, no test,
migration or doc there was touched. Invariants crossed; nouns did not.

### What landed (each its own commit, each mutation-tested)

| # | Commit | Invariant |
|---|---|---|
| 4, 5 | `a37affc8` | A person id is not a tenant scope; a push says what happened |
| 6 | `f8332db1` | Public truth proven from the rendered DOM; the two laws written into CLAUDE.md |
| — | `b920d94b` | `shortDescription` / `integrations` deleted through the ledger |
| 7 | `7cf0cef8` | A pause must reach the work that runs on the customer's behalf |
| 8 | `740deb35` | A ceiling belongs to the action class, not to whoever issues the grant |
| 9 | `21ecc76d` | A carrier's acceptance is not a delivery, on a regulated record |
| 10 | `835e0e9c` | An omitted risk flag is not a declaration of safety |
| 11 | `a6df3b60` | A guess is not a known value, on the path the law governs |
| 12 | `c937eb2e` | A verifier may only report an outcome it observed |
| 13 | `1674e2f5` | A dispatch receipt is not evidence the action worked |
| 14 | `8b4740a5` | Provenance travels with the value, not with the lookup |
| 15 | `96b0b3ad` | Authority belongs to the source, not to the transport |
| 16 | `893da34a` | A cost bound must measure the thing it bounds |
| 17 | `bb6c4182` | A secret is never compared with `===` |
| 18 | `daa749b6` | A route no flag governs is not a route that is off |

### Ratchets earned and locked in, never raised

`run-scheduled-jobs-linecount` 5823 → 5786 → 5721 (two extractions, each forced
by a fix that could not be made or tested in place). `colon-any` 2950 → 2942
(a typing improvement, not a deletion). `unreached-exports` 1400 → 1399
(`outcomeBasis` gained its first production caller). `check-org-scoped-fetch`
lost two `BASELINE_UNUSED_ORG` entries in the commit that fixed them.

### The three patterns that produced most of the findings

1. **The right rule already existed somewhere else and was not the one being
   used.** `outcomeBasis` (documented the consequence-vs-proxy distinction, zero
   production callers, while `outcomeOf` broke it); `intelligence/budget.ts`'s
   `executor` category (the scheduler summed everything instead);
   `landProfile.ts` scoring FCC broadband below county GIS as self-reported
   while the evidence layer recorded it as `authoritative`; `timingSafeEqual` at
   eight sites while five compared secrets with `===`.

2. **A missing value standing in for a decided one.** `movesMoney` optional;
   `reviewDueAt` optional; a route absent from `enabledRoutes` read as denied
   rather than ungoverned; `undefined === undefined` authenticating a webhook.

3. **A measurement attributed to an actor that was not a measurement OF that
   actor.** The verifier re-reading the actor's own audit row; a dispatch
   receipt voting on efficacy; the executor's cost ceiling summing the whole
   platform's AI spend.

### Claims checked and REJECTED

Recorded because a ledger listing only what survived is a biased account of the
reading. `enrichmentToClaims`'s `observedAt: null` (the sub-objects carry no
date field, so nothing is discarded); `routes-properties.ts`'s customer-typed
observations (deliberate, labelled `customer_edit`, carried through every
reader); the executor cost bound's lack of an org predicate (correct — it bounds
AcreOS's own spend, and the test now PINS the absence so nobody adds one by
analogy).

### A gate of mine that a mutation survived

The `featureFlagControlScope` check for "the server sends `controlledRoutes`"
searched the whole handler body, so dropping the fields from `res.json()` while
leaving their `const` declarations kept it green. The identifier was present;
the behaviour was not. Rewritten to assert on every `res.json()` payload. This
is the first law in CLAUDE.md applying to the gate written to enforce it, and it
is the reason mutation testing is done on every gate in this phase rather than
on the ones that feel risky.

### Known, recorded, deliberately NOT done

- **The `/api` catch-all's structural fix.** `app.use('/api', isAuthenticated,
  …)` applies auth to every later `/api` route by line number. It has caused
  three regressions, it currently shields a fail-open webhook comparison, and it
  makes the Meta lead-ads webhook non-functional. `apiCatchAllOrdering.test.ts`
  freezes the trap (two catch-alls, three anonymous registrations pinned ahead
  of them) but does not remove it: `fieldScoutRouter` spans `/properties`,
  `/leads` and `/voice`, so scoping the mount would strip accidental auth from
  every later route that never declared its own. Removing it safely requires
  auditing all of them first, and that is its own wave.
- **Meta lead-ads route ordering.** Moving it above the catch-all would make
  ingestion live — a product decision on a founder-only surface, not a defect fix.
- **USFS Wildfire Hazard Potential's authority.** It is a modeled raster and
  `EvidenceAuthority` has a `modeled` tier it is not using, but unlike FCC
  broadband nothing in the repository contradicts its current `authoritative`
  label. A domain judgement, not a defect this reading can evidence.
- **`routes-admin.ts:3031`'s duplicate `/api/config/features`.** Shadowed by the
  earlier registration in `routes.ts`, so dead — but it would serve a response
  with no deny-lists and none of the new fields if the order ever changed.


---

## PHASE 3 — CONSEQUENCE-RANKED TENANCY DEBT (2026-08-18)

Phase 2's Foundry ledger closed with all 22 candidates dispositioned. This phase
is §23's "consequence-ranked tenancy debt" item, and it was not planned — it
opened because a Phase-2 fix tripped a gate.

### How it started

Scoping `parcel_snapshots` reads for the property-report PDF gave
`ltvMonitor.estimatePropertyValue` org context for the first time. That promoted
it out of `check-org-scoped-fetch`'s rule-1 baseline (no org anywhere) into
rule 2 (has an org, resolves by primary key anyway) — and rule 2 reported the
primary-key read that rule 1 had been holding quietly.

**A completely unscoped function is LESS visible to that lint than a partly
scoped one.** That is a property of the tool, and it is why 163 baselined
rule-1 entries were worth re-reading rather than trusting.

### The method

Scan route handlers for "a URL id reaches a service method, and NO call in that
handler ever pairs that id with an org." Naive, that returns 143. Three
discriminators cut it to 28, and each exclusion is a real pattern worth naming:

- **GUARD-THEN-USE** — `getNote(org.id, noteId)` first, then an unscoped child
  read. Ownership was just proved. The dominant pattern.
- **FETCH-THEN-VERIFY** — read unscoped, then `if (row.organizationId !==
  org.id) return 404`. Correct, and invisible to a scanner watching call
  arguments. `buyer-prequalifications` and the VA action executor both do this,
  each with a dated comment.
- **DELIBERATELY PLATFORM-WIDE** — `requireFounder` routers such as dunning,
  which is AcreOS billing its OWN customers. Identity ≠ tenant ≠ authority; an
  org predicate there would be wrong.

### What was real

| Surface | Kind | Data |
|---|---|---|
| `GET /api/finance/ltv/:noteId` | READ | balance, property value, LTV, risk alerts |
| `GET /api/leads/:id/score-history` | READ | lead scores + recommendations |
| `PATCH /alerts/:id/{ack,resolve,dismiss}` ×2 routers | **WRITE** | portfolio alerts, incl. caller-supplied resolution text |
| `POST /api/pax/observations/:id/{acknowledge,dismiss}` | **WRITE** | Pax observations |
| `GET/POST /:leadId/{urgency,financial,engagement,offer-range}` | READ | lead signals, conversations, activities, valuations |
| `POST /api/writing-styles/:id/{samples,analyze,generate}` | **WRITE** | a tenant's voice profile |
| `PATCH /alerts/:id/resolve` (compliance) | **WRITE** | compliance alert, + a false audit entry |

`BASELINE_OFFENDERS` 166 → 149; rule-1 function baseline 126 → 124, rule-2
80 → 78. Every entry deleted in the commit that fixed it.

### Two bugs the tenancy work exposed that were not tenancy bugs

Threading an organization through forces every argument list to be re-read, and
two of them were wrong:

1. `suggestOfferRange(leadId, propertyId)` against a `(propertyId, signals)`
   signature. `req.body` is `any`, so it type-checked and the endpoint derived
   an offer range from whatever property shared an id with the lead.
2. `resolveAlert(alertId, resolution)` against `(organizationId, alertId)` — the
   query became `WHERE id = parseInt("<free text>")`, i.e. NaN. **The compliance
   alert was never resolved, and the route wrote an audit entry saying it was.**

A third instance is recorded in the code at `routes-seller-intent.ts`. Three of
one kind is a class, so the enabling condition got a gate:
`argumentOrderHazard.test.ts` fails on any two same-named functions whose shared
parameters are in opposite orders. Three real pairs found and aligned to the
house organization-first convention; two annotated exemptions (a storage/service
layering, and an arity difference) with the gate asserting each still matches.

### Founder rulings executed (picker, 2026-08-18)

- **KILL `GET /api/enhancements/campaign-roi/:id` + `calculateCampaignROI`** —
  no consumer, cross-tenant, and fabricating (`revenue = leads × $500`,
  `dealsCreated = leads × 0.1`). `attributionService.getAttributionReport`
  already computes the real thing, org-scoped and wired.
- **KILL the shadowed second `/api/config/features`** in `routes-admin.ts`.
- **Leave the Meta lead-ads webhook non-functional** — enabling ingestion is a
  product decision on a founder-only surface.
- **Leave USFS WHP `authoritative`** — nothing in the repo contradicts it.

Both KILLs are in `docs/company/deletion-ledger.md` with date and rationale. The
five remaining exports in `campaignEnhancements.ts` — including
`getCampaignBenchmarks`, which returns hardcoded 31% / 4.2% / 1.8% as
`avgOpenRate` / `avgResponseRate` / `avgConversionRate`, a second fabrication —
are recorded there for a ruling of their own rather than deleted alongside.

### Standing lesson

Every one of these was found by a gate reacting to an unrelated fix, or by
reading an argument list while changing something else. None was found by
looking for it. The gates that pay are the ones that get MORE sensitive as the
code gets more correct — which is exactly what rule 2 does, and exactly what the
argument-order gate is built to do.

---

## PHASE 4 — FABRICATED MEASUREMENTS (2026-08-18)

### The gap this phase exists to close

`lint:no-fabrication` scans for `Math.random`. The standing rule it enforces is
broader — *"no invented numbers, no fake activity, no placeholder data presented
as real"* — but the gate only proves **randomness is absent**. A hardcoded
constant presented as a measurement passes it every time, and three of them were
sitting on live customer surfaces. This is the same shape as the two laws in
`CLAUDE.md`: the gate was falsified against the symbol (`Math.random`), never
against the semantic defect (an invented number rendered as a measured one).

### What landed

**1. Climate risk — 40 of 50 states (`3be45090`)**

`CLIMATE_DATA` covers ten states. `assessClimateRisk()` answered for the other
forty with `overallRisk: "moderate"` and `{ level: "moderate", score: 50 }` — the
same shape as the ten real ones, and indistinguishable from them. The live
consumer is the customer's due-diligence PDF, where the lie took its second
form: the climate section only printed on a drought/coastal HIT, so an
uncovered state printed **nothing** — and in a document titled "due diligence",
printing nothing reads as *checked, nothing flagged*.

Fixed on both sides: `unknown`/`null` from the service, and an explicit
"Climate Risk: Not assessed" block in the PDF carrying the sentence *"absence of
a climate risk flag below does not indicate absence of climate risk"*. Four
mutations, all caught — including M2, a **different** fabricated default
(`"low"`/20), which proves the gate forbids the behaviour rather than the
literal 50.

**2. County opportunity score — a model fed its own defaults**

`computeCountyOpportunityScore` takes 21 market signals. AcreOS measures four of
them, sometimes. All three production callers closed the gap with literals:

| caller | constants supplied |
|---|---|
| `routes-epic-services.ts` | 17 (`avgDaysOnMarket: 90`, `monthsOfSupply: 6`, `estimatedInvestorMailingCount: 10`, `distanceToNearestMetroMiles: 80`, four `has…: false`, …) |
| `routes-data-intelligence.ts` | 12, the same values |
| `marketReportGenerator.ts` | `{ state, county } as any` — all 21 `undefined` |

So `GET /api/county-opportunity/:state/:county` returned, for **any county in
the United States**, a full markdown *Market Intelligence Report*: "Average days
on market: 90 days", "Sales volume (12 months): 20 transactions", a 0–100
opportunity score, and a recommendation to **buy**. Built entirely out of
constants.

`parcelIntelligenceFusion.ts` (~line 207) already contained the correct ruling,
written down and obeyed in exactly one place:

> *we deliberately DO NOT call `computeCountyOpportunityScore` here … feeding it
> hardcoded placeholder constants produced a fixed number dressed up as a
> "proprietary model" output.*

This is the recurring shape: **the right rule already existed somewhere else and
was not the one being used.**

Fixed by moving the refusal into the model, where no caller can route around it:
every signal is `number | null` / `boolean | null`; four `REQUIRED_SIGNALS`
without which it returns `null`; each dimension normalized over the signals it
could actually see; weights renormalized across the dimensions that scored; and
a `dataBasis` block ({measured, missing, dimensionsScored, weightCoverage}) that
travels with every score. Booleans are nullable for the sharpest reason:
`hasRecentInfrastructureAnnouncement: false` ASSERTS AcreOS checked and found
none; `null` says it never looked.

**3. A placeholder persisted into the database**

`countyAssessorIngest.ts` wrote `avgDaysOnMarket: 90, // Placeholder until we
track listing dates` into `county_markets` for every county it touched, and
`routes-epic-services.ts` read it straight back out as a measured fact. A
placeholder in a database is not a placeholder; it is data, and nothing
downstream can tell it from a measurement. Now `null`. Same for
`investorDemandScore: Math.min(100, Math.round(sales12.length * 2.5))` — a
rescaled sales count labelled "investor demand".

**4. A call that had never once succeeded**

`marketReportGenerator.getCountyOpportunityScore` called the model with
`{ state, county } as any`. It pushed *"Only undefined land sales in 12 months"*
into the red flags and then threw `TypeError` on
`input.monthsOfSupply.toFixed(1)`, which the surrounding `catch { return null }`
swallowed. It has therefore always returned null, silently, since it was
written — and the `as any` is what let it compile.

### A gate of mine that a mutation survived (again)

`"false and null score differently"` flipped **two** booleans at once. The
mutation that removed the null-guard from only `hasRecentInfrastructureAnnouncement`
stayed green, because the other field alone still made the two runs differ.
Rewritten as `it.each` over one field per case; both mutations now fail.

Second self-inflicted lesson, same commit: the source scanners initially matched
**their own fix comments**, which quote the constants they removed — 24 "offenders",
all prose. A gate that reads comments is matching text, not behaviour. They now
strip comments first, with a vacuity guard that fails if the stripper eats the file.

The caller scanner was also rewritten from a list of the old values to a
predicate on the **kind** of expression: a signal may be `null` or an expression
reading from data, never a bare numeric/boolean/string literal. So
`avgDaysOnMarket: 75` and `hasLakeOrRiver: true` fail exactly as `90` and
`false` did, and a signal added to the model is covered the day it is added
(`SIGNAL_NAMES` is derived from the input object, not retyped).

### Recorded, not fixed — with the reason

- **`scoreCountyForTargeting` (`sellerMotivationEngine.ts:703`)** carries the
  identical defect — `input.avgDaysOnMarket || 180`, `input.investorMailingCount
  || 10`, `input.growthRate5Year || 0` — and emits a `recommendation` and an
  `opportunityWindow` from them. It has **zero call sites**, so it is a latent
  copy of the same bug rather than a live one. Deletion ledger material, not a
  hotfix.
- **`EnvironmentalIntelligenceCard`** — zero call sites, and three of its five
  queries build `…/climate-risk/[object Object]` because they pass an options
  object as the second `queryKey` element under `getQueryFn`'s
  `queryKey.join("/")`. Two independent proofs it was never wired. In the
  deletion ledger for a ruling; repaired in place so it is honest if anyone
  wires it, which is not an argument for keeping it.
- **`negotiationEnhancements.ts:49-50`** — `avgDiscountFromAsking: 25` and
  `avgNegotiationRounds: 2.3` returned alongside genuinely computed
  `avgOffersToClose` and `winRate`, which is the most dangerous packaging: real
  and invented figures in one object, identically shaped.

### The generalisable finding

A `|| <constant>` on a metric is the fabrication idiom in this codebase, and it
is invisible to every gate currently running. `avgDaysOnMarket || 90`,
`investorMailingCount || 10`, `salesVolume12Months || 20`,
`medianPricePerAcre || "1000"` — each reads as a harmless default and each
produces a number a customer cannot distinguish from a measurement. The
type-level fix that actually holds is the one applied here: make the field
`| null`, so the absence has a representation and `||` has nothing to swallow.

### Founder rulings executed (picker, 2026-08-18, phase 4)

- **`GET /api/county-snapshot` keeps its score field, null with a reason.** The
  endpoint's USDA/Census content is real; the score is not computable from it
  and now says exactly which signals are missing. The absence is the spec for
  the transaction feed that would fill it.
- **KILL `EnvironmentalIntelligenceCard`** — executed: the component, `POST
  /api/environmental/highest-best-use`, and the five HBU symbols the route
  solely owned. `GET /api/environmental/climate-risk` survives, correcting the
  ledger row's original listing: `assessClimateRisk` is live through the
  due-diligence PDF and that endpoint is its HTTP face.
- **`scoreCountyForTargeting` NOT killed** — stays in the ledger as a recorded
  latent copy.
- **`campaignEnhancements.ts` five exports NOT killed** — still awaiting their
  own ruling.
- **Negotiation analytics computed from real offer data**, not nulled: both
  literals replaced with derivations off the `offers` table, plus a `basis`
  block reporting the population behind each figure.

### Two more of my own gates that a mutation exposed

`negotiationAnalyticsHonesty` — M4 removed the `offer_percentage IS NOT NULL`
predicate and the suite stayed green. On inspection the gate was RIGHT and the
mutation was wrong: SQL's `avg()` already skips NULLs, so the predicate is
semantically redundant and no behavioural assertion could distinguish it. But
the test's NAME ("excluded, not zeroed") claimed something it did not prove.
The load-bearing choice is `count(offer_percentage)` vs `count(*)` — the
denominator reported as the basis for the average — and that is invisible in
the returned numbers too, so it is now pinned on the generated drizzle
expression. M5 (`count()` for `count(offers.offerPercentage)`) fails.

The rule this makes concrete: **when a mutation does not fire, first establish
whether the mutation was semantically null.** If it was, the gate is fine and
the test's claim is what needs correcting — an overclaiming test name is its own
kind of false green.

## PHASE 5 — THE `|| <constant>` IDIOM (2026-08-18)

### The scan that found the rest

A throwaway scanner over `server/**/*.ts` for `<metric-shaped identifier> ||
<non-zero literal>` (and `??`) returned **129 candidates**. Most are legitimate
config defaults — `days ?? 30` for a query window, `gracePeriodDays ?? 10` read
off a note's own terms, `expirationDays ?? 10`. The dangerous subset is narrow
and specific: **a measurement of the world, defaulted to a plausible value, then
presented to a customer as measured.**

Ranked by consequence, the ones acted on:

| site | the constant | what it reached |
|---|---|---|
| `acreOSValuation.ts:75` | `compsMedianPricePerAcre \|\| 1000` | the AVM — a billable valuation |
| `dealFeedEngine.ts` | four pillars seeded 50 / 575, `acreage \|\| 5` | the daily deal feed's ranking and its dollar offers |
| `countyAssessorIngest.ts:484` | `avgDaysOnMarket: 90` | persisted into `county_markets` |
| `negotiationEnhancements.ts:49` | `25` / `2.3` | a live analytics endpoint |

Still recorded and unfixed, with reasons in the deletion ledger or here:
`acquisitionRadar.ts:340` (`medianDaysOnMarket || 90`),
`dataIntelligenceEngine.ts` (`medianDomDays ?? 180`, `medianHouseholdIncome ??
50000`), `marketPrediction.ts` (`avgDaysOnMarket || 60`),
`leadIntelligenceEngine.ts:315` (`pasturePerAcre || 1000`),
`parcelIntelligenceFusion.ts:831` (`opportunityScore || 50` — in the very file
that documented the refusal), and the LLM-parse family (`parsed.confidence ||
0.5`), which is a milder class: a model that returned no confidence gets one.

### A fix that deleted the symbol and left the behaviour

`generateValuation` carries a note from an earlier honesty pass: *"the old
`= 1000` seed meant every parcel in America 'was worth' $1,000/acre the moment
both real paths failed — branded as a proprietary model."* That fix removed the
visible `= 1000`. One level down, inside the model's own feature vector, sat
`pricePerAcreComps: compsMedianPricePerAcre || 1000` — and the only caller
passed `0`, so it fired on **every call**.

This is the clearest instance yet of the first law in `CLAUDE.md`, and it
happened to a fix that had already been made once, by someone who had correctly
identified the defect and written down why it mattered. Deleting the identifier
is not deleting the behaviour.

Second finding in the same function: `confidence = min(85, 50 + topImportance *
200)`, where `topImportance` is a property of the **trained model**. Every
parcel a given model ever scored reported the same confidence. A confidence
that cannot vary with the input is not a confidence.

### A tenancy leak found while fixing a fabrication

`generateDealFeed` gathered candidates with `.from(properties).where(and(LOWER(state)
= …, LOWER(county) = …))` — **no organization predicate**. `properties.organization_id`
is NOT NULL with a cascade FK; there is no shared parcel pool. So the daily feed
built for one org drew candidates from every org's parcels in its target
counties, and `buildOpportunity` returns APN, address, coordinates, assessed
value, tax-delinquency signals and owner-motivation analysis — then persists
them into the reading org's `daily_deal_feed`.

`check-org-scoped-fetch` was green over it before and after, and the reason is
the property already recorded in phase 3: **rule 3 treats a function as
org-scoped when the string `organizationId` appears anywhere in its body.**
`generateDealFeed` is org-scoped in six other places, so a partly-scoped
function HIDES an unscoped query inside it. The gate's blind spot is not
"unscoped functions" — it is "unscoped queries in scoped functions", which is
strictly harder to see and strictly more likely as a codebase gets more correct.

### "Fall open to neutral" is fabrication with a reassuring name

Three sites in `dealFeedEngine` were documented as deliberate:

- `NEUTRAL_RADAR_SCORE = 50` — *"Keeps the feed honest rather than crashing or
  fabricating a high score."* It did prevent a HIGH score. It did not prevent a
  fabricated one, and the comment's own framing — that the alternative to a
  default is a crash — is what hid the third option.
- `scoreColdParcelMotivation`'s *"honesty gate → fall open, no regression"*: the
  gate detects that the biography has no real series, returns null, and the
  caller substitutes 50. The gate found the truth and the caller discarded it.
- `countyOpportunity` was seeded 50 and **never assigned from anything**, so
  20% of every composite score in the feed was a constant.

All three now propagate null, and `computeComposite` renormalises over the
pillars that scored. A parcel with no pillar at all is dropped from the feed
rather than ranked, because "the ten best parcels we found" is a claim and an
unscored parcel is not evidence for it.

### The mutation-testing lesson, third instance

M3 on the deal-feed gate did not fire, and the reason was neither the gate nor
carelessness: `acreage || 5` appeared TWICE, and the caller-side guard returns
before the calculator runs, so the second occurrence is **unreachable**.
Mutating unreachable code is semantically null. Removing BOTH does fail.

The first attempt at handling this added a `forceComps` knob to "isolate" the
second guard — which could not work, because a mock cannot bypass a `return`
that happens before the mock is called. That knob was removed rather than kept:
a test fixture that pretends to isolate something it cannot is the same
overclaiming failure as a test NAME that does, and both read as coverage.

**The rule, now stated three times in three phases:** when a mutation does not
fire, establish which of three things is true before changing anything —
the gate is weak, the mutation was semantically null, or the mutated code is
unreachable. Only the first calls for a stronger gate.

## PHASE 6 — RULE 3: THE GATE'S BLIND SPOT, CLOSED (2026-08-18)

### The blind spot, stated precisely

`check-org-scoped-fetch` had two rules, and both judge a **unit**:

- **Rule 1** — does this method/function mention an organization anywhere?
- **Rule 2** — a unit that HAS an org: does it resolve an org-scoped table by
  primary key without using it?

The deal-feed leak passed both, and not by accident:

```
generateDealFeed(orgId)                     // org-scoped six other ways
  await db.select().from(properties)        // <- no org predicate
    .where(and(LOWER(state) = …, LOWER(county) = …))
```

Rule 1 saw `organizationId` in the body. Rule 2 had nothing to say because the
query resolves by county, not by id. So the blind spot is not *unscoped
functions* — it is **unscoped QUERIES inside scoped functions**, and this is the
class that gets MORE likely as the codebase gets more correct: every fix that
adds an org predicate somewhere in a function pushes the rest of that function
out of rule 1's view. The same mechanism was recorded in phase 3 from the other
direction ("a completely unscoped function is LESS visible than a partly scoped
one"); this is its second and worse consequence.

### Rule 3

Walks each `.from(<org-scoped table>)` **chain** — `.from(` to the statement's
`;` at paren depth 0 — and asks whether THAT chain names the org. Four
discriminators, each for a false-positive family verified by hand:

| discriminator | family it removes |
|---|---|
| enclosing unit must have an org | rule 1's job |
| chain must not resolve by primary key | rule 2's job; guard-then-use |
| founder/platform/admin/telemetry/migration paths excluded | platform-wide by design |
| hoisted predicate variables not guessed at | stated as a limit, not papered over |

**947 → 361 → 127.** The register holds cases worth reading rather than a wall
of noise. Most are legitimate and are recorded as such: a verified-parent join
(`offers.batchId` after the batch was org-checked), a deliberate all-org sweep
that then loops per org, the frozen cross-org marketplace, a ternary predicate
whose branches both carry the org.

### Falsified against the semantic defect, per the first law

The rule was mutation-tested against the thing it governs, not the thing it
mentions:

- **Reintroduce the exact deal-feed leak** → rule 3 fires, gate red.
- **Equivalent representation** — remove the org predicate from the query but
  ADD an unrelated `organizationId` mention to the function body, which is
  precisely what defeated rules 1 and 2 → still fires.
- **Report but do not fail** (drop rule 3 from the PASS condition) → the canary
  test fails. A gate that prints a finding and exits zero is not a gate.
- **Break the chain walker** (`.from` → `.fromZZZ`) → the vacuity floor fails,
  loudly, rather than reporting every query as scoped.
- **Drop the primary-key discriminator** → the baseline inflates past its
  ceiling and the pin fails.

`orgScopedFetchCoverage.test.ts` gained a live **canary**: it writes a real file
into `server/services/` containing a function that mentions `organizationId` and
still reads `properties` without it, runs the lint, asserts it names the file
AND exits non-zero, then removes it. A canary the gate never walks is not a
canary — this one is written where the walk actually goes.

### What this buys

The two earlier tenancy phases fixed occurrences. This one changes what the
repository can *see*: 127 previously invisible queries are now frozen and
down-only, a new one has to be looked at, and the specific shape that shipped a
live cross-tenant read cannot return silently.

## PHASE 7 — `lint:measurement-defaults` (2026-08-18)

### The same law, applied to the other blind gate

Rule 3 closed the tenancy gate's blind spot. This closes the fabrication gate's.

`lint:no-fabrication` enforces *"no invented numbers, no fake activity, no
placeholder data presented as real"* by scanning for `Math.random`. It proves a
**symbol** is absent. The shape that actually shipped, four times, to live
customer surfaces is a **behaviour**:

| expression | surface |
|---|---|
| `compsMedianPricePerAcre \|\| 1000` | a billable AVM |
| `marketData?.avgDaysOnMarket \|\| 90` | a market intelligence report |
| `parcel.acreage \|\| 5` | three dollar offer amounts in the deal feed |
| `parcel.acreage ?? 1` | an offer batch (fixed in this commit) |

### The discriminator

Not every `?? N` is a lie, and a gate that says so is disabled within a week.
The question is **where the value came from**:

```
opts.days ?? 30                     a caller-supplied knob. Normal.
marketData?.avgDaysOnMarket || 90   a measurement. Fabrication.
```

A hit needs all four: a property access (not a bare local), a **non-zero**
literal (0 is the honest empty and the standard divide-by-zero guard), a leaf
name in the measurement vocabulary, and a root that is not an options bag.
**2,031 expressions considered → 77 in the register.**

### Two things this gate does that the old one does not

**It self-tests its own predicate on every run.** Nine cases, both directions —
four that must fire, five that must not. That caught two real defects before the
register was ever frozen: the measurement vocabulary was `$`-anchored and
therefore missed `avgDaysOnMarket` (ends in "Market"), the exact expression the
gate was written for; and the bare-local case was silently uncovered.

**It states what it cannot see.** A bare local (`compsMedianPricePerAcre ||
1000` — the AVM defect verbatim) has no receiver to judge, and resolving a local
back to the property it came from is dataflow, not regex. That limit is written
into the header AND pinned as a self-test case asserting the gate does NOT fire,
so the boundary is itself a tested contract rather than something a reader
discovers from a false green. The AVM case is covered behaviourally instead, by
`gbmValuationRefusal.test.ts`.

### Falsified against the behaviour

`measurementDefaultsGate.test.ts` writes probe files into `server/services/`
(where the walk actually goes), runs the real lint, and asserts:

- the deal-feed `parcel.acreage || 5` fires **and the lint exits non-zero**;
- an **equivalent representation** — different metric, `??` instead of `||`, a
  different number (`row.medianHouseholdIncome ?? 48250`) — also fires, proving
  the gate governs the shape rather than the constants that happened to be
  there;
- `opts.days ?? 30` does **not** fire;
- `row.salesVolume || 0` does **not** fire.

Mutations, all caught: report-but-exit-zero (2 tests), drop the knob
discriminator so it fires on everything (3 tests), and blind the expression
walker (5 tests).

### What is in the register, and what to fix next

Ranked, so the next session does not have to re-derive it:

1. **Market measurements** — `intel.medianHouseholdIncome ?? 50000`,
   `medianDomDays ?? 180`, `nassData?.pasturePerAcre || 1000`,
   `latestMetric.marketHealthScore || 50`,
   `profileData?.opportunityScore || 50` (in the very file that documented the
   refusal). Highest consequence; these are the AVM/deal-feed class.
2. **Contract terms** — `note.gracePeriodDays ?? 10`, and `documents.ts:163`
   PRINTS it into a customer PDF as "Grace Period: 10 days" for a note whose
   record does not carry one. A legal document asserting a term nobody agreed
   to is arguably sharper than any of the above.
3. **Autopilot trust/urgency seeded at 50** — the same neutral-midpoint pattern
   removed from the deal feed, still present in `executionEngine`,
   `agentInitiativeEngine`, `scpGoldenSuite`, `autonomousDecisionExecutor`.
4. **LLM-parse confidence** (`parsed.confidence || 50`) — the largest family and
   the lowest individual consequence: a model that stated no confidence is given
   one.

## PHASE 8 — THE ENGINE AND THE SIGNED NOTE DISAGREED (2026-08-18)

First item off the phase-7 register, and the sharpest one on it.

Three call sites read `acquired_notes.grace_period_days`:

```
server/jobs/acquiredNoteAging.ts   note.gracePeriodDays ?? 0
server/services/documents.ts       note.gracePeriodDays || 10
server/routes-documents.ts         note.gracePeriodDays || 10
```

For a note whose record does not state a grace period, AcreOS measured
delinquency against **zero** days while the promissory note it generated — the
document with a SIGNATURES block — promised **ten**. A borrower could be marked
late by the servicing engine inside a window the instrument grants them.

And `||` fires on `0`. A note whose record explicitly grants **no** grace period
produced a legal instrument asserting ten days. That is not a default filling a
gap; it is a document contradicting the record it was generated from.

`shared/notes/delinquency.ts` gained `noteGracePeriodDays()` — an explicit `0`
is a real term, `null`/non-finite/negative means the record states none, and
nothing is ever substituted. All three sites consume it, which is the second law
applied deliberately: this function exists *because* three copies disagreed, so
adoption is the whole point rather than an afterthought.

The callers then diverge **on purpose**, and the divergence is documented at
both ends: the aging sweep still measures an unstated term as zero (an internal
signal can be re-derived) while the documents decline to state a term at all (a
signed instrument cannot). The sweep surfaces `graceStated: false` so the
assumption is visible.

### Two self-corrections worth keeping

**I broke a stated purity property.** `planNoteAging`'s docstring says "No db,
no clock, no logger — so every rule above is directly testable", and my first
version put a `logger.info` inside it. Reverted: the fact travels out on the
return value as `graceStated`, and the impure caller logs it. A docstring that
states an invariant is part of the contract.

**A test of mine passed vacuously and one assertion caught it.** The aging
fixture omitted `paymentDueDay` / `originationDate` / `maturityDate`, so
`planNoteAging` returned "note is missing schedule facts" and two assertions
compared `0` to `0` and agreed. Only the one test that demanded the values
*differ* failed. The fixture is now complete and carries an explicit vacuity
guard asserting `skipReason === null` and `daysDelinquent > 0`.

Third correction, same file: that failing assertion was aimed at
`daysDelinquent`, but `computeNoteDelinquency` documents that it accepts the
grace parameter and **ignores it deliberately** — grace governs fees, not the
day count. The test was wrong, not the code, and it now asserts on
`lateFeeAdvisory`, the one output grace actually moves. Same discipline as the
mutation lesson: establish which side is wrong before changing either.

**A third self-correction, from a different gate.** The first version of the
aging fixture ended `} as AgingNoteRow`, and `check-tests-typecheck` flagged it
as a new offender (162 → 163). That gate's rationale is exactly the hazard: a
cast lets a fixture omit or misspell a field, and the test then asserts on
something that does not exist and passes forever. The cast was papering over a
real mismatch — `AgingNoteRow.id` is a `string`, and the fixture had a number.
Fixed by typing the fixture rather than by widening the baseline.

Three gates caught three different mistakes of mine inside one change:
`check-tests-typecheck` (the cast), the suite's own failing assertion (the
vacuous fixture), and `lint:measurement-defaults` (the stale register entries).
That is the ratchet system working as designed, on the author rather than on
someone else.

### The gate caught its own reduction

`lint:measurement-defaults`, added hours earlier, reported both
`note.gracePeriodDays || 10` entries **stale** the moment they were fixed —
exactly what a down-only register is for. Baseline 77 → 75, locked in.

## PHASE 9 — WHEN A DEFAULT LANDS IN A BAND THAT FLAGS (2026-08-18)

Second item off the phase-7 register: the market-measurement group in
`dataIntelligenceEngine`. It turned out to be a sharper variant of the pattern,
and the variant is worth naming.

### The variant

Every previous instance inflated a SCORE. These fell into a band that **pushes
a flag** — so the invented number was rendered as a finding, in prose, with an
impact statement beside it. Both routes pass `req.body || {}` straight in, so
`{}` was a fully-formed assessment:

| default | what it emitted |
|---|---|
| `inputs.medianDomDays ?? 180` | negative flag: *"180+ median DOM · Illiquid market — exit may be difficult"* |
| `inputs.distanceToPrimaryRoad ?? 10` | negative flag: *"10.0 miles to road · Remote location limits buyer pool significantly"* |
| `inputs.acresSize ?? 5` | **positive** flag: *"5.0 acres · Optimal parcel size for owner-financed land business model"* |

The third is the sharpest. An invented measurement presented as a FAVOURABLE
finding, in a scorer whose recommendation ranges over STRONG_BUY … DEAL_KILLER.
It is also the **fifth** place in this codebase where a parcel of unknown size
was assumed to be five acres — after `dealFeedEngine` (twice) and
`offerBatchService` (twice, as one acre).

`scoreCounty({})` had the same shape one level up: `medianDomDays ?? 180` (5 of
35 market-health points), `dataQualityScore ?? 0.5` (4 of 20 on the axis that is
ABOUT how much data exists), `ruralUrbanCode ?? 5`, and an asserted household
income — producing a real **TIER**, which is a buy/avoid instruction.

### The fix, and the one that was already right

Each signal now scores only when measured, and says so when not.
`scoreCounty` refuses below three of eight signals and returns
`tier: "UNSCORED"` with a `dataBasis`.

Worth noting: the comp-count branch in the same function **already did this
correctly** — `intel.soldCompsLast12mo ?? 0` scores nothing and pushes *"Low
comp count — gather more sold data before committing to this county"*. The
right pattern was sitting four lines above the wrong one, in the same function,
written by the same hand. That is the recurring shape of this whole campaign:
the correct rule usually already exists somewhere nearby and is not the one
being used.

Also fixed: `confidence` was clamped only at the top (`Math.min(0.99, …)`), and
the new unmeasured branches subtract from it — so it could go negative, outside
the field's own documented 0–1 range. Clamped at both ends.

### Mutation-tested, including the over-correction

  M1 restore `acresSize ?? 5`                     -> 2 tests fail
  M2 an EQUIVALENT default (8 acres, not 5)       -> 2 tests fail
  M3 `scoreCounty` stops refusing                 -> 2 tests fail
  M4 make EVERYTHING unknown (over-correct)       -> 1 test fails

M4 is the one that matters for a fix of this kind. Every "does not fabricate"
assertion passes trivially if the fix simply stopped scoring anything, so the
suite also demands that a fully-measured parcel scores HIGHER and still states
the measurements it was given.

Ratchet: `lint:measurement-defaults` 75 → 72, reported stale by the gate itself
and locked in.

## PHASE 10 — WHERE A DEFAULT BECAME A COMMITMENT (2026-08-18)

Completes the phase-7 market-measurement group. Everything fixed before this
inflated a score, a report or a ranking. Two of these **spent money**.

### The offer quoted to a property owner

`computeOfferIntelligence` (leadIntelligenceEngine) read

```
parseFloat(lead.acres || lead.acreage || "5")   and   nassData?.pasturePerAcre || 1000
```

For a lead with no acreage on file in a county USDA has no value for, that is
`1000 × 0.25 × 5` = a **$1,250 offer** — and `offerPrice` is interpolated
verbatim into the outreach message sent to the owner: *"My offer for your X
County property is $1,250."* A dollar figure quoted to a counterparty, from two
constants. Both inputs are now required, and the six message angles have
price-free variants that open the conversation without naming a number.

`buildNextBestAction` had the same shape for the operator ("Send blind offer
letter today at $1,250") and now says the figure is not established yet.

### The instruction to spend

`rankCountiesForCampaign` (parcelIntelligenceFusion) read
`profileData?.opportunityScore || 50`, and 50 lands on **"Test with 500
letters"** — an instruction to spend money, issued for a county nothing had
scored. That file's own header, ~620 lines above, documents refusing to feed a
scoring model placeholder constants. The rule was written down in the same file
that broke it. Unscored counties now return "Not scored — no county profile on
file" and hold no rank.

### Three of my own errors, and what each teaches

**A regex gate governed a spelling, not a behaviour.** The first assertion
matched the source for `lead.acres || lead.acreage || "5"`. The mutation that
restored it as `lead?.acres || …` — one character different — sailed straight
past. There is always another spelling. Replaced with behavioural assertions:
`scoreLeadIntelligence` touches no database on that path, so the real function
is called and the returned `estimatedOfferPrice` and `recommendedMessage` are
asserted. The redone mutation fails.

**A file-wide assertion found a second occurrence I had missed.** The same file
carried a SECOND `|| "5"` on the profile's own `acres` field, next to the offer
computed from the first. The test written for occurrence one is what found
occurrence two — the argument for asserting on the general form rather than the
one call site.

**I annotated the wrong consumer.** My comment claimed `maps.tsx` and
`blind-offer-wizard.tsx` render `leadIntelligenceEngine`'s
`countyContext.usdaLandValuePerAcre`. They do not — they read the
identically-named field on `blindOfferCalculator.marketContext`, which carried
the same `|| 0` and was the live one. The wrong-target mutation (M5) survived
until that was found, and both are now fixed: the live one behaviourally
tested, the dormant one corrected because the next consumer would inherit it.

`|| 0` is worth naming here, because this gate deliberately treats zero as the
honest empty. For a **land value per acre** it is not: the page rendered "Offer
modeled from USDA land values ($0/ac)" — land priced at nothing, presented as
the basis for an offer. Zero is only the honest empty for a COUNT.

### A flaky gate of my own, fixed rather than retried

The full suite failed once on `climateRiskRefusal.test.ts` (phase 4) with the
TX render containing the OH render's "Climate Risk: Not assessed" line. It
passed on re-run, at HEAD, and four times in a row afterwards — and a bisect
across the working set produced contradictory results, which is itself the
signature of chasing noise rather than a cause.

The cause: the three PDF cases shared one module instance and one `printed`
buffer, cleared only in `beforeEach`. Every `Promise.allSettled` branch in
`generateFullReport` rejects under those mocks (no db) and
`recordSnapshotAsync` is fire-and-forget, so a late write from the previous
case could land in the next case's buffer.

Fixed at the source — `vi.resetModules()` per render, buffer cleared
immediately before the call, text snapshotted synchronously after — plus a
guard that throws if a render produces almost no text, since an empty render
would make every `not.toMatch` in the file pass vacuously.

Recording it because the temptation was to re-run and move on: a gate that
fails intermittently is a gate that gets ignored, and then it guards nothing.

## PHASE 11 — UNAVAILABILITY WAS PERMISSION (2026-08-18)

Started from the phase-7 register's autopilot group (`agent?.trustScore ?? 50`)
and found something sharper next to it.

### The seeded 50 is not the defect

`trustAuthorityEscalation.getTier(50)` returns tier 0 — *"Observer — Recommend
Only"*, allowing only `generate_report` and `store_learning`. So an agent with
no trust record lands in the MOST restrictive tier. That default is
conservative and stays. Worth stating plainly, because the register flagged it
and the honest answer was "this one is fine".

### The defect beside it

`validateSafetyGates` returns `passed: violations.length === 0`, and four of its
gates were wrapped in swallowing catches:

```
} catch { /* governance brain may not be available */ }
} catch { /* trust service may not be available */ }
} catch { /* delegation service may not be available */ }
} catch {}                                    // deal value threshold
```

An unavailable governance brain, trust service, delegation service or database
contributed **no violation** — and no violation is a PASS. Unavailability was
permission, on the function that authorises autonomous agent actions including
`advance_deal_stage` and `send_churn_intervention` (a customer contact).

The comments were the tell: *"may not be available"* names the failure and then
treats it as success. This is the identity ≠ authority lesson in its quietest
form — not a wrong authority decision, but an authority decision that never
happened and reported as if it had.

### The right pattern was one gate above

`checkRateLimit`, immediately preceding these four in the same function:

```
} catch { return { allowed: false, reason: "rate-limit state unverifiable — refusing action (fail closed)" }; }
```

Same file, same function, one gate earlier. Fourth recorded instance this
session of the correct rule already existing adjacent to the broken one — after
`parcelIntelligenceFusion`'s own header, `dataIntelligenceEngine`'s comp-count
branch, and `outcomeBasis` in the original Foundry transfer.

### The fix and its proof

Each check now records a violation naming the gate that could not be evaluated,
with the underlying error and a route forward (restore the service, or
`escalate_to_founder` to proceed under human authority), and logs it. Failing
closed on an authority gate is the only safe direction.

`safetyGateFailClosed.test.ts` drives the real `executionEngine.execute()` with
each dependency made to throw in turn. Its first assertion is a vacuity guard —
with every dependency healthy the action must NOT be blocked by an
unevaluable-gate violation — so "refuse everything" cannot pass for a fix.
Mutations restoring each swallowing catch individually all fail.

### The fail-open class, scanned — a mostly NEGATIVE result

After the `executionEngine` finding, a scan of `server/**` for **empty catches
in gate-shaped context** returned 524 empty catches, 133 of them near
gate/guard/authorize/verify vocabulary. Auditing the highest-consequence subset
by hand — auth, security, middleware — the class is **handled correctly almost
everywhere**:

- `middleware/security.ts` — an invalid `APP_URL` simply is not added to the
  CORS allowlist. More restrictive, not less.
- `middleware/getOrCreateOrg.ts` (two sites) — a failed membership lookup
  leaves `org` null and falls through to the user's OWN org. Fail-closed for
  tenancy, which is the direction that matters.
- `routes-account-security.ts:147` — if the session lookup throws,
  `sessionUserId` stays null and `null !== clerkUserId` returns 403. Textbook.
- `routes-autopilot.ts:366` — a draft's example county; advisory, and annotated
  as such.

`executionEngine` was the outlier, not the tip of an iceberg. **Recording the
negative result deliberately**: it bounds the class, and the alternative — a
ratcheted gate over 133 mostly-correct sites — would have frozen noise and
taught future sessions that empty catches are suspect when they usually are
not. A gate whose register is mostly false positives gets ignored, and then it
guards nothing.

One real case did come out of the audit: `routes-account-security.ts` reported
`twoFactorEnabled: false` whenever the identity provider was unreachable,
unconfigured, or the lookup threw — and `account-security.tsx` renders that as
a red **"not enrolled"** badge. An unavailable check displayed as a finding
about the user's own security posture, on the page whose job is to state it.
Now `boolean | null`, rendering "unknown", with the failure logged.

`fcraAttestationStale`, ten lines below in the same handler, already did this
correctly (`boolean | null`, "leave null" on error). **Fifth instance this
session of the correct rule sitting adjacent to the broken one.** That
frequency is itself the finding: this codebase usually knows the right answer
somewhere within a few lines of where it gets it wrong, which is why reading
the neighbours has been the highest-yield technique in the whole campaign.
