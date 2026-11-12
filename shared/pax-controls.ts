/**
 * Pax controls — the machine-readable registries behind "Two Stances, One
 * Pause, One Queue" (docs/autonomous/AUTONOMY_SPEC.md §2, §4.2, §4.4, §4.5).
 *
 * This file holds the POPULATIONS the page renders from and the ratchets
 * read from, so that both are looking at the same list:
 *
 *   OFFERED_STANCES / STANCE_RULINGS   what a customer may choose, and the
 *                                      dated founder ruling each rests on
 *   PAX_CONTROLS_DEFAULTS              what a NULL column means (= today)
 *   UNATTENDED_PATHS                   every place Pax or a rule acts without
 *                                      a tap — what Pause stops, row by row
 *   PARKED_STATES                      where "Waiting for your tap" reads from
 *   ALWAYS_ASK_SUPPORT_TOOLS           support fixes that freeze at EVERY stance
 *   PAX_TOOL_GROUPS                    tool → capability group, for both
 *                                      dispatch switches (tools.ts and
 *                                      supportAgent.ts)
 *
 * Widening OFFERED_STANCES is the ONE lever for "Pax-written messages ever
 * unattended?" (founder question 1, answered NO on 2026-09-02). It requires a
 * dated founder ruling registered in STANCE_RULINGS; tests/unit/
 * paxControlsOffered.test.ts refuses a stance without one.
 *
 * All customer-visible strings come from shared/pax-glossary.ts. Browser-safe
 * (no Node builtins, no process.env).
 */

import {
  PAX_CONTROLS_LABEL,
  PAX_CONTROLS_PATH,
  PAX_NEVER_LIST,
  PAX_RAIL_COPY,
  PAX_STANCE_COPY,
} from "./pax-glossary";

// ── Stances ─────────────────────────────────────────────────────────────────

/**
 * The stances a customer may store. Anything else is refused with 422 by
 * PATCH /api/pax/controls (wave 1 C) and fails CLOSED when read back
 * (server/services/paxControls.ts). Order is page order.
 */
export const OFFERED_STANCES = ["ask_before_sending", "ask_before_everything"] as const;

export type PaxStance = (typeof OFFERED_STANCES)[number];

/** Today's real behaviour — a new org, and a NULL column, start here. */
const DEFAULT_STANCE: PaxStance = "ask_before_sending";

/**
 * One dated founder-ruling document per offered stance (repo-relative path
 * under docs/company/). The type makes an entry mandatory for every stance;
 * the test makes the file mandatory on disk.
 */
export const STANCE_RULINGS: Readonly<Record<PaxStance, string>> = {
  ask_before_sending: "docs/company/founder-decision-2026-09-02-pax-controls.md",
  ask_before_everything: "docs/company/founder-decision-2026-09-02-pax-controls.md",
};

/** Glossary-derived labels — the segmented control renders these. */
export const STANCE_LABELS: Readonly<Record<PaxStance, string>> = {
  ask_before_sending: PAX_STANCE_COPY.ask_before_sending.label,
  ask_before_everything: PAX_STANCE_COPY.ask_before_everything.label,
};

// ── Per-capability rails (PX-2) ─────────────────────────────────────────────

/**
 * The rail levels, weakest → strongest. THE one place the level ids are named
 * (founder ruling 2026-11-10 §6.5 Q4: rails refine the stance, they are not a
 * new stance). The design doc calls the top level "act-with-approval"; the
 * stored id is `act_and_report` — it runs the change and leaves a receipt,
 * which is exactly what "Ask before sending" does for record changes today.
 */
export const PAX_RAIL_LEVELS = ["watch", "draft", "ask", "act_and_report"] as const;

export type PaxRailLevel = (typeof PAX_RAIL_LEVELS)[number];

/**
 * The sends rail's level type: `act_and_report` is UNREPRESENTABLE. A send is
 * never Pax acting on its own (founder decision 1, 2026-09-02) — the cap is in
 * the type, and clampSendsLevel() repeats it at runtime for hand-edited jsonb.
 */
export type PaxSendsRailLevel = Exclude<PaxRailLevel, "act_and_report">;

export const PAX_SENDS_RAIL_LEVELS: readonly PaxSendsRailLevel[] = PAX_RAIL_LEVELS.filter(
  (l): l is PaxSendsRailLevel => l !== "act_and_report",
);

/** The most a sends rail may be. */
export const PAX_SENDS_RAIL_CEILING: PaxSendsRailLevel = "ask";

/** Strength of a level: its index in PAX_RAIL_LEVELS (watch 0 … act_and_report 3). */
function railLevelRank(level: PaxRailLevel): number {
  return PAX_RAIL_LEVELS.indexOf(level);
}

/** The weaker of two levels — how a rail composes with a stance cap. */
export function weakerRailLevel(a: PaxRailLevel, b: PaxRailLevel): PaxRailLevel {
  return railLevelRank(a) <= railLevelRank(b) ? a : b;
}

/**
 * The record domains a record-changing tool belongs to. Every changes_records
 * tool maps to exactly one (TOOL_REGISTRY below; the population test fails an
 * unclassified one). `account` holds the support switch's system fixes
 * (alerts, job state, data-integrity repairs) that touch none of the other
 * five — see BUILD-NOTES PX-2 for why it exists.
 */
export const PAX_RECORD_DOMAINS = [
  "leads",
  "properties",
  "deals",
  "tasks",
  "follow_ups",
  "account",
] as const;

export type PaxRecordDomain = (typeof PAX_RECORD_DOMAINS)[number];

export interface PaxRails {
  /** One level per record domain. */
  records: Record<PaxRecordDomain, PaxRailLevel>;
  /** The sends group — capped at `ask` by type. */
  sends: PaxSendsRailLevel;
}

/** Glossary-derived labels — the page renders these, never its own strings. */
export const PAX_RAIL_LEVEL_LABELS: Readonly<Record<PaxRailLevel, string>> = {
  watch: PAX_RAIL_COPY.levels.watch.label,
  draft: PAX_RAIL_COPY.levels.draft.label,
  ask: PAX_RAIL_COPY.levels.ask.label,
  act_and_report: PAX_RAIL_COPY.levels.act_and_report.label,
};

export const PAX_RAIL_LEVEL_SENTENCES: Readonly<Record<PaxRailLevel, string>> = {
  watch: PAX_RAIL_COPY.levels.watch.sentence,
  draft: PAX_RAIL_COPY.levels.draft.sentence,
  ask: PAX_RAIL_COPY.levels.ask.sentence,
  act_and_report: PAX_RAIL_COPY.levels.act_and_report.sentence,
};

export const PAX_RECORD_DOMAIN_LABELS: Readonly<Record<PaxRecordDomain, string>> = {
  leads: PAX_RAIL_COPY.domains.leads.label,
  properties: PAX_RAIL_COPY.domains.properties.label,
  deals: PAX_RAIL_COPY.domains.deals.label,
  tasks: PAX_RAIL_COPY.domains.tasks.label,
  follow_ups: PAX_RAIL_COPY.domains.follow_ups.label,
  account: PAX_RAIL_COPY.domains.account.label,
};

/**
 * What a missing `rails` key means — today's live behaviour. Under the default
 * stance (ask_before_sending) record changes run and are receipted, which is
 * `act_and_report` for every domain; sends always wait for a tap, which is
 * `ask`. Fresh copy per call so no caller can mutate the shared default.
 */
export function defaultPaxRails(): PaxRails {
  return {
    records: {
      leads: "act_and_report",
      properties: "act_and_report",
      deals: "act_and_report",
      tasks: "act_and_report",
      follow_ups: "act_and_report",
      account: "act_and_report",
    },
    sends: "ask",
  };
}

/** Defence in depth for hand-edited jsonb: a stored sends level above ask reads as ask. */
export function clampSendsLevel(level: PaxRailLevel): PaxSendsRailLevel {
  return railLevelRank(level) > railLevelRank(PAX_SENDS_RAIL_CEILING)
    ? PAX_SENDS_RAIL_CEILING
    : (level as PaxSendsRailLevel);
}

// ── My county sites (PX-7) ──────────────────────────────────────────────────

/** One public site the org lists for Pax's search sessions. `host` is a BARE hostname. */
export interface PaxSiteEntry {
  host: string;
  label: string;
}

/** Most sites an org may list. */
export const PAX_MY_SITES_MAX = 50;
/** Longest label, in characters. */
export const PAX_SITE_LABEL_MAX = 60;

/** One DNS label: letters, digits and inner hyphens. */
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * A bare public hostname, or null. Case and one trailing dot are normalised
 * (the same rule as webSourceFence's normalizeHost); anything else that is not
 * a bare host — a scheme, a path, a port, credentials, a query, whitespace, an
 * underscore, an IP address, a single-label name like `localhost` — is REFUSED,
 * never rewritten into a host the person did not write.
 */
export function normalizeSiteHost(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const host = raw.trim().toLowerCase().replace(/\.$/, "");
  if (host.length === 0 || host.length > 253) return null;
  const labels = host.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((l) => HOST_LABEL.test(l))) return null;
  // The last label must carry a letter: an all-numeric tail is an IPv4 address.
  if (!/[a-z]/.test(labels[labels.length - 1])) return null;
  return host;
}

/**
 * The host out of what a person pastes ("https://assessor.example.gov/search?x=1",
 * "assessor.example.gov"). Used by the page; the SERVER validates the result
 * again with normalizeSiteHost. Credentials in the paste refuse (null).
 */
export function siteHostFromInput(input: string): string | null {
  const text = String(input ?? "").trim();
  if (!text || /\s/.test(text) || text.includes("@")) return null;
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
    if (!hasScheme && /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/]+:\d+(\/|$)/.test(text)) return null;
    const url = new URL(hasScheme ? text : `https://${text}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return normalizeSiteHost(url.hostname);
  } catch {
    return null;
  }
}

const withoutWww = (host: string): string => (host.startsWith("www.") ? host.slice(4) : host);

/**
 * The listed entry that covers `hostname`, or null. A listed host covers
 * itself and its `www.` twin, nothing else — a listed `records.example.gov`
 * does not cover `example.gov` or a sibling subdomain.
 */
export function mySiteForHost(sites: readonly PaxSiteEntry[], hostname: string): PaxSiteEntry | null {
  const wanted = normalizeSiteHost(hostname);
  if (!wanted) return null;
  const bare = withoutWww(wanted);
  return sites.find((s) => withoutWww(s.host) === bare) ?? null;
}

// ── The stored column ───────────────────────────────────────────────────────

/**
 * `organizations.pax_controls` (jsonb, migration 0250). The three switches
 * are the org-level "runs on its own" toggles from spec §3a.3. `rails` (PX-2)
 * is optional IN THE DATABASE — a row written before PX-2 has none and reads
 * as the defaults — but always present on the object the reader returns.
 */
export interface PaxControls {
  stance: PaxStance;
  /** Lead scoring / staging job (leadCampaignJobs.processLeadNurturing). */
  leadScoring: boolean;
  /** Borrower reminder PREPARATION (financeAgent.ensureLadderRung). Dispatch always asks. */
  borrowerReminders: boolean;
  /** Draft a reply when a message is opened (routes-ai-draft.ts). */
  inboxDrafts: boolean;
  /** Per-capability rails — may only NARROW what the stance allows. */
  rails: PaxRails;
  /**
   * PX-7: the public sites Pax may run search sessions on (browse_search).
   * Optional IN THE DATABASE (a pre-PX-7 row reads as []); always present on
   * the object the reader returns. EMPTY = nothing listed = no search runs on a
   * listed site (fail-closed); the closed state keeps it empty.
   */
  mySites: readonly PaxSiteEntry[];
}

/**
 * What a NULL column means. These EQUAL today's live behaviour — the deploy
 * that adds the column changes nothing silently (spec §4.1; founder
 * question 5). The rails are today's behaviour too (defaultPaxRails): record
 * changes act-and-report, sends ask.
 */
export const PAX_CONTROLS_DEFAULTS: Readonly<PaxControls> = {
  stance: DEFAULT_STANCE,
  leadScoring: true,
  borrowerReminders: true,
  inboxDrafts: true,
  rails: defaultPaxRails(),
  mySites: [],
};

// ── Asks ("Waiting for your tap") ───────────────────────────────────────────

/**
 * Where a pending_actions row came from. The first five are the
 * ExecuteToolOptions.origin lanes (spec §4.3); `finance_ladder` is written by
 * the borrower ladder's dispatch gate (§4.4) and `revised` by the Edit route
 * (§4.5).
 */
export const PAX_ASK_ORIGINS = [
  "chat",
  "scheduled",
  "inbound_signal",
  "support",
  "approval_replay",
  "finance_ladder",
  "revised",
] as const;

export type PaxAskOrigin = (typeof PAX_ASK_ORIGINS)[number];

/** `pending_actions.source_ref` — the record an ask came from. All optional. */
export interface PaxAskSourceRef {
  leadId?: number | null;
  dealId?: number | null;
  propertyId?: number | null;
  noteId?: number | null;
  borrowerId?: number | null;
  reminderId?: number | null;
  scheduledTaskId?: number | null;
  scheduledTaskName?: string | null;
  ticketId?: number | null;
  enrollmentId?: number | null;
  workflowRunId?: number | null;
}

/**
 * The stores the queue reads from. `needsYouCountIsComplete.test.ts` (wave 1)
 * asserts the list/count query reads each of these. One store, on purpose:
 * the borrower ladder's `awaiting_approval` rows are kernel rows too (§4.5).
 */
export const PARKED_STATES = ["pending_actions:pending"] as const;

// ── Capability groups (spec §2) ─────────────────────────────────────────────

export type PaxToolGroup =
  | "looks_and_drafts"
  | "changes_records"
  | "sends"
  | "runs_rules"
  | "never";

/** Which switch (or rail) actually runs a tool name after a tap. */
export type PaxToolDispatch =
  | "executeTool"
  | "executeSupportTool"
  | "finance_ladder"
  | "refused";

type NeverLineId = (typeof PAX_NEVER_LIST)[number]["id"];

interface ToolEntry {
  group: PaxToolGroup;
  dispatch: PaxToolDispatch;
  /** For refused tools: the Never line that explains the refusal. */
  neverLine?: NeverLineId;
  /** For changes_records tools ONLY: the one record domain it belongs to (PX-2 rails). */
  domain?: PaxRecordDomain;
}

/**
 * Support account fixes that freeze as an ask at EVERY stance (spec §4.3),
 * so "Requires customer confirmation" in the support prompt is finally true.
 * `apply_credit` is NOT here: a concession on what the customer pays AcreOS
 * is the founder's pricing hard-stop, and wave 1 A makes it model-unreachable
 * rather than askable.
 */
export const ALWAYS_ASK_SUPPORT_TOOLS: ReadonlySet<string> = new Set([
  "apply_billing_fix",
  "resync_stripe",
  "reset_user_preferences",
  "apply_bulk_fix",
  "fix_common_issue",
]);

const tools = (
  names: readonly string[],
  group: PaxToolGroup,
  dispatch: PaxToolDispatch,
): Array<[string, ToolEntry]> => names.map((n) => [n, { group, dispatch }]);

/** changes_records tools carry their domain — the only way to register one. */
const recordTools = (
  domain: PaxRecordDomain,
  names: readonly string[],
  dispatch: PaxToolDispatch,
): Array<[string, ToolEntry]> =>
  names.map((n) => [n, { group: "changes_records", dispatch, domain }]);

/**
 * EVERY top-level case label of BOTH dispatch switches, plus the two names
 * that never reach a switch. tests/unit/paxControlsOffered.test.ts derives
 * the labels from server/ai/tools.ts and server/ai/supportAgent.ts and
 * fails when either side gains a name the other lacks — a new tool is
 * unclassified until someone classifies it, and unclassified fails.
 */
const TOOL_REGISTRY: Readonly<Record<string, ToolEntry>> = Object.fromEntries([
  // ── server/ai/tools.ts:executeTool ────────────────────────────────────
  // Looks & drafts = PAUSE_SAFE_TOOLS minus draft_offer (it mutates the deal).
  ...tools(
    [
      "get_system_context",
      "get_dashboard_stats",
      "get_pipeline_summary",
      "get_leads",
      "get_lead_details",
      "get_stale_leads",
      "get_properties",
      "get_property_details",
      "get_property_enrichment",
      "get_deals",
      "get_tasks",
      "get_notes",
      "get_cashflow_summary",
      "calculate_amortization",
      "calculate_payment_schedule",
      "calculate_roi",
      "run_comps",
      "run_comps_analysis",
      "research_property",
      "browse_web",
      "browse_search",
      "extract_properties_from_text",
      "retrieve_land_knowledge",
      "generate_offer",
      "draft_outreach_message",
      "search_gmail",
      "search_drive",
      "get_drive_file",
      "list_calendar_events",
      "get_stripe_customer",
      "list_stripe_payments",
      "search_mls_listings",
      "get_mls_comps",
      "remember_fact",
      "recall_facts",
      "spawn_subagent",
      // Stage 2 account reads (pause-safe: they only read) and the support
      // hand-off, which files a ticket and never touches the customer's
      // records — the same standing as the support switch's escalate_to_human.
      "get_credits",
      "quote_outbound_cost",
      "get_campaigns",
      "get_inbox_replies",
      "get_team_activity",
      "get_plan_limits",
      "get_finance_summary",
      "get_sending_identity_status",
      "get_product_facts",
      "escalate_to_support",
    ],
    "looks_and_drafts",
    "executeTool",
  ),
  // Record changes, each in exactly one domain (PX-2 rails).
  ...recordTools("leads", ["update_lead_status", "create_lead"], "executeTool"),
  ...recordTools("properties", ["create_property", "update_property", "create_properties_batch"], "executeTool"),
  ...recordTools(
    "deals",
    ["create_deal", "update_deal", "generate_offer_letter", "draft_offer"],
    "executeTool",
  ),
  ...recordTools("tasks", ["create_task", "update_task", "complete_task"], "executeTool"),
  ...recordTools("follow_ups", ["schedule_followup", "schedule_follow_up"], "executeTool"),
  // APPROVAL_REQUIRED_TOOLS (server/services/approvalKernel.ts) — may only grow.
  ...tools(
    [
      "send_email",
      "send_sms",
      "send_gmail",
      "send_slack_message",
      "create_stripe_payment_link",
      // Outbound connector POSTs — a webhook fan-out or a calendar invite
      // leaves AcreOS exactly like an email does (2026-10-20).
      "trigger_zapier",
      "trigger_make",
      "create_calendar_event",
    ],
    "sends",
    "executeTool",
  ),
  // Refused before the switch (FCRA gate) — a Never line, not a tool.
  ["batch_leads_skip_trace", { group: "never", dispatch: "refused", neverLine: "skip_trace" }],
  // The borrower ladder's dispatch parks as this toolName (spec §4.4); the
  // human's tap replays through financeAgentService.sendManualReminder.
  ["send_borrower_reminder", { group: "sends", dispatch: "finance_ladder" }],

  // ── server/ai/supportAgent.ts:executeSupportTool ──────────────────────
  // Looks & drafts = PAUSE_SAFE_SUPPORT_TOOLS (top-level labels).
  ...tools(
    [
      "analyze_screenshot",
      "analyze_user_sentiment",
      "check_data_integrity",
      "check_external_service_status",
      "check_integration_health",
      "check_service_health",
      "detect_bulk_issue",
      "detect_data_integrity_issues",
      "detect_onboarding_stuck",
      "diagnose_account",
      "draft_customer_response",
      "escalate_to_human",
      "estimate_resolution_confidence",
      "generate_tutorial",
      "geocode_address",
      "get_account_health_score",
      "get_account_summary",
      "get_active_alerts",
      "get_best_resolution_approach",
      "get_billing_issues",
      "get_contextual_suggestions",
      "get_feature_walkthrough",
      "get_payment_history",
      "get_resolution_stats",
      "get_similar_resolutions",
      "get_subscription_details",
      "get_troubleshooting_steps",
      "get_user_activity",
      "learn_from_human_resolution",
      "log_resolution",
      "log_resolution_variant",
      "record_customer_feedback",
      "save_user_memory",
      "lookup_agricultural_values",
      "lookup_climate",
      "lookup_cropland",
      "lookup_demographics",
      "lookup_elevation",
      "lookup_epa_facilities",
      "lookup_fema_nri",
      "lookup_flood_zone",
      "lookup_land_cover",
      "lookup_plss",
      "lookup_public_lands",
      "lookup_soil_data",
      "lookup_storm_history",
      "lookup_usda_clu",
      "lookup_watershed",
      "lookup_wetlands",
      "predict_potential_issues",
      "predict_user_issues",
      "query_user_data",
      "recall_user_memory",
      "reverse_geocode",
      "run_account_health_check",
      "search_knowledge_base",
      "search_logs",
      "search_resolved_tickets",
      "suggest_next_steps",
      "trace_root_cause",
    ],
    "looks_and_drafts",
    "executeSupportTool",
  ),
  // Account fixes that write the customer's own records (alerts, tasks,
  // coordinates, job state). send_proactive_warning and
  // schedule_proactive_outreach write a system alert row — a record, not a
  // message to a counterparty.
  ...recordTools("follow_ups", ["create_followup_task", "schedule_proactive_outreach"], "executeSupportTool"),
  ...recordTools("properties", ["enrich_property_coordinates"], "executeSupportTool"),
  ...recordTools(
    "account",
    [
      "fix_common_issue",
      "send_proactive_warning",
      "apply_bulk_fix",
      "fix_data_integrity_issue",
      "apply_self_healing_fix",
      "resolve_alert",
      "retry_failed_jobs",
      "unlock_stuck_jobs",
    ],
    "executeSupportTool",
  ),
  // Billing fixes — the spec's "Sends to people" row (§2).
  ...tools(["resync_stripe", "apply_billing_fix", "reset_user_preferences"], "sends", "executeSupportTool"),
]);

/** tool → capability group. The page renders its groups from this. */
export const PAX_TOOL_GROUPS: Readonly<Record<string, PaxToolGroup>> = Object.fromEntries(
  Object.entries(TOOL_REGISTRY).map(([name, entry]) => [name, entry.group]),
);

/** Group for a tool name, or null when the name is not a classified tool. */
export function groupForTool(toolName: string): PaxToolGroup | null {
  return TOOL_REGISTRY[toolName]?.group ?? null;
}

/** tool → record domain, for changes_records tools only. */
export const PAX_TOOL_DOMAINS: Readonly<Record<string, PaxRecordDomain>> = Object.fromEntries(
  Object.entries(TOOL_REGISTRY).flatMap(([name, entry]) => (entry.domain ? [[name, entry.domain]] : [])),
);

/** Record domain for a tool name, or null when it is not a classified record change. */
export function domainForTool(toolName: string): PaxRecordDomain | null {
  const entry = TOOL_REGISTRY[toolName];
  return entry?.group === "changes_records" ? (entry.domain ?? null) : null;
}

/** Which switch replays a tool name after a tap, or null when unknown. */
export function dispatchForTool(toolName: string): PaxToolDispatch | null {
  return TOOL_REGISTRY[toolName]?.dispatch ?? null;
}

// ── Unattended paths (spec §4.4) ────────────────────────────────────────────

export interface UnattendedPath {
  id: string;
  /** Customer-facing row label. */
  label: string;
  /** file:function of the gate — the ratchet resolves both. */
  file: string;
  fn: string;
  /** What each stance does here, in the customer's words. */
  stance: Readonly<Record<PaxStance, string>>;
  /** What Pause does here, in the customer's words. */
  whilePaused: string;
  /** Rendered in "what Pause stops" on the status strip. */
  pauseStops: boolean;
  /** The reason code the engine records when it skips/defers/parks. */
  pausedReason: string | null;
  /** The switch for this path, with where it lives; null = no switch. */
  switch: { label: string; href: string } | null;
  /** False for founder-only lanes; the customer page never lists them. */
  customerVisible: boolean;
}

const paxSwitch = { label: PAX_CONTROLS_LABEL, href: PAX_CONTROLS_PATH } as const;

const EXECUTE_AND_RECEIPT = "runs and leaves a receipt";
const WAITS_FOR_TAP = "waits for your tap";

/**
 * Every place Pax or a rule acts without a tap. The page's "what Pause
 * stops" list is rendered from the members with `pauseStops`, and
 * paxPauseCoversEveryUnattendedPath.test.ts (wave 1 B) asserts each member's
 * gate is real — the same registry, both sides.
 */
export const UNATTENDED_PATHS: readonly UnattendedPath[] = [
  {
    id: "chat_record_writes",
    label: "Record changes Pax makes when you ask",
    file: "server/ai/tools.ts",
    fn: "executeTool",
    stance: { ask_before_sending: EXECUTE_AND_RECEIPT, ask_before_everything: WAITS_FOR_TAP },
    whilePaused: "not done — Pax tells you it is paused",
    pauseStops: true,
    pausedReason: "pax_paused",
    switch: null,
    customerVisible: true,
  },
  {
    id: "chat_sends",
    label: "Messages Pax writes",
    file: "server/ai/tools.ts",
    fn: "executeTool",
    stance: { ask_before_sending: WAITS_FOR_TAP, ask_before_everything: WAITS_FOR_TAP },
    whilePaused: "still waits for your tap; anything you approve still goes out",
    pauseStops: false,
    pausedReason: null,
    switch: null,
    customerVisible: true,
  },
  {
    id: "support_fixes",
    label: "Account fixes from support chat",
    file: "server/ai/supportAgent.ts",
    fn: "executeSupportTool",
    stance: {
      ask_before_sending: "billing fixes wait for your tap; other fixes run and leave a receipt",
      ask_before_everything: WAITS_FOR_TAP,
    },
    whilePaused: "not done — support tells you it is paused",
    pauseStops: true,
    pausedReason: "pax_paused",
    switch: null,
    customerVisible: true,
  },
  {
    id: "scheduled_prompts",
    label: "Scheduled prompts",
    file: "server/services/paxScheduler.ts",
    fn: "processPaxScheduledTasks",
    stance: {
      ask_before_sending: "runs; record changes run and leave receipts",
      ask_before_everything: "runs; every record change waits for your tap",
    },
    whilePaused: "skipped until the pause lifts",
    pauseStops: true,
    pausedReason: "skipped_paused",
    switch: paxSwitch,
    customerVisible: true,
  },
  {
    id: "lead_scoring",
    label: "Lead scoring and staging",
    file: "server/jobs/leadCampaignJobs.ts",
    fn: "processLeadNurturing",
    stance: {
      ask_before_sending: EXECUTE_AND_RECEIPT,
      ask_before_everything: "runs (a score is not a message)",
    },
    whilePaused: "skipped until the pause lifts",
    pauseStops: true,
    pausedReason: "skipped_paused",
    switch: paxSwitch,
    customerVisible: true,
  },
  {
    id: "campaign_optimizer",
    label: "Campaign suggestions",
    file: "server/jobs/leadCampaignJobs.ts",
    fn: "processCampaignOptimizations",
    stance: { ask_before_sending: "runs", ask_before_everything: "runs" },
    whilePaused: "skipped until the pause lifts",
    pauseStops: true,
    pausedReason: "skipped_paused",
    switch: paxSwitch,
    customerVisible: true,
  },
  {
    id: "nudges",
    label: "Nudges and lead-aging cards",
    file: "server/services/paxNudges.ts",
    fn: "processPaxNudges",
    stance: { ask_before_sending: "cards only", ask_before_everything: "cards only" },
    whilePaused: "no new cards until the pause lifts",
    pauseStops: true,
    pausedReason: "skipped_paused",
    switch: null,
    customerVisible: true,
  },
  {
    id: "workflows",
    label: "Workflows",
    file: "server/services/workflow-engine.ts",
    fn: "triggerWorkflows",
    stance: { ask_before_sending: "runs", ask_before_everything: "runs" },
    whilePaused: "each run waits and resumes when the pause lifts",
    pauseStops: true,
    pausedReason: "paused",
    switch: { label: "Workflows", href: "/workflows" },
    customerVisible: true,
  },
  {
    id: "sequences",
    label: "Campaign sequences",
    file: "server/services/sequenceProcessor.ts",
    fn: "processEnrollment",
    stance: { ask_before_sending: "runs", ask_before_everything: "runs" },
    whilePaused: "each step is deferred, never dropped, and resumes when the pause lifts",
    pauseStops: true,
    pausedReason: "deferred_paused",
    switch: { label: "Campaigns", href: "/campaigns" },
    customerVisible: true,
  },
  {
    id: "task_runner_skills",
    label: "Skill tasks",
    file: "server/services/task-runner.ts",
    fn: "agent_skill",
    stance: { ask_before_sending: "founder-created only", ask_before_everything: "founder-created only" },
    whilePaused: "skipped until the pause lifts",
    pauseStops: true,
    pausedReason: "skipped_paused",
    switch: null,
    customerVisible: false,
  },
  {
    id: "borrower_staging",
    label: "Preparing borrower payment reminders",
    file: "server/services/financeAgent.ts",
    fn: "ensureLadderRung",
    stance: { ask_before_sending: "prepared", ask_before_everything: "prepared" },
    whilePaused: "nothing is prepared until the pause lifts",
    pauseStops: true,
    pausedReason: "pax_paused",
    switch: paxSwitch,
    customerVisible: true,
  },
  {
    id: "borrower_dispatch",
    label: "Sending borrower payment reminders",
    file: "server/services/financeAgent.ts",
    fn: "dispatchReminder",
    stance: { ask_before_sending: WAITS_FOR_TAP, ask_before_everything: WAITS_FOR_TAP },
    whilePaused: "queued; still waits for your tap",
    pauseStops: false,
    pausedReason: "queued",
    switch: paxSwitch,
    customerVisible: true,
  },
  {
    id: "inbox_drafts",
    label: "Inbox reply drafts",
    file: "server/routes-ai-draft.ts",
    fn: "paxDraftEnabled",
    stance: { ask_before_sending: "drafts", ask_before_everything: "drafts" },
    whilePaused: "still drafts (a draft is not an action)",
    pauseStops: false,
    pausedReason: null,
    switch: paxSwitch,
    customerVisible: true,
  },
  {
    id: "founder_lane",
    label: "Founder-run items for your workspace",
    file: "server/services/autonomousDecisionExecutor.ts",
    fn: "skipped_pax_paused",
    stance: { ask_before_sending: "unchanged", ask_before_everything: "unchanged" },
    whilePaused: "deferred until the pause lifts",
    pauseStops: true,
    pausedReason: "skipped_pax_paused",
    switch: null,
    customerVisible: false,
  },
];

export type UnattendedPathId = (typeof UNATTENDED_PATHS)[number]["id"];
