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
import type { HandSpec, HandSchema } from "./types";
import { logger } from "../../../utils/logger";

const REGISTRY = new Map<string, HandSpec>();

/** Register a hand. Idempotent: re-registering the same name replaces it. */
export function registerHand(spec: HandSpec): void {
  if (spec.name !== spec.schema.name) {
    throw new Error(
      `hand name mismatch: spec.name=${spec.name} schema.name=${spec.schema.name}`,
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

/** TEST-ONLY: clear the registry. Not exported through the index. */
export function __resetHandsForTest(): void {
  REGISTRY.clear();
}
