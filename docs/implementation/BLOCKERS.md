# BLOCKERS

Items that cannot proceed without something this session cannot safely supply.
A blocker does not stop the program — it stops one item. Record it, state the
unblock condition, move to the next unblocked work.

**None of the work completed so far was blocked.** Everything below is work
identified as valuable and deliberately not attempted.

---

## B1 — Live-database verification of the two new tables

**What:** `evidence_claims` and `decision_snapshots` are verified by unit tests
against the pure kernel, by the schema→migration mirror gate, and by tsc. They
have **not** been exercised against a real Postgres.

**Why blocked:** `DATABASE_URL` is not set in this environment (the pre-commit
`check-agent-claims` hook reports the same and fails open).

**Unblock:** run `npm run db:push` (or apply `migrations/0227` + `0228`) against
a dev/staging database, then exercise
`POST /api/decisions` and `GET /api/properties/:id/evidence`.

**Risk if skipped:** low but real — the mirror gate proves a `CREATE TABLE`
exists in the deploy path, not that the DDL and the Drizzle types agree on every
column. This is exactly the "schema shipped with no migration would have 500'd
on deploy" class named in CLAUDE.md, one step further along.

---

## B2 — Production deploy of the two migrations

**What:** `migrations/0227_evidence_claims.sql` and
`migrations/0228_decision_snapshots.sql` are registered in `scripts/migrate.mjs`
(the Fly `release_command`) and are idempotent, so they apply on the next
deploy.

**Why blocked:** deploying to production is outside this session's authority.

**Unblock:** founder deploy. No data migration or backfill is required — both
tables start empty and both are purely additive.

---

## B3 — Which agent identities are customer-facing

**What:** BI101 wants ONE primary customer-facing Pax, with specialists as
internal capability bundles unless a separate identity demonstrably helps. The
repo has Pax, Solene, Atlas, Sophie, Beatrice, Iris and Soren surfaces plus ~30
`solene-*` schema modules.

**Why blocked:** most appear to be founder-plane, which BI25 explicitly permits.
Consolidating a *founder* agent because a *customer* rule says "one Pax" would
be a misapplication of the audit. Determining which are genuinely customer-facing
requires the reconnaissance report, and any consolidation is a founder product
decision, not a correctness fix.

**Unblock:** founder ruling on which named identities customers should ever see.

---

## B4 — Parcel / Property separation

**What:** `properties` conflates cadastral identity with economic state
(BI9). Separating them is the largest remaining Reality Graph delta.

**Why not attempted:** it touches `properties`, the single most-read table in
the repo, with ~150 write sites. V42 explicitly lists high-risk refactors to
avoid *even pre-customer*. Doing it safely needs a staged migration with a
compatibility projection, and it should follow — not precede — the Opportunity
and Relationship primitives that determine what the split needs to support.

**Mitigation already in place:** `evidence_claims.subjectType` accepts `parcel`
today and cadastral facts are already claimed against it, so the separation
becomes a `subject_id` backfill rather than a re-interpretation of recorded
history.

**Unblock:** not blocked by anything external — blocked by sequencing. Do
Opportunity + Relationship first.

---

## B5 — `communications.ts` direct-mail retry can double-print

**What:** `CommunicationsService.sendDirectMailWithRetry` (server/services/
communications.ts:323) recurses up to `MAX_RETRIES = 3` around
`lobService.sendLetter`. `lobService` catches provider errors internally and
returns `{ success: false, errorType }`, so a network failure *after* Lob
accepted the letter is classified retryable and the code sends again. That is a
real double-print path, and it is the exact scenario `outward_actions` was built
for.

**Why not fixed in this session:** two reasons, both about doing it right rather
than fast.

1. **Key semantics are a product decision.** A key of `lead:{id}` blocks a
   deliberate second mailing to the same lead months later. A key of
   `lead:{id}+contentHash` blocks re-sending the *identical* letter — arguably
   correct, arguably not. Choosing wrong silently suppresses mail a customer
   meant to send, which is a worse failure than the one being fixed.
2. **Availability posture on a money path.** `withOutwardAction` writes to the
   database before the provider call. If that write fails, mail that previously
   would have sent now fails. Whether the boundary should fail-open or
   fail-closed on *its own* infrastructure is a founder call, not an
   implementation detail.

**A safe interim exists:** thread a key generated once at the top of
`sendDirectMail` through the recursion. Retries within the chain are then
deduped (the live bug is fixed) while a later deliberate re-send generates a new
key (no behaviour change). It protects the in-process chain only, which is
exactly the scope of the bug, since process death ends the chain anyway.

**Unblock:** founder answer on (1) and (2). The interim above needs neither and
could ship first.

---

## B6 — the direct-mail recovery queue can never drain

**What:** `communications.ts:438` enqueues
`apiQueueService.enqueue('lob', 'sendLetter', …)` when direct-mail retries are
exhausted. `apiQueue.executeJob` handles **only** `operation === 'sendPostcard'`
for `type === 'lob'` (server/services/apiQueue.ts:168) and throws
`Unknown Lob operation: sendLetter` otherwise. Every such job therefore fails
its 2 retries and lands in `failed`, permanently.

**Consequence:** the recovery path for mail that failed all three send attempts
is dead. Nothing is lost silently — the jobs are visibly `failed` — but the
recovery they exist to perform never happens.

**Why not fixed in this session:** implementing `sendLetter` in `executeJob`
would make previously-dead jobs start printing physical mail. Dormant sends
firing on deploy is precisely the class of change that must not be made blind,
without a database to inspect the existing `api_jobs` backlog.

**Unblock:** inspect the `api_jobs` backlog for `type='lob'` rows, decide
whether any should still be sent, then implement the operation. The
outward-action boundary should be applied at the same time — `job.id` is the
natural idempotency key, since the queue retries that exact row.

---

## B7 — findings from the reconnaissance sweep, recorded not actioned

Verified by the adversarial pass and left for a later unit:

- **`costBasisTracker.ts` and `taxOptimizationEngine.ts` have zero callers.**
  `routes.ts:2166` records why: *"routes-tax-optimization deleted 2026-07-29
  (Nothing-lies wave A)"*. The `cost_basis` table itself is real, migrated and
  org-scoped — it is the closest thing the repo has to a **Holding**, which
  makes it a MIGRATE candidate rather than a DELETE one.
- **`registerPublicApiV1` has zero callers**, and `routes-api-keys.ts` is
  orphaned (the repo's own `routeManifest.ts` says so). Plausibly deliberate
  under the "no public API before ~50 customers" expansion gate — worth
  confirming rather than assuming.
- **`parcel_snapshots` has no index array** yet is read on `(state, county,
  apn)` and `(source, sourceId)`.
- **`notes_receivable` has zero inserts** repo-wide and is read by
  `kpiStreamingService.ts`.
- **`properties` has no unique `(organizationId, apn)`** — the identity
  constraint the Reality Graph work will need.
- **Two same-named mail transports** (`directMail.ts` class vs
  `directMailService.ts` functions) — see `ARCHITECTURE_DELTA.md`, disposition
  MERGE.

---

## B8 — A second webhook rail exists, fully built and entirely unmounted

**DECIDED 2026-08-13: keep deferring** (founder ruling). The trigger has not
fired, and the entry's own reading stands — this is deferred infrastructure
behaving correctly, not rot. No rail is retired, no migration is started, and the
better-engineered `api-v1` rail stays unmounted until the ~50-customer trigger.

**What the ruling changed in code (unit 85):** the one standing rule below is now
enforced rather than written down. `webhookEventCatalogue.test.ts` pins the
legacy rail's emitter set at exactly `lead.created`, as an INVERTED assertion —
it does not claim the count is right, it requires that adding an emitter be a
deliberate act that reopens B8. Wiring `webhookDealCreated`, a two-line change
that looks like an improvement, now fails CI and asks for the rail decision
instead. Two more assertions hold the premise: the five wrappers must stay (they
are correct code the survivor rail will want) and `registerPublicApiV1` must stay
unmounted — if it is ever mounted, the deferral has ended and this whole block
should be revisited rather than maintained out of habit.

**Found:** unit 42, while deriving the webhook event catalogue.
**Was blocked on:** a founder decision, at a trigger that has not fired.

**A correction first, because this entry was nearly written wrong.** The draft
said "two customer-facing rails, both reachable today." `B7` already recorded
that `registerPublicApiV1` has zero callers, and checking HEAD confirmed it: the
public rail is **not mounted at all**. The §6a rule caught a claim of this
program's own making before it shipped. What follows is the verified state.

### What is actually live

| | legacy rail | public v1 rail |
|---|---|---|
| store | `organization_integrations.credentials.endpoints` (jsonb) | `webhook_subscriptions` (real table) |
| registrar | mounted | `registerPublicApiV1` — **never called** |
| API | `/api/webhooks` | `/api/v1/webhooks` — see below |
| UI | Settings → Webhooks (live) | `client/src/pages/settings/api-keys.tsx` — **not routed in App.tsx**, and it calls `/api/admin/api-keys` in the unmounted `routes-api-keys.ts` |
| events declared | 36 | 8 |
| **events emitted** | **1** — `lead.created`, `routes-leads.ts` | 3, but from `server/api-v1/*` files that are never registered |
| signing | `X-AcreOS-Signature: sha256=<hex>` | `AcreOS-Signature: t=…,v1=…` (Stripe-style) |
| retries / DLQ / delivery log | 3 in-process attempts, none, none | 5 attempts + backoff table, DLQ, `webhook_delivery_log` |

**`/api/v1/*` is not the public API.** `routes.ts` mounts
`app.use("/api/v1/{*splat}", …)` as a passthrough that rewrites `/api/v1/x` to
`/api/x`. So a client calling `/api/v1/webhooks` today reaches the **legacy**
route. The versioned prefix is an alias, not a separate surface.

So there is one live rail with one emitter, and one complete, better-engineered
rail sitting unmounted — which is **consistent with the expansion ladder**: *no
public API before ~50 customers*. This is deferred infrastructure behaving
correctly, not rot.

### The decision, when the trigger fires

At ~50 customers the public API is mounted. At that moment the Settings →
Webhooks panel points at the weaker rail, and someone must choose whether
customer-facing webhooks move to `webhook_subscriptions` (durable rows, delivery
log, DLQ, Stripe-compatible signatures) or stay where they are. Either answer
migrates live integration config, which is why it is not a refactor.

### What was done instead, and why none of it is wasted

Units 38–42 hardened the live rail without assuming an answer: the signing
secret is redacted from reads and encrypted at rest, endpoints added through the
panel actually fire, an unsignable endpoint is refused rather than delivered to
unsigned, the event vocabulary is shared and validated, and non-live events are
badged honestly. Every one of those is behaviour the survivor needs, and none
deepens the duplication.

### The one thing NOT to do

Do not wire the five uncalled convenience wrappers
(`webhookLeadStatusChanged`, `webhookDealCreated`, `webhookDealStageChanged`,
`webhookPaymentReceived`, `webhookCampaignResponse`) into product code before
this is decided. Adding emitters to the legacy rail is precisely the change that
would make it expensive to retire — and `webhookEventCatalogue.test.ts` will
force the catalogue to admit it the moment anyone does.

---

## B9 — The VA task subsystem does not work, end to end

**RESOLVED by building it** (unit 78, founder ruling 2026-08-13). The founder's
answer named the scope: *"real tables + migration for VA tasks and the SOP
library, wired to the existing routes."*

**What was built:**

- **`va_tasks` and `va_sops`** — migration `0235`, mirrored in
  `scripts/migrate.mjs`, org-leading indexes, `ON DELETE SET NULL` on every
  context link (a completed task is a record of work done and stays true after
  the lead it was about is deleted; tenant deletion still cascades through
  `organization_id`). `table-count` 761 → 763 with the reasoning in the bump note.
- **An org-scoped service layer.** Every persisting function takes
  `organizationId` as a required parameter and filters on it;
  `VaTaskNotInOrgError` covers both "not yours" and "not there" so a caller
  cannot tell them apart, and routes render it 404.
- **The routes, wired.** `POST /api/va/tasks` and `PUT /api/va/tasks/:id` store
  and update instead of refusing; `GET /api/va/tasks` and `GET /api/va/tasks/:id`
  are new, because a subsystem that can store a task and never show it back is
  the same dead end in a different place; `GET/POST /api/va/sops` is the library
  `SOP_LIBRARY_KEY` was declared for; and metrics, audit-trail and verify read
  the table.

**Three things worth recording beyond "it was built":**

1. **A type error that would have 500'd on deploy, caught by checking.** The
   original `VaTask` interface declared `assignedToUserId: number` — and nothing
   ever contradicted it, because there was no column to check it against.
   `users.id` is a **varchar**. An integer column would have failed at
   `CREATE TABLE` with *"Key columns are of incompatible types"*. This is exactly
   the class CLAUDE.md names, found because the schema was written against the
   real `users` table rather than against the interface that described it.
2. **The audit trail was fabricating the assistant's own account of the work.**
   It carried `reasoning: t.completionNotes || "Task completed as assigned"` — a
   default sentence presented as what the VA said they did. Removed; an absent
   note is an absent note.
3. **Recurring tasks were deliberately NOT built.** `GET /api/va/scheduled` read
   `settings.va_scheduled_tasks`, which had exactly one reference in the
   repository — that read. A schedule table with no runner would be the
   built-but-unwired defect this repo keeps finding, so the endpoint refuses with
   501 naming what is absent, rather than returning `[]` from a store with no
   writer. **This is the one part of B9 still open**, and it is a smaller
   question than the one just answered.

Ratchets: `as-any` 1396 → 1391 and `colon-any` 3006 → 2992 (the casts and `any[]`
annotations were all reading a blob nothing populated), `unreached-exports`
654 → 653 (`generateTaskId` / `generateSopId` minted `task_<ts>_<random>` ids
because there was no database to allocate one — fabricated identifiers, and
unreached besides).

**Found:** unit 48→49, by following unit 48's question ("does anything read this
back?") across the rest of `organizations.settings`.
**Was blocked on:** a founder decision — build the persistence layer, or remove
the subsystem. The record below is the state at the time the decision was asked
for.

### `organizations.settings.va_tasks` has NO CREATOR anywhere

`services/vaManagement.ts` declares `const VA_TASKS_KEY = "va_tasks"` — and
**never uses it**. `SOP_LIBRARY_KEY` beside it is likewise declared and unused.
Those two constants are the persistence layer that was never written.

The only write to the key in the entire repo is a `jsonb_set` inside
`POST /api/va/tasks/:id/verify`, which read-modify-writes an array that nothing
ever populates.

### What each route actually does

| route | what it does | what it looks like |
|---|---|---|
| `POST /api/va/tasks` | `createTask` is a **pure function** — stamps an id and timestamps and returns the object. Nothing saved. | 200 with a task-shaped body |
| `PUT /api/va/tasks/:id` | takes `{ task, updates }` **from the request body**, merges them in memory, returns the result. Never touches storage. **Ignores `:id` entirely.** | 200 with an updated task |
| `GET /api/va/metrics` | computes over `settings.va_tasks`, which is always `[]` | zeros, reading as measurements |
| `GET /api/va/audit-trail` | same array | an empty trail |
| `POST /api/va/tasks/:id/verify` | read-modify-writes that array | can never find a task |
| `GET /api/va/scheduled` | reads `settings.va_scheduled_tasks` — **one reference in the whole repo**, this read. No writer exists. | always `[]` |

**No client caller for any of them.** `command-center.tsx` calls a different VA
route family (`/api/va/agents`, `/api/va/actions`, `/api/va/briefings/latest`).

### What unit 49 changed, and what it deliberately did not

The two routes that **claimed a save** now refuse with 501 and a message naming
what is missing. A caller could not previously tell a stored record from a
fabricated one, and that is not a product decision — it is a lie, and removing
it is in scope.

Everything else is left alone. Building persistence means a table, a migration
and a UI; removing the subsystem means deleting six reachable API routes. **Both
are the founder's call**, and either would discard a refusal written in the
meantime, so nothing further was invented.

The read-side routes were NOT changed: `[]` and zeros are accurate for an empty
collection. What is wrong there is that the collection can never be non-empty,
which is the same decision above rather than a separate defect.

### The related item

`va_scheduled_tasks` should be resolved with this one. A read with no writer
anywhere is the same subsystem's other half, and the same two answers apply.

---

## B10 — Two note-payment data models, and one writer that respects neither rule

**DECIDED 2026-08-13 (founder ruling): `acquired_notes` / `note_payments` is the
successor.** The legacy `notes` / `payments` family is terminal, its writers are
a migration list, and this entry's named deletion candidate is deleted.

### What unit 87 did with the ruling

**Deleted `POST /api/notes/:id/record-payment`.** It had no caller — the
record-payment modal posts to `/api/notes/:id/payments`, the cents route, with an
Idempotency-Key — and no OpenAPI entry and no test referenced it. Five things
were wrong with it, and the ruling is what turns "fix them" into wasted work:
float principal/interest math, no transaction, escrow credited BEFORE the payment
insert, **a note UPDATE with no organization predicate** (rule 2's shape, on
money — the org-scoped SELECT above it gated the path in practice, which is why
it was never exploitable), and `const updateData: any` over a money column.
`colon-any` 2992 → 2990.

**Built the migration list as a RATCHET, not a document.**
`tests/unit/legacyNoteModelIsTerminal.test.ts` derives the set of files writing
`notes`/`payments` from source and pins it strictly down-only:

| file | what it does |
|---|---|
| `routes-subdivisions.ts` | creates a seller-financed note when a lot sells |
| `services/achAutopay.ts` | advances the note after an autopay debit clears (already uses `splitPaymentCents`) |
| `services/atrSafeHarbor.ts` | stamps the ability-to-repay determination |
| `services/propertyTaxService.ts` | escrow credits/debits (4 writes) |
| `storage/noteRepo.ts` | the legacy repository itself — the file a migration replaces rather than amends |

A NEW legacy writer fails the build; migrating one passes and must lower the list
in the same commit. A hand-maintained migration list is precisely the artifact
that goes stale between a decision and its execution — this program watched that
happen to a deletion ledger, a feature-flag catalogue and a reseller feature set
in the same week.

**A correction to this entry, found while checking it.** It said *"three of the
four payment recorders use `splitPaymentCents` — `achAutopay`, `routes-borrower`
(twice), and `paymentApplication`"*. Against HEAD that is three CALL SITES in TWO
files: `paymentApplication` deliberately accepts a PRE-SPLIT so the module stays
pure and testable, and its own contract names `notePaymentMath.splitPaymentCents`
as the upstream source. True in spirit, not a call — and now pinned as the
distinction it is, so nobody "fixes" `paymentApplication` into calling it.

### Still open, and it needs a database

The actual data migration — moving legacy rows into the cents family and
retiring the five writers — is not attempted. It is money code and `DATABASE_URL`
is unset (B1), so a rewrite could not be integration-tested. **Until then, do not
"tidy" the remaining legacy writers.** Three of them do float math today; making
one locally correct is the change most likely to be wasted, and the ratchet
measures the migration rather than the tidying.

**Found:** unit 49→50, by asking whether `routes-elite-features.ts`'s other
routes shared the shape unit 49 fixed.
**Was blocked on:** an architectural decision with founder weight — which note
data model is canonical.

### Two families, both live

| | legacy | cents family |
|---|---|---|
| tables | `notes`, `payments` (`shared/schema.ts`) | `acquired_notes`, `note_payments` (`shared/schema/notes-vertical.ts`) |
| money | `numeric("current_balance")` — decimal strings, read with `parseFloat` | `bigint("current_balance_cents")` — integer cents |
| writers | `achAutopay`, `atrSafeHarbor`, `propertyTaxService`, `noteRepo`, `routes-borrower`, `routes-elite-features` | `routes-notes`, `routes-servicer`, `portfolioPnl`, `form1098Batch`, `investorStatementBatch`, `servicerRemittance` |

The house rule in `shared/finance/cents.ts` is explicit — *money is SUMMED and
COMPARED in integer cents, never in JS floats* — and it names
`server/services/notePaymentMath.ts` as the layer that "got this right from day
one". The cents family follows it. The legacy family predates it.

### The specific writer that respects neither

`POST /api/notes/:id/record-payment` (`routes-elite-features.ts:45`):

1. **Reimplements the principal/interest split in floats.**
   `interestDue = currentBalance * monthlyRate`, then
   `principalPaid = paidAmount - interestDue`. The canonical
   `splitPaymentCents` exists and **three of the four payment recorders use
   it** — `achAutopay`, `routes-borrower` (twice), and `paymentApplication`.
   This one does not. The units 30–46 shape, on money.
2. **Not transactional.** A bare `db.insert(payments)` followed by a separate
   `db.update(notes)`. A failure between them leaves a **recorded payment
   against an unreduced balance**. `storage.createPayment` — which this route
   bypasses — wraps both in `withTransaction` with `SELECT FOR UPDATE` and an
   optimistic-lock version check.
3. **Credits tax escrow BEFORE the payment insert**, so a later failure leaves
   an escrow credit with no payment behind it.

**No client caller.** The record-payment modal calls `/api/notes/:id/payments`
in `routes-notes.ts` — the cents-family route, which validates with zod, holds
the note row inside a transaction, and returns a schedule and delinquency
outcome. That is the good implementation, and it is the one the product uses.

### Why this was not fixed here

The obvious repair — route the elite handler through `splitPaymentCents` and
`storage.createPayment` — would make it a *correct writer of the legacy model*,
which is work thrown away if the legacy model is being retired. And it cannot
be made to write the cents family without deciding that question.

Refusing it (unit 49's answer) is **wrong here** and the distinction matters:
unit 49's routes stored nothing, so refusing removed only a lie. This route
genuinely persists, so refusing would remove working — if flawed — functionality
from any caller outside this repo.

### The question for the founder

Is `acquired_notes` / `note_payments` the successor to `notes` / `payments`? If
yes, the legacy writers are a migration list and this route is a deletion
candidate. If they are genuinely different products (bought notes vs originated
notes), then the legacy family needs `splitPaymentCents` and `withTransaction`
applied to it, and this route is first in line.

**Until then, do not "tidy" this handler.** Making it locally correct is the
change most likely to be wasted, and the float math is the visible symptom of
the model question rather than the defect itself.

---

## B11 — Meta ads spend on the platform's own ad account

**RESOLVED** (unit 77, founder ruling 2026-08-13). The question was *platform
activity or customer feature*, and the answer was neither of the two options this
entry offered:

> this was meant for me as the founder to run ads for this AcreOS only. Never for
> a customer to be able to run their own ads. That's how it should work properly.

So it is a **platform activity, permanently** — the first branch of "The question"
below. The interim gate becomes the answer, and the work was making that
structural rather than incidental:

- The three routes moved to **`/api/founder/meta-ads/*`**, so the URL states who
  they are for rather than leaving it to middleware nobody reads.
- **`GET …/campaigns/:id/stats` had NO founder gate at all** — `...auth` alone.
  It returns spend, impressions, clicks and cost-per-lead for any campaign id on
  the platform ad account, so any authenticated member of any org could read
  AcreOS's own marketing performance by iterating ids. Gating the spend and
  leaving the reads open is this entry's own finding, one layer down.
- Registered in `shared/governance/constitution.ts` as
  `hard-stop.ads-founder-only-rail` — the **sixth** hard stop, and the second
  outright ban. It is deliberately recorded next to the money-custody ban,
  because they are the same shape judged opposite ways: one platform account is
  fatal when it holds CUSTOMER money and fine when it spends ACREOS's own. The
  only thing keeping them apart is that no customer path exists, so that is what
  `tests/unit/metaAdsFounderOnly.test.ts` asserts.
- **Security fix found on the way in.** The public `POST /api/webhooks/meta-lead-ads`
  verified its Meta signature inline and fail-open twice: no `META_APP_SECRET`
  meant no verification at all, and a caller who simply OMITTED the
  `X-Hub-Signature-256` header skipped the check even when the secret was set. It
  also compared with `!==` (a timing oracle) and hashed `JSON.stringify(req.body)`
  rather than the raw bytes Meta signed, so a VALID delivery could fail to verify.
  That endpoint CREATES LEADS. Replaced by
  `server/middleware/metaWebhookSignature.ts`, fail-closed on both, constant-time,
  raw-body — the same shape as `twilioSignature.ts` and `inboundEmailSignature.ts`.

**Still open, and deliberately not assumed:** if an org is ever to advertise, it
runs on the **org's own connected ad account**, exactly as customer money must.
Nothing is built for that, and the constitution entry says so.

**Found:** unit 50, by asking whether `routes-elite-features.ts`'s remaining
POST routes shared the shape units 49–50 had already found there twice.
**Was blocked on:** a founder decision — delete these routes, or connect them to
the ORG's own ad account. Gated and capped in the meantime (unit 50). The record
below is the state at the time the decision was asked for.

### What it was

`POST /api/meta-ads/campaigns` took `dailyBudgetCents` from the request body
and passed it to `metaAdsService.createLandListingCampaign`, which POSTs
`daily_budget` to `graph.facebook.com/v21.0` against **`META_AD_ACCOUNT_ID`
using `META_ACCESS_TOKEN`** — one platform ad account for every organization.

Gated by `[isAuthenticated, getOrCreateOrg]` and nothing else. **Any member, va
or viewer of any org** could name their own daily budget and bill it to the
platform. No cap. No credit deduction, so no cost attribution. No simulation
guard — `ads` was not even a `SimulatedCategory`, so a dev, CI or staging boot
with those env vars present would have bought real advertising.

### The founder already ruled on this shape, in this file

Twenty lines below the ads routes is the comment block recording the 2026-07-29
deletion of the ACTUM ACH endpoints under *"be the rail, not the provider"*:
they used **one platform `ACTUM_MERCHANT_ID` for all orgs**, so customer money
would have moved on AcreOS's own merchant account.

The Meta ads routes are the same pattern — one platform account for all orgs —
and were never brought under the ruling. A rule applied to some surfaces and not
others, at the highest stakes in the repository: this one is denominated in
dollars per day.

### What unit 50 did, and why not more

- **`requireFounder`** on campaign creation and catalog sync. Spending the
  platform's money is a platform decision, and the constitution's hard-stop
  ("spends >$500 are founder-only") names it.
- **A $500/day ceiling** in code — the same figure as the hard-stop. The founder
  gate does not make it redundant: the rule is *spends over $500 are
  founder-only*, not *spends are unbounded once a founder is on the call*, and a
  typo in a cents field is three orders of magnitude from its intent.
- **`ads` as a simulated category**, in the global default set alongside stripe,
  lob, sms, email and webhooks. A simulated run returns
  `{ simulated: true, campaignId: null }` — **not invented ids**, which would
  leave a caller polling stats for an ad that does not exist.

**Not deleted.** The ACTUM precedent says deletion is how the founder makes that
call, and unit 49's line applies: these routes do something real, so removing
them removes capability rather than a lie.

### The question

Is paid advertising a platform activity (founder buys ads for AcreOS) or a
customer feature (an org advertises its own listing)?

- **Platform activity** → the gate is the right permanent answer, and the
  routes should probably move under `/api/founder/*` with the rest of the
  instrument namespace.
- **Customer feature** → it must run on the ORG's own connected ad account,
  exactly as "be the rail, not the provider" required of payments. Fronting the
  platform's ad account for customer listings is the same re-fronting the
  email-sender ruling forbids, and it has no cost recovery today.

Nothing in unit 50 assumes an answer, and both answers keep the gate until the
second one is actually built.

---

## B12 — A KILLed subsystem whose API is still mounted

**RESOLVED by executing the KILL** (unit 76, founder ruling 2026-08-13 — option 1
below). Deleted: `server/routes-negotiation.ts` + its mount and manifest entry,
`server/services/negotiationCopilot.ts`, `client/src/pages/negotiation-copilot.tsx`
and its seven `components/negotiation/*` satellites, the App.tsx lazy import and
`<Route>`, the command-center catalog row, and
`tests/unit/negotiationCopilot.test.ts` — 293 lines that imported nothing from the
service and re-implemented its objection patterns locally, so it tested a copy of
the code rather than the code.

**The premise was incomplete, and checking it is what made this correct.** This
entry said `/api/negotiation` was the surviving rail. It was not the only one:
`routes-ai-operations.ts` carried three more copilot endpoints on the same
service (`POST /negotiation/session`, `POST /negotiation/objection`,
`GET /negotiation/:id`), with no client caller. Deleting only what this entry
named would have removed a door and left a window. The live capability the
founder kept is `POST /api/ai/negotiation/script` in `routes-core-ai.ts`, which
runs on **negotiationOrchestrator** and is called by the deal detail view behind
the Deals door.

**Two deliberate departures from option 1 as written:**

1. **`/negotiation` KEEPS its `FROZEN_ROUTES` entry.** Option 1 said to drop it.
   Removing it reads as *unfrozen*, and `/api/config/features` serves that list
   to clients still running an older bundle — they get a clean "not available"
   instead of a chunk-load error against a bundle the server no longer has.
   `/vision-ai` already set this precedent (KILL executed, `<Route>` long gone,
   entry retained); the reasoning is now written in `shared/feature-freeze.ts`
   rather than living in one blocker note.
2. **`negotiation_sessions` was NOT dropped.** Dropping it deletes customer rows
   — a founder-only hard stop. The table is allowlisted in
   `scripts/ratchets/reachability.json` for both writer and reader with that
   reason, so it shows up in every gate run instead of disappearing into a
   baseline. **A DROP migration is still open, and it is the founder's call.**

Ratchets: `colon-any` 3009 → 3006, `openai-bypass` 89 → 85 (the copilot held four
direct `chat.completions.create()` calls outside the aiRouter chokepoint — spend
no per-org quota or daily ceiling could see, on a surface nothing called).
Tenancy register: rule 1 −5, rule 2 −4 stale entries removed.

**Found:** unit 52, by the component-name detector added to the Pax-ambient
ratchet.
**Was blocked on:** a founder decision — execute the deletion, or reactivate the
surface. The record below is the state at the time the decision was asked for.

### The state

`docs/company/deletion-ledger.md` carries a **KILL** verdict on the standalone
negotiation copilot: *"Duplicate of the orchestrator, flagged off, no nav"*,
naming three artifacts — `routes-negotiation.ts`, `negotiationCopilotService`,
and `pages/negotiation-copilot.tsx` (607 lines). The orchestrator it duplicates
(`services/negotiationOrchestrator.ts`) is separately **FREEZE (wired)** and
lives on inside Pax through `routes-core-ai.ts`.

The client half is enforced: `/negotiation` is in `FROZEN_ROUTES`, which
`resolveRouteEnabled` checks *before* every other rule including the fail-open
ones, so an unseeded flags table cannot un-hide it.

The server half is not. `server/routes.ts:1343` mounts
`app.use('/api/negotiation', isAuthenticated, getOrCreateOrg, negotiationRouter)`
— reachable by any authenticated user of any org, with no flag check and no
freeze equivalent. The page is unreachable; the API it called is not.

### Why unit 52 stopped at recording it

Unit 49's line: these routes do something real, so removing them removes
**capability**, not a lie — which is the founder's call, not a test author's.
The deletion ledger is the instrument for making it, and the ledger's execution
rule already prescribes the shape (`Errors.gone` — a permanent-failure signal,
not a 404 that reads as a routing bug).

### The two ways out

1. **Execute the KILL.** Delete the router, the service and the page; leave the
   `Errors.gone` stub the deletion-ledger rule prescribes; drop `/negotiation`
   from `FROZEN_ROUTES` in the same commit (the freeze entry exists to hide a
   route that still resolves — `/vision-ai` is already the reverse case: frozen,
   with its `<Route>` long gone). Lower the route/table ratchets in the same
   commit.
2. **Reactivate it.** Then it is a second AI destination and the constitution
   applies: it goes behind `/ai` as a section, or behind the Deals door as a
   tab on the deal it negotiates — not back to a top-level route.

Either way `tests/unit/paxStaysAmbient.test.ts` fails on the change and asks for
the decision to be stated, which is the point.

---

## B13 — Frozen and killed surfaces whose APIs are still gated by the WEAK gate

**Found:** unit 53, while gating the two ungated marketplace satellites.
**Blocked on:** nothing yet — this is a queued task, recorded here because it is
a set rather than a single fix and because one member of the set must NOT be
changed.

`featureGate` (= `requireFlag`) has two escape hatches that unit 51 established
are wrong for a governance gate: an **enterprise-tier bypass** and **failing
OPEN when the flag store errors**. Deletion-ledger FREEZE/KILL surfaces are
governance decisions, not product flags. Current state of the mounts:

| mount | verdict | gate | should be |
|---|---|---|---|
| `/api/marketplace` | FREEZE | `requireLadderFlag` | ✅ unit 51 |
| `/api/investor-verification` | FREEZE (satellite) | `requireLadderFlag` | ✅ unit 53 |
| `/api/buyer-network` | FREEZE (satellite) | `requireLadderFlag` | ✅ unit 53 |
| `/api/deal-rooms` | FREEZE (satellite) | `requireLadderFlag` | ✅ unit 65 |
| `/api/capital-markets` | FREEZE — reactivate at H4 | `requireLadderFlag` | ✅ unit 65 |
| `/api/certification` | KILL — "education revenue stays dead" | `requireLadderFlag` | ✅ unit 65 |
| `/api/negotiation` | KILL | — | **deleted** (unit 76) — the KILL was executed, so there is no gate to choose |
| `/api/white-label` | FREEZE | `featureGate` | **LEAVE IT** (unit 65 annotated why, at the mount) |

**RESOLVED** (unit 65; B12 closed by deletion in unit 76). The three upgrades landed with
`tests/unit/frozenSurfaceGates.test.ts`, which asserts the exception as loudly as
the rule: white-label keeps `featureGate` because that bypass IS the ledger's
reactivation criterion, and the reason is now written at the mount rather than
only in a test nobody finds while standing in `routes.ts` about to fix the
inconsistency.

**White-label is the exception, deliberately.** `featureGate`'s own header says
the enterprise-tier bypass exists *"for legacy reseller / white-label routes
that … are part of the enterprise contract"*, and the ledger's reactivation
criterion for white-label is *"the first enterprise/white-label contract"*. The
bypass IS that criterion, encoded. Tightening it would be a "tighten everything"
pass removing a deliberate decision — the same mistake the founder-bypass note
in `requireLadderFlag` guards against.

The rest are one-line changes plus assertions. Left out of unit 53 to keep that
commit to one subsystem and one story.

### The wider gap this sits inside

`shared/feature-freeze.ts` exists because client flag resolution fails OPEN — an
unseeded flags table would otherwise un-hide every frozen door. The client
checks `isFrozenRoute` before every other rule. **No server gate consults that
list.** The freeze is a client-side control over a server-side surface, and the
two are kept in agreement by hand. Closing that properly means mapping frozen
client routes to their API prefixes in the same module, so one edit unfreezes
both halves — worth doing when B12's KILL/reactivate decision lands, since that
decision determines whether the mapping needs a `gone` lane as well.

---

## B14 — 136 service-layer methods query org-scoped tables without org context

**Found:** unit 54, by extending `check-org-scoped-fetch.mjs` to
`server/services/**`.
**Blocked on:** nothing — this is a triage queue, frozen so the lint could land
and block regressions. Recorded here because it is 43 files and must not be
attempted as one change.

744 storage+service methods touch a table carrying `organizationId`; 556 already
carry org context. The 136 that do not are in the lint's `BASELINE_OFFENDERS`
set, and a stale entry FAILS the lint — so a fix cannot land without deleting
its line.

**Triage order.** 22 of the 43 files are imported by a `routes-*` file and can
therefore receive an id straight from a URL, which is the shape that made unit
53 a live cross-tenant leak:

~~`documentIntelligence`~~ (done, unit 56 — 6 entries retired; it was a live
cross-tenant read AND write of contract text) · `achAutopay` ·
`dispositionOptimizer` ·
`cashFlowForecaster` · `priceOptimizer` · `negotiationCopilot` ·
`sellerIntentPredictor` · `portfolioSentinel` · `marketIntelligence` ·
`decisionsInbox` · `marketWatchlist` · `dueDiligencePods` · `whiteLabelService` ·
`marketPrediction` · `leadScoring` · `leadNurturer` · `dunning` ·
`buyerQualificationBot` · `alerting` · `dealPatternCloning` · `capitalMarkets` ·
`borrower/autopayAuthorizationChallenge`

**What unit 56 learned about triaging this list.** Pick by BLAST RADIUS, not by
entry count. `documentIntelligence` was 6 entries and turned out to be a live
customer surface holding contract text, with a write path hidden inside a GET.
The useful questions, in order: is the router mounted without a flag gate; does
a client page call it; does the table hold customer content rather than derived
metrics; and does any "read" endpoint write. That last one is not visible from
the lint output at all.

The remaining 21 files are jobs and analytics that iterate rows they already
selected with an org filter. The heuristic cannot tell the two apart — being on
this list is a **question**, not a verdict, and each entry needs the unit-53
treatment: read the route that reaches it, then either thread the org through or
route the access via `unscopedForPlatformOps(reason)` if it is a genuine
platform op.

**Do not batch this.** `achAutopay` alone is 12 entries on the ACH payment rail,
where a wrong predicate does not leak data — it stops a debit or double-submits
one. One subsystem per unit, with the same two-halves test shape unit 53 used
(behaviour against a storage double, plus source assertions over the emitted
`where`), because the lint is textual and cannot see a predicate that is
accepted and never applied.

### Rule 2's register, triaged (unit 62)

`check-org-scoped-fetch` grew a second rule in unit 61 — *has an organization
and resolves an org-scoped table by primary key anyway* — and froze 63 entries.
Sixty-three findings is a number people bounce off, so they were triaged by
whether the id can actually come from a caller:

| | count |
|---|---|
| reachable with a **caller-supplied id** | 6 |
| **no external caller at all** (internal helpers) | 28 |
| remainder: called internally with ids the method or its caller derived | 29 |

Of the six, three were customer-reachable and are **done** (unit 62): the AVM's
fee-simple parcel fetch, `landCredit.getScoreHistory`, and — verified safe —
`acquisitionRadar.saveOpportunityScore`, whose flagged predicate uses an id from
an org-scoped select two lines above it. The other three
(`autonomousAgentEngine.recordAction`, `negotiationOrchestrator.recordOutcome`,
`sellerIntentPredictor.recordOutcome`) are reached only from `/founder/*`
routes, which carry `requireFounder`; lower priority, still worth closing.

**The triage heuristic over-reports and under-reports, both.** It asks whether a
route passes `req.params`/`req.body` into the method — which flagged
`saveOpportunityScore`, where the caller's data reaches the method but the
flagged *predicate* uses an internally-derived id. And it cannot see an id that
arrives through two hops. Treat the six as a starting order, not a boundary, and
re-derive it after each fix:

```
node scripts/check-org-scoped-fetch.mjs        # the register
```

**The 28 with no external caller are the cheapest win.** Scoping a helper that
nothing outside its own service calls carries almost no risk, and each one
removes a line from a register whose length is what stops people reading it.

---

## B16 — Three dead feature-flag ROWS, and whether to delete them

**RESOLVED 2026-08-13 (founder ruling): delete the rows.** A
`DELETE FROM platform_feature_flags WHERE key IN (…)` is registered in
`scripts/migrate.mjs` and applies on the next deploy — idempotent, and platform
config rather than customer data, which is why it needed only the same class of
ruling the 2026-08-01 dead-table drops took.

**THE REGISTER STAYS AFTER THE ROWS GO.** `RETIRED_FLAG_KEYS` is not bookkeeping
for three rows; it is the only thing looking at the flag catalogue, and it is
what catches the NEXT kill's leftover switch — the defect unit 76 created and
nothing noticed. `featureFlagRetiredKeys.test.ts` now asserts the DELETE covers
every registered key, so the two cannot drift apart.

**Found:** unit 82, by asking what the flag catalogue contains now that unit 81
made the founder's toggles actually work.
**Was blocked on:** a founder decision, and a small one. The rows were already
inert, so nothing waited on the answer.

`platform_feature_flags` is seeded by migration and outlives the features it
names. Three seeded keys refer to subsystems whose code is deleted:

| key | verdict |
|---|---|
| `feature_vision_ai` | KILL executed 2026-08-01 — routers, service, page and both satellite tables gone |
| `feature_voice_ai` | KILL executed 2026-08-01 — pipeline and both tables gone |
| `feature_negotiation_copilot` | KILL executed 2026-08-13 — **left behind by unit 76, this program's own residue** |

Nothing in `server/` or `client/src` references any of the three, and the paths
they control (`/vision-ai`, `/voice`, `/negotiation`) have no route in App.tsx.

**What unit 82 did instead of deleting them.** `RETIRED_FLAG_KEYS` in
`server/services/featureFlags.ts` hides them from `getAll` (so neither the
founder console nor `/api/config/features` sees them), makes `getByKey` answer
**absent** rather than "off" (so a stored `state: "on"` can never be honoured),
and makes `setFlag` throw — rendered as 404 at both admin write surfaces. The
rows are inert whether or not they are ever removed.

**The decision, if you want it:** a `DELETE FROM platform_feature_flags WHERE key
IN (…)` in `scripts/migrate.mjs`, in the same shape as the 2026-08-01 drops.
Cosmetic — the register already makes them harmless — so this can sit
indefinitely.

**Do NOT delete the register when the rows go.** It is what catches the NEXT
KILL's leftover switch, which is the actual defect: unit 76 executed a founder
ruling thoroughly enough to find a rail the deletion ledger had not recorded, and
still left the flag standing, because nothing was looking at the catalogue.

---

## B15 — The beta waitlist does not persist, and says a position number out loud

**RESOLVED by deletion** (unit 75, founder ruling 2026-08-13 — option 1 below).
`server/routes-beta.ts`, `server/services/betaProgram.ts`, the `/api/beta` mount
and its `routeManifest` entry are gone. The whole rail went, not just the public
half: the six founder-gated admin endpoints read **only** what the public POST
wrote, so with the writer deleted they were a console over a permanently empty
set. `companyAgents`' `compass_pm` lost its `betaProgram` / `/api/beta` ownership
entries, matching the `transactionFeeService` precedent in the deletion ledger.
`colon-any` 3011 → 3009. The deletion is pinned by
`founderGateSingleOwner.test.ts` (*"the beta rail stayed deleted"*), which fails
if either file, the mount, or the manifest entry returns — with the reason in the
failure message, so anyone restoring it reads *why* before they do.

**If beta signups are wanted again:** they need a `beta_waitlist` table and a
migration first, and the status endpoint must not be rebuilt as written — see
"If option 3" at the bottom of this entry.

**Found:** unit 58, while replacing `routes-beta.ts`'s divergent founder shim.
**Was blocked on:** a founder decision, because the honest fix touched a
**public, unauthenticated endpoint** that might have been wired to a marketing
page outside this repository. The founder gate on the admin half was fixed in
unit 58; this half was not touched until the ruling. The record below is what was
deleted and why, kept because "we removed a public signup form" is a fact someone
will need the reasoning for.

### The state

`server/services/betaProgram.ts` says it itself:

```ts
// ─── In-memory store (replace with DB tables in production) ────────────────
let waitlistEntries: WaitlistEntry[] = [];
let betaFeedback: BetaFeedback[] = [];
```

There is no `beta_waitlist` table in `shared/schema*` — the only match for
"waitlist" is `adjacent_verticals_waitlist`, a different feature. So:

- `POST /api/beta/waitlist` is **unauthenticated**, appends to a module-level
  array, and answers with a **position** and a `referralCode` derived from the
  in-memory id. Nothing persists: the list dies on every deploy and differs per
  machine. A person is told they are 47th in a queue that will not exist an hour
  later. That is the refuse-not-fabricate hard-stop — the same shape as unit 49
  (a 200 with a plausible object and nothing stored), on a surface a stranger
  can reach.
- It is also an unauthenticated, unbounded write into process memory.
- `GET /api/beta/waitlist/status?email=` is unauthenticated and answers whether
  an arbitrary address is on the list, with position, status and cohort — an
  email-enumeration oracle. It also calls `getWaitlist()` with no arguments,
  whose default is `limit = 50`, so anyone past position 50 is told
  `found: false` **even within a single process**. The endpoint is wrong before
  it is unsafe.
- Nothing in `client/src` calls `/api/beta` at all.

### Why unit 58 stopped here

Three of the four available moves are the founder's:

1. **Delete it.** Zero client callers, no persistence — on this program's own
   test (does removing it remove capability or a lie?) it removes a lie. But a
   public signup endpoint may be wired to a marketing site this repository
   cannot see, and deleting it would silently drop real signups.
2. **`Errors.notImplemented` naming the missing `beta_waitlist` table**, unit
   49's precedent. Honest, and it turns a public form into a visible error —
   again outward-facing.
3. **DB-back it**, the way `investorVerification` was ("Wave A: Nothing lies").
   That is the only option that keeps the feature and makes it true, and it is
   real work: a table, a migration mirrored in `scripts/migrate.mjs`, and a
   rewrite of the service's six in-memory methods.

The fourth — leave a public endpoint fabricating queue positions — is the one
option that is definitely wrong, which is why this is recorded rather than left
to be re-found.

**If option 3:** the status endpoint should stop being an oracle in the same
change (answer only for a signed-in caller's own address, or return a bare
`{ received: true }`), and `getWaitlist()` must not be used for a single-address
lookup — a `findByEmail` query, not a page-1 scan.

## B17 — RESOLVED 2026-08-14: deleted by founder ruling

**DECIDED (picker, 2026-08-14): "Delete the engine."** Executed in unit 107 —
`server/services/taxOptimizationEngine.ts` (423 LOC) is gone, the dangling
`"taxOptimizationEngine"` string is out of `companyAgents.ts`'s `ownedServices`
array, and `unreachedTaxEngineStaysUnreached.test.ts` is rewritten from an
inverted "do not wire it" assertion into a "stays deleted, and is not
reimplemented" one — it now also fails if any production file grows a
state→capital-gains map with a numeric fallback, because pasting the same table
into another module would defeat a path-only check.

**Deletion-revealed, and queued:** the engine was the only writer of
`tax_strategies` and `tax_forecast_scenarios`, so both are now writer-less and
reader-less (`tablesNoWriter` 47→49, `tablesNoReader` 59→61 — the exception this
ratchet carves out for exactly this case). **The tables are NOT dropped**; a
production `DROP TABLE` is a founder-only hard stop, and they join the existing
drop-decision queue. Recorded in `docs/company/deletion-ledger.md`.

**ANSWERED 2026-08-16 (B21) — and NOT the way this entry assumed.** The drop
queue was ruled on ("triage 3 ways, drop only experiment residue") and these two
were classified **class B, NOT DROPPED**. Reading their columns is what moved
them: both are org-scoped, both reference the customer's own properties
(`applicable_properties` / `property_ids`), and `tax_strategies` carries a
lifecycle the CUSTOMER moves (`recommended → implementing → completed →
dismissed`). A tax position a customer acted on is a tax record, whatever wrote
it. That the writer fabricated makes the ROWS suspect; it does not make them
AcreOS's to delete. See B21.

The original finding is kept below for the record.

### Original finding (unit 104)

**Found by unit 104**, generalising unit 103's question — *is this number the
user's, or ours?* — from string defaults (unit 93) to NUMERIC ones on money
paths. 330 `?? <non-zero literal>` sites in `server/` + `shared/`; nearly all are
legitimate optional-parameter knobs (temperature, thresholds, learning rates).
One file is not.

### What `server/services/taxOptimizationEngine.ts` computes

```ts
const stateCapGainsRates: Record<string, number> = {  // "representative sample, 2024"
  CA: 0.133, OR: 0.099, /* …20 states… */ GA: 0.0549,
};
const stateRate = stateCapGainsRates[state.toUpperCase()] ?? 0.05;
```

**Twenty states are listed. The other thirty get an invented 5%.** The comment
says "representative sample", so the incompleteness was known; the `??` is what
turns a known gap into a confident number.

**And the note beneath it states tax law falsely for exactly those states:**

```ts
note: stateCapGainsRates[state.toUpperCase()] === 0
  ? `${state} has no state capital gains tax.`
  : `${state} taxes capital gains as ordinary income.`,
```

`undefined === 0` is `false`, so an unlisted state takes the ELSE branch. Ask it
about Tennessee — no state income tax on capital gains — and it answers *"TN
taxes capital gains as ordinary income"* **and** applies 5%. Both false, in a
sentence a reader would take as legal fact.

It is not one line. `calculate1031Benefits` does
`const estimatedGain = replacementValue * 0.3; // assume 30% appreciation` and
returns `taxWithout1031` and `deferralBenefit` as rounded dollar figures. The
federal constants assume the TOP bracket for every taxpayer. `analyzePortfolio`
**persists** `estimatedTaxSavings` strings into `tax_strategies`.

### Why this is recorded rather than fixed

**It is unreached.** `stateTaxImpact` has zero callers; nothing imports
`taxOptimizationEngine` at all. The only occurrence outside the file is the
STRING `"taxOptimizationEngine"` inside an `ownedServices` array in
`companyAgents.ts` — and `lint-reachability.mjs` counts string literals as uses,
by design and by its own documentation ("prose and registries resurrect
corpses"). **So a dead subsystem that fabricates tax figures is invisible to the
one gate built to find dead subsystems.**

That makes all three live options founder-level:

1. **Delete it.** 423 lines, zero callers, and on this program's own test —
   *does removing it remove a capability or a lie?* — it removes a lie. Deleting
   a named service is the same class as the negotiation-copilot KILL (B12) and
   the SCP/voice/vision deletions, all of which were founder rulings.
2. **Make it refuse.** Return `{ known: false, reason }` for an unlisted state
   the way `computeDepositDeadline` does, drop `calculate1031Benefits`'
   assumed-appreciation path, and gate the whole engine behind a disclaimer. Real
   work, and it keeps a tax-advice surface the product may not want.
3. **Leave it.** The only option that is definitely wrong if it is ever wired up,
   which is why it is written down here instead of left to be re-found.

**Do NOT "tidy" the constants in the meantime.** Same reasoning as B10's legacy
note-payment writers: making one locally correct is the change most likely to be
wasted, and a more credible-looking fabrication is worse than an obvious one.

### What unit 104 DID do

Nothing to the engine. It added `unreachedTaxEngineStaysUnreached.test.ts`, an
INVERTED assertion in the idiom of `vaWorkflowBounds.test.ts`: it pins that
`taxOptimizationEngine` has no production importer, and **fails the day someone
gives it one** — so wiring it up forces this decision to be answered first
instead of shipping the 5% alongside it.

## B18 — PARTLY RESOLVED 2026-08-14: the duplicate is retired; widening stays open

**DECIDED (picker, 2026-08-14): "Retire the dead duplicate."** Executed in unit
108 — `SECURITY_DEPOSIT_RULES` and `computeSecurityDepositDeadline` are gone from
`server/services/landlordCompliance.ts` (116 lines), a module nothing imported.
`shared/regulatory/depositReturnRules.ts` is now the single owner, and all four
disagreements are dissolved rather than adjudicated — deciding which reading of
Fla. Stat. §83.49 is right is legal judgement this program does not have.

The rollover defect went with it: that function parsed with a bare `new Date()`
plus a NaN check, so `2026-02-30` became March 2 — the shape unit 99 removed from
everything live.

`depositRegistriesAgree.test.ts` changed job rather than being deleted: it used to
pin the four disagreements in both directions, and now asserts **single
ownership** (including that no rival table appears in any other module) plus the
property that made the survivor the right one — it REFUSES a state it does not
encode instead of defaulting. The deposit tests in `landlordCompliance.test.ts`
were retired rather than relocated, and the reason is recorded in the file:
**they asserted the losing side of the conflict** (`FL: 15 days`), so porting them
would have enshrined an unreviewed reading.

### STILL OPEN — coverage

The retired table had 51 entries with citations; the live one is deliberately
incomplete. **Widening it is separate, reviewable work**: each entry needs
checking against its citation before it backs a live statutory deadline, and the
four disputed states need a real reading. Until then the live registry returns
`{ known: false, unknownReason }` for what it does not encode, which is the
honest answer and is asserted by the test.

The original finding is kept below for the record.

### Original finding (unit 105)

**`shared/governance/statuteRegister.ts` warned about this in its own words**, and
had done for a while:

> TWO overlapping deposit registries exist (`shared/regulatory/depositReturnRules.ts`
> and `SECURITY_DEPOSIT_RULES` in `server/services/landlordCompliance.ts`). They can
> disagree, and nothing cross-checks them.

Unit 105 ran the cross-check. **Fifty states appear in both. Forty-six agree.
Four do not, and each pair cites the same statute:**

| state | `landlordCompliance` | `depositReturnRules` | citation |
|---|---|---|---|
| FL | 15 days | 30 days | Fla. Stat. §83.49 |
| ME | 30 days | 21 days | 14 M.R.S. §6033 |
| MT | 10 days | 30 days | Mont. Code §70-25-202 |
| OK | 45 days | 30 days | 41 Okla. Stat. §115 |

A security-deposit return deadline is a statutory obligation whose breach carries
penalties in most states, often multiple damages. The four are not a systematic
offset — they are four specific readings of four specific statutes that cannot
both be right.

### Why this is a blocker and not a fix

**Reading a statute and picking a number is legal judgement**, and getting a
statutory deadline wrong is worse than flagging that two of ours disagree. This
program does not have that authority, and a confident wrong number here is
precisely the failure mode the constitution's refuse-not-fabricate rule exists to
prevent.

### The context whoever resolves it needs — the two tables are not peers

- **`depositReturnRules.ts` is the LIVE one.** The deposit clock, the disposition
  letter and the rent-ledger surface all read it. It is deliberately incomplete
  and returns `{ known: false, unknownReason }` for a state it does not encode,
  which is the honest posture and the one the callers are built around.
- **`SECURITY_DEPOSIT_RULES` is COMPLETE** — 51 entries, every state plus DC, each
  with a citation — and **nothing imports `landlordCompliance.ts`.** It is the
  fuller table sitting in a module with no production caller, found by the same
  registry-ghost sweep that produced B17. It also parses its move-out date with a
  bare `new Date()` plus a NaN check, which is the rollover defect unit 99 fixed
  everywhere that is live (`new Date("2026-02-30")` is March 2nd).

So the real question is probably not "pick one per state" but **"should the
complete table back the live one?"** — which is a bigger decision than four
numbers, and needs the same eyes.

### What unit 105 DID do

`tests/unit/depositRegistriesAgree.test.ts` runs the comparison the register said
nobody ran, and pins the four **in both directions**: a FIFTH disagreement fails
the build, and RESOLVING one also fails until it is removed from the register —
so a fix is locked in by the commit that earns it. It also pins the day counts
themselves, so a table edited into a different disagreement makes this blocker's
evidence stale before anyone acts on it. The statute register's note has been
updated: it no longer says nothing cross-checks them, because something does.

## B19 — PARTLY RESOLVED 2026-08-14: classes 2+3 deleted; class 1 stays open as WIRING work

**Status.** Opened at **62** modules / 19,685 lines that no production file
imports. Unit 106 counted them as their own reachability family
(`module-orphans`), because a file is the unit this decision is made in while an
export is not.

**Unit 109 executed classes 2 and 3** under the founder ruling *"Delete classes 2
and 3 now"* — 16 files, 5,002 lines, every one verified to have zero imports and
zero mentions first. `moduleOrphans` 61→45. The class-2 and class-3 sections below
are kept as the RECORD OF WHAT WAS DELETED, not as a to-do list; the files are
gone.

**Unit 116 executed the full triage of the remainder** (founder ruling, picker
2026-08-15: *"Delete all 15"*). A 27-agent workflow classified all 44 remaining
orphans — every DELETE adversarially refuted, importers re-verified centrally:
**15 deleted** (~4,100 lines; see the deletion ledger for the per-file evidence —
eight were fabricators, which converts "wire it" into "delete it"), **12 keep**
(staged seams and infrastructure with a reason to exist unwired), **11
refuted-or-unclear** (stay here, unresolved), and **6 wire** — which is Class 1
below, now including `wireInstructions.ts`. `moduleOrphans` 44→29.

**What remains open is Class 1**, and it is not a deletion decision at all — it is
wiring, blocked on a judgement call with legal weight. Read that section, not this
blocker's original framing.

The original count is trusted because two independent predicates agreed: the
gate's own `isModuleOrphan`, and a from-scratch sweep over all 888
`server/services` modules. (That sweep's FIRST run claimed 28 of 888 were imported
— implausible on its face, and traced to an import regex that forbade `{` between
`import` and the specifier, excluding every braced import. Corrected before it was
believed.)

**Reading this as "delete the orphans" would be wrong, and dangerous in one of the
three classes.**

### Class 1 — regulated obligations built and never wired. DO NOT DELETE.

| module | lines | what it implements |
|---|---|---|
| `breachNotificationTrigger.ts` | 426 | GLBA §314.4(j) 30-day, GDPR Art. 33 72-hour, and state breach deadlines (CA §1798.82, NY SHIELD, IL PIPA, MA 201 CMR 17) |
| `paymentApplication/index.ts` | 529 | Reg-Z order a borrower payment is applied in |
| `landlordCompliance.ts` | 413 | notice periods, retaliation windows, lead-paint, fair-housing, HAP recert. Its 51-state deposit table was a DUPLICATE and was removed under **B18**; `shared/regulatory/depositReturnRules.ts` is the single owner |
| `rental/leaseSigningPacket.ts` | 551 | lease execution packet |
| `usuryCeiling.ts` | 205 | state usury caps |
| `wireInstructions.ts` | 261 | ALTA Pillar 2 wire-fraud prevention (added to this class 2026-08-15) |

**`wireInstructions.ts` — checked 2026-08-15, and the finding is the reassuring
direction, so it is stated precisely rather than dramatically.** Wire fraud is
real estate's largest loss vector, so the first question was whether a live
surface delivers wire instructions *without* these controls. It does not:

- It is the **only** wire-instructions implementation in the repo — no rival, so
  this is class 1 (build it) and not class 2 (delete a duplicate).
- Its six `title_orders` columns (`wire_instructions_pdf_s3_key`,
  `..._password_hint`, `..._hmac`, `..._issued_at`, `wire_confirmation_phone`,
  `wire_confirmed_at`) have exactly one writer — itself — and **zero readers
  anywhere**, server or client.
- `routes-title-partners.ts` IS mounted (5 endpoints) and exposes **no wire
  endpoint**.

So there is **no wire-instruction delivery path at all**. This is an unbuilt
capability, not an active exposure. Wiring it is a feature build with external
dependencies the module deliberately does not own — encrypted PDF generation and
S3 upload, out-of-band SMS for the password, and a customer confirmation surface
— which is why it sits here rather than in a work queue. It also sits adjacent to
the money-custody hard stop, so its scope is a founder decision. The module's
fail-closed posture is correct meanwhile: `issueWireInstructions` throws rather
than produce an unsigned wire instruction.

`breachNotificationTrigger.ts` is the sharpest thing in this file. It was written
deliberately by a named privacy audit, its header names the exact statutes and
clocks, and it then says:

> *Calling code: any security event where personal data exposure is confirmed or
> reasonably suspected.* — followed by five examples.

**Nothing calls it.** This is the canonical "built but unwired" defect the
reachability gate's own header was created for (`lateFees` §1026.36(c)(2),
`respa/earlyIntervention` §1024.39), and it is worse than those because the
trigger is an INCIDENT: the absence only manifests during a breach, which is
exactly when nobody is reading code.

**Wiring, not deletion, is the fix — and it is a blocker because WHERE it hooks
is a judgement call with legal weight.** Deciding which security events count as
"confirmed or reasonably suspected" is not a refactor.

### Class 2 — superseded duplicates. DELETED, unit 109.

`authLockout.ts` (102) was dead because `server/middleware/authPathLimits.ts`
exports a live `loginLimiter`. **The control exists; that copy of it did not
run** — so this removed a duplicate of a control, not a control. Do not read this
class as a missing control; that would be the opposite error to Class 1, and the
file name invites it, which is why the classes were separated.

### Class 3 — experiments. DELETED, unit 109.

The `*V9.ts` set (`delegationDepthV9`, `spendAutonomyV9`, `causalReasoningV9`,
`playbookEvolutionV9`, `externalIntelligenceV9`, `compassAutoRecommendV9`), the
`scp*` remainder (`scpCustomerLifecycle`, `scpExperimentEngine`,
`scpSelfProvisioning`), `aiAdvisorTeamV15`, `agentTriggerMonitor`, and two
`*Enhancements.ts` files — the same family the 2026-08-01 founder deletion wave
ruled on once already.

**Two corrections this section carries forward**, both from unit 109's
verification pass:

- **The `*Enhancements` family is NOT uniformly dead.** This entry originally said
  "the four `*Enhancements.ts` files". `enhancements.test.ts` covers ELEVEN such
  modules and **nine have real production importers**; only
  `marketplaceEnhancements` and `securityEnhancements` were orphans. Treating the
  family as uniformly dead would have deleted nine live modules.
- **The `scp*` trap was checked first.** `routes-scp-v2.ts` is production-mounted
  and lazily imports `scpGoldenSuite`, `scpConfigVersioning`, `scpEvolutionEngine`,
  `scpMemorySystem`, `scpLLMJudges`. The three deleted here are none of those.

Nine tables lost their only writer as a result and are **queued for the founder
drop decision, not dropped**: `auth_fail_attempts`, `agent_playbooks`,
`playbook_evolutions`, `compass_recommendations`, `spend_watchers`,
`spend_optimizations`, `causal_investigations`, `delegated_goals`,
`external_intelligence`.

**ANSWERED 2026-08-16 (B21).** Seven of those nine were dropped:
`playbook_evolutions`, `compass_recommendations`, `spend_watchers`,
`spend_optimizations`, `causal_investigations`, `delegated_goals`,
`external_intelligence`. Two were
NOT: `agent_playbooks`, because two tables that are neither writer-less nor
reader-less hold FKs into it; and `auth_fail_attempts`, because its columns are
`ip`, `email` and `user_agent` — failed-login telemetry naming a person is
personal data, not experiment residue, whatever deleted its writer. See B21.

### Mechanics when a batch is approved

Deleting an orphan removes its exports from `unreachedExports` too, so **both
baselines drop and both must be lowered in the same commit** — the ratchet fails
on a stale-high baseline exactly so a reduction is locked in by the commit that
earned it. Unit 109 found that this understates it: the deletion also tripped
`check-no-fabrication`'s allowlist, the tenancy debt register and
`outwardActionCoverage`'s send-site baseline. **A deletion touches every register
that ever counted or named the thing**, and running the gates is the only way to
learn which.

`taxOptimizationEngine.ts` was on this list and was **B17**, answered on its own
terms first: it fabricated, so deletion was the *cheap* answer there rather than
the lossy one.

---

## B20 — 185 async FUNCTIONS query org-scoped tables without org context

**Found:** unit 123, by widening `check-org-scoped-fetch.mjs` from the method
shape to the function shape.
**Blocked on:** nothing — a triage queue, frozen so the widened lint could land
and block regressions. Recorded here because it is a re-seed of newly *visible*
debt, and a register nobody works down is how a gate earns a re-baseline.

**The gap.** B14's lint had been pointed at the right FILES since unit 54, and
was still only looking at the right SYNTAX. It extracted `async <name>(` —
class / object-literal method form — and nothing else, because the regex read
the identifier in `async function getDeal(` as `function` and then demanded an
immediate `(`. So:

```ts
async getDeal(dealId: number) { … }          // CAUGHT
export async function getDeal(dealId) { … }  // GREEN
```

Identical table, identical bare id, identical cross-tenant read, in a file the
lint already walked. **The rule was enforced against a keyword, not against the
defect** — the same PARTIAL-nameonly class as B18's name-keyed registry and the
`/^server\/routes-.*\.ts$/` filename filter the reachability gate carried until
the same unit.

Widening extraction raised the scanned population from **2,485 units to 4,606**
and surfaced **122 rule-1 + 63 rule-2** offenders that were always there. They
sit in `BASELINE_FUNCTION_OFFENDERS` / `BASELINE_FUNCTION_UNUSED_ORG` — separate
registers from the method-shape ones, so neither can hide a regression in the
other, and both may only SHRINK.

**Triage order, measured across all 122 by predicate shape** (13 hand-read
against schema before freezing; 13/13 real, zero parser false positives):

- **43 resolve a row by id / FK — START HERE.** This is the B14/unit-53 leak
  shape, where an id arrives from a URL. `writingStyle.deleteStyleProfile(id)`
  is a bare-PK DELETE; `leadQualification.acknowledgeAlert` is the exact twin of
  the already-registered `alerting.ts` entry; `wireInstructions
  .recordWireConfirmation` and `achMandateSetup.revokeAchMandatesForNote` sit on
  the **money rail**, which is where this ranks above the other two groups.
- **38 `eq()` on a non-id column** (token / email / natural key). Mixed: some are
  capability-based by design — the same class as the registered
  `noteRepo::getNoteByAccessToken`, where the token IS the authorization.
- **41 aggregate / range scan, no `eq()` at all.** Mostly founder and platform
  instruments that span orgs deliberately (`ai-telemetry` model distribution,
  `aiCostCeiling`'s explicitly platform-wide sum). Real by the rule and the
  cheapest to clear: wrap the access in `unscopedForPlatformOps(reason)` and
  delete the register line.

**The predicate was deliberately NOT narrowed to the 43.** Narrowing to
"resolves by id" would make the function shape mean something different from the
method shape, and would open a fresh bypass — a filterless cross-tenant LIST
leaks more than a single-row fetch. B14's register already carries aggregate
entries for that reason and has demonstrably shrunk (2026-07-29, 2026-08-06), so
a register of this size is workable here rather than aspirational.

**Still outside the lint, measured rather than waved at:** `server/routes-*.ts`
and `server/routes/**`. Admitting them WITH inline `async (req, res) => {}`
handler extraction measures 271 files, 66 rule-1 + 73 rule-2 = **139 further
entries**. That is a separate unit of work with its own extractor — seeding 139
more rows now would produce exactly the unworkable register this entry warns
about.

---

## B21 — RESOLVED 2026-08-16: the dead-table drop queue, ruled on and executed

**DECIDED (picker, 2026-08-16): *"Triage 3 ways, drop only experiment
residue."*** This is the answer to the queue B17 and B19 kept appending to — the
sixteen tables that had lost their only writer and were held because a
production `DROP TABLE` is a founder-only hard stop.

**What was blocked, and is no longer:** the queue asked one question ("may these
be dropped?") of a set that turned out not to be one kind of thing. The ruling
supplied the discriminator, so the queue stopped being a single blocked decision
and became a classification with three outcomes.

### What was ruled

Three classes, and only one of them is droppable:

- **CLASS A — experiment / agent residue.** Provably left behind by a module a
  deletion-ledger row ALREADY records as killed, **and** holding no customer
  content. Conjunctive on purpose: provenance alone is not enough.
- **CLASS B — customer or regulated records.** Anything that could hold customer
  data or carry a retention obligation. **Not dropped.** Customer-data deletion
  is a founder-only hard stop and this ruling did not authorise it.
- **CLASS C — unclear.** **Not dropped**, recorded with the specific open
  question so the next session starts from a question, not a re-derivation.

### What was measured

`node scripts/lint-reachability.mjs --measure`: `tables-no-writer` 62,
`tables-no-reader` 75, **intersection 48**. All 48 classified — the full table,
with per-table evidence and per-class-B obligation, is in
`docs/company/deletion-ledger.md` under *"2026-08-16 — 48-table dead-storage
triage"*. Split: **15 class A** (13 dropped, 2 blocked), **22 class B**,
**11 class C**.

Two checks the linter cannot do for itself were run by hand, and one of them
changed an answer:

- **Raw SQL.** A table reached via `` sql`SELECT … FROM foo` `` is alive and
  invisible to a Drizzle-shaped linter. All 48 snake_case names searched for
  SQL-shaped access across `server/`, `client/`, `shared/`. **Zero hits.** The
  two `server/` mentions are prose in comments.
- **Aliases.** The linter keys on the `pgTable` identifier. `rg "^export const
  \w+ = \w+;"` over `shared/schema*.ts` finds **exactly one** alias in the whole
  schema — `marketIndicators = marketIndicatorsDuplicate` — and
  `server/services/marketPrediction.ts` both reads and writes through it. So
  `market_indicators_temp` is **NOT DEAD**; it is a false positive that the
  intersection alone would have deleted out from under a live service.

### What was dropped

Thirteen tables, in `migrations/0236_drop_experiment_residue_tables.sql`,
mirrored statement-for-statement in `scripts/migrate.mjs`, with the thirteen
`pgTable` definitions removed from `shared/schema.ts`:

`playbook_evolutions`, `agent_improvement_plans`, `agent_synergy_map`,
`compass_recommendations`, `spend_watchers`, `spend_optimizations`,
`causal_investigations`, `delegated_goals`, `external_intelligence`,
`product_specifications`, `build_buy_decisions`, `feature_impact_scores`,
`automation_executions`.

**NOT APPLIED.** This session had no `DATABASE_URL` and did not seek one. The
statements are idempotent (`DROP TABLE IF EXISTS`) because `scripts/migrate.mjs`
is the Fly `release_command` and re-runs on every deploy. **No `CASCADE`
anywhere** — cascade would silently take dependent objects this ruling never
named; verified zero inbound FKs to all thirteen across `migrations/`,
`scripts/migrate.mjs`, `shared/` and `server/`.

**And it deletes less than it looks like.** Twelve of the thirteen have no
`CREATE TABLE` anywhere — that is precisely why they sat in
`scripts/schema-migrate-mirror.allowlist.json`, whose own gate note records that
`db:push` is not run in prod. For those twelve the DROP is expected to be a no-op
against a table prod never had, and the real deletion is the schema definition.
`automation_executions` (created by `migrations/0001_brief_giant_man.sql`) is the
one that exists.

### Counts measured, for central lock-in

The `table-count` and reachability baselines are locked centrally and were **not
edited here**:

| ratchet | before | after |
|---|---|---|
| `table-count` | 763 | **750** |
| `tablesNoWriter` | 62 | **49** |
| `tablesNoReader` | 75 | **62** |

**Three registers outside this unit's file set are now stale and fail CI until
updated in the same commit** — each measured by running the gate, not guessed:

- `scripts/schema-migrate-mirror.allowlist.json` — 12 stale entries
  (`agent_improvement_plans`, `agent_synergy_map`, `build_buy_decisions`,
  `causal_investigations`, `compass_recommendations`, `delegated_goals`,
  `external_intelligence`, `feature_impact_scores`, `playbook_evolutions`,
  `product_specifications`, `spend_optimizations`, `spend_watchers`). 95 → 83.
  `node scripts/check-schema-migrate-mirror.mjs` currently exits 1 naming all 12.
- `tests/unit/schemaMigrationDrift.test.ts` — `BASELINE_ORPHANS`, the same 12
  names, 95 → 83. Its "baseline only shrinks" test fails on stale entries by
  design.
- `scripts/check-org-leading-index.mjs` — `BASELINE_OFFENDERS` still contains
  `"automation_executions"`, the only one of the thirteen carrying an
  `organization_id`. Set size 150 → 149. `node
  scripts/check-org-leading-index.mjs` currently exits 1: *"stale allowlist
  entries: 1"*.

### What is STILL awaiting a founder decision

The queue is not empty, but it is no longer one undifferentiated pile. Of the
sixteen tables B17 and B19 had queued: **ten were dropped**; **five were answered
"no"** — `tax_strategies`, `tax_forecast_scenarios`, `opportunity_zone_holdings`,
`auth_fail_attempts`, `tutor_sessions` are class B, and "drop only experiment
residue" is a decision about them rather than a deferral; **one stays open**
(`agent_playbooks`). Two items JOIN the open list that were not on the original
queue. Three open in total, each with a stated reason rather than a shrug:

| table | class | why it is still open |
|---|---|---|
| `agent_playbooks` | A | Class A by content — agent SOPs, no org key, writer deleted 2026-08-14. Blocked structurally: `institutional_patterns.linked_playbook_id` and `signal_correlations.auto_trigger_playbook_id` hold FKs into it, and **neither of those tables is writer-less or reader-less**. Dropping it requires dropping two columns from two LIVE tables — a bigger change than "drop experiment residue", and it needs its own yes. |
| `scp_evolution_metrics` | A | Class A by content. Blocked on one token: `server/services/scpGoldenSuite.ts` names the identifier in its import list and uses it nowhere. Removing the schema export without deleting that import breaks the build; that file was outside this unit's file set. **Unblock is a one-line edit**, not a decision. |
| `automation_rules` | B | The 2026-07-29 ledger row already asks for the drop ("remain in `shared/schema.ts` pending a drop migration"), and this unit still declined: the rows are CUSTOMER-AUTHORED (`name`, `description`, `conditions`, `actions`, `created_by`, `organization_id`). Customers wrote rules that could never run; the rules are still their words. **This one needs the founder's explicit customer-data nod**, which is exactly the hard stop the ledger row did not have. |

### Where this unit's brief was contradicted, on purpose

The brief supplied example classifications as a starting point. Reading the
columns moved **five tables** (in the four groups below) out of class A, and the
reasons are recorded so a later session does not re-litigate them from the same
starting point:

- **`opportunity_zone_holdings`** — columns are `investment_date`,
  `initial_investment`, `deferred_gain_rollover`, `step_up_basis`, `exit_value`,
  org- and property-scoped. That is a customer's OZ investment record feeding
  IRC §1400Z-2 elections and annual Form 8997, on a 10-year hold. **Class B.**
- **`tax_strategies` / `tax_forecast_scenarios`** — org-scoped, keyed to the
  customer's own properties, and `tax_strategies` carries a lifecycle the
  customer moves. That the deleted writer FABRICATED makes the rows suspect; it
  does not make them AcreOS's to delete. **Class B.**
- **`auth_fail_attempts`** — the provenance is class A (`authLockout.ts`, deleted
  2026-08-14 as a superseded duplicate), but the columns are `ip`, `email`,
  `user_agent`. Failed-login telemetry naming a person is personal data under
  GDPR/CCPA and security-incident forensic material. **Class B.**
- **`tenant_metrics`** — no ledger row ever killed it, white-label is **FREEZE**
  with a recorded reactivation criterion, and `revenue_generated` is
  billing-adjacent. Dropping a frozen subsystem's metering table pre-empts its
  reactivation. **Class C.**

---

## B22 — RESOLVED 2026-08-16: option (b), the gate is deleted

**DECIDED (picker, 2026-08-16): resolve B22, and the option selected was
DELETE** — branch (b) below, "an abandoned experiment … the deletion ledger's
usual verdict for a thing built and never wired". Executed the same date:
`scripts/check-route-cost-class.mjs` (681 lines) is gone. The ledger row is the
last entry in `docs/company/deletion-ledger.md`'s **"Executed deletions (log)"**
section, dated 2026-08-16 — it carries the re-established evidence that nothing
ever ran it, the measured 1,862/1,868, the proof that the redness predates unit
130, the salvage check against `scripts/check-route-order.mjs`, and the three
conditions a rebuild would have to meet.

**The middleware is NOT deleted.** `server/utils/costClass.ts` stays: nine live
`costClass(...)` applications across four `server/routes-*.ts` files. What was
killed is enforcement nobody ran, not the capability.

**One correction to this entry's own wording, measured before deleting.** Below
it says the pre-unit-130 script "run on the same tree also exits 1". It does
not — it exits **0**, falsely: its `catch { return "" }` swallowed an ENOBUFS on
a 1,111,071-byte diff (Node's default `maxBuffer` is 1,048,576) and printed "no
new routes in diff". The comparable measurement is `--all`, which returns the
identical **1,862 / 270** under both versions. The conclusion B22 drew is
unchanged and if anything stronger: unit 130 did not create the debt, it only
made a false clean into a true failure.

**Residue left for a session that owns those files:** two now-dangling prose
comments, `server/utils/costClass.ts:37` and `server/utils/outboundFetch.ts:22`,
both of which asserted enforcement that never ran even while the file existed.

**Original entry below, kept for history.**

**Found:** unit 130, while closing the vacuity findings.
**Blocked on:** nothing technical — it needs a decision about whether route cost
classification is a rule this repo actually wants, and a baseline if so.

**Not wired.** `grep -rn "check-route-cost-class\|route-cost-class" package.json
.github/ .githooks/` returns nothing. It is not in `npm run check`, not in any
workflow, not in a hook. A gate nobody runs is a file — this repo's single most
common defect class, aimed at governance instead of features.

**And it would fail on contact.** Run against `origin/main...HEAD` it reports
**1,862 unclassified route call sites** of 1,868 (6 classified). Verified this
is NOT caused by unit 130's fix: `git show HEAD:scripts/check-route-cost-class.mjs`
run on the same tree also exits 1. The gate has been red for as long as it has
existed; nothing noticed because nothing ran it.

**What unit 130 DID change**, and why it is still worth having: `gitDiff()`
swallowed every error and returned `""`, so a shallow CI clone, an unfetched base
ref, or any git failure was indistinguishable from a genuinely route-free diff —
it printed "no new routes in diff" and exited 0. That is the same false-clean
class as the ratchet engine passing on a missing glob root. It now distinguishes
"git failed" from "empty diff" and floors its populations (270 route files,
1,868 call sites).

**The decision this needs.** Either (a) the cost-class rule is real, in which
case it needs a frozen baseline of the 1,862 the way `check-org-scoped-fetch`
froze its tenancy debt, plus wiring into `npm run check`; or (b) it is an
abandoned experiment, in which case delete it — the deletion ledger's usual
verdict for a thing built and never wired. Do NOT wire it as-is: that fails the
build on day one and gets `--no-verify`'d into irrelevance within a week, which
is the failure mode `check-tests-typecheck`'s header already warns about.
