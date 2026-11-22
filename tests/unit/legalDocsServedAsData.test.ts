/**
 * The legal documents' section bodies are served as static HTML, not
 * bundled as JS.
 *
 * The Privacy Policy and Terms of Service section bodies
 * (client/src/legal/*.html, ~57 KB of static HTML) used to be inline JSX
 * in client/src/pages/privacy.tsx and pages/terms.tsx, which put every
 * byte inside the bundle gate's summed JS total
 * (scripts/check-bundle-size.js counts every emitted .js file). The files
 * now ship as static assets (vite.config.ts legalDocsPlugin copies them
 * verbatim into dist/public/legal/) and the pages render them on demand
 * via client/src/components/legal-doc-body.tsx + lib/legal-doc.ts. That
 * stays safe only while:
 *
 *   1. the pages never carry the section bodies again — text that sneaks
 *      back into the page files silently re-spends the freed headroom;
 *   2. the loader, the component and the plugin agree on the served URLs,
 *      and the plugin keeps copying the assets verbatim and serving them
 *      in dev;
 *   3. a failed fetch rejects instead of resolving an empty result (the
 *      empty-on-failure ratchet's rule — a legal document must never
 *      render as a silently shorter one), and the component shows a
 *      visible failure line instead of an empty card;
 *   4. the bodies' single-source-of-truth values stay TOKENS
 *      ({{LEGAL_ENTITY_OPERATED_BY}}, {{LEGAL_GOVERNING_STATE}},
 *      {{PAX_CONTROLS_LABEL}}) substituted at render time — baking the
 *      current values into the assets would break the one-edit entity
 *      flip in client/src/lib/legal-entity.ts;
 *   5. the assets keep the documents' full section structure (headings,
 *      in order), the support-feedback slot the pages portal into, and no
 *      executable markup;
 *   6. Tailwind keeps scanning the assets, so their classes keep
 *      generating CSS.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "../..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

const privacyPage = stripComments(read("client/src/pages/privacy.tsx"));
const termsPage = stripComments(read("client/src/pages/terms.tsx"));
const loader = stripComments(read("client/src/lib/legal-doc.ts"));
const body = stripComments(read("client/src/components/legal-doc-body.tsx"));
const config = stripComments(read("vite.config.ts"));
const tailwind = read("tailwind.config.ts");
const privacyHtml = read("client/src/legal/privacy-policy.html");
const termsHtml = read("client/src/legal/terms-of-service.html");

describe("the section bodies are not bundled", () => {
  it("the pages render LegalDocBody and carry none of the body text", () => {
    expect(privacyPage).toMatch(/<LegalDocBody/);
    expect(privacyPage).toMatch(/url=\{PRIVACY_POLICY_URL\}/);
    expect(privacyPage, "privacy body text must live in the asset only").not.toMatch(
      /Who this policy applies to|Data we collect|Subprocessors/,
    );
    expect(termsPage).toMatch(/<LegalDocBody/);
    expect(termsPage).toMatch(/url=\{TERMS_OF_SERVICE_URL\}/);
    expect(termsPage, "terms body text must live in the asset only").not.toMatch(
      /Acceptance of terms|Limitation of liability|Arbitration/,
    );
  });

  it("the pages keep their shells (title, read-aloud, entity footer)", () => {
    expect(privacyPage).toMatch(/data-testid="text-privacy-title"/);
    expect(privacyPage).toMatch(/LegalDocReadAloud/);
    expect(privacyPage).toMatch(/LEGAL_ENTITY_FOOTER/);
    expect(termsPage).toMatch(/data-testid="text-terms-title"/);
    expect(termsPage).toMatch(/LegalDocReadAloud/);
    expect(termsPage).toMatch(/LEGAL_ENTITY_FOOTER/);
  });

  it("the pages pass the support button with its original props", () => {
    expect(privacyPage).toMatch(/testId="privacy-contact-team"/);
    expect(privacyPage).toMatch(/source="privacy_page"/);
    expect(termsPage).toMatch(/testId="terms-contact-legal"/);
    expect(termsPage).toMatch(/source="terms_legal"/);
  });
});

describe("the loader fetches the served assets and fails loudly", () => {
  it("exposes the URLs the plugin serves and throws on !ok", () => {
    expect(loader).toMatch(/export const PRIVACY_POLICY_URL = "\/legal\/privacy-policy\.html";/);
    expect(loader).toMatch(/export const TERMS_OF_SERVICE_URL = "\/legal\/terms-of-service\.html";/);
    expect(loader).toMatch(/if \(!res\.ok\) \{\s*throw new Error/);
  });

  it("resolves the body text and shares one request per URL across callers", async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "<section>body</section>",
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { fetchLegalDoc, PRIVACY_POLICY_URL } = await import(
        "../../client/src/lib/legal-doc"
      );
      await expect(fetchLegalDoc(PRIVACY_POLICY_URL)).resolves.toBe("<section>body</section>");
      await expect(fetchLegalDoc(PRIVACY_POLICY_URL)).resolves.toBe("<section>body</section>");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(PRIVACY_POLICY_URL);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects on a non-ok response, and a later caller can retry", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, text: async () => "" })),
    );
    try {
      const { fetchLegalDoc, TERMS_OF_SERVICE_URL } = await import(
        "../../client/src/lib/legal-doc"
      );
      await expect(fetchLegalDoc(TERMS_OF_SERVICE_URL)).rejects.toThrow(/503/);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, status: 200, text: async () => "<section>ok</section>" })),
      );
      await expect(fetchLegalDoc(TERMS_OF_SERVICE_URL)).resolves.toBe("<section>ok</section>");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("substitutes tokens from the supplied values and leaves unknown tokens visible", async () => {
    const { substituteLegalTokens } = await import("../../client/src/lib/legal-doc");
    expect(
      substituteLegalTokens("<p>{{LEGAL_GOVERNING_STATE}} law</p>", {
        LEGAL_GOVERNING_STATE: "Massachusetts",
      }),
    ).toBe("<p>Massachusetts law</p>");
    expect(substituteLegalTokens("<p>{{UNSUPPLIED}}</p>", {})).toBe("<p>{{UNSUPPLIED}}</p>");
  });
});

describe("the component sanitizes, portals and routes like the JSX did", () => {
  it("sanitizes the fetched HTML before innerHTML", () => {
    expect(body).toMatch(/DOMPurify\.sanitize\(html\)/);
    // The sanitize call is inline at the sink itself — the sink gate
    // (noDataReachesTheDomAsHtml) accepts only a literal
    // DOMPurify.sanitize(...) call (or a constant) as the __html value,
    // never a variable holding a memoised result.
    expect(body).toMatch(
      /dangerouslySetInnerHTML=\{\{ __html: DOMPurify\.sanitize\(html\) \}\}/,
    );
    expect(body).not.toMatch(/__html: sanitized/);
    // No home-grown comment-strip regex: DOMPurify drops comment nodes
    // itself (a regex strip is the CodeQL
    // js/incomplete-multi-character-sanitization shape).
    expect(body).not.toMatch(/replace\(\/<!--/);
  });

  it("portals the support button into the asset's slot", () => {
    expect(body).toMatch(/querySelector\("\[data-support-feedback-slot\]"\)/);
    expect(body).toMatch(/createPortal\(supportFeedbackButton, slot\)/);
    // The slot lookup keys off the substituted `html` state (there is no
    // memoised sanitized value to key off any more).
    expect(body).toMatch(/\}, \[html\]\);/);
  });

  it("routes internal links through wouter instead of full page loads", () => {
    expect(body).toMatch(/a\[data-internal-link="true"\]/);
    expect(body).toMatch(/setLocation\(href\)/);
  });

  it("renders a visible failure line, never an empty body, on fetch failure", () => {
    expect(body).toMatch(/-load-error/);
    expect(body).toMatch(/couldn&rsquo;t load/);
  });
});

describe("the Vite plugin wires the verbatim copy and dev serving", () => {
  it("registers the plugin as customer-only and in the plugin list", () => {
    expect(config).toMatch(/function legalDocsPlugin\(\): Plugin/);
    expect(config).toMatch(/legalDocsPlugin\(\)/);
    expect(config).toMatch(/"acreos-legal-docs"/);
  });

  it("copies both assets verbatim into the build output and serves them in dev", () => {
    expect(config).toMatch(/"\/legal\/privacy-policy\.html": "privacy-policy\.html"/);
    expect(config).toMatch(/"\/legal\/terms-of-service\.html": "terms-of-service\.html"/);
    expect(config).toMatch(/fs\.copyFileSync\(path\.join\(sourceDir, file\), dest\)/);
    expect(config).toMatch(/configureServer\(server\)/);
  });

  it("Tailwind keeps scanning the legal assets for classes", () => {
    expect(tailwind).toMatch(/\.\/client\/src\/legal\/\*\.html/);
  });
});

describe("the assets keep the documents whole", () => {
  const headings = (html: string): string[] =>
    Array.from(html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g), (m) => m[1]);

  it("privacy carries all 16 numbered sections in order", () => {
    const hs = headings(privacyHtml);
    expect(hs.length).toBe(16);
    expect(hs[0]).toMatch(/^1\. Who this policy applies to/);
    expect(hs[7]).toMatch(/^8\. Subprocessors/);
    expect(hs[15]).toMatch(/^16\. Contact/);
    expect(Array.from(privacyHtml.matchAll(/<section/g)).length).toBe(16);
  });

  it("terms carries all 21 sections in order (incl. §5A)", () => {
    const hs = headings(termsHtml);
    expect(hs.length).toBe(21);
    expect(hs[0]).toMatch(/^1\. Acceptance of terms/);
    expect(hs[5]).toMatch(/^5A\. /);
    expect(hs[20]).toMatch(/^20\. Contact/);
    expect(Array.from(termsHtml.matchAll(/<section/g)).length).toBe(21);
  });

  it("the single-source-of-truth values stay tokens, never baked in", () => {
    expect(termsHtml).toMatch(/\{\{LEGAL_ENTITY_OPERATED_BY\}\}/);
    expect(Array.from(termsHtml.matchAll(/\{\{LEGAL_GOVERNING_STATE\}\}/g)).length).toBe(4);
    expect(privacyHtml).toMatch(/\{\{PAX_CONTROLS_LABEL\}\}/);
    // The sole-proprietor descriptor must NOT be frozen into the asset.
    expect(termsHtml).not.toMatch(/sole proprietorship of Thomas Norton/);
  });

  it("both assets carry the support slot and no executable markup", () => {
    for (const html of [privacyHtml, termsHtml]) {
      expect(html).toMatch(/<span data-support-feedback-slot=""><\/span>/);
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/\son\w+="/i);
    }
  });

  it("internal links carry the routing marker; mail links do not", () => {
    expect(privacyHtml).toMatch(/<a data-internal-link="true" href="\/privacy\/owner-request"/);
    expect(privacyHtml).toMatch(/<a href="mailto:privacy@acreos\.io"/);
    expect(termsHtml).toMatch(/<a href="mailto:legal@acreos\.io"/);
  });
});
