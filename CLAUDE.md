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

## Commands

- `npm test` — run all tests
- `npm run check` — TypeScript type checking
- `npm run dev` — start development server
