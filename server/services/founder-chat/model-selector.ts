/**
 * Atlas model selector.
 *
 * Inverts the customer-side cost cascade. Where Pax defaults to the
 * cheapest viable model, Atlas defaults to OPUS for reasoning — Tom's
 * load-bearing requirement was "as intelligent as Opus 4.7 has been
 * working with you in this terminal." Slot-filling and pure formatting
 * downgrade; everything else stays on Opus by default.
 *
 * Tom can override per-thread with `/fast` (Sonnet) or `/cheap` (Haiku),
 * or per-turn by prefixing with `/opus`, `/sonnet`, `/haiku`. Model
 * choice is metered in the financial ledger so Tom sees the cost.
 */

export type AtlasIntent =
  | "tool_arg_extraction"   // slot-filling, deterministic
  | "format_tool_result"    // turning a JSON blob into prose
  | "reasoning"             // multi-step planning, debugging, "what should I do"
  | "code_generation"       // propose_edit body
  | "agent_quote_summary"   // wrapping another agent's response
  | "morning_brief"         // composing the daily brief
  | "default";

export type ModelOverride = "opus" | "sonnet" | "haiku" | "fast" | "cheap" | null;

const MODEL_BY_INTENT: Record<AtlasIntent, string> = {
  tool_arg_extraction: "anthropic/claude-haiku-4-5",
  format_tool_result: "anthropic/claude-sonnet-4-6",
  reasoning: "anthropic/claude-opus-4-7",
  code_generation: "anthropic/claude-opus-4-7",
  agent_quote_summary: "anthropic/claude-sonnet-4-6",
  morning_brief: "anthropic/claude-opus-4-7",
  default: "anthropic/claude-opus-4-7",
};

const OVERRIDE_TO_MODEL: Record<NonNullable<ModelOverride>, string> = {
  opus: "anthropic/claude-opus-4-7",
  sonnet: "anthropic/claude-sonnet-4-6",
  haiku: "anthropic/claude-haiku-4-5",
  fast: "anthropic/claude-sonnet-4-6",
  cheap: "anthropic/claude-haiku-4-5",
};

export function selectModelForTurn(opts: {
  intent: AtlasIntent;
  override?: ModelOverride;
  threadDefault?: "opus" | "sonnet" | "haiku";  // per-thread default if Tom set one
}): { model: string; reason: string } {
  // Explicit per-turn override wins.
  if (opts.override && OVERRIDE_TO_MODEL[opts.override]) {
    return {
      model: OVERRIDE_TO_MODEL[opts.override],
      reason: `override:${opts.override}`,
    };
  }
  // Per-thread default next (e.g., Tom set the whole thread to /cheap mode).
  if (opts.threadDefault) {
    return {
      model: OVERRIDE_TO_MODEL[opts.threadDefault],
      reason: `thread:${opts.threadDefault}`,
    };
  }
  // Default per-intent.
  return {
    model: MODEL_BY_INTENT[opts.intent] ?? MODEL_BY_INTENT.default,
    reason: `intent:${opts.intent}`,
  };
}

/** Parse a slash-prefix override from the user's message text, if any. */
export function parseOverrideFromMessage(message: string): { override: ModelOverride; cleanedMessage: string } {
  const match = message.match(/^\s*\/(opus|sonnet|haiku|fast|cheap)\b\s*(.*)$/i);
  if (!match) return { override: null, cleanedMessage: message };
  return {
    override: match[1].toLowerCase() as ModelOverride,
    cleanedMessage: match[2] ?? "",
  };
}

/**
 * Map a model id to a short human label for the "Used Sonnet for this"
 * inline disclosure Atlas surfaces when downgrading from Opus default.
 */
export function shortLabelForModel(model: string): string {
  if (model.includes("opus")) return "Opus 4.7";
  if (model.includes("sonnet")) return "Sonnet 4.6";
  if (model.includes("haiku")) return "Haiku 4.5";
  return model;
}
