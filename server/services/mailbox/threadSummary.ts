/**
 * threadSummary — the one-line "what this thread is about" that sits above an
 * opened Inbox message (design-vision roadmap #2, Superhuman's auto-summary).
 *
 * Custody discipline (same rule as the rest of the mailbox stack): the message
 * body is fetched on-demand, summarized, and never written to the database.
 * The only thing we hold is a short, ephemeral in-memory cache of the derived
 * one-liner, keyed by message id — so re-opening the same message inside an
 * instance's lifetime doesn't re-bill the model. It evaporates on restart and
 * is bounded so it can't grow without limit.
 *
 * Cost discipline: runs on the cheapest tier (SIMPLE → deepseek), caps the
 * input it feeds the model, and asks for a single sentence. A blank body just
 * yields an empty summary — we never call the model with nothing to read.
 */

import { routeAITask, TaskComplexity } from "../aiRouter";
import type { FullMessage } from "./mailboxClient";

// Bound the text handed to the model so a giant newsletter can't run up cost.
const MAX_INPUT_CHARS = 4000;
// Bound the ephemeral cache so it can't grow without limit on a long-lived box.
const MAX_CACHE_ENTRIES = 500;

/**
 * Strip HTML to readable plain text. Pure and dependency-free: drop script and
 * style blocks wholesale, turn tags into spaces, decode the handful of common
 * entities, and collapse whitespace. Good enough to summarize from — this is
 * never rendered, only read by the model.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // &amp; MUST be decoded last: doing it first would let "&amp;lt;" collapse
    // to "&lt;" and then to "<" — a double-unescape. Decoding it here means a
    // literal "&lt;" the sender wrote survives as text.
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build the capped text the model reads from a full message. Prefers the plain
 * body, falls back to stripped HTML, then the snippet. Pure — no network.
 */
export function buildSummaryInput(msg: {
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  snippet?: string;
}): string {
  const body =
    (msg.bodyText && msg.bodyText.trim()) ||
    (msg.bodyHtml && htmlToPlainText(msg.bodyHtml)) ||
    (msg.snippet && msg.snippet.trim()) ||
    "";
  const subject = (msg.subject ?? "").trim();
  const combined = subject ? `Subject: ${subject}\n\n${body}` : body;
  return combined.slice(0, MAX_INPUT_CHARS).trim();
}

// ── Ephemeral, bounded, in-memory summary cache (never persisted) ────────────
const cache = new Map<string, string>();

function cacheGet(key: string): string | undefined {
  const hit = cache.get(key);
  if (hit === undefined) return undefined;
  // Refresh recency: delete + re-set moves it to the end (LRU eviction order).
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheSet(key: string, value: string): void {
  cache.set(key, value);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Test-only: clear the ephemeral cache between cases. */
export function _clearSummaryCache(): void {
  cache.clear();
}

/**
 * Produce a one-line summary of a fetched message. Returns "" when there is
 * nothing meaningful to summarize (empty body) — the caller renders nothing in
 * that case rather than a hollow line. The summary is cached by message id for
 * the life of the process only.
 */
export async function summarizeThread(msg: FullMessage): Promise<string> {
  const cached = cacheGet(msg.id);
  if (cached !== undefined) return cached;

  const input = buildSummaryInput(msg);
  if (!input) {
    cacheSet(msg.id, "");
    return "";
  }

  const response = await routeAITask({
    taskType: "mailbox_thread_summary",
    complexity: TaskComplexity.SIMPLE, // cheapest tier — this is a glance, not analysis
    messages: [
      {
        role: "system",
        content:
          "You summarize a single email into ONE short sentence (max ~18 words) that tells the reader what it is and what, if anything, it asks of them. Be factual and specific. No preamble, no quotes, no trailing period-padding. If it's purely promotional, say so plainly.",
      },
      { role: "user", content: input },
    ],
    maxTokens: 60,
    temperature: 0.3,
  });

  const summary = response.content.replace(/^["']|["']$/g, "").trim();
  cacheSet(msg.id, summary);
  return summary;
}
