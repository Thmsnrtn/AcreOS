// @vitest-environment jsdom
/**
 * DataRetentionLetter — the S-1 borrower letter in the borrower portal (P2-6 S2).
 *
 * Mounts the real component (react-dom/client + act, the repo idiom — see
 * statementsPanel.test.tsx) and pins:
 *   1. it renders the borrower's own context and the record list the
 *      template builds, with the house date for its reviewed-on stamp;
 *   2. it is STATIC — the census ruling that this surface owes no
 *      purpose-ledger DEBT entry rests on the letter reading nothing from the
 *      server, so neither the component nor the template may fetch, query or
 *      name an API path;
 *   3. the portal mounts it as a lazy tab inside its existing Tabs group
 *      (five-doors rule: a section behind an existing door, never a new one),
 *      and hands it the verified email rather than fetching one.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { DataRetentionLetter } from "../../client/src/components/borrower/DataRetentionLetter";
import { BORROWER_LETTER_REVIEWED_ON, PRIVACY_REQUEST_EMAIL } from "../../shared/privacy/borrowerErasureLetter";
import { DSAR_DOMAINS } from "../../shared/privacy/dsarDomains";
import { formatDate } from "../../client/src/lib/format";

const ROOT = path.resolve(__dirname, "../..");
const COMPONENT = "client/src/components/borrower/DataRetentionLetter.tsx";
const TEMPLATE = "shared/privacy/borrowerErasureLetter.ts";
const PORTAL = "client/src/pages/borrower-portal.tsx";
const read = (rel: string) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(props: React.ComponentProps<typeof DataRetentionLetter>) {
  act(() => {
    root.render(React.createElement(DataRetentionLetter, props));
  });
}

const q = (sel: string) => container.querySelector(sel);

describe("DataRetentionLetter — renders the borrower's own context", () => {
  it("greets by first name, names the lender and loan, and lists every registry domain", () => {
    mount({ borrowerFirstName: "Ana", lenderName: "Mesa Land Co", loanNumber: 42, emailOnFile: "ana@example.test" });

    expect(q('[data-testid="borrower-data-letter"]')).not.toBeNull();
    expect(q('[data-testid="letter-greeting"]')?.textContent).toBe("Hello Ana,");
    const text = container.textContent ?? "";
    expect(text).toContain("Mesa Land Co is your lender and holds the record of loan #42");
    expect(text).toContain("ana@example.test");
    expect(text).toContain("RETENTION_REQUIRED_LOAN_RECORDS");

    const leadExportDomains = DSAR_DOMAINS.filter((d) => d.decision === "export" && d.subjectKind === "lead").map((d) => d.domain);
    const items = container.querySelectorAll('[data-testid^="letter-record-item-"]');
    expect(items.length).toBe(leadExportDomains.length);
    for (const domain of leadExportDomains) {
      expect(q(`[data-testid="letter-record-item-${domain}"]`), `no list item for ${domain}`).not.toBeNull();
    }
  });

  it("stamps its reviewed-on date through the house formatter, built from parts (no UTC day shift)", () => {
    mount({ borrowerFirstName: null, lenderName: null, loanNumber: null, emailOnFile: null });
    const { year, month, day } = BORROWER_LETTER_REVIEWED_ON;
    expect(q('[data-testid="letter-reviewed-on"]')?.textContent).toBe(formatDate(new Date(year, month - 1, day)));
  });

  it("degrades honestly with no lender name and no borrower name", () => {
    mount({ borrowerFirstName: null, lenderName: null, loanNumber: 7, emailOnFile: null });
    const text = container.textContent ?? "";
    expect(q('[data-testid="letter-greeting"]')?.textContent).toBe("Hello,");
    expect(text).toContain("your lender");
    expect(text).not.toMatch(/\b(null|undefined|NaN)\b/);
  });

  it("links the request address and the privacy policy with visible focus styling", () => {
    mount({ borrowerFirstName: "Ana", lenderName: "Mesa Land Co", loanNumber: 42, emailOnFile: null });
    const mail = q('[data-testid="letter-contact-email"]') as HTMLAnchorElement | null;
    expect(mail?.getAttribute("href")).toBe(`mailto:${PRIVACY_REQUEST_EMAIL}`);
    expect(mail?.className).toContain("focus-visible:ring-2");
    const policy = q('[data-testid="letter-privacy-link"]') as HTMLAnchorElement | null;
    expect(policy?.getAttribute("href")).toBe("/privacy");
  });
});

describe("DataRetentionLetter — static by construction (the census ruling)", () => {
  // No DEBT entry is owed because no server read exists. If either file grows
  // one, the ruling in the PR body is void and the census must be re-run.
  for (const rel of [COMPONENT, TEMPLATE]) {
    it(`${rel} performs no fetch, query or API call`, () => {
      const src = read(rel);
      expect(src.length, `vacuity: ${rel} is empty`).toBeGreaterThan(800);
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toMatch(/useQuery|useMutation|apiRequest|queryClient/);
      expect(src).not.toContain("/api/");
      expect(src).not.toMatch(/process\.env/);
    });
  }
});

describe("borrower-portal mounts the letter as a lazy tab behind the existing Tabs door", () => {
  const portal = read(PORTAL);

  it("registers a 'Your data' trigger and content inside the existing Tabs group", () => {
    expect(portal).toContain('data-testid="tab-your-data"');
    expect(portal).toContain('<TabsContent value="your-data">');
    expect(portal).toContain('<TabsTrigger value="your-data"');
    // Still one Tabs group on the page — the letter did not become a second nav.
    expect(portal.match(/<Tabs\b/g)?.length).toBe(1);
  });

  it("loads the letter lazily, never as a static import", () => {
    expect(portal).toMatch(/lazy\(\(\) => import\("@\/components\/borrower\/DataRetentionLetter"\)\)/);
    expect(portal).not.toMatch(/^import .*DataRetentionLetter.* from/m);
    expect(portal).toContain("<Suspense fallback={<LetterLoadingSkeleton />}>");
  });

  it("passes the verified email and the lender name it already holds — no new request", () => {
    const start = portal.indexOf('<TabsContent value="your-data">');
    const block = portal.slice(start, portal.indexOf("</TabsContent>", start));
    expect(block).toContain("emailOnFile={verifiedEmail ?? null}");
    expect(block).toContain("lenderName={data.lenderName ?? null}");
    expect(block).toContain("loanNumber={note.id}");
    expect(block).not.toMatch(/fetch\s*\(/);
    expect(portal).toContain("verifiedEmail={email.trim()}");
  });
});
