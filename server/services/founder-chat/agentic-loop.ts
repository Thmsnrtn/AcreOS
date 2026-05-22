/**
 * Atlas agentic-loop orchestrator.
 *
 * Tom's experience watching me work is many tool calls per "turn" —
 * read 3 files, edit one, run a test, commit — without his
 * intervention between steps. This module gives Atlas the same.
 *
 * Phase A delivers the orchestration shape; Phase B wires it into the
 * chat-stream endpoint. The endpoint will:
 *   1. Get the LLM's response (which may include 0+ tool_calls).
 *   2. For each tool_call → runTool() via executor.
 *   3. Append the tool result to the message history.
 *   4. Re-invoke the LLM.
 *   5. Repeat until the LLM stops calling tools, OR maxToolCalls hit.
 *
 * Beyond the budget, this module tracks consecutive_failures and
 * injects a retry_guidance block into the system prompt when Atlas
 * keeps hitting the same wall.
 */

export const DEFAULT_MAX_TOOL_CALLS_PER_TURN = 10;
export const DEFAULT_RETRY_GUIDANCE_THRESHOLD = 3;

export interface AgenticLoopBudget {
  maxToolCalls: number;
  retryGuidanceThreshold: number;
}

export async function readAgenticLoopBudget(): Promise<AgenticLoopBudget> {
  try {
    const { getSetting } = await import("../settings");
    const [maxToolCalls, retryGuidanceThreshold] = await Promise.all([
      getSetting<number>("atlas.max_tool_calls_per_turn", DEFAULT_MAX_TOOL_CALLS_PER_TURN),
      getSetting<number>("atlas.retry_guidance_threshold", DEFAULT_RETRY_GUIDANCE_THRESHOLD),
    ]);
    return {
      maxToolCalls: typeof maxToolCalls === "number" ? maxToolCalls : DEFAULT_MAX_TOOL_CALLS_PER_TURN,
      retryGuidanceThreshold: typeof retryGuidanceThreshold === "number" ? retryGuidanceThreshold : DEFAULT_RETRY_GUIDANCE_THRESHOLD,
    };
  } catch {
    return {
      maxToolCalls: DEFAULT_MAX_TOOL_CALLS_PER_TURN,
      retryGuidanceThreshold: DEFAULT_RETRY_GUIDANCE_THRESHOLD,
    };
  }
}

/**
 * Stateful per-turn tracker the chat-stream endpoint instantiates once
 * per Atlas turn. Tracks tool-call count + consecutive_failures by
 * (tool, error_class) so we can inject retry_guidance when stuck.
 */
export class TurnState {
  toolCallCount = 0;
  /** Map<`${toolName}::${errorClass}`, count> */
  private consecutiveFailures = new Map<string, number>();
  /** Track last error for each tool to detect "same error again." */
  private lastErrorByTool = new Map<string, string>();

  constructor(public readonly budget: AgenticLoopBudget) {}

  /** True when the LLM may continue calling tools this turn. */
  canCallMoreTools(): boolean {
    return this.toolCallCount < this.budget.maxToolCalls;
  }

  /** Call after every tool run (success or failure). */
  recordToolRun(opts: { toolName: string; success: boolean; errorClass?: string }): void {
    this.toolCallCount += 1;
    if (opts.success) {
      // Successful call resets the consecutive-failure tracker for this tool.
      this.lastErrorByTool.delete(opts.toolName);
      // Clear ALL counters keyed to this tool name (any error class).
      for (const key of this.consecutiveFailures.keys()) {
        if (key.startsWith(`${opts.toolName}::`)) {
          this.consecutiveFailures.delete(key);
        }
      }
      return;
    }
    const errorClass = opts.errorClass ?? "unknown";
    const key = `${opts.toolName}::${errorClass}`;
    const last = this.lastErrorByTool.get(opts.toolName);
    if (last === errorClass) {
      this.consecutiveFailures.set(key, (this.consecutiveFailures.get(key) ?? 0) + 1);
    } else {
      this.consecutiveFailures.set(key, 1);
      this.lastErrorByTool.set(opts.toolName, errorClass);
    }
  }

  /**
   * True when a tool has failed with the same error class N times in a
   * row, where N is the configured retry-guidance threshold. The chat
   * stream endpoint should inject a <retry_guidance> block into the
   * next system message when this returns true.
   */
  shouldInjectRetryGuidance(): { toolName: string; errorClass: string } | null {
    for (const [key, count] of this.consecutiveFailures.entries()) {
      if (count >= this.budget.retryGuidanceThreshold) {
        const [toolName, errorClass] = key.split("::");
        return { toolName, errorClass };
      }
    }
    return null;
  }

  /**
   * True when Atlas should pause and ask Tom to weigh in (5+ total
   * failures within a turn = something is really off, escalate).
   */
  shouldEscalateToFounder(): boolean {
    let totalFailures = 0;
    for (const count of this.consecutiveFailures.values()) totalFailures += count;
    return totalFailures >= 5;
  }
}

/**
 * Build the retry_guidance block to inject into Atlas's system prompt
 * when the stuck-loop condition fires.
 */
export function buildRetryGuidanceBlock(opts: { toolName: string; errorClass: string }): string {
  return `
<retry_guidance>
You've called \`${opts.toolName}\` ${DEFAULT_RETRY_GUIDANCE_THRESHOLD}+ times with the same error class
(\`${opts.errorClass}\`). Step back. Don't retry the same approach.

Try one of:
- Re-read the inputs you've been passing. Did you misread an ID?
- Use a different tool to verify your assumption (e.g., \`read_file\` if
  you're patching, \`db_schema\` if you're querying).
- Spawn an \`explore\` sub-agent to do a deeper read.
- Surface the situation to Tom: "Hit a wall on X — want me to dig
  deeper, or do you want to look?"
</retry_guidance>`.trim();
}
