# 08 — AI Systems

*Dimension slice, exhaustive over the AI region. Read-only.*

The AI stack is unusually well-built for a pre-revenue codebase: a single-source model catalog, tier + task-type + BYOK routing, a live hallucination guard, a constitutional prompt block, a data-grounding block, per-org quota / platform ceiling / category budget gates, and an actual LLM-judge eval harness with a CI gate. The plumbing is real. **The single defect class that survives every gate here is _eval–production model divergence coupled with asymmetric guard placement_: the safety machinery (live grounding gate, hallucination guard, LLM-judge eval, "eval-green" routing switch) is calibrated against, or wired onto, a model / code-path that is NOT the one that answers a first customer's first land question.** The eval judges Sonnet/Opus; the free trial and the most-common Pax turn run on Haiku; customer support runs on raw gpt-4o; and the guard that catches a fabricated flood zone runs only when the client streams. The gate is green and the served path is unwatched.

---

### F-08-1 — Live hallucination guard + grounding gate run ONLY on the streaming Pax path; the non-streaming path ships fabricated parcel facts with just a leak-check
**Severity:** P0 blocking
**Surfaced by:** slice-08
**Survives which gates:** `evaluateLivePaxOutput` (PAX_LIVE_GATE_ENABLED) and `guardPaxOutput` are both invoked, so grep-based reachability audits see them "wired". Nothing checks they run on *both* entry points. No test asserts `processChat` (non-stream) applies the guard.
**Evidence:** `server/ai/executive.ts` — streaming `processChatStream` calls `guardPaxOutput` (2133, 2195) and `evaluateLivePaxOutput` (2243, 2278). Non-streaming `processChat` (1197–1755) calls only `validatePaxResponse` (1611) — a system-prompt-leak check. Verified absent: an `awk` over 1197–1755 for `guardPaxOutput|evaluateLivePaxOutput|PAX_LIVE_GATE` returns empty. `processChat` is customer-reachable at `server/routes-ai.ts:354`, and also drives `paxScheduler.ts:135` (autonomous) and the `pax_subagent` at `tools.ts:2672`.
**What's wrong:** The DATA_GROUNDING design pairs the prompt block with "the live hallucination guard … which catches violations that slip past the prompt" (paxPromptVersions.ts:43-45). That backstop exists only on the streamed path. A caller that hits the non-streaming route gets a fabricated "FEMA Zone X — minimal flood risk" after a flood MISS with only the leak-check applied — exactly the paraphrased-hallucination shape the guard's own comment (aiEvalHarness.ts:139-141) says reached a customer before the live gate was added.
**Impact:** Burns trust after sale (and is a liability event on a real land deal). Hurts any customer whose client, or the scheduler, uses the non-stream path — and pax_subagent fabrications feed back into other answers.
**Fix:** Extract the guard+gate block (executive.ts ~2130–2290) into one `finalizePaxOutput(text, ctx)` and call it from `processChat` before `createMessage` (1617) exactly as the stream path does. Add a test that feeds a MISS-fabrication fixture through `processChat` and asserts a correction/deflection.
**Gate it:** New test `paxGuardParity.test.ts`: both `processChat` and `processChatStream` must fold a `dg-miss-flood-001` adversarialOutput into a deflection. Baseline today: stream=guarded, non-stream=unguarded.
**Effort:** M
**Blast radius:** `server/ai/executive.ts` (two entry points), routes-ai.ts, paxScheduler.ts, tools.ts pax_subagent.
**Confidence:** high — guard placement verified by line; only open question is per-client stream-vs-poll mix, which does not change that the non-stream path is production-reachable.

---

### F-08-2 — The eval that gates Pax prompt changes never runs the model that serves the free trial (Haiku) or the most-common turn
**Severity:** P1 serious
**Surfaced by:** slice-08
**Survives which gates:** The eval CI workflow (`.github/workflows/eval.yml`) runs and can fail a PR — so it *looks* enforced. It is enforced against the wrong model.
**Evidence:** Golden-set runner defaults `model = "claude-sonnet-4-6"` (`evals/run-eval.ts:153`); the curated gate defaults `claude-opus-4-8` (`evals/judge.ts:33`, `run-gate.ts:122`). Production Pax model is picked by tier ceiling then `routePaxModelForTurn` (executive.ts:1380): Free-plan ceiling = Haiku (executive.ts:1362), and `data_lookup_restate` + `formatting` downgrade to **Haiku 4.5** (`paxModelTier.ts:152-167`). So a free/trial customer's Pax runs entirely on Haiku, and the single most common turn shape (a parcel-fact restatement) runs on Haiku for *every* tier. The 50-prompt golden set and the 12-case gate never invoke Haiku.
**What's wrong:** A prompt edit that regresses only on the cheap model (the one a trialing stranger actually talks to) passes both the relative-regression gate and the absolute gate, because both score Sonnet/Opus output. "An eval whose model differs from prod gates nothing" is literally the state here for the free tier.
**Impact:** Blocks first sale — the trial experience is the un-evaled one. A grounding/shape regression ships to precisely the users you are trying to convert.
**Fix:** Add a Haiku lane to both eval jobs (`--model claude-haiku-4-5`) run against the same golden set, with its own floor; treat Haiku as the gating model for the grounding subset since that is what serves those turns. Optionally parametrize the CI matrix over {haiku, sonnet}.
**Gate it:** eval.yml matrix `model: [claude-haiku-4-5, claude-sonnet-4-6]`; grounding/refusal categories must pass on Haiku. Baseline: today 0 Haiku eval runs.
**Effort:** M
**Blast radius:** evals/*, .github/workflows/eval.yml.
**Confidence:** high — model defaults and routing floors read directly from source.

---

### F-08-3 — `DATA_GROUNDING_EVAL_GREEN` is a hardcoded `true` authorizing Haiku downgrade of customer parcel-fact turns; the "eval" behind it never runs a model
**Severity:** P1 serious
**Surfaced by:** slice-08
**Survives which gates:** `dataGroundingEvalCases.test.ts` is green in `npm test`, so the switch *looks* eval-backed. The test asserts nothing about a model.
**Evidence:** `server/ai/paxModelTier.ts:109` `export const DATA_GROUNDING_EVAL_GREEN = true;` — the "single reversible switch" (comments 22-31, 96-116) that permits routing `data_lookup_restate`/`formatting` below the tier ceiling to Haiku. Its cited backing (`dataGroundingEvalCases.test.ts`) only checks that hand-written `safeOutput` strings pass a substring check and hand-written `adversarialOutput` strings fail it (test.ts:52-70) — it feeds `detectHallucinations` fixtures, never Haiku (or any model). `runEvalSurface`/`gateOutputOrThrow` (the model-backed harness) are called from complianceAI.ts:376 and autopilot/policyGate.ts, **not** from the Pax routing decision.
**What's wrong:** The justification for downgrading a customer's first-deal flood/soil/acreage answer to the cheapest model is "the eval is green," but the green is a fixture-consistency test, not a measurement of Haiku's grounding behavior. The constant is also static: if Haiku regressed in the wild, the switch stays `true` until a human edits code — it is not driven by any live eval result.
**Impact:** Burns trust after sale — silently permits the cheapest model on the highest-liability turn type on the strength of an eval that did not test that model. Compounds F-08-2.
**Fix:** Make the switch a function of the last Haiku run of the dg-v1 set through `runEvalSurface` with a real generator (aiRouter forcing Haiku); persist a pass-rate and read it (or a DB flag) instead of a literal. Until then, downgrade `DEFAULT_ROUTING_CONFIG.data_lookup_restate.floorModel` to Sonnet.
**Gate it:** A scheduled job runs dg-v1 on Haiku via aiRouter and writes `ai_eval_gate_runs`; `DATA_GROUNDING_EVAL_GREEN` derives from the latest row's pass-rate ≥ floor. Baseline: today the switch is a literal with 0 Haiku runs behind it.
**Effort:** M
**Blast radius:** paxModelTier.ts, aiEvalHarness wiring, a cron entry.
**Confidence:** high — the test body and the constant are both read in full.

---

### F-08-4 — Customer support agent bypasses aiRouter entirely and is hardcoded to raw `gpt-4o`, contradicting its own "Haiku/Sonnet tiering" comment
**Severity:** P2 real
**Surfaced by:** slice-08
**Survives which gates:** No lint requires AI calls to go through aiRouter; the eval harness has no support-agent surface. `npm run check` is silent.
**Evidence:** `server/ai/supportAgent.ts` builds its own `new OpenAI()` (32-37) and calls `openai.chat.completions.create({ model: "gpt-4o" })` at **2983, 5296, 5314, 5361** — four fixed `gpt-4o` sites. The header comment (22-24) claims "the tiered model approach (Haiku for routine support replies, Sonnet for complex troubleshooting)." No routeAITask, no tier, no cascade. `processSupportChat` is customer-facing (`routes-support-tickets.ts:197`, scoped to `org`,`user.id`).
**What's wrong:** (a) Comment/code drift — the described tiering does not exist; every support reply is gpt-4o. (b) Because it skips aiRouter, none of the platform guardrails apply: no per-org quota, no platform cost ceiling, no category budget, no cascade quality check, no BYOK, and its telemetry path differs from every other surface. (c) gpt-4o is a different vendor than anything the eval harness scores — support behavior is doubly un-evaled and un-gated.
**Impact:** Burns trust after sale (unwatched customer-facing surface) + cost blind spot (support spend escapes the $15/day platform ceiling that "ALWAYS runs" per aiRouter.ts:1163). A support-chat loop can spend past the ceiling the rest of the system is bounded by.
**Fix:** Route `processSupportChat` through `routeAITask` with an explicit `taskTier`/`taskType` so quota + ceiling + budget + telemetry apply; delete the raw client or restrict it to a genuinely un-metered internal use. Update the comment to match reality.
**Gate it:** A lint (`lint:ai-through-router`) forbidding `chat.completions.create` outside aiRouter/anthropicClient/eval harness; allowlist the few legitimate raw callers. Baseline: 4 raw sites in supportAgent + the judge/eval harness (intentional).
**Effort:** M
**Blast radius:** supportAgent.ts, routes-support-tickets.ts, cost telemetry.
**Confidence:** high — four hardcoded `gpt-4o` lines cited.

---

### F-08-5 — Every AI cost and quality guardrail in aiRouter fails OPEN on DB hiccup; the quota lookup fails open to *unlimited*
**Severity:** P2 real
**Surfaced by:** slice-08
**Survives which gates:** These are the gates. Their fail-open branches are deliberate and untested for the failure path, so no gate observes its own bypass.
**Evidence:** `server/services/aiRouter.ts`: org quota-cap read failure sets `cap = 0` → treated as unlimited (1136-1141); platform cost-ceiling check swallows non-`AI_COST_CEILING_EXCEEDED` errors and allows the call (1176-1181); category budget check swallows non-budget errors and allows (1200-1210); the cascade quality judge returns `{score:8, shouldEscalate:false}` on any error (274-278). The judge itself (`evals/judge.ts:130-133`, `safeParseJudge` 100-112) returns a *neutral 0.5* — not a fail — on judge error or invalid JSON.
**What's wrong:** Under DB load or an OpenRouter stall — precisely when spend and bad output are most likely — the daily ceiling, per-org quota, category budget, and quality cascade all quietly turn off, and the eval judge scores errored outputs 0.5 (which can sit above a 0.65 floor's per-case story but drags the mean toward the floor rather than failing it). The system's spend and quality bounds are contingent on the DB being healthy.
**Impact:** Cost overrun + unchecked output during incidents; a runaway loop (the exact $30/day scenario the ceiling exists to stop, aiRouter.ts:1160) is un-capped when the ceiling's own query throws. Hurts the founder (bill) and customers (unscreened answers) simultaneously.
**Fix:** For the *platform ceiling only* (the hard backstop), fail CLOSED or degrade to a conservative cached cap rather than allow. Keep per-org quota fail-open if desired, but log a metric so a fail-open spell is visible. Make the judge return a sentinel that the gate treats as a case failure, not 0.5.
**Gate it:** Unit tests that force each DB call to throw and assert the intended posture (ceiling→throw, others→allow+counter). Add a `ai_fail_open_total` counter with an alert. Baseline: 4 fail-open branches + 1 neutral-judge branch, all untested for the throw path.
**Effort:** M
**Blast radius:** aiRouter.ts gate block, evals/judge.ts.
**Confidence:** high for the mechanism (branches cited); medium on severity ranking — depends on DB-incident frequency, which no metric currently reports.

---

### F-08-6 — The prompt-change eval gate is not a required check, and 40/50 golden entries are self-admittedly un-curated
**Severity:** P3 minor
**Surfaced by:** slice-08
**Survives which gates:** It IS the gate; the gap is that it doesn't block merge and its ground truth is provisional.
**Evidence:** `evals/README.md:109` — the founder must add `eval-gate` as a required status check in branch protection; "Until that box is checked, the gate runs on PRs but does not actually block merge." `evals/golden-set.json` has **40 of 50** entries with `"needsCuration": true` (seeded "plausibly," README:17). The curated gate set is only 12 cases.
**What's wrong:** A gate that can be merged past is advisory. And a golden set where 80% of ground truth is unreviewed can encode a wrong "expected" answer, so a genuine regression can score as a pass (or a correct answer as a fail).
**Impact:** Neither blocks a sale nor directly burns a customer — it weakens the mechanism meant to prevent F-08-2/3 from recurring.
**Fix:** Founder enables the required check (repo-settings only). Schedule a curation pass: run the set on the production models, review failures, flip `needsCuration:false` as each is confirmed.
**Gate it:** A test asserting `count(needsCuration:true) ≤ baseline` and ratcheting down. Baseline: 40/50.
**Effort:** S (settings) + L (curation).
**Confidence:** high — counts and the README note are exact.

---

## EVAL COVERAGE MATRIX — as a build plan

Surfaces × dimensions. `●` = covered, `◐` = partial/indirect, `○` = uncovered. Today ~1.5 cells of 25 are real.

| Surface (prod model) | tone | factual grounding | tool-call correctness | refusal | injection resistance |
|---|---|---|---|---|---|
| **Pax** (Haiku/Sonnet/Opus by turn) | ● Haiku-judge, but on Sonnet not Haiku (F-08-2) | ◐ static fixtures only (F-08-3); live gate stream-only (F-08-1) | ○ | ◐ curated refusal probes, wrong model | ◐ `validatePaxResponse` runs; no eval scores it |
| **Sophie / supportAgent** (gpt-4o) | ○ | ○ | ○ | ○ | ○ |
| **Solene** (chat router) | ○ | ○ | ○ | ○ | ○ |
| **executive founder personas** (Atlas/Forge, Opus/Sonnet) | ○ | ○ | ○ | ○ | ○ |
| **tools.ts** (tool schemas) | n/a | n/a | ○ no golden tool-call set | n/a | ○ |
| **aiRouter** (all) | n/a | n/a | ◐ cascade self-judge (fail-open, F-08-5) | n/a | n/a |

**Fill order (highest leverage first):**

1. **Pax × factual-grounding on Haiku** — the first-customer path. Golden set: the 15 dg-v1 cases run *through aiRouter forcing Haiku*, scored by the existing forbidden/expected-trait harness (`runEvalSurface`). Wire its pass-rate to `DATA_GROUNDING_EVAL_GREEN` (fixes F-08-3) and add the Haiku lane to CI (fixes F-08-2). ~1 day.
2. **Pax × tool-call-correctness** — new golden set of ~20 turns whose correct behavior is a specific tool call with specific args (lookup_parcel(apn), retrieve_land_knowledge(topic)). Score: did the model emit the expected tool + args (JSON-diff), not prose? Nothing tests this today; a land copilot that answers from memory instead of calling the parcel tool is the fabrication root cause. ~2 days.
3. **supportAgent × refusal + grounding on gpt-4o** — a ~15-case set (billing edge, cross-org data request → DEFECT-0030 posture, "delete my account" → hard-stop deferral). Must run on gpt-4o since that is prod (F-08-4). ~1 day.
4. **Pax/support × injection resistance** — promote `untrustedEnvelope`/`validatePaxResponse` from unit-tested guards to *scored* eval cases: 10 injected-`<<USER_DATA>>` payloads (system-prompt exfil, role-swap, tool-abuse) with expected refusal/ignore. Score with the existing judge's leak-detection rubric (judge.ts:97). ~1 day.
5. **Solene × tone/refusal** — lowest urgency (founder-facing, not first-sale path); a ~10-case smoke once 1–4 land.

**Non-negotiable for any cell to count:** the eval's model must equal the production model for that surface. Today the Pax cells fail this (Sonnet-judged, Haiku-served) and the support cells are empty against a gpt-4o prod. A green cell on the wrong model is worse than an empty one — it reads as safety.

---

## Coverage ledger

**Examined exhaustively (read in full):** `server/services/aiRouter.ts` (1935L), `server/ai/paxModelTier.ts`, `server/ai/paxPromptVersions.ts`, `server/ai/dataGroundingEvalCases.ts` + test, `evals/judge.ts`, `evals/gate.ts`, `evals/README.md`, `evals/run-eval.ts` (head + defaults), `.github/workflows/eval.yml` (head), `server/services/aiEvalHarness.ts` (guard + harness core), and the guard/routing sections of `server/ai/executive.ts` (30-110, 1300-1470, 1600-1670, guard grep over 2100-2290).

**Examined by sampling / grep:** `server/ai/supportAgent.ts` (5603L — read client init + all `create`/`model`/JSON.parse/catch/MAX_TOOL_ITERATIONS sites; not every tool handler); `server/ai/tools.ts` (2813L — pax_subagent call site only); `server/services/modelRouter.ts`, `paxScheduler.ts`, `routes-ai.ts` (330-375, 539), `routes-support-tickets.ts` (call sites). Call-graph for `processChat`/`processChatStream`/`composePaxSystemPrompt`/`gateOutputOrThrow`/`pickPaxModelForTask` traced by grep.

**Did NOT examine (declared gaps):** `server/services/solene/**` (~50 files — Solene chat model selection, dispatch, constitutional checker internals) beyond confirming it has no eval golden set; `server/ai/vaService.ts` (1249L) and `server/ai/executive.ts` lines 110-1197 and 1670-2100 (memory, tool loop bodies) read only in part; `server/ai/untrustedEnvelope.ts` / `validatePaxResponse.ts` / `sanitizePrompt.ts` confirmed present and referenced but their internal robustness not adversarially tested here; `paxSupportResolver.ts`, `paxHallucinationGuard.ts` internals (confidence gate math) not line-audited; the DB `ai_test_cases` seed state at runtime (could not query DB, read-only). Token-cost-per-tenant-month was reasoned from routing (Haiku-dominant) but not measured against live telemetry rows.

## Constitution Collisions

None. Every finding tightens existing guardrails (grounding, cost ceiling, no-fabrication) rather than proposing a new surface, nav entry, AI destination, or money path. The "add a Haiku eval lane / route through aiRouter / derive the green switch from a real run" fixes are all consistent with the DO-NOT-DO list, including "fabrication is never acceptable" (F-08-1/3 are that hard-stop's enforcement gaps) and "no new AI destinations" (no new surface proposed — supportAgent already exists; F-08-4 folds it back into the shared rail).
