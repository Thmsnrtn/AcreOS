# RLS Pilot Design — database-level tenant isolation (scoped)

> **Status: DESIGN, not implemented.** This is a reviewable plan for a scoped
> Postgres row-level-security pilot. No policies are created until you approve.
> Prepared during the Phase 0/1 charter work (audit: `docs/audit/PLATFORM-AUDIT.md`
> §3, INVARIANTS `ASP-1`).

## The problem RLS solves

Tenant isolation today is **100% application-layer WHERE clauses** across ~400
org-scoped tables. The type-level `OrgScopedDb` guard (`server/utils/orgScopedDb.ts`)
makes a bare-id fetch on an org table fail to typecheck — good construction — but
it is *erasable* by any of the 1,417 baselined `as any` casts, and the
5,848-line `runScheduledJobs.ts` iterates orgs with breadth no per-query audit
can cover. One missed predicate in ~700 handlers is a cross-tenant leak; the
repo's own history has an IDOR fix and an AI-cache cross-tenant leak. A
DB-level floor makes a missed WHERE clause return **zero rows** instead of
another tenant's data.

RLS explicitly deferred in code ("pgBouncer transaction mode + ~500 tables = too
much blast radius for now"). This pilot narrows the blast radius to make it safe.

## What RLS does NOT give us

- No CPU/cache/connection isolation per tenant (RLS is row visibility only).
- No protection against a `SECURITY DEFINER` function or a superuser connection
  that bypasses policies — the app must connect as a non-superuser role.
- It does not replace the app-layer scoping; it is defense-in-depth beneath it.

## Scope: the 10 hottest tenant tables (pilot)

Start where a leak is most damaging and traffic is highest, not all 400 at once:

`leads`, `properties`, `deals`, `notes`, `payments`, `conversations`, `messages`,
`documents`, `tasks`, `activity_events`.

All 10 already carry an org-leading composite index (the `check-org-leading-index`
lint guarantees it), which is exactly the index a `USING (organization_id = ...)`
policy needs — so RLS adds no new index cost.

## Mechanism: per-transaction GUC, set at the existing chokepoint

1. **A non-superuser app role.** The app connects as a role that is subject to
   RLS (not the owner, which bypasses it). One-time role setup, documented in the
   migration.
2. **Set the tenant on every transaction** via a session GUC:
   `SET LOCAL app.org_id = <orgId>` — issued inside `withTransaction` /
   `OrgScopedDb.forOrg` (the chokepoints that already know the org). `SET LOCAL`
   is transaction-scoped, so it is **compatible with pgBouncer transaction
   pooling** (the original blocker) — the setting dies with the transaction and
   can't leak to the next borrower of the pooled connection.
3. **The policy** on each pilot table:
   ```sql
   ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
   ALTER TABLE leads FORCE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON leads
     USING (organization_id = current_setting('app.org_id', true)::int)
     WITH CHECK (organization_id = current_setting('app.org_id', true)::int);
   ```
   `current_setting(..., true)` returns NULL when unset (missing-GUC = no rows,
   fail-closed) rather than erroring.
4. **Platform/cross-org operations** (`unscopedForPlatformOps`, jobs iterating all
   orgs) run under a role or a `SET LOCAL app.bypass_rls = on` path guarded by a
   `SECURITY DEFINER` helper — the SAME greppable set of 7 files that already
   hold the sanctioned bypass. RLS makes that bypass surface explicit.

## Rollout (expand-contract, reversible at every step)

1. **Shadow (no enforcement).** Add the GUC-set to `withTransaction`/`forOrg` in
   code and deploy — it sets a harmless GUC nothing reads yet. Verify no latency
   regression. *Rollback: remove the SET LOCAL line.*
2. **One table, permissive.** Enable RLS + policy on `leads` only, on staging,
   with the app role. Run the full test suite + `idorFuzz` against it. Confirm
   normal reads work and a deliberately-unscoped query returns zero rows.
   *Rollback: `ALTER TABLE leads DISABLE ROW LEVEL SECURITY`.*
3. **One table in prod**, watched. Then roll the remaining 9 one at a time.
4. **Ratchet it.** Add a down-only "org-scoped tables without RLS" count
   (mirroring `check-org-leading-index`), so coverage can only grow. Baseline =
   (org-scoped tables − 10). Every future table lands with RLS or the ratchet
   fails.

## Tests that gate it

- A cross-tenant **leak test** that must FAIL loudly if a policy regresses:
  set `app.org_id = A`, attempt to read org B's row by id, assert zero rows.
  This is the automated proof the charter (§6.4) demands.
- The existing `idorFuzz` harness, run against an RLS-enabled staging DB, should
  now return zero cross-tenant rows even on routes with a missing WHERE clause.

## What needs YOU

- Approval of the app-role split (a one-time DB role + connection-string change,
  a fly secret).
- A staging window to run steps 1–2 and watch latency.
- A decision on the pilot table list (the 10 above are the recommendation).

## Definition of done (pilot)

- The 10 tables enforce RLS in prod; the leak test is a required check.
- `docs/INVARIANTS.md` ASP-1 reclassified from "aspirational" to "current
  (pilot: 10 tables)" with the ratchet reference.
- No latency regression at p75 on the hot read paths.
