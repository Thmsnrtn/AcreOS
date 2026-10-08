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
import { isRoleWorkerMove } from "../solene/roleWorkers/routing";
import { founderOnlyClassForMove, hardStopForMove } from "./hardStopMoves";
import { isServerAuthored } from "./decide";
import type {
  SoleneDispatchAgentRole,
  SoleneDispatchSourceType,
} from "@shared/schema/solene-dispatch";

/** Lean-mode per-dispatch cap (the $50/mo envelope; keep autopilot work cheap). */
export const AUTOPILOT_DISPATCH_MAX_COST_USD = Number(
  process.env.AUTOPILOT_DISPATCH_MAX_COST_USD ?? 5,
);

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
  /**
   * Stage 2 — the move runs a ROLE WORKER (roleWorkers/routing.ts) whose every
   * outward effect is gated ONE BY ONE at the effect: a customer-facing or
   * money-moving effect is a requiresApproval hand that freezes for a witness
   * (a founder tap, or a founder-issued WitnessGrant via autoWitness), and a
   * publish passes the publish gate under the founder's publish switch. The
   * dispatch itself only drafts. So the move-layer witnessed-send tap would be
   * a SECOND tap for the same effect (and one blanket tap for a whole batch is
   * weaker than one per effect): such a move is not escalated at the move
   * layer, and its risk is the drafting step's, not the effect's. Derived from
   * the routing table, never hand-set (see effectsGatedFor).
   */
  effectsGatedPerAction?: boolean;
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
  const b = MOVE_BINDINGS[moveKind];
  if (!b) return DEFAULT_BINDING;
  return isRoleWorkerMove(moveKind) ? { ...b, effectsGatedPerAction: true } : b;
}

/**
 * The ONLY (move kind, domain) pairs anything but the founder's own tap may
 * approve (the chat's answer_ask). Each pair's rationale is SERVER-AUTHORED
 * by rankMoves from structured senses — counts and fixed text, no
 * model-written words. Whatever a model writes can therefore never be
 * approved by anyone but the founder: an ask is chat-approvable only when its
 * move IS the server-authored catalog object (decide.ts isServerAuthored), is
 * on this list, and the defence-in-depth classifiers find nothing.
 */
const CHAT_APPROVABLE_MOVES: ReadonlySet<string> = new Set([
  "grow_owned_channels:growth",
  "optimize:ops",
  "resolve_incident:deploy",
  "clear_compliance:ops",
  "stabilize_reflexes:deploy",
  "protect_deliverability:ops",
  "unblock_activation:deploy",
  "retain_at_risk:support",
  "clear_support_backlog:support",
]);

/** May a YES to this move's ask come from anywhere but the founder's own tap? Fails closed. */
export function isChatApprovableMove(move: RankedMove): boolean {
  if (move.isNetNew || !isServerAuthored(move)) return false;
  const domain = bindingFor(move.kind).domain;
  if (move.domain !== domain || !CHAT_APPROVABLE_MOVES.has(`${move.kind}:${domain}`)) return false;
  return founderOnlyClassForMove({ kind: move.kind, rationale: move.rationale, domain, isNetNew: false }) == null;
}

/** True iff this move-kind has an explicit, known binding (not the fail-closed default). */
export function isKnownMoveKind(moveKind: string): boolean {
  return Object.prototype.hasOwnProperty.call(MOVE_BINDINGS, moveKind);
}

/** Translate a ranked move into the PolicyAction the gate stack screens. */
export function moveToPolicyAction(move: RankedMove): PolicyAction {
  const b = bindingFor(move.kind);
  // T2.3: a net-new (Operator-proposed) move is forced through witnessed-send in
  // the BODY — isCustomerFacing OR'd true so the gate stack escalates it to a
  // human tap, regardless of any proposed binding. The safety lives here, at the
  // choke point, not in the proposer where the next engineer could bypass it.
  // (The MORE restrictive of the known binding and the net-new floor.)
  // Stage 2: a role-worker move's customer-facing effects are each witnessed
  // at the hand (effectsGatedPerAction) — the move itself only drafts, so it
  // is not witnessed a second time here. A NET-NEW move never qualifies.
  const witnessAtMove = b.isCustomerFacing && b.effectsGatedPerAction !== true;
  const isCustomerFacing = witnessAtMove || move.isNetNew === true;
  return {
    domain: b.domain,
    actionKind: move.kind,
    scope: PLATFORM_SCOPE, // the autopilot operates AcreOS itself — its own single tenant
    isCustomerFacing,
    // S2e — bind the constitution gate at the MOVE layer. Without a toolCall
    // payload the compliance gate recorded "skipped" for every autopilot move
    // (the stack only screens what it is handed), leaving constitution
    // screening to the per-tool layer inside a running dispatch. Screening the
    // move's intent (kind + rationale) here means a violating move is blocked
    // and paged BEFORE a dispatch is enqueued — defense in depth, not a
    // replacement for the per-tool screen. The quality/eval gate stays bound
    // to generated OUTPUT at the dispatch layer — a move has no output yet.
    toolCall: {
      dispatchId: null,
      toolName: move.kind,
      toolInput: { rationale: move.rationale, domain: b.domain, isNetNew: move.isNetNew === true },
      agentRole: b.agentRole,
    },
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
    idempotencyKey?: string | null;
  }) => Promise<number>;
  ask: (input: {
    askingAgentRole: SoleneDispatchAgentRole;
    questionSummary: string;
    questionBody: string;
    answerFormat: "yes_no";
    urgency: "urgent" | "normal" | "low";
    /** The exact proposal a YES runs (founderCollab binds the ask to it). */
    acts?: { moveKind: string; domain: string; rationale: string; chatApprovable: boolean };
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
  /**
   * Stage 2 — the founder's mechanical controls (founderControls.ts): a reason
   * string when the founder paused this move's domain or switched ads off,
   * null to proceed. Checked before any gate; a blocked move is suppressed
   * silently (the founder asked for exactly this).
   */
  blockedByControls?: (move: RankedMove) => Promise<string | null>;
}

export interface ActContext {
  envelopeStatus: "green" | "amber" | "red";
  /** Lean-mode per-dispatch cap. */
  maxCostUsd?: number;
  /**
   * Exactly-once seal (panel #2) — a deterministic effect-key the loop computes
   * for THIS move so a concurrent tick / retry dedups instead of double-firing
   * the outward effect. Forwarded verbatim to enqueue; omit for legacy behavior.
   */
  idempotencyKey?: string | null;
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
    // S9 — a move that implements a hard-stop class (pricing, legal signing,
    // spend > $500, customer-data deletion) never reaches a gate, a dispatch,
    // or an approval that could enqueue it. It is HELD and SURFACED: one ask
    // that says what it is and that only the founder can do it.
    const hardStop = hardStopForMove(move);
    if (hardStop) {
      const { heldHardStopAsk } = await import("./hardStopMoves");
      const { askId } = await deps.ask({
        askingAgentRole: binding.agentRole,
        ...heldHardStopAsk(move, hardStop),
        answerFormat: "yes_no",
        urgency: "normal",
      });
      return {
        status: "escalated",
        move,
        askId,
        verdict: { escalate: true, action: "founder_ask", urgency: "normal", reason: `hard-stop: ${hardStop}` },
        gate: { decision: "escalate", decidedBy: "hard_stop" },
      };
    }
    if (deps.blockedByControls) {
      const blocked = await deps.blockedByControls(move);
      if (blocked) return { status: "suppressed", move, reason: blocked, gate: { decision: "block", decidedBy: "founder_control" } };
    }
    const action = moveToPolicyAction(move);
    const decision = await deps.runGate(action);

    // ── pass → the action is fully cleared; enqueue the governed dispatch. ──
    if (decision.decision === "pass") {
      // Risk-calibrated autonomy (cheap, deterministic, FIRST): even in a
      // trusted domain, a high-risk action (novel / irreversible / expensive)
      // escalates for a human tap rather than auto-running.
      if (deps.assessRisk) {
        // DEFECT-0112: a risk read that FAILS is not a low-risk read. This
        // used `.catch(() => null)`, and `null?.tier === "high"` is false, so
        // an unassessable action auto-ran exactly as a vetted low-risk one
        // did. An action whose risk cannot be shown goes to the founder.
        const risk = await deps.assessRisk(move).catch((err: unknown) => ({
          tier: "high" as const,
          reasons: [
            `the risk check itself failed (${err instanceof Error ? err.message : String(err)}), so I can't show it is safe to run on my own`,
          ],
        }));
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
            acts: { moveKind: move.kind, domain: binding.domain, rationale: move.rationale, chatApprovable: false },
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
            // A pre-mortem objection is model-written: founder tap only.
            acts: { moveKind: move.kind, domain: binding.domain, rationale: move.rationale, chatApprovable: false },
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
        idempotencyKey: ctx.idempotencyKey ?? null,
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
          ? "The system drafted this but isn't yet trusted to send it on its own. Approve to let it proceed — approving queues it to run; only its real result (not your approval) earns the domain more autonomy."
          : "Approve to let the system carry this out — approving queues it to run.",
        ...(simulation ? ["", simulation] : []),
      ].join("\n"),
      answerFormat: "yes_no",
      urgency: verdict.urgency,
      acts: { moveKind: move.kind, domain: binding.domain, rationale: move.rationale, chatApprovable: isChatApprovableMove(move) },
    });
    return { status: "escalated", move, askId, verdict, gate };
  } catch (err) {
    return { status: "error", move, reason: err instanceof Error ? err.message : String(err) };
  }
}

// ── Approval → the drafted move actually runs ────────────────────────────────
// Every escalation above tells the founder "Approve to let it proceed". Until
// 2026-10-07 approving only recorded the verdict: nothing enqueued the move, so
// an approved action never happened. On a YES to an autopilot move ask, the
// move recorded on that ask's Experience Log row is enqueued — through the same
// enqueue path a passing move uses — exactly once (idempotency key per ask,
// plus the row's own dispatch link). A decline or a timeout never reaches here.

/** Idempotency key for the dispatch an approved ask enqueues — one per ask. */
function approvedAskIdempotencyKey(askId: number): string {
  return `approved-ask:${askId}`;
}

export interface EscalatedMoveRecord {
  experienceId: number;
  moveKind: string;
  domain: string;
  /** Set once the approved move has been enqueued. */
  dispatchId: number | null;
  reasoningTrace: unknown;
}

export interface ApprovedMoveDeps {
  /**
   * The proposal the approved ask is bound to (solene_founder_asks.acts_payload)
   * — exactly what the founder saw. What runs is THIS, never a later re-read
   * of the decision trace; an ask with no bound proposal enqueues nothing.
   */
  proposal?: { moveKind: string; domain: string; rationale: string } | null;
  findEscalatedMove: (askId: number) => Promise<EscalatedMoveRecord | null>;
  enqueue: ActDeps["enqueue"];
  linkDispatch: (experienceId: number, dispatchId: number) => Promise<void>;
  maxCostUsd?: number;
}

export type ApprovedMoveOutcome =
  | { status: "enqueued"; dispatchId: number }
  | { status: "already_enqueued"; dispatchId: number }
  | { status: "not_a_move" }
  | { status: "hard_stop_refused" }
  | { status: "not_bound" };

/** The move's own rationale, as the decision trace recorded it (never invented). */
function recordedRationale(rec: EscalatedMoveRecord): string | null {
  const trace = rec.reasoningTrace as { consideredMoves?: Array<{ kind?: unknown; rationale?: unknown }> } | null;
  const hit = trace?.consideredMoves?.find((m) => m?.kind === rec.moveKind);
  return typeof hit?.rationale === "string" && hit.rationale ? hit.rationale : null;
}

/**
 * Enqueue the move an approved ask was about. Throws on an enqueue failure so
 * the caller can surface it — an approval whose move could not be queued must
 * not read as done.
 */
export async function enqueueApprovedMove(askId: number, deps: ApprovedMoveDeps): Promise<ApprovedMoveOutcome> {
  const rec = await deps.findEscalatedMove(askId);
  if (!rec) return { status: "not_a_move" };
  // A hard-stop move is never enqueued by an approval — a one-tap yes on a
  // one-line card must not be the path to a pricing change or a data purge.
  const proposal = deps.proposal ?? null;
  if (
    hardStopForMove({ kind: rec.moveKind, rationale: recordedRationale(rec) ?? undefined, isNetNew: !isKnownMoveKind(rec.moveKind) }) ||
    (proposal && hardStopForMove({ kind: proposal.moveKind, rationale: proposal.rationale, isNetNew: !isKnownMoveKind(proposal.moveKind) }))
  ) {
    return { status: "hard_stop_refused" };
  }
  // Bound to the version the founder saw: no bound proposal, or one for a
  // different move than the ask's experience, enqueues nothing.
  if (!proposal || proposal.moveKind !== rec.moveKind) return { status: "not_bound" };
  if (rec.dispatchId != null) return { status: "already_enqueued", dispatchId: rec.dispatchId };

  const binding = bindingFor(rec.moveKind);
  const move: RankedMove = {
    priority: 0,
    domain: binding.domain,
    kind: rec.moveKind,
    rationale: proposal.rationale,
  };
  const dispatchId = await deps.enqueue({
    sourceType: "auto_dispatch",
    sourceId: `${AUTOPILOT_SOURCE_PREFIX}${rec.moveKind}`,
    agentRole: binding.agentRole,
    promptText: [dispatchPromptFor(move), "", `The founder approved this action (ask #${askId}).`].join("\n"),
    maxCostUsd: deps.maxCostUsd,
    enqueuedBy: "founder-approval",
    idempotencyKey: approvedAskIdempotencyKey(askId),
  });
  // Link the run to the experience so its REAL result (not the approval) votes.
  await deps.linkDispatch(rec.experienceId, dispatchId);
  return { status: "enqueued", dispatchId };
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
  /**
   * The RESOLVED outcome vote for this dispatch's experience (kernel-elevation
   * T1.2). When present, autonomy is earned/lost on THIS — the settled vote that
   * respects the founder's verdict + real consequence — not the raw `success`
   * dispatch boolean. A "pending" vote banks NOTHING (autonomy is never earned on
   * an unresolved action). Absent → falls back to the mechanical `success`.
   */
  vote?: "success" | "failure" | "pending";
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

/**
 * CP3 of Jarvis Phase 1 — HONEST dispatch→domain mapping for trust-ledger
 * evidence. Returns the domain ONLY when the dispatch is autopilot-initiated
 * AND its move-kind carries an explicit binding; anything else returns null.
 * Deliberately does NOT route through bindingFor()'s fail-closed
 * DEFAULT_BINDING — that default exists to make an UNKNOWN move maximally
 * gated, not to let an unknown move's verification verdict credit or charge
 * the 'ops' domain. A dispatch that carries no honest domain contributes no
 * trust evidence (the caller skips with a debug log).
 */
export function domainForDispatch(d: { sourceType: string; sourceId: string }): AutopilotDomain | null {
  if (!isAutopilotDispatch(d)) return null;
  const moveKind = d.sourceId.slice(AUTOPILOT_SOURCE_PREFIX.length);
  if (!isKnownMoveKind(moveKind)) return null;
  return MOVE_BINDINGS[moveKind].domain;
}

export async function applyAutonomyFeedback(
  d: DispatchOutcomeForFeedback,
  deps: Partial<AutonomyFeedbackDeps> = {},
): Promise<{ applied: boolean; domain?: AutopilotDomain; effect?: "clean" | "anomaly" }> {
  if (!isAutopilotDispatch(d)) return { applied: false };
  const dd = { ...defaultFeedbackDeps, ...deps };
  const moveKind = d.sourceId.slice(AUTOPILOT_SOURCE_PREFIX.length);
  const domain = bindingFor(moveKind).domain;

  // Earn/lose autonomy on the RESOLVED vote, not the raw dispatch boolean (T1.2).
  // A "pending" vote (no real signal yet) banks NOTHING — autonomy is never
  // earned on an unresolved action. Absent vote → fall back to the mechanical
  // success (the legacy behavior, still pending-safe).
  const vote = d.vote ?? (d.success ? "success" : "failure");
  if (vote === "pending") {
    return { applied: false, domain };
  }
  if (vote === "success") {
    await dd.recordCleanCycle(domain);
    return { applied: true, domain, effect: "clean" };
  }
  await dd.recordAnomaly(domain, `autopilot action resolved to failure (${d.terminationReason ?? "consequence/verdict"})`);
  return { applied: true, domain, effect: "anomaly" };
}
