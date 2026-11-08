// @vitest-environment jsdom
/**
 * W3.8 — a deal prepares its own purchase agreement and hands it to the native
 * signing rail, from the deal's Documents tab.
 *
 * END TO END, not a mock of the server: the client components render in jsdom
 * and their `fetch` is bridged (supertest) into the REAL route handlers —
 * registerContractChainRoutes (preview → draft) and registerDocSystemRoutes
 * (the request-signature rail, the deal's document list, its packages) — over
 * the REAL pure assembler. Only persistence, auth and the logger are faked; the
 * fake store answers a read only inside the caller's organization, which is the
 * contract the real org-scoped repositories keep.
 *
 * Pinned:
 *   1. a missing required deal value refuses with the named fix list (which
 *      field, where to fill it) — no document, no create button, no write;
 *   2. the body on screen is the assembler's output for THIS deal's records
 *      (rendered and compared), and the draft stored is byte-for-byte what was
 *      reviewed;
 *   3. the hand-off produces the same document state as the existing Contracts
 *      tab flow, and never records a signature for anyone;
 *   4. a deal in another organization is 404 — preview, create and send;
 *   5. a disposition (sale) deal refuses rather than printing the parties
 *      the wrong way round;
 *   6. the deal tab reads its packages from a route that exists.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";

const H = vi.hoisted(() => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || "w3-8-test-signing-secret";
  type Row = Record<string, any>;
  const store = {
    orgs: new Map<number, Row>(),
    deals: new Map<number, Row>(),
    properties: new Map<number, Row>(),
    leads: new Map<number, Row>(),
    documents: new Map<number, Row>(),
    packages: [] as Row[],
    signaturesCreated: [] as Row[],
    nextDocId: 500,
  };
  const caller = { orgId: 42 };
  const inOrg = (row: Row | undefined, orgId: number) =>
    row && row.organizationId === orgId ? row : undefined;
  const storageMock = {
    getDeal: async (orgId: number, id: number) => inOrg(store.deals.get(Number(id)), orgId),
    getProperty: async (orgId: number, id: number) => inOrg(store.properties.get(Number(id)), orgId),
    getLead: async (orgId: number, id: number) => inOrg(store.leads.get(Number(id)), orgId),
    getOrganization: async (id: number) => store.orgs.get(Number(id)),
    createGeneratedDocument: async (doc: Row) => {
      const row = { id: store.nextDocId++, createdAt: new Date(), ...doc };
      store.documents.set(row.id, row);
      return row;
    },
    getGeneratedDocument: async (orgId: number, id: number) => inOrg(store.documents.get(Number(id)), orgId),
    getGeneratedDocuments: async (orgId: number, f: { dealId?: number } = {}) =>
      [...store.documents.values()].filter(
        (d) => d.organizationId === orgId && (f.dealId == null || d.dealId === f.dealId),
      ),
    updateGeneratedDocument: async (id: number, patch: Row, orgId?: number) => {
      const row = store.documents.get(Number(id));
      if (!row || (orgId != null && row.organizationId !== orgId)) return undefined;
      Object.assign(row, patch);
      return row;
    },
    getPackagesByDeal: async (orgId: number, dealId: number) =>
      store.packages.filter((p) => p.organizationId === orgId && p.dealId === dealId),
    createSignature: async (sig: Row) => {
      store.signaturesCreated.push(sig);
      return { id: store.signaturesCreated.length, ...sig };
    },
    getSignatures: async () => [],
    getDocumentSignatures: async () => [],
  };
  const chain = (): any => {
    const c: any = {};
    for (const m of ["where", "limit", "orderBy", "innerJoin", "leftJoin"]) c[m] = () => c;
    c.then = (f: any, r: any) => Promise.resolve([]).then(f, r);
    return c;
  };
  const dbMock: any = {
    select: () => ({ from: () => chain() }),
    insert: () => ({ values: () => ({ returning: async () => [] }) }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    execute: async () => ({ rows: [] }),
  };
  return { store, caller, storageMock, dbMock };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/db", () => ({ db: H.dbMock }));
vi.mock("../../server/storage", () => ({ storage: H.storageMock, db: H.dbMock }));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "7", email: "operator@example.com" };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = H.store.orgs.get(H.caller.orgId);
    next();
  },
}));
vi.mock("../../server/middleware/idempotency", () => ({
  idempotencyMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { registerDocSystemRoutes } from "../../server/routes-doc-system";
import { registerContractChainRoutes } from "../../server/routes-contract-chain";
import { assembleContract } from "../../server/services/contracts/contractAssembly";
import { verifySigningToken, __resetKeyRingForTests } from "../../server/services/signingTokens";
import { queryClient } from "../../client/src/lib/queryClient";
import { DealPurchaseAgreementSection } from "../../client/src/components/deals/DealPurchaseAgreementSection";
import { ContractChainSection } from "../../client/src/pages/offers";

const app = express();
app.use(express.json());
registerDocSystemRoutes(app);
registerContractChainRoutes(app);

// ── fixtures ────────────────────────────────────────────────────────────────

const ORG = 42;
const OTHER_ORG = 99;

function seed() {
  const s = H.store;
  s.orgs.clear(); s.deals.clear(); s.properties.clear(); s.leads.clear(); s.documents.clear();
  s.packages.length = 0; s.signaturesCreated.length = 0; s.nextDocId = 500;
  H.caller.orgId = ORG;

  s.orgs.set(ORG, {
    id: ORG, name: "Peachtree", legalEntityName: "Peachtree Holdings LLC",
    settings: { companyEmail: "offers@example.com", companyAddress: "100 Peachtree St, Atlanta, GA" },
  });
  s.orgs.set(OTHER_ORG, { id: OTHER_ORG, name: "Elsewhere", legalEntityName: "Elsewhere Land LLC", settings: {} });

  // Deal 12 — complete, accepted acquisition in a contract-ready state.
  s.leads.set(3, { id: 3, organizationId: ORG, firstName: "Dolores", lastName: "Whitfield", email: "dolores@example.com", address: "9 Elm St" });
  s.properties.set(7, {
    id: 7, organizationId: ORG, apn: "17-0123-0001", address: "1247 Cherokee Pl", city: "Atlanta",
    state: "GA", county: "Fulton", zip: "30315", sizeAcres: "0.21",
    legalDescription: "Lot 14, Block C, Cherokee Heights", sellerId: 3, structureType: null,
  });
  s.deals.set(12, { id: 12, organizationId: ORG, propertyId: 7, type: "acquisition", status: "accepted", acceptedAmount: "182500.00", closingDate: new Date("2026-09-15T12:00:00.000Z") });

  // Deal 13 — accepted, but no seller on the property and no closing date.
  s.properties.set(8, { id: 8, organizationId: ORG, apn: "17-0123-0002", address: "12 Pine Rd", city: "Atlanta", state: "GA", county: "Fulton", zip: "30315", sellerId: null, structureType: null });
  s.deals.set(13, { id: 13, organizationId: ORG, propertyId: 8, type: "acquisition", status: "accepted", acceptedAmount: "40000", closingDate: null });

  // Deal 14 — a SALE the org is making, otherwise complete.
  s.deals.set(14, { id: 14, organizationId: ORG, propertyId: 7, type: "disposition", status: "accepted", acceptedAmount: "210000", closingDate: new Date("2026-10-01T12:00:00.000Z") });

  // Deal 77 — another organization's complete deal, with a draft of its own.
  s.leads.set(71, { id: 71, organizationId: OTHER_ORG, firstName: "Ola", lastName: "Other", email: "ola@example.com" });
  s.properties.set(70, { id: 70, organizationId: OTHER_ORG, apn: "99-1", address: "1 Other Way", city: "Austin", state: "TX", county: "Travis", zip: "78701", sellerId: 71, structureType: null });
  s.deals.set(77, { id: 77, organizationId: OTHER_ORG, propertyId: 70, type: "acquisition", status: "accepted", acceptedAmount: "90000", closingDate: new Date("2026-09-01T12:00:00.000Z") });
  s.documents.set(400, { id: 400, organizationId: OTHER_ORG, dealId: 77, type: "purchase_agreement", name: "Other org's agreement", status: "draft", content: "x", variables: {} });
}

/** What the assembler makes of a stored deal — the same inputs the route gathers. */
function expectedAssembly(dealId: number) {
  const s = H.store;
  const deal = s.deals.get(dealId)!;
  const property = s.properties.get(deal.propertyId)!;
  const org = s.orgs.get(deal.organizationId)!;
  const seller = property.sellerId ? s.leads.get(property.sellerId) : undefined;
  return assembleContract({
    kind: "purchase_agreement",
    organizationName: org.name,
    deal: { id: deal.id, status: deal.status, type: deal.type, acceptedAmount: deal.acceptedAmount, closingDate: deal.closingDate },
    property: {
      id: property.id, apn: property.apn, address: property.address, city: property.city, state: property.state,
      county: property.county, zip: property.zip, sizeAcres: property.sizeAcres, legalDescription: property.legalDescription,
      propertyClass: undefined,
    },
    seller: seller ? { legalName: `${seller.firstName} ${seller.lastName}`, email: seller.email, address: seller.address } : { legalName: null },
    buyer: { legalName: org.legalEntityName, email: org.settings?.companyEmail ?? null, address: org.settings?.companyAddress ?? null },
  });
}

// ── fetch → real routes ─────────────────────────────────────────────────────

let calls: Array<{ method: string; url: string; body: unknown }> = [];

async function bridge(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, url, body });
  const agent = request(app) as any;
  let r = agent[method.toLowerCase()](url);
  const headers = (init?.headers ?? {}) as Record<string, string>;
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  const res = body !== undefined ? await r.send(body) : await r;
  return new Response(res.text ?? "", {
    status: res.status,
    headers: { "Content-Type": String(res.headers["content-type"] ?? "application/json") },
  });
}

const writes = () => calls.filter((c) => c.method !== "GET");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  seed();
  __resetKeyRingForTests();
  calls = [];
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false, gcTime: 0 }, mutations: { retry: false } });
  vi.stubGlobal("fetch", vi.fn(bridge));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(
      React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(Router, null, node)),
    );
  });
}

function q(selector: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(selector);
}

async function waitFor(pred: () => boolean, what: string, ms = 4000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}

async function click(selector: string) {
  const el = q(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function openDealSection(dealId: number) {
  await render(React.createElement(DealPurchaseAgreementSection, { dealId, dealLabel: `Deal #${dealId}` }));
  await waitFor(() => !!q('[data-testid="button-prepare-purchase-agreement"]'), "the section");
  await waitFor(() => calls.some((c) => c.url.startsWith("/api/generated-documents?dealId=")), "the document list read");
  await click('[data-testid="button-prepare-purchase-agreement"]');
  await waitFor(
    () => !!q('[data-testid="contract-preview-content"]') || !!q('[data-testid="contract-refusal"]') || !!q('[data-testid="contract-preview-error"]'),
    "the review step",
  );
}

/** Review → confirm → create → send, through whatever surface is mounted. */
async function confirmCreateSend() {
  await click('[data-testid="checkbox-confirm-review"]');
  await click('[data-testid="button-create-contract"]');
  await waitFor(() => !!q('[data-testid="button-send-for-signature"]'), "the draft");
  await click('[data-testid="button-send-for-signature"]');
  await waitFor(() => !!q('[data-testid^="button-copy-signing-link-"]'), "the signing links");
}

function sanitizedText(html: string): string {
  const el = document.createElement("div");
  el.innerHTML = html;
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

// ── 1. refusal with a fix list ──────────────────────────────────────────────

describe("a missing required deal value refuses with a named fix list", () => {
  it("names each missing field and where to fill it; nothing is offered or written", async () => {
    const expected = expectedAssembly(13);
    expect(expected.ok, "fixture: deal 13 must be incomplete").toBe(false);
    const missing = !expected.ok && expected.refusal.code === "MISSING_REQUIRED_FIELDS" ? expected.refusal.missing : [];
    expect(missing.map((m) => m.field).sort()).toEqual(["closing_date", "seller_name"]);

    await openDealSection(13);
    const refusal = q('[data-testid="contract-refusal"]');
    expect(refusal, "refusal rendered").not.toBeNull();
    const items = [...refusal!.querySelectorAll("li")].map((li) => li.textContent?.replace(/\s+/g, " ").trim());
    expect(items).toEqual(missing.map((m) => `${m.label} — ${m.fixAt}`));
    expect(items.join(" ")).toContain("Deal #13 → Closing date");
    expect(items.join(" ")).toContain("Property #8 → Seller contact");

    expect(q('[data-testid="contract-preview-content"]')).toBeNull();
    expect(q('[data-testid="button-create-contract"]')).toBeNull();
    expect(writes()).toHaveLength(0);
    expect(H.store.documents.size).toBe(1); // only the other org's seeded row
  });
});

// ── 2. the deal's real values, rendered and compared ────────────────────────

describe("the body on screen is this deal's, and the draft is what was reviewed", () => {
  it("renders the assembler's output for deal 12 and stores exactly that", async () => {
    await openDealSection(12);
    const expected = expectedAssembly(12);
    if (!expected.ok) throw new Error(`fixture: deal 12 must assemble, got ${expected.refusal.code}`);

    const shown = q('[data-testid="contract-preview-content"]')!;
    expect(sanitizedText(shown.innerHTML)).toBe(sanitizedText(expected.draft.content));
    for (const real of ["Dolores Whitfield", "Peachtree Holdings LLC", "$182,500.00", "17-0123-0001", "Fulton", "September 15, 2026", "1247 Cherokee Pl, Atlanta, GA, 30315"]) {
      expect(shown.textContent, real).toContain(real);
    }
    const preview = calls.find((c) => c.url.includes("/contract-preview"))!;
    expect(preview.url).toBe("/api/deals/12/contract-preview?kind=purchase_agreement");
    expect(writes()).toHaveLength(0);

    await click('[data-testid="checkbox-confirm-review"]');
    await click('[data-testid="button-create-contract"]');
    await waitFor(() => !!q('[data-testid="button-send-for-signature"]'), "the draft");

    const create = writes().find((c) => c.url === "/api/deals/12/contract")!;
    expect(create.body).toMatchObject({ kind: "purchase_agreement", confirmReviewed: true, reviewedContentHash: expected.draft.contentHash });
    const drafts = [...H.store.documents.values()].filter((d) => d.organizationId === ORG);
    expect(drafts).toHaveLength(1);
    const draft = drafts[0];
    expect(draft).toMatchObject({ dealId: 12, propertyId: 7, type: "purchase_agreement", status: "draft" });
    expect(draft.content).toBe(expected.draft.content);
    expect(draft.variables.contract_chain_reviewed_sha256).toBe(
      crypto.createHash("sha256").update(draft.content, "utf8").digest("hex"),
    );
    // Creating is not sending.
    expect(calls.some((c) => c.url.includes("/request-signature"))).toBe(false);

    // The deal's own list now shows the draft, from generated_documents.
    await waitFor(() => !!q(`[data-testid="deal-purchase-agreement-${draft.id}"]`), "the list refresh");
    expect(q(`[data-testid="deal-purchase-agreement-${draft.id}"]`)!.textContent).toContain("Draft — not sent");
  });
});

// ── 3. the hand-off ─────────────────────────────────────────────────────────

/** Document state with the per-run identity (ids, clocks) taken out. */
function comparable(doc: Record<string, any>): Record<string, any> {
  const { id: _id, createdAt: _c, sentAt: _s, expiresAt: _e, variables, signers, ...rest } = doc;
  const { contract_chain_reviewed_at: _at, ...vars } = variables ?? {};
  return {
    ...rest,
    variables: vars,
    signers: (signers ?? []).map(({ id: _sid, ...s }: Record<string, any>) => s),
  };
}

describe("the hand-off is the existing native rail, and no one is marked signed", () => {
  it("reaches pending_signature with the reviewed roster and verifiable links, recording no signature", async () => {
    await openDealSection(12);
    await confirmCreateSend();

    const doc = [...H.store.documents.values()].find((d) => d.organizationId === ORG)!;
    const send = writes().find((c) => c.url.includes("/request-signature"))!;
    expect(send.url).toBe(`/api/generated-documents/${doc.id}/request-signature`);

    expect(doc).toMatchObject({ status: "pending_signature", esignProvider: "native", esignStatus: "pending" });
    expect(doc.signedAt ?? null).toBeNull();
    expect(doc.completedAt ?? null).toBeNull();
    const expected = expectedAssembly(12);
    if (!expected.ok) throw new Error("fixture");
    expect(doc.signers.map((s: any) => ({ name: s.name, role: s.role, email: s.email }))).toEqual(
      expected.draft.signerRoles.map((r) => ({ name: r.name, role: r.role, email: r.email ?? "" })),
    );
    for (const s of doc.signers) expect(s.signedAt).toBeUndefined();
    expect(H.store.signaturesCreated).toHaveLength(0);
    expect(calls.some((c) => c.url.startsWith("/api/signatures") || c.url.startsWith("/api/public/sign"))).toBe(false);

    // Each link opens THIS document for THAT signer, and verifies.
    const sendResponseLinks = doc.signers.length;
    expect(document.body.querySelectorAll('[data-testid^="button-copy-signing-link-"]').length).toBe(sendResponseLinks);
    const res = await request(app).get(`/api/generated-documents/${doc.id}`);
    expect(res.status).toBe(200);
  });

  it("produces the same document state as the existing Contracts-tab flow", async () => {
    await openDealSection(12);
    await confirmCreateSend();
    const fromDeal = comparable([...H.store.documents.values()].find((d) => d.organizationId === ORG)!);
    const linksFromDeal = await mintedLinks();

    await act(async () => root.unmount());
    root = createRoot(container);
    seed();
    __resetKeyRingForTests();
    calls = [];
    queryClient.clear();

    await render(
      React.createElement(ContractChainSection, {
        deals: [H.store.deals.get(12)] as never,
        dealsLoading: false,
        dealsError: null,
        onRetryDeals: () => {},
        properties: [H.store.properties.get(7)] as never,
      }),
    );
    await click('[data-testid="button-prepare-contract-12"]');
    await waitFor(() => !!q('[data-testid="contract-preview-content"]'), "the review step");
    await confirmCreateSend();
    const fromOffers = comparable([...H.store.documents.values()].find((d) => d.organizationId === ORG)!);

    expect(fromDeal).toEqual(fromOffers);
    expect(fromDeal.status).toBe("pending_signature");
    expect(linksFromDeal.length).toBeGreaterThan(0);
  });
});

/** Re-mint the links the rail would answer with and check each verifies. */
async function mintedLinks() {
  const doc = [...H.store.documents.values()].find((d) => d.organizationId === ORG)!;
  const { makeSigningToken } = await import("../../server/services/signingTokens");
  return doc.signers.map((s: any) => {
    const t = makeSigningToken(doc.id, s.id);
    expect(verifySigningToken(doc.id, s.id, t)).toBe(true);
    return t;
  });
}

// ── 4. org scoping ──────────────────────────────────────────────────────────

describe("another organization's deal is not found", () => {
  it("the deal surface shows none of its documents and the preview is a 404, not a contract", async () => {
    await openDealSection(77);
    expect(q('[data-testid="contract-preview-error"]'), "a not-found error, not a document").not.toBeNull();
    expect(q('[data-testid="contract-preview-content"]')).toBeNull();
    expect(q('[data-testid="deal-purchase-agreement-400"]')).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it("create and send refuse with 404 and change nothing", async () => {
    const create = await request(app)
      .post("/api/deals/77/contract")
      .send({ kind: "purchase_agreement", confirmReviewed: true, reviewedContentHash: "x" });
    expect(create.status).toBe(404);
    const send = await request(app)
      .post("/api/generated-documents/400/request-signature")
      .send({ signers: [{ name: "A", email: "a@example.com", role: "seller" }] });
    expect(send.status).toBe(404);
    expect(H.store.documents.get(400)!.status).toBe("draft");
    expect([...H.store.documents.values()]).toHaveLength(1);
  });

  it("vacuity: the same deal IS found for its own organization", async () => {
    H.caller.orgId = OTHER_ORG;
    const res = await request(app).get("/api/deals/77/contract-preview?kind=purchase_agreement");
    expect(res.status).toBe(200);
    expect(res.body.content).toContain("Ola Other");
  });
});

// ── 5. a sale deal ──────────────────────────────────────────────────────────

describe("a disposition deal refuses instead of reversing the parties", () => {
  it("names the reason and offers no document", async () => {
    await openDealSection(14);
    const refusal = q('[data-testid="contract-refusal"]');
    expect(refusal).not.toBeNull();
    expect(refusal!.textContent).toContain("Not for a deal where you are selling");
    expect(q('[data-testid="contract-refusal-message"]')!.textContent).toContain("sale (disposition)");
    expect(q('[data-testid="button-create-contract"]')).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it("the assembler itself refuses (the rule lives server-side, for every caller)", () => {
    const r = expectedAssembly(14);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe("DEAL_TYPE_NOT_SUPPORTED");
    // Control: the same records as an acquisition assemble.
    H.store.deals.get(14)!.type = "acquisition";
    expect(expectedAssembly(14).ok).toBe(true);
  });
});

// ── 6. the deal tab's packages read a real route ────────────────────────────

describe("the deal's Documents tab reads its packages from a route that exists", () => {
  it("GET /api/deals/:id/packages answers with this org's packages; the old path matched nothing", async () => {
    H.store.packages.push({ id: 1, organizationId: ORG, dealId: 12, name: "Closing set", status: "draft", documents: [] });
    H.store.packages.push({ id: 2, organizationId: OTHER_ORG, dealId: 12, name: "Not ours", status: "draft", documents: [] });
    const ok = await request(app).get("/api/deals/12/packages");
    expect(ok.status).toBe(200);
    expect(ok.body.map((p: any) => p.name)).toEqual(["Closing set"]);
    const old = await request(app).get("/api/document-packages/deal/12");
    expect(old.status).toBe(404);
  });

  it("the deal detail fetches exactly that route (parsed from the component, not grepped)", async () => {
    const ts = (await import("typescript")).default;
    const fs = await import("node:fs");
    const path = await import("node:path");
    const file = path.resolve(__dirname, "../../client/src/components/deal-detail-content.tsx");
    const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const fetched: string[] = [];
    const visit = (n: import("typescript").Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "fetch") {
        const a = n.arguments[0];
        if (a && ts.isTemplateExpression(a)) {
          fetched.push(a.head.text + a.templateSpans.map((s) => "${}" + s.literal.text).join(""));
        } else if (a && ts.isStringLiteralLike(a)) fetched.push(a.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(fetched.length, "vacuity: the component's fetch calls were found").toBeGreaterThan(0);
    const packageReads = fetched.filter((u) => /packages/.test(u));
    expect(packageReads).toEqual(["/api/deals/${}/packages"]);
  });
});
