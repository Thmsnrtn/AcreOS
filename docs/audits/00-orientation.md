# AcreOS Transformation -- Orientation Document

Generated: 2026-04-17
Directive: acreos-transformation-directive-v3.pdf

## Architecture Map

**Stack:** TypeScript / React 19 / Vite / Express / Drizzle ORM / PostgreSQL / Fly.io / Clerk Auth / Cloudflare DNS

### Scale
| Metric | Count |
|--------|-------|
| Drizzle tables (schema.ts) | 429 |
| API endpoints | 926 |
| React pages | 156 |
| Lazy-loaded routes | 145 |
| Server route files | 122 |
| Server service files | 383 |
| npm dependencies | 106 prod + 31 dev |
| DB migrations | 35 |
| schema.ts lines | 14,883 |
| Total client page LOC | ~80K |
| Total server route LOC | ~54K |
| Total server service LOC | ~163K |

### Subsystem Boundaries
- **Auth:** Clerk with `/__clerk` server-side proxy (Cloudflare conflict workaround). JWT fallback via CLERK_JWT_KEY. `server/auth/clerkAuth.ts`
- **CRM Core:** Leads, Properties, Deals, Notes. Full CRUD + import/export. ~4 route files.
- **Campaigns:** Email (SES), SMS (Twilio), Direct Mail (Lob). `routes-campaigns.ts` (1756 LOC)
- **AI/SCP:** 10+ agents (Atlas, Sophie, Forge, Beacon, etc.). OpenRouter multi-model routing. `routes-ai.ts`, `routes-founder-intelligence.ts`, 383 service files.
- **Billing:** Stripe checkout, portal, usage metering, credit system. `routes-billing.ts`
- **Founder Dashboard:** 7286-line single file. Tab-based nav (Overview, Agents, Operations, Growth, Infrastructure).
- **Marketplace:** Bidding/negotiation. `routes-marketplace.ts`
- **Maps/GIS:** Mapbox + Regrid parcel data. County GIS endpoint management.
- **Evening Review:** End-of-day passive income snapshot. `routes-night-cap.ts`
- **Documents:** Template system, e-signing integration.
- **Onboarding:** Multi-step wizard, business-type provisioning.

### Deployment
- **Fly.io:** 2 machines (performance-2x, 4GB RAM), IAD region, rolling deploy
- **Postgres:** Fly managed, shared-cpu-2x, 1GB RAM
- **Build:** Vite (client) + esbuild (server) via `script/build.ts`
- **Deploy cmd:** `flyctl deploy --depot=false --strategy rolling`
- **Domain:** acreos.io (Cloudflare DNS)

### Dependency Graph (critical)
```
ClerkProvider (proxyUrl=/__clerk)
  -> clerkMiddleware (global, populates req.auth)
  -> isAuthenticated (checks req.auth.userId + JWT fallback)
  -> hydrateUser (syncs Clerk user to DB, sets req.user)
  -> getOrCreateOrg (middleware, sets req.organization)
  -> route handlers
```

## Top 20 Suspected Problems (Priority Order)

### P0 -- Ships Broken
1. **Auth unreliable** -- Google OAuth sign-in flow is fragile. "External Account not found", redirect loops, Clerk modal overlay injecting over app. Multiple fixes attempted, still reported as intermittent.
2. **1,815 TypeScript errors** -- `tsc --noEmit` fails massively. Build uses esbuild (no type-checking) so runtime errors are latent.
3. **No tests running** -- No unit, integration, or e2e tests in CI. `npm test` config exists but no passing suite.
4. **Redis package missing** -- Health check shows "Cannot find package 'redis'" in production. Degraded status.

### P1 -- Ships Bad
5. **Founder dashboard 7286 LOC** -- Single file, overwhelmingly large. Tab nav added but still too much in one component.
6. **66 `(req as any)` unsafe casts** -- Bypasses AuthenticatedRequest type safety.
7. **No loading/error states on many pages** -- Pages crash or show blank when API fails.
8. **382KB founder dashboard JS chunk** -- Largest chunk, slow to parse.
9. **OpenAI API key invalid** -- AI features broken in production.
10. **No rate limiting per endpoint** -- Global 1000 req/min only. No per-route protection.
11. **926 API endpoints** -- Many likely dead/untested. No API inventory.
12. **Cache-Control missing on HTML** -- Fixed in code but Cloudflare cache not purged.
13. **Mobile responsiveness unverified** -- No systematic mobile testing.
14. **Dark mode contrast issues** -- Some fixed, no systematic audit.
15. **Empty state handling** -- Many pages don't handle zero-data gracefully.
16. **Setup wizard API fails** -- `/api/founder/setup/status` crashes, wizard shows blank modal.
17. **Sidebar overflow** -- Pax badge overflows in narrow sidebar. Partially fixed.
18. **No CI pipeline** -- No GitHub Actions running tests on PR.
19. **429 Drizzle tables in one file** -- 14,883-line schema.ts is unmaintainable.
20. **Service worker registration in prod** -- `sw.js` registered but may not exist, causing console errors.

## Critical Paths
1. **New user signup:** Landing -> /auth -> Google OAuth -> Clerk session -> /api/auth/user -> hydrateUser -> getOrCreateOrg -> onboarding -> /today
2. **Lead workflow:** Import CSV -> Lead list -> Score -> Campaign -> Follow-up -> Deal pipeline
3. **Deal lifecycle:** Lead -> Offer -> Due diligence -> Closing -> Note servicing -> Payments
4. **Billing:** Stripe checkout -> subscription -> usage metering -> credit deduction -> dunning
5. **Founder ops:** Dashboard -> briefing -> decisions inbox -> agent monitoring -> system health
