/**
 * Tahoe E8 — App Intent registry: public entry point.
 *
 * Importing this module guarantees the catalog is registered, then re-exports
 * the registry API plus role-scoped helpers the Pax loop uses. This is the
 * single mount point: server/ai/executive.ts (the Pax tool-use loop) imports
 * `getToolsForRoleFromRegistry` from here instead of hand-maintaining a list,
 * so every registered intent is automatically exposed to Pax.
 */
import { registerAllIntents } from "./catalog";
import {
  intentNames,
  getOpenAIToolDefinitions,
  getAnthropicToolDefinitions,
  type AppIntent,
} from "./registry";

// Register the catalog on first import (idempotent).
registerAllIntents();

export {
  getIntent,
  listIntents,
  intentNames,
  intentsByDoor,
  resolveInputSchema,
  registerIntent,
  getAnthropicToolDefinitions,
  getOpenAIToolDefinitions,
  type AppIntent,
  type CustomerDoor,
  type IntentResult,
  type IntentHandler,
} from "./registry";

/**
 * Role → allowed intent names. Mirrors the legacy getToolsForRole role map in
 * server/ai/tools.ts so the migration is parity-preserving. `executive` and
 * `assistant` get the full catalog; other roles get a curated subset.
 */
const CORE = ["get_system_context", "get_dashboard_stats"];
const MEMORY = ["remember_fact", "recall_facts"];

function roleAllowList(role: string): string[] {
  const all = intentNames();
  const map: Record<string, string[]> = {
    executive: all,
    assistant: all,
    acquisitions: [
      ...CORE, ...MEMORY,
      "get_leads", "get_lead_details", "update_lead_status", "create_lead",
      "get_properties", "create_property", "get_deals", "create_deal",
      "get_tasks", "create_task", "get_pipeline_summary", "generate_offer",
      "generate_offer_letter", "send_email", "send_sms", "run_comps_analysis",
      "schedule_followup", "draft_offer", "schedule_follow_up", "run_comps",
      "get_stale_leads", "draft_outreach_message",
    ],
    underwriting: [
      ...CORE, ...MEMORY,
      "get_properties", "get_property_details", "update_property", "get_notes",
      "calculate_amortization", "get_cashflow_summary", "get_deals",
      "update_deal", "run_comps_analysis", "run_comps", "calculate_roi",
      "calculate_payment_schedule", "research_property", "draft_offer",
    ],
    marketing: [
      ...CORE, ...MEMORY,
      "get_leads", "get_properties", "get_pipeline_summary", "create_task",
      "send_email", "send_sms", "get_stale_leads", "draft_outreach_message",
    ],
    research: [
      ...CORE, ...MEMORY,
      "get_properties", "get_property_details", "get_leads", "create_property",
      "update_property", "run_comps_analysis", "run_comps", "research_property",
      "calculate_roi", "browse_web",
    ],
    documents: [
      ...CORE,
      "get_leads", "get_lead_details", "get_properties", "get_property_details",
      "get_notes", "get_deals", "generate_offer_letter", "draft_offer",
    ],
  };
  return map[role] ?? map.executive;
}

/**
 * OpenAI/OpenRouter tool list for a given agent role, sourced from the App
 * Intent registry. This is the function the Pax loop consumes. Drop-in
 * replacement for the legacy getToolsForRole in server/ai/tools.ts.
 */
export function getToolsForRoleFromRegistry(role: string): Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return getOpenAIToolDefinitions(roleAllowList(role));
}

/**
 * Anthropic tool definitions for a given role — for external agents / a
 * future Anthropic-native Pax path. Derived from the same registry.
 */
export function getAnthropicToolsForRoleFromRegistry(role: string): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return getAnthropicToolDefinitions(roleAllowList(role));
}
