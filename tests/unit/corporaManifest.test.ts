/**
 * Tier-2 corpora manifest + status honesty (founder ruling 2026-07-28 #10).
 *
 * Pins the no-fabrication contract of the bulk-corpora scaffold:
 *  1. Manifest completeness — every approved corpus is present, with a
 *     verified license class and ingestStatus "not_provisioned" (storage does
 *     not exist yet, so nothing else would be honest).
 *  2. No invented sizes — approxSizeGB is null for every entry, because
 *     docs/company/open-data-maps.md states no per-corpus totals. If a real
 *     documented total ever lands, loosen the specific assertion WITH the
 *     doc citation — never with a guess.
 *  3. getCorporaStatus() never overstates: with no bucket configured every
 *     reason is the verbatim STORAGE_NOT_PROVISIONED sentinel; with all four
 *     OPEN_DATA_BUCKET_* keys set the status is at most
 *     storage_configured_pipeline_pending — an "ingested" status does not
 *     exist this wave (no ingestion code exists in the repo).
 *  4. The four env keys are documented (commented) in .env.example.
 *  5. The seed is actually wired into the seedFounderDecisionCards boot hook.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  TIER2_CORPORA,
  OPEN_DATA_BUCKET_ENV_KEYS,
  STORAGE_NOT_PROVISIONED,
  corpusByKey,
  type CorpusLicense,
} from "@shared/openData/corporaManifest";
import {
  getCorporaStatus,
  isBucketConfigured,
  PIPELINE_PENDING_REASON,
} from "../../server/services/openData/corporaStatus";

const root = path.resolve(__dirname, "../..");

const APPROVED_KEYS = [
  "naip-aerial",
  "usgs-3dep-dem-1m",
  "usgs-3dep-lidar-ept",
  "statewide-parcels-bulk",
  "annual-nlcd",
  "usda-cdl",
  "blm-plss-cadnsdi",
  "census-tiger-line",
  "dot-nad-addresses",
  "pad-us",
  "usgs-3dhp-hydrography",
  "overture-buildings",
];

const VALID_LICENSES: CorpusLicense[] = [
  "public-domain-usgov",
  "cc0",
  "odbl",
  "state-public-record",
];

describe("corporaManifest — the approved Tier-2 registry", () => {
  it("contains exactly the 12 approved corpora (ruling #10), unique keys", () => {
    const keys = TIER2_CORPORA.map((c) => c.key);
    expect(keys.sort()).toEqual([...APPROVED_KEYS].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every entry carries a verified license class and required fields", () => {
    for (const c of TIER2_CORPORA) {
      expect(VALID_LICENSES, `${c.key} license`).toContain(c.license);
      expect(c.name.length, `${c.key} name`).toBeGreaterThan(0);
      expect(c.sourceOrg.length, `${c.key} sourceOrg`).toBeGreaterThan(0);
      expect(c.refreshCadence.length, `${c.key} refreshCadence`).toBeGreaterThan(0);
      expect(c.whatItUnlocks.length, `${c.key} whatItUnlocks`).toBeGreaterThan(0);
    }
  });

  it("every entry is not_provisioned — storage does not exist yet", () => {
    for (const c of TIER2_CORPORA) {
      expect(c.ingestStatus, c.key).toBe("not_provisioned");
    }
  });

  it("no invented sizes: approxSizeGB is null everywhere (the doc states no per-corpus totals)", () => {
    for (const c of TIER2_CORPORA) {
      expect(c.approxSizeGB, `${c.key} approxSizeGB`).toBeNull();
    }
  });

  it("mirrors the doc's license nuances: TIGER is CC0, Overture is ODbL with the share-alike note documented", () => {
    expect(corpusByKey("census-tiger-line")?.license).toBe("cc0");
    const overture = corpusByKey("overture-buildings");
    expect(overture?.license).toBe("odbl");
    expect(overture?.licenseNote).toMatch(/share-alike/i);
    expect(overture?.licenseNote).toContain("© OpenStreetMap contributors");
    // The parcels bundle is state public record, NOT federal public domain.
    expect(corpusByKey("statewide-parcels-bulk")?.license).toBe("state-public-record");
    // NAIP's requester-pays trap is documented, not discovered in prod.
    expect(corpusByKey("naip-aerial")?.licenseNote).toMatch(/Requester-Pays/i);
  });

  it("names the 7 verified statewide-parcel states", () => {
    const parcels = corpusByKey("statewide-parcels-bulk");
    for (const st of ["FL", "MT", "NC", "WA", "NJ", "AR", "TN"]) {
      expect(parcels?.name, st).toContain(st);
    }
  });
});

describe("getCorporaStatus — never overstates", () => {
  const emptyEnv: Record<string, string | undefined> = {};
  const configuredEnv: Record<string, string | undefined> = {
    OPEN_DATA_BUCKET_ENDPOINT: "https://example.r2.cloudflarestorage.com",
    OPEN_DATA_BUCKET_NAME: "acreos-open-data",
    OPEN_DATA_BUCKET_ACCESS_KEY_ID: "key",
    OPEN_DATA_BUCKET_SECRET: "secret",
  };

  it("no bucket configured → every corpus not_provisioned with the exact sentinel reason", () => {
    const reports = getCorporaStatus(emptyEnv);
    expect(reports).toHaveLength(TIER2_CORPORA.length);
    for (const r of reports) {
      expect(r.ingestStatus, r.key).toBe("not_provisioned");
      expect(r.reason, r.key).toBe(
        "object storage not provisioned — set OPEN_DATA_BUCKET_* to arm the ingestion pipeline",
      );
      expect(r.reason).toBe(STORAGE_NOT_PROVISIONED);
    }
  });

  it("partial env (some keys missing) still counts as not provisioned", () => {
    const partial = { ...configuredEnv, OPEN_DATA_BUCKET_SECRET: "" };
    expect(isBucketConfigured(partial)).toBe(false);
    for (const r of getCorporaStatus(partial)) {
      expect(r.ingestStatus).toBe("not_provisioned");
      expect(r.reason).toBe(STORAGE_NOT_PROVISIONED);
    }
  });

  it("all keys set → storage_configured_pipeline_pending with an honest nothing-ingested reason — NEVER 'ingested'", () => {
    expect(isBucketConfigured(configuredEnv)).toBe(true);
    const reports = getCorporaStatus(configuredEnv);
    for (const r of reports) {
      expect(r.ingestStatus, r.key).toBe("storage_configured_pipeline_pending");
      expect(r.reason, r.key).toBe(PIPELINE_PENDING_REASON);
      expect(r.reason).toMatch(/nothing has been ingested/);
    }
  });

  it("the status vocabulary has no 'ingested' member this wave (no ingestion code exists)", () => {
    // Source-shape: the shared enum is the only status vocabulary, and it
    // must not contain an ingested/complete state until real ingestion ships.
    const manifestSrc = readFileSync(
      path.join(root, "shared/openData/corporaManifest.ts"),
      "utf-8",
    );
    const enumBlock = manifestSrc.slice(
      manifestSrc.indexOf("export type CorpusIngestStatus"),
      manifestSrc.indexOf("export interface CorpusManifestEntry"),
    );
    expect(enumBlock).toContain('"not_provisioned"');
    expect(enumBlock).toContain('"storage_configured_pipeline_pending"');
    expect(enumBlock).not.toMatch(/"ingested"|"ingesting"|"complete"/);
  });
});

describe(".env.example — the future pipeline's keys are documented", () => {
  const envExample = readFileSync(path.join(root, ".env.example"), "utf-8");

  it("documents all four OPEN_DATA_BUCKET_* keys (commented — unset by default)", () => {
    for (const key of OPEN_DATA_BUCKET_ENV_KEYS) {
      expect(envExample).toMatch(new RegExp(`^# ${key}=`, "m"));
    }
  });

  it("names the cost band and S3-compatibility from the program research", () => {
    expect(envExample).toMatch(/\$10–30\/mo/);
    expect(envExample).toMatch(/S3-compatible/);
  });

  it("admits no ingestion pipeline exists yet", () => {
    expect(envExample).toMatch(/no ingestion pipeline exists yet/i);
  });
});

describe("seedFounderDecisionCards.ts — the corpora card rides the boot hook", () => {
  it("imports and invokes seedOpenDataCorporaDecisionCard, fail-open", () => {
    const src = readFileSync(
      path.join(root, "server/jobs/seedFounderDecisionCards.ts"),
      "utf-8",
    );
    expect(src).toContain('import("../services/openData/corporaStatus")');
    expect(src).toContain("seedOpenDataCorporaDecisionCard()");
    expect(src).toContain("open-data corpora seed failed (boot unaffected)");
  });
});
