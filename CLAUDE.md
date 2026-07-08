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

- The founder-dashboard.tsx monolith (7,379 lines) was fully decomposed across commits `f0787190` (keys) → `3ef1efed` (readiness) → `f01e5fb3` (todo merge) → `bf12d8b7` (customers/health) → `be9e37c7` (growth wizard) and ultimately retired by `f2801428` (3-screen Pulse/Cost/Customers model). The file now lives only as `client/src/pages/founder-dashboard.DELETED.bak`; the canonical founder surface is the focused `/founder/*` route set. No new code should reference founder-dashboard.tsx — add new founder surfaces as their own route.

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

**The Letter (`/founder/autopilot`) · Decisions (`/founder/decisions`) · Controls (`/founder/autopilot/control`) · Story (`/founder/autopilot/story`)** — plus the `/founder/admin/*` instrument namespace for deep panels (telemetry, costs, ETL, prompts, ML snapshots) visited deliberately.

The historical `/founder/*` set grew to ~88 routes (≥10 overlapping overviews) precisely because this rule didn't exist. Any new founder surface must live behind one of the four doors as a child/section/tab — never a new top-level overview route. The `founderFourDoors.test.ts` ratchet bounds the total `/founder/*` route count: it may only SHRINK as consolidation proceeds. When you consolidate, lower `FOUNDER_ROUTE_BASELINE` to the new count.
