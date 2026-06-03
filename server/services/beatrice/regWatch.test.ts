/**
 * Tests for Beatrice regWatch — RSS parser + keyword filter.
 *
 * Pure-unit coverage — no live RSS fetch, no DB. Three concern groups:
 *   - parseRssItems handles RSS 2.0 + Atom + malformed input + empty input
 *   - matchAcreosRelevance fires on AcreOS-relevant terms + ignores
 *     irrelevant ones + returns an empty list (signal for "drop") on misses
 *   - Dedup intent is verified by exercising the (source, source_url)
 *     uniqueness shape via a synthesised pair of equivalent items.
 */

import { describe, expect, it } from "vitest";
import {
  matchAcreosRelevance,
  parseRssItems,
} from "./regWatch";

describe("parseRssItems — RSS 2.0", () => {
  it("returns empty on empty input", () => {
    expect(parseRssItems("")).toEqual([]);
  });

  it("returns empty on non-XML garbage (no throw)", () => {
    expect(parseRssItems("totally not xml")).toEqual([]);
  });

  it("parses a basic RSS 2.0 feed with two items", () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <title>CFPB</title>
        <item>
          <title>CFPB takes action on mortgage servicer for RESPA violations</title>
          <link>https://www.consumerfinance.gov/about-us/newsroom/cfpb-action-1/</link>
          <description>Bureau alleges the servicer mishandled escrow accounts.</description>
          <pubDate>Wed, 02 Jun 2026 14:00:00 GMT</pubDate>
        </item>
        <item>
          <title>Routine semi-annual report</title>
          <link>https://www.consumerfinance.gov/about-us/newsroom/report/</link>
          <description>The Bureau released its scheduled report.</description>
          <pubDate>Mon, 31 May 2026 09:00:00 GMT</pubDate>
        </item>
      </channel></rss>`;
    const items = parseRssItems(xml);
    expect(items).toHaveLength(2);
    expect(items[0].title).toMatch(/RESPA violations/);
    expect(items[0].link).toBe(
      "https://www.consumerfinance.gov/about-us/newsroom/cfpb-action-1/",
    );
    expect(items[0].publishedAt).toBeInstanceOf(Date);
  });

  it("strips CDATA wrappers from title and description", () => {
    const xml = `<rss><channel><item>
      <title><![CDATA[FTC sues over deceptive CAN-SPAM violations]]></title>
      <link>https://ftc.gov/x</link>
      <description><![CDATA[<p>HTML <b>body</b></p>]]></description>
      <pubDate>Tue, 01 Jun 2026 10:00:00 GMT</pubDate>
    </item></channel></rss>`;
    const items = parseRssItems(xml);
    expect(items[0].title).toBe("FTC sues over deceptive CAN-SPAM violations");
    // HTML tags stripped from summary
    expect(items[0].summary).toBe("HTML body");
  });

  it("tolerates missing pubDate (publishedAt = null)", () => {
    const xml = `<rss><channel><item>
      <title>No date item about TCPA</title>
      <link>https://example.gov/x</link>
      <description>x</description>
    </item></channel></rss>`;
    const items = parseRssItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0].publishedAt).toBeNull();
  });

  it("skips items missing title or link", () => {
    const xml = `<rss><channel>
      <item><title>has title but no link</title></item>
      <item><link>https://x.com/has-link-no-title</link></item>
    </channel></rss>`;
    expect(parseRssItems(xml)).toEqual([]);
  });
});

describe("parseRssItems — Atom", () => {
  it("parses an Atom feed when no <item> tags exist", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <title>AG Press Releases</title>
      <entry>
        <title>AG announces settlement over consumer credit reporting</title>
        <link href="https://oag.ca.gov/news/press-releases/1" />
        <summary>The agreement resolves CCPA-related claims.</summary>
        <published>2026-06-01T10:00:00Z</published>
      </entry>
    </feed>`;
    const items = parseRssItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toMatch(/consumer credit/);
    expect(items[0].link).toBe("https://oag.ca.gov/news/press-releases/1");
  });
});

describe("matchAcreosRelevance", () => {
  it("returns empty list on a clearly irrelevant item", () => {
    const matches = matchAcreosRelevance({
      title: "FTC fines toy manufacturer for misleading age-grading",
      summary: "Settlement covers $2.5M penalty.",
    });
    expect(matches).toEqual([]);
  });

  it("fires on a single keyword match (mortgage)", () => {
    const matches = matchAcreosRelevance({
      title: "Mortgage servicer pays $40M to resolve allegations",
      summary: "Bureau enforcement action.",
    });
    expect(matches).toContain("mortgage");
  });

  it("fires multiple keywords on a high-density item", () => {
    const matches = matchAcreosRelevance({
      title: "CFPB takes action under Reg Z and RESPA against loan servicing firm",
      summary:
        "The Bureau alleges the firm violated TILA and engaged in unfair loan modification practices.",
    });
    // At least: 'reg z', 'respa', 'loan servicing', 'TILA', 'loan modification'
    expect(matches.length).toBeGreaterThanOrEqual(4);
    expect(matches).toEqual(expect.arrayContaining(["reg z", "respa"]));
  });

  it("is case-insensitive", () => {
    const matches = matchAcreosRelevance({
      title: "ccpa enforcement priorities for 2026",
      summary: "AG outlines its consumer-privacy plan.",
    });
    expect(matches).toContain("CCPA");
  });

  it("matches TCPA on a robocall enforcement story", () => {
    const matches = matchAcreosRelevance({
      title: "Robocall scheme settles with FTC for $5M",
      summary: "Operation engaged in mass TCPA violations.",
    });
    expect(matches).toEqual(expect.arrayContaining(["TCPA", "robocall"]));
  });

  it("matches fair-housing wording on an HUD-style item", () => {
    const matches = matchAcreosRelevance({
      title: "DOJ files fair housing complaint against landlord",
      summary: "Complaint alleges discrimination in lease renewals.",
    });
    expect(matches).toContain("fair housing");
  });
});

describe("dedup intent", () => {
  // The actual DB-level uniqueness lives at the index on
  // (source, source_url); this test asserts that two parses of the same
  // RSS payload produce identical link values, so the index will dedup
  // on re-runs. (The cron uses ON CONFLICT DO NOTHING on that index.)
  it("produces stable link values across re-parse", () => {
    const xml = `<rss><channel><item>
      <title>Same item about Reg Z</title>
      <link>https://www.consumerfinance.gov/x/y/z</link>
      <description>x</description>
      <pubDate>Wed, 02 Jun 2026 14:00:00 GMT</pubDate>
    </item></channel></rss>`;
    const first = parseRssItems(xml);
    const second = parseRssItems(xml);
    expect(first[0].link).toBe(second[0].link);
    expect(first[0].title).toBe(second[0].title);
  });
});
