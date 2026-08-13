/**
 * Any org could read — and OVERWRITE — any other org's document text.
 *
 * `/api/document-intelligence` is a live customer surface: mounted with
 * `isAuthenticated, getOrCreateOrg`, no flag gate, and driven by
 * `pages/document-intelligence.tsx`. `document_analysis` holds the extracted
 * TEXT of contracts, deeds, title reports and closing statements, plus the
 * AI-derived key terms (parties, amounts, dates) and risk flags.
 *
 * Every PER-DOCUMENT endpoint resolved its subject by primary key:
 *
 *   POST /documents/:id/process     run the pipeline over any org's document
 *   GET  /documents/:id/text        read any org's extracted text
 *   GET  /documents/:id/key-terms   parties, amounts, dates
 *   GET  /documents/:id/risks       risk flags
 *   GET  /documents/:id/summary     an AI summary of the whole document
 *   POST /documents/:id/compare     diff yours against any org's, and get a
 *                                   gpt-4o summary written from both
 *
 * THE LIST ENDPOINTS IN THE SAME FILE ALREADY PASSED THE ORG.
 * `getDocumentsByProperty(org.id, …)`, `getDocumentsByDeal(org.id, …)`,
 * `searchDocuments(org.id, …)` and `uploadDocument(org.id, …)` are all scoped,
 * in the same router, against the same table. The split was visible in one
 * screen — which is the whole shape units 30–55 keep finding, at its most
 * concentrated.
 *
 * `GET /documents/:id/text` WAS A WRITE
 * -------------------------------------
 * It forwarded `req.query.fileUrl` into `extractText`, whose `data:text/plain`
 * branch base64-decodes that value and **stores it as the document's
 * `rawText`**. So a caller could overwrite another org's extracted contract
 * text with content of their choosing — and `key-terms`, `risks` and `summary`
 * all read `rawText`, so the poisoning propagates into every later answer.
 * The URL now comes from the stored row; both real callers already passed
 * exactly that value.
 *
 * The same endpoint also ran OpenAI Vision with **no meter**, under a header
 * comment reading *"every endpoint below that triggers a gpt-4o call now runs
 * the same meter stack"*. That claim was false about `/text` and `/compare` —
 * both call gpt-4o. A comment is a factual claim about the code and decays like
 * any other; this is the third time this program has found one load-bearing and
 * wrong.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/** Line-based comment stripping. See destructivePermissionCoverage for why. */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    let s = line;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) { out.push(""); continue; }
      s = s.slice(end + 2);
      inBlock = false;
    }
    const open = s.indexOf("/*");
    if (open > -1) {
      const close = s.indexOf("*/", open + 2);
      if (close > -1) s = s.slice(0, open) + s.slice(close + 2);
      else if (/^\s*\{?\s*\/\*/.test(s)) { s = s.slice(0, open); inBlock = true; }
    }
    out.push(s.replace(/(^|[^:])\/\/.*$/, "$1"));
  }
  if (inBlock) throw new Error("stripComments ran away — assertions would be meaningless.");
  return out.join("\n");
}

const service = stripComments(
  fs.readFileSync(path.join(ROOT, "server/services/documentIntelligence.ts"), "utf8"),
);
const routes = stripComments(
  fs.readFileSync(path.join(ROOT, "server/routes-document-intelligence.ts"), "utf8"),
);

/** The per-document endpoints — the ones that took a bare id. */
const PER_DOCUMENT = [
  "'/documents/:id/process'",
  "'/documents/:id/text'",
  "'/documents/:id/key-terms'",
  "'/documents/:id/risks'",
  "'/documents/:id/summary'",
  "'/documents/:id/compare'",
];

function handler(marker: string): string {
  const at = routes.indexOf(marker);
  expect(at, `${marker} is gone — renamed?`).toBeGreaterThan(-1);
  const end = routes.indexOf("});", at);
  return routes.slice(at, end === -1 ? at + 900 : end);
}

describe("every per-document endpoint passes the caller's org", () => {
  it("all six still exist (vacuity guard)", () => {
    for (const m of PER_DOCUMENT) expect(routes, `${m} is missing`).toContain(m);
  });

  for (const marker of PER_DOCUMENT) {
    it(`${marker} scopes its lookup`, () => {
      expect(
        handler(marker),
        `${marker} resolves a document from the URL without the caller's ` +
          `organization. The list endpoints in this same router have always ` +
          `passed org.id — this is the same table.`,
      ).toContain("getOrganizationId(req)");
    });
  }

  it("no service call in the router omits the org", () => {
    // The generalisation: a new endpoint added below the six would not be
    // covered by the loop above.
    const calls = routes.match(/documentIntelligenceService\.\w+\([^;]*?\);/gs) ?? [];
    expect(calls.length, "no service calls found — did the router move?").toBeGreaterThan(6);
    const missing = calls.filter(
      (c) => !/getOrganizationId\(req\)|org\.id/.test(c),
    );
    expect(missing.join("\n---\n"), "a handler calls the service with no org").toBe("");
  });

  it("a foreign document answers 404, not 403", () => {
    expect(routes).toContain("DocumentNotInOrgError");
    const at = routes.indexOf("function refuse(");
    expect(at, "the shared refusal helper is gone").toBeGreaterThan(-1);
    const body = routes.slice(at, routes.indexOf("\n}", at));
    expect(body).toContain("Errors.notFound(");
    expect(
      body,
      "the cross-tenant branch answers 403, which confirms the document exists",
    ).not.toContain("Errors.forbidden(");
  });
});

describe("the service filters on the organization, in reads and writes alike", () => {
  it("every per-document read goes through requireDoc", () => {
    expect(service).toContain("private async requireDoc(documentId: number, organizationId: number)");
    const at = service.indexOf("private async requireDoc");
    const body = service.slice(at, service.indexOf("\n  }", at));
    expect(body).toContain("eq(documentAnalysis.organizationId, organizationId)");
    expect(body, "requireDoc does not refuse").toContain("throw new DocumentNotInOrgError");
  });

  it("no query in the service resolves a document by id alone", () => {
    // Whitespace-tolerant, and covering both the select and the update forms —
    // a lesson from the multi-line predicate that slipped past the first
    // version of the equivalent check in investorVerificationTenancy.
    const lone =
      service.match(/where\(\s*eq\(documentAnalysis\.id\s*,[^)]*\)\s*,?\s*\)/g) ?? [];
    expect(
      lone.join(" | "),
      "a query filters on document id with no organization predicate. Writes " +
        "count: scoping only the reads leaves processDocument able to mark " +
        "another org's document failed.",
    ).toBe("");
  });

  it("the writes are scoped too", () => {
    // processDocument sets status/rawText/extractedData on five separate
    // statements. Each is a chance to forget.
    expect(service).toContain("private ownedBy(documentId: number, organizationId: number)");
    const updates = service.match(/\.update\(documentAnalysis\)/g) ?? [];
    expect(updates.length, "no updates found — did the writes move?").toBeGreaterThan(3);
    const scoped = service.match(/\.where\(this\.ownedBy\(documentId, organizationId\)\)/g) ?? [];
    expect(
      scoped.length,
      "fewer scoped WHEREs than updates — one of the writes lost its org",
    ).toBeGreaterThanOrEqual(updates.length);
  });

  it("compare scopes BOTH documents", () => {
    // Comparing your own document against a foreign one would leak the foreign
    // one's extracted fields through the diff, and through the gpt-4o summary
    // written from it. One requireDoc is not enough here.
    const at = service.indexOf("async compareDocumentVersions");
    const body = service.slice(at, at + 900);
    expect(body).toContain("this.requireDoc(docId1, organizationId)");
    expect(body).toContain("this.requireDoc(docId2, organizationId)");
  });
});

describe("extractText no longer takes a URL from its caller", () => {
  it("the signature has no fileUrl parameter", () => {
    expect(
      service,
      "extractText takes a caller-supplied fileUrl again — the data:text/plain " +
        "branch decodes it into rawText, so that parameter is a write primitive",
    ).toContain("async extractText(documentId: number, organizationId: number)");
  });

  it("the URL comes from the stored row", () => {
    const at = service.indexOf("async extractText(");
    const body = service.slice(at, at + 700);
    expect(body).toContain("const fileUrl = doc.fileUrl");
  });

  it("the route does not forward req.query.fileUrl", () => {
    expect(
      routes,
      "the text endpoint reads fileUrl from the query string again",
    ).not.toContain("req.query.fileUrl");
  });

  it("the other caller passes an org, not a URL", () => {
    // routes-micro-features quick-capture creates the document with
    // fileUrl: dataUrl and then extracted with the same value — so reading it
    // off the row is behaviour-preserving there, which is why the parameter
    // could go rather than being validated.
    const micro = stripComments(
      fs.readFileSync(path.join(ROOT, "server/routes-micro-features.ts"), "utf8"),
    );
    expect(micro).toContain("extractText(doc.id, org.id)");
  });
});

describe("every gpt-4o endpoint is metered, as the file's own note claims", () => {
  // The note above the middleware reads: "every endpoint below that triggers a
  // gpt-4o call now runs the same meter stack as chat". /text (OpenAI Vision
  // OCR) and /compare (difference summary) were not metered, so the note was
  // false about two of the six. Asserted rather than trusted.
  const AI_ENDPOINTS = [
    "'/documents/:id/process'",
    "'/documents/:id/text'",
    "'/documents/:id/key-terms'",
    "'/documents/:id/risks'",
    "'/documents/:id/summary'",
    "'/documents/:id/compare'",
  ];

  for (const marker of AI_ENDPOINTS) {
    it(`${marker} runs the meter and counts the turn`, () => {
      const h = handler(marker);
      expect(h, `${marker} bypasses the ai_requests meter`).toContain("...aiMeter");
      expect(h, `${marker} does not count its turn`).toContain("countAiTurn(req)");
    });
  }

  it("the meter stack is the real one", () => {
    // Guards against the assertions above being satisfied by an `aiMeter` that
    // was quietly emptied.
    expect(routes).toContain('usageLimitGate("ai_requests")');
    expect(routes).toContain("aiByokThresholdGate()");
  });
});
