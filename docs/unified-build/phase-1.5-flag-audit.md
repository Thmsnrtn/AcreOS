## Phase 1.5 — Feature flag infrastructure: audit and close

Before writing code, the resume note required: "Audit before duplicating. The pattern should be extend the existing hook surface rather than create parallel infrastructure."

### What already exists in production

| Layer | Location | Capability |
|---|---|---|
| Schema | `shared/schema.ts:11299` `platform_feature_flags` | `key`, `label`, `description`, `enabled`, `controlledRoutes[]` |
| Server middleware | `server/middleware/featureGate.ts` | Founder bypass + enterprise-tier bypass + DB lookup; 404 on disabled |
| Server routes | `server/routes-admin.ts:2870` `/api/founder/feature-flags` (GET) and `:2879` PUT toggle, plus public `/api/admin/feature-flags` for hydration | Founder-gated CRUD via `isFounderAdmin` (which already honors `FOUNDER_USER_IDS`) |
| Public hydration | `server/routes-admin.ts:2860` `/api/config/features` returns `{ enabledKeys, enabledRoutes }` | Cached 5 minutes by client |
| Client hook | `client/src/hooks/use-feature-flags.ts` | `isFlagEnabled(key)`, `isRouteEnabled(route)`, fail-open while loading |
| Founder admin UI | `client/src/pages/founder/feature-flags.tsx` | Categorized switches with confirm dialog, toast feedback, `aria-label` per switch; route registered in `App.tsx:511` behind `FounderProtectedRoute` |
| Agent gating | `server/agents/index.ts` reads `featureFlag` from each agent | Per-agent enable/disable already wired |

### What the mega prompt asked for vs. what exists

| Mega prompt §1.5 requirement | Status |
|---|---|
| Database table for flags | ✅ `platform_feature_flags` |
| Server middleware for evaluation | ✅ `featureGate.ts` |
| Client provider/hooks | ✅ `useFeatureFlags()` |
| Admin interface (founder-only) | ✅ `/founder/feature-flags`, gated by `FounderProtectedRoute` + `isFounderAdmin` |
| Per-user, per-tier, per-cohort, percentage rollout | ⚠ Not implemented; binary on/off plus founder + enterprise-tier bypass only |

### Decision: defer cohort/percentage rollout

Per CLAUDE.md ("Don't add features... beyond what the task requires. Don't design for hypothetical future requirements") and per resume note sub-step 2 ("if the existing system supports… done; skip schema work"), the rollout-targeting capability is deferred until the vertical expansion handoff actually needs it. Verticals can launch with binary on/off — the existing system covers that, plus tier-aware bypass for enterprise.

When vertical expansion needs targeting, extend `platform_feature_flags` with `audienceCriteria jsonb` + `rolloutPercent integer` columns (additive, no migration churn) and update `featureGate.ts` to evaluate them. The hook surface and admin UI can extend in place.

### `isFounderAdmin` vs new `requireFounder`

`isFounderAdmin` (existing) returns 403 with a JSON message; the new `requireFounder` middleware (Phase 1.4) returns 404 to be indistinguishable from a missing route. The two coexist intentionally: `isFounderAdmin` runs on the legacy `/api/admin/*` and `/api/founder/*` surfaces that customers may have probed against (its 403 is part of preserved elite-refinement behavior); `requireFounder` runs on the new `/api/auth/is-founder` and any `/api/__internal/*` routes that should not exist from a customer's vantage point. No reconciliation needed for Phase 1.

### No code change for Phase 1.5

Audit-only. The completion commit is the doc.
