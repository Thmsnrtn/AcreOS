/**
 * Refusals in plain words — the one rule, the one builder, the one checker.
 *
 * A refusal a person can read says three things: WHAT happened (or did not),
 * WHY, and WHAT UNLOCKS it. The simulation platform measured how often the
 * product managed that (2026-10-08 adversarial run): 1 of 23 refused or failed
 * runs the founder reads in Story, and 26 of 159 tool refusals a customer's Pax
 * relays. The rest were `{"success":false,"error":"Lead 5 not found"}` and
 * `terminated: empty_result — Nothing further to add.`
 *
 * This module is browser-safe (no process.env, no node imports): the server
 * builds refusals with it, the client renders them, and the gates
 * (tests/unit/refusalsArePlainWords.test.ts) and the red-team world scorer
 * (tests/simulation/redteam/world.ts) judge them with the SAME checker, so the
 * product and its measurement cannot drift apart.
 *
 * It sits beside the HTTP refusal builders in server/utils/firstRunRefusals.ts
 * (`refuseCreditShortage`, `refusePaxCredits`, the #335 helpers), which carry
 * the same three parts as `message` + `details.nextStep`.
 */

export interface RefusalParts {
  /** What happened, as a sentence: "No lead #5 is in this account." */
  what: string;
  /** Why, as a sentence: "It may have been deleted, or the number is from another list." */
  why: string;
  /** The way forward, as a sentence starting with what to do: "Search your leads by name to find the right one." */
  unlock: string;
}

function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return "";
  const capped = t[0].toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(capped) ? capped : `${capped}.`;
}

/** "What. Why. Unlock." — each part made a sentence. */
export function plainRefusal(parts: RefusalParts): string {
  return [parts.what, parts.why, parts.unlock].map(sentence).filter(Boolean).join(" ");
}

/**
 * Raw shapes that are never plain words. Each is a way a refusal reached a
 * person in this repo's history.
 */
const RAW_SHAPES: Array<[RegExp, string]> = [
  [/^\s*[{[]/, "is a JSON body, not a sentence"],
  [/\b[a-z]+(?:_[a-z0-9]+)+\b/, "contains a code identifier (snake_case)"],
  [/\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/, "contains an error code (SCREAMING_CASE)"],
  [/\b(?:Error|TypeError|ReferenceError):\s/, "contains an exception name"],
  [/\bat\s+\S+\s+\(|\.(?:ts|js|mjs):\d+/, "contains a stack trace"],
  [/\b(?:undefined|null|NaN)\b|\[object Object\]/, "contains a programming value"],
  [/\bstatus(?: code)? \d{3}\b|\bHTTP \d{3}\b|\b(?:ECONNREFUSED|ETIMEDOUT)\b/i, "contains a transport status"],
  [/^\s*\w+(?:[ -]\w+)?:\s/, "starts with a log-style 'label:' prefix"],
];

/** Words a customer or a non-technical founder would not use for "what happened". */
const REFUSAL_JARGON = [
  "terminated", "payload", "exception", "schema", "endpoint", "enum", "stack trace", "nominatim",
  "dispatch", "worker", "reaped", "orphaned", "dead-letter", "transient", "upstream", "unauthorized",
  "forbidden", "invalid input", "validation failed", "failed validation", "required field", "filter required",
  "not configured", "internal error", "unknown fix type", "unknown entity", "unknown issue type",
];

/**
 * The first word of a sentence that tells the reader what to do next, or a
 * phrase that names when it unlocks. A refusal with none of these is a wall.
 */
const UNLOCK_CUES =
  /(?:^|[.!?]\s+|,\s+(?:or|and)\s+|—\s*)(?:add|ask|open|check|try|search|pick|choose|connect|upgrade|contact|use|create|import|invite|set up|turn on|turn off|reply|wait|go to|visit|update|enter|confirm|record|give|send|switch|remove|call|review|approve|run|retry|save|attach|fill in|share|tell|keep|start|sign in|reconnect|look|read|resend|buy|top up|change|resume|say|tell me|describe|paste|let me|sign up|log in|name|tap|answer|set|leave|end|act|escalate|list|rewrite|write|refund|email|text|mail|find|move|attach|go back|queue)\b/i;
const UNLOCK_PHRASES =
  /\b(?:to unlock|unlocks? (?:it|this)|once (?:you|it|the|your)|when (?:you|it|the|your)|you can\b|you'll need to|nothing (?:to do|else is needed)|it will (?:retry|run|try) again|will run again|is retried|(?:a person|someone|the team|our team|we) will (?:review|look|reply|get back|do it|follow up)|will hear back)\b/i;

export interface PlainVerdict {
  plain: boolean;
  problems: string[];
}

/**
 * Is this refusal readable by a person: whole sentences, no codes or
 * programming values, no jargon, and a way forward.
 */
export function judgeRefusal(text: string): PlainVerdict {
  const s = (text ?? "").trim();
  const problems: string[] = [];
  if (s.length < 30) problems.push("too short to say what happened, why and what unlocks it");
  for (const [re, why] of RAW_SHAPES) if (re.test(s)) problems.push(why);
  const lower = s.toLowerCase();
  for (const j of REFUSAL_JARGON) if (new RegExp(`\\b${j.replace(/[-]/g, "[- ]")}\\b`, "i").test(lower)) problems.push(`uses the jargon word "${j}"`);
  const sentences = s.split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 0);
  if (sentences.length < 2) problems.push("is one sentence — it needs what happened and what unlocks it");
  if (!UNLOCK_CUES.test(s) && !UNLOCK_PHRASES.test(s)) problems.push("names no way forward (what to do, or when it unlocks)");
  return { plain: problems.length === 0, problems };
}

/**
 * The human text inside what a tool returned to a model. Tool results are JSON
 * by protocol; the words a person ends up reading are the `error` (or
 * `message`) string, so that is what is judged. Plain text is judged as is.
 */
export function refusalTextOf(toolText: string): string {
  const t = (toolText ?? "").trim();
  if (!t.startsWith("{")) return t;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    for (const k of ["error", "message", "reason"]) if (typeof o[k] === "string" && (o[k] as string).trim()) return o[k] as string;
  } catch {
    /* not JSON after all — judged as is, and fails as raw */
  }
  return t;
}

/** A stored stage or status as words: "under_contract" → "under contract". */
export function plainStageWords(s: string): string {
  return String(s).replace(/_/g, " ");
}

// ── Tool results ────────────────────────────────────────────────────────────

/** A tool's refusal: `success: false` plus the plain sentence and its parts. */
export function toolRefusal(parts: RefusalParts): { success: false; error: string; refusal: RefusalParts } {
  return { success: false, error: plainRefusal(parts), refusal: parts };
}

/**
 * A tool that broke rather than refused. The raw exception text never goes in
 * the result — it is logged by the caller — because a model relays it to the
 * customer word for word ("Stripe sync failed: Request was retried 3 times").
 */
export function toolFailure(what: string, unlock = "Try again in a minute; if it keeps happening, open a support ticket and we will look."): {
  success: false;
  error: string;
  refusal: RefusalParts;
} {
  return toolRefusal({ what, why: "The system hit a problem on our side; nothing about your account caused it", unlock });
}

// ── Dispatch outcomes (what the founder reads about refused or failed work) ─

/**
 * Every way a run of Solene's or a role worker's can stop, in the founder's
 * words. Keyed by the `terminationReason` unions in
 * server/services/solene/dispatchRunner.ts and roleWorkers/runner.ts — the
 * gate parses both unions and fails on a reason that projects to the generic
 * sentence (GENERIC_STOP) instead of its own.
 */
const RUN_STOP_WORDS: Record<string, RefusalParts> = {
  end_turn: { what: "The run finished", why: "It reached the end of the job", unlock: "Nothing to do" },
  max_turns: { what: "The run stopped before finishing", why: "It used every step it is allowed for one job without completing it", unlock: "Open it to see how far it got, then run it again from Controls with a narrower ask" },
  cost_cap: { what: "The run stopped before finishing", why: "It reached the spending cap set for a single job", unlock: "Run it again from Controls, or raise that job's cap there if it is worth more" },
  timeout: { what: "The run stopped before finishing", why: "It ran past the time a single job is allowed", unlock: "It will run again on the next pass; if it keeps stopping, narrow the ask in Controls" },
  error: { what: "The run broke before finishing", why: "Something on the system side failed while it worked", unlock: "It will try again on the next pass; if it keeps breaking, open it to see the details" },
  missing_api_key: { what: "The run could not start", why: "The AI service it uses has no key connected", unlock: "Connect the key under Settings, then run it again from Controls" },
  platform_cost_ceiling: { what: "The run did not start", why: "This month's AI spending ceiling for the whole platform is reached", unlock: "It will run again when the ceiling resets, or raise the ceiling in Controls" },
  ensemble_monthly_cap: { what: "The run did not start", why: "This month's budget for second-opinion checks is used up", unlock: "It will run again next month, or raise that budget in Controls" },
  aborted: { what: "The run was stopped part-way", why: "It was cancelled while it was working, by you or by the stop switch", unlock: "Run it again from Controls if it still matters" },
  empty_result: { what: "The run ended without doing anything", why: "It finished without producing any work for the items waiting for it", unlock: "Nothing changed because of it; it will try again on the next pass, and you can open it to see what it said" },
  loop_detected: { what: "The run was stopped", why: "It kept repeating the same step with the same input", unlock: "Open it to see where it got stuck, then run it again from Controls" },
  no_work: { what: "The run had nothing to do", why: "Nothing was waiting for it when it started", unlock: "Nothing to do" },
  no_publishable_artifact: { what: "Nothing was published", why: "The writer did not produce a finished piece in the form that can be published", unlock: "It will try again on the next pass; open it to read the draft" },
  publish_gate_blocked: { what: "Nothing was published", why: "The piece failed the publishing check for claims, links or made-up facts", unlock: "Open it to see what the check caught; it will try again with a new piece" },
};

/** The sentence for a stop reason with no words of its own. */
const GENERIC_STOP: RefusalParts = {
  what: "The run stopped before finishing",
  why: "It recorded a technical reason that has no plain description yet",
  unlock: "Open it to see the details, and run it again from Controls if it still matters",
};

/** A free-text reason a person typed (a cancel reason) is quoted, not judged. */
function quoted(reason: string): string {
  const r = reason.trim().replace(/\s+/g, " ").slice(0, 200);
  return r ? ` You wrote: “${r}”.` : "";
}

/**
 * The founder-facing sentence for a dispatch row's outcome. `status` is the
 * queue status; `summary` is the stored `result_summary` (internal, kept for
 * the audit trail). Rows that did not fail or get cancelled return null — they
 * are shown by their result, not as a refusal.
 */
export function dispatchOutcomeInWords(status: string, summary: string | null | undefined): string | null {
  if (status !== "failed" && status !== "cancelled") return null;
  let s = (summary ?? "").trim();
  const deadLettered = s.startsWith("[dead-letter]");
  if (deadLettered) s = s.slice("[dead-letter]".length).trim();
  if (/^cancelled by founder\b/i.test(s)) {
    return plainRefusal({ what: "You cancelled this run before it started", why: "It was taken off the queue, so nothing ran", unlock: "Queue it again from Controls if you still want it" }) + quoted(s.replace(/^cancelled by founder:?/i, ""));
  }
  if (/^cancelled:/i.test(s) || status === "cancelled") {
    return plainRefusal({ what: "This run was cancelled", why: "The stop switch or a cancel from Controls took it off the queue", unlock: "Queue it again from Controls if it still matters" });
  }
  if (/^aborted in flight:/i.test(s)) return plainRefusal(RUN_STOP_WORDS.aborted);
  if (/^reaped:/i.test(s)) {
    return plainRefusal({ what: "The run was lost part-way", why: "The machine running it restarted before it finished", unlock: "It will run again on the next pass; nothing needs doing unless it keeps happening" });
  }
  const term = /^terminated:\s*([a-z_]+)/i.exec(s)?.[1]?.toLowerCase();
  const parts = (term && RUN_STOP_WORDS[term]) || GENERIC_STOP;
  const text = plainRefusal(parts);
  return deadLettered ? `${text} It has failed every retry, so it will not try again by itself.` : text;
}
