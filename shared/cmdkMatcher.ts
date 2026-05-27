/**
 * ⌘K v2 client-side re-rank matcher (Phase 4 Week 19-20 / Anya §2-§7).
 *
 * Server-side fuzzy search via pg_trgm (Wave 8) gives us the candidate
 * list. This module re-ranks (and supplements) those candidates with a
 * cheap multi-signal scorer that runs at every keystroke without a
 * round-trip:
 *
 *   • Exact match              — query equals title (case-insensitive)
 *   • Prefix                   — title starts with query
 *   • Substring                — title contains query
 *   • Acronym                  — "tdc" matches "Tax Delinquent Counties"
 *   • Bigram overlap (Dice)    — soft fuzzy on misspellings ("leaf" / "leaflet")
 *   • Recency                  — ids the user clicked in the last 7 days
 *   • Verb boost               — verb actions float when the query reads
 *                                like an imperative ("send", "new", ...)
 *
 * All scoring is pure & deterministic so we can unit-test it from
 * `tests/unit/cmdkMatcher.test.ts` (`shared/` is in the vitest include
 * list; `client/` is excluded).
 *
 * Score range: [0, 1] for matches; -Infinity for non-matches.
 */

export interface MatchableItem {
  /** Stable id used for recency lookups. */
  id: string;
  /** Primary text the user is searching against. */
  title: string;
  /** Optional secondary text (subtitle, email, phone, ...). */
  subtitle?: string;
  /** Optional explicit keywords to include in the searchable haystack. */
  keywords?: readonly string[];
  /** Pre-computed kind flag — verbs get an imperative-query boost. */
  kind?: "verb" | "page" | "lead" | "property" | "deal" | "founder" | "other";
}

export interface ScoredMatch<T extends MatchableItem> {
  item: T;
  score: number;
  /** Per-signal breakdown — exposed for debugging + tests. */
  breakdown: {
    exact: number;
    prefix: number;
    substring: number;
    acronym: number;
    bigram: number;
    recency: number;
    verbBoost: number;
  };
}

/** Recent-click record persisted in localStorage. */
export interface RecencyEntry {
  id: string;
  /** Unix ms. */
  at: number;
}

/** 7-day decay window for recency scoring. */
export const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const VERB_LEAD_TOKENS = new Set([
  "add", "new", "send", "run", "skip", "mark", "close",
  "archive", "delete", "export", "import", "switch", "create",
  "edit", "save", "share", "copy", "restore", "qualify", "dismiss",
  "assign", "advance", "reopen", "call",
]);

// ── normalization ────────────────────────────────────────────────────────

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Tokenize on whitespace + punctuation. Empty-strings filtered. */
export function tokenize(s: string): string[] {
  return normalize(s).split(/[\s\-_./,()]+/).filter(Boolean);
}

// ── bigram / Dice coefficient ────────────────────────────────────────────

export function bigrams(s: string): string[] {
  const n = normalize(s).replace(/\s+/g, "");
  if (n.length < 2) return n.length === 1 ? [n] : [];
  const out: string[] = [];
  for (let i = 0; i < n.length - 1; i++) out.push(n.slice(i, i + 2));
  return out;
}

/**
 * Dice coefficient of bigram sets.
 * 2 * |intersection| / (|a| + |b|). Returns 0 for empty inputs.
 */
export function diceCoefficient(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  // Multiset intersection — count occurrences.
  const map = new Map<string, number>();
  for (const g of A) map.set(g, (map.get(g) ?? 0) + 1);
  let inter = 0;
  for (const g of B) {
    const c = map.get(g) ?? 0;
    if (c > 0) {
      inter++;
      map.set(g, c - 1);
    }
  }
  return (2 * inter) / (A.length + B.length);
}

// ── acronym matching ─────────────────────────────────────────────────────

/**
 * "tdc" matches "tax delinquent counties" → 1.0.
 * Partial acronym ("td" against same) → 0.66.
 * Returns 0 if the query letters don't appear as a prefix subsequence
 * across token starts.
 */
export function acronymScore(query: string, target: string): number {
  const q = normalize(query).replace(/\s+/g, "");
  if (!q || q.length < 2) return 0;
  const tokens = tokenize(target);
  if (tokens.length < 2) return 0;
  // Walk query letters; each must match the next token's first letter.
  let qi = 0;
  let ti = 0;
  while (qi < q.length && ti < tokens.length) {
    if (tokens[ti][0] === q[qi]) {
      qi++;
      ti++;
    } else {
      // Allow skipping target tokens — but only if we've already matched
      // at least one. Strict prefix-acronym otherwise.
      if (qi === 0) return 0;
      ti++;
    }
  }
  if (qi === 0) return 0;
  // Score = matched-letters / max(tokens.length, q.length)
  return qi / Math.max(tokens.length, q.length);
}

// ── recency ──────────────────────────────────────────────────────────────

/**
 * Linear decay from 1.0 (just clicked) to 0.0 (window edge).
 * Items outside RECENCY_WINDOW_MS contribute nothing.
 */
export function recencyScore(
  id: string,
  recents: readonly RecencyEntry[],
  now: number,
): number {
  const entry = recents.find((r) => r.id === id);
  if (!entry) return 0;
  const age = now - entry.at;
  if (age < 0 || age > RECENCY_WINDOW_MS) return 0;
  return 1 - age / RECENCY_WINDOW_MS;
}

// ── core scoring ─────────────────────────────────────────────────────────

export interface ScoreOptions {
  recents?: readonly RecencyEntry[];
  now?: number;
  /** Weights override — primarily for tests. */
  weights?: Partial<Weights>;
}

interface Weights {
  exact: number;
  prefix: number;
  substring: number;
  acronym: number;
  bigram: number;
  recency: number;
  verbBoost: number;
  /** Threshold below which an item is filtered out as a non-match. */
  cutoff: number;
}

const DEFAULT_WEIGHTS: Weights = {
  exact: 1.0,
  prefix: 0.6,
  substring: 0.45,
  acronym: 0.55,
  bigram: 0.4,
  recency: 0.25,
  verbBoost: 0.15,
  cutoff: 0.12,
};

/**
 * Heuristic: query reads like an imperative if its first token is in
 * VERB_LEAD_TOKENS. Used to boost verb items above pages.
 */
export function looksImperative(query: string): boolean {
  const first = tokenize(query)[0];
  return !!first && VERB_LEAD_TOKENS.has(first);
}

export function scoreItem<T extends MatchableItem>(
  query: string,
  item: T,
  opts: ScoreOptions = {},
): ScoredMatch<T> {
  const W = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
  const q = normalize(query);
  const haystack = [
    item.title,
    item.subtitle ?? "",
    ...(item.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  const h = normalize(haystack);

  const breakdown = {
    exact: 0,
    prefix: 0,
    substring: 0,
    acronym: 0,
    bigram: 0,
    recency: 0,
    verbBoost: 0,
  };

  if (!q) {
    // No query — score by recency only (sortable for "recent" surfacing).
    breakdown.recency = recencyScore(item.id, opts.recents ?? [], opts.now ?? Date.now());
    return { item, score: breakdown.recency * W.recency, breakdown };
  }

  if (h === q) breakdown.exact = 1;
  if (h.startsWith(q)) breakdown.prefix = 1;
  if (h.includes(q)) breakdown.substring = 1;
  // Substring also fires for any token starting with q.
  if (!breakdown.substring) {
    for (const tok of tokenize(haystack)) {
      if (tok.startsWith(q)) {
        breakdown.substring = 0.85;
        break;
      }
    }
  }
  breakdown.acronym = acronymScore(q, item.title);
  breakdown.bigram = diceCoefficient(q, item.title);
  // Subtitle gets half-weight bigram contribution if it lifts the score.
  if (item.subtitle) {
    const subBi = diceCoefficient(q, item.subtitle) * 0.5;
    if (subBi > breakdown.bigram) breakdown.bigram = subBi;
  }
  breakdown.recency = recencyScore(
    item.id,
    opts.recents ?? [],
    opts.now ?? Date.now(),
  );
  if (item.kind === "verb" && looksImperative(query)) {
    breakdown.verbBoost = 1;
  }

  const score =
    breakdown.exact * W.exact +
    breakdown.prefix * W.prefix +
    breakdown.substring * W.substring +
    breakdown.acronym * W.acronym +
    breakdown.bigram * W.bigram +
    breakdown.recency * W.recency +
    breakdown.verbBoost * W.verbBoost;

  return { item, score, breakdown };
}

/**
 * Score + filter + sort an item list. Items below the cutoff weight are
 * dropped unless `keepAll` is true.
 */
export function rankItems<T extends MatchableItem>(
  query: string,
  items: readonly T[],
  opts: ScoreOptions & { keepAll?: boolean } = {},
): ScoredMatch<T>[] {
  const W = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
  const scored = items.map((it) => scoreItem(query, it, opts));
  const filtered = opts.keepAll
    ? scored
    : scored.filter((s) => s.score >= W.cutoff);
  filtered.sort((a, b) => b.score - a.score);
  return filtered;
}

// ── entity resolution helpers ────────────────────────────────────────────

const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/;

export function detectEntity(query: string): { kind: "email" | "phone"; value: string } | null {
  const trimmed = query.trim();
  const email = trimmed.match(EMAIL_RE);
  if (email) return { kind: "email", value: email[0].toLowerCase() };
  const phone = trimmed.match(PHONE_RE);
  if (phone) {
    const digits = phone[0].replace(/\D/g, "");
    if (digits.length >= 7) return { kind: "phone", value: digits };
  }
  return null;
}

// ── ask-Pax detection ────────────────────────────────────────────────────

const QUESTION_LEADS = ["what", "why", "how", "when", "where", "who", "should", "can", "is", "are", "does"];

export function looksLikeQuestion(query: string): boolean {
  const t = query.trim();
  if (!t) return false;
  if (t.endsWith("?")) return true;
  const first = tokenize(t)[0];
  return !!first && QUESTION_LEADS.includes(first);
}

// ── scope-chip parser ────────────────────────────────────────────────────

// IA consolidation (Lens 4 Fix 3): "founder" scope added when the
// ⌘⇧K founder palette merged into ⌘K. Consumers that render scope
// chips MUST filter "founder" through `isFounder` from useAuth() so
// non-founder users never see the chip or its results.
export type Scope = "leads" | "deals" | "properties" | "inbox" | "settings" | "founder";
export const VALID_SCOPES: readonly Scope[] = [
  "leads",
  "deals",
  "properties",
  "inbox",
  "settings",
  "founder",
];

/**
 * Parse a leading scope chip from the query.
 * `:leads john` → { scope: "leads", remainder: "john" }
 * `john`        → { scope: null, remainder: "john" }
 */
export function parseScope(query: string): { scope: Scope | null; remainder: string } {
  const m = query.match(/^\s*:([a-z]+)\b\s*(.*)$/i);
  if (!m) return { scope: null, remainder: query };
  const candidate = m[1].toLowerCase() as Scope;
  if (!VALID_SCOPES.includes(candidate)) {
    return { scope: null, remainder: query };
  }
  return { scope: candidate, remainder: m[2] };
}
