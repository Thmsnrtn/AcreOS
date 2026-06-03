/**
 * EXTERNAL-WATCH — Anthropic API changelog.
 *
 * Layer 1 capability #4 (#17 in the 32-cap map). Pulls Anthropic's public
 * release-notes feed daily. Each item is matched against
 * ANTHROPIC_RELEVANCE_KEYWORDS (model/deprecation/pricing/rate-limit/tool-
 * use/claude-opus/sonnet/haiku/context-window/vision/extended-thinking).
 * Matches persist to external_watch_events with source='anthropic_api';
 * non-matches are dropped at ingest. Items dedupe via the UNIQUE
 * (source, source_url) index on the table — re-runs are idempotent.
 *
 * The fetch entrypoint is the public release-notes feed at
 *   https://docs.anthropic.com/en/release-notes/api.xml
 *
 * Honest constraint: Anthropic's public-changelog format may change. If
 * the XML format differs from the RSS/Atom shapes we know, the parser
 * returns an empty item list (no throw), the run logs a warning, and the
 * next tick recovers automatically when Anthropic ships a fix or we
 * extend the parser.
 *
 * Iris owns the 48h acknowledgement SLA per
 * docs/internal/anthropic-watch-discipline.md. Deprecation events for
 * any model AcreOS uses must fire to Solene's page channel as
 * severity=urgent (migration deadlines are non-negotiable).
 */

import { db } from "../../db";
import {
  externalWatchEvents,
  ANTHROPIC_RELEVANCE_KEYWORDS,
  type InsertExternalWatchEvent,
} from "@shared/schema/external-watch";
import { logger } from "../../utils/logger";

// ============================================================================
// fetchAnthropicChangelog — cron entrypoint
// ============================================================================

const ANTHROPIC_CHANGELOG_FEED_URL =
  "https://docs.anthropic.com/en/release-notes/api.xml";

export interface FetchAnthropicChangelogResult {
  itemsFetched: number;
  itemsMatched: number;
  itemsPersisted: number;
  itemsSkippedDuplicate: number;
  fetchError?: string;
}

export async function fetchAnthropicChangelog(
  options: {
    fetchImpl?: (url: string) => Promise<string>;
    feedUrl?: string;
  } = {},
): Promise<FetchAnthropicChangelogResult> {
  const fetchImpl = options.fetchImpl ?? defaultChangelogFetch;
  const feedUrl = options.feedUrl ?? ANTHROPIC_CHANGELOG_FEED_URL;

  let itemsFetched = 0;
  let itemsMatched = 0;
  let itemsPersisted = 0;
  let itemsSkippedDuplicate = 0;

  let xml: string;
  try {
    xml = await fetchImpl(feedUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[anthropicWatch] fetch failed: ${msg}`, {
      metadata: { feedUrl, err: msg },
    });
    return {
      itemsFetched: 0,
      itemsMatched: 0,
      itemsPersisted: 0,
      itemsSkippedDuplicate: 0,
      fetchError: msg,
    };
  }

  const items = parseChangelogItems(xml);
  itemsFetched = items.length;
  if (itemsFetched === 0) {
    logger.warn(`[anthropicWatch] zero items parsed — format may have changed`, {
      metadata: { feedUrl, xmlBytes: xml.length },
    });
  }

  for (const item of items) {
    const matches = matchAnthropicRelevance(item);
    if (matches.length === 0) continue;
    itemsMatched++;
    const row: InsertExternalWatchEvent = {
      source: "anthropic_api",
      sourceUrl: item.link,
      title: item.title,
      summary: item.summary,
      publishedAt: item.publishedAt ?? new Date(),
      severityKeywordMatch: matches,
    };
    try {
      const result = await db
        .insert(externalWatchEvents)
        .values(row)
        .onConflictDoNothing({
          target: [externalWatchEvents.source, externalWatchEvents.sourceUrl],
        })
        .returning({ id: externalWatchEvents.id });
      if (result.length > 0) {
        itemsPersisted++;
      } else {
        itemsSkippedDuplicate++;
      }
    } catch (err) {
      logger.warn(
        `[anthropicWatch] persist failed for ${item.link}`,
        err instanceof Error
          ? { metadata: { err: err.message } }
          : { metadata: { err: String(err) } },
      );
    }
  }

  return {
    itemsFetched,
    itemsMatched,
    itemsPersisted,
    itemsSkippedDuplicate,
  };
}

// ============================================================================
// parseChangelogItems — pure function, exported for tests
// ============================================================================

export interface ChangelogItem {
  title: string;
  link: string;
  summary: string;
  publishedAt: Date | null;
}

/**
 * Parse Anthropic's public changelog XML into a flat item list. Handles
 * both RSS 2.0 and Atom variants — Anthropic's release-notes feed has
 * historically been Atom-shaped but the parser tolerates either. Returns
 * an empty list on malformed input (rather than throwing) so a single
 * corrupted fetch doesn't break the rest of the daily cron.
 */
export function parseChangelogItems(xml: string): ChangelogItem[] {
  if (!xml || typeof xml !== "string") return [];
  const out: ChangelogItem[] = [];

  // RSS 2.0: <item>...</item>
  const rssItemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = rssItemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = stripCdataTags(extractTag(block, "title")) ?? "";
    const link = stripCdataTags(extractTag(block, "link")) ?? "";
    const description =
      stripCdataTags(extractTag(block, "description")) ?? "";
    const pubDateRaw =
      extractTag(block, "pubDate") ?? extractTag(block, "dc:date");
    const publishedAt = pubDateRaw ? safeParseDate(pubDateRaw) : null;
    if (!title || !link) continue;
    out.push({
      title: title.trim(),
      link: link.trim(),
      summary: stripHtmlTags(description).trim(),
      publishedAt,
    });
  }

  // Atom: <entry>...</entry>. Skip if RSS already populated.
  if (out.length === 0) {
    const atomEntryRegex = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
    while ((match = atomEntryRegex.exec(xml)) !== null) {
      const block = match[1];
      const title = stripCdataTags(extractTag(block, "title")) ?? "";
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
// matchAnthropicRelevance — pure function, exported for tests
// ============================================================================

export function matchAnthropicRelevance(item: {
  title: string;
  summary: string;
}): string[] {
  const haystack = `${item.title} ${item.summary}`.toLowerCase();
  const matches: string[] = [];
  for (const kw of ANTHROPIC_RELEVANCE_KEYWORDS) {
    if (haystack.includes(kw.toLowerCase())) {
      matches.push(kw);
    }
  }
  return matches;
}

// ============================================================================
// HTTP HELPER
// ============================================================================

async function defaultChangelogFetch(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "AcreOS-ExternalWatch-AnthropicChangelog/1.0",
        Accept:
          "application/rss+xml, application/xml, text/xml, application/atom+xml, */*",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`changelog fetch HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}
