# Lens 13 -- TypeScript Engineer Audit

**Auditor perspective:** TypeScript type-safety, `any` suppression, assertion patterns, generic usage, module boundaries, whether TS provides real safety or just ceremony.

**Date:** 2026-04-15

---

## Executive Summary

TypeScript in AcreOS is **ceremonial, not protective**. The codebase has `strict: true` in tsconfig.json but 1,815+ `tsc --noEmit` errors. The build pipeline (esbuild) skips type-checking entirely, so broken types ship to production. A parallel `tsconfig.check.json` exists but uses `noResolve: true`, which skips all import resolution -- meaning it catches essentially nothing. The CI workflow (`deploy.yml`) gates on `npx tsc --noEmit` which would fail on every run, indicating CI is either never green or disabled. Meanwhile, 1,468+ `as any` casts, 2,195 `: any` typed catch blocks, and 117 `Record<string, any>` columns in the schema systematically disable the type system across the codebase.

---

## P0 -- Type Unsafety Causing Runtime Errors

### P0-TS-01: Build skips type-checking; 1,815+ tsc errors are invisible

- **File:** `script/build.ts` (lines 50-62)
- **Config:** `tsconfig.json` has `strict: true` but the build uses `esbuild`, which transpiles without type-checking
- The Dockerfile runs `npm run build` which invokes `script/build.ts` -- no `tsc` step
- `npm run check` uses `tsconfig.check.json` which sets `noResolve: true` -- this skips import resolution entirely, producing **zero errors** on a codebase with 1,815+ real errors
- **Impact:** Any type error (wrong argument count, misspelled property, undefined access) compiles and ships to production. The type system provides zero protection.

### P0-TS-02: 63 route files have zero authentication middleware

- 63 of ~121 route files never reference `isAuthenticated`, meaning all their endpoints are publicly accessible with untyped `req.body`
- Examples: all `routes-founder-v{6..14}.ts`, `routes-epic-services.ts`, `routes-scp-v2.ts`, `routes-data-intelligence.ts`, `routes-academy.ts`, `routes-compliance.ts`
- These files accept `req.body` directly without validation or type narrowing, and use `catch (err: any) { res.status(500).json({ error: err.message }) }` which leaks internal error details
- **Impact:** Untyped, unauthenticated endpoints accepting arbitrary JSON. This is both a type-safety and security problem.

### P0-TS-03: `server/types/shims.d.ts` declares `req.org` and `req.organization` as `any`

- **File:** `server/types/shims.d.ts` (lines 24-29)
- This ambient declaration `declare namespace Express { interface Request { org?: any; organization?: any; } }` defeats the purpose of `AuthenticatedRequest`
- Combined with `server/types/express.d.ts` which properly types `req.organization` as `Organization | undefined`, there are **conflicting type declarations** for the same property
- **Impact:** `req.organization` resolves to `any` in most files, meaning `org.id`, `org.nonExistent`, etc. all compile without error. Property access typos cause silent runtime `undefined`.

### P0-TS-04: `catch (err: any)` in 2,195+ locations suppresses unknown-catch safety

- **Server:** 2,195 occurrences of `catch (err: any)` / `catch (error: any)` across 227 files
- **Client:** 37 occurrences across 25 files
- With `strict: true`, TypeScript types catch variables as `unknown`, forcing safe narrowing. Annotating `err: any` removes this protection entirely
- The dominant pattern is `catch (err: any) { res.status(500).json({ error: err.message }) }` which will throw a secondary error if `err` is not an Error object (e.g., a string throw or null)
- **Impact:** Internal error messages leak to clients. Non-Error throws cause uncaught secondary exceptions.

---

## P1 -- Widespread `any` Undermining the Type System

### P1-TS-01: 1,468 `as any` casts across 327 files

| Scope | `as any` count | Files |
|-------|---------------|-------|
| Server `.ts` | 1,363 | 277 |
| Client `.tsx`/`.ts` | 105 | 50 |
| **Total** | **1,468** | **327** |

Top offenders (server):
- `server/services/onboarding.ts` -- 60 casts in 1,422 lines (1 per 24 lines)
- `server/routes-admin.ts` -- 46 casts in 4,898 lines
- `server/ai/supportAgent.ts` -- 28 casts
- `server/ai/tools.ts` -- 27 casts
- `server/routes-ai.ts` -- 26 casts
- `server/routes.ts` -- 23 casts
- `server/routes-communications.ts` -- 23 casts
- `server/routes-support-tickets.ts` -- 21 casts
- `server/routes-2fa.ts` -- 23 casts

Top offenders (client):
- `client/src/pages/field-scout.tsx` -- 14 casts
- `client/src/pages/properties.tsx` -- 12 casts
- `client/src/components/research-summary-panel.tsx` -- 8 casts
- `client/src/lib/queryClient.ts` -- 7 casts (in core infrastructure)

### P1-TS-02: 3,587 explicit `: any` type annotations

| Scope | `: any` count | Files |
|-------|--------------|-------|
| Server `.ts` | 3,045 | 349 |
| Client `.tsx`/`.ts` | 542 | 140 |
| **Total** | **3,587** | **489** |

This is the dominant form of type suppression. Functions, parameters, variables, and return types annotated as `any` disable downstream type inference for everything that touches them.

### P1-TS-03: 66 `(req as any)` casts bypass `AuthenticatedRequest`

- 66 occurrences across 21 server files
- The `AuthenticatedRequest` type exists at `server/types/request.ts` with proper typing and helper functions (`getOrganization`, `getUserId`, `getOrganizationId`)
- Only 12 route files import `AuthenticatedRequest` (out of ~121 route files)
- **Most common pattern:** `const org = (req as any).organization` in `server/routes-admin.ts` (16 occurrences), `server/routes-2fa.ts` (8 occurrences)
- **Impact:** The well-designed `AuthenticatedRequest` type is almost entirely unused. Route handlers operate on untyped request objects.

### P1-TS-04: 117 `Record<string, any>` columns in the database schema

- **File:** `shared/schema.ts` (14,883 lines)
- 117 `jsonb` columns typed as `Record<string, any>` -- these are the most dangerous because they are the source of truth for all data flowing through the system
- Some columns do have proper `$type<>` narrowing (e.g., `onboardingData`), but the majority use the `any` escape hatch
- Data read from these columns propagates `any` through service layers, route handlers, and API responses
- **Impact:** The database layer -- which should be the foundation of type safety -- actively injects `any` into the entire data flow.

### P1-TS-05: 1,359 untyped route handlers (`async (req, res) =>`)

- 1,359 route handler callbacks use `async (req, res) =>` without typing `req`
- Only 558 handlers type `req` explicitly (as `req: Request` etc.)
- Without explicit typing, `req` inherits the ambient `Express.Request` augmentation which (due to P0-TS-03) resolves `organization` to `any`
- **Impact:** The vast majority of route handlers have no type safety on request properties.

### P1-TS-06: Client-side `any` in shims.d.ts

- **File:** `client/src/types/shims.d.ts`
- Declares 5 modules with `export const X: any` -- `ActivityTimeline`, `ActivityFeed`, `OnboardingProgress`, `AbTestsContent`, `SavedViewsSelector`
- These are real components used across the app, typed as `any`, meaning all prop checking is disabled
- **Impact:** Prop type errors in these components are invisible at compile time.

### P1-TS-07: 56 double-cast `as unknown as` patterns

- 56 occurrences across 15 files
- The `as unknown as T` pattern is a deliberate override of TypeScript's type system, used when a direct `as T` cast is rejected
- Concentrated in test files (35 in test files) and middleware (4 in `fieldEncryption.ts`)
- **Impact:** These are the most aggressive type overrides and indicate places where types fundamentally disagree with runtime reality.

---

## P2 -- Improvements

### P2-TS-01: `z.custom<>` in shared API contract provides no runtime validation

- **File:** `shared/routes.ts` (11 occurrences)
- `z.custom<typeof leads.$inferSelect>()` creates a Zod schema that accepts any value at runtime while appearing typed at compile time
- The API contract layer (`shared/routes.ts`) is therefore decorative -- it provides no actual request/response validation
- **Recommendation:** Use `z.object()` with explicit field definitions, or generate schemas from Drizzle table definitions.

### P2-TS-02: No request body validation in most routes

- `req.body` is accessed 885 times across 119 route files
- `validateBody` middleware exists at `server/middleware/validateBody.ts` but is imported in **zero route files**
- Only 16 routes use `.parse(req.body)` and 123 use `.safeParse(req.body)` -- total ~139 out of 885 body accesses
- `parseInt(req.params.id)` appears 616 times with no NaN checking
- **Impact:** ~85% of request body accesses are completely unvalidated. Any shape of JSON is accepted and passed through.

### P2-TS-03: Shared types are schema-derived, not API-contract-derived

- `shared/` directory contains `schema.ts` (14,883 lines, 429 tables), `routes.ts`, and `models/` (2 files: `auth.ts`, `chat.ts`)
- Client imports from `@shared/schema` (70 files) get Drizzle table types, but these are insert/select shapes, not API response shapes
- There is no shared type for API responses -- the client infers types from `res.json()` which returns `any`
- **Recommendation:** Define explicit API response types in `shared/` and use them in both client queries and server responses.

### P2-TS-04: Generic usage is minimal

- Only 22 generic function definitions found across the entire server codebase
- `validateBody<T>` is the only infrastructure generic, and it is never imported
- No generic utility types for common patterns (paginated responses, error envelopes, CRUD operations)
- **Recommendation:** Introduce generic types for API response shapes, paginated lists, and error envelopes.

### P2-TS-05: `getQueryFn` returns untyped `res.json()`

- **File:** `client/src/lib/queryClient.ts` (line 159)
- `return await res.json()` -- `Response.json()` returns `Promise<any>`
- The generic parameter `T` in `getQueryFn<T>` is not connected to the actual data -- it is a lie
- Every `useQuery` call that relies on this function gets `any` data at runtime
- With 418 `useQuery<` and 208 `useQuery({` calls across the client, every query result is effectively untyped
- **Impact:** The entire client data layer has no type safety on API responses.

### P2-TS-06: Inconsistent error response shapes

- 27 route files use `Errors.*` helpers (1,086 occurrences) which produce consistent `{ error, message, details, statusCode }` shapes
- The remaining ~94 route files use raw `res.status(X).json(...)` with ad-hoc shapes
- 684 occurrences of `res.status(500).json({ error: err.message })` -- a completely different shape
- **Impact:** Client error handling cannot rely on a consistent error type.

---

## P3 -- Backlog

### P3-TS-01: `Stripe.Event` shimmed as empty interface

- **File:** `server/types/shims.d.ts` (line 7)
- `declare namespace Stripe { interface Event {} }` -- the Stripe webhook handler operates on an empty type
- All Stripe event property access is untyped
- **Recommendation:** Import `Stripe` types from the `stripe` package directly.

### P3-TS-02: `GeoJSON` namespace shimmed with empty interfaces

- **File:** `server/types/shims.d.ts` (lines 17-21)
- `Geometry`, `Polygon`, `MultiPolygon` are empty interfaces
- Property access on GeoJSON objects is untyped
- **Recommendation:** Install `@types/geojson` and use proper types.

### P3-TS-03: 17 `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` directives

- 17 occurrences across 17 files
- Each one silences a specific error without documentation of why
- **Recommendation:** Replace with proper types or add explanatory comments.

### P3-TS-04: `tsconfig.check.json` provides false confidence

- `noResolve: true` means TypeScript does not follow any `import` statements
- The `include` only covers `server/types/shims.d.ts`
- The `exclude` list exempts specific troublesome components
- Running `npx tsc -p tsconfig.check.json` produces **zero errors** on a codebase with 1,815+ real errors
- `npm run check` is therefore a no-op that always passes
- **Recommendation:** Remove `tsconfig.check.json` entirely and fix the real `tsconfig.json` errors incrementally.

### P3-TS-05: No path-based module boundaries

- `tsconfig.json` defines two path aliases: `@/*` (client) and `@shared/*` (shared)
- Server code has no path alias -- it uses relative imports like `"./storage"`, `"../utils/logger"`
- No `composite` project references to enforce module boundaries
- Client can import server types and vice versa with no compiler error
- **Recommendation:** Set up TypeScript project references with `composite: true` to enforce client/server/shared boundaries.

---

## Quantitative Summary

| Metric | Count |
|--------|-------|
| `tsc --noEmit` errors | 1,815+ |
| `as any` casts | 1,468 |
| `: any` annotations | 3,587 |
| `(req as any)` casts | 66 |
| `catch (err: any)` blocks | 2,232 |
| `Record<string, any>` in schema | 117 |
| `as unknown as` double casts | 56 |
| `@ts-ignore` / `@ts-expect-error` | 17 |
| Route files with 0 auth middleware | 63 / 121 |
| Route files importing `AuthenticatedRequest` | 9 / 121 |
| `req.body` accesses without validation | ~746 / 885 |
| `parseInt(req.params)` without NaN check | 616 |
| `useQuery` calls relying on untyped `res.json()` | 626 |
| `validateBody` middleware imports in routes | 0 |
| Generic function definitions (server) | 22 |
| Files in `shared/` | 5 files, 4 actual types |

---

## Recommended Fix Order

1. **Fix `shims.d.ts` conflicts** (P0-TS-03) -- Remove the `any`-typed Express augmentation. One hour of work, immediate safety gain across every route handler.
2. **Enable `tsc` in build or CI** (P0-TS-01) -- Either add `tsc --noEmit` before esbuild in `script/build.ts`, or ensure CI actually runs. Start with `skipLibCheck: true` and fix errors incrementally.
3. **Replace `catch (err: any)` with `catch (err: unknown)`** (P0-TS-04) -- Mechanical find-and-replace with a helper like `ensureError(err)`. Prevents error message leaks and secondary throws.
4. **Adopt `AuthenticatedRequest` in all route files** (P1-TS-03) -- Mechanical refactor: type handler parameters as `req: AuthenticatedRequest`. Eliminates all 66 `(req as any)` casts.
5. **Wire `validateBody` into routes** (P2-TS-02) -- For each route that reads `req.body`, add the existing middleware. Provides runtime validation and compile-time type narrowing simultaneously.
6. **Type the `getQueryFn` return** (P2-TS-05) -- Thread response types from `@shared/` through the query layer so `useQuery` results are typed.
7. **Replace `Record<string, any>` schema columns** (P1-TS-04) -- Define proper `$type<>` interfaces for each jsonb column. Largest effort but highest long-term payoff.
