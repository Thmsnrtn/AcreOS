import { describe, it, expect } from "vitest";
import { htmlToPlainText, parseSignatureImage } from "../../server/services/esign/sealedDocumentPdf";

/**
 * Gap 5 (product-truth audit) — pure helpers of the sealed-document PDF.
 * The DB load + pdfkit compositing are exercised end-to-end by the live
 * /sealed-pdf route; these pin the two total transforms it depends on.
 */
describe("htmlToPlainText", () => {
  it("converts block boundaries to line breaks", () => {
    const out = htmlToPlainText("<h1>Title</h1><p>Para one</p><p>Para two</p>");
    expect(out).toContain("Title");
    expect(out).toContain("Para one");
    expect(out).toContain("Para two");
    expect(out.split("\n").length).toBeGreaterThan(1);
  });

  it("handles <br> as a newline", () => {
    expect(htmlToPlainText("a<br>b")).toBe("a\nb");
  });

  it("strips inline tags and decodes entities", () => {
    expect(htmlToPlainText("<strong>Smith &amp; Co</strong> &lt;x&gt;")).toBe("Smith & Co <x>");
  });

  it("collapses excessive blank lines", () => {
    const out = htmlToPlainText("<p>a</p><p></p><p></p><p>b</p>");
    expect(out).not.toMatch(/\n{3,}/);
  });

  it("is total on empty / plain input", () => {
    expect(htmlToPlainText("")).toBe("");
    expect(htmlToPlainText("just text")).toBe("just text");
  });
});

describe("parseSignatureImage", () => {
  // 1×1 transparent PNG.
  const PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  it("decodes a PNG data URL into a non-empty buffer", () => {
    const buf = parseSignatureImage(PNG);
    expect(buf).toBeInstanceOf(Buffer);
    expect((buf as Buffer).length).toBeGreaterThan(0);
  });

  it("accepts jpeg data URLs", () => {
    const buf = parseSignatureImage("data:image/jpeg;base64,/9j/4AAQSkZJRg==");
    expect(buf).toBeInstanceOf(Buffer);
  });

  it("returns null for a typed / non-image signature", () => {
    expect(parseSignatureImage("John Q. Public")).toBeNull();
    expect(parseSignatureImage("data:text/plain;base64,aGVsbG8=")).toBeNull();
  });

  it("is total on malformed input", () => {
    expect(parseSignatureImage("")).toBeNull();
    expect(parseSignatureImage(null as never)).toBeNull();
    expect(parseSignatureImage("data:image/png;base64,")).toBeNull();
  });
});
