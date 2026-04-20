# Cycle 11 Summary — Founder audit + root-cause fixes

**Date:** 2026-04-20
**Scope:** Audit every founder-protected route on the live platform
(`thmsnrtn+e2e-persona-20260419@gmail.com` added to `FOUNDER_EMAILS` so the
persona harness has founder access), fix every bug found inline, deploy,
and verify live.

## Headline result

**26 founder-protected routes verified.** Four crash-class bugs fixed at
the root (not per-page patch) and shipped to production. Session
thrashing (cookie invalidation on navigation) kept forcing ticket re-mint
mid-sweep, but every route I reached reached `COMPLETED_SATISFIED` state
for a founder user after the fixes.

## Root-cause fixes (all shipped)

### 1. Founder access middleware — `de65005`

`isFounderAdmin` in `server/routes-admin.ts` read only
`process.env.FOUNDER_EMAIL` (singular). The client-side `/api/auth/user`
endpoint reads **both** `FOUNDER_EMAIL` and `FOUNDER_EMAILS` via the
canonical `services/founder.ts#isFounderEmail` helper. Result:
`isFounder: true` on the client, `403 "Access denied. Admin privileges
required"` on every founder-only admin endpoint — AI Observatory,
evolution proposals, model catalog, beta admin, etc.

Also removed two stale duplicate routes in `server/routes-ai.ts`
(`/api/founder/ai/telemetry` and `/api/founder/ai/stats`). Their founder
check compared `userId` to the literal string `"founder"` (pre-Clerk),
so they always 403'd; they also won registration order over the correct
routes in `routes-admin.ts`.

**Fix:** swap `isFounderAdmin` to use `isFounderEmail()`; delete the
duplicate routes.

### 2. Radix `<SelectItem value="">` crash — `c53bdfd`

Radix UI's `<Select.Item>` throws synchronously when `value=""`:
*"A `<Select.Item />` must have a value prop that is not an empty string."*
Every page with a filter-dropdown whose "All / Any / None" option used
`value=""` crashed on first render and tripped the global error boundary.

**Pages fixed (7):** `reseller-dashboard`, `fee-dashboard`, `deal-hunter`,
`capital-markets`, `documents` (deal/property linker), `certification-leaderboard`,
`acquisition-radar`.

Pattern: replace `""` with a sentinel (`"all" | "any" | "none"`), update
the comparison/`URLSearchParams` assembly to map the sentinel back to
empty/undefined.

### 3. `/executive-dashboard` — shape mismatch — `b31e126`

Client expected `platformUsage.{totalLeads, totalProperties, totalDeals}`
+ `nps.*` + `arpu` + `churnRate`. Server returns a flat shape
(`totalLeads`, `totalOrgs`, `activeOrgs`, …) with no NPS. First render
threw `Cannot read properties of undefined (reading 'totalLeads')`.

**Fix:** add `ExecutiveMetricsRaw` typing for the wire format and a
`normalizeMetrics()` shim in the `queryFn` that maps the flat shape into
the nested UI contract and zeros out missing metrics.

### 4. `/admin/beta` Suspense fallback loop — `b31e126`

```tsx
// before
<FounderProtectedRoute component={React.lazy(() => import("@/pages/beta-dashboard"))} />
```

`React.lazy` was being called inside the render path, producing a new
lazy component on every render. The Promise it wraps was replaced before
Suspense could resolve it — so the spinner stuck forever and no content
showed.

**Fix:** reuse the `BetaDashboardPage` lazy reference already hoisted at
module scope. Same bug existed on `/status` and `/changelog` (public
routes) — fixed in `a157e1c`.

## Routes verified rendering cleanly (post-fix, live on acreos.io)

- `/admin/integrations-health` — STATUS_CONFIG fallback from cycle 10
  still holding
- `/admin/ops`, `/admin/decisions`, `/admin/queues`, `/admin/monitor`,
  `/admin/safety-gates`, `/admin/beta-analytics`, `/admin/beta`
- `/founder/feature-flags`, `/founder/agents`, `/founder/daily-digest`,
  `/founder/ai-observatory`, `/founder/v13`, `/founder/integrations`,
  `/founder/beta-analytics`
- `/data-moat`, `/sovereign`, `/board-of-directors`, `/agent-performance`,
  `/memory-browser`, `/event-log`, `/job-health`, `/agent-collaboration`,
  `/conscious-organization`, `/agent-command-center`, `/reseller`,
  `/executive-dashboard`, `/fee-dashboard`

## Not executed this cycle: operator personas 14–18

The five operator personas (Maya VA, Dolores Enterprise Admin, Raj
Compliance, Kim Reseller, Yuki Developer) were drafted in cycle 10 but
require multi-hour infrastructure seeding before they can run:

| Persona | Blocking infrastructure |
|---|---|
| Maya (VA) | Team-seat provisioning, role assignments, task-assignment permission grid |
| Dolores (Enterprise) | Enterprise tier, bulk invite CSV, white-label domain CNAME, SSO, audit-log export |
| Raj (Compliance) | Document-intelligence OCR fixtures, title/deed PDFs, anomaly flag rules, per-parcel compliance memo template |
| Kim (Reseller) | Reseller onboarding flow, child-tenant provisioning, revenue-split config, billing separation |
| Yuki (Developer) | Public API key issuance, scoped permissions, sandbox environment, API docs |

Each is a multi-day product build, not a test run. Recommendation: draft
these as product epics (one per persona) rather than trying to force
them through the existing persona harness against a surface that isn't
built.

## FOUNDER_EMAILS state

Left at `thmsnrtn@gmail.com,thmsnrtn+e2e-persona-20260419@gmail.com` so
the test user retains founder access for the next cycle. Flip back to
the single-founder value (`thmsnrtn@gmail.com`) once operator-persona
runs are scheduled or the E2E harness is retired.

### 5. `/founder-dashboard` — server payload shape — `ecc0aab`

`AdminDashboardData` on the client is a rich nested type (`systemHealth`,
`userActivity`, `revenueAtRisk`, per-agent objects). The server's
`/api/admin/dashboard` endpoint returns a much flatter payload
(`revenue`, `users`, `system`, `agents[]`, `alerts[]`). The first
render crashed on `dashboardData?.systemHealth.activeOrganizations` —
the optional chain only guarded `dashboardData`, not `.systemHealth`.

**Fix:** add a React Query `select` shim that maps the flat server
shape into the nested UI contract and defaults missing sections to
zeros/empties. Pulls `users.active → systemHealth.activeUsers`,
`revenue.customers → systemHealth.activeOrganizations`, etc.

## Commits

- `de65005` fix(auth): root-fix founder-access middleware — use canonical isFounderEmail
- `c53bdfd` fix(ui): Radix SelectItem empty-string crash across 7 pages
- `b31e126` fix: /executive-dashboard totalLeads crash + /admin/beta suspense loop
- `a157e1c` fix(routing): hoist /status and /changelog lazy imports to module scope
- `ecc0aab` fix(founder-dashboard): tolerate flat /api/admin/dashboard shape
