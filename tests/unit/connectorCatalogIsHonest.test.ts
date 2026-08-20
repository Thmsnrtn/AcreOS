/**
 * The connector catalog may not advertise an integration that does not exist.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * A survey of CONNECTOR_REGISTRY on 2026-08-20 found four entries declaring
 * SEVEN tools that are implemented nowhere in the repository:
 *
 *   docusign     send_docusign_envelope, get_docusign_status
 *   quickbooks   get_quickbooks_pnl, list_quickbooks_transactions
 *   dropbox      search_dropbox, get_dropbox_file
 *   google_drive upload_drive_file
 *
 * Each name occurred exactly once in the entire codebase: in the `tools` array
 * that declares it. Three of the four connectors had no implemented tool at
 * all.
 *
 * That was not cosmetic, for two reasons that compound:
 *
 *   1. `GET /api/ai/connectors` returns the whole definition to the client
 *      (`...def`), so customers were shown present-tense capability lists —
 *      "Send offer letters for signature", "Check signature status" — for
 *      integrations that do nothing.
 *
 *   2. `POST /api/ai/connectors/:id/connect` accepted, ENCRYPTED and STORED
 *      credentials for any id in the registry and answered
 *      `status: "connected"`. So a customer could hand AcreOS their DocuSign,
 *      QuickBooks or Dropbox secrets and be told the integration was live.
 *      AcreOS took custody of a third-party credential it had no code to use.
 *      Of everything here, that is the part that costs the customer if it goes
 *      wrong, and it is the plainest possible case of assuming a
 *      responsibility with no corresponding capability.
 *
 * And `POST /api/ai/connectors/:id/test` — commented "Basic connectivity test
 * — attempt to load credentials" — loaded nothing, called nothing, and
 * returned `success: true`. A green connection test that never contacted the
 * provider is the answer a customer relies on when their integration is
 * silently broken.
 *
 * ── WHY availability IS DERIVED AND NOT TRUSTED ─────────────────────────────
 * `availability: "available"` is a claim, and a claim in a data structure is
 * exactly what failed here. So this gate never reads that field to decide
 * whether a connector works: it resolves each declared tool against the
 * dispatch switch in server/ai/tools.ts — the switch a model's tool call
 * actually lands in — and requires the FIELD to agree with the CODE. Marking
 * DocuSign available without building it fails; building it and forgetting to
 * unmark it also fails, so a finished adapter cannot stay hidden behind a stale
 * flag either.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const REGISTRY_SRC = stripCommentsPreservingLines(read("server/services/connectors/registry.ts"));
const TOOLS_SRC = stripCommentsPreservingLines(read("server/ai/tools.ts"));
const AI_ROUTES_SRC = stripCommentsPreservingLines(read("server/routes-ai.ts"));

interface Entry {
  id: string;
  tools: string[];
  capabilities: string[];
  planned: boolean;
}

/** Every connector entry, with its declared tools and its availability flag. */
function entries(): Entry[] {
  const out: Entry[] = [];
  // Each entry starts at `id: "<x>",` and runs to the next one.
  const starts = [...REGISTRY_SRC.matchAll(/\n    id: "([a-z_0-9]+)",\n/g)];
  for (let i = 0; i < starts.length; i += 1) {
    const from = starts[i].index!;
    const to = i + 1 < starts.length ? starts[i + 1].index! : REGISTRY_SRC.length;
    const block = REGISTRY_SRC.slice(from, to);
    const toolsM = /tools: \[([^\]]*)\]/.exec(block);
    const capsM = /capabilities: \[([^\]]*)\]/.exec(block);
    out.push({
      id: starts[i][1],
      tools: toolsM ? [...toolsM[1].matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]) : [],
      capabilities: capsM ? [...capsM[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [],
      planned: /availability:\s*"planned"/.test(block),
    });
  }
  return out;
}

/**
 * Tool names a model's call can actually land on: cases in the dispatch switch.
 *
 * Members of FCRA_REFUSED_TOOLS are deliberately NOT counted. Such a tool is
 * implemented — it returns a considered refusal before the switch, which is the
 * right shape and better than vanishing — but a tool that can only ever refuse
 * does not make its CONNECTOR available. `batch_leads` is the live case: it
 * advertises four capabilities, ships one tool that always refuses on FCRA
 * grounds, and collects a secret API key. Counting the refusal as an
 * implementation would let this gate bless exactly the situation it exists to
 * catch, so batch_leads is marked planned instead.
 */
function dispatchableTools(): Set<string> {
  return new Set([...TOOLS_SRC.matchAll(/\n {6}case "([a-z_0-9]+)": \{/g)].map((m) => m[1]));
}

describe("vacuity: the catalog and the dispatch switch both parsed", () => {
  it("found real connectors with real tool lists", () => {
    // Without this, every "no violation" below is satisfied by a broken regex.
    const es = entries();
    expect(es.length, "no connector entries parsed").toBeGreaterThan(8);
    expect(es.filter((e) => e.tools.length > 0).length, "no entry has any tools").toBeGreaterThan(8);
    for (const known of ["gmail", "docusign", "google_calendar"]) {
      expect(es.map((e) => e.id)).toContain(known);
    }
  });

  it("found the dispatch switch, and it contains known connector tools", () => {
    const d = dispatchableTools();
    expect(d.size, "no cases parsed out of server/ai/tools.ts").toBeGreaterThan(50);
    for (const known of ["search_gmail", "send_gmail", "list_calendar_events"]) {
      expect(d.has(known), `the dispatch parser lost "${known}"`).toBe(true);
    }
  });

  it("at least one connector is genuinely available, and at least one is planned", () => {
    // A world where everything is "planned" would pass the availability rule
    // vacuously; so would a world where the planned flag never appears.
    const es = entries();
    expect(es.some((e) => e.planned), "nothing is marked planned").toBe(true);
    expect(es.some((e) => !e.planned && e.tools.length > 0), "nothing is available").toBe(true);
  });
});

describe("availability agrees with whether the tools exist", () => {
  it("every AVAILABLE connector's declared tools are dispatchable", () => {
    const d = dispatchableTools();
    const offenders = entries()
      .filter((e) => !e.planned)
      .flatMap((e) => e.tools.filter((t) => !d.has(t)).map((t) => `${e.id} → ${t}`));

    expect(
      offenders,
      "these connectors are presented to customers as working and declare a tool that is " +
        "implemented nowhere — there is no `case \"<tool>\":` in server/ai/tools.ts, so a model " +
        "asked to use it has nothing to call. Either build the adapter, or drop the tool from " +
        'the entry, or mark the connector `availability: "planned"` so the connect route stops ' +
        "taking the customer's credentials for it.",
    ).toEqual([]);
  });

  it("no PLANNED connector is secretly finished", () => {
    // The other direction. A flag left stale after the adapter lands would hide
    // a working integration behind a refusal and keep telling customers it does
    // not exist.
    const d = dispatchableTools();
    const stale = entries()
      .filter((e) => e.planned && e.tools.length > 0 && e.tools.every((t) => d.has(t)))
      .map((e) => e.id);
    expect(
      stale,
      'these are marked "planned" but every declared tool is dispatchable — the adapter ' +
        "landed and the flag was not cleared, so the connect route is refusing credentials " +
        "for an integration that works.",
    ).toEqual([]);
  });
});

describe("AcreOS does not take credentials it cannot use", () => {
  it("the connect route refuses a planned connector before storing anything", () => {
    // Behavioural ordering matters more than the presence of the check: a
    // refusal that runs AFTER encryptCredentials would still have handled the
    // secret. Assert the refusal appears before the encryption import.
    const connectAt = AI_ROUTES_SRC.indexOf('api.post("/api/ai/connectors/:id/connect"');
    expect(connectAt, "the connect route moved — re-anchor this").toBeGreaterThan(-1);
    const body = AI_ROUTES_SRC.slice(connectAt, connectAt + 3000);

    const refusalAt = body.search(/availability\s*===\s*"planned"/);
    const encryptAt = body.indexOf("encryptCredentials");
    const storeAt = body.indexOf("upsertPaxConnector");

    expect(refusalAt, "the connect route no longer refuses planned connectors").toBeGreaterThan(-1);
    expect(encryptAt, "encryptCredentials moved out of this route — re-anchor this").toBeGreaterThan(-1);
    expect(
      refusalAt < encryptAt && refusalAt < storeAt,
      "the planned-connector refusal must run BEFORE the credential is encrypted or stored",
    ).toBe(true);
  });

  it("the connection test does not report a verdict it did not earn", () => {
    // It used to answer `success: true` having called nothing. There is no
    // adapter to probe, so the honest answer is that it cannot verify.
    const testAt = AI_ROUTES_SRC.indexOf('api.post("/api/ai/connectors/:id/test"');
    expect(testAt, "the test route moved — re-anchor this").toBeGreaterThan(-1);
    const body = AI_ROUTES_SRC.slice(testAt, testAt + 2000);

    expect(body).toMatch(/verified:\s*false/);
    expect(
      /success:\s*true/.test(body),
      "the connector test route reports success again. Nothing behind it contacts the " +
        "provider, so a true verdict here is a claim about a check that never ran.",
    ).toBe(false);
  });
});

describe("the rule is falsifiable", () => {
  it("FIRES when a connector with no adapter is marked available", () => {
    // The exact mutation that matters: someone decides DocuSign is "done".
    const d = dispatchableTools();
    const docusign = entries().find((e) => e.id === "docusign");
    expect(docusign, "the docusign entry is gone — re-anchor this").toBeDefined();
    expect(docusign!.planned, "docusign is no longer marked planned").toBe(true);

    // Simulate clearing the flag and re-run the same predicate the rule uses.
    const asAvailable = { ...docusign!, planned: false };
    const offenders = [asAvailable]
      .filter((e) => !e.planned)
      .flatMap((e) => e.tools.filter((t) => !d.has(t)).map((t) => `${e.id} → ${t}`));
    expect(offenders.length, "marking docusign available did not trip the rule").toBeGreaterThan(0);
  });

  it("does NOT fire on a connector whose tools are all real", () => {
    // The negative control, on a real entry. A rule that flagged working
    // connectors would be deleted within a week.
    const d = dispatchableTools();
    const gmail = entries().find((e) => e.id === "gmail");
    expect(gmail).toBeDefined();
    expect(gmail!.planned).toBe(false);
    expect(gmail!.tools.filter((t) => !d.has(t))).toEqual([]);
  });
});
