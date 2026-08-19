/**
 * server/services/appIntents/intentScopes.ts — WHICH DOOR AND WHICH SCOPE.
 *
 * Extracted from `catalog.ts` on 2026-08-19 so `ai/tools.ts` can ENFORCE the
 * scope each intent declares. It could not before: `catalog.ts` imports
 * `executeTool` from `tools.ts`, so `tools.ts` importing `catalog.ts` back
 * would be a cycle, and the declarations sat in a module the chokepoint could
 * not see. That is the whole reason `requiredScope` was authoritative-looking
 * and enforced nowhere on the Pax path — the second law in CLAUDE.md, one more
 * time: authoritative semantics without production adoption is not canonical.
 *
 * This module imports TYPES ONLY, so it is a leaf and both sides can have it.
 * There is exactly one table; `catalog.ts` registers from it and
 * `ai/tools.ts` gates on it.
 */
import type { Scope } from "../../middleware/roleScope";
import type { CustomerDoor } from "./registry";

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
export const INTENT_META: Record<string, { door: CustomerDoor; scope: Scope | null }> = {
  // ── Today ──────────────────────────────────────────────────────────────
  get_system_context: { door: "today", scope: null },
  get_dashboard_stats: { door: "today", scope: null },
  get_tasks: { door: "today", scope: null },
  create_task: { door: "today", scope: "deal_write" },
  update_task: { door: "today", scope: "deal_write" },
  complete_task: { door: "today", scope: "deal_write" },
  schedule_followup: { door: "today", scope: "deal_write" },
  schedule_follow_up: { door: "today", scope: "deal_write" },
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
  // tenant_pii_write, NOT deal_read — corrected 2026-08-19. The SAME operation
  // through its REST door (`POST /api/skip-traces`, routes-leads.ts) requires
  // `tenant_pii_write` plus a purpose, a justification and a current FCRA
  // §1681b(a)(3)(F) attestation, and persists a `skip_traces` row explicitly
  // for "class-action defense audit trail". Declared here as `deal_read`, the
  // weakest scope in the ladder, it was reachable by `member`, `va`, `viewer`
  // and `intern` — none of whom hold `tenant_pii_write`. A consumer-report
  // lookup is not a deal read. (Pax refuses this tool outright regardless; see
  // the FCRA gate in ai/tools.ts. The scope is corrected because the
  // declaration is read by more than one consumer and must be true.)
  batch_leads_skip_trace: { door: "map", scope: "tenant_pii_write" },
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
 * Scopes that carry consumer-report / tenant-PII authority. A caller the tool
 * chokepoint cannot IDENTIFY is refused these outright — the other scopes fall
 * back to "an org-level automation may act as the org", which is wrong for PII
 * and fine for a lead status update.
 */
export const PII_SCOPES: ReadonlySet<Scope> = new Set<Scope>([
  "tenant_pii_read",
  "tenant_pii_write",
]);

/** The scope an intent declares, or null when it needs none. */
export function scopeForIntent(name: string): Scope | null {
  return INTENT_META[name]?.scope ?? null;
}
