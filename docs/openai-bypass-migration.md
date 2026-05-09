# OpenAI bypass migration to `routeAITask`

**Status:** in progress (panel-300 #15 / gap E)
**Owner:** ai-ml-eng (Theo)
**Started:** 2026-05-08
**Target:** all 68 callsites converted by 2026-09-08

## Why this exists

Direct calls to `requireOpenAIClient()` and `new OpenAI({...})` bypass:

1. **Per-org cost ceiling** (FW-THEO-1) — `routeAITask` consults
   `aiCostCeiling.assertWithinAiCostCeiling(orgId)` BEFORE running. A
   bypass call burns through a customer's daily $50 cap silently.
2. **AI_HAIKU_DEFAULT_ENABLED** kill-switch — bypass calls always use
   whatever model the caller hardcoded; the router downgrades
   `taskTier=standard` and `taskTier=background` to Haiku 4.5
   automatically (≈73% cheaper than Sonnet 4.6).
3. **Telemetry** — `aiTelemetryEvents` table is populated by the
   router. Bypass calls don't show up in `/founder/financials`
   COGS-per-customer rollups.
4. **Eval-as-gate** (panel-300 G1) — the post-validator + critical-
   severity test cases run inside `complianceAI.generateDisclosure`
   already; future surfaces should compose.
5. **Prompt caching** — `routeAITask` enables Anthropic
   prompt-caching for repeated system prompts (70-90% cost reduction
   on cached portions). Bypass calls don't.

## The migration pattern

### Before
```ts
import { requireOpenAIClient } from "../utils/openaiClient";

const response = await requireOpenAIClient().chat.completions.create({
  model: "gpt-4o-mini",
  response_format: { type: "json_object" },
  messages: [{ role: "system", content: "…" }, { role: "user", content: "…" }],
  max_tokens: 500,
});
const text = response.choices[0]?.message?.content ?? "";
```

### After
```ts
import { routeAITask, TaskComplexity } from "./aiRouter";

const response = await routeAITask({
  taskType: "concise_descriptor_of_the_task",   // free-form string for telemetry
  complexity: TaskComplexity.SIMPLE,            // SIMPLE | MODERATE | COMPLEX | CRITICAL
  taskTier: "standard",                          // critical | standard | background
  responseFormat: "json",                        // 'text' | 'json'
  messages: [{ role: "system", content: "…" }, { role: "user", content: "…" }],
  maxTokens: 500,
}, { orgId });                                   // pass orgId so cost ceiling applies
const text = response.content ?? "";
```

## Picking the right tier

- **`taskTier: "critical"`** — customer-facing, quality-sensitive.
  Default model: Sonnet 4.6 (or Opus 4.6 if `complexity=CRITICAL`).
  Examples: contract drafting, comp-analysis chat, Pax executive
  responses, complianceAI disclosures.
- **`taskTier: "standard"`** — internal-but-customer-adjacent. Default:
  Haiku 4.5. Examples: retention emails, summarization, follow-up
  sequencing, internal triage.
- **`taskTier: "background"`** — pure internal classification /
  extraction. Default: Haiku 4.5 (eventually a cheaper micro-model).
  Examples: lead-tagging, vertical inference, sentiment classification.

## Picking the right complexity

- **SIMPLE** — short prompts, minimal reasoning. Cacheable when
  temperature ≤0.3. Most retention/notification surfaces.
- **MODERATE** — multi-paragraph reasoning. Most agent workflows.
- **COMPLEX** — chain-of-reasoning, multi-step proof. ARV calc.
- **CRITICAL** — highest stakes; routes to Opus 4.6. Reserve for
  legal-document generation, contract drafting.

## Migrated callsites (running list)

✅ `server/services/revenueProtection.ts:103` — retention email generator
✅ `server/routes-deals.ts:867` — property-analysis chat surface

## Remaining callsites (66)

Run `grep -rn "requireOpenAIClient\|new OpenAI(" server --include="*.ts"`
to find them. Migrate in priority order:

**High-traffic / customer-facing (priority 1):**
- `server/routes-ai.ts:1650` — Pax inbox
- `server/routes-realtime.ts:71` — realtime turn handling
- `server/ai/vaService.ts:8` — VA agent
- `server/ai/executive.ts:31` — executive agent
- `server/ai/supportAgent.ts:29` — support agent

**Internal services (priority 2):**
- `server/services/modelIntelligence.ts:73`
- `server/services/complianceAI.ts:358` (already gated by G1; just
  swap to router)
- 50+ other services

**Test fixtures + dev surfaces (priority 3):**
- Anything in `tests/` or `scripts/` may stay on direct OpenAI for
  test stability.

## Rollback path

If a migrated callsite regresses (response shape mismatch, latency
spike), revert the single file. The router exports a compatible
shape (`response.content` as string), so the diff is mechanical.

`requireOpenAIClient` stays exported until ALL callsites migrate;
deletion is post-migration final commit.

## Acceptance criteria for "done"

- [ ] 0 callsites of `requireOpenAIClient()` outside `aiRouter.ts`
- [ ] 0 callsites of `new OpenAI({...})` outside `aiRouter.ts` and
      tests/fixtures
- [ ] `/founder/financials` COGS-per-customer dashboard reflects
      AI cost from ALL surfaces (currently misses bypass calls)
- [ ] Per-org cost ceiling (`AI_COST_CEILING_*`) applies uniformly
      across surfaces
- [ ] One nightly cron runs `aiTelemetryEvents` aggregation per org
      with no gaps
