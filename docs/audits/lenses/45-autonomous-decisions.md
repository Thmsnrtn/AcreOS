# Lens 45 -- Autonomous Decision Review

**Auditor persona:** Autonomous decision review specialist
**Date:** 2026-04-15
**Scope:** Decisions inbox, autonomous decision executor, agent authority gate, approval workflows, override learning, undo registry, financial authority gate, AI board of directors, temporary delegation

---

## Architecture Overview

AcreOS implements a multi-layer autonomous decision-making system designed to minimize founder involvement. The architecture consists of:

1. **Decisions Inbox** (`server/services/decisionsInbox.ts`) -- A queue of items awaiting human approval (support escalations, critical alerts, churn risk interventions, feature requests).
2. **Autonomous Decision Executor** (`server/services/autonomousDecisionExecutor.ts`) -- Runs every 30 minutes, feeds each pending inbox item to an LLM (Opus 4.6), and auto-executes decisions when AI confidence >= 75%.
3. **Agent Authority Gate** (`server/services/agentAuthorityGate.ts`) -- Trust-score-based access control with four authority levels (0=full autonomy, 1=auto+notify, 2=recommend+wait, 3=always escalate).
4. **Financial Authority Gate** (`server/services/financialAuthorityGate.ts`) -- Five-tier graduated spending limits ($0-$500 single agent, up to $50K+ founder-required).
5. **AI Board of Directors** (`server/services/aiBoardOfDirectors.ts`) -- Constitutional compliance checks and domain-weighted voting on proposals.
6. **Override Learner** (`server/services/overrideLearner.ts`) -- Extracts lessons from founder rejections and injects them into future agent prompts.
7. **Temporary Delegation** (`server/services/temporaryDelegation.ts`) -- CEO can temporarily elevate agent authority for specific actions.
8. **Undo Registry** (`server/services/undoRegistry.ts`) -- Tracks reversible vs irreversible actions with time-windowed undo.
9. **Agent Action Executors** (`server/services/agentActionExecutors.ts`) -- Registered side-effect functions mapped to agent+action pairs.

---

## Findings

### P0 -- Agent Can Take Harmful Action Without Approval

#### P0-45-1: Autonomous executor sends customer-facing emails without authority gate

The `autonomousDecisionExecutor.ts` does NOT route actions through the `agentAuthorityGate`. It has its own parallel decision path: LLM evaluates the item, and if confidence >= 75% (configurable via env var), it directly executes real side effects including:

- **Sending customer-facing support replies** (`executeSupportEscalationApproval`, line 273) -- inserts a message into the ticket and marks it resolved
- **Sending retention emails** (`executeChurnRiskApproval`, line 300) -- sends actual emails to customers via `emailService`
- **Acknowledging and closing critical system alerts** (`executeAlertAcknowledgement`, line 342)

These actions bypass the trust-score-based authority gate entirely. The authority gate was designed as "every agent action goes through this gate" (per its own header comment), but the autonomous executor is a separate code path that runs on a timer and does not call `checkAuthority` or `executeWithAuthority`.

**Impact:** An AI hallucination or misjudgment at 75% confidence can send incorrect or harmful messages to paying customers, close legitimate system alerts, or resolve valid support tickets with wrong answers -- all without any human seeing the action before it happens.

**Files:** `server/services/autonomousDecisionExecutor.ts` (lines 273-388, 670-693), `server/services/agentAuthorityGate.ts`

#### P0-45-2: Generic inbox items auto-approved with no real execution guard

When the autonomous executor encounters an inbox item whose `itemType` does not match any known case (support_escalation, churn_risk_intervention, critical_alert, feature_request_flagged), it falls through to the `default` branch (line 689-690):

```typescript
default:
  execResult = { success: true, detail: `Generic approval — action payload: ${JSON.stringify(item.actionPayload)}` };
```

This reports `success: true` and marks the item as approved/executed, but performs no actual work. If new item types are added to the inbox without a corresponding executor, they will be silently "approved" by the AI with no action taken, and the founder will see them as resolved in the audit log.

**Files:** `server/services/autonomousDecisionExecutor.ts` (lines 689-690)

#### P0-45-3: `requestedLevel` referenced before declaration in authority gate (temporal dead zone bug)

In `agentAuthorityGate.ts`, the temporary delegation check at line 119 references `requestedLevel`, but that variable is not declared until line 130. Due to `let` hoisting rules, accessing it before declaration causes a ReferenceError (TDZ violation). When a temporary delegation is active for an agent, the authority gate will throw an uncaught exception. The `catch {}` on line 127 silently swallows this error, causing the function to fall through to the normal authority check path -- which means the temporary delegation is silently ignored, and the agent may proceed with whatever authority its trust score allows.

Since the error is swallowed, the delegation grant (`grantTemporaryAuthority`) appears to succeed from the CEO's perspective, but it has no effect on the agent's actual authority. The agent then operates under its static authority config, potentially either more or less permissive than the CEO intended.

**Files:** `server/services/agentAuthorityGate.ts` (lines 119, 127, 130)

### P1 -- Missing Guardrails

#### P1-45-1: Decisions inbox `approve()` bypasses authority gate

The `decisionsInboxService.approve()` method (line 247) calls `executeAction` from `agentActionExecutors.ts` directly, without routing through `executeWithAuthority`. The founder's explicit approval triggers side effects (sending emails, resolving tickets) without any trust-score check. While the founder approval is itself an authorization signal, the action executor path also skips the constitutional compliance check that `executeWithAuthority` performs via `aiBoardOfDirectors.checkConstitutionalCompliance`.

**Files:** `server/services/decisionsInbox.ts` (lines 278-288), `server/services/agentActionExecutors.ts` (line 614)

#### P1-45-2: `override()` method does not execute any action

The `decisionsInboxService.override()` method (line 322) marks the item as "approved" with the founder's custom action text, but does NOT execute anything. It only sets `founderOverrideAction` and `status: "approved"`. The founder writes a custom action expecting it to be carried out, but nothing happens -- it is stored as text only. Compare this with `approve()` which actually calls `executeAction`. This is a silent failure mode.

**Files:** `server/services/decisionsInbox.ts` (lines 322-332)

#### P1-45-3: No rate limit on autonomous email sends

The autonomous executor can send retention emails and support replies to every pending item (up to 20 per run, every 30 minutes). There is no per-customer or per-org deduplication for emails already sent by the executor. While the inbox has deduplication for *creating* items, the executor itself has no guard against sending a second retention email to the same customer if the item is re-created (e.g., after a deferred item re-opens and churn score remains high).

**Files:** `server/services/autonomousDecisionExecutor.ts` (lines 300-340, 780-794)

#### P1-45-4: Hard guardrails check `actionPayload.amount` but real actions do not set it

The `checkHardGuardrails` function checks `payload.amount` and `payload.recipients` to block high-value or mass actions. However, the actual item creation flows (e.g., `createFromChurnRisk`, `createFromEscalation`) set `actionPayload` to structures like `{ orgId, action: "send_retention_email", riskScore }` that do not include an `amount` field. The financial guard only catches actions that explicitly declare their dollar amount in the payload. The `estimatedImpactCents` field on the inbox item is checked separately by the graduated financial gate, but only when `GRADUATED_FINANCIAL_AUTHORITY_ENABLED` is true and only when `estimatedImpactCents > 0` -- which is `null` for churn interventions (line 148 sets it to `null`).

**Files:** `server/services/autonomousDecisionExecutor.ts` (lines 392-464, 493-534), `server/services/decisionsInbox.ts` (line 148)

#### P1-45-5: Constitutional compliance check is catch-swallowed

In `agentAuthorityGate.ts` (lines 269-288), the AI Board of Directors constitutional compliance check is wrapped in a `try/catch {}` that silently proceeds if the check fails (import error, network error, database error). This means that if the board-of-directors module is broken, unavailable, or times out, all Level 0 and Level 1 actions proceed without constitutional review. The comment says "Constitutional check unavailable -- proceed with normal execution" but this degrades a safety layer to optional.

**Files:** `server/services/agentAuthorityGate.ts` (lines 269-288)

#### P1-45-6: Temporary delegation stored only in memory

`temporaryDelegation.ts` stores all active delegations in an in-memory `Map` (line 29). If the server restarts (Fly.io rolling deploy, crash, OOM), all delegations are silently lost. The CEO has no notification that their delegation expired due to a restart, and the agents revert to static authority without any log entry. The delegation system does not persist to the database.

**Files:** `server/services/temporaryDelegation.ts` (lines 29, 54)

#### P1-45-7: Trust-based dynamic promotion can elevate actions beyond intended scope

The authority gate's "dynamic trust-based promotion" (lines 143-158) automatically promotes actions to higher authority levels when an agent's trust score exceeds thresholds. A Level 2 action (recommend+wait) can be silently promoted to Level 0 (full autonomy) if the agent's trust score reaches 90. The `NEVER_PROMOTE` list covers 15 specific actions, but any new action added to the system that is not in this list will be subject to automatic promotion. This is an opt-out safety model rather than opt-in.

**Files:** `server/services/agentAuthorityGate.ts` (lines 143-158)

### P2 -- Improvements

#### P2-45-1: Unify the two parallel execution pipelines

The system has two independent paths for agent action execution:
1. Authority gate -> agentActionExecutors (used by proactive engine, reaction engine)
2. Autonomous decision executor -> direct execution functions (bypasses authority gate)

These should be consolidated so all agent actions go through a single governance pipeline.

#### P2-45-2: Add execution to `override()` or rename it

The `override()` method should either execute the custom action (like `approve()` does) or be renamed to `overrideLabel()` to clearly communicate that it only records the override text without executing.

#### P2-45-3: Add founder notification for autonomous email sends

While the executor logs all decisions, retention and support emails sent autonomously should trigger a real-time notification (WebSocket push or email summary batch) rather than relying on the founder checking the audit log proactively.

#### P2-45-4: Persist temporary delegations to database

Move the delegation store from in-memory `Map` to the database so delegations survive restarts and are auditable.

#### P2-45-5: Switch dynamic trust promotion to opt-in

Replace the `NEVER_PROMOTE` deny-list with an explicit `ALLOW_PROMOTE` list, so new actions default to their configured authority level and only gain promotion when intentionally listed.

#### P2-45-6: Add deferred-item re-evaluation limit

Items that are deferred repeatedly (low AI confidence) can cycle indefinitely between "deferred" and "pending" every 24 hours. Add a max-deferral-count after which the item is escalated to the founder with an explicit "AI cannot resolve this" flag.

#### P2-45-7: Undo coverage is sparse

The undo registry has exactly one registered undo function (`beacon_marketing:pause_campaign`). All other agent actions -- including sending emails, resolving tickets, and acknowledging alerts -- are irreversible by design. The undo UI exists but is effectively non-functional for the vast majority of autonomous actions.

**Files:** `server/services/undoRegistry.ts` (lines 28-37)

---

## Summary

The autonomous decision system has a comprehensive architectural vision (trust scoring, graduated financial authority, constitutional compliance, override learning), but critical execution paths bypass the authority gate entirely. The most significant risk is the autonomous executor sending customer-facing emails and resolving support tickets based solely on LLM confidence, with no authority-gate check, no rate limiting, and no real-time founder notification. The `requestedLevel` TDZ bug silently disables temporary delegations. Several safety layers (constitutional compliance, governance checks) are wrapped in silent catch blocks that degrade them to no-ops when the backing services fail.
