# Cost efficiency — 2026-10

The goal was to make cost-to-serve as low as possible at scale without lowering
quality and without changing prices, plan inclusions, or customer-facing
limits. This page records what changed, why, and what is still open. The
previous audit was `cost-audit-2026-07-07.md`; audit slice 16
(`docs/audit-2026-08/16-cost.md`) named most of the defects fixed here.

## 1. One metered gateway

The gateway has two halves:

| Half | Function | For |
|---|---|---|
| `server/services/aiRouter.ts` | `routeAITask` | message-in/text-out tasks: task-tier model choice, response cache, quality cascade |
| `server/services/aiSpendGuard.ts` | `meteredChatCompletion`, `meteredAnthropicMessage` | raw and tool-calling calls; the request goes through unchanged |

A metered call does three things. **Before** the call it checks the platform
and per-org cost ceiling. Customer-facing calls fail open if the ceiling can't
be read; background calls fail closed. **After** the call it records the call
in `ai_telemetry_events`, which the ceilings and the daily guard add up. It
also records it in `ai_call_log` and `financial_ledger`, which per-org unit
economics reads. Prompt-cache reads are charged at the cached rate. **For
caching**, it adds an Anthropic `cache_control` breakpoint to any system
prompt of 1,024 characters or more that doesn't have one. OpenAI models
already cache on the provider side. Calls on the customer's own key (BYOK)
skip the ceiling and record $0.

Direct provider calls outside the gateway went from **94 to 14**. That count
is enforced by `tests/unit/modelCallsGoThroughTheGateway.test.ts`: it parses
all of `server/`, checks seven call shapes (each with a canary), and keeps an
exact per-file baseline. The baseline may only shrink. These 14 remain:

| File | n | Why it remains |
|---|---|---|
| `server/ai/executive.ts` | 5 | Pax main turn: non-stream 402-retry helper, stream, stream retry, simulated-thinking stream. Gated by `enforcePaxCostCeilings`; whole-turn usage now recorded (see §2). Streams cannot use the wrapper. |
| `solene/chat/anthropicClient.ts`, `openRouterClient.ts` | 2 | Founder Solene chat streams. Gated per turn by `turnRunner`; per-token telemetry not yet recorded. |
| `embeddingClient.ts`, `dealPatternCloning.ts` | 3 | Embeddings. These have no price row yet, so they would be priced at the dearest rate and throw the ceilings off. Next step: add the $0.02/M rate, then meter them. |
| `voiceCallAI.ts`, `routes-ai.ts`, `routes-field-scout.ts` | 3 | Whisper transcription (direct OpenAI). |
| `adCreativeService.ts` | 1 | DALL·E for founder ad creative. |

**Model changes: none.** The quality guard is: never downgrade a path without
an eval or existing test that covers its output. None of the 36 hard-coded
`openai/gpt-4o` sites has one, so every model was kept. The opportunity is
listed in §5.

## 2. Spend that was invisible and is now counted

- **Pax streaming turn.** This is the main chat surface. It never wrote
  `ai_telemetry_events`, so the per-org ceiling that `enforcePaxCostCeilings`
  checks could never trip from streamed spend. It now records the whole
  turn's actual usage.
- **Pax non-stream turn.** It recorded a pre-call *prediction* for the first
  call only, so up to ten tool-loop follow-ups were uncounted. It now records
  actual usage across the whole turn.
- **Pax → ledger.** Pax spend now also reaches `financial_ledger`
  (`ai_tokens`), so unit economics sees the largest AI line.
- **Cascade.** The quality grader and whichever answer was discarded were paid
  for but not recorded. Both now count (`aiRouterCascadeCostIsCounted.test.ts`).
- **Solene dispatch, role workers and the pre-call checker.** Their spend now
  reaches the platform ceiling's sum. Before, only the separate capital
  tracker saw it.

## 3. Platform ceiling scales with MRR

The default ceiling is `max($15/day floor, 75% of paying MRR / 30)`, read from
`liveMrrDetail()` and cached for 10 minutes. It still fails closed: if MRR
can't be read, the floor applies. `AI_PLATFORM_DAILY_CEILING_CENTS` still
overrides it, and `AI_PLATFORM_CEILING_MRR_SHARE` sets the share.

Why 75%: the tier-limits margin math puts the worst legitimate org at about
68% of its price at full utilization. A platform-wide day above 75% of daily
revenue is therefore a runaway, not a normal day.
`getPlatformDailyCeiling()` is the one source; the founder status route and
the worst-day bound both read it.

## 4. Dormant monthly-credit grant removed

Two unwired grants paid out `SUBSCRIPTION_TIERS.monthlyCredits` ($250/month on
Scale, about 3× its 8,000-credit pool). Both were removed.
`creditGrantPathsAreBounded.test.ts` checks behaviour rather than names:

- nothing reads `monthlyCredits`;
- every write that raises `creditBalance` is registered;
- every `addCredits` call uses a bounded transaction type.

**Public-claim mismatch for the founder:** `GET /api/subscription/tiers`
(unauthenticated) still serializes `monthlyCredits: 25000` for Scale. No
client renders it today. It was left unchanged on purpose.

## 5. Cost to serve per customer

`unitEconomics.costToServeOf()` is the canonical rule. Cost to serve is AI
actually billed plus provider cost paid from the plan's included credit pool,
divided by the plan price. Purchased-credit overflow is excluded, and so is
the pool's own AI estimate, so AI isn't counted twice. The nightly snapshot
stores it, and the founder read API recomputes it with the same rule.

Above **50%** of plan price, a read-only `customer_cost_to_serve_high` system
alert is filed. Nothing is throttled or re-priced. It is shown on the Unit
economics tab under `/founder/admin/costs`.

## 6. Open items, with estimated savings

These estimates are assumptions, not measurements.

- **Model downgrades pending evals.** 36 `gpt-4o` sites do
  classify/extract/short-draft work. `gpt-4o-mini` is about 16× cheaper. At an
  assumed 50 such calls per customer per month (3k tokens in, 500 out), that
  saves about $0.59 per customer per month.
- **Document intelligence.** It makes 4 `gpt-4o` calls per document, each
  re-sending the full text (parse, key terms, risks, plus extraction).
  Folding parse, key terms and risks into one call saves about 70% of the
  input tokens. At an assumed 20 documents per customer per month (6k in,
  600 out), that is about $1.1 per customer per month. It needs an eval
  first.
- **`GET /api/due-diligence/dossier/:id/recommendation`.** It re-runs `gpt-4o`
  on every read even though the dossier stores the recommendation. No client
  calls it today.
- **Conversation compaction.** Past 20 messages and 80k characters, it
  re-summarizes the growing first half on every turn. That costs about
  $0.001 per turn on DeepSeek; an incremental summary would remove it.
- **Paid residential lookups (`residentialComps.ts`).** This path checks
  affordability against the legacy credit-wallet balance, which lookups never
  decrement, and then debits the plan pool in the provider registry's `record`
  mode, which never refuses. While the wallet holds at least one lookup's
  price (comps 20¢, valuation 10¢), ATTOM lookups on the platform key are
  bounded by neither the wallet nor the pool. Other registry callers
  (`resolveParcel`) pass a balance of 0, so they skip paid providers.
