/**
 * Founder Autopilot — Hand harness types (Hands roadmap P0.1).
 *
 * A "hand" is a governed outward action the dispatched agent can take — sending
 * an email, retrying a failed charge, running an ad. Each hand is a small,
 * individually-reviewable, individually-gateable unit: a tool schema (what the
 * model sees) + a thin handler that calls an EXISTING service (never new send
 * logic) + the governance metadata the policy gate and witnessed-send wall need.
 *
 * The harness keeps the dispatch executor from growing an N-case switch and
 * gives every hand a uniform safety contract. Phase 0 ships the registry EMPTY;
 * later phases register hands into it.
 *
 * Types are deliberately structural (no import from the executor) so hand
 * modules can depend on these without creating an import cycle with the executor
 * that consumes them.
 */
import type { AutopilotDomain } from "../policyGate";
import type { ProofReceipt } from "../proofReceipt";

/** Result of a hand invocation — structurally matches the executor's ToolExecutionResult. */
export interface HandResult {
  success: boolean;
  output: string;
  durationMs: number;
  filesModified?: string[];
  /**
   * The tamper-evident proof-receipt for a WITNESSED execution (Foundry move #3).
   * Present only on the witnessed-send path (executeHandWitnessed); direct/refused
   * calls never produce one, since no governed action occurred.
   */
  receipt?: ProofReceipt;
}

/** Execution context threaded from the dispatch (identity for audit + consent). */
export interface HandContext {
  dispatchId?: number | null;
  agentRole?: string;
}

export type HandHandler = (
  input: Record<string, unknown>,
  ctx: HandContext,
) => Promise<HandResult>;

/** An Anthropic-style tool schema the model is shown. */
export interface HandSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * The full specification of a hand: what the model sees + how it's governed +
 * what it actually does.
 */
export interface HandSpec {
  /** Must equal schema.name. The tool name the model calls. */
  name: string;
  schema: HandSchema;
  /** The autopilot domain this hand belongs to (gates per-domain autonomy). */
  domain: AutopilotDomain;
  /** Touches a customer's comms/assets → witnessed-send (human tap) required. */
  isCustomerFacing: boolean;
  /**
   * Spends or moves money (a charge, refund, retry, ad spend). Distinct from
   * `domain==="finance"` because a GROWTH hand can spend (ad budget) without
   * being finance-domain. Any money hand is witnessed-send by invariant — money
   * never moves without a founder tap. (re-audit iteration 2)
   */
  movesMoney?: boolean;
  /** Public broadcast (brand-attached, crawler-indexed) → also needs a tap. */
  outwardClass?: "none" | "broadcast";
  /**
   * If true, the executor REFUSES to run this hand directly from a model
   * tool-call. The only legitimate path is planAndAct → witnessed-send founder
   * ask → a separate founder-witnessed execution. This is the executor-layer
   * half of the "no path from model→send bypasses the tap" invariant.
   */
  requiresApproval: boolean;
  /** The craft surface, for craftStandardPrompt + eval grounding. */
  surface: string;
  /** The thin adapter that calls the existing service. */
  handler: HandHandler;
}

/** Helper for hand modules: a uniform error result. */
export function handError(name: string, err: unknown, started: number): HandResult {
  return {
    success: false,
    output: `Error: ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
    durationMs: Date.now() - started,
  };
}
