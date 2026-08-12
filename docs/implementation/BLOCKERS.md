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

**Found:** unit 42, while deriving the webhook event catalogue.
**Blocked on:** a founder decision, at a trigger that has not fired.

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

**Found:** unit 48→49, by following unit 48's question ("does anything read this
back?") across the rest of `organizations.settings`.
**Blocked on:** a founder decision — build the persistence layer, or remove the
subsystem. Not a technical unknown; every fact below is verified at HEAD.

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

**Found:** unit 49→50, by asking whether `routes-elite-features.ts`'s other
routes shared the shape unit 49 fixed.
**Blocked on:** an architectural decision with founder weight — which note data
model is canonical. **Not attempted here**, deliberately: this is money code and
this session has no `DATABASE_URL`, so a rewrite could not be integration-tested.

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

**Found:** unit 50, by asking whether `routes-elite-features.ts`'s remaining
POST routes shared the shape units 49–50 had already found there twice.
**Blocked on:** a founder decision — delete these routes, or connect them to the
ORG's own ad account. **Gated and capped in the meantime** (unit 50); the
decision itself is not taken here.

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

**Found:** unit 52, by the component-name detector added to the Pax-ambient
ratchet.
**Blocked on:** a founder decision — execute the deletion, or reactivate the
surface. **Not touched in the meantime**; the client door stays frozen.

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
