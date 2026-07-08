/**
 * Founder Autopilot — the composed Policy Gate Stack.
 *
 * P0 batch 2. The plan's load-bearing safety abstraction: ONE ordered choke
 * point that every autopilot-initiated outward action passes before it can
 * execute. It does NOT reimplement any gate — it COMPOSES the gates that
 * already exist, in order:
 *
 *   1. Compliance / constitution  → solene/constitutionalGuard.screenToolCall
 *   2. Quality / grounding        → aiEvalHarness.gateOutputOrThrow
 *   3. Budget                     → aiCostCeiling.assertWithinAiCostCeiling
 *   4. Autonomy level (per-domain)→ injected (batch 3 wires the state machine)
 *   5. Witnessed-send (customer)  → approvalKernel set (human tap required)
 *
 * Harmony notes:
 * - This is the gate for AUTOPILOT ACTIONS (a growth send, an ad spend, a
 *   support reply the engines initiate). It is NOT a replacement for the
 *   per-tool constitutional screen that already runs inside dispatch tool
 *   execution — that still fires for every tool call within a running dispatch.
 *   The stack is the single, reusable entry point the Pillar B/C engines call
 *   before any outward effect, so policy lives in one composable place.
 * - Gates are injected (deps) with real defaults, so the composition is fully
 *   unit-testable without a DB or live services.
 * - A gate whose payload is absent is SKIPPED (e.g. no `output` → no eval gate),
 *   not silently passed-as-checked — the result records `skipped`.
 *
 * Decision semantics: the stack runs gates in order and SHORT-CIRCUITS on the
 * first non-pass. `block` (compliance/eval/budget/autonomy fail) and `escalate`
 * (customer-facing → needs the human-tap kernel) are both terminal; everything
 * else is `pass`.
 */
import { screenToolCall as realScreenToolCall } from "../solene/constitutionalGuard";
import { assertWithinAiCostCeiling as realAssertCostCeiling } from "../aiCostCeiling";
import { gateOutputOrThrow as realGateOutputOrThrow } from "../aiEvalHarness";
import { APPROVAL_REQUIRED_TOOLS as realApprovalRequiredTools } from "../approvalKernel";
import { checkDomainAutonomyGate as realCheckDomainAutonomy } from "./domainAutonomy";
import { type TenantScope, scopeOrgId, assertOutwardScope } from "./tenantScope";

export type AutopilotDomain = "growth" | "support" | "deploy" | "ops" | "finance";
export type GateStatus = "pass" | "block" | "escalate" | "skipped";

/** The action an autopilot engine wants to take, with optional per-gate payloads. */
export interface PolicyAction {
  domain: AutopilotDomain;
  /** Free-form action kind for audit, e.g. "send_email" | "run_ads" | "reply_ticket". */
  actionKind: string;
  /**
   * The accountable scope of this action — `PLATFORM_SCOPE` when the autopilot
   * operates AcreOS itself, an `orgScope(id)` when acting for a customer org.
   * Replaces the old overloaded `orgId: number | null` (where null meant both
   * "platform" and "unscoped"). An outward action with a malformed scope is a
   * hard error (assertOutwardScope), never a silent platform default.
   */
  scope: TenantScope;
  /** Touches a CUSTOMER's assets/comms → witnessed-send (human tap) required. */
  isCustomerFacing: boolean;
  /**
   * The kind of outward effect. A `broadcast` (publishing to a public, crawler-
   * indexed, brand-attached surface) ALWAYS needs a human tap even though it
   * isn't aimed at one customer — closing the laundering hole where a public
   * broadcast classified non-customer-facing skipped witnessed-send entirely.
   */
  outwardClass?: "none" | "broadcast";
  /** Present → run the constitution gate against this tool call. */
  toolCall?: { dispatchId: number | null; toolName: string; toolInput: Record<string, unknown>; agentRole: string };
  /** Present → run the eval/grounding gate against this generated text. */
  output?: { surface: string; modelKey: string; text: string };
  /** Optional: the tool name to check against the witnessed-send approval set. */
  approvalToolName?: string;
}

export interface GateResult {
  gate: "compliance" | "quality" | "budget" | "autonomy" | "witnessed_send";
  status: GateStatus;
  reason?: string;
}

export interface PolicyGateDecision {
  decision: Exclude<GateStatus, "skipped">;
  results: GateResult[];
  /** The gate that produced the terminal decision (block/escalate), if any. */
  decidedBy?: GateResult["gate"];
}

/** Injectable dependencies — real implementations by default; stubbed in tests. */
export interface PolicyGateDeps {
  screenToolCall: typeof realScreenToolCall;
  assertWithinAiCostCeiling: (orgId: number | null) => Promise<void>;
  gateOutputOrThrow: (opts: { surface: string; modelKey: string; output: string }) => Promise<void>;
  approvalRequiredTools: ReadonlySet<string>;
  /**
   * Per-domain autonomy gate — the earned-autonomy state machine (batch 3).
   * Defaults to the real Trust-Ledger gate, which fails SAFE: an unseeded /
   * OBSERVE-level domain blocks, so no outward action escapes the ladder.
   */
  checkDomainAutonomy: (action: PolicyAction) => Promise<GateResult>;
  /**
   * Per-gate deadline (ms). A gate that hangs (a wedged LLM call, a stuck DB
   * read) must not stall — or silently bypass — the safety floor; on timeout the
   * gate FAILS CLOSED to its safe terminal verdict (kernel-elevation T0.2). 0 or
   * non-finite disables the deadline. Tests set a tiny value to exercise it.
   */
  gateTimeoutMs: number;
}

/** Thrown when a gate exceeds its deadline; handled as a fail-closed block. */
class GateTimeoutError extends Error {}

/** Race a gate call against its deadline. Rejects on timeout so the gate's
 *  fail-closed catch turns it into a block. A non-positive ms disables it. */
function withGateDeadline<T>(p: Promise<T>, ms: number, gate: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new GateTimeoutError(`${gate} gate timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

const defaultDeps: PolicyGateDeps = {
  screenToolCall: realScreenToolCall,
  // Fail CLOSED: this gate stands in front of every autopilot outward action, so
  // a telemetry-read outage must REFUSE (block the action), never wave it through
  // un-metered. Pass failClosed so a cost-ceiling read failure throws → budget gate
  // blocks, rather than the default fail-open that's correct for interactive paths.
  assertWithinAiCostCeiling: (orgId) => realAssertCostCeiling(orgId, { failClosed: true }),
  gateOutputOrThrow: realGateOutputOrThrow,
  approvalRequiredTools: realApprovalRequiredTools,
  checkDomainAutonomy: realCheckDomainAutonomy,
  gateTimeoutMs: 20_000,
};

/**
 * Run an autopilot action through the composed gate stack. Returns the terminal
 * decision (pass | block | escalate) plus the per-gate audit trail.
 */
export async function runPolicyGateStack(
  action: PolicyAction,
  deps: Partial<PolicyGateDeps> = {},
): Promise<PolicyGateDecision> {
  const d: PolicyGateDeps = { ...defaultDeps, ...deps };
  const results: GateResult[] = [];

  // Invariant (Foundry move #2): any potentially-OUTWARD action must carry a
  // well-formed accountable scope before any gate runs. platform scope is
  // legitimate (AcreOS operating itself); a bare/corrupt scope throws — the
  // typed replacement for the old "orgId=null could mean unscoped" ambiguity.
  const isOutward =
    action.isCustomerFacing || action.outwardClass === "broadcast" || action.approvalToolName != null;
  if (isOutward) assertOutwardScope(action.scope, action.actionKind);

  const terminate = (r: GateResult): PolicyGateDecision => {
    results.push(r);
    return { decision: r.status === "escalate" ? "escalate" : "block", results, decidedBy: r.gate };
  };

  // Every gate FAILS CLOSED (T0.2): an error OR a deadline timeout terminates to
  // the gate's safe verdict — never a silent pass. A wedged dependency must
  // refuse the action, not bypass the floor.

  // 1. Compliance / constitution
  if (action.toolCall) {
    try {
      const screen = await withGateDeadline(d.screenToolCall(action.toolCall), d.gateTimeoutMs, "compliance");
      if (!screen.allowed) {
        return terminate({ gate: "compliance", status: "block", reason: screen.reason });
      }
      results.push({ gate: "compliance", status: "pass" });
    } catch (err) {
      return terminate({
        gate: "compliance",
        status: "block",
        reason: err instanceof Error ? err.message : "compliance gate failed",
      });
    }
  } else {
    results.push({ gate: "compliance", status: "skipped" });
  }

  // 2. Quality / grounding
  if (action.output) {
    try {
      await withGateDeadline(
        d.gateOutputOrThrow({
          surface: action.output.surface,
          modelKey: action.output.modelKey,
          output: action.output.text,
        }),
        d.gateTimeoutMs,
        "quality",
      );
      results.push({ gate: "quality", status: "pass" });
    } catch (err) {
      return terminate({
        gate: "quality",
        status: "block",
        reason: err instanceof Error ? err.message : "eval gate rejected output",
      });
    }
  } else {
    results.push({ gate: "quality", status: "skipped" });
  }

  // 3. Budget (always runs — the platform envelope applies even at platform scope)
  try {
    await withGateDeadline(d.assertWithinAiCostCeiling(scopeOrgId(action.scope)), d.gateTimeoutMs, "budget");
    results.push({ gate: "budget", status: "pass" });
  } catch (err) {
    return terminate({
      gate: "budget",
      status: "block",
      reason: err instanceof Error ? err.message : "cost ceiling exceeded",
    });
  }

  // 4. Autonomy level (per-domain; batch 3 wires the real state machine)
  let autonomy: GateResult;
  try {
    autonomy = await withGateDeadline(d.checkDomainAutonomy(action), d.gateTimeoutMs, "autonomy");
  } catch (err) {
    return terminate({
      gate: "autonomy",
      status: "block",
      reason: err instanceof Error ? err.message : "autonomy gate failed",
    });
  }
  if (autonomy.status !== "pass") {
    return terminate(autonomy);
  }
  results.push(autonomy);

  // 5. Witnessed-send — any customer-facing action, or any action whose tool is
  // in the approval set, requires a human tap. Terminal `escalate`.
  const needsWitness =
    action.isCustomerFacing ||
    action.outwardClass === "broadcast" ||
    (action.approvalToolName != null && d.approvalRequiredTools.has(action.approvalToolName));
  if (needsWitness) {
    return terminate({
      gate: "witnessed_send",
      status: "escalate",
      reason:
        action.outwardClass === "broadcast"
          ? "public broadcast requires a human tap (witnessed-send) — it can't launder into a lower risk tier"
          : "customer-facing action requires a human tap (witnessed-send)",
    });
  }
  results.push({ gate: "witnessed_send", status: "skipped" });

  return { decision: "pass", results };
}
