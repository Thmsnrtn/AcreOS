# Lens 40 -- Agent Evaluation & Quality Assurance Audit

**Auditor persona:** Agent Evaluation Specialist
**Date:** 2026-04-15
**Codebase snapshot:** commit ff7b154 (main)

---

## Executive Summary

AcreOS operates 12 named SCP agents (Atlas, Sophie, Forge, Beacon, Sentinel, Shield, Oracle, Ledger, Compass, Crucible, Prism, Scribe) with autonomous decision-making authority up to $50,000 and trust scores that gate authority levels 0-3. The system includes several evaluation-adjacent subsystems: a golden-suite mechanism for promoting CEO corrections into regression cases, LLM judges for evolution safety/constitution/regression gates, weekly AI-generated performance reviews with A-F grading, self-calibration rules, outcome verification contracts, and trust evolution scoring.

However, the evaluation infrastructure is almost entirely **theoretical**. Every golden-suite JSONL file is empty (0 bytes). Every agent metrics.json shows `total_sessions: 0`, `success_rate: 0`, `golden_suite_size: 0`. There are zero unit tests, zero integration tests, and zero end-to-end tests for any SCP agent decision path. The performance review system grades agents using an LLM that reads metrics from empty tables and produces narrative grades that reflect zero real data. The self-calibration service uses `Math.random()` placeholders for 3 of 5 core metrics. The outcome verification pipeline exists in code but there is no evidence it has ever run against a real action. The LLM judges -- triple-Sonnet safety panels, cascaded regression checkers -- are sophisticated in design but have never been tested against known-good or known-bad inputs.

The system asks agents to make financial decisions, send customer communications, auto-resolve support tickets, and execute churn interventions, all gated by trust scores that have never been earned through verified outcomes. This is the most critical evaluation gap: **agents are granted decision authority through a trust framework that has never observed a single real outcome**.

---

## Findings

### EVAL-001: All 12 Golden Suite Files Are Empty -- No Regression Test Cases Exist
**Severity: P1**

The golden-suite system (`scpGoldenSuite.ts`) is designed to capture CEO corrections as permanent regression cases. Each of the 12 agents has a `sovereign-protocol/agents/{name}/meta/golden-suite.jsonl` file. Every single file is empty (0 bytes).

**Evidence:**
- `sovereign-protocol/agents/atlas/meta/golden-suite.jsonl` -- 0 lines
- `sovereign-protocol/agents/beacon/meta/golden-suite.jsonl` -- 0 lines
- (same for all 12 agents: compass, crucible, forge, harbor, ledger, oracle, prism, scribe, sentinel, shield)

The `scpGoldenSuite.ts:94` `promoteToGoldenCase()` function writes to these files, but `shouldPromoteGoldenCase()` requires both `outcome === "success"` and `ceo_corrections.length > 0` -- conditions that apparently have never co-occurred in production.

**Impact:** The regression judge (`scpLLMJudges.ts:393`) short-circuits when `goldenCases.length === 0`, meaning the evolution engine's regression gate is permanently open. Any self-modification passes the regression check because there are no lessons to contradict.

---

### EVAL-002: All Agent Metrics Are Zero -- Trust Scores Are Not Earned From Data
**Severity: P1**

Every agent's `metrics.json` shows identical zeroed state:

```json
{
  "total_sessions": 0,
  "success_rate": 0,
  "correction_rate": 0,
  "ceo_override_rate": 0,
  "escalation_accuracy": 0,
  "golden_suite_size": 0,
  "last_evolution_at": null,
  "evolution_count": 0
}
```

This is the file-based metrics store used by `scpConfigVersioning.ts`. The trust evolution service (`trustEvolution.ts`) runs daily and recalculates trust from `agentActionLog` and `decisionsInboxItems` DB tables -- but the file-based SCP metrics, which feed the evolution engine and auto-rollback system, are completely uninitialized.

**Impact:** The auto-rollback system (`scpGoldenSuite.ts:235`) returns `null` immediately when `total_sessions < window` (default 5), meaning no rollback can ever trigger. Trust promotion suggestions (`checkTrustPromotions`) require 20+ sessions to activate. The evolution cadence function receives `total_sessions: 0` and returns the most conservative cadence. The entire SCP self-improvement loop is inert.

---

### EVAL-003: No Eval Criteria or Acceptance Tests for Agents Making Autonomous Decisions
**Severity: P1**

The autonomous decision executor (`autonomousDecisionExecutor.ts`) makes real decisions -- approving support escalations, sending retention emails, triaging critical alerts, auto-prioritizing feature requests, sending dunning emails -- when confidence >= 75%. The financial authority gate (`financialAuthorityGate.ts`) authorizes spending up to $10,000 with agent quorum and no founder involvement.

None of these decision paths have:
- Acceptance criteria defining what a correct decision looks like
- Input/output test cases with expected outcomes
- Boundary condition tests (e.g., confidence at exactly 75%, financial amount at tier boundaries)
- Regression tests for previously incorrect decisions
- Eval metrics tracked over time

**Evidence:** Zero test files exist for:
- `server/services/autonomousDecisionExecutor.ts`
- `server/services/agentAuthorityGate.ts`
- `server/services/financialAuthorityGate.ts`
- `server/services/decisionAutopilot.ts`
- `server/services/agentActionExecutors.ts`
- `server/services/trustEvolution.ts`

The test directory (`tests/unit/`) contains 100+ unit test files for other services (billing, lead scoring, encryption, etc.) but zero test files for any SCP agent decision service.

---

### EVAL-004: LLM Judges Have No Test Cases -- Safety-Critical Gates Untested
**Severity: P1**

The LLM judge system (`scpLLMJudges.ts`) implements a sophisticated evaluation pipeline:
- Triple-Sonnet safety judge with minority veto (lines 202-309)
- Triple-Sonnet constitution judge with minority veto (lines 317-384)
- Cascaded Haiku-to-Sonnet regression judge (lines 393-456)
- Quality assessment judge with 4-dimension scoring (lines 513-551)
- Observation extraction judge for implicit signals (lines 132-187)

These judges gate all agent self-modifications. A single safety judge failure rejects a change. They fail closed on errors. But:

- No test inputs exercise the safety judge with known-dangerous payloads
- No test inputs exercise the constitution judge with known-violating deltas
- No test inputs exercise the regression judge with known-contradicting changes
- No baseline quality scores exist for known-good or known-bad changes
- The temperature is set to 0.1 but there are no determinism tests verifying that identical inputs produce consistent judgments

**Impact:** The safety-critical fail-closed design is robust in theory, but without test cases proving that dangerous inputs actually get caught, the entire gate system's effectiveness is assumed rather than demonstrated.

---

### EVAL-005: Performance Review System Generates Grades From Empty/Fabricated Metrics
**Severity: P1**

The performance review service (`agentPerformanceReviews.ts`) generates weekly A-F grades for each agent by querying `agentActionLog`, `agentOverrideLearnings`, and `agentGoals` tables, then sending the metrics to an LLM to produce a narrative review.

Problems:
1. **Trust score trajectory is hardcoded to zero delta** -- `trustScoreStart` is set equal to `trustScoreEnd` at line 94 with the comment "Would need trust history for exact number", so trust trajectory is always reported as flat.
2. **avgResponseTimeMs is hardcoded to 0** (line 104) -- response time is never measured.
3. **Peer feedback is generated by LLMs role-playing as other agents** (line 207-229) -- these are not based on real inter-agent interaction data but on personality prompts and metrics summaries.
4. **The grading LLM receives no calibration** -- there are no examples of what an "A" review should look like vs. a "D" review. The grading scale in the prompt (lines 122-128) is subjective and will drift over time.

**Impact:** The CEO receives weekly "performance reviews" that present LLM-generated narratives as objective evaluations. With no real outcome data to ground them, these reviews create a false sense of evaluation rigor.

---

### EVAL-006: Self-Calibration Service Uses Random Placeholders for Core Metrics
**Severity: P1**

The self-calibration service (`agentSelfCalibrationV10.ts`) evaluates whether agents need parameter adjustments based on performance metrics. The `getAgentMetrics()` private method (lines 262-293) populates three of five decision-driving metrics with random values:

```typescript
falseAlarmRate: Math.round(Math.random() * 30), // placeholder
emailOpenRate: 15 + Math.round(Math.random() * 20), // placeholder
overrideRate: Math.round(Math.random() * 50), // placeholder
```

These random metrics feed into `CALIBRATION_RULES` that trigger actual parameter changes:
- `oracle_analytics` anomaly threshold adjusts when `falsePositiveRate > 30`
- `beacon_marketing` triggers personality recalibration when `overrideRate > 60`
- `sentinel_risk` sensitivity adjusts when `falseAlarmRate > 40`

**Impact:** Calibration decisions are partially driven by `Math.random()`. On any given run, an agent's parameters might be adjusted based on a dice roll rather than real performance data.

---

### EVAL-007: Outcome Verification Pipeline Has Never Verified a Real Outcome
**Severity: P2**

Three separate outcome verification systems exist:

1. **`outcomeVerifiers.ts`** -- Registers per-agent, per-action verifiers that check database state (e.g., "did the customer log in after the retention email?"). Has real DB queries for Sophie CSM actions.
2. **`outcomeVerificationLoop.ts`** -- Daily loop checking whether autonomous actions helped, scoring positive/negative/neutral.
3. **`outcomeVerificationV12.ts`** -- Contract-based verification with stages (immediate/short_term/long_term) and methods (email_delivery, customer_login, payment_status).

There is no evidence any of these have run against real actions. The `outcomeVerificationQueue` and `outcomeVerificationContracts` tables would need to be populated by the action executors, but with `total_sessions: 0` across all agents, the verification pipeline has no inputs to process.

**Impact:** The trust evolution system is supposed to adjust scores based on verified outcomes, but the verification layer feeding it is dormant. Trust scores evolve based on decision approval/rejection counts from the `decisionsInboxItems` table rather than on whether approved decisions actually produced good outcomes.

---

### EVAL-008: Agent Evolution Engine Has Never Evolved Any Agent
**Severity: P2**

The evolution engine (`scpEvolutionEngine.ts`) implements a 6-step pipeline: observation extraction, self-critique, delta generation, 5-gate validation, application, and periodic consolidation. Every agent's `version.json` shows `version: 1` with empty `changes: []` arrays and `null` session IDs.

The `evolution-log.jsonl` files and `session-log.jsonl` files under each agent's meta directory are empty. No agent has undergone a single evolution cycle.

**Evidence:**
```json
{
  "agent": "atlas",
  "version": 1,
  "parent": null,
  "session_id": null,
  "changes": []
}
```

**Impact:** The entire self-improvement thesis -- agents learn from CEO corrections, evolve their configs, pass safety gates, accumulate golden cases -- has never executed. The agent persona files remain at their "Day 1 stub" state (e.g., atlas persona.md: "_Day 1 stub. Evolves based on CEO interaction preferences._").

---

### EVAL-009: No Integration Test Covers the Agent Decision-to-Outcome Loop
**Severity: P2**

The only test file touching agents is `tests/integration/aiAgentConversation.test.ts`, which tests the legacy VA agent routing system (executive/sales/acquisitions/marketing/collections/research agents) -- not the SCP agent system. It validates agent profile capability definitions and routing logic using hardcoded profile objects, not real agent interactions.

Missing integration test coverage:
- Agent receives a decision item -> evaluates -> executes -> outcome verified -> trust updated
- Agent proposes self-modification -> 5-gate validation -> applied or rejected
- Agent exceeds financial authority -> escalated to founder -> founder approves/rejects -> learning recorded
- CEO corrects agent -> correction promoted to golden case -> golden case blocks future regression
- Agent trust degrades -> authority level downgraded -> actions require more approvals

The load test (`tests/load/k6-agent-pipeline.js`) tests HTTP endpoint performance under load but does not validate correctness of agent decisions.

---

### EVAL-010: Constitution Checker Pattern Matching Has No Test Coverage
**Severity: P2**

The constitution checker (`constitutionChecker.ts`) implements 10+ regex patterns for detecting dangerous agent self-modification attempts: self-preservation language, permission escalation, manipulation, evolution tampering, autonomy expansion, safety removal, deception, and scope creep.

These patterns are the first (fast, zero-cost) layer of the safety gate. There are no test cases that:
- Verify each pattern matches its intended dangerous input
- Verify patterns do not false-positive on benign input
- Test boundary cases (e.g., partial matches, case variations)
- Test the interaction between pattern-based and LLM-based safety gates

**Evidence:** `tests/unit/` has no file matching `constitution*`, `safety*`, or `scpLLM*`.

**Impact:** The pattern-based safety layer could have false negatives (dangerous inputs that slip through) or false positives (benign inputs that block evolution) without anyone knowing.

---

### EVAL-011: Decision Autopilot Lacks Calibration Benchmarks
**Severity: P2**

The decision autopilot (`decisionAutopilot.ts`) learns CEO decision patterns and progresses through three stages: shadow mode (logs predictions), suggestion mode (recommends to CEO), and autopilot mode (auto-decides). It uses Bayesian confidence with Beta distribution and Laplace smoothing.

There are no benchmarks or calibration tests:
- No validation that the Bayesian confidence calculation actually calibrates (i.e., when it reports 85% confidence, is it correct ~85% of the time?)
- No shadow-mode evaluation comparing autopilot predictions against actual CEO decisions
- No minimum sample size validation test before transitioning from shadow to suggestion mode
- No A/B framework to measure whether autopilot-made decisions produce comparable outcomes to CEO-made decisions

**Impact:** The autopilot may graduate from shadow mode to making real decisions based on uncalibrated confidence scores. A systematically over-confident model would auto-approve decisions the CEO would have rejected.

---

### EVAL-012: Agent Persona Configs Are Day-1 Stubs With No Eval Rubric
**Severity: P2**

Each of the 12 agents has a `persona.md`, `domain-knowledge.md`, `error-recovery.md`, `task-patterns.md`, and `tool-preferences.md` in their sovereign-protocol directory. The persona files are minimal stubs:

```markdown
# Atlas -- Chief Technology Officer

## Communication Style
_Day 1 stub. Evolves based on CEO interaction preferences._

## Voice Characteristics
- Professional and domain-appropriate
- Concise, data-driven reporting
- Escalates uncertainty rather than guessing
```

There is no eval rubric defining:
- What good output looks like for each agent
- How to measure whether an agent's communication style matches its persona
- Quality criteria for domain-specific tasks (e.g., what makes a good Atlas infrastructure recommendation vs. a bad one)
- Response format expectations per task type

**Impact:** Without eval rubrics, performance reviews grade agents against undefined standards. The evolution engine has no target to optimize toward.

---

### EVAL-013: Experiment Engine Has No Statistical Rigor Tests
**Severity: P3**

The experiment engine (`scpExperimentEngine.ts`) implements a hypothesis-driven A/B testing framework with guardrail metrics, statistical significance tracking, and cross-agent coordination. The `Hypothesis` interface requires `confidence_threshold` and `min_sample_size`.

However:
- No test validates the statistical significance calculation
- No test verifies guardrail metric halt conditions
- No test checks that experiments with insufficient sample sizes are not declared conclusive
- The engine stores `conversions` and `sample_size` per variant but the significance calculation is not implemented in the file read

**Impact:** If experiments declare significance prematurely or calculate it incorrectly, agents may adopt changes that were not actually improvements.

---

## Architecture Assessment

### What Exists (Design)

The evaluation architecture on paper is thoughtful:

1. **Golden suite** captures CEO corrections as permanent regression cases
2. **5-gate validation** (constitution, regression, size, drift, safety) with both pattern-based and LLM judge layers
3. **Triple-judge voting** with minority veto for safety-critical gates, failing closed on errors
4. **Cascaded model tiers** for regression checking (cheap screen, expensive deep check on uncertainty)
5. **Weekly performance reviews** with A-F grading, peer feedback, and improvement plans
6. **Self-calibration rules** per agent with parameter adjustment based on metrics
7. **Outcome verification contracts** with staged verification (immediate/short-term/long-term)
8. **Trust evolution** that gates authority levels based on verified performance
9. **Auto-rollback** when metrics degrade after an evolution
10. **Decision autopilot** with Bayesian confidence and graduated rollout (shadow/suggestion/autopilot)

### What Is Missing (Execution)

| Component | Design status | Operational status | Gap |
|---|---|---|---|
| Golden suite | Implemented | 0 cases across 12 agents | No corrections have been captured |
| Agent metrics | Implemented | All zeroed | No sessions have been tracked |
| Evolution engine | Implemented | 0 evolutions | No agent has evolved |
| LLM judges | Implemented | Never invoked | No changes to judge |
| Performance reviews | Implemented | Grading empty data | Reviews are fictional |
| Self-calibration | Implemented | Random placeholders | Calibrations are noise |
| Outcome verification | Implemented | 0 verifications | No outcomes checked |
| Trust evolution | Implemented | Runs on empty tables | Scores are not data-driven |
| Auto-rollback | Implemented | Cannot trigger | Needs 5+ sessions |
| Decision autopilot | Implemented | 0 pattern records | No patterns learned |
| Constitution patterns | Implemented | Never tested | Effectiveness unknown |
| Experiment engine | Implemented | 0 experiments | No statistical validation |

### Key Risks

| Risk | Severity | Likelihood | Impact |
|---|---|---|---|
| Agents make decisions without any eval criteria defining correctness | P1 | Certain | High -- incorrect autonomous decisions have real consequences (emails sent, tickets resolved, money spent) |
| Golden suite permanently empty = regression gate permanently open | P1 | Certain | High -- evolution can never be blocked by past lessons |
| Trust scores govern real authority but are not grounded in outcome data | P1 | Certain | High -- agents may be over-trusted or under-trusted with no basis |
| Performance reviews create false confidence in agent oversight | P1 | Certain | Medium -- CEO relies on fictional evaluations |
| Safety-critical LLM judges have never been exercised with adversarial inputs | P1 | Certain | High -- gate effectiveness is assumed, not proven |
| Random metrics driving real calibration changes | P1 | Certain | Medium -- parameter drift from noise |
| No test coverage for any SCP decision path | P2 | Certain | High -- regressions undetectable |
| Decision autopilot may graduate with uncalibrated confidence | P2 | Medium | High -- auto-decisions the CEO would have rejected |

---

## Recommended Evaluation Strategy (Not a Fix -- Documented for Reference)

For each agent that makes autonomous decisions, the following evaluation artifacts would be needed:

1. **Eval rubric**: Per-agent, per-task-type definition of what a correct output looks like, including edge cases and failure modes.
2. **Golden test cases**: At minimum 10 input/expected-output pairs per agent covering happy path, edge cases, and adversarial inputs. Stored in the existing `golden-suite.jsonl` infrastructure.
3. **LLM judge calibration set**: Known-dangerous and known-safe config deltas to validate that safety and constitution judges produce correct verdicts.
4. **Decision replay dataset**: Historical CEO decisions to calibrate the autopilot's Bayesian confidence before enabling suggestion mode.
5. **Outcome verification baseline**: For each action executor, a definition of what "success" looks like measured against real database state, not LLM judgment.
6. **Regression suite**: Automated tests that run the full decision pipeline (input -> authority check -> execution -> outcome verification -> trust update) against fixed inputs and assert fixed outputs.

---

## Files Referenced

| Path | Role |
|---|---|
| `server/services/scpGoldenSuite.ts` | Golden case promotion, metric tracking, auto-rollback |
| `server/services/scpLLMJudges.ts` | Triple-judge safety/constitution/regression gates |
| `server/services/scpEvolutionEngine.ts` | 6-step self-evolution pipeline |
| `server/services/scpConfigVersioning.ts` | Per-agent config versioning, file I/O, metrics |
| `server/services/scpExperimentEngine.ts` | Hypothesis-driven A/B experiments |
| `server/services/agentPerformanceReviews.ts` | Weekly AI-generated performance reviews |
| `server/services/agentSelfCalibrationV10.ts` | Self-calibration with random metric placeholders |
| `server/services/agentSelfImprovement.ts` | Post-review improvement plans |
| `server/services/agentAuthorityGate.ts` | Trust-gated authority levels |
| `server/services/agentActionExecutors.ts` | Real side-effect execution per agent action |
| `server/services/autonomousDecisionExecutor.ts` | Autonomous decision pipeline (confidence >= 75% = auto-execute) |
| `server/services/financialAuthorityGate.ts` | Graduated spending tiers up to $50K |
| `server/services/decisionAutopilot.ts` | Bayesian confidence pattern learning |
| `server/services/trustEvolution.ts` | Daily trust score recalculation |
| `server/services/outcomeVerifiers.ts` | Per-action outcome verification |
| `server/services/outcomeVerificationLoop.ts` | Daily outcome verification sweep |
| `server/services/outcomeVerificationV12.ts` | Contract-based staged verification |
| `server/services/constitutionChecker.ts` | Pattern-based safety gate (10+ regex patterns) |
| `server/services/core-agents.ts` | Core agent base class with skill execution |
| `server/services/agent-skills.ts` | Skill registry with typed schemas |
| `sovereign-protocol/agents/*/meta/golden-suite.jsonl` | Empty golden suite files (all 12) |
| `sovereign-protocol/agents/*/meta/metrics.json` | Zeroed metrics (all 12) |
| `sovereign-protocol/agents/*/meta/version.json` | Version 1, no changes (all 12) |
| `sovereign-protocol/constitution.md` | 10 immutable constitutional principles |
| `tests/integration/aiAgentConversation.test.ts` | Tests legacy VA routing, not SCP agents |
| `tests/load/k6-agent-pipeline.js` | Load test for agent pipeline (performance, not correctness) |
