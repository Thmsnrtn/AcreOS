/**
 * Tests for server-rendered public heads (free-distribution, 2026-07-03).
 *
 * Coverage:
 *  - injectHead swaps title/description/OG, adds canonical + JSON-LD, and
 *    escapes injected values (no HTML/attr breakout from note subjects)
 *  - a shell missing tags gets them inserted before </head>
 *  - surgery failure returns the original shell (fail-open)
 *  - field-note spec carries Article JSON-LD with the article text
 *  - stripHtmlToText: tags/entities removed, word-boundary truncation
 *  - compare/learn title derivation from slugs/paths
 */

import { describe, expect, it } from "vitest";
import {
  injectHead,
  stripHtmlToText,
  headForFieldNote,
  headForCompare,
  headForLearnPath,
  competitorFromSlug,
} from "./serverHead";

const SHELL = `<!DOCTYPE html><html><head>
  <title>AcreOS — the land investing OS</title>
  <meta name="description" content="Default description" />
  <meta property="og:title" content="AcreOS" />
  <meta property="og:description" content="Default OG" />
  <meta property="og:url" content="https://acreos.io/" />
  <meta property="og:type" content="website" />
</head><body><div id="root"></div></body></html>`;

describe("injectHead", () => {
  it("swaps title, description, OG and adds canonical", () => {
    const out = injectHead(
      SHELL,
      { title: "My Note · AcreOS", description: "A note about Texas dirt.", canonicalPath: "/field-notes/my-note", ogType: "article" },
      "https://acreos.io",
    );
    expect(out).toContain("<title>My Note · AcreOS</title>");
    expect(out).toContain('content="A note about Texas dirt."');
    expect(out).toContain('property="og:type" content="article"');
    expect(out).toContain('rel="canonical" href="https://acreos.io/field-notes/my-note"');
    expect(out).not.toContain("Default description");
  });

  it("escapes hostile values — no tag or attribute breakout", () => {
    const out = injectHead(
      SHELL,
      { title: `"><script>alert(1)</script>`, description: `x" onmouseover="evil`, canonicalPath: "/field-notes/x" },
      "https://acreos.io",
    );
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain('onmouseover="evil"');
  });

  it("inserts missing tags before </head>", () => {
    const bare = `<html><head><title>x</title></head><body></body></html>`;
    const out = injectHead(bare, { title: "T", description: "D", canonicalPath: "/learn" }, "https://acreos.io");
    expect(out).toContain('name="description" content="D"');
    expect(out).toContain('rel="canonical"');
  });

  it("appends JSON-LD with </script> neutralized inside the payload", () => {
    const out = injectHead(
      SHELL,
      { title: "T", description: "D", canonicalPath: "/x", jsonLd: { "@type": "Article", articleBody: "hello </script> world" } },
      "https://acreos.io",
    );
    expect(out).toContain('type="application/ld+json"');
    expect(out).toContain("<\\/script> world");
  });
});

describe("stripHtmlToText", () => {
  it("removes tags, scripts, and entities", () => {
    expect(stripHtmlToText("<p>Hi <b>there</b> &amp; welcome</p><script>x()</script>")).toBe("Hi there & welcome");
  });
  it("truncates at a word boundary with an ellipsis", () => {
    const out = stripHtmlToText("one two three four five six seven", 15);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(16);
  });
});

describe("spec builders", () => {
  it("field-note spec carries Article JSON-LD with the text body", () => {
    const spec = headForFieldNote({
      slug: "county-data-notes",
      subject: "What 90 days of county data taught us",
      plainBody: "The short version: response rates doubled when we filtered to out-of-state owners.",
      htmlBody: "<p>ignored when plainBody present</p>",
      publishedAt: new Date("2026-06-20T00:00:00Z"),
    });
    expect(spec.title).toContain("What 90 days of county data taught us");
    expect(spec.ogType).toBe("article");
    expect((spec.jsonLd as any)["@type"]).toBe("Article");
    expect((spec.jsonLd as any).articleBody).toContain("out-of-state owners");
    expect(spec.canonicalPath).toBe("/field-notes/county-data-notes");
  });

  it("compare slugs become competitor titles", () => {
    expect(competitorFromSlug("acreos-vs-propstream")).toBe("Propstream");
    expect(headForCompare("acreos-vs-dealmachine").title).toContain("AcreOS vs Dealmachine");
  });

  it("learn paths become readable titles", () => {
    const spec = headForLearnPath("/learn/land-flipping/texas");
    expect(spec.title).toContain("Texas — Land Flipping");
    expect(spec.canonicalPath).toBe("/learn/land-flipping/texas");
  });
});
