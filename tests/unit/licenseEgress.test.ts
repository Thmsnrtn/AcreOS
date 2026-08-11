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
  subjectAccessDisclosure,
  withholdingDisclosure,
  withholdingNotice,
  type EgressChannel,
} from "../../server/services/licenseEgress";
import {
  buildArchiveLicenseDisclosure,
  screenArchiveCsv,
} from "../../server/services/migrationJobs";
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
  // Anchored on the DECLARATION, not on any mention of the name: the module
  // header cites `EGRESS_CHANNEL_REGISTRY` in prose, and a bare-name split
  // silently returned zero channels — which would have made every derived
  // per-channel assertion below vacuously pass.
  const block = CHOKEPOINT_SRC.split("const EGRESS_CHANNEL_REGISTRY")[1] ?? "";
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

/**
 * The broker display titles the chokepoint has looked at and could NOT
 * reconcile, each with its stated reason. Read out of the module's own source
 * for the same reason the channel registry is: it is module-private (an export
 * whose only consumers are its own module and this test is what the
 * reachability gate calls "built but unwired"), and reading the source means
 * no copy of the list can drift into this file.
 */
function readUnreconciledBrokerTitles(): Record<string, string> {
  const block = CHOKEPOINT_SRC.split("const UNRECONCILED_BROKER_TITLES")[1] ?? "";
  const body = block.split("\n};")[0] ?? "";
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*(['"])([\s\S]*?)\3,\s*$/gm)) {
    out[m[1] ?? m[2]] = m[4];
  }
  return out;
}

const UNRECONCILED_BROKER_TITLES = readUnreconciledBrokerTitles();

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
    //
    // `subjectAccessDisclosure` joined this list when the DSAR channel was
    // wired: it is a screening entry point that INSPECTS rather than filters
    // (see the SUBJECT_ACCESS_CHANNEL decision), so gdprService.ts is a real
    // caller even though it deletes nothing. The pin is rewritten, not
    // widened to "imports anything" — a file still fails if it imports the
    // module and calls none of these.
    const CALLERS =
      /(screenSourcedNodes|screenRecordForExport|screenToolResultData|resolveEgressLicense|subjectAccessDisclosure)\s*\(/;
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

// ─── Fleet-12: the three egress paths slice 11 NAMED but did not close ───────
//
// Slice 11 shipped the chokepoint and wired the CSV/report/PDF/webhook doors,
// and its own module header named three paths it had NOT closed: the DSAR
// export, the export-everything ZIP, and the MCP broker declaredSource path.
// Everything below is the evidence that each is now either closed or an
// explicit, reasoned choice — never a silent one.

/** A source the register itself declares non-redistributable. Derived. */
const A_PAID_SOURCE = NON_REDISTRIBUTABLE_SOURCES[0];

describe("fleet-12 path 1 — the DSAR subject-access export", () => {
  /**
   * This is the one channel that RELEASES. The pin is therefore the INVERSE of
   * every other channel's, and that is the point: a legal obligation to hand a
   * person their own data is a different question from a licence to
   * redistribute it, and the previous behaviour (ship it, say nothing) was a
   * silent answer to a question nobody had asked. What is pinned here is that
   * the choice is DELIBERATE, stated in the artifact, and reversible in one
   * place — not that the bytes happen to flow.
   */
  it("releases a redistributable:'no' region — and NAMES it, with source and reason", () => {
    const disclosure = subjectAccessDisclosure({
      leads: [
        { id: 1, enrichmentData: { source: A_PAID_SOURCE, avm: 412000 } },
        { id: 2, parcelData: { owner: "Jane Doe" } }, // unstamped
      ],
    });

    // The decision is a stated literal, not an emergent side effect.
    expect(disclosure.decision).toBe("included-with-licence-note");
    expect(disclosure.channel).toBe("dsar-subject-access");

    // Two values a redistribution channel would have withheld; both counted.
    expect(disclosure.providerSourcedValueCount).toBe(2);
    expect(disclosure.providerRegionValueCount).toBe(2);
    expect(disclosure.statement).toMatch(/INCLUDED/);

    // Each is named with what it actually resolved to — the vendor where the
    // record recorded one, and honest ignorance where it did not.
    const paid = disclosure.fields.find((f) => f.source === A_PAID_SOURCE);
    expect(paid, `${A_PAID_SOURCE} should be named in the DSAR licence note`).toBeTruthy();
    expect(paid!.posture).toBe("no");
    expect(paid!.field).toBe("enrichmentData");
    expect(paid!.reason).toMatch(/not redistributable under our contract/i);

    const unstamped = disclosure.fields.find((f) => f.field === "parcelData");
    expect(unstamped!.source).toBe("unknown");
    expect(unstamped!.reason).toMatch(/provenance is not recorded/i);

    // The constraint rides with the copy rather than being enforced by
    // dropping it, and the legal ground is stated rather than implied.
    expect(disclosure.legalBasis).toMatch(/Article 15/);
    expect(disclosure.redistributionConstraint).toMatch(
      /not a licence to republish or resell/i,
    );
  });

  it("the decision is recorded ONCE, in prose, where rescinding it is a one-line edit", () => {
    const src = read("server/services/licenseEgress.ts");
    // If this block is ever deleted, the behaviour becomes an accident again.
    expect(src).toMatch(/THE DECISION, STATED/);
    expect(src).toMatch(/SUBJECT_ACCESS_LEGAL_BASIS/);
    expect(src).toMatch(/Article 15/);
    // …and the channel is in the registry, so the derived wiring pin covers it.
    expect(CHANNELS.map((c) => c.channel)).toContain("dsar-subject-access");

    // The module header must not keep claiming the blanket "cannot leave
    // through ANY channel" that this channel deliberately breaks. A header
    // that outruns its code is the defect this whole slice is about.
    const header = src.slice(0, src.indexOf("import type"));
    expect(header).toMatch(/THE ONE CHANNEL THAT RELEASES/);
    expect(header).not.toMatch(/cannot leave through any wired channel/);
  });

  it("the export always carries the block — 'we checked and found none' is not optional", () => {
    const gdpr = read("server/services/gdprService.ts");
    // Non-optional field on the export type: a reader can always tell
    // "checked, nothing found" from "nobody checked".
    expect(gdpr).toMatch(/providerSourcedData: SubjectAccessDisclosure;/);
    expect(gdpr).toMatch(/const providerSourcedData = subjectAccessDisclosure\(/);
    expect(gdpr).toMatch(/^\s+providerSourcedData,$/m);

    // And the route carries the decision into the compliance record, not just
    // the file the founder forwards.
    const route = read("server/routes-privacy-dsar.ts");
    expect(route).toMatch(/providerSourcedDecision: exportData\.providerSourcedData\.decision/);
    expect(route).toMatch(/X-AcreOS-Subject-Access-Decision/);
  });

  /**
   * The negative claim is a claim. An entity the export ships as an empty list
   * was never examined, and saying "checked; none was populated" about it
   * would be a fabricated all-clear — the same shape as the fleet-11 catch
   * where a withheld field rendered as "we looked and found nothing".
   */
  it("an entity with zero exported rows is reported as out of scope, not as checked-and-clean", () => {
    const disclosure = subjectAccessDisclosure({
      leads: [{ id: 1, address: "123 Main" }],
      properties: [], // gdprService ships properties empty — nothing was examined
    });

    expect(disclosure.providerSourcedValueCount).toBe(0);
    const properties = disclosure.coverage.find((c) => c.entity === "properties");
    expect(properties!.rowsInspected).toBe(0);
    expect(disclosure.coverage.find((c) => c.entity === "leads")!.rowsInspected).toBe(1);

    // The sentence must say the properties rows were NOT examined…
    expect(disclosure.statement).toMatch(
      /No rows were exported for properties, so nothing of that entity was examined here\./,
    );
    // …and must not fold them into the checked set.
    expect(disclosure.statement).not.toMatch(/on the exported .*properties.* rows/);
    // The rows that WERE checked are named with a count, so the negative is a
    // measured one.
    expect(disclosure.statement).toMatch(/Checked .* on 1 exported row \(leads: 1\)/);
  });

  it("an export with no rows at all says there was nothing to check", () => {
    const disclosure = subjectAccessDisclosure({ leads: [], deals: [] });
    expect(disclosure.statement).toMatch(/there was nothing to check/);
    expect(disclosure.statement).not.toMatch(/none of those fields held a value/);
    expect(disclosure.fieldsInspected).toEqual([...PROVIDER_DERIVED_RECORD_FIELDS]);
  });
});

describe("fleet-12 path 2 — the export-everything ZIP", () => {
  const PAID_ROW = {
    id: 1,
    address: "123 Main",
    parcelData: { source: A_PAID_SOURCE, owner: "Jane Doe" },
  };

  it("REMOVES a non-redistributable column from the archive CSV, not just announces it", () => {
    const csv = ["id,address,parcelData", '1,123 Main,"{""owner"":""Jane Doe""}"'].join("\n");
    const screened = screenArchiveCsv(csv, [PAID_ROW]);

    // The bytes are gone from the file the customer downloads…
    expect(screened.csv).not.toContain("Jane Doe");
    expect(screened.csv.split("\n")[0]).toBe("id,address");
    // …the surviving columns are intact…
    expect(screened.csv).toContain("123 Main");
    // …and the file SAYS it is thinner, naming the vendor.
    expect(screened.csv).toMatch(/^# 1 field withheld from this portability archive/m);
    expect(screened.csv).toContain(`${A_PAID_SOURCE} is not redistributable`);
    expect(screened.withheld).toHaveLength(1);
  });

  it("an unprovenanced column is withheld too (fail closed inside the archive)", () => {
    const csv = ["id,enrichmentData", '1,"{""floodZone"":""X""}"'].join("\n");
    const screened = screenArchiveCsv(csv, [{ id: 1, enrichmentData: { floodZone: "X" } }]);
    expect(screened.csv.split("\n")[0]).toBe("id");
    expect(screened.withheld[0].reason).toMatch(/provenance is not recorded/i);
  });

  it("claims NOTHING when the file carries no provider-derived column", () => {
    const csv = ["id,address,status", "1,123 Main,active"].join("\n");
    const screened = screenArchiveCsv(csv, [PAID_ROW]);
    expect(screened.csv).toBe(csv);
    expect(screened.withheld).toEqual([]);
  });

  /**
   * A ZIP has no response header a human ever reads, so the notice has to ride
   * INSIDE the archive or it does not exist.
   */
  it("the withholding notice ships inside the archive as a readable file", () => {
    const { entries, readmeSection, notice } = buildArchiveLicenseDisclosure([
      {
        path: "parcelData",
        label: "parcelData",
        source: A_PAID_SOURCE,
        posture: "no",
        reason: `${A_PAID_SOURCE} is not redistributable under our contract`,
      },
    ]);

    const file = entries.find((e) => e.name === "LICENSE-NOTICE.md");
    expect(file, "the archive must carry LICENSE-NOTICE.md").toBeTruthy();
    const body = file!.data.toString("utf8");
    expect(body).toContain("# Data licence notice");
    expect(body).toContain(notice!);
    expect(body).toContain("| parcelData |");
    expect(body).toContain(A_PAID_SOURCE);

    // …and the README, which is what a human opens first, points at it.
    expect(readmeSection).toContain("LICENSE-NOTICE.md");
    expect(readmeSection).toContain(notice!);
  });

  it("the nothing-withheld README is a CHECKED negative that names its own limits", () => {
    const { entries, notice, readmeSection } = buildArchiveLicenseDisclosure([]);
    expect(notice).toBeNull();
    // No notice file at all — an archive that withheld nothing must not ship a
    // "data licence notice" implying it did.
    expect(entries).toEqual([]);
    // The claim names what was looked for…
    for (const field of PROVIDER_DERIVED_RECORD_FIELDS) {
      expect(readmeSection).toContain(field);
    }
    // …and claims only what was actually established. "None of these columns
    // appears" would be false whenever a provider column IS present but every
    // value in it is null or releasable — which is precisely the state a
    // future CSV writer creates, and screenArchiveCsv reports as nothing
    // withheld.
    expect(readmeSection).toContain("none of them held a value we are not permitted to pass on");
    expect(readmeSection).not.toMatch(/none of them appears/);
    // …and the two things this check does NOT cover.
    expect(readmeSection).toMatch(/attachments\//);
    expect(readmeSection).toMatch(/WITHOUT recording which\n?\s*provider produced it/);
  });

  it("the archive builder actually ships the disclosure (README + entries + schema.json)", () => {
    const src = read("server/services/migrationJobs.ts");
    expect(src).toMatch(/const licence = buildArchiveLicenseDisclosure\(archiveWithheld\)/);
    expect(src).toMatch(/archiveEntries\.push\(\.\.\.licence\.entries\)/);
    expect(src).toMatch(/\.replace\("\{licenseSection\}", \(\) => licence\.readmeSection\)/);
    // Machine-readable too: null means "checked, withheld nothing".
    expect(src).toMatch(/licenseNotice: licence\.notice/);
    expect(src).toMatch(/licenseWithheldCount: archiveWithheld\.length/);
    // Every CSV in the archive goes through the screen, not just the first.
    expect(src).toMatch(/const screened = screenArchiveCsv\(csv, rows\)/);
  });

  /**
   * The pin above proves the screening HELPER exists. It does not prove any
   * particular CSV calls it — the verifier showed an archive CSV could bypass
   * `screenArchiveCsv` entirely with all tests still green, which is exactly
   * the "a path claimed covered that is not" shape this suite exists to stop.
   * leads.csv is the sharpest case: `leads.enrichmentData` is a
   * provider-derived field this same lane's DSAR disclosure names by hand.
   *
   * So derive it: every CSV must enter the archive THROUGH the helper, and the
   * count of helper calls must equal the count of CSV-emitting request
   * branches. A seventh CSV added straight to `archiveEntries`, or a reverted
   * first one, now fails by name.
   */
  it("every CSV enters the archive through the screening helper, by count", () => {
    const src = read("server/services/migrationJobs.ts");
    const body = src.slice(src.indexOf("const addCsvEntry = async ("));

    const helperCalls = [...body.matchAll(/await addCsvEntry\(\s*\n?\s*"([a-z-]+\.csv)"/g)]
      .map((m) => m[1]);
    const csvBranches = [...body.matchAll(/requestedTypes\.has\("([a-z-]+)"\)/g)].map((m) => m[1]);

    // Guard against a vacuous pass if either regex stops matching.
    expect(helperCalls.length).toBeGreaterThan(4);
    expect(helperCalls.length).toBe(csvBranches.length);

    // Each branch's CSV is named for its type, so a rename cannot silently
    // detach a branch from the file it is supposed to emit.
    expect(new Set(helperCalls)).toEqual(new Set(csvBranches.map((t) => `${t}.csv`)));

    // And no .csv reaches the archive by any other route. The one legitimate
    // push lives inside addCsvEntry itself, after the screen.
    const pushesOfCsv = [...src.matchAll(/archiveEntries\.push\(\{\s*\n?\s*name:\s*"[^"]*\.csv"/g)];
    expect(pushesOfCsv).toHaveLength(0);
  });

  /**
   * The README is the file a customer opens first, and in the
   * NOTHING-WITHHELD case it is the ONLY place the checked negative rides
   * inside the archive — `buildArchiveLicenseDisclosure` returns no entries
   * and a null notice, so LICENSE-NOTICE.md is not written at all. Deleting
   * the `{licenseSection}` placeholder silently removed that sentence with
   * every test still green.
   */
  it("the README really carries the licence section, in both cases", () => {
    const src = read("server/services/migrationJobs.ts");
    const template = src.slice(src.indexOf("const README_TEMPLATE = `"));
    expect(template.slice(0, 2000)).toContain("{licenseSection}");

    // Reproduce the render the code performs and assert the section lands.
    const rendered = (section: string) =>
      template.slice(0, 2000).replace("{licenseSection}", section);
    expect(rendered("WITHHELD-CASE-TEXT")).toContain("WITHHELD-CASE-TEXT");
    expect(rendered("NOTHING-WITHHELD-TEXT")).toContain("NOTHING-WITHHELD-TEXT");
    // The placeholder must not survive the substitution.
    expect(rendered("x")).not.toContain("{licenseSection}");
  });
});

describe("fleet-12 path 3 — the MCP broker declaredSource path", () => {
  /**
   * DERIVED from the broker's own titleByCategory block: every title it can
   * stamp on a result must either resolve through the index or be listed, BY
   * NAME, in UNRECONCILED_BROKER_TITLES with a reason. A new broker title
   * cannot go dark silently, and a title that later gains a register row fails
   * this test until it is taken off the list.
   */
  const BROKER_TITLES = (() => {
    const src = read("server/services/data-source-broker.ts");
    const block = src.split("const titleByCategory")[1] ?? "";
    const body = block.split("};")[0] ?? "";
    return [...body.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
  })();

  it("the derived title list is non-empty (guards a vacuous pin)", () => {
    expect(BROKER_TITLES.length).toBeGreaterThan(5);
    // …and the source-parsed unreconciled map really parsed. A silent {} here
    // would make the two pins below vacuously true.
    expect(Object.keys(UNRECONCILED_BROKER_TITLES).length).toBeGreaterThan(5);
  });

  it.each(BROKER_TITLES)("broker title %s either resolves or is declared unreconciled", (title) => {
    const resolved = resolveEgressLicense(title);
    if (resolved.origin !== "unresolved") return; // reconciled through the index
    expect(
      UNRECONCILED_BROKER_TITLES[title],
      `broker title "${title}" resolves to nothing and is not declared in ` +
        `UNRECONCILED_BROKER_TITLES — it would fail closed with a generic ` +
        `"unknown vendor" reason that misdescribes what is actually wrong`,
    ).toBeTruthy();
  });

  it("every declared unreconciled title is still unresolved (the list cannot go stale)", () => {
    for (const [title, reason] of Object.entries(UNRECONCILED_BROKER_TITLES)) {
      expect(reason.length, `${title} has no reason`).toBeGreaterThan(20);
      expect(
        resolveEgressLicense(title).origin,
        `"${title}" now resolves through the index — remove it from ` +
          `UNRECONCILED_BROKER_TITLES so the refusal stops being claimed`,
      ).toBe("unresolved");
    }
  });

  it("an unresolvable broker source WITHHOLDS with its own reason, and does not crash", () => {
    for (const title of Object.keys(UNRECONCILED_BROKER_TITLES)) {
      const screened = screenToolResultData("mcp-tool-result", { fact: "vendor-bytes" }, {
        declaredSource: title,
      });
      expect(screened.data, `${title} leaked`).toBeNull();
      expect(screened.disclosure, `${title} withheld with no notice`).not.toBeNull();
      expect(screened.disclosure!.notice).toContain(title);
      // Not the generic "unknown vendor" line — the reason names this title's
      // actual problem.
      expect(screened.disclosure!.fields[0].reason).toContain(
        UNRECONCILED_BROKER_TITLES[title],
      );
    }
  });

  it("a redistributable:'no' source cannot ride out through a tool result", () => {
    const screened = screenToolResultData("mcp-tool-result", { avm: 412000, owner: "Jane Doe" }, {
      declaredSource: A_PAID_SOURCE,
    });
    expect(screened.data).toBeNull();
    expect(JSON.stringify(screened)).not.toContain("Jane Doe");
    expect(screened.disclosure!.notice).toMatch(/not redistributable under our contract/i);
  });

  it("the broker's cache/miss/error sentinels say what happened, not 'unknown vendor'", () => {
    for (const [sentinel, expected] of [
      ["Cache", /does not carry the upstream source forward/i],
      ["None", /no upstream source produced this result/i],
      ["Error", /the lookup failed/i],
    ] as const) {
      const r = resolveEgressLicense(sentinel);
      expect(postureMayLeave(r.posture)).toBe(false);
      expect(r.reason).toMatch(expected);
      expect(r.reason).not.toMatch(/not in the data-license register/i);
    }
  });

  /**
   * NOTHING TO WITHHOLD IS NOT A WITHHOLDING. The broker stamps a source title
   * on results carrying no data (retired category, miss, thrown lookup);
   * screening the title alone reported "1 field withheld" for bytes that never
   * existed — a suppression notice for an absence, which also buried the real
   * reason under a licence story.
   */
  it("an empty payload never produces a withholding notice", () => {
    for (const title of ["HIFLD (discontinued)", "None", "Error", A_PAID_SOURCE]) {
      for (const empty of [null, undefined]) {
        const screened = screenToolResultData("mcp-tool-result", empty, {
          declaredSource: title,
        });
        expect(screened.disclosure, `${title}/${String(empty)} claimed a withholding`).toBeNull();
        expect(screened.data).toBe(empty);
      }
    }
    // …but a real value under the same title is still withheld.
    expect(
      screenToolResultData("mcp-tool-result", { v: 1 }, { declaredSource: A_PAID_SOURCE }).disclosure,
    ).not.toBeNull();
  });

  it("an attribution-postured source is released WITH its attribution string", () => {
    const screened = screenToolResultData("mcp-tool-result", [{ lat: 1, lon: 2 }], {
      declaredSource: "OpenStreetMap Nominatim",
    });
    expect(screened.data).not.toBeNull();
    expect(screened.attributions).toContain("© OpenStreetMap contributors");
  });

  /**
   * RE-ANCHORED by R-1 (2026-08-11). This assertion used to read
   * `server/mcp/index.ts` and require one `brokerOk(result, …)` per
   * `dataSourceBroker.lookup(` call site — i.e. that each of that surface's 21
   * broker-backed tools declared its provenance on the way out. That file was
   * the retired `/mcp` endpoint's tool server and has been DELETED (founder
   * ruling R-1: it never enforced API-key scopes, so one credential had two
   * ladders). The tools went with it.
   *
   * The property being protected is not "brokerOk is called N times" — it is
   * "no MCP tool result reaches an external agent without passing the
   * chokepoint". That property outlives the file, so the assertion is
   * rewritten against the ONE surviving MCP surface rather than deleted.
   *
   * NOTE, recorded rather than asserted: `declaredSource` — the provenance
   * argument the deleted `brokerOk` supplied — now has NO production caller.
   * `/api/mcp` screens by payload inspection only, and always did; the surface
   * that declared provenance is gone rather than downgraded. The
   * declaredSource behaviour is still pinned by the sibling tests above, which
   * exercise `screenToolResultData` directly.
   */
  it("no MCP tool result leaves without passing the chokepoint", () => {
    const src = read("server/mcp/streamableHttp.ts");

    // Derived: isolate handleToolsCall and require EVERY successful-result
    // return in it to go through toolTextResult. A new branch that returns
    // `rpcResult(id, result.data)` directly fails this by count.
    const start = src.indexOf("async function handleToolsCall(");
    expect(start, "handleToolsCall not found — the surface was restructured").toBeGreaterThan(0);
    const end = src.indexOf("\n/** Dispatch a single JSON-RPC", start);
    const body = src.slice(start, end > start ? end : undefined);

    const resultReturns = (body.match(/return rpcResult\(/g) ?? []).length;
    const screenedReturns = (body.match(/return rpcResult\(\s*id,\s*toolTextResult\(/g) ?? []).length;
    expect(resultReturns).toBeGreaterThan(1);
    expect(
      screenedReturns,
      "a tools/call result path returns data without passing toolTextResult",
    ).toBe(resultReturns);

    // …and toolTextResult is genuinely the chokepoint, run LAST on the shape
    // that actually ships (after envelope externalization).
    expect(src).toMatch(/const externalized = externalizeToolData\(data\);/);
    expect(src).toMatch(/const screened = screenToolResultData\("mcp-tool-result", externalized\);/);
    // A released attribution/disclosure is rendered, not dropped.
    expect(src).toMatch(/screened\.disclosure/);
  });
});

describe("fleet-12b catch — a cache hit keeps the provenance it was fetched under", () => {
  /**
   * The defect this pins, found by the egress lane's adversarial verifier:
   * `lookup()` stamped `title: "Cache"` on every cache hit. The chokepoint
   * correctly reads an unresolvable title as `review-required` and withholds
   * the payload — so because the cache is WRITTEN on every successful lookup
   * and READ for 30 days, the second and every later call for a given key
   * returned `data: null`. That is the normal production path for all 21
   * broker-backed MCP tools, not an edge case, and every one of them would
   * have gone quietly empty.
   *
   * A cache hit is not a change of provenance: the bytes came from whichever
   * upstream served them and carry that upstream's licence. So the fix
   * resolves the origin back from the cached row's `data_source_id`, and
   * these pins hold that shape. Deliberately source-derived — the behaviour
   * needs a live broker + db, and the invariant that matters is structural.
   */
  const BROKER = read("server/services/data-source-broker.ts");

  it("the cached row's originating source id is carried out of the cache read", () => {
    // getCachedResult must return the id — without it the origin is unknowable.
    expect(BROKER).toMatch(/dataSourceId:\s*results\[0\]\.dataSourceId\s*\?\?\s*null/);
  });

  it("the cache-hit branch resolves the origin instead of hardcoding a title", () => {
    const hit = BROKER.slice(
      BROKER.indexOf("const cached = await this.getCachedResult(lookupKey)"),
      BROKER.indexOf("const sources = await this.getSourcesForCategory(category)"),
    );
    expect(hit.length).toBeGreaterThan(100);
    expect(hit).toContain("this.resolveCachedSource(cached.dataSourceId, category)");
    // The title comes from the resolved origin, and "Cache" survives ONLY as
    // the unresolvable fallback (which withholds at the chokepoint, correctly).
    expect(hit).toMatch(/title:\s*origin\?\.title\s*\?\?\s*"Cache"/);
    // The old unconditional stamp must be gone, in either quoting style.
    expect(hit).not.toMatch(/title:\s*"Cache",/);
  });

  it("the built-in federal sentinel rebuilds the same virtual source the live path uses", () => {
    const fn = BROKER.slice(BROKER.indexOf("private async resolveCachedSource("));
    expect(fn.slice(0, 1200)).toContain("BUILTIN_FEDERAL_SOURCE_ID");
    expect(fn.slice(0, 1200)).toContain("this.buildVirtualFederalSource(category)");
  });

  it("an unresolvable origin still fails closed rather than inventing one", () => {
    const fn = BROKER.slice(BROKER.indexOf("private async resolveCachedSource("));
    // null in -> null out; no default title is manufactured inside the resolver.
    expect(fn.slice(0, 1200)).toMatch(/if \(dataSourceId === null\) return null;/);
    expect(fn.slice(0, 1200)).toContain("return rows[0] ?? null;");
  });
});
