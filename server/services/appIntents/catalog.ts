/**
 * Tahoe E8 — App Intent catalog.
 *
 * Registers every customer-facing intent into the App Intent registry. Each
 * entry tags an existing Pax tool with the customer-nav door it lives behind
 * and the permission-ladder scope it requires, then reuses:
 *   - the legacy `toolDefinitions[name].parameters` as its canonical input
 *     schema (raw JSON-schema → guarantees Pax sees byte-identical parameters
 *     to the pre-registry list), and
 *   - the legacy `executeTool` as its handler.
 *
 * This is the migration of ALL existing Pax tools into the registry. New
 * intents (or external-agent-only intents) can instead pass a zod `inputSchema`
 * — the registry converts it to JSON-Schema / Anthropic input_schema via the
 * shared zod→json-schema util.
 *
 * Importing this module performs the registration as a side effect. It is
 * imported by server/services/appIntents/index.ts which is the single mount
 * point the Pax loop reads.
 */
import { toolDefinitions, executeTool, APPROVAL_REQUIRED_TOOLS } from "../../ai/tools";
import type { Scope } from "../../middleware/roleScope";
import { registerIntent, type CustomerDoor } from "./registry";

/**
 * Per-tool metadata the legacy toolDefinitions did not carry: which of the five
 * customer-nav doors the capability lives behind, and which permission-ladder
 * scope it requires (null = read-only / no gate). Approval requirement is read
 * from the existing APPROVAL_REQUIRED_TOOLS set so there is one source of truth
 * for that too.
 *
 * Door assignment follows the five-door content model (CLAUDE.md):
 *   today   — overview, dashboards, tasks, follow-ups, context, memory
 *   map     — properties/parcels, enrichment, comps, research, web/skip-trace
 *   deals   — leads, deals, offers, outreach, MLS, connectors/automation
 *   finance — notes, amortization, cashflow, ROI, Stripe payments
 *   pax     — Pax-native meta capabilities (sub-agents)
 */
const INTENT_META: Record<string, { door: CustomerDoor; scope: Scope | null }> = {
  // ── Today ──────────────────────────────────────────────────────────────
  get_system_context: { door: "today", scope: null },
  get_dashboard_stats: { door: "today", scope: null },
  get_tasks: { door: "today", scope: null },
  create_task: { door: "today", scope: "deal_write" },
  update_task: { door: "today", scope: "deal_write" },
  complete_task: { door: "today", scope: "deal_write" },
  schedule_followup: { door: "today", scope: "deal_write" },
  schedule_follow_up: { door: "today", scope: "deal_write" },
  schedule_background_job: { door: "today", scope: "deal_write" },
  remember_fact: { door: "today", scope: null },
  recall_facts: { door: "today", scope: null },

  // ── Map (properties / parcels / research) ────────────────────────────────
  get_properties: { door: "map", scope: "deal_read" },
  get_property_details: { door: "map", scope: "deal_read" },
  create_property: { door: "map", scope: "deal_write" },
  update_property: { door: "map", scope: "deal_write" },
  extract_properties_from_text: { door: "map", scope: "deal_write" },
  create_properties_batch: { door: "map", scope: "deal_write" },
  research_property: { door: "map", scope: "deal_read" },
  get_property_enrichment: { door: "map", scope: "deal_read" },
  run_comps_analysis: { door: "map", scope: "deal_read" },
  run_comps: { door: "map", scope: "deal_read" },
  browse_web: { door: "map", scope: "deal_read" },
  propstream_lookup: { door: "map", scope: "deal_read" },
  propstream_comps: { door: "map", scope: "deal_read" },
  batch_leads_skip_trace: { door: "map", scope: "deal_read" },
  search_mls_listings: { door: "map", scope: "deal_read" },
  get_mls_comps: { door: "map", scope: "deal_read" },
  search_drive: { door: "map", scope: "deal_read" },
  get_drive_file: { door: "map", scope: "deal_read" },

  // ── Deals (leads / deals / offers / outreach / automation) ───────────────
  get_leads: { door: "deals", scope: "deal_read" },
  get_lead_details: { door: "deals", scope: "deal_read" },
  update_lead_status: { door: "deals", scope: "deal_write" },
  create_lead: { door: "deals", scope: "deal_write" },
  get_pipeline_summary: { door: "deals", scope: "deal_read" },
  get_deals: { door: "deals", scope: "deal_read" },
  create_deal: { door: "deals", scope: "deal_write" },
  update_deal: { door: "deals", scope: "deal_write" },
  generate_offer: { door: "deals", scope: "deal_read" },
  generate_offer_letter: { door: "deals", scope: "deal_write" },
  draft_offer: { door: "deals", scope: "deal_write" },
  get_stale_leads: { door: "deals", scope: "deal_read" },
  draft_outreach_message: { door: "deals", scope: "comms_write" },
  send_email: { door: "deals", scope: "comms_write" },
  send_sms: { door: "deals", scope: "comms_write" },
  search_gmail: { door: "deals", scope: "comms_read" },
  send_gmail: { door: "deals", scope: "comms_write" },
  send_slack_message: { door: "deals", scope: "comms_write" },
  list_calendar_events: { door: "deals", scope: "comms_read" },
  create_calendar_event: { door: "deals", scope: "comms_write" },
  trigger_zapier: { door: "deals", scope: "comms_write" },
  trigger_make: { door: "deals", scope: "comms_write" },

  // ── Finance (notes / amortization / cashflow / ROI / payments) ───────────
  get_notes: { door: "finance", scope: "financial_read" },
  calculate_amortization: { door: "finance", scope: "financial_read" },
  get_cashflow_summary: { door: "finance", scope: "financial_read" },
  calculate_roi: { door: "finance", scope: "financial_read" },
  calculate_payment_schedule: { door: "finance", scope: "financial_read" },
  get_stripe_customer: { door: "finance", scope: "financial_read" },
  list_stripe_payments: { door: "finance", scope: "financial_read" },
  create_stripe_payment_link: { door: "finance", scope: "financial_write" },

  // ── Pax (agent-native meta capabilities) ─────────────────────────────────
  spawn_subagent: { door: "pax", scope: null },
  // Andrei E5 — general land-knowledge retrieval (read-only; no parcel writes).
  retrieve_land_knowledge: { door: "pax", scope: null },
};

/**
 * Register every tool in toolDefinitions as an App Intent. Any tool missing
 * from INTENT_META is registered with a safe default (deals door, deal_read
 * scope) and flagged — this keeps the registry exhaustive even if a new tool
 * is added to toolDefinitions without an explicit door mapping.
 */
let registered = false;

export function registerAllIntents(): void {
  if (registered) return;
  registered = true;

  for (const [name, def] of Object.entries(toolDefinitions)) {
    const meta = INTENT_META[name] ?? { door: "deals" as CustomerDoor, scope: "deal_read" as Scope };
    registerIntent({
      name: def.name ?? name,
      description: def.description ?? "",
      door: meta.door,
      requiredScope: meta.scope,
      approvalRequired: APPROVAL_REQUIRED_TOOLS.has(name),
      // Reuse the legacy JSON-schema parameters verbatim → byte-parity for Pax.
      inputSchema: (def.parameters ?? { type: "object", properties: {} }) as Record<string, unknown>,
      handler: (args, org) => executeTool(name, args, org),
    });
  }
}
