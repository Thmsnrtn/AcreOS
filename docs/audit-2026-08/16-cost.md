# Slice 16 — Cost

**Region state.** The AI cost stack is genuinely well-built *at the chokepoint*: `aiRouter.routeAITask` enforces a per-org daily/monthly ceiling (`aiCostCeiling.ts`, tier-proportional, fail-closed for autonomous callers, last-known-good cache) and writes `ai_telemetry_events` that the daily guard sums. The provider registry meters paid lookups against a credit balance before every call (`provider-registry.ts:197,305`). Those two paths are not where money leaks.

**The single defect class that survives every gate here: LLM spend that bypasses the router chokepoint.** Every cost control — ceiling, telemetry, per-org rate limit, usage gate — is bolted to either the `/api/ai` + `/api/pax` route *prefixes* or the `routeAITask` *chokepoint*. Surfaces that call `chat.completions.create` directly and mount under a *different* prefix inherit none of it. The legacy `/api/va/*` Pax agent surface is the clean example: reachable by any authenticated customer, hardcoded to `gpt-4o`, capped only at 10 tool-loop iterations *per request* — no per-tenant cost cap, no telemetry, no rate limit. It is invisible to the very $15/day guard the whole stack exists to enforce. This is the feature most likely to make a customer unprofitable, and the founder would not see it on the daily cost email.

---

### F-16-1 — `/api/va/*` Pax agent surface spends on `gpt-4o` with no per-tenant cap and no telemetry
**Severity:** P1 serious
**Surfaced by:** slice 16 (cost)
**Survives which gates:** The per-org ceiling lives *inside* `routeAITask`; `vaService` never calls `routeAITask` or `assertWithinAiCostCeiling` (grep of the file: zero references). The per-org rate limiter is `app.use("/api/ai", aiRateLimit)` (`routes.ts:966`) and the per-user `aiLimiter` is applied on `/api/ai` + `/api/pax` (`routes.ts:963,1368`) — the `/api/va/*` routes carry only `isAuthenticated + getOrCreateOrg` (`routes-ai.ts:1674,1739,1764`), so neither limiter runs. No telemetry row is written (`vaService.ts` is absent from the `ai_telemetry_events` writer set), so the daily guard's `SUM(estimated_cost_cents)` and the platform ceiling's aggregate never see this spend. DEFECT-0010 fixed the *loop* (`MAX_TOOL_ITERATIONS=10`, `vaService.ts:671`) — that bounds one request, not the tenant.
**Evidence:** `server/ai/vaService.ts:661` and `:718` — `getOpenAI().chat.completions.create({ model: "gpt-4o", ... })` in a while-loop; entry points `processAgentTask` (`:604`), `processAutonomousActions` (`:1199`, fans out across all of an org's agents), `generateBriefing` (`:779`). Routes: `POST /api/va/agents/:type/task` (`routes-ai.ts:1674`), `POST /api/va/actions/process-autonomous` (`:1739`), `POST /api/va/briefings/generate` (`:1764`).
**What's wrong:** A customer can drive up to 11 `gpt-4o` completions per task request (initial + 10 tool iterations, each with growing context) across 6 agent types, repeatedly, with zero cross-request cost enforcement. `gpt-4o` bills ~$2.50/$10 per M in vs the cost model's assumed Haiku/DeepSeek at ~$0.004–0.012/turn. Because no telemetry is recorded, this spend is not counted toward the per-org ceiling, the $15/day platform ceiling, or the founder's daily `[ai-cost-summary]` email — it is the exact runaway-`gpt-4o`-on-the-founder's-key scenario the stack was built to stop, reintroduced on a side door and made invisible.
**Impact:** Burns trust/margin after sale — makes a single active tenant unprofitable and silently blows the overhead model (`overhead-operating-costs.md` §3 assumes all Pax spend is BYOK-capped and Haiku-tiered; this path is neither). Hurts the founder's wallet directly; at 100 tenants it is the line most likely to break the ≥70% G1 margin gate. Does not block the first sale.
**Fix:** Route all `vaService` LLM calls through `routeAITask({ orgId, taskType })` so they inherit the ceiling + telemetry + model tiering (kills the hardcoded `gpt-4o`), and mount `aiRateLimit` on `/api/va` (or fold `/api/va` under the `/api/ai` prefix). If the VA-agents surface is dead product (it predates the canonical `/api/ai/chat` Pax), delete it — the registry/ledger has no KEEP verdict on it.
**Gate it:** Add a lint that bans direct `.chat.completions.create(` outside `server/services/aiRouter.ts` (allowlist the router + `executive.ts`, which already enforces its own ceiling at `executive.ts:251`). Measured baseline today: **6 offending files** — `vaService.ts`, `supportAgent.ts`, `tools.ts`, `executive.ts` (enforces), `modelIntelligence.ts`, `paxSupportResolver.ts`. Ratchet direction: down to the allowlist.
**Effort:** M (route through `routeAITask` + mount limiter) / L if deletion + UI removal.
**Blast radius:** `server/ai/vaService.ts`, `server/routes-ai.ts` (`/api/va/*`), `server/routes.ts` middleware mount.
**Confidence:** high — call sites, missing middleware, and absence from the telemetry-writer set all read directly.

---

### F-16-2 — AI sub-tools (offer-letter / description drafting) bill LLM calls that no ceiling or telemetry sees
**Severity:** P2 real
**Surfaced by:** slice 16 (cost)
**Survives which gates:** `selectProviderAndModel` (`aiRouter.ts:887`) is a pure client/model *selector* — it does not run the ceiling or write telemetry (those live in `routeAITask`, `aiRouter.ts:1174`). Tools call the returned client directly. The parent chat turn checks the ceiling *once* at the top of `routeAITask`; these sub-calls happen later inside the tool loop and are neither pre-checked nor recorded.
**Evidence:** `server/ai/tools.ts:2342-2345` (`selectProviderAndModel(TaskComplexity.MODERATE)` → `client.chat.completions.create(... max_tokens: 800)`, land-offer letter) and `tools.ts:2595-2598` (`TaskComplexity.SIMPLE`, property description). `executeTool` is invoked by both the chat tool loop and `vaService`.
**What's wrong:** Every tool invocation that drafts text spends an extra, uncounted completion. It is additive to whatever the parent turn already billed and is absent from `ai_telemetry_events`, so per-org COGS is understated and the ceiling under-counts.
**Impact:** Burns margin after sale; understates the founder's true AI COGS. Smaller magnitude than F-16-1 (bounded tokens, one call each) but same invisibility class.
**Fix:** Have these tools call `routeAITask({ orgId, taskType: "offer_draft" | "listing_copy" })` instead of `selectProviderAndModel` + raw client. Passes the org through so the ceiling and telemetry apply.
**Gate it:** Same lint as F-16-1 (direct-`chat.completions.create` ban) catches `tools.ts`.
**Effort:** S.
**Blast radius:** `server/ai/tools.ts` (2 sites).
**Confidence:** high.

---

### F-16-3 — Fully-built per-user AI budget service (`userAiCostControls`) has zero callers; registry marks its class FIXED
**Severity:** P2 real
**Surfaced by:** slice 16 (cost)
**Survives which gates:** The reachability ratchet tolerates 655 unreached exports (orientation), so a dead cost-control export sits comfortably under baseline and never trips CI. DEFECT (registry line ~176) "AI endpoints missing per-user credit checks" is marked **FIXED / commit a763756**, remediation "Wire credit checks to *all* AI endpoints" — but the wiring that landed was the *per-org* `aiCostCeiling` on `routeAITask`, not this per-*user* service, and it does not cover `/api/va`.
**Evidence:** `server/services/userAiCostControls.ts:103` exports `userAiCostControls.checkBudget` (daily/monthly per-user USD budget, complete implementation). Grep for `userAiCostControls`/`checkBudget(` across `server` (excl. its own file + tests): **zero call sites**. Registry: `docs/audits/defect-registry.md:179-184`.
**What's wrong:** A working per-user budget guard exists and is wired to nothing; the registry's "FIXED — wire to all endpoints" verdict is stale because the `/api/va` surface (F-16-1) still has no per-user or per-org cost check. Dead code that looks like a control is worse than no code — it reads as coverage.
**Impact:** Neither blocks a sale nor burns trust directly; it is a false-assurance/documentation-drift defect that hides F-16-1. Hurts the next auditor and the founder's mental model of "AI spend is capped."
**Fix:** Either wire `userAiCostControls.checkBudget` into the shared AI entry path (belt to the ceiling's suspenders, per-user granularity) or delete it and correct the registry entry to note the per-org ceiling is the actual remediation and that `/api/va` remains uncovered.
**Gate it:** Cross-slice with slice 17 (documentation drift) — reconcile the FIXED verdict. No new ratchet; the reachability ratchet already *counts* this export but its baseline is too loose to force the issue.
**Effort:** S (delete + registry fix) / M (wire it in).
**Blast radius:** `server/services/userAiCostControls.ts`, `docs/audits/defect-registry.md`.
**Confidence:** high — zero-caller grep + explicit registry text.

---

### F-16-4 — The only fail-closed AI cost gate is a single shared $15/day platform aggregate
**Severity:** P3 minor
**Surfaced by:** slice 16 (cost)
**Survives which gates:** By design — the code documents it. The per-org ceilings and the soft budgets (`intelligence/budget.ts` $10/day-per-category, `aiQuotaService` $50/day-per-org) all **fail open** on DB error; only `assertWithinPlatformCostCeiling` fails closed, and it is one global counter (`aiCostCeiling.ts:60-70`, default 1500¢/day). It already reserves 30% for customer-facing calls (`:effectiveCeiling` 70% background split).
**Evidence:** `server/services/aiCostCeiling.ts:52-70` (comment: "the ONLY fail-CLOSED gate ... the SOFT gates disable themselves under DB load, leaving THIS ceiling as the only limit that actually holds") and `:180-207` (aggregate sum across all orgs).
**What's wrong:** At 0–5 customers a $15/day shared cap is a sensible backstop. At 100+ tenants the same single aggregate means one tenant's *legitimate* heavy day, or a DB-read outage that collapses every soft gate, can pause AI for the entire fleet (shared fate), and the aggregate no longer bounds *per-tenant* runaway — only total. The per-org ceiling covers single-tenant runaway *only for spend that reaches `routeAITask`* (see F-16-1, which does not).
**Impact:** Neither now; a scaling cliff. Becomes real only at ~100 tenants, well past first sale.
**Fix:** Scale `AI_PLATFORM_DAILY_CEILING_CENTS` with paying-customer count (there is already `idlePace` slot math keyed on customer count to borrow from), and ensure the per-org ceiling — not the platform aggregate — is the primary per-tenant bound by closing F-16-1.
**Gate it:** None needed pre-scale; revisit at the G2 (100-customer) rung per `cost-audit-2026-07-07.md`.
**Effort:** S (env formula) — but blocked on F-16-1 for the real per-tenant guarantee.
**Blast radius:** `server/services/aiCostCeiling.ts`.
**Confidence:** medium — the shared-fate mechanics are clear; the "when it bites" is a projection.

---

## Coverage ledger

**Examined exhaustively (read in full):** `server/services/aiCostCeiling.ts` (342 L), `server/services/dailyAiCostGuard.ts` (205 L), `server/middleware/aiRateLimit.ts`, `server/services/userAiCostControls.ts` (budget export), `server/ai/vaService.ts` agent loop (600-730, entry points), the `routeAITask` ceiling/telemetry block (`aiRouter.ts:1150-1200`), provider registry credit-metering path (`provider-registry.ts:150-320`). Verified the `ai_telemetry_events` writer set and every `assertWithinAiCostCeiling` call site.

**Examined by sampling:** direct `chat.completions.create` call sites across `server/ai/*` and `server/services/*` (grep + spot-read of `executive.ts:251` ceiling call, `tools.ts:2342-2598`, `supportAgent.ts` MAX_TOOL_ITERATIONS + org scoping). Cross-referenced `cost-audit-2026-07-07.md`, `overhead-operating-costs.md`, and the defect registry (DEFECT-0010, entry 179).

**Did NOT examine:** `runScheduledJobs.ts` (5,848 L) per-org AI fan-out loops beyond confirming the loop headers exist (`:458,2365,3816,4024,5126`) and that `idlePace` throttles cadence below 5 customers — a full per-job cost accounting was out of medium-depth budget and is a candidate for a follow-on. `costModel.ts`, `aiCostRates.ts`, `paxModelTier.ts` tier math were trusted as the audit docs describe (not independently re-derived). SMS/mail per-record spend was confirmed customer-owned/BYO by the docs and not re-verified in rail code (slice T2 owns the message-out rail). Did not load-test or price the actual token counts of a `gpt-4o` va task — magnitude in F-16-1 is reasoned from published rates, not measured.

## Constitution Collisions

None. Findings are internal cost-control gaps, not constitutional collisions. Note in passing: F-16-1's uncapped `/api/va` surface is *adjacent* to the "hard-stops stay founder-only — spends >$500" hard-stop in spirit (an uncapped AI surface can quietly exceed the $500/mo stop-loss the cost audit calls "structurally impossible"), but it is a control gap to fix, not a decision to relitigate — the hard-stop itself is intact.
