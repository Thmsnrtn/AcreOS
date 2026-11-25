/**
 * Subdivider bar-(f) cure lane — S-F5 in-product copy pins.
 *
 * The CC&R surface (client/src/pages/ccr-templates.tsx) produces recordable
 * legal instruments. The subdivider paper pass (S-F5) found it carried no
 * not-legal-advice copy, never displayed the attorney-review stamps its API
 * already returns, and offered the rendered output as a bare download.
 * The cures record (paper-cures-subdivider-2026-11.md, Item 3) drafted the
 * exact copy; this test pins that copy verbatim, its placement, and the
 * stamp display against the page SOURCE, and pins the API side that makes
 * the display honest (the list + detail routes return the stamp fields).
 *
 * Scope guard: S-F1 permit-template labelling copy is NOT part of this cure
 * (founder decision still open) and must not appear on this surface.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => stripComments(readFileSync(resolve(ROOT, p), "utf8"));
const flat = (s: string) => s.replace(/\s+/g, " ");

const page = read("client/src/pages/ccr-templates.tsx");
const pageFlat = flat(page);
const route = read("server/routes-ccr-templates.ts");

describe("S-F5 — CC&R page carries the not-legal-advice copy (verbatim)", () => {
  it("page subheading keeps the original description and adds the drafted sentence", () => {
    expect(pageFlat).toContain(
      "Restrictive covenants, road maintenance agreements, HOA bylaws, architectural review standards. Merge-field engine — no AI generation.",
    );
    expect(pageFlat).toContain(
      "These templates are document tooling, not legal advice: have any document you intend to record reviewed by your own attorney first.",
    );
  });
});

describe("S-F5 — attorney-review stamps the API returns are displayed", () => {
  it("the API list route returns the stamp fields (display is of existing data)", () => {
    expect(route).toContain("attorneyReviewedAt: ccrTemplates.attorneyReviewedAt");
    expect(route).toContain("attorneyReviewedBy: ccrTemplates.attorneyReviewedBy");
  });

  it("the stamp label covers both branches with the drafted wording", () => {
    expect(page).toContain("Not attorney-reviewed.");
    expect(page).toContain("Attorney-reviewed: ");
    // The reviewed branch is built from the returned fields, with the house
    // date formatter — never a bare toLocaleDateString.
    expect(page).toContain("t.attorneyReviewedBy");
    expect(page).toContain("formatDate(t.attorneyReviewedAt)");
    expect(page).not.toContain("toLocaleDateString");
  });

  it("the stamp is rendered in both the library list and the template detail", () => {
    const calls = page.match(/attorneyReviewStampLabel\((t|detail\.data\.template)\)/g) ?? [];
    expect(calls.length).toBe(2);
    expect(page).toContain("attorneyReviewStampLabel(t)");
    expect(page).toContain("attorneyReviewStampLabel(detail.data.template)");
  });
});

describe("S-F5 — rendered output carries the drafted draft header", () => {
  const HEADER =
    "DRAFT — generated from a template in AcreOS. This document has not been reviewed for your state or your facts unless a review stamp is shown on the template. Have it reviewed by your own attorney before signing or recording.";

  it("the header copy is present verbatim", () => {
    expect(pageFlat).toContain(HEADER);
  });

  it("the header is prepended to the rendered output the preview and download share", () => {
    expect(page).toContain("setRenderedOutput(`${CCR_RENDERED_OUTPUT_HEADER}\\n\\n${r.rendered}`)");
    // The download is built from that same state, so it cannot go out bare.
    expect(page).toContain("new Blob([renderedOutput]");
  });
});

describe("scope guard — S-F1 labelling is not landed by this cure", () => {
  it("the CC&R surface carries none of the S-F1 permit-template copy", () => {
    expect(pageFlat).not.toContain("planning estimates supplied with the template");
    expect(pageFlat).not.toContain("The county has not given this date.");
  });
});
