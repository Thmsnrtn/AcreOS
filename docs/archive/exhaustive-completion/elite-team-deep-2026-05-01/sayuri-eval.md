# Sayuri Murakami — AcreOS Eval Infrastructure Deep Dive

**Date:** 2026-05-01
**Wave:** 2 of 87-persona audit
**Lens:** 5 years on Anthropic's eval infra team. Without an eval pipeline, every prompt change is a YOLO push and quality regressions only surface when customers complain — by which time the trust is already burned.
**Predecessor:** Theo Okuda (`elite-team-2026-05-01/theo-ai.md`) flagged "no eval infrastructure" as the headline finding. This document specifies what to build.

---

## 1. Verdict

**Eval-infrastructure maturity: 0/5.** No golden sets. No CI gates. No regression scoring. `agent_llm_traces` exists but is sparsely written and never read by an eval. Two parallel telemetry tables, zero offline scoring runs. Every prompt change is shipped on vibes.

A 0 is not a 1. A 1 means "someone runs evals manually before a release." AcreOS does not even have that.

---

## 2. Per-Feature Eval Design

For each AI surface I list: **what to measure**, **golden set size**, **scoring method**, **gate threshold**. The five eval *categories* are tagged: (a) factual, (b) format, (c) refusal, (d) tone/persona, (e) latency, (f) cost.

### 2.1 Pax inbox draft (`server/routes-ai-draft.ts:44`)

**Blast radius:** speaks as the customer to the customer's customer. A bad draft sent unedited is reputational damage to the Land Investor, not just AcreOS.

| Category | Check | How |
|---|---|---|
| (b) Format | `≤120` words, no salutation/signature block, no subject line | Regex + word count |
| (d) Persona | No "AI-powered", no "as an AI", no "happy to assist", no "Hi there!" | Banned-phrase regex |
| (a) Factual | Does NOT invent dollar amounts, close dates, contract terms unless they appear in the inbound | Sonnet-as-judge with rubric |
| (c) Refusal | Inbound asks "what's your bank routing number?" → reply must decline, suggest secure channel | Sonnet-as-judge boolean |
| (d) Tone | Matches inbound tone band (warm/concise/empathetic) within ±1 step | Sonnet-as-judge 5-point scale |
| (e) Latency | p95 < 2.5s end-to-end | Timing in eval harness |

**Golden set:** **50 inbound emails** across 6 archetypes — cold inquiry, price-fishing, hot lead, irate seller, attorney/title, scam/phish. Each fixture has expected refusal-or-not, expected length band, expected tone band. Author once; lock with a hash.

**Gate:** PR-blocking. Score must be ≥ 0.85 weighted; any banned-phrase hit fails immediately.

### 2.2 Pax executive chat (`server/ai/executive.ts:326`)

**Blast radius:** tool-use. Hallucinated `create_property` APN writes a bad row; hallucinated dollar amount on `generate_offer` is a binding number to a real seller.

| Category | Check | How |
|---|---|---|
| (a) Factual | Tool selection — "send a follow-up to John" → `send_email`, not `send_sms`. Args correct. | Tool-call eval set, exact-match on `name`, schema-match on args |
| (b) Format | Tool args validate against `server/ai/validators.ts` schemas | Programmatic |
| (c) Refusal | Asked for legal/tax advice → adds "attorney must review" disclaimer | Sonnet-as-judge boolean |
| (c) Refusal | Asked to "send a fake offer to scare the seller" → declines plainly | Sonnet-as-judge boolean |
| (d) Persona | No "Sophie", no "Forge", no "Atlas" leak to customer | Regex |
| (e) Latency | p95 first-token < 1.5s; p95 full response (incl tool loop) < 6s | Streaming timing |

**Golden set:** **80 conversations** — 30 single-turn, 50 multi-turn. 20 specifically for tool-use ("schedule a call with John tomorrow at 2pm" → expect `schedule_meeting` with right args).

**Gate:** PR-blocking on banned-phrase + persona-leak. Soft gate (warn, don't block) on tone score.

### 2.3 Compliance disclosures (`server/services/complianceAI.ts:303`)

**Highest legal risk surface in the codebase.** Generates Seller's Property Disclosure language.

| Category | Check | How |
|---|---|---|
| (a) Factual | Required state-specific sections present (per-state checklist) | Deterministic post-validator (NOT a model) |
| (b) Format | "AI-generated draft — attorney review required" banner present | String match |
| (b) Format | No specific dollar amounts, dates, or signatures inlined | Regex |
| (c) Refusal | Asked to omit a known material defect → must refuse | Sonnet-as-judge boolean |

**Golden set:** **40 disclosure scenarios** × per-state required-section dictionary (start with TX, FL, AZ, GA — top 4 land-investor states). Each scenario specifies the ground-truth section list.

**Gate:** PR-blocking on missing-section. This is the one feature where I would refuse to ship without a passing eval.

### 2.4 Support classifier (`server/services/supportBrain.ts:49`)

| Category | Check | How |
|---|---|---|
| (a) Factual | Confusion matrix on labeled tickets — accuracy ≥ 0.92, no category < 0.80 recall | Programmatic |
| (b) Format | Output is valid JSON matching the schema | JSON parse + zod validate |
| (c) Refusal | Out-of-scope ticket → escalates rather than guessing | Boolean |

**Golden set:** **200 historical tickets** (10 categories × 20 each) from production support inbox, hand-labeled once.

**Gate:** PR-blocking. Misclassification cascades — wrong category routes to wrong playbook, which can issue a credit or fail to escalate.

### 2.5 Self-assessment / evolution pipeline (`server/services/selfAssessmentAgent.ts:135`, `evolutionPipeline.ts:288`)

**This changes the system itself.** A bad proposal applied autonomously is a regression engine.

| Category | Check | How |
|---|---|---|
| (b) Format | Proposal is well-formed JSON | zod |
| (a) Factual | `targetFile` resolves to a real file in repo | `fs.existsSync` |
| (a) Factual | Proposed diff applies cleanly with `git apply --check` | Subprocess |
| (c) Refusal | Will not propose changes to security-critical paths (`server/middleware/auth*`, `server/utils/permissions*`) | Path allowlist check |

**Golden set:** **30 synthetic "should propose" + 30 "should not propose" scenarios.** Tag the negatives — known-stable subsystems where any proposal is wrong.

**Gate:** PR-blocking. Plus mandatory human-in-the-loop on every proposal regardless of eval (see §8).

### 2.6 Lead nurturer / dunning / outbound email (`server/services/leadNurturer.ts:150`)

| Category | Check | How |
|---|---|---|
| (a) Factual | Property facts (acreage, county, APN) match the lead row — model cannot invent | Diff against source row |
| (d) Persona | No banned phrases; signs as user, not Pax/AcreOS | Regex |
| (c) Refusal | If lead has `do_not_contact` → eval must reject the call entirely | Pre-call gate test |

**Golden set:** **40 lead profiles**, each with a known truth row. Test that generated email's mentions of acreage/price/county equal the source row.

**Gate:** Soft gate at first; promote to hard gate after 30 days of green runs.

### 2.7 Board of Directors voting (`server/services/aiBoardOfDirectors.ts:250`)

| Category | Check | How |
|---|---|---|
| (b) Format | Valid JSON, valid enum vote, reasoning ≥ 20 chars | zod |
| (d) Persona | Each agent's reasoning reflects its domain (finance agent cites finance) | Sonnet-as-judge |
| (f) Cost | Per-proposal cost ≤ $0.06 | Telemetry assertion |

**Golden set:** **20 proposals** with ground-truth "this should pass / fail / abstain" labels by domain.

**Gate:** Soft. The board itself is governance theater until the prompts get real data (see Theo §3.C).

### 2.8 Briefing writer + headline insight (`server/services/aiBriefingWriter.ts`)

Eval is **whether the LLM is needed at all** (Theo §7). If a deterministic template scores ≥ 0.9 of the LLM's score on the golden set, the LLM should be deleted from this surface. The eval *justifies the cost* or kills the call.

---

## 3. Framework Recommendation

I evaluated five candidates against AcreOS's specific shape (TypeScript-first, multi-tenant, ~20 AI surfaces, Postgres trace table already in place):

| Framework | Strengths | Why not |
|---|---|---|
| **TruLens** | Mature, RAG-focused | Python-only; AcreOS server is TS. RAG is a small slice. |
| **Ragas** | Strong RAG metrics | RAG-only; doesn't fit tool-use, refusal, persona. |
| **DeepEval** | Pytest-style, broad metrics | Python; would force an eval-only Python service. |
| **Promptfoo** | TS-native CLI, YAML configs, judge-as-model built-in, CI-friendly | Less flexible for multi-turn tool-use scenarios. |
| **Custom on Vitest** | Lives in same repo, same lang, same CI as the app | Have to build judge harness ourselves. |

**Recommendation: Promptfoo as the runner + a thin custom judge harness in `tests/evals/`.**

Rationale:
1. **Same-language, same-repo.** No Python sidecar. Engineers who write the prompts run the evals.
2. **Promptfoo handles the boring parts** — assertion library, snapshot diffing, parallelism, HTML report.
3. **Custom judge for the AcreOS-specific bits** — tool-call exact-match, banned-phrase regex pack, per-state disclosure section dict. These are not generic.
4. **Sonnet 4.6 as the judge model.** Cheaper than Opus, better than Haiku at rubric scoring. Pin the judge model — judge drift is a real source of false signal.

What I would NOT do: stand up a separate eval service. Evals must run where the prompts live, or they atrophy.

---

## 4. CI Integration Design

### 4.1 Gates by trigger

| PR touches | Eval suites that run | Gate |
|---|---|---|
| Any file under `server/services/*ai*` or `server/ai/*` | All affected feature suites | Block on red |
| Any prompt file (`server/prompts/**`, after migration from inline) | That feature's suite + persona-consistency suite | Block on red |
| `server/services/aiRouter.ts` | All suites (router change is global blast radius) | Block on red |
| Model catalog change (`aiRouter.ts:330`) | All suites + cost regression check | Block on red |
| Anything else | Smoke suite only (10 fixtures, 60s) | Warn |

### 4.2 What "block on red" means

- A score regression > 5% from main → block.
- Any banned-phrase hit (e.g. "AI-powered", "as an AI", customer-facing "Sophie") → block.
- Any persona-leak (Pax leaks Atlas/Forge/Sophie name to customer) → block.
- Cost increase > 30% per call → warn but don't block (budget-cliff alert).
- Latency p95 increase > 50% → warn.

### 4.3 Nightly + weekly runs

- **Nightly:** full eval suite on `main`, posted to Slack. Catches model-provider drift (DeepSeek/OpenAI/Anthropic silently shipping new weights).
- **Weekly:** trace-replay run (see §5) — sample 500 prod traces and re-grade. Catches distribution drift the golden set doesn't see.

### 4.4 Model-change protocol

A model bump (e.g. Sonnet 4.6 → 4.7) is **not a config change**, it's a **release**. Required:
1. Open PR pinning the new model. CI runs all suites against both old and new.
2. Diff report posted to PR: per-feature score delta, cost delta, latency delta.
3. Founder review on any feature where score drops > 2% or cost rises > 20%.
4. Shadow deploy: 5% traffic on new model for 48h, full telemetry compare, then ramp.

---

## 5. Trace-Replay System Using `agent_llm_traces`

The table at `shared/schema.ts:14949` captures `systemPrompt`, `userPrompt`, `response`, `model`, `latencyMs`, `inputTokens`, `outputTokens`, `costCents`, `metadata`, `purpose`, `agentCodename`. **This is an eval seed corpus we already have, mostly unused.**

### 5.1 Replay pipeline

```
nightly:
  1. SELECT … FROM agent_llm_traces WHERE created_at > now() - 7d
       AND error IS NULL
       SAMPLE 500 stratified by purpose
  2. For each trace:
       re-call current(model, systemPrompt, userPrompt)
       diff(old_response, new_response) via Sonnet-as-judge
       score: equivalent / minor-drift / regression / improvement
  3. Aggregate per (purpose, agentCodename)
  4. Post Slack: "Pax draft: 487 replays, 6 regressions, 2 improvements"
```

### 5.2 What replay catches that golden sets don't

- **Distribution shift.** Golden set is curated; production has the long tail.
- **Prompt-template drift.** Someone changed a `${variable}` interpolation; suddenly 8% of replays differ.
- **Provider drift.** DeepSeek silently changed weights → score quietly drops 10%.

### 5.3 What needs to ship for replay to work

Theo found ~7 services use `tracedLlmCall` and ~40 don't. **Replay is only as good as the trace coverage.** Migrating the top-10 direct-OpenAI services (Theo §8 item 2) doubles as eval coverage. This is one project, not two.

### 5.4 PII + replay safety

Production prompts contain seller names, addresses, phone numbers. Replay must:
- Run in a separate `eval` env with read-only DB.
- Redact obvious PII before logging diffs to Slack (regex pack: emails, phones, SSNs, APNs).
- Never persist re-call responses to `agent_llm_traces` (that table is the source of truth, not a scratchpad).

---

## 6. Cost + Latency of Running Eval

### 6.1 Per-feature run cost

| Feature | Golden size | Calls per run (incl judge) | Cost per run |
|---|---|---|---|
| Pax draft | 50 | 50 + 50 judge | ~$0.15 |
| Pax exec chat | 80 (avg 3 turns) | 240 + 240 judge | ~$2.40 |
| Compliance | 40 | 40 + deterministic | ~$0.80 |
| Support classifier | 200 | 200 (no judge — confusion matrix) | ~$0.18 |
| Self-assessment | 60 | 60 + deterministic | ~$3.00 (Opus) |
| Lead nurturer | 40 | 40 + 40 judge | ~$0.60 |
| Board of Directors | 20 (×10 agents) | 200 + 100 judge | ~$1.10 |
| Briefing | 30 | 30 + 30 judge | ~$0.05 |

**Total per full run: ~$8.30.**

### 6.2 Run cadence + weekly cost

| Trigger | Runs/week | Weekly cost |
|---|---|---|
| PR-triggered (assume 30 PRs/week, avg 2 feature suites each) | 60 partial | ~$120 |
| Nightly full suite | 7 | ~$58 |
| Weekly trace replay (500 samples) | 1 | ~$15 |
| Smoke suite on every PR (~30/wk) | 30 | ~$3 |

**~$200/week eval spend.** Negligible compared to production AI burn (which Theo flagged is largely unmeasured but estimated in the four-figure-monthly range). The eval pays for itself the first time it catches a 10% regression on a hot path.

### 6.3 Latency

- Full suite: 6–9 minutes on parallelism=8.
- PR partial suite: 60–120 seconds.
- Smoke: 30 seconds.

The 60-second smoke suite is the only one that's on the hot CI path. The 6–9 minute full suite runs in parallel with everything else and posts on PR after the fact.

---

## 7. Human-in-the-Loop Eval

Automated eval covers ~80% of regressions cheaply. The remaining 20% needs human judgment. Trigger humans when:

1. **Self-assessment / evolution pipeline proposes a change.** Always. No automated "this is fine" answer is acceptable for a system that modifies itself.
2. **Compliance disclosure eval flags a near-miss** (≥0.85 but <0.92 score). Legal exposure means a human reads it.
3. **Trace replay flags >3% regressions in a week.** Founder reviews 10 sampled diffs.
4. **New AI surface launches.** Mandatory 2-week human-in-loop window before going eval-only.
5. **Cost spike >2× WoW on any feature.** Could be a prompt regression generating runaway tokens; could be load. Human verifies.
6. **Customer complaint that mentions a Pax message.** Pull the trace, run targeted eval on that prompt+response, decide if it's a fixture worth adding to the golden set.

**Where to put this in the UI:** a `founder/ai-review` queue surface that lists flagged traces with the eval score, the prompt, the response, and Approve / Reject / Add-to-golden-set buttons. Two-minute task per item; one founder review session per week keeps the loop healthy.

---

## 8. The 2-Week Eval-Bootstrap Sprint

### Week 1 — make the harness real

**Day 1.** Scaffold `tests/evals/` with Promptfoo config. Add `npm run eval` and `npm run eval:smoke`. Wire Vitest for the deterministic checks (regex, JSON schema, file resolution).

**Day 2.** Build the Sonnet-as-judge wrapper. Pin model `claude-sonnet-4-6-20251101` (or current dated). Author rubric library: `warmth`, `concision`, `accuracy`, `refusal-correctness`, `persona-leak`. Each rubric is a numbered prompt with a 5-point scale and explicit anchors.

**Day 3.** Pax inbox draft golden set (50 fixtures). Author 6 archetypes × variants. Lock fixture file with a hash check so silent edits fail CI.

**Day 4.** Pax inbox draft eval running locally. Wire to PR check via GitHub Actions. Confirm baseline score on `main`.

**Day 5.** Banned-phrase regex pack as a standalone deterministic suite — runs in 0.5s, gates every PR that touches any prompt or AI service.

### Week 2 — coverage + gates

**Day 6.** Compliance disclosure golden set (40 fixtures × 4-state section dictionary). Deterministic post-validator.

**Day 7.** Support classifier — pull 200 historical tickets, hand-label, build confusion matrix runner.

**Day 8.** Pax executive chat — tool-call eval set (20 fixtures with expected tool name + args). Multi-turn conversations (50 fixtures, 3 turns avg).

**Day 9.** Trace-replay v0. Stratified-sample 100 traces from last 7 days, re-call, diff. Slack report.

**Day 10.** CI gate enforcement. Turn warn → block on banned-phrase + persona-leak suites. PR template: "Did you run `npm run eval` for the surfaces you touched?"

**End of sprint:** AcreOS goes from 0/5 to 2.5/5 eval maturity. PR gates exist. Trace replay runs nightly. Compliance has a deterministic floor. Human-in-loop queue exists for the evolution pipeline.

The remaining 2.5/5 → 4/5 progression is 4–6 more weeks: full coverage of the remaining 12 AI surfaces, A/B prompt-versioning harness, drift-alerting on judge-model itself, and per-org eval (some customers' inboxes look nothing like the median).

---

## 9. References

- `shared/schema.ts:14949` — `agent_llm_traces` table (the eval seed corpus, currently dormant)
- `server/services/agentLlmTraces.ts:84` — trace writer (sparsely used per Theo)
- `server/services/tracedLlmCall.ts` — wrapper (used by 7 services, should be 40+)
- `server/routes-ai-draft.ts:44` — best prompt in codebase, first golden-set candidate
- `server/services/complianceAI.ts:303` — highest legal-risk surface, must ship eval before scale
- `server/ai/executive.ts:326` — tool-use surface, needs tool-call eval set
- `server/services/aiRouter.ts:1046` — `aiTelemetryEvents` writer (router-only telemetry)
- `tests/unit/` — existing Vitest setup; eval suite slots in alongside

---

**Bottom line:** Theo found you have no evals. I'm telling you it's two weeks of work to get from 0/5 to 2.5/5 — golden sets, deterministic guards, trace replay, CI gates, human-in-loop queue. After that you can change a prompt without praying. Before that you cannot scale a customer-facing AI surface in good conscience.
