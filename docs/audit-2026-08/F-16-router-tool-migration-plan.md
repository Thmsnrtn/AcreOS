# F-16-1 / F-08-4 — Tool-aware router migration: implementation plan

*Written 2026-08 audit remediation. The load-bearing protection (platform cost ceiling + telemetry for the bypass agents) already shipped via `server/services/aiSpendGuard.ts`. This plan covers the REMAINING work: routing the tool-calling agents through the router so they also get the Haiku kill-switch, prompt caching, category budget, and unified model routing — and driving the `openai-bypass` ratchet to 0.*

**Why this is a plan, not a commit:** verifying tool-routing requires a live model (does it return `tool_calls`, does the multi-turn loop feed results back, does caching/JSON/thinking-mode interfere) and the audit environment has no API keys. Migrating customer-facing support/Pax on code that was never run against a real model would be reckless. Execute this in an environment with `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, PR by PR, with the eval gate green.

---

## Root fact (verified)

`routeAITask` (`server/services/aiRouter.ts:1103`) builds `requestBody` (`:1388`) and calls the OpenAI-compatible `client.chat.completions.create(requestBody)` (`:1398`), returning `AIResponse.content` as a **string**. `AITask.messages` (`:456`) allows only `system|user|assistant` roles; `AIResponse` (no `tool_calls`). So the router is single-turn, text-only. The agents (`vaService.processAgentTask`, `supportAgent.processSupportChat`, `executive.processChat/Stream`) run their own `while (tool_calls)` loop against their own OpenAI client — that is the bypass.

Because the wire format is OpenAI-compatible, tools flow through the same shape; the work is threading them through the router's typed surface and its adjacent features.

---

## Phase 1 — Extend the router to be tool-aware (additive, opt-in)

**`AITask`** (`aiRouter.ts:436`): add
```ts
tools?: Array<{ type: "function"; function: { name: string; description?: string; parameters?: unknown } }>;
toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
```
and widen `messages` to allow `role: "tool"` with `tool_call_id: string` and `role: "assistant"` with an optional `tool_calls` array (the loop must be able to replay prior tool turns).

**`AIResponse`**: add `toolCalls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>`.

**`requestBody`** (`:1388`): `...(task.tools?.length && { tools: task.tools, tool_choice: task.toolChoice ?? "auto" })`.

**Response extraction** (`:1400`): `toolCalls = response.choices[0]?.message?.tool_calls ?? undefined;` — return it on the `AIResponse`.

**Incompatibility handling (critical — this is where subtle breakage hides):**
- Tools are incompatible with `response_format: json_object` and with `thinking` mode. When `task.tools` is set, force-disable both (`wantsConfidence`, `responseFormat`, `useThinking` → off) and log if a caller asked for both.
- Prompt caching (`cache_control`) on the system message is fine with tools; keep it.
- The confidence-schema injection (`:1374`) must be skipped when tools are present (it corrupts the tool-call decision).

**Tests (verifiable WITHOUT keys — mock `client.chat.completions.create`):** `aiRouterTools.test.ts` — (a) `task.tools` appears in `requestBody`; (b) a mocked `tool_calls` response surfaces as `AIResponse.toolCalls`; (c) json/thinking are disabled when tools present; (d) no tools → `requestBody` unchanged (regression guard for every existing caller).

**Ship Phase 1 alone first** — it changes nothing for existing callers (opt-in), so it can land and bake before any agent moves.

---

## Phase 2 — Migrate one agent as the proof (smallest blast radius first)

Order by risk, lowest first: **`vaService.processAgentTask`** (internal VA agent) → `executive.processChat` (non-stream Pax) → `supportAgent.processSupportChat` → `executive.processChatStream` (streaming Pax, hardest — streaming + tools + the hallucination guard).

Per agent, replace the hand-rolled loop:
```ts
let response = await getOpenAI().chat.completions.create({ model:"gpt-4o", messages, tools, max_tokens });
while (response.choices[0].message.tool_calls) { … }
```
with:
```ts
let res = await routeAITask({ taskType:"va_agent", taskTier:"standard", complexity:MODERATE, messages, tools }, { orgId });
while (res.toolCalls?.length) {
  const toolResults = await runTools(res.toolCalls);         // unchanged agent logic
  messages.push({ role:"assistant", tool_calls: res.toolCalls }, ...toolResults);
  res = await routeAITask({ taskType:"va_agent", taskTier:"standard", complexity:MODERATE, messages, tools }, { orgId });
}
const finalText = res.content;
```
Keep `MAX_TOOL_ITERATIONS` (DEFECT-0010). Remove the now-dead `aiSpendGuard` calls from that agent ONLY after it routes through `routeAITask` (the router already enforces ceiling+telemetry) — do not remove them before, or you open a gap.

**Tier choice per agent:** support/Pax = `critical` (customer-facing quality); VA internal = `standard`. This is the model-change decision — it moves these off hardcoded `gpt-4o` onto the tier ladder (Haiku/Sonnet/Opus). **That is a COST + QUALITY change and must be gated by the eval**, not shipped blind.

**Verification (needs keys):** run the eval matrix (now includes Haiku, audit F-08-2) on the migrated surface; require the golden-set score within the 5% budget vs the pre-migration `gpt-4o` baseline. A regression blocks the migration. This is why it can't be done in the audit env.

---

## Phase 3 — Drive `openai-bypass` to 0

`scripts/ratchets/openai-bypass.json` baseline is **89** today. Each migrated call site lowers it. When the agents are migrated and the ~66 single-shot sites in `docs/openai-bypass-migration.md` are done, the baseline reaches 0 and `requireOpenAIClient` / `new OpenAI()` can be deleted outside `aiRouter.ts` + tests (the migration doc's acceptance criteria). Lower the baseline in the same commit as each migration (the ratchet's rule).

**Note on the single-shot sites:** those are mechanical (`response.choices[0].message.content` → `response.content`) but each is ALSO a model change (gpt-4o → tier), so each still needs an eval check on its output. They are lower-risk than the agents (no tool loop) but not zero-risk.

---

## What is already done (not blocked)

- `aiSpendGuard` (cost ceiling + telemetry) on `processAgentTask`, `generateBriefing`, `processSupportChat` — the bypass agents already respect the ceiling and show in COGS.
- The `openai-bypass` ratchet (89, down-only) — new bypass sites fail CI.
- The Haiku eval lane (F-08-2) — the eval now scores the served model, which is the gate Phase 2 depends on.

## Estimate

Phase 1: ~0.5 day + tests (verifiable without keys). Phase 2: ~0.5 day per agent × 4, each behind an eval check (needs keys). Phase 3: ~1–2 days for the single-shot tail. Total ~1 week in an environment with API keys and a staging DB — consistent with the audit's "its own project" framing.
