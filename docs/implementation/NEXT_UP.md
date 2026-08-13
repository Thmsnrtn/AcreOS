# NEXT_UP — read this first

**Purpose:** a fresh Claude session should be able to read this one file and
continue the canonical-architecture program without re-planning anything.

**Last updated:** 2026-08-12 · branch `claude/acreos-canonical-implementation-1asgvc`

---

## 1. What is the governing architecture?

`shared/architecture/canon.ts` — **the machine-readable canonical architecture.**
Read it before anything else. It holds the Master Audit's seven authoritative
layers, the nine-stage canonical loop, the fifteen constitutional laws, the
minimum canonical object set mapped onto this repo's real tables, and the twelve
architecture fitness functions with what enforces each one.

It is not prose. `tests/unit/canonicalArchitecture.test.ts` verifies every table
it names really exists in the Drizzle schema and every enforcement ref really is
a file on disk, and holds two ratchets that may only shrink.

Precedence, in order:

1. Safety, security, tenant isolation, data integrity, founder hard stops.
2. **The live repo at HEAD** for facts about what exists.
3. `CLAUDE.md` + `shared/governance/constitution.ts` (founder business decisions).
4. `shared/architecture/canon.ts` (architectural law, from Master Audit BI/BL).
5. Earlier Master Audit appendices, for rationale.

The audit was written against a **public GitHub snapshot**, so several of its
factual claims about this repo are already false. Verify before implementing —
see §6.

## 2. Where the program stands

| Canonical object | Status at HEAD | Where |
|---|---|---|
| organization, user, deal, workflow-run | canonical | pre-existing |
| **evidence-claim** | **canonical** ✅ | `evidence_claims`, this program |
| **decision-snapshot** | **canonical** ✅ | `decision_snapshots`, this program |
| property, parcel, document | conflated | `properties` god table |
| **outcome** | **canonical** ✅ | `outcomes`, this program |
| party, holding, instrument, plan, action-receipt | role-table | scattered |
| **scenario** | **canonical** ✅ | `scenarios`, this program |
| relationship, opportunity | absent | — |

**8 of 18 canonical objects now have a canonical home (was 4).**

Adoption ratchet at **5** (units 22–26 wired the customer loop end to end; unit
44 added the subdivision lot-pricing lock). Two refusal registries sit beside
it, and the distinction between them matters: `MUST_NOT_ADOPT` means *never,
another versioned record already owns this state* (the note payoff path);
`BLOCKED_ON_A_REAL_LINK` means *not until a real link exists* (the deal close),
and it **fails the day the link is added** rather than sitting as a hardcoded no.

Two ratchets track convergence, both down-only, both in
`tests/unit/canonicalArchitecture.test.ts`:

- `UNENFORCED_FITNESS_BASELINE = 0` (was 2) — **every fitness function now has automated enforcement**
- `OBJECTS_WITHOUT_CANONICAL_HOME_BASELINE = 10` (was 14)

## 3. What has been completed, and what proves it

See `EXECUTION_LEDGER.md` for the full record. Summary:

1. **Canonical architecture registry** (`9034306`) — canon.ts + 18-test ratchet.
2. **Evidence Fabric** (`7b80e76`) — `evidence_claims` (append-only) + pure
   deterministic resolution policy + provider anti-corruption adapter + lineage
   API. 37 tests. Makes laws 2, 3 and 6 satisfiable.
3. **Decision Memory** (`c863bf1`) — `decision_snapshots` (immutable) + freeze
   function + API. 18 tests, the central one mutating evidence underneath a
   recorded decision and asserting it does not change meaning.
4. **Infrastructure restraint gate** — BI152's New Database Test made
   checkable, inside `npm run check`. 12 tests run the real script against
   synthetic repos to prove it bites. Drove the unenforced-fitness ratchet to
   **zero**.
5. **Governed side effects** — `outward_actions` claim ledger + pure
   execute/replay/refuse classifier + terminal `ambiguous` state, wired into
   both mail transports. 22 tests, plus a down-only adoption ratchet.
6. **Ratchet correction** — the coverage ratchet was measuring the wrong one of
   two same-named `directMailService` modules; fixed so it cannot be satisfied
   by a no-op.
7. **Security** — the `/api/admin` MFA gate protected 2 of 7 surfaces because it
   was registered below five of them. Moved above all of them, with a
   source-order regression gate.
8. **Adoption** — the bulk-mail path now passes a durable
   `mailing-order:{orderId}:lead:{leadId}` key; adoption ratchet 4 → 2.
9. **Scenario** (layer 4) — `scenarios`, immutable and engine-versioned, wired
   into Decision Memory so a decision freezes the economics as well as the
   evidence. 19 tests.
10. **Honest send coverage** — `emailService.sendEmail` accepts a key; the
    coverage ratchet widened 2 → 61 because the measurement got honest, not
    because anything got worse.
11. **Outcome** (layer 7) — `outcomes` + variance as a pure projection over
    what the decision froze. **The customer-side canonical loop now runs end to
    end: evidence → scenario → decision → outcome.** 22 tests.
12. **Second economics engine** (BI191) — the registry is passed in rather than
    global, so `note_payoff` registers from server-side without relocating
    statute-adjacent code.
13. **`days` MetricUnit** — corrected a unit mislabel while no row was yet
    persisted.
14. **Third engine** (`flip_mao`) — reuses profit/roi/total_cost so a flip and
    a land deal are comparable; caught a percent-vs-ratio 100x error at the
    adapter boundary.
15. **Fourth engine** (`rental_returns`) — buy-and-hold NOI / cap rate / cash
    flow / GRM. Widened `EngineSpec.compute` so an engine can DECLARE its own
    assumptions: only the engine knows it substituted a 40%-of-rent expense
    ratio, and without a way to say so the substitution vanishes into a
    measured-looking NOI.
16. **Fifth engine** (`multifamily_noi`) — the first engine allowed to REFUSE:
    an unmeasured commercial building yields null op-ex/NOI/cap rate rather than
    a fabricated 40%-of-rent figure. Four distinct assumption declarations.
    **Also corrected a false gap claim of my own** — see the warning below.
17. **The golden loop** (Section VII A) — one property carried from a raw
    provider payload through evidence → resolution → economics → decision →
    outcome, with every input the previous layer's REAL output. It found a real
    defect in twenty minutes: `freezeScenarioRef` kept only three "headline"
    metrics, so an engine's hold-period forecast never reached the decision and
    the variance called a real prediction "unpredicted". A decision now freezes
    every metric its engine predicted.
18. **The failing golden loop** (Section VII C) — a partial payload, a conflict
    between two authorities, and an outward action whose outcome is unknown. It
    found **two** defects: a credit refusal (which contacts nobody and charges
    nothing) was recorded `ambiguous` and PERMANENTLY poisoned the idempotency
    key; and `resolveClaims` would FABRICATE a conflict if handed an unfiltered
    claim set. Both fixed, both verified by reverting the fix.
19. **The tenancy golden loop** (Section VII B) — isolation across all four
    canonical layers. Isolation was CORRECT; the record was not:
    `freezeScenarioRefs` silently skipped ids it could not read, so a decision
    citing two scenarios was written with one and read as complete. Now refuses
    WITHOUT distinguishing "another tenant's" from "does not exist", so there is
    no id oracle and no silent loss. **A mutation test also caught one of my own
    assertions being vacuous** — see the ledger.
20. **Calibration** (Section VII D) — `shared/outcomes/calibration.ts` +
    `GET /api/decisions/calibration`. Per-metric forecast bias across many
    outcomes. The load-bearing part is the REFUSAL: below six compared outcomes
    it reports `insufficient` with every derived field absent, because six is
    the smallest n at which a unanimous direction clears a sign test at 0.05.
    **All four golden loops (VII A–D) are now done.**
21. **The outcome prompt** — `decision_snapshots.review_due_at` (frozen at
    decision time, null is a real answer) + `GET /api/decisions/due`. Closes the
    loop's last open end: volunteered outcomes are a biased sample by
    construction, so calibration was measuring what people remember rather than
    how they forecast. Design borrowed from the founder plane's `outcomeLedger`;
    its control-plane table is not (BI5).
22. **First adoption** — `POST /api/flip-analyzer/offer` now records a
    `flip_mao` scenario and an `offer` decision citing it. The first customer
    surface to enter the loop as a side effect of ordinary work rather than by
    calling the loop's own endpoints. Guarded by
    `canonicalLoopAdoption.test.ts` — **the only ratchet in this repo that may
    only GROW**, because it counts coverage rather than a defect.
23. **The loop closes on that surface** — `offers.decision_snapshot_id` links an
    offer to the decision that produced it, and accepting/rejecting records an
    `offer_accepted` / `offer_rejected` outcome against it, with NO actuals
    (accepting resolves the offer; it measures nothing that was forecast).
    Adoption ratchet 1 → 2.
24. **The customer is finally ASKED** — `OutcomePrompt.tsx`, a Today card
    rendering `GET /api/decisions/due`. The first CLIENT surface in the whole
    program; units 2–23 were entirely server-side. `still_open` is an answer,
    not a dismissal; it asks for no numbers; it pre-selects nothing. Adoption
    ratchet 2 → 3.
25. **…and finally TOLD** — `ForecastCalibration.tsx` behind the Deals door,
    printing `describeCalibration`'s sentences VERBATIM and computing no
    direction client-side. **The customer-side loop is now complete end to
    end.** Adoption ratchet 3 → 4.
26. **The loop actually turns** — the analyzer now ASKS "when will you know?"
    at the moment of drafting, and the offer route accepts and records it.
    Before this, every decision the offer path recorded had `reviewDueAt: null`,
    so not one could ever reach the Today prompt: the loop was complete and had
    a dead spot. Nothing is pre-selected and "no set date" is a real answer.
27. **A verified negative** — no column in this repo holds what a deal actually
    returned, so calibration could only ever report `unmeasured`. Recorded
    rather than built on.
28. **Calibration finally has something to measure** — ONE optional amount on
    the OutcomePrompt, only on terminal answers, only for a metric the engine
    predicted, never coerced (blank → no actuals → still `unmeasured`, never 0).
    Reverses unit 24's "asks for no numbers" to the sharper rule it should
    always have been: **never coerce, not never ask.**
29. **A surface that must NOT adopt** — the note payoff path looks like the
    obvious next adoption candidate and wiring it would be a defect:
    `note_payoff_quotes` already persists `engine_version` + verbatim
    `engine_input_json`, so a Scenario there would be a SECOND owner of the same
    state. `MUST_NOT_ADOPT` encodes it, and the guard checks its own
    justification so the exemption cannot outlive its reason.
30. **SECURITY** — `viewOnlyAssignedLeads` was enforced on reads and on
    `PUT /api/leads/:id`, and **missing from four writes** (`DELETE /:id`,
    `PATCH /:id/restore`, `bulk-delete`, `bulk-update`). A restricted VA could
    delete, restore or mass-update any lead in the org by id. Intra-org, not
    cross-tenant. Rule given ONE owner (`server/utils/assignedLeadGate.ts`) +
    a 9-test coverage gate with a vacuity guard. as-any ratchet 1407 → 1406.
31. **SECURITY** — asking whether unit 30's drift existed elsewhere found
    something worse: `canDeleteProperties`, `canDeleteDeals` and
    `canDeleteNotes` were enforced **nowhere at all**. A `viewer` could delete
    every property, deal and note in the org, in bulk. Four routes gated; a
    permission→route registry now fails when a declared permission has no
    route. The test found the fourth defect itself, by checking its own
    exemption's justification. Also fixed a comment-stripper that silently ate
    38.8% of `routes.ts` — see the ledger.
32. **SECURITY** — the `viewer` role is documented in `roleGuard.ts` as
    "read-only across the CRM" and **was not**: every `canEdit*`/`canCreate*` is
    false for viewer and none was enforced anywhere. A viewer could create and
    edit leads, properties, deals and notes. Closed with ONE gate chained at the
    `getOrCreateOrg` chokepoint (deny-by-default, so the next write route is
    covered automatically), 14 behavioural tests, fails CLOSED.
33. **SECURITY** — three more unenforced mutations, including
    `POST /api/organization/seats/purchase` (creates a Stripe checkout session
    and writes `stripeCustomerId`; `canManageBilling` is OWNER-ONLY and nothing
    checked it). `PATCH /api/organization/settings` is gated by FIELD, not
    wholesale, so a member can still dismiss their own checklist.

34. **SECURITY — the biggest one.** `canExportData` was enforced on exactly ONE
    of ten export endpoints. The other nine included `/api/export/backup` (a ZIP
    of the whole org), the generic `/api/export/:entityType`, and the download
    of a completed export. These are GETs, so unit 32's gate did not cover them:
    **a viewer could export the entire database.** All gated; the coverage test
    now derives the export surface from SOURCE and found a tenth route the hand
    grep missed.

35. **SECURITY** — `canImportData` was enforced on ZERO of thirteen import
    endpoints; 11 gated (previews too — a preview parses the operator's file and
    would otherwise be a schema oracle for a denied role). **The permission
    audit is now complete** — see the ledger's disposition table.

36. **SECURITY — the first CROSS-TENANT one.** `GET /api/founder/safety-status`
    had no founder check and queried `simulated_actions` with **no org filter**,
    returning ten rows with payloads (recipient name + mailing address) to any
    authenticated user of any org. Gated. A new coverage test models all FOUR
    founder-guard mechanisms across 608 routes plus the prefix-mount ORDERING
    rule. Note: writing it produced three large false-positive counts
    (378/322/20) before the right answer — verify every candidate by hand.

37. **SECURITY** — `POST /api/skip-traces` was scoped `tenant_pii_write`; the
    three READS twenty lines above it had no scope at all. `skip_traces.results`
    holds phones, emails and address history. **Reads are what exfiltrate** — a
    protected write with an unprotected read is the most misleading shape there
    is, because someone clearly thought about the scope and applied it to the
    wrong half. Gated; test asserts the premise (the scope is still denied to
    member/va/viewer, and the column still holds PII) as well as the gate.

38. **SECURITY — a CREDENTIAL, not data.** Generalising unit 37 found eight
    same-path read/write asymmetries; **seven were correct design** (reading
    leads while denied delete is how permissions work — gating those on a
    pattern match would break the product). The eighth: `GET /api/webhooks`
    returned `WebhookEndpoint.secret`, the HMAC signing key, to any org member.
    A leaked signing secret grants the ability to FORGE deliveries into the
    customer's downstream systems. Fixed by REDACTION not a gate (nobody needs
    to read it back), removed not masked, **and** by preserving it on write —
    the client round-trips this list, so redaction alone would have silently
    blanked every key on the next save.

### Units 39–46, in one pass

Eight units after the permission sweep, and the pattern that generated them is
worth as much as the fixes:

| unit | what | why it survived |
|---|---|---|
| 39 | webhook signing secret **encrypted at rest** (unit 38 fixed only the API read) | fixing an exposure at one boundary says nothing about where the value lives |
| 40 | provider API keys written in **two shapes** by two routes; readers split between them — the platform paid the customer's vendor bill AND charged them credits for the same lookup | every reader looked correct alone |
| 41 | the webhooks panel wrote `enabled`, the dispatcher read `isActive` — **every endpoint added through the UI was incapable of firing**, and the UI badged it "Active" | two identifiers differing, nothing else wrong |
| 42 | 6 of 15 offered webhook events **did not exist**; of 36 declared, **one** has an emitter | four of the six were near-miss renames of real events |
| 43 | the per-org **simulation kill-switch** was not declared in its own column's type | a typed write could not carry it and could erase it |
| 44 | **adoption ratchet 4 → 5**: the lot-pricing lock records the reasoning it used to discard | `lockedGrid` kept the output; the rules that produced it sit in the same mutable row |
| 45 | the deal close **refused** as an adoption surface, in a test that unblocks itself | no non-heuristic link from a deal back to its decision |
| 46 | `canAssignLeads` declared for every role, **checked by none** | assignment is access control wearing a workflow name |

**Two questions generated most of them, and both are reusable:**

1. *Having fixed how a value is RETURNED, where else is it written, stored,
   mirrored or read?* (39, 40, 43)
2. *Does anything WRITE this in a different shape or under a different name than
   the code reading it expects?* (40, 41, 42)

**The precondition they share:** the payload crosses into an **opaque jsonb
column with no validation**. Where a zod schema or a typed column mediates, a
mismatch is caught by tsc or by the parse. Three detectors were built to find
more of this class and all three failed — see §4 before rebuilding one.

**The residual is CLOSED (unit 46).** `canAssignLeads` was recorded here as
"the mildest of the set — reassigning a lead inside an org neither destroys,
exfiltrates nor spends." That was wrong, and worth recording as wrong: for a
`va` or anyone carrying `viewOnlyAssignedLeads`, **assigning a lead grants
access to it and unassigning revokes access** — it exfiltrates by exactly the
mechanism the assigned-leads gate exists to control. Three paths accepted an
assignee from anyone, and it is now gated (including `assignedTo: null`).

### Units 47–52, the same pattern at higher stakes

| unit | what | why it survived |
|---|---|---|
| 47 | three more **unbounded collections** in the org settings jsonb blob | the column has no validation, so nothing bounded them |
| 48 | VA **escalations recorded but never delivered** | the write succeeded, so every caller looked correct |
| 49 | VA task routes **returned a plausible object and stored nothing** | a 200 with a shaped body is indistinguishable from a save |
| 50 | **any member of any org could buy ads** on AcreOS's own ad account | the founder's "be the rail, not the provider" ruling had been applied to ACH twenty lines below and never to ads |
| 51 | a **subscription tier could buy past the expansion ladder** — `featureGate`'s enterprise bypass, plus fail-OPEN on a flag-store error | the escape hatches are correct for a product flag and wrong for a governance gate |
| 52 | a **second AI destination** (`/negotiation`, 607 lines) that no path-name scan and no nav ratchet could see | it is in no nav module and nothing links to it — held only by the freeze list |

**The technique that produced 50–52** is the one recorded in §4: *find a rule the
repo has already written down — a founder ruling, a closed vocabulary, a deleted
subsystem note — and enumerate the surfaces it should cover.*
`shared/governance/constitution.ts` is that list made machine-readable, and it
flagged its own weakest entries as **`prose-only`**. There were two. Units 51 and
52 closed both: **no `prose-only` entries remain**, and the final assertion in
`paxStaysAmbient.test.ts` fails if a new decision is added without a gate.

**Unit 52 also added a detector worth reusing.** A surface is named for the
business problem it solves, not for the machinery inside it — so scanning route
PATHS finds nothing, and scanning the COMPONENT each route renders finds the
surface. `/negotiation` renders `NegotiationCopilotPage`. The same asymmetry
should be expected anywhere a rule is written in the vocabulary of the machinery
(AI, payment, export, delete) and the surfaces are named for the domain.

Gate state at last commit (unit 63): `npm run check` exit 0, tsc clean,
reachability at all four baselines, every ratchet at baseline, and the **full
unit suite green — 687 files, 9,018 tests, 1 skipped, 0 failures.**

Ratchets moved DOWN during units 52–63, each locked in by the commit that earned
it: `as-any` 1397→1396, `colon-any` 3014→3011, tenancy register 188→173 (rule 1)
and 63→59 (rule 2). No baseline was raised.

A 24-agent reconnaissance sweep (12 layer readers + 12 adversarial verifiers)
ran against the repo during this program. Its most valuable output was the
adversarial pass: it caught the MFA ordering defect (unit 7), and it correctly
refuted a large number of its own layer reports, several of which had been
generated against a tree that this program was actively changing underneath
them. Treat any inherited "ABSENT" finding as needing re-verification against
HEAD before it is acted on.

## 4. The next highest-value unblocked task

**START HERE (state as of unit 63).** The tenant-isolation thread that ran from
unit 53 to unit 63 is at a clean stopping point, and the next task is *not* more
of it:

- **Every caller-supplied-id cross-tenant defect found so far is fixed.** Six
  subsystems (investor verification, document intelligence, due diligence, cash
  flow, price optimizer, seller intent) plus the dunning console's missing
  founder gate and two duplicate founder-identity implementations.
- **The class is now gated, not just fixed.** `check-org-scoped-fetch` walks
  `server/services/**` (unit 54) and carries a second rule — *has an org and
  resolves by id anyway* (unit 61) — which found a live cross-tenant write on its
  first run.
- **What remains is characterised, not unknown**: 59 rule-2 entries, of which
  ~28 are internal helpers with no external caller (cheap, near-zero risk) and
  the rest are derived ids. **None is caller-reachable.** BLOCKERS B14 has the
  triage and the command to re-derive it.

So: the remaining tenancy work is *hygiene*, and the highest-value unblocked task
is whichever of the threads below is genuinely next — not the 28 helpers, which
are a good filler task rather than a priority.

**Two threads are open. Read both before choosing.**

**THREAD A HAS EXTENDED PAST PERMISSIONS (units 36–40).** The pattern that drove
units 30–35 — *a rule that existed and was applied to some surfaces and not
others* — kept producing findings after the permission surfaces ran out, because
the pattern is not really about permissions:

- **unit 36** — the first CROSS-TENANT leak (a founder route with no founder guard).
- **unit 37** — a guarded write with an unguarded read (`tenant_pii_read`).
- **unit 38** — the same shape on a CREDENTIAL: the webhook signing secret was
  readable by any org member. Capability, not information.
- **unit 39** — the same credential, the OTHER exposure: stored in the column in
  plaintext. *Fixing an API leak says nothing about where the value lives.*
- **unit 40** — the neighbouring column, same question: two writers wrote two
  shapes and the readers were split between them, so a customer's own provider
  key was invisible to most consumers. The platform paid their vendor bill AND
  charged them credits for the same lookup.

**The question that generated 39 and 40 is worth reusing:** *having fixed how a
value is RETURNED, ask where else it is written, stored, mirrored or read.* An
exposure fixed at one boundary is not the same value made safe.

**The one that generated 40 specifically:** *does anything WRITE this in a
different shape than the code reading it expects?* Split reader/writer shapes are
invisible file-by-file and obvious the moment the set is enumerated — which is
why unit 40's registry derives the reader set from source, and why a
hand-written list is what let the split persist.

**Units 41–42 are the same question asked of NAMES rather than shapes**, and the
webhooks panel answered it twice:

- **unit 41** — the panel wrote `enabled`, the dispatcher read `isActive`. Every
  endpoint added through the UI was structurally incapable of firing, and the
  UI badged it "Active".
- **unit 42** — the panel offered 15 events, 6 of which did not exist on the
  wire (4 were near-miss renames of real ones), and of the 36 declared events
  exactly ONE has an emitter.

**THE PRECONDITION IS WORTH REMEMBERING, because it tells you where to look
next:** both survived because the payload crossed the wire into an **opaque
jsonb column with no validation**. Where a zod schema or a typed table column
mediates, a name mismatch is caught by tsc or by the parse. Where the server
persists a client-supplied structure verbatim, the two ends can disagree
forever and nothing errors.

**THREE DETECTORS FOR THIS CLASS HAVE BEEN BUILT AND ALL THREE FAILED.** Do not
rebuild them; read this instead.

| detector | result | why it failed |
|---|---|---|
| client payload keys absent from all server source | **0 hits, and wrong** | `enabled` — the unit 41 defect — appears in ~100 server files, just never in the code reading that endpoint. **Presence-anywhere is not the test.** |
| handlers that mention `req.body` and write a jsonb-named column with no zod parse | 165 hits | the conjunction is far too weak; most were server-constructed audit metadata |
| field reads on a typed jsonb column that its `$type<>` never declares | 235 hits | `metadata`, `settings`, `result`, `items`, `checks` are among the most common local identifiers in the repo — name-collision swamps the signal |

**A FOURTH detector was tried after unit 50 and also failed**, and its failure
is the most instructive of the four because the reason is architectural rather
than syntactic:

| detector | result | why it failed |
|---|---|---|
| paid outbound rails that do NOT deduct credits ("variable cost attributable") | 48 of 53 callers flagged | **cost gating lives at the ROUTE, where the tenant is known; the rail lives in the SERVICE, where it often is not.** A file-level co-occurrence test cannot pair them — `comps.ts` calls Regrid unmetered because `routes-properties.ts` already ran `calculateCost("comps_query")` two layers up. And the largest group of genuinely unmetered callers is the **founder plane**, which is correctly unmetered: it is the platform's own spend. |

So four detectors, four failures. The one finding this thread produced (unit 50,
Meta ads) came from **reading a file and noticing that the ruling recorded
twenty lines below it had not been applied to it** — not from any scan.

**The technique that actually works on this codebase**, stated plainly because
four attempts now support it: *find a rule the repo has already written down —
a founder ruling, a closed vocabulary, a house convention, a deleted-subsystem
note — and enumerate the surfaces it should cover.* Every substantive finding
from units 30 through 50 came that way. Grep-based anomaly detection produced
noise every time.

Precision on the jsonb class needs **field-level dataflow**, not grep. If you attempt it again,
attempt it with a TypeScript AST pass, and know the yield is unproven: the third
detector's 235 hits produced exactly one real finding (unit 43), and that came
from hand-checking the entries whose names sounded safety-relevant. **Sorting the
noise by consequence and hand-checking the top of it beat improving the
detector.** That is probably the right technique for this class in general.

### Two note-payment data models — BLOCKERS B10, read before touching note money

`notes`/`payments` (decimal strings, `parseFloat`) and
`acquired_notes`/`note_payments` (integer cents) both exist, both have writers,
and the house rule in `shared/finance/cents.ts` applies to one of them.

`POST /api/notes/:id/record-payment` respects neither: it reimplements the
principal/interest split in floats while `splitPaymentCents` exists and three of
the four payment recorders use it, and it does a bare insert plus a separate
update where `storage.createPayment` would give a transaction with a row lock.
It has no client caller — the modal uses the cents-family route.

**It was deliberately not fixed**, and B10 explains why: making it a correct
writer of the legacy model is work thrown away if that model is being retired,
and refusing it (unit 49's answer) is wrong because this route genuinely
persists. Unit 49's routes stored nothing, so refusing removed only a lie.

### THREE MORE unbounded collections in the org settings blob (unit 47)

The clearest remaining piece of ordinary work, and it is three near-identical
repetitions of a fix that is already written down.

`organizations.settings` is `SELECT *`-ed on every org-scoped request
(`getOrCreateOrg` → `getOrganizationByOwner`). `routes-va-engine.ts` keeps four
customer-writable arrays in it. Unit 47 fixed **one**:

**A CORRECTION TO THIS ENTRY'S FIRST DRAFT, made before it shipped.** It listed
all three siblings as "no cap, no delete", implying three identical repetitions
of unit 47. Mapping each read back to its route showed that is wrong, and the
difference changes what the right fix is:

| collection | declared | writer IN THIS FILE | actually grows? |
|---|---|---|---|
| `va_workflows` | ✅ (unit 47) | `POST /api/va/workflows` | fixed — cap 50 + delete |
| `va_escalations` | ✅ (unit 48) | `POST /api/va/escalate` | fixed — retention 200, and it now DELIVERS |
| `va_tasks` | ❌ `as any` | `/api/va/tasks/:id/verify` modifies IN PLACE; the key is owned by `services/vaManagement.ts` | not from these routes |
| `va_scheduled_tasks` | ❌ `as any` | read-only here (`GET /api/va/scheduled`) | not from these routes |

**`va_escalations` is DONE (unit 48), and it was worse than unbounded growth.**
Nothing read the key back, the named supervisor was never notified, and the
route returned `{ success: true }` — a VA asking for help got a success response
and nobody was told. It now raises an in-app notification to the supervisor
(required, and validated as an org member), reports `notified` truthfully, and
the log is bounded at 200. **The retention trim is safe only because delivery
now happens elsewhere** — which is exactly why unit 47 declined to cap it, and
the ordering is asserted rather than commented.

**`va_tasks` and `va_scheduled_tasks` turned out to be a much bigger finding
than a typing gap — see BLOCKERS B9 (unit 49).** The VA task subsystem does not
work end to end: `VA_TASKS_KEY` is declared and never used, `createTask` is a
pure function whose result was returned with a 200 and never saved, and
`PUT /api/va/tasks/:id` merged two client-supplied objects and ignored `:id`.
Both writes now refuse with 501; everything else waits on a founder decision to
build the persistence layer or remove the subsystem. **Do not add the type
declarations as a tidy-up** — declaring a shape for a collection nothing creates
would make the subsystem look more finished than it is.

`vaWorkflowBounds.test.ts` pins all three as still reached through `as any`, with
an INVERTED assertion that fails the day one is fixed — so the work announces
itself rather than sitting in prose.

### A small consolidation, sized and left alone (unit 44)

`formatCents` now has a canonical home in `shared/finance/cents.ts`, beside
`dollarsFromCents`. Four other copies exist and **only two are the same
function** — `shared/rental/camReconciliation.ts` and
`shared/rental/utilityBillback.ts` are byte-identical to the canonical one, but
`server/services/wonBidToCertificate.ts` renders negatives as `$-1,234.56` and
`client/src/components/dashboard/MRRTrajectory.tsx` ABBREVIATES ($1.2M / $3.4K),
which is a different function wearing the same name.

So a blind "de-duplicate formatCents" sweep would change two behaviours. The two
true duplicates can point at the canonical one safely; the other two need a
different name, not a merge.

### The second webhook rail — recorded in BLOCKERS as B8, not a task

There is a complete second webhook system (`webhook_subscriptions`,
`publicWebhookDispatcher`, `server/api-v1/*`) that is **entirely unmounted**:
`registerPublicApiV1` has zero callers, its UI page is not routed, and
`/api/v1/*` is only a passthrough alias that rewrites to `/api/*`. That is the
expansion ladder working — *no public API before ~50 customers* — not rot.

Read **B8** before touching webhooks. The short version: one live rail with one
emitter, one better-engineered rail waiting for its trigger, and the decision
between them is founder-level because either answer migrates live integration
config. Units 38–42 hardened the live rail without assuming an answer.

**Do not wire the five uncalled convenience wrappers into product code.** Adding
emitters to the legacy rail is the change that makes it expensive to retire.

**THREAD A — SECURITY (units 30–35), now complete except one recorded residual.**
Six units, six findings, all the same defect: *a rule that existed and was applied
to some surfaces and not others.* The MFA gate protected 2 of 7 admin routes; the
assigned-leads gate covered reads but four writes; three delete permissions were
declared and never consulted; `canExportData` reached 1 of 10 exports (a viewer
could ZIP the whole org); `canImportData` reached 0 of 13. **None was a missing
rule.** If you look for more security work, look for *unenforced* rules, not
absent ones — enumerate a surface and check it as a set, because route-by-route
review cannot see this class at all.

**THREAD A IS COMPLETE (unit 46).** The last residual, `canAssignLeads`, was the
class at its limit — declared for every role, exposed by the UI hook so the
control is hidden, and checked by **no route at all**. Every declared permission
this program found unenforced is now enforced, and each fix ships with a
registry that derives its surface from source.

**THREAD B — ADOPTION (units 22–29), the canonical loop's reach.**

**The engine registry is DONE. Stop adding engines. The gap is ADOPTION.**

BI191 is satisfied: five structurally different engines (`land_deal` cash-flow
series, `note_payoff` day-count accrual, `flip_mao`, `rental_returns`,
`multifamily_noi`) share ONE metric vocabulary, so a flip, a hold and a land deal
are comparable through normalised outputs (BI92). The registry is passed in
rather than global, so no statute-adjacent code moved.

**Do not add a sixth engine without first finding real inline arithmetic to
wrap.** Unit 16 nearly built a BRRRR engine for a feature that does not exist —
see §6a. Grep for the function that already owns the maths BEFORE planning the
adapter; if there is no such function, there is no gap.

In order:
- **KEEP GOING ON ADOPTION — it is still the only thing that matters.** Unit 22
  wired the FIRST surface (offer drafting in the flip analyzer). The ratchet is
  at 1. Raise it.
  **Do NOT wire the rental comparison** (`POST /api/flip-analyzer/rental`). It
  was listed here as the next candidate and unit 23 checked it against unit 22's
  own criterion — *record where a number stops being exploratory and becomes an
  act* — and it fails: there is no offer, no document, no act. Wiring it would
  reproduce exactly the keystroke problem that kept the MAO endpoint clean.
  Likewise **do not wire `LandDealCalculator.tsx`**: `land_deal` is the richest
  engine, but its only caller is the PUBLIC embeddable marketing calculator with
  no org and no auth — there is no tenant to record against. An in-app land
  surface needs finding first, and it may not exist, in which case say so.

  **The customer-side loop is COMPLETE end to end** (units 22–25): a real
  surface records the reasoning, the offer's resolution records the outcome, the
  customer is asked what happened, and they are shown what their forecasts do.
  The adoption ratchet is at 4.

  **Next, in order of value:**

  **(a) Widen adoption to a second product surface — but the criterion is
  sharper than it was.** Unit 22 said *record where a number stops being
  exploratory and becomes an act*. Unit 29 found that necessary and NOT
  sufficient. The full rule:

  > **Adopt where the reasoning would otherwise be LOST. Do not adopt where an
  > equivalent versioned record already owns that state.**

  Candidates already checked and REJECTED, with reasons — do not re-litigate:
  - `POST /api/flip-analyzer/rental` and `/mao` — exploratory, no act.
  - `LandDealCalculator.tsx` — the public embeddable marketing tool, no org, no
    tenant to record against.
  - **The note payoff path** — already owns its state
    (`note_payoff_quotes.engine_version` NOT NULL + verbatim
    `engine_input_json`). Wiring it creates a second owner. Enforced by
    `MUST_NOT_ADOPT` in the adoption test.

  So look for a moment that writes something AND currently loses the reasoning.
  **The deal close was the obvious candidate and unit 45 REFUSED it** — see
  `BLOCKED_ON_A_REAL_LINK` in the adoption test. Summary: a closing deal writes
  `acceptedAmount`, a genuinely realised sale price, but nothing links the deal
  back to the decision that produced its offer (`offers` has no `dealId`,
  `deals` has no `offerId` or `decisionSnapshotId`, and no code path creates a
  deal FROM an offer). The only shared key is `propertyId`, and pairing on it is
  the mis-matched-pairs failure unit 23 refused. **The refusal unblocks itself:
  the test fails the day either link column is added.**

  Also worth knowing before hunting: **a realised sale price DOES exist** in
  `deals.acceptedAmount` on close, already fed to the valuation training corpus.
  Unit 27's negative — nothing records a realised RETURN — stands, but do not
  repeat its search for `actualSalePrice` / `realizedProfit`. **Do not add a
  surface just to move the ratchet** — that is optimising for the number rather
  than the customer, which is the failure the ratchet exists to detect.

  **Unit 44 found one and the ratchet is now at 5:** the subdivision
  **lot-pricing lock** (`POST /api/parcels/:id/pricing-rules/lock`). It writes
  every child lot's `listPrice`, and `lockedGrid` preserved only the OUTPUT —
  the `rules` and `basePriceSource` that produced it live in the SAME MUTABLE
  ROW the lock updates, so editing them afterwards leaves the grid and destroys
  its explanation. The exact mirror of the note-payoff path in `MUST_NOT_ADOPT`.

  It records **no Scenario**, deliberately: a per-lot price grid carries no
  `total_cost`, `profit` or `cap_rate`, and adding a sixth engine so it could
  would be the ratchet-gaming move. A test asserts the absence.

  **Why it prompts for no outcome — and a correction to how unit 44 first
  stated it.** The lock passes `reviewDueAt: null`. Unit 44's ledger entry said
  the blocker was the OUTCOME_KINDS vocabulary being shaped for a single
  position; reading `OutcomePrompt.tsx` afterwards showed that is imprecise and
  the real reason is stronger:

  > **A decision with no Scenario has nothing for an outcome to be measured
  > against.** Calibration compares a *predicted* metric to a *realised* one.
  > The lock records no Scenario (correctly — a price grid carries none of the
  > shared metrics), so even a perfectly-fitting outcome kind would yield a
  > measurement with no forecast to compare it to.

  `OutcomePrompt`'s `ANSWERS` table compounds it: `measures` is keyed to KIND
  alone (`sold` → `profit`, `acquired` → `total_cost`), and its own comment
  justifies that with *"both ids are produced by the flip engine that records
  these decisions"* — true when the flip analyzer was the only recorder, and no
  longer true in general. Nothing is broken today only because the lock never
  sets a review date, so the prompt still sees flip decisions exclusively.

  **So lot pricing is deliberately decision-only: the reasoning is preserved,
  and no calibration is claimed.** That is a complete state, not a half-built
  one. Making it calibratable is a real design question — whether a price grid
  becomes a Scenario with a per-lot metric vocabulary — with weight, and it
  should be decided rather than drifted into. Do NOT wire a review date here
  first; that would produce an unanswerable question.

  **(c) Measure actuals somewhere — VERIFIED as a build, not a wiring job.**
  Unit 27 checked the premise: **no column in this repo holds what a deal
  actually returned.** `deals.analysisResults` are forecasts
  (`expectedSalePrice`, `netProfit` are projections); `lead_conversions.dealValue`
  is realised but keyed to a LEAD for ML attribution with no path to a decision;
  `offers` holds amounts offered, never realised. Zero hits for
  `actualSalePrice` / `realizedProfit` / `actualProfit` across the schema.
  So calibration will report `unmeasured` forever until something records one.

  **Do NOT link `lead_conversions` by property or lead id.** It is the only
  realised money in the repo and the match would be a heuristic — the exact
  reasoning unit 23 refused when it added a real `decision_snapshot_id` column
  rather than matching offers to decisions by property. A calibration built on
  mis-matched pairs is worse than one that honestly says `unmeasured`.

  **Recommended shape:** an OPTIONAL amount field on the `OutcomePrompt` card,
  shown only for TERMINAL answers ("Sold"/"Acquired"). This does not contradict
  unit 24's "asks for NO numbers" — that rule exists so a figure is never typed
  under duress to clear a card. Asked at the one moment the operator genuinely
  knows, and blank → `actuals: []` → still `unmeasured`, the rule to keep is
  **never coerce**, not **never ask**. `still_open` must never gain the field:
  an unresolved position has no realised number by definition.

  **A note on UI gates, learned in unit 24.** The client has its own ratchets
  and they bite: `acreos/prefer-verbs-canon` (one verb vocabulary in
  `@/lib/labels` — a bare `"Cancel"` fails), and `animationVariantNames` (the
  shared stagger variants are `hidden`/`visible`; `animate="show"` leaves the
  whole list stuck at opacity 0 and throws nothing). Copy an existing card as
  the template — `ParcelAlerts.tsx` or `OutcomePrompt.tsx` — and run the FULL
  suite, not just the new file's test.

Note the table-count ratchet is strict down-only (currently 759, north star
≤450) — a new table needs a deliberate bump with a written justification in
`scripts/ratchets/table-count.json`.

## 5. What must NOT be rebuilt or reconsidered

- **Do not create a second receipt system.** Generalise
  `autopilot/proofReceipt.ts`.
- **Do not create a second evidence-acquisition architecture.** The provider
  registry (cache, circuit breaker, credit deduction, licence gating) is real
  and good. The Evidence Fabric only *records* what it learned.
- **Do not add a source-registry, predicate or resolved-value table.** Sources
  live in `data-licenses.ts` (code), predicates in `shared/evidence/claim.ts`
  (typed registry), and the resolved value is a pure recomputable projection.
- **Do not reuse a `solene_*` or founder decision table for customer state.**
  BI5: Founder OS is a control plane, not a second product database.
- **Do not relitigate the DO-NOT-DO list** in `CLAUDE.md` — five customer doors,
  four founder doors, no new nav entries, no platform money custody, BYO send
  rails, no residential-comps data plane, refuse-not-fabricate, founder-only
  hard stops. Only the founder can rescind one.
- **Do not raise a ratchet baseline to make a gate pass.** Fix the occurrence.
  When a count legitimately drops, lower it in the same commit.

## 6. Audit claims that HEAD disproves

The Master Audit inspected a public GitHub page, not the source. Correct before
acting on any of these:

| Audit says | HEAD says |
|---|---|
| ActionReceipt is absent | Exists, hash-chained + prediction-sealed, but only on the founder plane |
| Evidence has no provenance | Acquisition-side provenance is strong (`LookupResult`, `DATA_LICENSE_REGISTER`); it died at the *write*, which is now fixed |
| No kernel/pack seam | Exists (`autopilot/domainPack.ts` + `check-kernel-boundary.mjs`) — on the founder plane; the customer side still has none |
| README names Pax/Sophie/Atlas | Still true, and still worth reconciling — but there are more agent identities than the README lists |

## 6a. Claims THIS PROGRAM made that HEAD disproved

The rule in §6 — verify a premise before implementing it — is easy to apply to
the audit's stale claims and hard to apply to one's own. It has already failed
once here, so it is recorded with the same weight:

| This program wrote | HEAD says |
|---|---|
| "BRRRR still computes inline, outside the registry" (`canon.ts`, units 12–15) | **`BRRRR` appears nowhere in this repository.** The only occurrence of the string was that note. There was no inline arithmetic to register because there is no BRRRR feature. Corrected in unit 16. |
| "Two customer-facing webhook rails, both reachable today" (unit 42, draft) | **The public rail is not mounted at all.** `registerPublicApiV1` has zero callers, its UI page is not routed in `App.tsx`, and `/api/v1/*` is a passthrough alias to `/api/*`. Caught before the entry shipped — by re-reading `BLOCKERS.md` B7, which had already recorded it. Corrected in B8. |

The second row is the rule working rather than failing, and it is recorded for
the same reason: **the check that caught it was reading what this program had
already written down.** A prior unit's verified finding is worth as much as a
fresh grep, and cheaper.

The lesson is not "be careful with gap notes." It is that **a gap note is a
factual claim about the repo and decays exactly like the audit's do.** Before
implementing any item from §4, grep for the thing it says exists. A remaining-gap
sentence written three units ago has the same standing as an audit written
against a stale snapshot: none, until re-verified.

## 7. Standing verification discipline

From `CLAUDE.md`, and it has bitten this repo repeatedly: **a green agent report
is a hypothesis.** Run the gates yourself. Hunt "built but unwired" specifically
— new route files never mounted, services with zero call sites, schema without
migrations. `npm run lint:reachability` catches it and caught this program twice.

**Never pipe `npm run check` into `tail`.** The pipeline's exit code is `tail`'s,
so the run reports success while a ratchet is failing several lines above the
part you read. That happened in unit 39: `colon-any` was over baseline and the
command reported exit 0. Redirect to a file and echo `$?`:

```
npm run check > /tmp/check.log 2>&1; echo "EXIT=$?"
```

The same applies to any gate whose signal is the exit code rather than the last
lines of output.

**A mutation that applies is not a mutation that tests anything.** Unit 52's
harness required the mutated file to differ from the original before it believed
the result — and still accepted a no-op: an unused marker inserted into the
constitution entry produced a real diff, so the harness ran the suite, the suite
stayed green, and the assertion looked survived-and-therefore-weak. It was
neither; the mutation never touched the value under test. Anchor each mutation to
the **exact expression the assertion reads**, and treat "diff is non-empty" as a
precondition, not as evidence.

**A truncated grep can turn a live finding into a dismissed one.** Unit 50 nearly
concluded `routes-elite-features.ts` was dead code because `| head -3` cut the
output above `routes.ts:2544`, where `registerEliteFeatureRoutes(app)` is called.
Never truncate a reachability check.

**A comment naming a symbol makes it look REACHED.** `lint:reachability`
detects references by substring, so `// TODO: FooService does not expose bar()`
counts as a production call site for `FooService`. Unit 53 hit this from the
other side: deleting a stale TODO pushed `unreached-exports` from 654 to 655
with no code added. Two consequences. First, when this gate fails after a
cleanup, check whether you deleted a *comment* before concluding you built
something unwired — verify by re-adding it. Second, the 654 baseline contains an
unknown number of comment-only "references", so a symbol can be un-hidden by
tidying prose; that is the gate working, not a regression, and it is handled by
an allowlist entry naming the mechanism rather than by raising the baseline.

**A stale TODO is a factual claim about the repo, and decays like any other.**
`GET /admin/verifications` returned a hardcoded empty array under a note reading
"the service exposes no listAllVerifications() — state lives in an in-memory
per-process store". Both halves had been false since the DB-backing wave, and
the note is *why* the one correct, org-scoped method on that service was never
called. §6a's rule — a gap note has no standing until re-verified — applies to
TODOs in code exactly as it applies to audit findings and to this program's own
write-ups.

**A reference scanner that reads prose as code fails in BOTH directions.**
`lint-reachability.mjs` tokenises identifiers across every production file, and
`scripts/` is a production root. Unit 53 hit it one way — deleting a stale TODO
that named a class made the class newly "unreached". Unit 54 hit it the other —
freezing 136 `path.ts::method` keys in a tenancy debt register made
`productEvolutionEngine`, a module orphan, look alive, and the count fell 654 →
653 asking to be locked in. **Do not lower a baseline you cannot explain.** The
fix in both cases is to name the mechanism: an allowlist entry for the first, and
`SYMBOL_REGISTERS` (the linter's own `SELF` exemption, generalised) for the
second. Any future file whose purpose is to ENUMERATE offending symbols belongs
in that set before its first run.

**The follow-up question after any isolated defect:** *does this repo already
have a gate that should have caught it, and what is that gate's scope?* Unit 54
came straight out of unit 53 by asking it. `check-org-scoped-fetch.mjs` had the
right rule, ran in CI, and walked one layer. That is the same shape as units
30–52 — a rule applied to some surfaces and not others — with the twist that the
rule was already **automated**, which makes it read as covered. Worth running
against the other lints: several state their walk in a header comment, and a
header is a factual claim about scope that decays like any other.

**Gate audit, units 54–55, and the two that remain.** Each `scripts/*.mjs` gate
states its walk in a header comment, and a header is a factual claim about scope
that decays like any other. Two were wrong in the same way — the rule was real,
automated, and pointed at one layer:

| gate | declared harm | walked | fixed |
|---|---|---|---|
| `lint:org-fetch` | cross-tenant reads | `server/storage*` only | unit 54 → `+server/services/**` |
| `lint:no-fabrication` | *"lying with a confident UI"* | server fact paths only | unit 55 → `+client/src/**` |

Checked and correctly scoped, so do not re-audit: `lint:prefetch-authority`
(`client/src`, and the authority file it exempts is a client file),
`lint:browser-safe-shared` (`shared/`, which is the whole point),
`lint:boundaries` (walks `shared/` and `client/src` because it polices imports
INTO them), `check-org-leading-index` (schema files, where indexes are
declared), `lint:schema-migrate-mirror` (`shared/schema*` against
`scripts/migrate.mjs` — both halves of the mirror). `lint:reachability` walks
`server`, `client/src`, `shared`, `scripts` — the widest of them, and unit 54
showed the cost of that width rather than a gap in it.

**Being automated is what makes a gate read as covered.** That is the trap in
both units: nobody re-reads the walk of a lint that has been green for months.

**A comment is a factual claim about the code, and this program has now found
four load-bearing ones that were false.** Unit 53: a TODO saying a service
exposed no listing method, which is why the one org-scoped method on it was
never called. Unit 55: a lint header claiming a scope it did not walk. Unit 56: a
metering note false about two of its six endpoints. Unit 57, the worst: an
`App.tsx` comment stating *"the dunning API is founder-only (requireFounder on
the whole router)"* — the router had `isAuthenticated` and nothing else, and a
2026-07-11 sweep gated the PAGE on the strength of that sentence and moved on.

The generalisation is not "distrust comments". It is that **a comment asserting
something about a DIFFERENT file is an unverified cross-reference**, and those
are exactly the claims worth converting into assertions. When a comment says
"X is gated / X is deleted / X has no consumer / X is covered", open X. If it is
true, the cheapest way to keep it true is a test that reads both files — which is
what `dunningFounderOnly.test.ts` does, asserting the page gate and the API gate
as a pair because the failure was one existing and reading as evidence for the
other.

**Scoping a service is not finished when its own router is fixed.** Unit 59
scoped `dueDiligencePods`, wrote a test over `routes-due-diligence.ts`, and the
test went green while `routes-ai-operations.ts` still served
`GET /api/ai-operations/due-diligence/:id` from the same unscoped method via a
dynamic import. **The compiler caught it, not the test** — the signature change
was load-bearing, which is an argument for changing signatures rather than
adding optional parameters when you scope something. The test now sweeps every
file under `server/` for callers; a per-router assertion is a per-router
guarantee.

**"Has the org and does not use it" is the harder half.** Unit 59's seven
research endpoints all carried `getOrCreateOrg` and passed nothing to the
service. A middleware audit sees them as fine; only the call site shows it.
Both halves are now asserted separately in `dueDiligenceTenancy.test.ts` — the
registration line AND the argument list — because a checker that looks at one
reports the other as safe.

**Watch for the tenant derived from an unscoped fetch.** `researchOwner` scopes
its lead join by `property.organizationId`: the org of a row fetched by bare id.
Downstream code that looks *more* rigorous than upstream code is a signal, not a
comfort — the derived predicate inherits whatever the first query got wrong, and
it makes the file read as careful.

**Units 52–63, in one pass.** Twelve units; the second half is one thread.

| unit | what | why it survived |
|---|---|---|
| 52 | the last `prose-only` decision, and `/negotiation` — a 607-line AI destination no nav ratchet could see | it is in no nav module and nothing links to it |
| 53 | **any org could read, mutate and approve any other org's KYC file** | the tenant key was designed, migrated, indexed — and wired to nothing |
| 54 | the tenancy lint had a real rule and **one layer** | being automated is what makes a gate read as covered |
| 55 | the fabrication gate named the UI and **scanned the server** | same shape, different hard-stop |
| 56 | any org could read and **overwrite** another's document text | the list endpoints in the same router already passed the org |
| 57 | a **client route guard** was the only gate on AcreOS's billing console | an `App.tsx` comment said the API was founder-only; it was not |
| 58 | two copies of "who is the founder", both missing `FOUNDER_USER_IDS` | one of them claimed parity with the canonical file in a comment |
| 59 | one router, two gates, split along the **URL parameter** | `:propertyId` handlers gated, dossier `:id` handlers not |
| 60 | the org accepted at the front door and **dropped one call deep** | rule 1 asks whether a method mentions an org; this one did |
| 61 | **rule 2**, and a live cross-tenant write found on its first run | four units had found this shape by hand first |
| 62 | 63 findings triaged down to the three a customer can reach | a register nobody reads enforces nothing |
| 63 | the outcome of lead #42 written onto **prediction #42** | two ids of different entities share a numeric space |

**The question that generated most of them:** *does this repo already have a gate
that should have caught this, and what is that gate's scope?* Units 54 and 55
came straight out of 53. Unit 61 came out of doing 56/59/60 by hand three times.

**And the one that generated 63:** *does the ROUTE's parameter name the same
entity as the SERVICE's parameter?* A tenancy fix that adds an org argument to a
wrong-entity call makes the call cross-tenant-safe and still wrong.
