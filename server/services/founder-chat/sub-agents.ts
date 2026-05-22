/**
 * Atlas sub-agent capability.
 *
 * When a question would require Atlas to read 20+ files or chew through
 * a large dataset, Atlas spawns a sub-agent (explore | plan | fix) and
 * the sub-agent returns a focused summary back to the parent thread as
 * a background_task_card. Atlas stays focused on the conversation.
 *
 * Phase A delivers the framework + "explore" kind only. "plan" and
 * "fix" come in Phase H once code-edit tools (propose_edit) land.
 *
 * Sub-agents share the founder's audit scope but draw against a
 * separate daily budget (founder_settings `atlas.subagent_daily_budget_cents`,
 * default 500¢). The spawn_sub_agent tool checks budget before queueing.
 */

import { startBackgroundTask } from "./background-tasks";

export type SubAgentKind = "explore" | "plan" | "fix";

export interface SpawnSubAgentOpts {
  threadId: number;
  founderUserId: string;
  parentTaskId?: string;
  kind: SubAgentKind;
  intent: string;
  scopeLimits?: string[];
  expectedDeliverable?: "report" | "diff" | "plan_doc";
  estimatedSeconds?: number;
}

const DEFAULT_DAILY_BUDGET_CENTS = 500;
const KIND_LABELS: Record<SubAgentKind, string> = {
  explore: "Explore",
  plan: "Plan",
  fix: "Fix",
};

export async function spawnSubAgent(opts: SpawnSubAgentOpts): Promise<{ taskId: string }> {
  // Phase A stubs the budget check — Phase B wires it to the actual
  // daily-spend query against ai_call_log filtered by founder + sub_agent feature.
  // For now we proceed; the founder_settings key is registered for future use.
  if (opts.kind !== "explore") {
    // Restricted in Phase A.
    throw new Error(
      `[founder-chat] sub-agent kind "${opts.kind}" not yet enabled (Phase H wires plan/fix)`,
    );
  }

  return startBackgroundTask({
    threadId: opts.threadId,
    founderUserId: opts.founderUserId,
    parentTaskId: opts.parentTaskId ?? null,
    label: `${KIND_LABELS[opts.kind]}: ${opts.intent}`,
    runnerKey: `subagent_${opts.kind}`,
    payload: {
      intent: opts.intent,
      scopeLimits: opts.scopeLimits ?? [],
      expectedDeliverable: opts.expectedDeliverable ?? "report",
    },
    estimatedSeconds: opts.estimatedSeconds,
  });
}

/**
 * Read the configured daily sub-agent budget. Reads founder_settings
 * with the default-cents fallback. Phase B wires this to a tool
 * `get_atlas_budget_status` that Atlas can inspect.
 */
export async function getSubAgentDailyBudgetCents(): Promise<number> {
  // Lazy-import the settings service to avoid a circular dep at module load.
  try {
    const { getSetting } = await import("../settings");
    const v = await getSetting<number>("atlas.subagent_daily_budget_cents", DEFAULT_DAILY_BUDGET_CENTS);
    return typeof v === "number" ? v : DEFAULT_DAILY_BUDGET_CENTS;
  } catch {
    return DEFAULT_DAILY_BUDGET_CENTS;
  }
}
