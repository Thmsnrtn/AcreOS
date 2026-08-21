/**
 * The MLS connector's queries must mean what the tools promise.
 *
 * ── WHY A NEW FILE RATHER THAN A CASE IN AN EXISTING GATE ───────────────────
 * The two defects here are invisible to every gate this repo already has, and
 * for instructive reasons:
 *
 *   `paxToolsReportRealEffects` asks whether a handler does LESS than it claims.
 *   `getMlsComps` awaited a real credential read and issued a real HTTP request
 *   against the customer's real MLS. It did the work. The work was wrong.
 *
 *   `paxToolsPerformNoDeletion` asks whether a handler does MORE than it may.
 *   Reading listings is squarely within what it may do.
 *
 *   `connectorCatalogIsHonest` asks whether a declared tool has a handler.
 *   Both of these had one.
 *
 * The question none of them asks is whether the QUERY the handler builds
 * answers the question the tool's name and arguments promise. That is this file.
 *
 * ── DEFECT 1: "COMPS" RETURNED THE SUBJECT PROPERTY ─────────────────────────
 *     $filter=StandardStatus eq 'Closed' and UnparsedAddress eq '<the address>'
 * `UnparsedAddress eq` is an exact match, so the result is at most one record —
 * the subject's own closed listing. The advertised `radius` argument appeared
 * nowhere in the body. `get_mls_comps` feeds pricing, so this produced a figure
 * labelled a comp that is precisely the one sale that is not one.
 *
 * ── DEFECT 2: UNESCAPED ODATA STRING LITERALS ───────────────────────────────
 * `City eq '${args.city}'` with values Pax fills in from a model. An apostrophe
 * closes the literal early: "Coeur d'Alene" and "O'Fallon" are real American
 * places this product is sold into, and both produced a malformed filter. A
 * crafted value could append clauses. The org queries its OWN MLS with its OWN
 * token, so this is a correctness defect rather than a tenancy one — worth
 * saying plainly rather than dressing up as a security finding.
 *
 * ── DEFECT 3: A SILENT VENDOR FALLBACK ──────────────────────────────────────
 * `creds.mlsUrl ?? "https://replication.sparkplatform.com/api/v1"` — one
 * vendor's host, used silently for an org that had named none, which would send
 * that org's bearer token to a third party nobody chose.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG = { id: 42 } as any;

let creds: Record<string, unknown> | null;
let requests: string[];

/**
 * The `$filter` as the MLS would receive it.
 *
 * `URLSearchParams` percent-encodes AND encodes spaces as `+`, which
 * `decodeURIComponent` does not undo — the first version of this helper read
 * back `City+eq+'Coeur+d''Alene'` and failed against CORRECT escaping. Parsing
 * with URLSearchParams applies both rules, which is what the server does.
 */
function emittedFilter(url: string): string {
  return new URL(url).searchParams.get("$filter") ?? "";
}

function fakeFetch(url: string) {
  requests.push(String(url));
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ value: [] }),
  } as unknown as Response);
}

/**
 * `getCredentials` is module-private to executor.ts and reads through
 * `storage.getPaxConnector` + `decryptCredentials`, so the seam is those two —
 * not a credentials module (there isn't one). Mocking what the code actually
 * depends on rather than what a plausible layering would have had it depend on.
 */
async function load() {
  vi.resetModules();
  vi.doMock("../../server/storage", () => ({
    storage: {
      getPaxConnector: async () =>
        creds === null
          ? null
          : { status: "connected", credentialsEncrypted: "ciphertext" },
    },
  }));
  vi.doMock("../../server/services/fieldEncryption", () => ({
    decryptCredentials: () => JSON.stringify(creds ?? {}),
  }));
  return import("../../server/services/connectors/executor");
}

beforeEach(() => {
  requests = [];
  creds = { accessToken: "tok", mlsUrl: "https://reso.example.org/odata" };
  vi.stubGlobal("fetch", fakeFetch as unknown as typeof fetch);
});

describe("searchMlsListings builds a well-formed RESO query", () => {
  it("VACUITY: an ordinary search does issue a request against the org's base URL", async () => {
    // Without this, every assertion below is satisfied by a function that never
    // calls out at all — which is exactly what the comps refusal now does, and
    // why the two are asserted separately.
    const { searchMlsListings } = await load();
    const out: any = await searchMlsListings(ORG, { city: "Austin", state: "TX" });
    expect(out.success).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("https://reso.example.org/odata/Property?");
  });

  it("escapes an apostrophe in a place name by doubling it", async () => {
    const { searchMlsListings } = await load();
    await searchMlsListings(ORG, { city: "Coeur d'Alene" });

    const filter = emittedFilter(requests[0]);
    expect(filter, "the filter did not survive an ordinary American place name").toContain(
      "City eq 'Coeur d''Alene'",
    );
    // The literal must be balanced: an odd number of quotes means it closed early.
    expect(
      (filter.match(/'/g) ?? []).length % 2,
      `unbalanced quotes in the emitted filter: ${filter}`,
    ).toBe(0);
  });

  it("a crafted value cannot append a clause of its own", async () => {
    const { searchMlsListings } = await load();
    await searchMlsListings(ORG, { city: "X' or ListPrice ge 0 or City eq 'Y" });

    const hostile = "X' or ListPrice ge 0 or City eq 'Y";
    const filter = emittedFilter(requests[0]);

    // The precise property: the whole hostile string is ONE literal, every
    // internal quote doubled — so it is DATA, not syntax.
    //
    // The first version of this case asserted `not.toMatch(/' or ListPrice/)`
    // and failed against correct output, because the safe encoding
    // (`'X'' or ListPrice ...'`) contains that very substring. A negative
    // pattern was the wrong tool: it cannot tell an injected clause from an
    // escaped one, and would have been satisfied by any encoding that merely
    // avoided the pattern.
    expect(filter).toBe(`City eq '${hostile.replace(/'/g, "''")}'`);
    expect(
      (filter.match(/'/g) ?? []).length % 2,
      `unbalanced quotes — the literal closed early: ${filter}`,
    ).toBe(0);
  });

  it("REFUSES rather than guessing a vendor host when no base URL is configured", async () => {
    creds = { accessToken: "tok" }; // no mlsUrl
    const { searchMlsListings } = await load();
    const out: any = await searchMlsListings(ORG, { city: "Austin" });

    expect(out.success).toBe(false);
    expect(
      requests,
      "a request went out with no configured base URL — the org's token was sent " +
        "to a host nobody chose",
    ).toHaveLength(0);
    expect(JSON.stringify(out)).not.toMatch(/sparkplatform/i);
  });
});

describe("getMlsComps does not answer with the subject property", () => {
  it("refuses, and issues no query at all", async () => {
    const { getMlsComps } = await load();
    const out: any = await getMlsComps(ORG, { address: "123 Ranch Rd", radius: 2 });

    expect(out.success).toBe(false);
    expect(out.data?.comparablesReturned).toBe(0);
    expect(requests, "it still queried the MLS while refusing").toHaveLength(0);
  });

  it("the refusal says WHY, so a reader cannot mistake it for an outage", async () => {
    const { getMlsComps } = await load();
    const out: any = await getMlsComps(ORG, { address: "123 Ranch Rd" });
    expect(out.error).toMatch(/subject/i);
    expect(out.error).toMatch(/comparab/i);
  });

  it("no UnparsedAddress-equality comps query survives in the source", async () => {
    // The behavioural cases above pass against a function that refuses. This one
    // fails if someone restores the original query alongside the refusal, or
    // reinstates it later — the exact-address filter is the defect, by shape.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/services/connectors/executor.ts"),
      "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(
      code,
      "an exact-address filter is back in the executor — that returns the subject " +
        "property, never a comparable",
    ).not.toMatch(/UnparsedAddress\s+eq/);
  });
});
