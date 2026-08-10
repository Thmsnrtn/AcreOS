/**
 * licenseEgress — the license-aware egress chokepoint (Wave 2.5).
 *
 * EXIT TEST: a field whose provenance resolves to `redistributable:"no"`
 * CANNOT leave the platform through ANY wired egress channel, and a field
 * whose provenance cannot be resolved at all is withheld too (fail closed).
 *
 * Everything here is DERIVED, never hand-copied:
 *  - the channel list + per-channel wiring map are read out of
 *    licenseEgress.ts's own EGRESS_CHANNEL_REGISTRY source block, so a channel
 *    added without wiring fails BY NAME and no copy of the list exists here;
 *  - the non-redistributable sources come from the provider modules' own
 *    `redistributable` declarations + DATA_LICENSE_REGISTER, so a
 *    renegotiated contract updates the fixture rather than stranding it;
 *  - the provider-coverage pin reads the provider directory, so a sixth
 *    `*-provider.ts` that the chokepoint never learned about fails by name.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("../../server/db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  FIRST_PARTY_SOURCE,
  PROVIDER_DERIVED_RECORD_FIELDS,
  postureMayLeave,
  resolveEgressLicense,
  screenRecordForExport,
  screenSourcedNodes,
  screenToolResultData,
  withholdingDisclosure,
  withholdingNotice,
  type EgressChannel,
} from "../../server/services/licenseEgress";
import { DATA_LICENSE_REGISTER } from "../../server/services/providers/data-licenses";
import { attomProvider } from "../../server/services/providers/attom-provider";
import { batchdataProvider } from "../../server/services/providers/batchdata-provider";
import { regridProvider } from "../../server/services/providers/regrid-provider";
import { openDataProvider } from "../../server/services/providers/open-data-provider";
import { countyGisProvider } from "../../server/services/providers/county-gis-provider";

const REPO_ROOT = path.resolve(__dirname, "../..");
const CHOKEPOINT = path.join(REPO_ROOT, "server/services/licenseEgress.ts");
const CHOKEPOINT_SRC = fs.readFileSync(CHOKEPOINT, "utf8");

// ── Derived channel registry (read out of the module's own source) ──────────

interface ChannelSpec {
  channel: EgressChannel;
  label: string;
  wiredIn: string[];
}

function readChannelRegistry(): ChannelSpec[] {
  const block = CHOKEPOINT_SRC.split("EGRESS_CHANNEL_REGISTRY")[1] ?? "";
  const body = block.split("] as const;")[0] ?? "";
  const entries = body.split(/\bchannel:\s*"/).slice(1);
  return entries.map((chunk) => {
    const channel = chunk.slice(0, chunk.indexOf('"')) as EgressChannel;
    const label = /label:\s*"([^"]+)"/.exec(chunk)?.[1] ?? "";
    const wiredBlock = /wiredIn:\s*\[([\s\S]*?)\]/.exec(chunk)?.[1] ?? "";
    const wiredIn = [...wiredBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    return { channel, label, wiredIn };
  });
}

const CHANNELS = readChannelRegistry();

// ── Derived license fixtures ────────────────────────────────────────────────

/** Sources the register itself declares non-redistributable. Derived. */
const NON_REDISTRIBUTABLE_SOURCES = Object.values(DATA_LICENSE_REGISTER)
  .filter((e) => e.redistributable === "no")
  .map((e) => e.source);

/** Sources the register declares freely/attributably redistributable. */
const REDISTRIBUTABLE_SOURCES = Object.values(DATA_LICENSE_REGISTER)
  .filter((e) => e.redistributable === "yes" || e.redistributable === "attribution")
  .map((e) => e.source);

/** Provider modules declaring "no" — the second, independent authority. */
const ALL_PROVIDERS = [
  attomProvider,
  batchdataProvider,
  countyGisProvider,
  openDataProvider,
  regridProvider,
];
const NON_REDISTRIBUTABLE_PROVIDERS = ALL_PROVIDERS.filter(
  (p) => p.redistributable === "no",
);

describe("licenseEgress — the derived source→posture map", () => {
  it("the fixture is non-empty in both directions (guards a vacuous suite)", () => {
    expect(CHANNELS.length).toBeGreaterThan(0);
    expect(NON_REDISTRIBUTABLE_SOURCES.length).toBeGreaterThan(0);
    expect(REDISTRIBUTABLE_SOURCES.length).toBeGreaterThan(0);
    expect(NON_REDISTRIBUTABLE_PROVIDERS.length).toBeGreaterThan(0);
  });

  it("every *-provider.ts module in the registry directory feeds the index", () => {
    const dir = path.join(REPO_ROOT, "server/services/providers");
    const providerFiles = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith("-provider.ts") && !f.endsWith(".test.ts"));
    expect(providerFiles.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const file of providerFiles) {
      const src = fs.readFileSync(path.join(dir, file), "utf8");
      const exported = /export const (\w+): DataProvider = \{/.exec(src)?.[1];
      const routingName = /^\s*name: "([^"]+)",/m.exec(src)?.[1];
      if (!exported || !routingName) continue;

      // (a) the chokepoint must import and declare this provider object, and
      if (
        !CHOKEPOINT_SRC.includes(`import { ${exported} }`) ||
        !new RegExp(`DECLARING_PROVIDERS[\\s\\S]*?\\b${exported}\\b`).test(
          CHOKEPOINT_SRC,
        )
      ) {
        missing.push(`${file} → ${exported} not in DECLARING_PROVIDERS`);
        continue;
      }
      // (b) the index must actually resolve its routing name.
      const resolved = resolveEgressLicense(routingName);
      if (resolved.origin === "unresolved") {
        missing.push(`${file} → "${routingName}" unresolved by the index`);
      }
    }
    expect(
      missing,
      `provider modules missing from the egress index: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("resolves ATTOM/Regrid/BatchData to redistributable:'no' from their own declarations", () => {
    for (const provider of NON_REDISTRIBUTABLE_PROVIDERS) {
      expect(resolveEgressLicense(provider.name).posture).toBe("no");
      expect(resolveEgressLicense(provider.displayName).posture).toBe("no");
    }
  });

  it("federal/open sources resolve to a posture that may leave", () => {
    for (const source of REDISTRIBUTABLE_SOURCES) {
      expect(
        postureMayLeave(resolveEgressLicense(source).posture),
        `${source} should be releasable`,
      ).toBe(true);
    }
  });

  it("the first-party sentinel is the only 'ours, so it may leave' door", () => {
    const r = resolveEgressLicense(FIRST_PARTY_SOURCE);
    expect(r.origin).toBe("first-party");
    expect(postureMayLeave(r.posture)).toBe(true);
  });
});

describe("licenseEgress — fail closed", () => {
  it("an unknown source is withheld, not passed", () => {
    const r = resolveEgressLicense("Totally Unheard Of Vendor");
    expect(postureMayLeave(r.posture)).toBe(false);
    expect(r.origin).toBe("unresolved");
    expect(r.reason).toMatch(/not in the data-license register/i);
  });

  it("an absent/empty source is withheld and says provenance is unrecorded", () => {
    for (const missing of [null, undefined, "", "   "]) {
      const r = resolveEgressLicense(missing);
      expect(postureMayLeave(r.posture)).toBe(false);
      expect(r.reason).toMatch(/provenance is not recorded/i);
    }
  });

  it("a recorded per-row review can settle review-required but NEVER upgrades a declared 'no'", () => {
    // A county whose terms a human reviewed: the review settles it.
    const settled = resolveEgressLicense("Some County Portal", {
      "Some County Portal": "attribution",
    });
    expect(postureMayLeave(settled.posture)).toBe(true);
    expect(settled.origin).toBe("row-license-review");

    // A declared "no" is immune to caller-supplied optimism.
    for (const provider of NON_REDISTRIBUTABLE_PROVIDERS) {
      const forced = resolveEgressLicense(provider.displayName, {
        [provider.displayName]: "yes",
      });
      expect(forced.posture, `${provider.displayName} must stay "no"`).toBe("no");
      expect(postureMayLeave(forced.posture)).toBe(false);
    }
  });
});

describe("licenseEgress — a redistributable:'no' field cannot leave ANY channel", () => {
  // Derived from the module's own registry: every declared channel, by name.
  it.each(CHANNELS.map((c) => [c.channel, c.label] as const))(
    "channel %s (%s) withholds every non-redistributable source",
    (channel, _label) => {
      const nodes = [
        ...NON_REDISTRIBUTABLE_SOURCES.map((source, i) => ({
          id: `paid-${i}`,
          source,
          data: { secret: `paid-value-${i}` },
        })),
        ...NON_REDISTRIBUTABLE_PROVIDERS.map((p, i) => ({
          id: `provider-${i}`,
          source: p.name,
          data: { secret: `provider-value-${i}` },
        })),
        { id: "unprovenanced", source: null as string | null, data: { secret: "no-source" } },
        { id: "unknownVendor", source: "Mystery Data Co", data: { secret: "mystery" } },
        { id: "federal", source: "FEMA NFHL", data: { zone: "AE" } },
      ];

      const { nodes: out, screen } = screenSourcedNodes(channel, nodes, {
        labelKey: "id",
      });

      // Not one non-redistributable or unresolvable byte survives.
      const shipped = JSON.stringify(out);
      expect(shipped).not.toContain("paid-value-");
      expect(shipped).not.toContain("provider-value-");
      expect(shipped).not.toContain("no-source");
      expect(shipped).not.toContain("mystery");
      // …and the one legitimately-redistributable fact still ships.
      expect(shipped).toContain("AE");

      expect(screen.releasedPaths).toHaveLength(1);
      const withheldLabels = screen.withheld.map((w) => w.label);
      expect(withheldLabels).toContain("unprovenanced");
      expect(withheldLabels).toContain("unknownVendor");
      expect(withheldLabels).toHaveLength(nodes.length - 1);

      // And the notice is present, counted, and names the contract reason.
      expect(screen.notice).toBeTruthy();
      expect(screen.notice).toContain(`${screen.withheld.length} fields withheld`);
      expect(screen.notice).toMatch(/not redistributable under our contract/i);
    },
  );

  it("the export path deletes withheld keys from the emitted record", () => {
    const row = {
      address: "123 Main",
      parcelData: { owner: "Jane Doe", regridId: "abc" },
      enrichmentData: { floodZone: "X" },
    };
    const { record, screen } = screenRecordForExport("csv-export", row);
    expect(record).not.toHaveProperty("parcelData");
    expect(record).not.toHaveProperty("enrichmentData");
    expect(record.address).toBe("123 Main");
    expect(JSON.stringify(record)).not.toContain("Jane Doe");
    expect(screen.withheld.map((w) => w.path).sort()).toEqual([
      "enrichmentData",
      "parcelData",
    ]);
    // …and the emitted record SAYS it is thinner.
    expect(record._license).toBeTruthy();
  });

  it("a Regrid-stamped export region is withheld by its DECLARED source", () => {
    const { record, screen } = screenRecordForExport("csv-export", {
      parcelData: { source: "Regrid", owner: "Jane Doe" },
    });
    expect(record).not.toHaveProperty("parcelData");
    expect(screen.withheld[0].source).toBe("Regrid");
    expect(screen.withheld[0].reason).toMatch(/not redistributable under our contract/i);
  });

  it("the MCP / webhook payload path screens objects AND arrays", () => {
    const one = screenToolResultData("mcp-tool-result", {
      id: 7,
      parcelData: { owner: "Jane Doe" },
    });
    expect(JSON.stringify(one.data)).not.toContain("Jane Doe");
    expect(one.disclosure).not.toBeNull();

    const many = screenToolResultData("outbound-webhook", [
      { id: 1, parcelData: { owner: "A" } },
      { id: 2, address: "clean" },
    ]);
    expect(JSON.stringify(many.data)).not.toContain('"owner"');
    expect(many.disclosure!.withheldCount).toBe(1);

    // An explicitly-declared non-redistributable source drops the whole payload.
    const declared = screenToolResultData("mcp-tool-result", { avm: 412000 }, {
      declaredSource: "ATTOM Data",
    });
    expect(declared.data).toBeNull();
    expect(declared.disclosure!.notice).toMatch(/ATTOM Data is not redistributable/i);
  });

  it("PROVIDER_DERIVED_RECORD_FIELDS is the set the export path screens", () => {
    expect(PROVIDER_DERIVED_RECORD_FIELDS.length).toBeGreaterThan(0);
    for (const field of PROVIDER_DERIVED_RECORD_FIELDS) {
      const { record } = screenRecordForExport("csv-export", {
        [field]: { leak: "vendor-bytes" },
      });
      expect(JSON.stringify(record), `${field} leaked`).not.toContain("vendor-bytes");
    }
  });
});

describe("licenseEgress — the withholding notice is honest", () => {
  it("is null when nothing was withheld (never implies a thinner artifact)", () => {
    const { screen } = screenSourcedNodes("csv-export", [
      { id: "a", source: "FEMA NFHL", data: { x: 1 } },
      { id: "b", source: "USDA SSURGO", data: { y: 2 } },
    ]);
    expect(screen.notice).toBeNull();
    expect(withholdingDisclosure(screen)).toBeNull();
    expect(withholdingNotice("csv-export", [])).toBeNull();
  });

  it("is present, counted and reasoned whenever ANY field was withheld", () => {
    const { screen } = screenSourcedNodes("public-parcel-report", [
      { id: "Estimated value", source: "ATTOM Data", data: { v: 412000 } },
      { id: "zone", source: "FEMA NFHL", data: { zone: "X" } },
    ], { labelKey: "id" });

    expect(screen.notice).toContain("1 field withheld");
    expect(screen.notice).toContain("ATTOM Data is not redistributable under our contract");

    const disclosure = withholdingDisclosure(screen);
    expect(disclosure!.withheldCount).toBe(1);
    expect(disclosure!.fields[0]).toMatchObject({
      field: "Estimated value",
      source: "ATTOM Data",
    });
  });

  it("a withheld node keeps an honest hole rather than vanishing", () => {
    const { nodes } = screenSourcedNodes("public-parcel-report", [
      { category: "avm", source: "ATTOM Data", data: { v: 1 } },
    ], { labelKey: "category" });
    expect(nodes[0].category).toBe("avm");
    expect(nodes[0].data).toBeNull();
    expect((nodes[0] as Record<string, unknown>).withheld).toBe(true);
    expect((nodes[0] as Record<string, unknown>).withheldReason).toMatch(
      /not redistributable/i,
    );
  });

  it("carries attribution for released attribution-required sources", () => {
    const { screen } = screenSourcedNodes("public-parcel-report", [
      { id: "basemap", source: "OpenStreetMap", data: { tiles: 1 } },
    ]);
    expect(screen.releasedPaths).toHaveLength(1);
    expect(screen.attributions).toContain("© OpenStreetMap contributors");
  });
});

describe("licenseEgress — every egress surface routes through the chokepoint", () => {
  it("the registry declares each channel exactly once, with wiring", () => {
    const names = CHANNELS.map((c) => c.channel);
    expect(new Set(names).size).toBe(names.length);
    for (const spec of CHANNELS) {
      expect(spec.label, `${spec.channel} has no label`).toBeTruthy();
      expect(
        spec.wiredIn.length,
        `channel ${spec.channel} declares no wired files`,
      ).toBeGreaterThan(0);
    }
  });

  // Derived: a channel listed without a wired file fails by name.
  it.each(CHANNELS.map((c) => [c.channel, c.wiredIn] as const))(
    "channel %s imports licenseEgress in every file it declares",
    (channel, wiredIn) => {
      const unwired: string[] = [];
      for (const rel of wiredIn) {
        const abs = path.join(REPO_ROOT, rel);
        if (!fs.existsSync(abs)) {
          unwired.push(`${rel} (missing)`);
          continue;
        }
        const src = fs.readFileSync(abs, "utf8");
        if (!/from\s+["'][^"']*licenseEgress(\.js)?["']/.test(src)) {
          unwired.push(`${rel} (no licenseEgress import)`);
        }
      }
      expect(
        unwired,
        `channel "${channel}" is declared but not wired: ${unwired.join(", ")}`,
      ).toEqual([]);
    },
  );

  /**
   * The CSV export path claims "these columns carry no provider-derived
   * region, so nothing was withheld from this file". That is a NEGATIVE claim
   * about a specific file, so it is checked, not asserted: the day a CSV
   * writer grows a parcelData/enrichmentData column, this names it and the
   * route's screening branch (csvColumnsCarryProviderData) starts firing.
   */
  it("the CSV writers emit no provider-derived column (the claim the export path makes)", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "server/services/importExport.ts"),
      "utf8",
    );
    const present = PROVIDER_DERIVED_RECORD_FIELDS.filter((f) => src.includes(f));
    expect(
      present,
      `importExport.ts now emits provider-derived columns (${present.join(", ")}) — ` +
        `the CSV path must screen rows, not skip on an empty header match`,
    ).toEqual([]);
  });

  /**
   * The export route puts the notice in an HTTP header. `res.setHeader`
   * throws ERR_INVALID_CHAR above U+00FF, and the notice prose contains an em
   * dash — so an unsanitized header would 500 the export the first time a
   * field was withheld. Pin that the route sanitizes.
   */
  it("the export route sanitizes the notice before putting it in a header", () => {
    const { screen } = screenSourcedNodes("csv-export", [
      { id: "avm", source: "ATTOM Data", data: { v: 1 } },
    ]);
    // The notice itself is prose and DOES carry non-latin1 punctuation.
    expect(screen.notice!).toMatch(/[^\x00-\xFF]/);
    const routeSrc = fs.readFileSync(
      path.join(REPO_ROOT, "server/routes-import-export.ts"),
      "utf8",
    );
    expect(routeSrc).toMatch(/toHeaderSafe\s*\(/);
    expect(routeSrc).toMatch(
      /setHeader\(\s*"X-AcreOS-License-Notice",\s*toHeaderSafe\(/,
    );
  });

  it("each wired file actually CALLS the chokepoint, not merely imports it", () => {
    // Every screening entry point the chokepoint exposes. Anything else is a
    // file that imported the module and then did nothing with it.
    const CALLERS =
      /(screenSourcedNodes|screenRecordForExport|screenToolResultData|resolveEgressLicense)\s*\(/;
    const missing: string[] = [];
    for (const spec of CHANNELS) {
      for (const rel of spec.wiredIn) {
        const abs = path.join(REPO_ROOT, rel);
        if (!fs.existsSync(abs)) {
          missing.push(`${rel} (missing)`);
          continue;
        }
        if (!CALLERS.test(fs.readFileSync(abs, "utf8"))) {
          missing.push(`${rel} (imports but never calls)`);
        }
      }
    }
    expect(missing, `unwired egress files: ${missing.join(", ")}`).toEqual([]);
  });
});

// ─── Fleet-11 verifier catches — each fix pinned ────────────────────────────

const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("fleet-11 catch — the PDF artifact channel is wired", () => {
  const pdf = read("server/services/propertyReportPdf.ts");

  it("the branded PDF screens its parcel snapshot before rendering any of it", () => {
    // The first egress inventory missed the file-download ARTIFACT paths, and
    // this one renders parcel_snapshots fields (owner of record, mailing
    // address) whose declared source resolves to redistributable:"no". A PDF
    // the customer forwards is the most redistributive channel there is.
    expect(pdf).toContain('resolveEgressLicense(snap?.source)');
    expect(pdf).toContain("postureMayLeave");
    expect(pdf).toContain("const licensedSnap = snapMayLeave ? snap : null");
    // No raw snapshot field may be rendered — every read goes through the
    // screened alias.
    const body = pdf.slice(pdf.indexOf("const PDFDocument"));
    expect(body).not.toMatch(/\bsnap[?.]\.(owner|mailingAddress|assessedValue|lastSalePrice|taxAmount)/);
  });

  it("a thinned PDF says so, and does not credit a vendor whose facts it omitted", () => {
    expect(pdf).toContain('withholdingNotice("pdf-artifact"');
    expect(pdf).toContain("licensedSnap?.source ?? \"AcreOS internal records only\"");
    expect(pdf).toMatch(/pdfNotice \? ` \$\{pdfNotice\}` : ""/);
  });
});

describe("fleet-11 catch — provenance resolves the names providers actually emit", () => {
  it("the index keys result source strings, not just provider identities", () => {
    // county-gis is name "county-gis" / displayName "County GIS (free,
    // direct)" but stamps source: "County GIS" — so real county rows fell to
    // the unresolved branch and told the user provenance "is not recorded",
    // a false negative about data whose provenance is right there.
    const countyGis = resolveEgressLicense("County GIS");
    expect(countyGis.origin).not.toBe("unresolved");
    expect(countyGis.reason).not.toMatch(/not recorded/i);
    for (const emitted of ["ATTOM Data", "BatchData", "Regrid"]) {
      expect(resolveEgressLicense(emitted).origin).not.toBe("unresolved");
    }
  });
});

describe("fleet-11 catch — a suppression is never rendered as an absence", () => {
  it("screenSourcedNodes clears `available` on a withheld node", () => {
    const src = read("server/services/licenseEgress.ts");
    // PublicReportFactCategory.available is what the public renderer keys on;
    // leaving it true while nulling the data made the page say "we looked and
    // found nothing" about a parcel — a fabricated negative.
    expect(src).toMatch(/if \("available" in copy\) copy\.available = false;/);
  });
});
