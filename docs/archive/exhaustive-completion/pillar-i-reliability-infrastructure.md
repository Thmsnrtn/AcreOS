# Pillar I — Reliability as a product surface

The diagnostic route-sweep from session 2026-05-14 surfaced 14
production crashes that had been silently failing. The audit cost
~1 day of session time. The 5 bug classes that surfaced:

| Class | Examples | Detectable statically? |
|---|---|---|
| Hooks-in-helpers | `useDocumentTitle()` inside `fmtUsd()` (6 founder pages) | Yes (ESLint AST) |
| Schema-missing-column refs | `agentActionLog.description`, `transactionTraining.organizationId`, `agentEvents.agentCodename` | Yes (drizzle column validation) |
| queryKey-with-object missing queryFn | `["/api/inbox", emailQueryParams]` → `/api/inbox/[object Object]` | Yes (ESLint AST) |
| Server-route URL mismatch | `/api/organization/members` vs `/api/team` | Partially (would need handler registry walk) |
| Wrong response-shape contract | `CriticalAlertsApi: CriticalAlert[]` vs server `{ alerts, thresholds }` | Yes (zod schema validation at API boundary) |

Productizing the diagnostic that found these → Pillar I.

---

## Goals

1. **Zero classes of bugs from this session reach `main` again.** Each
   bug class becomes a pre-commit / pre-merge gate.
2. **Every production-deployed commit has been route-swept.** The route
   sweep that took 20 minutes manually becomes a 3-minute CI step.
3. **SLO visibility** — founder + agent see the same per-route error
   budget burn. No more "found by Playwright two months later."

---

## Shipped in this PR

### A. Schema column validator (the highest-leverage single tool)

`scripts/validate-schema-column-refs.ts` — a TS-AST walker that
inspects every `db.select({...})` and `db.insert(table).values({...})`
call site and verifies that every referenced column exists on the
drizzle schema. Built as a node script so it can run in pre-commit
and in CI.

Would have caught (this session):
- `agentActionLog.description`
- `agentActionLog.metadata`
- `transactionTraining.organizationId`
- `transactionTraining.acres`
- `transactionTraining.location`
- `agentEvents.agentCodename` (in 6 callsites)

Run: `npx tsx scripts/validate-schema-column-refs.ts`

### B. Pre-commit + CI wiring

`.github/workflows/schema-validation.yml` — runs the validator on
every PR, blocking merge on missing column refs.

`.husky/pre-commit` (if husky installed) — invokes the validator on
staged TS files only.

### C. Route-sweep CI gate (documented, not yet wired)

The existing `tests/e2e/route-sweep.spec.ts` can run against a Fly
preview app on every PR. Wired via a follow-up CI workflow once a
review-app pattern is set up. Sketch in `.github/workflows/route-sweep-preview.yml.disabled`.

### D. ESLint rules (queued, blocked on AST authoring)

Real implementation:
- `no-hooks-in-formatter` — flag `useXxx()` calls inside any function
  whose name matches `/^(fmt|format|render|get|to|is|has|make|build)[A-Z]/`.
- `query-key-object-requires-fn` — flag `useQuery({ queryKey: [...,
  { ... }] })` when there's no sibling `queryFn` property.

Both are ESLint-rule projects of their own; queued for the next
Pillar I PR.

### E. SLO dashboard (queued)

`/founder/reliability` — already a sibling concern of the existing
`/founder/telemetry` surface. Queued; needs Prometheus aggregation
patterns we don't yet have.

---

## Action queue (for follow-up PRs)

1. ESLint rule packages (`@acreos/eslint-plugin-acreos-reliability`).
2. Route-sweep CI on preview deploy (needs Fly review-app config).
3. SLO dashboard surface at `/founder/reliability`.
4. Schema-drift detector — agent compares `shared/schema.ts` against
   live `pg_catalog` every 6h; flags missing migrations.
5. Anomaly pager — page founder when fly logs match a known-bad
   pattern (the `Cannot convert undefined or null to object` family,
   NOT NULL violations, etc.).
