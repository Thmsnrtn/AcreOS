/**
 * BEATRICE — regulatory-news feed.
 *
 * Pulls daily RSS from CFPB, FTC, and (where stable feeds exist) state
 * AGs. Each item is matched against BEATRICE_RELEVANCE_KEYWORDS; matches
 * persist to beatrice_reg_events. Non-matches are dropped at ingest so
 * the table stays signal-only.
 *
 * Idempotency: (source, source_url) is a UNIQUE index, so a re-run over
 * the same RSS payload is a DB no-op via ON CONFLICT DO NOTHING.
 *
 * Two entrypoints:
 *
 *   1. fetchRegSources()
 *      The cron entrypoint. Iterates BEATRICE_REG_SOURCES, fetches each
 *      RSS feed, parses, filters, persists matches. Errors per-source are
 *      swallowed (logger.warn + continue) so one broken state-AG feed
 *      doesn't break CFPB / FTC ingestion.
 *
 *   2. parseRssItems(xml) + matchAcreosRelevance(item)
 *      Exported pure functions for unit tests.
 *
 * The parser is deliberately conservative — handles RSS 2.0 + Atom (the
 * two formats CFPB / FTC / state AGs use today) but does not pretend to
 * handle every namespace extension. Malformed XML returns an empty item
 * list (logged + recoverable next tick), not a thrown exception.
 */

import { sql } from "drizzle-orm";
import { db } from "../../db";
import {
  beatriceRegEvents,
  BEATRICE_REG_SOURCES,
  BEATRICE_RELEVANCE_KEYWORDS,
  REG_SOURCE_FEEDS,
  type BeatriceRegSource,
  type InsertBeatriceRegEvent,
} from "@shared/schema/beatrice-regwatch";
import { logger } from "../../utils/logger";

// ============================================================================
// fetchRegSources — cron entrypoint
// ============================================================================

export interface FetchRegSourcesResult {
  sourcesScanned: number;
  itemsFetched: number;
  itemsMatched: number;
  itemsPersisted: number;
  itemsSkippedDuplicate: number;
  errorsBySource: Record<string, string>;
}

export async function fetchRegSources(
  options: {
    fetchImpl?: (url: string) => Promise<string>;
  } = {},
): Promise<FetchRegSourcesResult> {
  const fetchImpl = options.fetchImpl ?? defaultRssFetch;
  let itemsFetched = 0;
  let itemsMatched = 0;
  let itemsPersisted = 0;
  let itemsSkippedDuplicate = 0;
  const errorsBySource: Record<string, string> = {};

  for (const source of BEATRICE_REG_SOURCES) {
    const feedUrl = REG_SOURCE_FEEDS[source];
    if (!feedUrl) {
      errorsBySource[source] = "no feed URL configured";
      continue;
    }
    try {
      const xml = await fetchImpl(feedUrl);
      const items = parseRssItems(xml);
      itemsFetched += items.length;
      for (const item of items) {
        const matches = matchAcreosRelevance(item);
        if (matches.length === 0) continue;
        itemsMatched++;
        const row: InsertBeatriceRegEvent = {
          source,
          sourceUrl: item.link,
          title: item.title,
          summary: item.summary,
          publishedAt: item.publishedAt ?? new Date(),
          severityKeywordMatch: matches,
        };
        try {
          // ON CONFLICT DO NOTHING on (source, source_url) — idempotent.
          const result = await db
            .insert(beatriceRegEvents)
            .values(row)
            .onConflictDoNothing({
              target: [beatriceRegEvents.source, beatriceRegEvents.sourceUrl],
            })
            .returning({ id: beatriceRegEvents.id });
          if (result.length > 0) {
            itemsPersisted++;
          } else {
            itemsSkippedDuplicate++;
          }
        } catch (err) {
          logger.warn(
            `[beatriceRegWatch] persist failed for ${source} item ${item.link}`,
            err instanceof Error ? err : undefined,
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errorsBySource[source] = msg;
      logger.warn(
        `[beatriceRegWatch] source ${source} failed: ${msg}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  void sql; // silence drizzle import lint when service doesn't use sql helpers
  return {
    sourcesScanned: BEATRICE_REG_SOURCES.length,
    itemsFetched,
    itemsMatched,
    itemsPersisted,
    itemsSkippedDuplicate,
    errorsBySource,
  };
}

// ============================================================================
// parseRssItems — pure function, exported for tests
// ============================================================================

export interface RssItem {
  title: string;
  link: string;
  summary: string;
  publishedAt: Date | null;
}

/**
 * Parse an RSS 2.0 or Atom feed into a flat item list. Conservative — the
 * regex-based extraction handles the shapes CFPB / FTC / state AGs use
 * today without pulling in a heavyweight XML parser dep.
 *
 * Returns an empty list on malformed input (rather than throwing) so a
 * single corrupted feed doesn't break the rest of the daily cron.
 */
export function parseRssItems(xml: string): RssItem[] {
  if (!xml || typeof xml !== "string") return [];
  const out: RssItem[] = [];

  // RSS 2.0: <item>...</item>
  const rssItemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = rssItemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = stripCdataTags(extractTag(block, "title")) ?? "";
    const link = stripCdataTags(extractTag(block, "link")) ?? "";
    const description =
      stripCdataTags(extractTag(block, "description")) ?? "";
    const pubDateRaw = extractTag(block, "pubDate") ?? extractTag(block, "dc:date");
    const publishedAt = pubDateRaw ? safeParseDate(pubDateRaw) : null;
    if (!title || !link) continue;
    out.push({
      title: title.trim(),
      link: link.trim(),
      summary: stripHtmlTags(description).trim(),
      publishedAt,
    });
  }

  // Atom: <entry>...</entry>. Skip if we already populated from RSS.
  if (out.length === 0) {
    const atomEntryRegex = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
    while ((match = atomEntryRegex.exec(xml)) !== null) {
      const block = match[1];
      const title = stripCdataTags(extractTag(block, "title")) ?? "";
      // Atom link is an attribute: <link href="..."/>
      const linkAttr = block.match(/<link\b[^>]*href="([^"]+)"/i);
      const link = linkAttr ? linkAttr[1] : "";
      const summary =
        stripCdataTags(extractTag(block, "summary")) ??
        stripCdataTags(extractTag(block, "content")) ??
        "";
      const updatedRaw =
        extractTag(block, "published") ?? extractTag(block, "updated");
      const publishedAt = updatedRaw ? safeParseDate(updatedRaw) : null;
      if (!title || !link) continue;
      out.push({
        title: title.trim(),
        link: link.trim(),
        summary: stripHtmlTags(summary).trim(),
        publishedAt,
      });
    }
  }

  return out;
}

function extractTag(block: string, tag: string): string | null {
  // Tag can be `<title>...</title>` OR `<title attr="x">...</title>`.
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? m[1] : null;
}

function stripCdataTags(input: string | null): string | null {
  if (input === null) return null;
  return input.replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "");
}

function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]+>/g, "");
}

function safeParseDate(raw: string): Date | null {
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

// ============================================================================
// matchAcreosRelevance — pure function, exported for tests
// ============================================================================

/**
 * Returns the list of BEATRICE_RELEVANCE_KEYWORDS that match the item's
 * title + summary (case-insensitive substring match). An empty list means
 * the item doesn't get persisted.
 *
 * The match is intentionally lossy — we don't try to disambiguate "note"
 * (the mortgage instrument) from "note" (the verb). False positives are
 * triaged out by Beatrice in her 72h review; false negatives are a worse
 * failure mode (compliance event missed = examiner exposure).
 */
export function matchAcreosRelevance(item: {
  title: string;
  summary: string;
}): string[] {
  const haystack = `${item.title} ${item.summary}`.toLowerCase();
  const matches: string[] = [];
  for (const kw of BEATRICE_RELEVANCE_KEYWORDS) {
    if (haystack.includes(kw.toLowerCase())) {
      matches.push(kw);
    }
  }
  return matches;
}

// ============================================================================
// HTTP HELPER
// ============================================================================

async function defaultRssFetch(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "AcreOS-Beatrice-RegWatch/1.0 (compliance@acreos.io)",
        Accept: "application/rss+xml, application/xml, text/xml, application/atom+xml, */*",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`RSS fetch HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// FOUNDER ENDPOINT QUERY
// ============================================================================

export async function getRecentRegEvents(days: number = 30): Promise<{
  events: Array<{
    id: number;
    source: BeatriceRegSource | string;
    sourceUrl: string;
    title: string;
    summary: string;
    publishedAt: Date;
    fetchedAt: Date;
    severityKeywordMatch: string[];
    beatriceReviewed: boolean;
    reviewedAt: Date | null;
  }>;
  bySource: Record<string, number>;
  unreviewedCount: number;
}> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { gte, desc } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(beatriceRegEvents)
    .where(gte(beatriceRegEvents.publishedAt, cutoff))
    .orderBy(desc(beatriceRegEvents.publishedAt));

  const bySource: Record<string, number> = {};
  let unreviewedCount = 0;
  const events = rows.map((r) => {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    if (!r.beatriceReviewed) unreviewedCount++;
    return {
      id: r.id,
      source: r.source,
      sourceUrl: r.sourceUrl,
      title: r.title,
      summary: r.summary,
      publishedAt: r.publishedAt,
      fetchedAt: r.fetchedAt,
      severityKeywordMatch: r.severityKeywordMatch,
      beatriceReviewed: r.beatriceReviewed,
      reviewedAt: r.reviewedAt,
    };
  });
  return { events, bySource, unreviewedCount };
}
