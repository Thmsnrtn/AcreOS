/**
 * Strategic Compass — Sovereign Company Protocol v4
 *
 * The CEO sets company-wide priorities ("focus on keeping customers")
 * and ALL agents incorporate them into their decision-making.
 *
 * Priorities are injected into every agent's system prompt, so when
 * the CEO says "retention is priority #1", Sophie checks in more often,
 * Forge watches churn harder, and Beacon shifts to retention campaigns.
 */

import { db } from "../db";
import { companyPriorities } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { logger } from "../utils/logger";

/**
 * Get all active company priorities, ordered by weight.
 */
export async function getActivePriorities(): Promise<Array<{
  id: number;
  priority: string;
  description: string | null;
  weight: number;
}>> {
  return db.select({
    id: companyPriorities.id,
    priority: companyPriorities.priority,
    description: companyPriorities.description,
    weight: companyPriorities.weight,
  })
    .from(companyPriorities)
    .where(eq(companyPriorities.isActive, true))
    .orderBy(desc(companyPriorities.weight));
}

/**
 * Create a new company priority.
 */
export async function createPriority(params: {
  priority: string;
  description?: string;
  weight?: number;
  setBy?: string;
}): Promise<number> {
  const [row] = await db.insert(companyPriorities).values({
    priority: params.priority,
    description: params.description,
    weight: params.weight || 5,
    setBy: params.setBy || "ceo",
  }).returning({ id: companyPriorities.id });

  logger.info(`[StrategicCompass] New priority: "${params.priority}" (weight: ${params.weight || 5})`);
  return row.id;
}

/**
 * Deactivate a priority.
 */
export async function deactivatePriority(id: number): Promise<void> {
  await db.update(companyPriorities)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(companyPriorities.id, id));
}

/**
 * Update a priority's weight.
 */
export async function updatePriorityWeight(id: number, weight: number): Promise<void> {
  await db.update(companyPriorities)
    .set({ weight: Math.max(1, Math.min(10, weight)), updatedAt: new Date() })
    .where(eq(companyPriorities.id, id));
}

/**
 * Format priorities into a prompt section for injection into agent system prompts.
 * This is the core mechanism: every agent reads this before making decisions.
 */
export async function getPrioritiesForPrompt(): Promise<string> {
  const priorities = await getActivePriorities();

  if (priorities.length === 0) return "";

  const lines = priorities.map((p, i) => {
    const stars = "★".repeat(Math.min(p.weight, 5));
    return `${i + 1}. ${p.priority} ${stars}${p.description ? ` — ${p.description}` : ""}`;
  });

  return `\n--- CEO STRATEGIC PRIORITIES ---\nThe CEO has set these company-wide priorities. Factor them into every decision:\n${lines.join("\n")}\nAlways align your recommendations and actions with these priorities.\n`;
}

export const strategicCompassService = {
  getActivePriorities,
  createPriority,
  deactivatePriority,
  updatePriorityWeight,
  getPrioritiesForPrompt,
};
