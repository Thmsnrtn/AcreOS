/**
 * Tests for the Anthropic API changelog watcher — pure-unit coverage of
 * the parser + keyword matcher. No live fetch, no DB.
 *
 *   - parseChangelogItems handles RSS 2.0 + Atom + malformed + empty
 *     input (Anthropic's public feed format may shift; we tolerate both)
 *   - matchAnthropicRelevance fires on AcreOS-relevant terms and ignores
 *     irrelevant ones (case-insensitive)
 *   - dedup intent verified via stable link values across re-parse
 */

import { describe, expect, it } from "vitest";
import {
  matchAnthropicRelevance,
  parseChangelogItems,
} from "./anthropicWatch";

describe("parseChangelogItems — RSS 2.0", () => {
  it("returns empty on empty input", () => {
    expect(parseChangelogItems("")).toEqual([]);
  });

  it("returns empty on non-XML garbage (no throw)", () => {
    expect(parseChangelogItems("totally not xml")).toEqual([]);
  });

  it("parses a basic RSS 2.0 release-notes feed", () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <title>Anthropic API release notes</title>
        <item>
          <title>Claude Opus 4.7 is now generally available</title>
          <link>https://docs.anthropic.com/en/release-notes/api#claude-opus-47-ga</link>
          <description>Opus 4.7 ships with a 1M context window and extended thinking by default.</description>
          <pubDate>Wed, 02 Jun 2026 14:00:00 GMT</pubDate>
        </item>
        <item>
          <title>Pricing update for Haiku tier</title>
          <link>https://docs.anthropic.com/en/release-notes/api#haiku-pricing</link>
          <description>Input pricing reduced by 15%.</description>
          <pubDate>Mon, 31 May 2026 09:00:00 GMT</pubDate>
        </item>
      </channel></rss>`;
    const items = parseChangelogItems(xml);
    expect(items).toHaveLength(2);
    expect(items[0].title).toMatch(/Opus 4.7/);
    expect(items[0].link).toBe(
      "https://docs.anthropic.com/en/release-notes/api#claude-opus-47-ga",
    );
    expect(items[0].publishedAt).toBeInstanceOf(Date);
  });

  it("tolerates missing pubDate (publishedAt = null)", () => {
    const xml = `<rss><channel><item>
      <title>Undated note about extended thinking</title>
      <link>https://docs.anthropic.com/x</link>
      <description>x</description>
    </item></channel></rss>`;
    const items = parseChangelogItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0].publishedAt).toBeNull();
  });

  it("skips items missing title or link", () => {
    const xml = `<rss><channel>
      <item><title>has title but no link</title></item>
      <item><link>https://docs.anthropic.com/has-link-no-title</link></item>
    </channel></rss>`;
    expect(parseChangelogItems(xml)).toEqual([]);
  });

  it("strips CDATA wrappers + HTML tags from description", () => {
    const xml = `<rss><channel><item>
      <title><![CDATA[Deprecation: claude-2.1]]></title>
      <link>https://docs.anthropic.com/x</link>
      <description><![CDATA[<p>End-of-life <b>2026-12-31</b></p>]]></description>
      <pubDate>Tue, 01 Jun 2026 10:00:00 GMT</pubDate>
    </item></channel></rss>`;
    const items = parseChangelogItems(xml);
    expect(items[0].title).toBe("Deprecation: claude-2.1");
    expect(items[0].summary).toBe("End-of-life 2026-12-31");
  });
});

describe("parseChangelogItems — Atom", () => {
  it("parses an Atom feed when no <item> tags exist", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <title>Anthropic API release notes</title>
      <entry>
        <title>New tool use schema version</title>
        <link href="https://docs.anthropic.com/en/release-notes/api#tool-use-v2" />
        <summary>Backwards-incompatible change to tool_choice payload.</summary>
        <published>2026-06-01T10:00:00Z</published>
      </entry>
    </feed>`;
    const items = parseChangelogItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toMatch(/tool use schema/);
    expect(items[0].link).toBe(
      "https://docs.anthropic.com/en/release-notes/api#tool-use-v2",
    );
    expect(items[0].publishedAt).toBeInstanceOf(Date);
  });

  it("falls back to <updated> when <published> missing in Atom", () => {
    const xml = `<feed>
      <entry>
        <title>Rate limit table refresh</title>
        <link href="https://docs.anthropic.com/x" />
        <summary>New tier limits.</summary>
        <updated>2026-05-15T12:00:00Z</updated>
      </entry>
    </feed>`;
    const items = parseChangelogItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0].publishedAt).toBeInstanceOf(Date);
  });
});

describe("matchAnthropicRelevance", () => {
  it("returns empty list on a clearly irrelevant item", () => {
    const matches = matchAnthropicRelevance({
      title: "Quarterly community update",
      summary: "Highlights from the developer community.",
    });
    expect(matches).toEqual([]);
  });

  it("fires on a model release (claude opus + model)", () => {
    const matches = matchAnthropicRelevance({
      title: "Claude Opus 4.7 generally available",
      summary: "New model with extended thinking.",
    });
    expect(matches).toEqual(
      expect.arrayContaining(["claude opus", "model", "extended thinking"]),
    );
  });

  it("fires on a deprecation notice (deprecat)", () => {
    const matches = matchAnthropicRelevance({
      title: "Deprecation timeline for claude-2.1",
      summary: "EOL set for December 2026.",
    });
    expect(matches).toContain("deprecat");
  });

  it("fires multiple keywords on a high-density item", () => {
    const matches = matchAnthropicRelevance({
      title: "Pricing + rate limit + context window updates for Opus",
      summary:
        "We are adjusting pricing on Claude Opus, expanding the context window, and refreshing the rate limit table.",
    });
    expect(matches.length).toBeGreaterThanOrEqual(4);
    expect(matches).toEqual(
      expect.arrayContaining(["pricing", "rate limit", "context window"]),
    );
  });

  it("is case-insensitive", () => {
    const matches = matchAnthropicRelevance({
      title: "VISION inputs now supported on Haiku",
      summary: "Image inputs are GA across all CLAUDE HAIKU tiers.",
    });
    expect(matches).toContain("vision");
    expect(matches).toContain("claude haiku");
  });
});

describe("dedup intent", () => {
  it("produces stable link values across re-parse", () => {
    const xml = `<rss><channel><item>
      <title>Same note about Claude Sonnet</title>
      <link>https://docs.anthropic.com/x/y/z</link>
      <description>x</description>
      <pubDate>Wed, 02 Jun 2026 14:00:00 GMT</pubDate>
    </item></channel></rss>`;
    const first = parseChangelogItems(xml);
    const second = parseChangelogItems(xml);
    expect(first[0].link).toBe(second[0].link);
    expect(first[0].title).toBe(second[0].title);
  });
});
