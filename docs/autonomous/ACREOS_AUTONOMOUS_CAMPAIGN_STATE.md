# AcreOS — the live frontier

**This is a FRONTIER, not a backlog.** It is recomputed from repository truth,
not worked through in order. Nothing here has to be finished before a
higher-value intervention discovered tomorrow. When an item stops being true,
it is edited out — not struck through and kept.

Read `docs/acreos-institution/DEVELOPMENT_INSTITUTION.md` first if you have not.

Branch: `claude/acreos-canonical-implementation-1asgvc`
Verified at: `8e8c0943`, 2026-08-19. Working tree clean, 930 test files /
12,499 tests green, 25 gates green.

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

1. **Pax's skip-trace tool bypasses the FCRA permissible-purpose gate.**
   VERIFIED. The REST door (`routes-leads.ts:1806`, `routes-skip-tracing.ts:244`)
   requires `requireScope("tenant_pii_write")` — a scope `member` and `va` do NOT
   hold — plus purposeOfUse, justification and a current FCRA §1681b(a)(3)(F)
   attestation, all persisted to a `skip_traces` row explicitly for
   "class-action defense audit trail". The Pax door
   (`ai/tools.ts:799` def, `:2767` dispatch → `connectors/executor.ts:290`)
   requires none of it: no scope, no purpose, no attestation, no audit row, no
   credit ledger — and `batch_leads_skip_trace` sits on `PAUSE_SAFE_TOOLS`
   (`tools.ts:1005`) so it runs even under the customer's Pax kill switch. A
   `member` types a sentence and gets phone numbers, emails and prior addresses.
   `requiredScope` IS declared per intent and is consumed only by
   `mcp/safeIntents.ts` — never by `executeTool`.
   **Exposure today is zero** (pre-customer, no org has BatchLeads credentials
   connected), which is why it is not #1 by ratio — but it is the top
   security/authority item and it is medium effort.

2. **`schedule_background_job` schedules nothing and reports `status: "queued"`.**
   VERIFIED. `ai/tools.ts:343` advertises an enum including `campaign_send`,
   `bulk_lead_import`, `report_generation`; the implementation at `:1532` is one
   `logger.info` followed by a success payload. A user who asks Pax to run the
   overnight campaign send is told it is queued. Small effort — refuse, or wire
   it. The strongest built-but-unwired instance on the Pax tool surface.

3. **52 bare `gpt-4o`-style ids sent to an OpenRouter-only client.** Measured at
   HEAD: 52 non-telemetry `model: "gpt-4o*"` literals across 22 files that never
   construct their own OpenAI client. Every catalogue id carries an
   `author/slug` prefix (0 of 415 without), so each is a 404. Ledger 34 fixed the
   central registry and gated it; these are direct literals that bypass it.

4. **Buyer-qualification IDOR.** VERIFIED. `routes-buyer-qualification.ts:174`
   proves the caller owns `buyer_qualifications` row `:id`, then passes that same
   integer to `estimateClosingProbability(buyerProfileId, …)`, which resolves
   `eq(buyerProfiles.id, <a qualification id>)` with no org predicate
   (`buyerQualificationBot.ts:783`). Independent serial PKs. Leaks budget bands,
   preferences, preApproved, urgency, and writes a cross-tenant `agent_events`
   row. It is also functionally wrong for its own owner, which is likely why it
   was never noticed. `grep -rn buyer-qualification client/src` returns ZERO —
   the endpoint is dark. Fix when next touching tenancy: return the qualification
   ROW and pass `qualification.buyerProfileId`; give the service an
   organizationId.

5. **`POST /api/clear-demo-data` has no permission gate.** `routes-admin.ts:670`
   mounts it with only `isAuthenticated, getOrCreateOrg` — no
   `requirePermission`. `member` and `va` are both `canDeleteOrg: false` and
   both blocked from deleting a single lead, yet can wipe the org's entire FK
   closure; the confirmation is client-side only. One middleware line. A
   passenger — bundle it into whatever next touches that file.

6. **Settings → Account claims a GDPR export and deletion that never happened.**
   The SERVER is honest: `routes-gdpr.ts:104` and `:127` return 202 queue
   receipts. The CLIENT lies: `settings/account-sections.tsx:208` calls
   `res.blob()` on that 202 and saves it as a data export under a "Data export
   downloaded" toast, and `:232` toasts "Your personal data has been deleted".
   `anonymizeUser` has zero callers; the founder-side fulfiller `runErasureStub`
   unconditionally throws. The client honesty fix is one file; the erasure
   implementation behind it is separate, larger, and legal-facing.

7. **A land-OWNED surface that decides.** Land operators now get decision memory
   through the offer-letter batch (ledger 32), but that is a SHARED surface and
   deliberately does not promote the vertical. The blind-offer wizard is the
   candidate: land-flavoured, computes real economics through `computeLandDeal`
   since ledger 30, and has no commit point at all — the operator calculates and
   the report evaporates. Giving it one would record a decision AND freeze the
   scenario behind it, which is the full flip-analyzer shape and what
   legitimately moves land to `decided`.

8. **`lint-reachability` does not treat `shared/**` as an export-candidate root.**
   `shared` IS in `PRODUCTION_ROOTS` (so it counts as a call site); it is
   `EXPORT_SOURCE_DIRS` that bounds what can be reported unreached. A new shared
   module with no production caller is invisible to the built-but-unwired gate,
   and widening `PRODUCTION_ROOTS` would change nothing.

9. **539 baselined tenancy entries are frozen DEBT, not fixed code.** Rule-2
   entries first: each is a live path where a caller-supplied id can reach
   another tenant's row (`campaignOptimizer.optimizeCampaign` UPDATEs
   `campaigns` by primary key alone with the org right there on the object).

10. **80 exports are certified "reached" by a COMMENT.** MEASURED 2026-08-19,
    not estimated. `lint-reachability`'s identifier pass tokenises raw source, so
    a symbol NAMED in prose counts as a production use of it. Stripping comments
    there moves `unreachedExports` 1398 → 1478. Ledger 35 closed the two scans
    that grant EXEMPTIONS from prose (dynamic-import opacity, module-orphan
    suppression) and deliberately stopped there: this direction produces 80
    ACCUSATIONS, and the ratchet is down-only, so it cannot land in halves —
    every one has to be adjudicated (delete / wire / allowlist) in the commit
    that turns the stripper on. The three modules the first half revealed were
    all genuinely dead and two had already been flagged by the 2026-08 audit, so
    the yield here is likely real. Do not start this alongside other work: the
    reproduction is a one-line change to the linter (point the identifier pass
    at `code` instead of `raw`), and the whole cost is the adjudication.

11. **Per-user AI spend has no cap anywhere, and `/api/va` has no cap at all.**
    The per-org `aiCostCeiling` on `routeAITask` is the entire control.
    `userAiCostControls.ts` — the per-user daily/monthly budget — was deleted in
    ledger 35 as unwired and fail-open, and `DEFECT-0017` was corrected in the
    same commit because it claimed the class FIXED. `docs/audit-2026-08/16-cost.md`
    F-16-1 records the `/api/va` gap independently. Pre-customer this costs
    nothing; it is on the list because the registry no longer says it is handled,
    and a real fix is a DB-backed counter that fails CLOSED, not a restore.

---

## Recent verified changes

Most recent first. Each was falsified against the semantic defect before landing.
Full reasoning in the cross-pollination ledger, entries 23–35.

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

`docs/autonomous/OWNER_DECISIONS_PENDING.md`. The queue is currently **empty**:
all six decisions are made, OD-2/3/4/5 implemented, OD-1 a live hold (0236 stays
unregistered), OD-6 needed no code and names Customer #1 as the trigger to
revisit.

Two items are recorded there awaiting a ruling rather than blocking work:
`scoreCountyForTargeting` (sellerMotivationEngine.ts:703) and the five
`campaignEnhancements.ts` exports.

## Blocked — external

`docs/autonomous/EXTERNAL_PROOF_AND_OWNER_ACTIONS.md`. The S3 fetch half of the
DR RTO remains unmeasured — no bucket access from this container.

## Proof debt

- `lint-reachability` scan roots exclude `shared/**` (see frontier candidate 8).
- The measurement-defaults register still holds its baseline; the largest
  remaining family is LLM-parse confidence (`parsed.confidence || 50`), which is
  also the lowest individual consequence.
- A deliberate NEGATIVE result, recorded so it is not re-litigated: the
  fail-open catch class was surveyed (524 empty catches, 133 in gate context)
  and is handled correctly almost everywhere. No gate was built — a register of
  133 mostly-correct sites would freeze noise. Individual instances are fixed as
  found, which is how ledger 27 happened.

---

## Next session starts here

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
