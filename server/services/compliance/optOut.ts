/**
 * Canonical SMS opt-out / opt-in detection — the ONE source of truth.
 *
 * Before this, two divergent keyword sets existed (tcpaCompliance.STOP_KEYWORDS
 * and smsService.SMS_STOP_WORDS), neither included "revoke", and both matched
 * only exact keywords — so "please stop texting me" was NOT honored. The FCC
 * tightened revocation rules in April 2025: a consumer may revoke consent by
 * ANY reasonable means, and it must be honored. TCPA statutory damages are
 * $500–$1,500 PER message, so a missed revocation is a company-ending event.
 *
 * We therefore bias to suppression: a false positive merely means we don't text
 * someone (no legal harm); a miss is catastrophic. Natural-language phrases are
 * kept unambiguous enough not to trip on common benign messages ("stop by my
 * office" does not match — only "stop texting/messaging/contacting" etc. do).
 *
 * Leaf module — imports nothing from the SMS/TCPA services, so both can depend
 * on it without a cycle.
 */

/** Exact opt-out keywords (CTIA/TCPA), now including revocation words. */
export const STOP_KEYWORDS: ReadonlySet<string> = new Set([
  "stop", "stopall", "unsubscribe", "cancel", "end", "quit",
  "optout", "opt-out", "revoke", "revokeconsent", "remove",
]);

// Internal to detectOptSignal — not part of this module's public surface.
const START_KEYWORDS: ReadonlySet<string> = new Set([
  "start", "yes", "unstop", "optin", "opt-in",
]);

/**
 * Unambiguous natural-language refusals. Each is specific enough that a benign
 * message is very unlikely to contain it; where a rare benign match is possible
 * ("take me off ..."), suppression is the safe outcome.
 */
const NL_REVOCATION_PHRASES: readonly string[] = [
  "stop texting", "stop messaging", "stop contacting", "stop sending", "stop calling",
  "quit texting", "quit messaging",
  "no more text", "no more messages", "no more calls",
  "do not text", "dont text", "do not contact", "dont contact",
  "do not message", "dont message", "do not call", "dont call",
  "remove me", "take me off", "unsubscribe me", "opt me out", "opt out",
  "leave me alone", "lose my number", "delete my number",
  "never contact me", "never text me", "never message me",
];

/**
 * Benign filler words that commonly surround a bare stop keyword without
 * changing its meaning ("please stop", "stop now", "pls stop"). A message whose
 * ONLY meaningful tokens are a stop keyword plus these is an opt-out — but a
 * token like "by"/"office" (as in "stop by my office") is NOT filler, so that
 * benign message never trips.
 */
const STOP_FILLER: ReadonlySet<string> = new Set([
  "please", "pls", "plz", "now", "asap", "immediately", "just", "me",
]);

/**
 * Classify an inbound SMS body as an opt-out, opt-in, or neither.
 * Exact-keyword match first (stripped to letters/hyphen), then unambiguous
 * natural-language refusal phrases.
 */
export function detectOptSignal(messageBody: string): "opt_out" | "opt_in" | null {
  if (!messageBody) return null;

  // Exact keyword: strip everything except letters and hyphen, then match.
  const compact = messageBody.trim().toLowerCase().replace(/[^a-z-]/g, "");
  if (STOP_KEYWORDS.has(compact)) return "opt_out";
  if (START_KEYWORDS.has(compact)) return "opt_in";

  // Natural-language refusal: normalize to spaced words, look for a phrase.
  const phrase = messageBody.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (NL_REVOCATION_PHRASES.some((p) => phrase.includes(p))) return "opt_out";

  // Bare stop keyword surrounded ONLY by benign filler ("please stop",
  // "stop now", "pls stop") — a very common revocation the exact-match path
  // misses because it compacts the whole message into one token. Require every
  // meaningful token to be a stop keyword or filler, so "stop by my office"
  // (contains non-filler "by"/"office") is never suppressed.
  const tokens = phrase.split(" ").filter(Boolean);
  if (
    tokens.length > 0 &&
    tokens.some((t) => STOP_KEYWORDS.has(t)) &&
    tokens.every((t) => STOP_KEYWORDS.has(t) || STOP_FILLER.has(t))
  ) {
    return "opt_out";
  }

  return null;
}
