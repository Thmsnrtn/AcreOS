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

## Operator personas 14–18 — surface-feasibility sweep

Drove each operator persona's primary surface as the founder test user
to shake out crashes before running them end-to-end. Results below.
Note: several of the persona journeys (RBAC boundary checks, white-label
leak audits) require a **non-founder** test user, which is its own
infrastructure build and is still deferred.

| # | Persona | Surface | State |
|---|---|---|---|
| 14 | Maya (VA) | `/team-inbox` | Renders: channels + DMs + #acquisitions/#closings/#general. ✅ |
| 14 | Maya (VA) | `/team-dashboard` | **Crashed** `j.filter is not a function`. **Fixed** in `9bdc3cb` — envelope unwrap via `fetchJsonArray` + defensive `Array.isArray`. ✅ |
| 14 | Maya (VA) | `/audit-log` | Renders. ✅ |
| 15 | Dolores (Enterprise) | `/settings → Team / Developer / Security / Privacy / Integrations` | All tabs mounted. Seat management panel shows 1/1000 used, unlimited tier. ✅ |
| 15 | Dolores (Enterprise) | `/audit-log` | Exists and renders. ✅ (Per-user / date-range export UI is present in the page; not stress-tested this cycle.) |
| 16 | Raj (Compliance) | `/compliance` | Renders h1 "Compliance AI". ✅ |
| 16 | Raj (Compliance) | `/document-intelligence` | Renders h1 "Document Intelligence". ✅ |
| 16 | Raj (Compliance) | `/tax-delinquent` | Renders h1 "Tax Delinquent Pipeline". ✅ |
| 17 | Kim (Reseller) | `/reseller` | Renders after the `SelectItem value=""` fix from `c53bdfd`. Includes Tenants / Analytics / White-Label tabs + CreateTenantDialog. ✅ |
| 18 | Yuki (Developer) | `/settings → Developer` | Tab has Demo Data + **ApiKeyManager** (create/rotate/revoke) + ActivityLogPanel. ✅ |
| 18 | Yuki (Developer) | `/webhooks` | Renders. ✅ |
| 18 | Yuki (Developer) | `/openapi.json` | Returns 200 (spec is published). ✅ |

### Remaining blockers for full execution

These aren't missing surfaces — they're infrastructure prerequisites
the persona harness needs before the assigned journeys can produce a
useful verdict:

- **RBAC boundary check (Maya T03)** — needs a non-founder seat user
  provisioned against the test org, plus an invite-accept flow that
  sets a password and lands on `/today` scoped to the seat's org.
- **White-label leak audit (Kim P03)** — needs a student tenant under
  the reseller account and a student login to grep every visible
  surface for the string "AcreOS".
- **Stripe Connect reconciliation (Kim P02)** — needs real Stripe
  Connect payouts in test mode to compare against the reseller MRR
  dashboard.
- **Bulk seat CSV provisioning (Dolores E01)** — the Team tab has
  per-user invite but no documented bulk-CSV path; either expose the
  bulk path in the UI or add one.
- **OCR anomaly fixtures (Raj C01)** — need a canonical stack of
  scanned deeds / title commitments with known anomalies (mineral
  reservations, easements, HOA liens) to run the document-intelligence
  flow against deterministic expected output.

Each of these is a product/infra task of a few hours to a day, not a
persona run. Recommendation: open one tracking ticket per bullet, seed
the fixtures, then re-drive the persona in a follow-up cycle.

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
- `9bdc3cb` fix(team-dashboard): unwrap envelope + defensive guards
