/**
 * ofacScreening — OFAC/sanctions ADVISORY counterparty screening.
 *
 * ⚠️  ADVISORY ONLY — NOT A LEGAL DETERMINATION ⚠️
 * ───────────────────────────────────────────────
 * This module screens a counterparty NAME (e.g. a borrower or seller on a deal
 * or note) against an OFAC SDN-style sanctions list and records a structured
 * ADVISORY result. It is NOT, and must never be represented as:
 *   - a legal determination that a person is or is not sanctioned,
 *   - evidence of a compliant sanctions-screening program, or
 *   - a substitute for manual review by a qualified human.
 *
 * A `potential_match` raises a FOUNDER-VISIBLE FLAG for MANUAL review. It does
 * NOT block the originating action. A human MUST review every potential match
 * before drawing any conclusion. Copy presented to operators must say:
 *   "Advisory screening, not a legal determination — review matches manually."
 *
 * What this is
 * ────────────
 * A self-contained fuzzy name-matcher: it normalizes the screened name and each
 * candidate SDN-style entry, computes a 0..1 similarity score (token-aware
 * Jaccard + Jaro-Winkler blend), and buckets the best score into
 * clear / potential_match. Results persist to `sanctions_screenings`
 * (org-scoped).
 *
 * Data source
 * ───────────
 * In production this screens against the LIVE cached OFAC list in
 * `sanctions_list_entries`, refreshed DAILY from the public U.S. Treasury data
 * files (SDN + Consolidated) by server/services/compliance/sanctionsListSync.ts.
 * `loadSanctionsEntries()` reads that table.
 *
 * It KEEPS a SMALL BUNDLED FIXTURE (a handful of well-known OFAC SDN names) as a
 * deterministic FALLBACK: it is used when the live table is empty (e.g. the
 * sync job hasn't run yet, or a fresh/empty DB) and is the default for unit
 * tests, so the engine always works out of the box and stays testable without a
 * live list. The matched result carries provenance: which list it came from and
 * the list's `listPublishedAt` ("current as of") date when available.
 *
 * Privacy
 * ───────
 * We persist only the screened NAME (display) — no other counterparty PII.
 * Logs record the match DECISION (result + rounded score), never the raw name
 * or full payload.
 */

import { eq, and, desc, isNull } from "drizzle-orm";
import { db } from "../../db";
import {
  sanctionsScreenings,
  sanctionsListEntries,
  type SanctionsScreening,
} from "@shared/schema";
import { logger } from "../../utils/logger";

export const OFAC_ENGINE_VERSION = "v1";

/**
 * Default score threshold (0..1). A best-match score AT OR ABOVE this is
 * bucketed as `potential_match`. Deliberately conservative-leaning: false
 * positives (extra manual reviews) are far cheaper than a missed name, and a
 * human reviews every hit anyway. Override per-call for tuning.
 */
export const DEFAULT_MATCH_THRESHOLD = 0.82;

export type ScreeningResultBucket = "clear" | "potential_match" | "error";

export interface SanctionsEntry {
  /** Display name exactly as it appears on the source list. */
  name: string;
  /** OFAC program code(s), e.g. "SDNTK", "SDGT", "IRAN". */
  program?: string;
  /** List identifier, e.g. "SDN", "CONSOLIDATED", or "bundled-fixture". */
  source?: string;
  /** AKA / alternate names — matched alongside the primary name. */
  aliases?: string[];
  /**
   * When the source list version was published (provenance). Surfaced as
   * "list current as of …" so a reviewer knows which list version matched.
   */
  listPublishedAt?: Date | null;
}

export interface ScreeningOutcome {
  result: ScreeningResultBucket;
  /** 0..1 best similarity score across all candidate entries. */
  score: number;
  threshold: number;
  /** The best-matching entry, when result === "potential_match". */
  matchedEntry: SanctionsEntry | null;
  engineVersion: string;
  /** Which list the best match came from ("SDN" | "CONSOLIDATED" | fixture). */
  listSource: string;
  /**
   * Provenance: the matched list's published date, when known. Surface as
   * "list current as of {listPublishedAt}". Null for the fixture or when the
   * Treasury record carried no parseable date.
   */
  listPublishedAt: Date | null;
}

// ─── Bundled fixture list ─────────────────────────────────────────────────────
// A SMALL illustrative subset of OFAC SDN-style names. NOT the full list. The
// names below are publicly-listed OFAC SDN individuals/entities, included only
// so the engine functions and is testable out of the box. Replace/extend via
// loadSanctionsEntries().
const BUNDLED_FIXTURE_ENTRIES: SanctionsEntry[] = [
  { name: "Joaquin Archivaldo Guzman Loera", program: "SDNTK", source: "bundled-fixture" },
  { name: "Semion Mogilevich", program: "TCO", source: "bundled-fixture" },
  { name: "Dawood Ibrahim Kaskar", program: "SDGT", source: "bundled-fixture" },
  { name: "Viktor Bout", program: "SDNTK", source: "bundled-fixture" },
  { name: "Ali Akbar Tabatabaei", program: "IRAN", source: "bundled-fixture" },
  { name: "Konstantin Malofeyev", program: "UKRAINE-EO13660", source: "bundled-fixture" },
  { name: "Tango Eight Trading Company", program: "NPWMD", source: "bundled-fixture" },
  { name: "Bank Melli Iran", program: "IRAN", source: "bundled-fixture" },
];

/**
 * Load the candidate sanctions entries the matcher screens against.
 *
 * PRODUCTION: reads the LIVE cached OFAC list from `sanctions_list_entries`
 * (refreshed daily from the public Treasury SDN + Consolidated data files by
 * server/services/compliance/sanctionsListSync.ts). The hash-only
 * `sanctions_list` table cannot back a fuzzy matcher — this cleartext reference
 * table can.
 *
 * FALLBACK: if the live table is empty (sync job hasn't run yet / fresh DB) or
 * the read fails, returns the BUNDLED FIXTURE so the engine always works and
 * stays unit-testable. The fixture is also what unit tests use by default.
 *
 * Logs only counts — never the candidate names.
 */
export async function loadSanctionsEntries(): Promise<SanctionsEntry[]> {
  try {
    const rows = await db
      .select({
        primaryName: sanctionsListEntries.primaryName,
        programs: sanctionsListEntries.programs,
        sourceList: sanctionsListEntries.sourceList,
        aliases: sanctionsListEntries.aliases,
        listPublishedAt: sanctionsListEntries.listPublishedAt,
      })
      .from(sanctionsListEntries);

    if (rows.length === 0) {
      logger.info("[ofacScreening] live sanctions_list_entries empty — using bundled fixture", {
        metadata: { entries: BUNDLED_FIXTURE_ENTRIES.length },
      });
      return BUNDLED_FIXTURE_ENTRIES;
    }

    return rows.map((r) => ({
      name: r.primaryName,
      program: Array.isArray(r.programs) && r.programs.length > 0 ? r.programs.join(", ") : undefined,
      source: r.sourceList,
      aliases: Array.isArray(r.aliases) ? r.aliases : [],
      listPublishedAt: r.listPublishedAt ?? null,
    }));
  } catch (err) {
    // Never let a data-load error break a screen — fall back to the fixture.
    logger.warn("[ofacScreening] live list load failed — using bundled fixture", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return BUNDLED_FIXTURE_ENTRIES;
  }
}

// ─── Name normalization + similarity ─────────────────────────────────────────

/**
 * Normalize a name for matching: NFKD (strip diacritics), lowercase, drop
 * common org suffixes/honorifics, collapse to alphanumeric tokens. Returns the
 * sorted unique token set joined by single spaces so word-order differences
 * ("Guzman Joaquin" vs "Joaquin Guzman") don't depress the score.
 */
const NAME_STOPWORDS = new Set<string>([
  "mr", "mrs", "ms", "dr", "the", "of", "and",
  "co", "inc", "llc", "ltd", "company", "corp", "corporation",
  "trading", "group", "holding", "holdings", "aka", "fka",
]);

export function normalizeName(raw: string): string {
  return normalizeTokens(raw).join(" ");
}

export function normalizeTokens(raw: string): string[] {
  const cleaned = (raw || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  const tokens = cleaned
    .split(" ")
    .filter((t) => t.length > 0 && !NAME_STOPWORDS.has(t));
  // De-dup + sort for order-independence.
  return Array.from(new Set(tokens)).sort();
}

/** Jaro-Winkler string similarity (0..1). Order-sensitive; used per-string. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  // Count transpositions.
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions) / m) / 3;

  // Winkler boost for a common prefix (up to 4 chars).
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Token-alignment similarity (0..1): greedily pair each token of the SHORTER
 * name with its best Jaro-Winkler match in the LONGER name (without reuse), and
 * average those per-token scores. This tolerates a typo INSIDE a token
 * ("Bout" vs "Buot") that an exact-token Jaccard would treat as a full miss,
 * while still being word-order independent (tokens are matched, not positional).
 *
 * Dividing by the LONGER token count means extra unmatched tokens in the longer
 * name pull the score down — but a full subset of the longer name's tokens
 * still scores reasonably, which is the advisory bias we want.
 */
function tokenAlignmentScore(ta: string[], tb: string[]): number {
  const shorter = ta.length <= tb.length ? ta : tb;
  const longer = ta.length <= tb.length ? tb : ta;
  const used = new Array<boolean>(longer.length).fill(false);
  let total = 0;
  for (const tok of shorter) {
    let best = 0;
    let bestIdx = -1;
    for (let j = 0; j < longer.length; j++) {
      if (used[j]) continue;
      const s = jaroWinkler(tok, longer[j]);
      if (s > best) {
        best = s;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0) used[bestIdx] = true;
    total += best;
  }
  // Average over the SHORTER count rewards subset matches; we then damp by the
  // fraction of the longer name that went matched so a screened single token
  // doesn't fully match a multi-token entry.
  const perTokenAvg = shorter.length === 0 ? 0 : total / shorter.length;
  const coverage = longer.length === 0 ? 0 : shorter.length / longer.length;
  // Blend: mostly the per-token quality, lightly weighted by coverage.
  return perTokenAvg * 0.8 + perTokenAvg * coverage * 0.2;
}

/**
 * Compute a 0..1 similarity between two names. Blends:
 *   - token-set Jaccard (exact-token overlap, word-order independent),
 *   - Jaro-Winkler over the joined normalized strings (whole-string typos), and
 *   - token-ALIGNMENT score (per-token typo tolerance).
 * Takes the MAX of the blend and the alignment score so a single-token typo is
 * still caught — advisory bias toward flagging near-misses for human review.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = normalizeTokens(a);
  const tb = normalizeTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;

  // Token-set Jaccard.
  const setA = new Set(ta);
  const setB = new Set(tb);
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  const jaccard = union === 0 ? 0 : intersection / union;

  // Jaro-Winkler over the joined normalized strings.
  const jw = jaroWinkler(ta.join(" "), tb.join(" "));

  // Token-alignment (per-token typo tolerance).
  const alignment = tokenAlignmentScore(ta, tb);

  // If every token of the shorter name is present EXACTLY in the longer (subset
  // match), floor the score high — a screened "Viktor Bout" fully contained in
  // a list "Viktor Anatolyevich Bout" should score as a strong potential match.
  const smaller = setA.size <= setB.size ? setA : setB;
  const larger = setA.size <= setB.size ? setB : setA;
  let subset = true;
  for (const t of smaller) if (!larger.has(t)) { subset = false; break; }

  const blend = (jaccard + jw) / 2;
  const best = Math.max(blend, alignment);
  if (subset && smaller.size >= 2) {
    return Math.max(best, 0.9);
  }
  return best;
}

// ─── Screening engine ─────────────────────────────────────────────────────────

export interface ScreenNameOptions {
  threshold?: number;
  entries?: SanctionsEntry[];
}

/**
 * Best similarity of `name` against an entry — scores the entry's PRIMARY name
 * and every ALIAS, returning the max. An AKA match should flag just as a
 * primary-name match would (advisory bias toward human review).
 */
function entrySimilarity(name: string, entry: SanctionsEntry): number {
  let best = nameSimilarity(name, entry.name);
  if (entry.aliases && entry.aliases.length > 0) {
    for (const alias of entry.aliases) {
      const s = nameSimilarity(name, alias);
      if (s > best) best = s;
    }
  }
  return best;
}

/**
 * Pure screening: score the name against every candidate entry (primary name +
 * aliases) and bucket the best score. No external I/O when `entries` is
 * supplied — unit-testable in isolation. Provenance (which list + the list's
 * published date) is taken from the BEST-matching entry.
 */
export async function screenName(
  name: string,
  options: ScreenNameOptions = {},
): Promise<ScreeningOutcome> {
  const threshold = options.threshold ?? DEFAULT_MATCH_THRESHOLD;
  const entries = options.entries ?? (await loadSanctionsEntries());
  const defaultSource = entries[0]?.source ?? "bundled-fixture";

  if (!name || normalizeTokens(name).length === 0) {
    return {
      result: "clear",
      score: 0,
      threshold,
      matchedEntry: null,
      engineVersion: OFAC_ENGINE_VERSION,
      listSource: defaultSource,
      listPublishedAt: null,
    };
  }

  let bestScore = 0;
  let bestEntry: SanctionsEntry | null = null;
  for (const entry of entries) {
    const score = entrySimilarity(name, entry);
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  const isMatch = bestScore >= threshold && bestEntry != null;
  return {
    result: isMatch ? "potential_match" : "clear",
    score: bestScore,
    threshold,
    matchedEntry: isMatch ? bestEntry : null,
    engineVersion: OFAC_ENGINE_VERSION,
    // Provenance reflects the matched entry's own list; fall back to the
    // dataset's default source when there's no match.
    listSource: isMatch ? bestEntry?.source ?? defaultSource : defaultSource,
    listPublishedAt: isMatch ? bestEntry?.listPublishedAt ?? null : null,
  };
}

export interface PersistScreeningInput {
  organizationId: number;
  subjectType: "lead" | "borrower" | "contact" | "ad_hoc";
  subjectId?: string | null;
  /** The counterparty name to screen (display form). */
  name: string;
  threshold?: number;
  entries?: SanctionsEntry[];
}

/**
 * Run an advisory screen and persist the result to `sanctions_screenings`.
 *
 * Returns the persisted row (or null if the write failed). NEVER throws — a
 * screening failure must not break the originating action. Logs the DECISION
 * (result + rounded score), never the raw screened name.
 */
export async function screenAndPersist(
  input: PersistScreeningInput,
): Promise<SanctionsScreening | null> {
  let outcome: ScreeningOutcome;
  try {
    outcome = await screenName(input.name, {
      threshold: input.threshold,
      entries: input.entries,
    });
  } catch (err) {
    logger.error(
      "[ofacScreening] screen failed",
      err instanceof Error ? err : undefined,
      { metadata: { organizationId: input.organizationId, subjectType: input.subjectType } },
    );
    outcome = {
      result: "error",
      score: 0,
      threshold: input.threshold ?? DEFAULT_MATCH_THRESHOLD,
      matchedEntry: null,
      engineVersion: OFAC_ENGINE_VERSION,
      listSource: "bundled-fixture",
      listPublishedAt: null,
    };
  }

  try {
    const [row] = await db
      .insert(sanctionsScreenings)
      .values({
        organizationId: input.organizationId,
        subjectType: input.subjectType,
        subjectId: input.subjectId ?? null,
        screenedName: input.name,
        result: outcome.result,
        matchScore: outcome.score,
        matchedEntryName: outcome.matchedEntry?.name ?? null,
        matchedEntryProgram: outcome.matchedEntry?.program ?? null,
        listSource: outcome.listSource,
        engineVersion: outcome.engineVersion,
        threshold: outcome.threshold,
      })
      .returning();

    // Log the decision only — never the raw name.
    if (outcome.result === "potential_match") {
      logger.warn("[ofacScreening] advisory potential match — manual review required", {
        metadata: {
          organizationId: input.organizationId,
          subjectType: input.subjectType,
          subjectId: input.subjectId ?? null,
          score: Math.round(outcome.score * 100) / 100,
          program: outcome.matchedEntry?.program ?? null,
          screeningId: row?.id ?? null,
        },
      });
    }
    return row ?? null;
  } catch (err) {
    logger.error(
      "[ofacScreening] persist failed",
      err instanceof Error ? err : undefined,
      { metadata: { organizationId: input.organizationId, result: outcome.result } },
    );
    return null;
  }
}

/**
 * Fire-and-forget advisory screen. Wire this at counterparty creation/update
 * points — it never blocks and never throws. A potential match becomes a
 * founder-visible flag (an unreviewed `potential_match` row).
 */
export function screenCounterpartyAsync(input: PersistScreeningInput): void {
  void screenAndPersist(input).catch((err) => {
    logger.error(
      "[ofacScreening] async screen failed",
      err instanceof Error ? err : undefined,
      { metadata: { organizationId: input.organizationId } },
    );
  });
}

/**
 * Founder-visible flag query: open (unreviewed) potential matches for an org,
 * newest first. The advisory copy lives at the call site / UI; this just
 * returns the rows.
 */
export async function listOpenPotentialMatches(
  organizationId: number,
  limit = 50,
): Promise<SanctionsScreening[]> {
  return db
    .select()
    .from(sanctionsScreenings)
    .where(
      and(
        eq(sanctionsScreenings.organizationId, organizationId),
        eq(sanctionsScreenings.result, "potential_match"),
        isNull(sanctionsScreenings.reviewedAt),
      ),
    )
    .orderBy(desc(sanctionsScreenings.createdAt))
    .limit(limit);
}

/**
 * Copy shown to operators alongside any screening result. Centralized so the
 * advisory / non-legal framing is identical everywhere.
 */
export const SCREENING_ADVISORY_COPY =
  "Advisory screening against the current OFAC list, not a legal determination — review matches manually.";

/**
 * Human-readable provenance line for a screening outcome — "list current as of
 * {date}" — so a reviewer knows WHICH list version produced the match. Pair it
 * with SCREENING_ADVISORY_COPY in the UI. Falls back gracefully when the list's
 * published date is unknown (fixture or a date-less Treasury record).
 */
export function screeningProvenance(outcome: ScreeningOutcome): string {
  const list =
    outcome.listSource === "bundled-fixture"
      ? "bundled reference fixture"
      : `OFAC ${outcome.listSource} list`;
  if (outcome.listPublishedAt) {
    const asOf = outcome.listPublishedAt.toISOString().slice(0, 10);
    return `Screened against the ${list}, current as of ${asOf}.`;
  }
  return `Screened against the ${list} (publication date unavailable).`;
}
