// @ts-nocheck
/**
 * T25 — Atlas Tool Registry (Self-Documenting)
 *
 * Provides:
 *   1. list_available_tools meta-tool — Atlas can call this to discover what
 *      it can do, with usage examples for each tool.
 *   2. Admin endpoint data — `GET /api/admin/atlas-tools` returns all registered
 *      tools with their schemas and recent usage statistics.
 *   3. Tool usage logging — records each Atlas tool call for analytics.
 *
 * Tools are discovered dynamically from the toolDefinitions export in tools.ts.
 */

import { db } from "../db";
import { atlasToolUsage } from "@shared/schema";
import { eq, and, gte, count, desc, sql } from "drizzle-orm";
import { toolDefinitions } from "../ai/tools";

export interface ToolRegistryEntry {
  name: string;
  description: string;
  parameters: Record<string, any>;
  category: string;
  examples: string[];
}

// Category mapping for grouping in admin UI
const TOOL_CATEGORIES: Record<string, string> = {
  get_system_context: "Context",
  get_leads: "CRM",
  get_lead_details: "CRM",
  update_lead: "CRM",
  create_lead: "CRM",
  get_properties: "Properties",
  get_property_details: "Properties",
  lookup_parcel: "Properties",
  enrich_property: "Properties",
  get_deals: "Deals",
  get_deal_details: "Deals",
  create_deal: "Deals",
  update_deal_status: "Deals",
  generate_offer_suggestions: "AI Actions",
  generate_offer_letter: "AI Actions",
  send_email: "Communications",
  send_sms: "Communications",
  get_comparables: "Valuation",
  calculate_avm: "Valuation",
  get_financial_summary: "Finance",
  get_notes: "Finance",
  schedule_task: "Tasks",
  get_tasks: "Tasks",
  complete_task: "Tasks",
  search_leads: "CRM",
  get_campaigns: "Marketing",
  log_activity: "CRM",
};

// Usage examples per tool
const TOOL_EXAMPLES: Record<string, string[]> = {
  get_system_context: ["What does my pipeline look like today?", "Give me a business overview"],
  get_leads: ["Show me all hot leads", "Which leads are in negotiation?"],
  get_lead_details: ["Tell me about John Smith", "What's the history on this lead?"],
  update_lead: ["Mark this lead as contacted", "Update the status to negotiating"],
  generate_offer_suggestions: ["What should I offer for this property?", "Calculate a conservative offer for 50 acres in Texas"],
  generate_offer_letter: ["Draft an offer letter for this deal", "Write a professional offer for this seller"],
  send_email: ["Send a follow-up email to the seller", "Email the offer letter to John"],
  get_comparables: ["Find comps for this property", "What are similar sales near this APN?"],
  calculate_avm: ["What's this property worth?", "Estimate the market value"],
  get_financial_summary: ["What's my portfolio value?", "How much do I have in seller-financed notes?"],
  schedule_task: ["Remind me to follow up in 3 days", "Schedule a call with the seller"],
};

// Build the registry from toolDefinitions
export function buildToolRegistry(): ToolRegistryEntry[] {
  return Object.entries(toolDefinitions).map(([key, def]) => ({
    name: def.name || key,
    description: def.description || "",
    parameters: def.parameters || {},
    category: TOOL_CATEGORIES[key] || "Other",
    examples: TOOL_EXAMPLES[key] || [],
  }));
}

// ─── Meta-tool: list_available_tools ─────────────────────────────────────────

export function getListAvailableToolsDefinition() {
  return {
    name: "list_available_tools",
    description:
      "List all tools available to Atlas, organized by category. Use this when you are unsure what you can do, or when the user asks what Atlas is capable of.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Filter by category (optional). E.g. 'CRM', 'Valuation', 'Communications'",
        },
      },
    },
  };
}

export function executeListAvailableTools(category?: string): string {
  const registry = buildToolRegistry();
  const filtered = category
    ? registry.filter(t => t.category.toLowerCase() === category.toLowerCase())
    : registry;

  const byCategory = new Map<string, ToolRegistryEntry[]>();
  for (const tool of filtered) {
    if (!byCategory.has(tool.category)) byCategory.set(tool.category, []);
    byCategory.get(tool.category)!.push(tool);
  }

  const lines: string[] = ["## Atlas Tool Registry\n"];
  for (const [cat, tools] of byCategory) {
    lines.push(`### ${cat}`);
    for (const t of tools) {
      lines.push(`- **${t.name}**: ${t.description}`);
      if (t.examples.length > 0) {
        lines.push(`  Examples: "${t.examples[0]}"`);
      }
    }
    lines.push("");
  }
  lines.push(`Total: ${filtered.length} tools available.`);
  return lines.join("\n");
}

// ─── Tool usage logging ───────────────────────────────────────────────────────

export async function logToolUsage(
  orgId: number,
  userId: number,
  toolName: string,
  durationMs: number,
  success: boolean
): Promise<void> {
  try {
    await db.insert(atlasToolUsage).values({
      organizationId: orgId,
      userId,
      toolName,
      durationMs,
      success,
      usedAt: new Date(),
    });
  } catch {
    // Non-critical — don't break the tool call if logging fails
  }
}

// ─── Admin stats query ────────────────────────────────────────────────────────

export async function getToolUsageStats(
  orgId: number | null,
  days = 30
): Promise<
  {
    toolName: string;
    callCount: number;
    avgDurationMs: number;
    successRate: number;
    category: string;
  }[]
> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const orgFilter = orgId != null ? eq(atlasToolUsage.organizationId, orgId) : sql`true`;

  const rows = await db
    .select({
      toolName: atlasToolUsage.toolName,
      callCount: count(),
      avgDuration: sql<number>`avg(duration_ms)`,
      successCount: sql<number>`count(*) filter (where success = true)`,
    })
    .from(atlasToolUsage)
    .where(and(orgFilter, gte(atlasToolUsage.usedAt, since)))
    .groupBy(atlasToolUsage.toolName)
    .orderBy(desc(count()));

  return rows.map(r => ({
    toolName: r.toolName,
    callCount: Number(r.callCount),
    avgDurationMs: Math.round(Number(r.avgDuration ?? 0)),
    successRate: r.callCount > 0 ? Number(r.successCount) / Number(r.callCount) : 0,
    category: TOOL_CATEGORIES[r.toolName] || "Other",
  }));
}
