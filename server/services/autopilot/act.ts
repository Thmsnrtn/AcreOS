/**
 * Founder Autopilot — act(): the bridge from judgment to governed action.
 *
 * The brain (decide.ts) ranks the next move; this module is what turns the top
 * move into a real, governed effect. It is the keystone that closes the loop:
 *
 *   sense → decide → ACT (through the gate) → measure
 *
 * Every move routes through the SAME safety spine and never around it:
 *   1. moveToPolicyAction()      — translate the move into a PolicyAction.
 *   2. runPolicyGateStack()      — compliance → quality → budget → autonomy →
 *                                  witnessed-send. ONE choke point.
 *   3a. pass     → enqueue a governed dispatch (the hands do the work).
 *   3b. escalate → classifyEscalation() → askFounder (decision or draft-review).
 *   3c. block    → classifyEscalation() decides silence vs. surface.
 *
 * SAFE BY CONSTRUCTION. Even when the loop calls this every tick, nothing acts
 * outwardly until a domain has *earned* autonomy: at OBSERVE the autonomy gate
 * blocks, so the outcome is "suppressed" (silent self-correction) and no
 * dispatch is enqueued. Customer-facing moves always escalate to a human tap.
 * Outward dispatches carry the craft standard in their prompt so anything the
 * hands produce is held to the taste bar from the first token.
 *
 * Fully dependency-injected → unit-testable with zero DB / live services.
 */
import type { RankedMove } from "./decide";
import type {
  AutopilotDomain,
  PolicyAction,
  PolicyGateDecision,
} from "./policyGate";
import type { EscalationContext, EscalationVerdict } from "./escalation";
import { craftStandardPrompt, type CraftSurface } from "./craftStandard";
import { recordCleanCycle, recordAnomaly } from "./domainAutonomy";
import { PLATFORM_SCOPE } from "./tenantScope";
import type {
  SoleneDispatchAgentRole,
  SoleneDispatchSourceType,
} from "@shared/schema/solene-dispatch";

/** Prefix on the sourceId of every autopilot-initiated dispatch. */
export const AUTOPILOT_SOURCE_PREFIX = "autopilot:";

// ── Move → governed-action mapping ───────────────────────────────────────────
// Each move kind declares the domain it acts in, which agent role would carry
// it, whether it touches a customer (→ witnessed-send), and the craft surface
// for the dispatch prompt. Defensive default keeps an unknown move internal +
// non-customer-facing (the safe assumption).

interface MoveBinding {
  domain: AutopilotDomain;
  agentRole: SoleneDispatchAgentRole;
  isCustomerFacing: boolean;
  surface: CraftSurface;
  /**
   * Whether the action can be undone / has bounded blast radius (kernel-elevation
   * T0.2). Internal remediation + non-destructive retries are reversible; a
   * customer-facing send or a public broadcast is not. Feeds the risk-calibrated
   * autonomy gate; an UNKNOWN move is irreversible by default (fail closed).
   */
  reversible: boolean;
}

const MOVE_BINDINGS: Record<string, MoveBinding> = {
  resolve_incident: { domain: "deploy", agentRole: "iris", isCustomerFacing: false, surface: "generic", reversible: true },
  protect_runway: { domain: "finance", agentRole: "general-purpose", isCustomerFacing: false, surface: "generic", reversible: true },
  clear_compliance: { domain: "ops", agentRole: "beatrice", isCustomerFacing: false, surface: "generic", reversible: true },
  clear_support_backlog: { domain: "support", agentRole: "general-purpose", isCustomerFacing: true, surface: "support", reversible: false },
  unblock_activation: { domain: "deploy", agentRole: "iris", isCustomerFacing: false, surface: "generic", reversible: true },
  grow_owned_channels: { domain: "growth", agentRole: "soren", isCustomerFacing: false, surface: "content", reversible: false },
  optimize: { domain: "ops", agentRole: "iris", isCustomerFacing: false, surface: "generic", reversible: true },
  // Hands roadmap P0.2/P1 — outward-perception moves. A move that touches a
  // customer is marked isCustomerFacing so it escalates to witnessed-send; the
  // internal remediation moves (deliverability, payment retry) stay internal.
  stabilize_reflexes: { domain: "deploy", agentRole: "iris", isCustomerFacing: false, surface: "generic", reversible: true },
  protect_deliverability: { domain: "ops", agentRole: "iris", isCustomerFacing: false, surface: "generic", reversible: true },
  retain_at_risk: { domain: "support", agentRole: "general-purpose", isCustomerFacing: true, surface: "support", reversible: false },
  recover_payments: { domain: "finance", agentRole: "general-purpose", isCustomerFacing: false, surface: "generic", reversible: true },
  convert_trials: { domain: "finance", agentRole: "soren", isCustomerFacing: true, surface: "support", reversible: false },
};

/**
 * The binding for a move-kind the kernel has NEVER SEEN (kernel-elevation T0.2,
 * fail-closed). It is maximally risky: customer-facing (→ forces witnessed-send,
 * a human tap) and irreversible (→ the risk-autonomy gate treats it as high
 * blast-radius). This is the only sound default for a domain-agnostic body that
 * a foreign Foundry pack ships unseen move-kinds into — an unknown action must
 * never bind to the cheapest internal tier.
 */
const DEFAULT_BINDING: MoveBinding = {
  domain: "ops",
  agentRole: "general-purpose",
  isCustomerFacing: true,
  surface: "generic",
  reversible: false,
};

export function bindingFor(moveKind: string): MoveBinding {
  return MOVE_BINDINGS[moveKind] ?? DEFAULT_BINDING;
}

/** True iff this move-kind has an explicit, known binding (not the fail-closed default). */
export function isKnownMoveKind(moveKind: string): boolean {
  return Object.prototype.hasOwnProperty.call(MOVE_BINDINGS, moveKind);
}

/** Translate a ranked move into the PolicyAction the gate stack screens. */
export function moveToPolicyAction(move: RankedMove): PolicyAction {
  const b = bindingFor(move.kind);
  return {
    domain: b.domain,
    actionKind: move.kind,
    scope: PLATFORM_SCOPE, // the autopilot operates AcreOS itself — its own single tenant
    isCustomerFacing: b.isCustomerFacing,
  };
}

/** Compose the dispatch prompt — the move's intent + the craft standard. */
export function dispatchPromptFor(move: RankedMove): string {
  const b = bindingFor(move.kind);
  return [
    `Autopilot task — ${move.kind} (${b.domain}).`,
    move.rationale,
    "",
    craftStandardPrompt(b.surface),
  ].join("\n");
}

// ── Outcome ──────────────────────────────────────────────────────────────────

/** Which gate produced the decision — for the glass-box reasoning trace. */
export interface GateSummary {
  decision: "pass" | "block" | "escalate";
  decidedBy?: string;
}

export type ActOutcome =
  | { status: "acted"; move: RankedMove; dispatchId: number; gate: GateSummary }
  | { status: "escalated"; move: RankedMove; askId: number | null; verdict: EscalationVerdict; gate: GateSummary }
  | { status: "suppressed"; move: RankedMove; reason: string; gate: GateSummary }
  | { status: "error"; move: RankedMove; reason: string };

export interface ActDeps {
  runGate: (action: PolicyAction) => Promise<PolicyGateDecision>;
  classify: (decision: PolicyGateDecision, ctx: EscalationContext) => EscalationVerdict;
  enqueue: (opts: {
    sourceType: SoleneDispatchSourceType;
    sourceId: string;
    agentRole: SoleneDispatchAgentRole;
    promptText: string;
    maxCostUsd?: number;
    enqueuedBy?: string;
  }) => Promise<number>;
  ask: (input: {
    askingAgentRole: SoleneDispatchAgentRole;
    questionSummary: string;
    questionBody: string;
    answerFormat: "yes_no";
    urgency: "urgent" | "normal" | "low";
  }) => Promise<{ askId: number }>;
  /** Recent blocks for this action-kind — lets the classifier spot a stall. */
  recentBlockCount?: (domain: AutopilotDomain, moveKind: string) => Promise<number>;
  /**
   * Optional honest counterfactual for an escalated decision — rendered text
   * appended to the founder ask ("what happens if you approve / decline"). When
   * absent, the ask simply omits it. Injected (not imported) to keep act.ts free
   * of a cycle with simulate.ts.
   */
  simulate?: (move: RankedMove) => string;
  /**
   * Optional adversarial pre-mortem. For a high-stakes move that would otherwise
   * auto-run, a skeptic gets one look; a fatal objection (veto) converts the
   * action to a founder escalation. Returns null for low-stakes or no objection.
   * Injected (not imported) to keep act.ts cycle-free with safety.ts.
   */
  premortem?: (move: RankedMove) => Promise<{ veto: boolean; objection: string } | null>;
  /**
   * Optional risk-calibrated check (deterministic, cheap). Even in a trusted
   * domain, a high-risk action (novel / irreversible / expensive) escalates for
   * a human tap. Returns the tier + reasons, or null to skip. Runs BEFORE the
   * pre-mortem so a high-risk action escalates without spending a model call.
   */
  assessRisk?: (move: RankedMove) => Promise<{ tier: "low" | "medium" | "high"; reasons: string[] } | null>;
}

export interface ActContext {
  envelopeStatus: "green" | "amber" | "red";
  /** Lean-mode per-dispatch cap. */
  maxCostUsd?: number;
}

/**
 * Route a single move through governance to its outcome. Never throws — a
 * failure resolves to an `error` outcome so the loop keeps running.
 */
export async function planAndAct(
  move: RankedMove,
  ctx: ActContext,
  deps: ActDeps,
): Promise<ActOutcome> {
  try {
    const binding = bindingFor(move.kind);
    const action = moveToPolicyAction(move);
    const decision = await deps.runGate(action);

    // ── pass → the action is fully cleared; enqueue the governed dispatch. ──
    if (decision.decision === "pass") {
      // Risk-calibrated autonomy (cheap, deterministic, FIRST): even in a
      // trusted domain, a high-risk action (novel / irreversible / expensive)
      // escalates for a human tap rather than auto-running.
      if (deps.assessRisk) {
        const risk = await deps.assessRisk(move).catch(() => null);
        if (risk?.tier === "high") {
          const { askId } = await deps.ask({
            askingAgentRole: binding.agentRole,
            questionSummary: `A higher-risk ${binding.domain} action wants your sign-off: ${move.kind}`,
            questionBody: [
              move.rationale,
              "",
              `I'd normally handle this, but it's higher-risk because ${risk.reasons.join("; ")}.`,
              "",
              "Approve to let me proceed, or decline to hold it.",
            ].join("\n"),
            answerFormat: "yes_no",
            urgency: "normal",
          });
          return {
            status: "escalated",
            move,
            askId,
            verdict: { escalate: true, action: "founder_ask", urgency: "normal", reason: risk.reasons.join("; ") },
            gate: { decision: "escalate", decidedBy: "risk" },
          };
        }
      }
      // Adversarial pre-mortem: a high-stakes move gets one more skeptical look
      // before it runs. A fatal objection converts it to a founder escalation
      // rather than auto-running. (No-op for low-stakes moves.)
      if (deps.premortem) {
        const pm = await deps.premortem(move).catch(() => null);
        if (pm?.veto) {
          const { askId } = await deps.ask({
            askingAgentRole: binding.agentRole,
            questionSummary: `Held a high-stakes ${binding.domain} action for your review: ${move.kind}`,
            questionBody: [
              move.rationale,
              "",
              `A pre-mortem skeptic raised a serious concern: ${pm.objection}`,
              "",
              "Approve to proceed anyway, or decline to hold it.",
            ].join("\n"),
            answerFormat: "yes_no",
            urgency: "urgent",
          });
          return {
            status: "escalated",
            move,
            askId,
            verdict: { escalate: true, action: "founder_ask", urgency: "urgent", reason: pm.objection },
            gate: { decision: "escalate", decidedBy: "premortem" },
          };
        }
      }
      const dispatchId = await deps.enqueue({
        sourceType: "auto_dispatch",
        sourceId: `${AUTOPILOT_SOURCE_PREFIX}${move.kind}`,
        agentRole: binding.agentRole,
        promptText: dispatchPromptFor(move),
        maxCostUsd: ctx.maxCostUsd,
        enqueuedBy: "autopilot",
      });
      return { status: "acted", move, dispatchId, gate: { decision: "pass" } };
    }

    const gate: GateSummary = { decision: decision.decision, decidedBy: decision.decidedBy };

    // ── block / escalate → ask the classifier whether the founder hears it. ──
    const recentBlockCount = deps.recentBlockCount
      ? await deps.recentBlockCount(action.domain, move.kind).catch(() => 0)
      : 0;
    const verdict = deps.classify(decision, {
      domain: action.domain,
      isCustomerFacing: action.isCustomerFacing,
      recentBlockCount,
      envelopeStatus: ctx.envelopeStatus,
    });

    if (!verdict.escalate) {
      return { status: "suppressed", move, reason: verdict.reason, gate };
    }

    const isDraft = verdict.action === "founder_draft_review";
    const simulation = deps.simulate ? deps.simulate(move) : "";
    const { askId } = await deps.ask({
      askingAgentRole: binding.agentRole,
      questionSummary: isDraft
        ? `Review a drafted ${binding.domain} action: ${move.kind}`
        : `Approve a ${binding.domain} action: ${move.kind}`,
      questionBody: [
        move.rationale,
        "",
        verdict.reason,
        "",
        isDraft
          ? "The system drafted this but isn't yet trusted to send it on its own. Approve to let it proceed (this also advances the domain's autonomy)."
          : "Approve to let the system carry this out.",
        ...(simulation ? ["", simulation] : []),
      ].join("\n"),
      answerFormat: "yes_no",
      urgency: verdict.urgency,
    });
    return { status: "escalated", move, askId, verdict, gate };
  } catch (err) {
    return { status: "error", move, reason: err instanceof Error ? err.message : String(err) };
  }
}

// ── The feedback edge: outcomes earn (or cost) autonomy ──────────────────────
// This is what makes "earned autonomy" real rather than static. When an
// autopilot-initiated dispatch finishes, its outcome feeds the Trust Ledger:
// a clean run is a clean cycle (→ promotion at the threshold); a failure is an
// anomaly (→ demotion one rung). Non-autopilot dispatches are ignored. Without
// this edge, every domain would sit at OBSERVE forever and never grow up.

export interface DispatchOutcomeForFeedback {
  sourceType: string;
  sourceId: string;
  success: boolean;
  terminationReason?: string;
}

export interface AutonomyFeedbackDeps {
  recordCleanCycle: (domain: AutopilotDomain) => Promise<unknown>;
  recordAnomaly: (domain: AutopilotDomain, reason: string) => Promise<unknown>;
}

const defaultFeedbackDeps: AutonomyFeedbackDeps = { recordCleanCycle, recordAnomaly };

/** True when a dispatch was initiated by the autopilot (vs. founder/manual/etc). */
export function isAutopilotDispatch(d: { sourceType: string; sourceId: string }): boolean {
  return d.sourceType === "auto_dispatch" && d.sourceId.startsWith(AUTOPILOT_SOURCE_PREFIX);
}

export async function applyAutonomyFeedback(
  d: DispatchOutcomeForFeedback,
  deps: Partial<AutonomyFeedbackDeps> = {},
): Promise<{ applied: boolean; domain?: AutopilotDomain; effect?: "clean" | "anomaly" }> {
  if (!isAutopilotDispatch(d)) return { applied: false };
  const dd = { ...defaultFeedbackDeps, ...deps };
  const moveKind = d.sourceId.slice(AUTOPILOT_SOURCE_PREFIX.length);
  const domain = bindingFor(moveKind).domain;
  if (d.success) {
    await dd.recordCleanCycle(domain);
    return { applied: true, domain, effect: "clean" };
  }
  await dd.recordAnomaly(domain, `autopilot dispatch failed (${d.terminationReason ?? "unknown"})`);
  return { applied: true, domain, effect: "anomaly" };
}
