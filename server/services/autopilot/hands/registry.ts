/**
 * Founder Autopilot — Hand registry (Hands roadmap P0.1).
 *
 * The single place hands are registered and looked up. The dispatch executor
 * consults this in its switch default; the dispatch runner appends the hand
 * schemas to the model's tool list. Empty until a phase registers a hand, so a
 * fresh registry is fully inert (zero new tools, zero new behavior).
 *
 * Registration is idempotent + validated (name must match schema.name). A hand
 * that requires approval is allowed to register, but the executor will refuse to
 * run it directly — that's the witnessed-send wall, enforced at the executor.
 */
import type { HandSpec, HandSchema, HandResult, HandContext } from "./types";
import { logger } from "../../../utils/logger";

const REGISTRY = new Map<string, HandSpec>();

/**
 * Money/broadcast/customer-facing hands MUST be witnessed-send. Enforced at
 * REGISTRATION (re-audit iteration 2) so it is structurally impossible to ship
 * an un-witnessed money hand — not merely caught by a test. A finance-domain
 * hand, an explicit `movesMoney` hand, a customer-facing hand, or a public
 * `broadcast` hand that registers with `requiresApproval:false` throws on boot.
 */
export function requiresWitnessByInvariant(spec: HandSpec): boolean {
  return (
    spec.domain === "finance" ||
    spec.movesMoney === true ||
    spec.isCustomerFacing === true ||
    spec.outwardClass === "broadcast"
  );
}

/** Register a hand. Idempotent: re-registering the same name replaces it. */
export function registerHand(spec: HandSpec): void {
  if (spec.name !== spec.schema.name) {
    throw new Error(
      `hand name mismatch: spec.name=${spec.name} schema.name=${spec.schema.name}`,
    );
  }
  if (requiresWitnessByInvariant(spec) && !spec.requiresApproval) {
    throw new Error(
      `[autopilot/hands] refusing to register '${spec.name}': it moves money / is ` +
        `customer-facing / broadcasts (domain=${spec.domain}, movesMoney=${!!spec.movesMoney}, ` +
        `customerFacing=${spec.isCustomerFacing}, outwardClass=${spec.outwardClass ?? "none"}) ` +
        `but requiresApproval=false. Such hands MUST be witnessed-send.`,
    );
  }
  if (REGISTRY.has(spec.name)) {
    logger.warn(`[autopilot/hands] re-registering hand ${spec.name}`);
  }
  REGISTRY.set(spec.name, spec);
}

/** Look up a hand spec by tool name. */
export function getHand(name: string): HandSpec | undefined {
  return REGISTRY.get(name);
}

export function isHandName(name: string): boolean {
  return REGISTRY.has(name);
}

/** All registered hand specs (for introspection / tests). */
export function listHandSpecs(): HandSpec[] {
  return [...REGISTRY.values()];
}

/** The model-facing schemas for every registered hand. */
export function listHandSchemas(): HandSchema[] {
  return [...REGISTRY.values()].map((h) => h.schema);
}

/**
 * Privileged witnessed-execution entrypoint (Hands roadmap P1).
 *
 * This is the ONLY path that may run an approval-required hand. It is called
 * exclusively by the founder-approval flow AFTER a human has tapped Approve on
 * the witnessed-send ask — never by a model tool-call (the executor refuses
 * those). The `witnessedBy` argument is the founder's user id, recorded for the
 * audit trail; calling this without it is a programming error and is refused.
 *
 * The separation is the whole safety story: model → executor → REFUSED;
 * founder tap → approval flow → executeHandWitnessed → the real send.
 */
export async function executeHandWitnessed(
  name: string,
  input: Record<string, unknown>,
  witnessedBy: string,
  ctx: HandContext = {},
): Promise<HandResult> {
  const started = Date.now();
  const hand = getHand(name);
  if (!hand) {
    return { success: false, output: `unknown hand: ${name}`, durationMs: Date.now() - started };
  }
  if (!witnessedBy || !witnessedBy.trim()) {
    return {
      success: false,
      output: `[WITNESSED-SEND] ${name} refused: missing witnessing founder identity. A witnessed send requires a real approver.`,
      durationMs: Date.now() - started,
    };
  }
  logger.info(`[autopilot/hands] witnessed execution of ${name} approved by ${witnessedBy}`);
  return hand.handler(input, ctx);
}

/** TEST-ONLY: clear the registry. Not exported through the index. */
export function __resetHandsForTest(): void {
  REGISTRY.clear();
}
