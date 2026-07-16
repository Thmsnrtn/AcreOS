/**
 * Native inbox — thread-summary pure-logic unit tests (design-vision #2).
 *
 * The AI call itself needs a live model, so these pin the PURE, network-free
 * helpers that decide what text the model ever sees: HTML→text stripping and
 * the capped, subject-prefixed summary input. If these regress, the model gets
 * garbage (or an unbounded body) — so they carry the guarantees, not the LLM.
 */

import { describe, it, expect } from "vitest";
import { htmlToPlainText, buildSummaryInput } from "../../server/services/mailbox/threadSummary";

describe("htmlToPlainText", () => {
  it("strips tags and decodes common entities", () => {
    const html = "<p>Hi &amp; welcome</p><div>Line&nbsp;two &lt;here&gt;</div>";
    expect(htmlToPlainText(html)).toBe("Hi & welcome Line two <here>");
  });

  it("drops script and style blocks wholesale", () => {
    const html = "<style>.x{color:red}</style><p>Real</p><script>alert(1)</script>";
    expect(htmlToPlainText(html)).toBe("Real");
  });

  it("collapses whitespace and trims", () => {
    expect(htmlToPlainText("  <p>a\n\n   b</p>  ")).toBe("a b");
  });

  it("returns empty string for tag-only markup", () => {
    expect(htmlToPlainText("<br><hr>")).toBe("");
  });

  it("does not double-unescape: &amp;lt; stays literal, not '<'", () => {
    // &amp; must decode last, or "&amp;lt;" collapses to "<".
    expect(htmlToPlainText("&amp;lt;")).toBe("&lt;");
    expect(htmlToPlainText("a &amp;amp; b")).toBe("a &amp; b");
  });
});

describe("buildSummaryInput", () => {
  it("prefers plain body and prefixes the subject", () => {
    const out = buildSummaryInput({ subject: "Offer", bodyText: "We accept your bid." });
    expect(out).toBe("Subject: Offer\n\nWe accept your bid.");
  });

  it("falls back to stripped HTML when no plain body", () => {
    const out = buildSummaryInput({ subject: "Hi", bodyHtml: "<p>Body <b>text</b></p>" });
    expect(out).toBe("Subject: Hi\n\nBody text");
  });

  it("falls back to snippet when body is empty", () => {
    const out = buildSummaryInput({ subject: "S", bodyText: "   ", snippet: "snip" });
    expect(out).toBe("Subject: S\n\nsnip");
  });

  it("omits the subject prefix when there is no subject", () => {
    expect(buildSummaryInput({ bodyText: "just body" })).toBe("just body");
  });

  it("returns empty string when nothing is summarizable", () => {
    expect(buildSummaryInput({ subject: "  ", bodyText: "", bodyHtml: "<br>" })).toBe("");
  });

  it("caps the input length to bound model cost", () => {
    const huge = "x".repeat(10_000);
    const out = buildSummaryInput({ bodyText: huge });
    expect(out.length).toBe(4000);
  });
});
