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

**Open owner decisions: OD-4** (one query), **OD-5** (vertical claims),
**OD-6** (escrow retention vs erasure). OD-1/2/3 decided.

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
