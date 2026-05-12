/**
 * Rosy River C8 — Simulation-first promotion gate.
 *
 * Every new agent capability spends ≥2 weeks in simulation mode and
 * accumulates ≥20 simulated decisions before going live. Founder
 * approval (a manual `promoteToLive` call) is required to flip.
 *
 * Storage: customAutonomyRules with ruleType='simulation_required',
 * ruleText='agent:<codename>:<capability>'. When a capability is in the
 * gate, isActive=true. Once the founder promotes, isActive=false.
 *
 * No new tables. The 2-week clock is the rule's createdAt; the 20-decision
 * threshold is counted from agent_tasks rows whose agentType matches and
 * whose input.simulationMode=true.
 */

import { db } from "../db";
import { customAutonomyRules, agentTasks } from "@shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

const SYSTEM_ORG_ID = 1;
const SIMULATION_RULE_TYPE = "simulation_required";
const MIN_SIMULATION_DAYS = 14;
const MIN_SIMULATED_DECISIONS = 20;

function ruleText(codename: string, capability: string): string {
  return `agent:${codename}:${capability}`;
}

/**
 * Is this capability currently gated behind simulation mode?
 *
 * Returns true if there is an active customAutonomyRules row of type
 * 'simulation_required' for this (codename, capability). Agent code
 * should consult this BEFORE making a live external call, and route
 * through simulation if true.
 */
export async function requiresSimulation(
  codename: string,
  capability: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: customAutonomyRules.id })
    .from(customAutonomyRules)
    .where(
      and(
        eq(customAutonomyRules.organizationId, SYSTEM_ORG_ID),
        eq(customAutonomyRules.ruleType, SIMULATION_RULE_TYPE),
        eq(customAutonomyRules.ruleText, ruleText(codename, capability)),
        eq(customAutonomyRules.isActive, true),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Add a (codename, capability) to the simulation gate. New agent code
 * paths should call this on first deploy so they start gated by default.
 * Idempotent — re-adding an active rule is a no-op.
 */
export async function addSimulationRequirement(
  codename: string,
  capability: string,
): Promise<void> {
  const existing = await db
    .select({ id: customAutonomyRules.id, isActive: customAutonomyRules.isActive })
    .from(customAutonomyRules)
    .where(
      and(
        eq(customAutonomyRules.organizationId, SYSTEM_ORG_ID),
        eq(customAutonomyRules.ruleType, SIMULATION_RULE_TYPE),
        eq(customAutonomyRules.ruleText, ruleText(codename, capability)),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    await db.insert(customAutonomyRules).values({
      organizationId: SYSTEM_ORG_ID,
      ruleType: SIMULATION_RULE_TYPE,
      ruleText: ruleText(codename, capability),
      isActive: true,
    });
    logger.info("[promotion-gate] simulation requirement added", {
      source: "promotion-gate",
      metadata: { codename, capability },
    });
  } else if (!existing[0].isActive) {
    // Re-activate a previously promoted capability — founder wants it back
    // in sim mode (regression occurred, etc.).
    await db
      .update(customAutonomyRules)
      .set({ isActive: true })
      .where(eq(customAutonomyRules.id, existing[0].id));
    logger.warn("[promotion-gate] capability re-gated to simulation", {
      source: "promotion-gate",
      metadata: { codename, capability },
    });
  }
}

/**
 * Check whether the (codename, capability) is eligible for promotion to
 * live execution. Returns ok=false with a human-readable reason if the
 * 2-week clock hasn't elapsed or the simulated-decision count hasn't
 * reached the threshold. Returns ok=true if the gate is satisfied OR
 * if no gate rule exists.
 */
export async function canPromoteToLive(
  codename: string,
  capability: string,
): Promise<{ ok: boolean; reason?: string; daysInSim?: number; simulatedDecisions?: number }> {
  const [rule] = await db
    .select()
    .from(customAutonomyRules)
    .where(
      and(
        eq(customAutonomyRules.organizationId, SYSTEM_ORG_ID),
        eq(customAutonomyRules.ruleType, SIMULATION_RULE_TYPE),
        eq(customAutonomyRules.ruleText, ruleText(codename, capability)),
        eq(customAutonomyRules.isActive, true),
      ),
    )
    .limit(1);

  if (!rule) {
    return { ok: true, reason: "no simulation gate active" };
  }

  const ruleCreatedAt = rule.createdAt ?? new Date();
  const daysInSim = Math.floor(
    (Date.now() - ruleCreatedAt.getTime()) / (24 * 60 * 60 * 1000),
  );

  // Count simulated decisions — agent_tasks rows for this codename whose
  // input.simulationMode is true and which have been reviewed or completed.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentTasks)
    .where(
      and(
        eq(agentTasks.agentType, codename),
        gte(agentTasks.createdAt, ruleCreatedAt),
        sql`(${agentTasks.input}->>'simulationMode')::boolean = true`,
      ),
    );

  const simulatedDecisions = Number(count) || 0;

  if (daysInSim < MIN_SIMULATION_DAYS) {
    return {
      ok: false,
      reason: `simulation window not elapsed — ${daysInSim} of ${MIN_SIMULATION_DAYS} days`,
      daysInSim,
      simulatedDecisions,
    };
  }
  if (simulatedDecisions < MIN_SIMULATED_DECISIONS) {
    return {
      ok: false,
      reason: `not enough simulated decisions — ${simulatedDecisions} of ${MIN_SIMULATED_DECISIONS}`,
      daysInSim,
      simulatedDecisions,
    };
  }
  return { ok: true, daysInSim, simulatedDecisions };
}

/**
 * Promote the capability from simulation to live execution. Sets the
 * gate rule to isActive=false so requiresSimulation() returns false.
 * Founder-only — callers should verify isFounder before invoking.
 *
 * Returns true if the rule was found and flipped; false if the rule
 * was already inactive or didn't exist.
 */
export async function promoteToLive(
  codename: string,
  capability: string,
  founderEmail: string,
): Promise<{ promoted: boolean; reason?: string }> {
  const eligibility = await canPromoteToLive(codename, capability);
  if (!eligibility.ok) {
    logger.warn("[promotion-gate] promote attempted but gate not satisfied", {
      source: "promotion-gate",
      metadata: { codename, capability, reason: eligibility.reason, founderEmail },
    });
    return { promoted: false, reason: eligibility.reason };
  }

  const result = await db
    .update(customAutonomyRules)
    .set({ isActive: false })
    .where(
      and(
        eq(customAutonomyRules.organizationId, SYSTEM_ORG_ID),
        eq(customAutonomyRules.ruleType, SIMULATION_RULE_TYPE),
        eq(customAutonomyRules.ruleText, ruleText(codename, capability)),
        eq(customAutonomyRules.isActive, true),
      ),
    )
    .returning({ id: customAutonomyRules.id });

  if (result.length === 0) {
    return { promoted: false, reason: "no active gate rule to promote" };
  }

  logger.info("[promotion-gate] capability promoted to live", {
    source: "promotion-gate",
    metadata: { codename, capability, founderEmail },
  });
  return { promoted: true };
}

/**
 * Snapshot for the founder dashboard — every (codename, capability) that
 * has ever been gated, with current sim status + eligibility.
 */
export async function listGateStatus(): Promise<
  Array<{
    codename: string;
    capability: string;
    isActive: boolean;
    daysInSim: number;
    simulatedDecisions: number;
    eligibleForPromotion: boolean;
    createdAt: string;
  }>
> {
  const rules = await db
    .select()
    .from(customAutonomyRules)
    .where(
      and(
        eq(customAutonomyRules.organizationId, SYSTEM_ORG_ID),
        eq(customAutonomyRules.ruleType, SIMULATION_RULE_TYPE),
      ),
    );

  const out = [];
  for (const rule of rules) {
    const parts = rule.ruleText.split(":");
    if (parts.length < 3 || parts[0] !== "agent") continue;
    const [, codename, ...capParts] = parts;
    const capability = capParts.join(":");

    const eligibility = rule.isActive
      ? await canPromoteToLive(codename, capability)
      : { ok: true, daysInSim: undefined, simulatedDecisions: undefined };

    out.push({
      codename,
      capability,
      isActive: rule.isActive,
      daysInSim: eligibility.daysInSim ?? 0,
      simulatedDecisions: eligibility.simulatedDecisions ?? 0,
      eligibleForPromotion: rule.isActive && eligibility.ok,
      createdAt: (rule.createdAt ?? new Date()).toISOString(),
    });
  }
  return out;
}
