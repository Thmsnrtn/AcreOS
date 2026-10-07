/**
 * Task guards shared by every dispatched worker (coding agents AND the
 * business role workers): what counts as a finished task, when a task is
 * looping, and how many model turns a task may spend.
 *
 * Why this exists (S11, founder simulation 2026-10-06): a queued growth
 * dispatch ran, the model answered "Nothing further to add.", and the runner
 * recorded `completed` — a success with zero marketing artifacts. The trust
 * ledger then credited the domain a clean cycle for work that never happened.
 * An empty answer is a FAILURE, never a success.
 *
 * The second shape: a model that keeps calling the same tool with the same
 * arguments burns its whole turn budget and then reads as "max_turns". It is a
 * loop, it is named as one, and the task ends failed with the reason.
 *
 * Pure (no DB, no model) so the predicates are exhaustively testable and the
 * same definitions bind both runners.
 */
import { DISPATCH_MAX_TURNS } from "@shared/schema/solene-dispatch";

/**
 * Answers that carry no work product. Matched against the WHOLE trimmed
 * answer (anchored), so a real result that happens to contain "done" is not
 * caught — only an answer that is nothing but one of these.
 */
const EMPTY_ANSWER_RE =
  /^(?:nothing(?: further| more| else)?(?: to add| to report| to do)?|no (?:further |more )?(?:action|changes?|updates?|work)(?: (?:needed|required|taken|to report))?|n\/?a|none|done|ok(?:ay)?|completed?|no-?op|i have nothing to add|stand-in)[.!]?$/i;

/**
 * True when a worker's final answer is empty of work product: blank, only
 * punctuation/whitespace, or one of the no-content stock answers. Pure.
 */
export function isEmptyResult(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (t.length === 0) return true;
  if (!/[a-z0-9]/i.test(t)) return true;
  return EMPTY_ANSWER_RE.test(t.replace(/\s+/g, " "));
}

/** Stable JSON: object keys sorted at every depth so arg order never matters. */
function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(",")}}`;
}

/** The identity of one tool call: name + canonical arguments. Pure. */
export function toolCallSignature(name: string, input: unknown): string {
  return `${name}:${stableJson(input ?? {})}`;
}

/** Identical calls allowed before the task is declared looping. */
export const MAX_IDENTICAL_TOOL_CALLS = 3;

export interface LoopVerdict {
  looped: boolean;
  /** How many times this exact call has now been requested. */
  count: number;
  signature: string;
  /** Plain-words reason when looped. */
  reason?: string;
}

/**
 * Counts identical tool calls across a task. The Nth identical request
 * (N = MAX_IDENTICAL_TOOL_CALLS) is a loop: the caller must NOT execute it and
 * must end the task failed with `reason`.
 */
export class ToolLoopDetector {
  private readonly seen = new Map<string, number>();
  constructor(private readonly maxIdentical: number = MAX_IDENTICAL_TOOL_CALLS) {}

  record(name: string, input: unknown): LoopVerdict {
    const signature = toolCallSignature(name, input);
    const count = (this.seen.get(signature) ?? 0) + 1;
    this.seen.set(signature, count);
    if (count >= this.maxIdentical) {
      return {
        looped: true,
        count,
        signature,
        reason: `loop detected: ${name} was requested ${count} times with identical arguments`,
      };
    }
    return { looped: false, count, signature };
  }
}

/** Per-task turn budgets. A business task that needs more is a stuck task. */
export const ROLE_WORKER_TURN_BUDGET = {
  writer: 6,
  support: 8,
  retention: 6,
  ops: 1,
} as const;

/**
 * The turn budget for a dispatch. Role workers get their role's budget; code
 * work keeps the platform DISPATCH_MAX_TURNS. Pure.
 */
export function turnBudgetFor(role: keyof typeof ROLE_WORKER_TURN_BUDGET | null): number {
  if (role && role in ROLE_WORKER_TURN_BUDGET) return ROLE_WORKER_TURN_BUDGET[role];
  return DISPATCH_MAX_TURNS;
}
