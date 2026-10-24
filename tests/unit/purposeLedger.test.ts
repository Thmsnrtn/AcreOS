/**
 * D2e — the purpose ledger: no purpose, no read; every person-adjacent
 * surface is enumerated and each one is refused without its receipt.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/trust/ownerSuppression", () => ({
  ownerContactRefusal: async () => null,
  assertOwnerContactAllowed: async () => undefined,
  stampOwnerSuppression: async () => undefined,
}));

import {
  PURPOSE_CODES,
  PURPOSE_SURFACES,
  PurposeRequiredError,
  assertPurpose,
  releaseSkipTraceResults,
  type PurposeEntry,
} from "../../server/services/purposeLedger";
import { SKIP_TRACE_PURPOSES } from "../../server/services/fcraAttestation";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.join(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("the taxonomy and the surfaces", () => {
  it("purpose codes are exactly the FCRA skip-trace purposes every door already collects", () => {
    expect([...PURPOSE_CODES].sort()).toEqual([...SKIP_TRACE_PURPOSES].sort());
  });

  it("three surfaces are enumerated; entity-graph person edges have none because no entity graph exists", () => {
    expect([...PURPOSE_SURFACES]).toEqual(["skip_trace_call", "skip_trace_result_read", "owner_contact_lookup"]);
    // If a person-edge table ever lands, this fails and the surface must be enumerated.
    const schema = ["shared/schema.ts", ...["purpose-ledger", "deal-lifecycle", "parcel-data"].map((f) => `shared/schema/${f}.ts`)].map(read).join("\n");
    const tables = Array.from(stripComments(schema).matchAll(/pgTable\(\s*"([a-z_]+)"/g)).map((m) => m[1]);
    expect(tables.length, "vacuity: tables parsed").toBeGreaterThan(100);
    expect(tables.filter((t) => /(registered_agent|beneficial_owner|entity_officer|llc_member|person_edge)/.test(t))).toEqual([]);
  });
});

describe("fail closed: no purpose code, no row, no read", () => {
  const base: PurposeEntry = { organizationId: 1, actorUserId: "u1", surface: "skip_trace_call", purposeCode: "collection" };
  it("accepts a known code on a known surface", () => {
    expect(() => assertPurpose(base)).not.toThrow();
  });
  it.each([
    ["no code", { purposeCode: null }],
    ["an unknown code", { purposeCode: "curiosity" }],
    ["no actor", { actorUserId: "" }],
    ["an unknown surface", { surface: "anything" as never }],
  ])("refuses %s", (_label, over) => {
    expect(() => assertPurpose({ ...base, ...over })).toThrow(PurposeRequiredError);
  });
});

describe("stored results (skip_trace_result_read)", () => {
  const traces = [
    { id: 1, leadId: 10, results: { phones: [{ number: "5", type: "m", verified: false }] }, purposeOfUse: "collection", justification: "collecting a note", attestationVersion: "v1" },
    { id: 2, leadId: 11, results: { emails: [{ email: "x@y.z", verified: false }] }, purposeOfUse: null },
    { id: 3, leadId: 12, results: null, purposeOfUse: null },
  ];

  it("releases results only where a purpose was recorded, writing one row per release; withholds the rest", async () => {
    const written: PurposeEntry[] = [];
    const out = await releaseSkipTraceResults(7, "u9", traces, async (rows) => {
      written.push(...rows);
      return rows.length;
    });
    expect(out[0].results).toEqual(traces[0].results);
    expect(out[1].results).toBeNull();
    expect(out[1].resultsWithheld).toMatch(/no permissible purpose was recorded/);
    expect(out[2].results).toBeNull();
    expect(out[2].resultsWithheld).toBeUndefined();
    expect(written).toEqual([expect.objectContaining({ organizationId: 7, actorUserId: "u9", surface: "skip_trace_result_read", purposeCode: "collection", skipTraceId: 1, leadId: 10 })]);
  });

  it("FALSIFICATION: a ledger that confirms fewer rows than released refuses the whole read", async () => {
    await expect(releaseSkipTraceResults(7, "u9", traces, async () => 0)).rejects.toThrow(/refused/);
  });

  it("nothing to release writes nothing", async () => {
    const insert = vi.fn(async () => 0);
    await releaseSkipTraceResults(7, "u9", [traces[2]], insert);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("the chokepoints refuse without a receipt", () => {
  it("skipTracingService.trace() never calls a vendor without a skip_trace_call receipt", async () => {
    process.env.BATCH_SKIP_TRACING_API_KEY = "k";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { skipTracingService } = await import("../../server/services/skipTracingService");
    for (const receipt of [undefined, null, { ledgerId: 0, surface: "skip_trace_call" }, { ledgerId: 5, surface: "skip_trace_result_read" }] as never[]) {
      const r = await skipTracingService.trace({ firstName: "A", lastName: "B", address: "1 Main", zip: "37402" }, 1, receipt);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/permissible purpose/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    delete process.env.BATCH_SKIP_TRACING_API_KEY;
  });

  it("the provider registry refuses owner_info / skip_trace without an owner_contact_lookup receipt, and serves it with one", async () => {
    const { providerRegistry: registry } = await import("../../server/services/providers/provider-registry");
    const provider = {
      name: "p",
      displayName: "P",
      categories: ["owner_info"],
      supportedInputTypes: ["coordinates"],
      tierRequired: "free",
      license: "public-domain-usgov",
      costPerLookupCents: () => 0,
      isConfigured: async () => true,
      lookup: vi.fn(async () => ({ provider: "p", category: "owner_info", confidence: 80, costCents: 0, fetchedAt: new Date(), cached: false, latencyMs: 1, data: { owner: "X" } })),
      healthCheck: async () => ({ healthy: true }),
    };
    registry.register("owner_info" as never, provider as never, 10);
    const input = { type: "coordinates", lat: 35, lng: -86 } as never;
    expect(await registry.lookup("owner_info" as never, input, "free" as never, 1000)).toBeNull();
    expect(await registry.lookup("owner_info" as never, input, "free" as never, 1000, undefined, { purpose: { ledgerId: 3, surface: "skip_trace_call" } })).toBeNull();
    expect(provider.lookup).not.toHaveBeenCalled();
    await registry.lookup("owner_info" as never, input, "free" as never, 1000, undefined, { purpose: { ledgerId: 3, surface: "owner_contact_lookup" } });
    expect(provider.lookup).toHaveBeenCalledTimes(1);
  });

  it("every production call of skipTracingService.trace passes a receipt argument (the population, read from source)", () => {
    const files = ["server/routes-skip-tracing.ts", "server/routes-leads.ts"];
    let calls = 0;
    for (const f of files) {
      const src = stripComments(read(f));
      for (const m of src.matchAll(/skipTracingService\.trace\(/g)) {
        calls += 1;
        const tail = src.slice(m.index ?? 0, (m.index ?? 0) + 900);
        expect(/\},\s*(org\.id|orgId),\s*purpose,?\s*\)/.test(tail), `${f}: trace() call without a receipt`).toBe(true);
      }
    }
    expect(calls, "vacuity: the three doors").toBe(3);
  });
});

describe("append-only DDL (migration + mirror)", () => {
  it("0289 and migrate.mjs both install BEFORE UPDATE and BEFORE DELETE triggers that raise", () => {
    for (const src of [read("migrations/0289_d2e_purpose_ledger.sql"), read("scripts/migrate.mjs")]) {
      expect(src).toMatch(/CREATE TRIGGER purpose_ledger_no_update\s+BEFORE UPDATE ON "purpose_ledger"/);
      expect(src).toMatch(/CREATE TRIGGER purpose_ledger_no_delete\s+BEFORE DELETE ON "purpose_ledger"/);
      expect(src).toMatch(/RAISE EXCEPTION 'purpose_ledger is append-only/);
    }
  });
});
