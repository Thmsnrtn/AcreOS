# AcreOS Engineering Standards

## Request Types

Always use `AuthenticatedRequest` from `server/types/request.ts` in route handlers.
Never use `(req as any)` — the Express request is augmented with `organization`, `organizationId`, `permissionContext`, and `isFounder`.

Helper functions available:
- `getOrganization(req)` — throws if org missing
- `getUserId(req)` — throws if user missing
- `getOrganizationId(req)` — throws if org missing

## Error Responses

Always use `Errors.*` helpers from `server/utils/errors.ts` instead of raw `res.status(X).json(...)`.

Available helpers:
- `Errors.notFound(res, "Lead")` — 404
- `Errors.badRequest(res, "Invalid input", details?)` — 400
- `Errors.validationFailed(res, zodErrors)` — 422
- `Errors.unauthorized(res)` — 401
- `Errors.forbidden(res, message?)` — 403
- `Errors.limitExceeded(res, details)` — 429
- `Errors.internal(res, error)` — 500 (auto-logs)

All responses conform to `{ error, message, details?, statusCode }`.

## Logging

Always use structured `logger` from `server/utils/logger.ts`. Never use `console.log/warn/error` in production server code.

## UI Patterns

- **Loading states**: Use `Skeleton` components matching the content shape, not spinners
- **Empty states**: Use the `EmptyState` component with purposeful CTAs
- **Error states**: Use `QueryErrorState` component with retry support
- **Animation**: Use `staggerContainer` + `staggerItem` from `client/src/lib/animations.ts`
- **Components**: Use shadcn/ui components and Tailwind design tokens — never hardcode colors

## Accessibility

- Every icon-only button must have `aria-label`
- Every interactive element must have visible focus state
- Every form input must have an associated label

## Data Providers

All external data flows through the provider registry (`server/services/providers/`).
Providers are registered by category and priority. The registry handles:
- Tier-based filtering
- Credit deduction on paid lookups
- Circuit breaking (3 failures in 5 min = skip)
- Response caching via `provider_cache` table

## Known monoliths

- The founder-dashboard.tsx monolith (7,379 lines) was fully decomposed across commits `f0787190` (keys) → `3ef1efed` (readiness) → `f01e5fb3` (todo merge) → `bf12d8b7` (customers/health) → `be9e37c7` (growth wizard) and ultimately retired by `f2801428` (3-screen Pulse/Cost/Customers model). The file has since been fully deleted from the repo (the `.DELETED.bak` residue is gone too); the canonical founder surface is the focused `/founder/*` route set. No new code should reference founder-dashboard.tsx — add new founder surfaces as their own route.

## Commands

- `npm test` — run all tests
- `npm run check` — TypeScript type checking
- `npm run dev` — start development server

## Customer navigation — five fixed doors

The customer-facing nav is exactly five doors, identical for every persona and on every device:

**Today · Map · Deals · Finance · Pax** — plus **Inbox** and **Settings**, reachable from the top bar.

Persona changes only the CONTENT behind each door (persona-gated sections, vocabulary, Finance tabs, the `businessTypeOnly` verticals), never the doors themselves. Any new customer surface must live behind one of these doors as a child/section/tab — never as a new top-level nav entry. The desktop sidebar (`NAV_MODULES` in `client/src/components/layout-sidebar.tsx`), the mobile bottom nav (`MOBILE_DOORS`), and `DEFAULT_SIDEBAR_ITEMS` in `client/src/lib/nav-items.ts` must all reflect this model. Founder-only and `businessTypeOnly` modules are the only exceptions, and they remain gated.

## Founder navigation — four fixed doors

The founder surface follows the SAME discipline as the customer side — the more the autopilot operates the business, the FEWER doors the founder needs. The canonical model (`FOUNDER_DOORS` in `client/src/lib/founder-doors.ts`) is exactly four primary doors plus one deliberate admin namespace:

**The Letter (`/founder`) · Decisions (`/founder/decisions`) · Controls (`/founder/autopilot/control`) · Story (`/founder/autopilot/story`)** — plus the `/founder/admin/*` instrument namespace for deep panels (telemetry, costs, ETL, prompts, ML snapshots) visited deliberately. (`/founder/autopilot` is a legacy alias that redirects to `/founder`; the earlier Lens-4 "Bridge" home at `/founder/bridge` is now a deep chat+telemetry tool, not a home.)

The historical `/founder/*` set grew to ~88 routes (≥10 overlapping overviews) precisely because this rule didn't exist. Any new founder surface must live behind one of the four doors as a child/section/tab — never a new top-level overview route. The `founderFourDoors.test.ts` ratchet bounds the total `/founder/*` route count: it may only SHRINK as consolidation proceeds. When you consolidate, lower `FOUNDER_ROUTE_BASELINE` to the new count.

## The DO-NOT-DO list (standing founder decisions — do not relitigate)

Each line below is an existing decision recorded in `docs/company/roadmap-2026-07.md`, the deletion ledger, or a dated founder decision. Future sessions enforce them; only the founder can rescind one, explicitly.

These decisions are also mirrored, machine-readable, in `shared/governance/constitution.ts` — each tagged with *how* it is enforced (code-invariant / ratchet-test / lint / prose-only). The `constitution.test.ts` ratchet checks every enforcement pointer still resolves and holds the count of **unenforced hard-stops** at ≤ its baseline (it may only shrink). When you add real enforcement for a prose-only hard-stop, reclassify it there and lower the baseline. Keep the registry in sync with this list — the registry is the checkable form of what's written here.

- **No marketplace before ~25 customers; no public API before ~50** (the approved expansion ladder).
- **No new persona verticals**, and **no new top-level nav entries EVER** — customer or founder side. New surfaces live behind existing doors (see the two doors sections above). The five customer doors may never be hidden per-persona (`PROTECTED_DOOR_ROUTES` in `client/src/lib/sidebar-hidden-routes.ts` + `sidebarHiddenRoutes.test.ts` ratchet).
- **No re-fronting platform send rails**: counterparty mail requires the org's own connected identity (BYO); the platform sender is for system mail only (`emailService` purpose lanes, founder decision 2026-07-17).
- **Be the rail, not the provider — customer money never moves on AcreOS's own account** (founder ruling 2026-07-29). Subscription payments TO AcreOS are the only payments AcreOS is a party to; any customer-managed money movement (borrower note payments, rent, escrow, distributions) runs on the customer's OWN connected processor account or is routed out entirely — no platform-account fallback, no application fee, no funds transiting AcreOS's balance (`customerMoneyRouting.ts` chokepoint + `moneyCustodyHardStop.test.ts` ratchet).
- **No residential-comps data plane** before its revenue trigger.
- **No new AI destinations** — Pax stays ambient fabric behind the doors, never a separate app-within-the-app.
- **Fabrication is never acceptable**: no invented numbers, no fake activity, no placeholder data presented as real. Refuse-not-fabricate everywhere (`lint:no-fabrication` gate).
- **Hard-stops stay founder-only forever**: pricing changes, legal signing, spends >$500, customer-data deletion.

## Wave discipline — never trust a wave's self-report

Large changes ship as "waves": a fleet of parallel agents with exclusive file
sets, then central verification, then one PR. This works, but it has one
repeatable failure mode, and it has bitten this repo more than once:

**An agent reports success for the part it built, and is blind to the part it
didn't.** Wave B ("Wire the engine", `86e46f59`) wired workflow emitters for
deal/property/payment but added only the *lead* lane to
`shared/workflow-live-triggers.ts` — so six triggers that genuinely fired were
still badged "Not yet live" in the builder. Every agent involved reported
success. In the same program a schema table shipped with no migration (would
have 500'd on deploy), a *selected* DNC provider without credentials silently
collapsed to "no vendor configured" and passed every number, and an `as any`
widened `leads.organizationId` — a `NOT NULL` tenant key — to
`number | undefined`.

So, for every wave:

1. **Verify claims against code, never against reports.** Run the gates
   yourself (`npm run check`, `npm test`, `npm run build`). A green agent
   report is a hypothesis.
2. **Run an independent completeness audit before the PR merges** — a fresh
   agent that did not build the wave, told to treat each claim as a hypothesis
   and hunt for residue. Cheap relative to shipping a lie.
3. **Hunt "built but unwired" specifically.** It is this codebase's single most
   common defect: new route files never mounted, jobs never registered,
   services with zero call sites, schema without migrations, tables nothing
   reads. Grep new exports for call sites.
4. **When a wave makes a stubbed thing real, update the test that pinned the
   stub — do not delete it.** Rewrite the assertion to the new truth so the
   original invariant survives (see `workflowActionHonesty.test.ts`, whose
   live-trigger check is now *derived* from real emitter call sites rather than
   a hardcoded list, so it cannot go stale again).
5. **Fix the occurrence, not the baseline.** Ratchets are load-bearing; when a
   count legitimately drops, lower it in the same commit.
