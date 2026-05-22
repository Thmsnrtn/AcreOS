/**
 * Slash-command alias stub.
 *
 * Phase B will export the real list from the founder tool registry
 * (`server/services/founder-chat/tool-registry.ts`). Until that ships,
 * this stub gives the Composer popover something to match against so we
 * can build + verify the UX shape in isolation.
 *
 * When Phase B lands, replace the array below with a fetch from
 * `/api/founder/chat/slash-aliases` (or a typed import from a shared
 * registry export) and drop the stub flag.
 */
export interface SlashTool {
  /** Slash alias minus the leading "/" — e.g. "buckets" matches "/buckets". */
  alias: string;
  /** Underlying tool name in the founder tool registry. */
  tool: string;
  /** One-line description shown in the popover. */
  description: string;
  /** Argument hint shown after the alias, e.g. "<days>". */
  argsHint?: string;
  /** Destructive tools render a warning chip in the popover. */
  destructive?: boolean;
}

export const SLASH_TOOLS: SlashTool[] = [
  // ── inquiry ──────────────────────────────────────────────────────────
  { alias: "buckets", tool: "get_buckets", description: "Show 5-bucket balances" },
  { alias: "mrr", tool: "get_mrr_trend", description: "MRR trend chart", argsHint: "<days>" },
  { alias: "orgs", tool: "get_contribution_margin_per_org", description: "Per-org margin table", argsHint: "[filter]" },
  { alias: "costs", tool: "get_cost_mix", description: "Cost mix breakdown", argsHint: "<days>" },
  { alias: "triggers", tool: "get_active_triggers", description: "Open revenue triggers" },
  { alias: "decisions", tool: "get_decision_queue", description: "Items awaiting decision" },
  { alias: "dlq", tool: "get_dlq_items", description: "Dead-letter queue contents" },
  { alias: "infra", tool: "get_infra_status", description: "Fly + Postgres + Sentry + R2" },
  { alias: "brief", tool: "get_morning_brief", description: "Today's morning brief" },
  { alias: "audit", tool: "get_audit_log", description: "Recent audit entries", argsHint: "<area>" },

  // ── action (destructive) ─────────────────────────────────────────────
  { alias: "approve", tool: "approve_trigger", description: "Approve a revenue trigger", argsHint: "<trigger-id>", destructive: true },
  { alias: "defer", tool: "defer_trigger", description: "Defer a trigger", argsHint: "<trigger-id> [days]", destructive: true },
  { alias: "transfer", tool: "transfer_between_buckets", description: "Move funds between buckets", argsHint: "<cents> <from> <to>", destructive: true },
  { alias: "pause", tool: "pause_channel_for_org", description: "Pause a channel for one org", argsHint: "<org> <channel>", destructive: true },
  { alias: "dial", tool: "set_dial", description: "Set a founder dial", argsHint: "<key> <value>", destructive: true },

  // ── synthesis ────────────────────────────────────────────────────────
  { alias: "letter", tool: "draft_weekly_money_letter", description: "Draft the weekly money letter" },
];

/**
 * Filter slash tools matching a partial query (the substring after the
 * leading "/"). Returns at most `limit` matches, ranked by prefix-match
 * first then substring.
 */
export function filterSlashTools(query: string, limit = 8): SlashTool[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_TOOLS.slice(0, limit);

  const prefixHits: SlashTool[] = [];
  const substringHits: SlashTool[] = [];
  for (const tool of SLASH_TOOLS) {
    if (tool.alias.toLowerCase().startsWith(q)) {
      prefixHits.push(tool);
    } else if (
      tool.alias.toLowerCase().includes(q) ||
      tool.description.toLowerCase().includes(q)
    ) {
      substringHits.push(tool);
    }
  }
  return [...prefixHits, ...substringHits].slice(0, limit);
}
