# Implementation state

**The most perishable file in the institution. Distrust it first.**

Verified at `10447296`, 2026-08-19, by running the gates and counting the tree —
not by reading the previous version of this file. If a claim here conflicts with
the repository, the repository is right and this file is stale; edit it.

---

## Scale, measured

| | |
|---|---|
| Tables (`pgTable` across `shared/`) | **751** — 487 of them in `shared/schema.ts` |
| Migrations | **245** SQL files |
| Server services | **542** files · **269** route files |
| Scheduled jobs | **149** roster entries in `jobRegistry.ts` (47 job FILES — not the same number) |
| Client pages | **154** |
| Test files / tests | **924** / **12,447** (+1 skipped), all green |
| Gates in `npm run check` | **26** steps (tsc + check:tests + 24 lint gates), **all green** |
| Counted ratchets | **14** registers under `scripts/ratchets/` |

`npm run check` takes roughly ten minutes; the full suite roughly five. Both
must be backgrounded — a foreground `sleep` is blocked in the dev container.
Commit with `--no-verify`: the pre-commit hook runs a full `tsc` and times out.

## Ratchet baselines at HEAD

Every one is **down-only**. `count > baseline` fails as a new offender;
`count < baseline` fails as **stale-high**, which forces the reduction to be
locked into the commit that earned it.

| register | baseline |
|---|---|
| `as-any` | 1356 |
| `colon-any` | 2940 |
| `res-status-raw` | 500 |
| `self-fallback` | 140 |
| `tests-typecheck` | 162 |
| `table-count` | 751 |
| `openai-bypass` | 83 |
| `sql-raw` | 38 |
| `console-in-server` | 6 |
| `req-as-any` | 0 |
| `storage.ts` lines | 1682 |
| `runScheduledJobs.ts` lines | 5721 |
| reachability: unreached exports | 1398 |
| reachability: tables with no writer / no reader | 48 / 60 |
| reachability: unregistered routes / opaque exports / module orphans | 4 / 120 / 28 |
| `FOUNDER_ROUTE_BASELINE` | 82 |
| `OBJECTS_WITHOUT_CANONICAL_HOME` | 9 |

Two of these are the honest shape of the debt rather than a target:
`unreachedExports: 1398` and `tablesNoReader: 60` say plainly that a large part
of this repository is written and not reached. That is the single most useful
number in the table.

---

## What is canonical and reachable

- **The five customer doors and four founder doors**, both pinned by ratchets
  that derive the door set from the real nav rather than re-listing it
  (`sidebarHiddenRoutes.test.ts`, `founderFourDoors.test.ts`,
  `mobileNavFixedDoors.test.ts`).
- **The architecture registry** — `shared/architecture/canon.ts`: 7 layers, the
  9-stage loop, 15 laws, 18 canonical objects, 12 fitness functions.
  `canonicalArchitecture.test.ts` proves every table it names exists and every
  enforcement pointer resolves to a real file.
- **The governance registry** — `shared/governance/constitution.ts`, each
  hard-stop tagged with HOW it is enforced (code-invariant / ratchet-test / lint
  / prose-only). `constitution.test.ts` holds the count of *unenforced*
  hard-stops at or below its baseline.
- **The database rebuilds from this repository — by the MANUAL two-half
  runbook, not by the deploy.** Proved by standing up a real PostgreSQL 16 and
  diffing the live table list against the schema: 746 of 746. But that procedure
  is `for f in migrations/*.sql; do psql -f $f; done` *then* `migrate.mjs`, and
  `fly.toml:19` runs `migrate.mjs` alone as its release command — while 325 of
  the schema's tables have their `CREATE TABLE` only in `migrations/*.sql`. So
  "rebuildable" is true of the runbook and not yet of the release path. What the
  deploy DID gain: `migrate.mjs` refuses when foundational tables are absent, so
  it can tell an empty database from a healthy one — it could not before.
- **Parcel identity** — `shared/parcel/parcelRef.ts` is the one definition of
  "the same parcel", with an adoption ratchet at 0.
- **Tenancy** — `check-org-scoped-fetch.mjs` runs three rules; rule 3 catches the
  shape that shipped a live cross-tenant read (a query inside an org-scoped unit
  that does not name the organization itself).
- **Fabrication** — `lint:no-fabrication` plus `check-measurement-defaults.mjs`,
  which flags a measured field being replaced by a plausible constant and
  self-tests its own predicate in both directions on every run.

## What is partial or dark

- **9 of 18 canonical objects have no canonical home.** Three are conflated
  inside the `properties` god table (property, parcel, document), five are
  role-tables, one is absent. See the frontier for the dependency order.
- **`plan` and `action-receipt` exist only on the FOUNDER plane.**
  `plan_proposals` has no `organization_id` at all. The customer side is
  unbuilt, not blurred.
- **13 of 15 verticals stop before a recorded decision.** `readiness.ts` derives
  vertical maturity from evidence and the overclaim count is frozen and
  down-only. Every vertical has a surface; the gap is the LOOP.
- **`lint-reachability` does not scan `shared/**`.** A new shared module with no
  production caller is invisible to the built-but-unwired gate.
- **539 tenancy entries are frozen debt**, across the gate's five down-only
  registers: rule 1 **147**, rule 2 **63**, rule 3 **127**, and the
  function-shape pair added 2026-08-16 at **124** and **78**. There is no
  PostgreSQL row-level security anywhere in this repository (zero
  `ROW LEVEL SECURITY` / `CREATE POLICY` across `migrations/` and
  `migrate.mjs`), so tenant isolation is application-level only and each
  baselined entry is an unguarded cross-tenant path in principle. Rule-2 entries
  first: each is a live path where a caller-supplied id can reach another
  tenant's row.
- **The agent authority vocabularies do not meet.** `NEVER_PROMOTE_ACTIONS`
  holds 15 snake_case founder-only names; live callers emit `proactive:${id}`
  and `reaction:${id}`. No live action can match the ceiling — and none of the
  15 has an executor anywhere, so nothing hard-stop-class currently executes.
  The guard proves nothing rather than being stepped over.

## What needs the outside world

- **Customer #1.** AcreOS is pre-customer. Several questions are now better
  answered by user behaviour than by another week of solitary engineering; the
  crossover is a live judgement, not a distant one.
- **The S3 fetch half of the DR RTO** is unmeasured — no bucket access from the
  dev container. The restore half is measured and the drill found a real gate
  failure.
- **Provider behaviour under partial failure and ambiguity** is proven against
  fixtures, not against the providers.

---

## Conventions that are actually followed

Not aspirations — these are enforced, and the enforcement is named.

- `AuthenticatedRequest` in route handlers, never `(req as any)` — `req-as-any`
  ratchet at **0**.
- `Errors.*` helpers rather than raw `res.status().json()` — `res-status-raw`
  ratchet, down-only from 500.
- Structured `logger`, never `console.*` in production server code —
  `console-in-server` at 6.
- Skeletons matching content shape rather than spinners; `EmptyState` with a
  purposeful CTA; `QueryErrorState` with retry.
- Every icon-only button carries `aria-label`; every interactive element has a
  visible focus state; every input has a label.

---

## How to check this file is still true

One caution learned the hard way: **`check:tests` runs second and short-circuits
the remaining 23 gates.** While it is red, every ratchet below it is unevaluated
— so "only one gate failing" can mean "twenty-three gates unmeasured". Drive
`check:tests` green first, then read the rest.

```bash
npm run check                      # 26 gates, ~10 min, background it
npx vitest run                     # full suite, ~5 min, background it
node scripts/lint-reachability.mjs --measure
node scripts/check-measurement-defaults.mjs
git log --oneline -20
```

If any count above disagrees with what those print, the counts above are wrong.
