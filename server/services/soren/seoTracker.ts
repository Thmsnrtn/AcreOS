/**
 * SOREN — SEO ranking tracker for /learn/<vertical>/<state> pages.
 *
 * Honest constraint named up front: Google's official SERP API costs $$
 * (ValueSERP, DataForSEO, SerpApi all run ~$30-100/mo at our volume),
 * and direct SERP scraping is fragile — Google's anti-bot defences,
 * markup churn, and per-IP CAPTCHA gates make this a best-effort signal,
 * not a primary metric.
 *
 * The decision (per dispatch brief): ship the free-fallback scraper now,
 * stamp every reading with `source: 'serp_scrape'` so a future paid-API
 * swap is a service-line change, not a schema migration. The detector
 * (≥10-position rank-change) is paid-API-ready; only the data acquisition
 * is provisional.
 *
 * Two entrypoints:
 *
 *   1. trackRankings()
 *      For each /learn page in LEARN_SEO_TARGETS, fetch the SERP for
 *      each declared target_keyword, parse the rank of the AcreOS URL
 *      among the first 100 results, persist a soren_seo_rankings row.
 *      Detects rank-change of ≥10 positions vs the prior reading and
 *      fires logger.warn with structured tags.
 *
 *   2. parseRankFromSerpHtml(html, expectedUrlFragment)
 *      Exported for unit tests so the rank-detection logic is exercised
 *      against a static fixture (no live Google call in tests).
 *
 *  Failure modes are silent (logger.warn + null rank) — a missed reading
 *  is recoverable; throwing breaks the cron and creates an availability
 *  problem for the wider scheduler.
 */

import { and, desc, eq, gte, like, inArray, not } from "drizzle-orm";
import { db } from "../../db";
import {
  sorenSeoRankings,
  SOREN_SERP_MAX_RANK,
  SOREN_RANK_CHANGE_THRESHOLD,
  SOREN_SEO_HOST,
  type InsertSorenSeoRanking,
} from "@shared/schema/soren-seo";
import { soleneDispatchQueue } from "@shared/schema/solene-dispatch";
import { logger } from "../../utils/logger";
import { LEARN_SEO_TARGETS } from "./seoTargets";
import { enqueueDispatch } from "../solene/dispatchQueue";

// ============================================================================
// trackRankings — fetch + parse + persist
// ============================================================================

export interface TrackRankingsResult {
  pagesChecked: number;
  keywordsChecked: number;
  rankingsPersisted: number;
  rankChangesDetected: number;
  errors: number;
}

export async function trackRankings(
  options: {
    fetchImpl?: (url: string) => Promise<string>;
    now?: Date;
  } = {},
): Promise<TrackRankingsResult> {
  const fetchImpl = options.fetchImpl ?? defaultSerpFetch;
  const now = options.now ?? new Date();
  let pagesChecked = 0;
  let keywordsChecked = 0;
  let rankingsPersisted = 0;
  let rankChangesDetected = 0;
  let errors = 0;

  for (const target of LEARN_SEO_TARGETS) {
    pagesChecked++;
    for (const keyword of target.targetKeywords) {
      keywordsChecked++;
      let rank: number | null = null;
      try {
        const html = await fetchImpl(buildSerpUrl(keyword));
        rank = parseRankFromSerpHtml(html, `${SOREN_SEO_HOST}${target.pagePath}`);
      } catch (err) {
        errors++;
        logger.warn(
          `[sorenSeo] SERP fetch/parse failed for "${keyword}" on ${target.pagePath}`,
          err instanceof Error ? err : undefined,
        );
        // Continue — persist a null-rank row so the gap in the trend
        // chart is honest, not an absence.
      }

      const row: InsertSorenSeoRanking = {
        pagePath: target.pagePath,
        targetKeyword: keyword,
        googleRank: rank,
        source: "serp_scrape",
        checkedAt: now,
      };

      // Read the prior rank before we insert this one (else our own
      // reading becomes the "prior"). Comparison fires the drift signal.
      const prior = await getMostRecentRank(target.pagePath, keyword);
      try {
        await db.insert(sorenSeoRankings).values(row);
        rankingsPersisted++;
      } catch (err) {
        errors++;
        logger.warn(
          `[sorenSeo] failed to persist ranking for "${keyword}" on ${target.pagePath}`,
          err instanceof Error ? err : undefined,
        );
        continue;
      }

      const change = detectRankChange(prior, rank);
      if (change) {
        rankChangesDetected++;
        logger.warn(
          `[sorenSeo] rank change ≥${SOREN_RANK_CHANGE_THRESHOLD} on ${target.pagePath} kw="${keyword}": ${formatRank(prior)} -> ${formatRank(rank)} (Δ=${change.delta})`,
          {
            metadata: {
              detail: {
                component: "soren_seo_tracker",
                page_path: target.pagePath,
                target_keyword: keyword,
                prior_rank: prior,
                latest_rank: rank,
                delta: change.delta,
                direction: change.direction,
              },
            },
          },
        );

        // L1-keystone wire-in: drop ≥10 positions on a /learn page →
        // auto-enqueue a Soren content-iteration dispatch on the live
        // solene_dispatch_queue. Additive — never blocks the cron, never
        // mutates the persisted ranking row.
        await maybeEnqueueSeoIterationDispatch({
          pagePath: target.pagePath,
          keyword,
          priorRank: prior,
          latestRank: rank,
          change,
          trackerRunId: String(now.getTime()),
        });
      }
    }
  }

  return {
    pagesChecked,
    keywordsChecked,
    rankingsPersisted,
    rankChangesDetected,
    errors,
  };
}

function formatRank(r: number | null): string {
  return r === null ? "not-in-top-" + SOREN_SERP_MAX_RANK : String(r);
}

// ============================================================================
// detectRankChange — pure function, exported for unit tests
// ============================================================================

export interface RankChange {
  delta: number; // positive = improved (smaller rank), negative = dropped
  direction: "improved" | "dropped" | "entered" | "exited";
}

/**
 * Compare two rank observations. Fires (returns a RankChange) only when
 * the absolute delta is ≥ SOREN_RANK_CHANGE_THRESHOLD, OR the page
 * entered/exited the top-N visibility window entirely.
 *
 *   - Both null:  no signal (still not ranked)
 *   - prior null, latest non-null: 'entered' (always fires)
 *   - prior non-null, latest null: 'exited'  (always fires)
 *   - both non-null: fires only when |Δ| ≥ threshold
 */
export function detectRankChange(
  prior: number | null,
  latest: number | null,
): RankChange | null {
  if (prior === null && latest === null) return null;
  if (prior === null && latest !== null) {
    return { delta: SOREN_SERP_MAX_RANK - latest, direction: "entered" };
  }
  if (prior !== null && latest === null) {
    return { delta: -(SOREN_SERP_MAX_RANK - prior), direction: "exited" };
  }
  // Both non-null
  const p = prior as number;
  const l = latest as number;
  const delta = p - l; // positive = improved (smaller is better)
  if (Math.abs(delta) < SOREN_RANK_CHANGE_THRESHOLD) return null;
  return { delta, direction: delta > 0 ? "improved" : "dropped" };
}

// ============================================================================
// parseRankFromSerpHtml — pure function, exported for unit tests
// ============================================================================

/**
 * Parse the rank of a target URL in a Google SERP HTML page. Conservative
 * — looks for the FIRST occurrence of the target URL inside what looks
 * like an organic result link.
 *
 * The shape of Google's SERP HTML changes frequently. Two heuristics:
 *
 *   1. Match every <a href="..."> link that points outside Google.
 *      Google wraps organic results in `<a href="/url?q=..."` (legacy)
 *      or direct `<a href="https://...">` (modern). We handle both.
 *
 *   2. Rank = the 1-based position of the FIRST link whose URL contains
 *      the expectedUrlFragment.
 *
 * Returns null when the target is not found or the HTML doesn't look
 * like a SERP page (e.g., Google served a CAPTCHA page instead).
 */
export function parseRankFromSerpHtml(
  html: string,
  expectedUrlFragment: string,
): number | null {
  if (!html || html.length < 1000) return null; // CAPTCHA / interstitial
  if (/Our systems have detected unusual traffic/.test(html)) return null;
  if (/recaptcha/i.test(html.slice(0, 5000))) return null;

  const linkRegex = /<a\s+[^>]*href="([^"]+)"/gi;
  const seen = new Set<string>();
  let rank = 0;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const rawHref = match[1];
    const href = extractTargetUrl(rawHref);
    if (!href) continue;
    // Skip Google internal links.
    if (
      href.startsWith("/search") ||
      href.startsWith("https://www.google.") ||
      href.startsWith("https://accounts.google.") ||
      href.startsWith("https://maps.google.")
    ) {
      continue;
    }
    if (!/^https?:\/\//.test(href)) continue;
    // Dedupe — Google often renders the same result link twice (title + caret).
    if (seen.has(href)) continue;
    seen.add(href);
    rank++;
    if (href.includes(expectedUrlFragment)) {
      return rank;
    }
    if (rank >= SOREN_SERP_MAX_RANK) break;
  }
  return null;
}

/**
 * Google sometimes wraps result hrefs as `/url?q=<encoded>&sa=...`.
 * Pull the actual destination out. Returns null on malformed input.
 */
function extractTargetUrl(href: string): string | null {
  if (!href) return null;
  if (href.startsWith("/url?")) {
    const qIdx = href.indexOf("q=");
    if (qIdx < 0) return null;
    const tail = href.slice(qIdx + 2);
    const ampIdx = tail.indexOf("&");
    const encoded = ampIdx >= 0 ? tail.slice(0, ampIdx) : tail;
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return href;
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function buildSerpUrl(keyword: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(keyword)}&num=100`;
}

async function defaultSerpFetch(url: string): Promise<string> {
  // No retry / no backoff here — the cron caller swallows errors per
  // (keyword × page) and we persist a null-rank row on failure. Adding
  // retry would mask Google's anti-bot signals from the operator.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      // Plausible browser UA — Google's anti-bot stack treats default
      // Node UAs as obvious crawlers and serves a CAPTCHA page immediately.
      // We accept the result of the served page, whatever it is.
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`SERP fetch HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function getMostRecentRank(
  pagePath: string,
  keyword: string,
): Promise<number | null> {
  const [row] = await db
    .select({ googleRank: sorenSeoRankings.googleRank })
    .from(sorenSeoRankings)
    .where(
      and(
        eq(sorenSeoRankings.pagePath, pagePath),
        eq(sorenSeoRankings.targetKeyword, keyword),
      ),
    )
    .orderBy(desc(sorenSeoRankings.checkedAt))
    .limit(1);
  return row?.googleRank ?? null;
}

// ============================================================================
// AUTO-ENQUEUE — wire rank-drop ≥10 detector into the live dispatch queue.
// ============================================================================

/**
 * Input shape for `buildSeoIterationPrompt`. The prompt that Soren will
 * receive when it picks up an auto-enqueued content-iteration dispatch.
 *
 * All six fields are load-bearing — the prompt asks Soren to read the
 * actual page + the SERP snapshot, identify the gap, and propose a
 * minimum-viable iteration (NOT a full rewrite). If the proposed change
 * would alter the page's core hypothesis, it routes to Maren (CPO).
 */
export interface SeoIterationPromptInput {
  pageSlug: string;
  keyword: string;
  previousRank: number | null;
  currentRank: number | null;
  rankDropPositions: number;
  serpSnapshot: string;
}

/**
 * Build the content-iteration dispatch prompt. Pure function — testable.
 * Every input field MUST appear in the prompt body so the dispatch is
 * self-contained (the worker reads only the prompt, not the producer's
 * stack frame).
 */
export function buildSeoIterationPrompt(
  input: SeoIterationPromptInput,
): string {
  const previous =
    input.previousRank === null ? "not-in-top-100" : `#${input.previousRank}`;
  const current =
    input.currentRank === null ? "not-in-top-100" : `#${input.currentRank}`;
  return `You are Soren, AcreOS CGO. A SERP-rank drop on a /learn page
fired the auto-iteration detector. Your job: a minimum-viable content
change to recover, NOT a full rewrite.

CONTEXT
- Page slug: ${input.pageSlug}
- Target keyword: ${input.keyword}
- Previous rank: ${previous}
- Current rank: ${current}
- Rank drop: ${input.rankDropPositions} positions
- SERP top-3 snapshot (captured by tracker): ${input.serpSnapshot}

STEPS
1. Read the current content at the page slug.
2. Read the top-3 SERP results for the keyword above (the snapshot the
   tracker captured is included in CONTEXT — fetch live if you need more).
3. Identify what gap might explain the rank drop. Consider: content
   depth, freshness, structured data, internal links, page speed.
4. Propose the iteration — the minimum-viable change to recover. Do
   not rewrite the whole page.
5. Implement the change OR queue for Maren's review if the proposed
   change would alter the page's core hypothesis (positioning, target
   audience, core claim). Hypothesis-shifting changes are CPO territory.

REPORT
Concise summary of: gap identified, change proposed, files touched (or
queued for Maren), why this is minimum-viable.`;
}

/**
 * Test injection seam — by default uses the real dispatchQueue + db.
 * The test file substitutes both to exercise the idempotency + error
 * branches without touching Postgres.
 */
export interface SeoIterationEnqueueDeps {
  enqueueDispatchImpl?: typeof enqueueDispatch;
  existingDispatchCheckImpl?: (
    pagePath: string,
    keyword: string,
  ) => Promise<boolean>;
}

export interface MaybeEnqueueArgs {
  pagePath: string;
  keyword: string;
  priorRank: number | null;
  latestRank: number | null;
  change: RankChange;
  trackerRunId: string;
}

/**
 * Auto-enqueue a Soren content-iteration dispatch when the detector
 * confirms a rank drop ≥10 positions on a /learn page.
 *
 * Idempotency: skip if a non-terminal dispatch already exists for the
 * same (pagePath, keyword) tuple (sourceId prefix match).
 *
 * Never throws — failures are caught + logged. A missed enqueue is
 * recoverable on the next tracker run; throwing would break the cron.
 */
export async function maybeEnqueueSeoIterationDispatch(
  args: MaybeEnqueueArgs,
  deps: SeoIterationEnqueueDeps = {},
): Promise<{ enqueued: boolean; reason?: string }> {
  // Only fire on dropped direction with magnitude ≥ threshold AND only
  // on /learn pages (content surface). 'exited' (fell out of top-100)
  // does NOT trigger here — that's a separate failure mode (page
  // de-indexed) that deserves a different dispatch shape.
  if (args.change.direction !== "dropped") {
    return { enqueued: false, reason: "not_dropped" };
  }
  const drop = Math.abs(args.change.delta);
  if (drop < SOREN_RANK_CHANGE_THRESHOLD) {
    return { enqueued: false, reason: "under_threshold" };
  }
  if (!args.pagePath.startsWith("/learn/")) {
    return { enqueued: false, reason: "not_learn_page" };
  }

  const existsCheck =
    deps.existingDispatchCheckImpl ?? defaultExistingDispatchCheck;
  const enqueueImpl = deps.enqueueDispatchImpl ?? enqueueDispatch;

  let alreadyQueued = false;
  try {
    alreadyQueued = await existsCheck(args.pagePath, args.keyword);
  } catch (err) {
    logger.warn(
      `[soren-seo] idempotency check failed for ${args.pagePath}/${args.keyword}`,
      err instanceof Error ? err : undefined,
    );
    // Fail-closed on the check itself: don't enqueue if we can't tell.
    return { enqueued: false, reason: "idempotency_check_failed" };
  }
  if (alreadyQueued) {
    logger.info(
      `[soren-seo] skip — already-queued dispatch for ${args.pagePath} kw="${args.keyword}"`,
    );
    return { enqueued: false, reason: "already_queued" };
  }

  const prompt = buildSeoIterationPrompt({
    pageSlug: args.pagePath,
    keyword: args.keyword,
    previousRank: args.priorRank,
    currentRank: args.latestRank,
    rankDropPositions: drop,
    serpSnapshot: `prior=${args.priorRank ?? "null"} latest=${args.latestRank ?? "null"} (top-3 snapshot capture deferred to Soren tool-use at dispatch time)`,
  });

  try {
    await enqueueImpl({
      sourceType: "detector",
      sourceId: `soren-seo-drop:${args.pagePath}:${args.keyword}:${args.trackerRunId}`,
      agentRole: "soren",
      promptText: prompt,
      maxCostUsd: 15,
      timeoutMs: 8 * 60 * 1000,
      priority: 1.2,
      enqueuedBy: "soren-seo-tracker",
    });
    return { enqueued: true };
  } catch (err) {
    logger.warn(
      `[soren-seo] enqueue failed for ${args.pagePath} kw="${args.keyword}"`,
      err instanceof Error ? err : undefined,
    );
    return { enqueued: false, reason: "enqueue_failed" };
  }
}

/**
 * Default idempotency check — look for any non-terminal queue row whose
 * sourceId starts with `soren-seo-drop:<pagePath>:<keyword>:`. The trailing
 * trackerRunId differs per cron tick, so the LIKE prefix match is what
 * makes the tuple (pagePath, keyword) idempotency work across runs.
 */
async function defaultExistingDispatchCheck(
  pagePath: string,
  keyword: string,
): Promise<boolean> {
  const prefix = `soren-seo-drop:${pagePath}:${keyword}:`;
  const rows = await db
    .select({ id: soleneDispatchQueue.id })
    .from(soleneDispatchQueue)
    .where(
      and(
        eq(soleneDispatchQueue.sourceType, "detector"),
        like(soleneDispatchQueue.sourceId, `${prefix}%`),
        not(
          inArray(soleneDispatchQueue.status, [
            "failed",
            "cancelled",
            "completed",
          ]),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ============================================================================
// FOUNDER ENDPOINT QUERY
// ============================================================================

export async function getRecentRankings(days: number = 30): Promise<{
  rankings: Array<{
    pagePath: string;
    targetKeyword: string;
    googleRank: number | null;
    source: string;
    checkedAt: Date;
  }>;
  byPage: Record<
    string,
    Array<{
      targetKeyword: string;
      googleRank: number | null;
      checkedAt: Date;
    }>
  >;
}> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(sorenSeoRankings)
    .where(gte(sorenSeoRankings.checkedAt, cutoff))
    .orderBy(desc(sorenSeoRankings.checkedAt));

  const byPage: Record<
    string,
    Array<{
      targetKeyword: string;
      googleRank: number | null;
      checkedAt: Date;
    }>
  > = {};
  for (const r of rows) {
    if (!byPage[r.pagePath]) byPage[r.pagePath] = [];
    byPage[r.pagePath].push({
      targetKeyword: r.targetKeyword,
      googleRank: r.googleRank,
      checkedAt: r.checkedAt,
    });
  }

  return {
    rankings: rows.map((r) => ({
      pagePath: r.pagePath,
      targetKeyword: r.targetKeyword,
      googleRank: r.googleRank,
      source: r.source,
      checkedAt: r.checkedAt,
    })),
    byPage,
  };
}
