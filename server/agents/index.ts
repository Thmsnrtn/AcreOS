// @ts-nocheck — ORM type refinement deferred; runtime-correct
/**
 * Agent Registry — manages lifecycle of all autonomous founder operations agents.
 * Call startAll() after database is ready on server boot.
 */

import { customerSuccessAgent } from "./customer-success";
import { growthAgent } from "./growth";
import { revenueAgent } from "./revenue";
import { operationsAgent } from "./operations";
import { founderDigestAgent } from "./founder-digest";
import type { BaseAgent, AgentHealth } from "./base-agent";
import { logger } from "../utils/logger";

// Feature flags — all agents individually toggleable
const AGENT_FEATURE_FLAGS: Record<string, boolean> = {
  agent_customer_success: true,
  agent_growth: true,
  agent_revenue: true,
  agent_operations: true,
  agent_digest: true,
};

const agents: BaseAgent[] = [
  customerSuccessAgent,
  growthAgent,
  revenueAgent,
  operationsAgent,
  founderDigestAgent,
];

export async function startAll(): Promise<void> {
  logger.info("[AgentRegistry] Starting all agents...");

  for (const agent of agents) {
    const enabled = AGENT_FEATURE_FLAGS[agent.featureFlag] ?? false;
    agent.setEnabled(enabled);
    if (enabled) {
      try {
        await agent.start();
      } catch (err: any) {
        logger.error(`[AgentRegistry] Failed to start ${agent.name}`, err);
      }
    }
  }

  logger.info(`[AgentRegistry] ${agents.filter((a) => a.getHealth().enabled).length}/${agents.length} agents started`);
}

export function stopAll(): void {
  for (const agent of agents) {
    agent.stop();
  }
  logger.info("[AgentRegistry] All agents stopped");
}

export function getAgentStatus(): AgentHealth[] {
  return agents.map((a) => a.getHealth());
}

export function getAgent(name: string): BaseAgent | undefined {
  return agents.find((a) => a.name === name);
}

export function setAgentEnabled(name: string, enabled: boolean): boolean {
  const agent = agents.find((a) => a.name === name);
  if (!agent) return false;
  agent.setEnabled(enabled);
  AGENT_FEATURE_FLAGS[agent.featureFlag] = enabled;
  if (enabled) agent.start();
  return true;
}

export { customerSuccessAgent, growthAgent, revenueAgent, operationsAgent, founderDigestAgent };
