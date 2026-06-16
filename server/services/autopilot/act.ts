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
import type {
  SoleneDispatchAgentRole,
  SoleneDispatchSourceType,
} from "@shared/schema/solene-dispatch";

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
}

const MOVE_BINDINGS: Record<string, MoveBinding> = {
  resolve_incident: { domain: "deploy", agentRole: "iris", isCustomerFacing: false, surface: "generic" },
  protect_runway: { domain: "finance", agentRole: "general-purpose", isCustomerFacing: false, surface: "generic" },
  clear_compliance: { domain: "ops", agentRole: "beatrice", isCustomerFacing: false, surface: "generic" },
  clear_support_backlog: { domain: "support", agentRole: "general-purpose", isCustomerFacing: true, surface: "support" },
  unblock_activation: { domain: "deploy", agentRole: "iris", isCustomerFacing: false, surface: "generic" },
  grow_owned_channels: { domain: "growth", agentRole: "soren", isCustomerFacing: false, surface: "content" },
  optimize: { domain: "ops", agentRole: "iris", isCustomerFacing: false, surface: "generic" },
};

const DEFAULT_BINDING: MoveBinding = {
  domain: "ops",
  agentRole: "general-purpose",
  isCustomerFacing: false,
  surface: "generic",
};

export function bindingFor(moveKind: string): MoveBinding {
  return MOVE_BINDINGS[moveKind] ?? DEFAULT_BINDING;
}

/** Translate a ranked move into the PolicyAction the gate stack screens. */
export function moveToPolicyAction(move: RankedMove): PolicyAction {
  const b = bindingFor(move.kind);
  return {
    domain: b.domain,
    actionKind: move.kind,
    orgId: null, // autopilot acts at the platform level
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

export type ActOutcome =
  | { status: "acted"; move: RankedMove; dispatchId: number }
  | { status: "escalated"; move: RankedMove; askId: number | null; verdict: EscalationVerdict }
  | { status: "suppressed"; move: RankedMove; reason: string }
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
      const dispatchId = await deps.enqueue({
        sourceType: "auto_dispatch",
        sourceId: `autopilot:${move.kind}`,
        agentRole: binding.agentRole,
        promptText: dispatchPromptFor(move),
        maxCostUsd: ctx.maxCostUsd,
        enqueuedBy: "autopilot",
      });
      return { status: "acted", move, dispatchId };
    }

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
      return { status: "suppressed", move, reason: verdict.reason };
    }

    const isDraft = verdict.action === "founder_draft_review";
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
      ].join("\n"),
      answerFormat: "yes_no",
      urgency: verdict.urgency,
    });
    return { status: "escalated", move, askId, verdict };
  } catch (err) {
    return { status: "error", move, reason: err instanceof Error ? err.message : String(err) };
  }
}
