/**
 * Quinn — Chief of Alignment, item #5: customer-facing data-disclosure surface.
 *
 * A thin, public-safe read endpoint that answers "where does AcreOS get its
 * data, how old is it, what license governs it, and which numbers are facts vs.
 * estimates vs. model output." Transparent sourcing is the differentiator the
 * paid black boxes can't match — so the disclosure is honest, dated, and
 * derived from the same register the cache/redistribution guard already trusts
 * (`server/services/providers/data-licenses.ts`), never a hand-maintained copy
 * that can drift from reality.
 *
 *   GET /api/trust/data-sources
 *     → { sources, classifications, attributions, lastUpdated }
 *
 * Public, no auth: prospective customers should be able to read our sourcing
 * posture before they sign up. Errors.* per CLAUDE.md.
 */

import type { Express, Request, Response } from "express";
import {
  DATA_LICENSE_REGISTER,
  type DataLicenseEntry,
} from "./services/providers/data-licenses";
import type { DataLicense, RedistributePosture } from "./services/providers/types";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

/**
 * Plain-language description of what each source is the system-of-record for,
 * plus how often the authoritative source actually changes. Keyed by the same
 * canonical `source` name the providers stamp on every LookupResult, so this
 * list stays aligned with the register and the cache cadence
 * (`server/services/providers/cache-ttl.ts`).
 */
const SOURCE_DETAIL: Record<
  string,
  { authoritativeFor: string; cadence: string }
> = {
  "FEMA NFHL": {
    authoritativeFor: "Flood zones and flood-hazard boundaries",
    cadence: "Updated by FEMA as flood maps are revised — typically months to years per area",
  },
  "USFWS NWI": {
    authoritativeFor: "Wetlands boundaries",
    cadence: "Updated periodically as wetlands are re-mapped",
  },
  "USDA SSURGO": {
    authoritativeFor: "Soil types, drainage, and farmland classification",
    cadence: "Changes rarely — soil surveys are stable for years",
  },
  "USDA WSS": {
    authoritativeFor: "Soil survey detail",
    cadence: "Changes rarely — soil surveys are stable for years",
  },
  "USDA NASS": {
    authoritativeFor: "Regional agricultural land values (a baseline, not a comp)",
    cadence: "Published annually",
  },
  "USGS 3DEP": {
    authoritativeFor: "Ground elevation and terrain",
    cadence: "Updated as new elevation surveys are flown",
  },
  "US Census ACS": {
    authoritativeFor: "Area demographics and population",
    cadence: "Updated annually",
  },
  "US Census TIGER": {
    authoritativeFor: "Place, county, and boundary lines",
    cadence: "Updated annually",
  },
  "BLM PLSS": {
    authoritativeFor: "Public Land Survey System sections and townships",
    cadence: "Changes rarely",
  },
  "EPA FRS": {
    authoritativeFor: "Nearby regulated environmental facilities",
    cadence: "Updated on an ongoing basis by the EPA",
  },
  "EPA ECHO": {
    authoritativeFor: "Environmental compliance and enforcement records",
    cadence: "Updated on an ongoing basis by the EPA",
  },
  OpenStreetMap: {
    authoritativeFor: "Roads, access, and map context (background reference, not a parcel fact)",
    cadence: "Edited continuously by contributors",
  },
  Regrid: {
    authoritativeFor: "Parcel boundaries and ownership (paid coverage where county data is thin)",
    cadence: "Refreshed on Regrid's schedule",
  },
  "ATTOM Data": {
    authoritativeFor: "Property and sale records (paid coverage)",
    cadence: "Refreshed on ATTOM's schedule",
  },
  BatchData: {
    authoritativeFor: "Owner contact lookups (paid, used only when you ask for them)",
    cadence: "Refreshed on BatchData's schedule",
  },
};

/** Fallback detail for any register source without an explicit entry. */
const UNKNOWN_DETAIL = {
  authoritativeFor: "Supporting reference data",
  cadence: "Cadence varies by source",
};

/**
 * The estimate-vs-authoritative legend the customer needs to read every number
 * in the product. These map 1:1 to LookupResult.classification so the page is
 * the single source of truth for what each provenance chip means.
 */
const CLASSIFICATION_LEGEND: Array<{
  id: "authoritative" | "estimate" | "modeled" | "unknown";
  label: string;
  meaning: string;
}> = [
  {
    id: "authoritative",
    label: "On record",
    meaning:
      "A fact pulled straight from the system of record — a county or federal source. You can rely on it, allowing for how recently the source itself was updated.",
  },
  {
    id: "estimate",
    label: "Estimate",
    meaning:
      "A number worked out from real data, such as a value range from comparable sales. It is a starting point to check, not a quote.",
  },
  {
    id: "modeled",
    label: "Model output",
    meaning:
      "A score produced by a calculation, such as an opportunity score. It reflects the inputs available and is never presented as a recorded fact.",
  },
  {
    id: "unknown",
    label: "Not pulled yet",
    meaning:
      "We have not retrieved this value. AcreOS shows a blank with a way to fetch it — never a filled-in guess.",
  },
];

/** Plain-language gloss for each license type. */
const LICENSE_LABEL: Record<DataLicense, string> = {
  "public-domain-usgov": "U.S. government public-domain data",
  cc0: "Creative Commons Zero (public domain)",
  "cc-by": "Creative Commons Attribution",
  odbl: "Open Database License (attribution and share-alike)",
  "county-tos": "Governed by the county or portal's terms of use",
  proprietary: "Licensed from a paid vendor",
};

/** Plain-language gloss for the redistribution posture. */
const POSTURE_LABEL: Record<RedistributePosture, string> = {
  yes: "Open data — free to use and share",
  attribution: "Open data — free to use with credit to the source",
  no: "Paid source — shown to you, not redistributed",
  "review-required": "Terms reviewed per source before any reuse",
};

interface DataSourcePayload {
  source: string;
  authoritativeFor: string;
  cadence: string;
  license: DataLicense;
  licenseLabel: string;
  redistributable: RedistributePosture;
  redistributableLabel: string;
  attributionText?: string;
  termsUrl?: string;
  lastReviewed: string;
  /** "open" (free public data) or "paid" (licensed vendor). */
  kind: "open" | "paid";
}

function toPayload(entry: DataLicenseEntry): DataSourcePayload {
  const detail = SOURCE_DETAIL[entry.source] ?? UNKNOWN_DETAIL;
  const kind: "open" | "paid" = entry.license === "proprietary" ? "paid" : "open";
  return {
    source: entry.source,
    authoritativeFor: detail.authoritativeFor,
    cadence: detail.cadence,
    license: entry.license,
    licenseLabel: LICENSE_LABEL[entry.license] ?? entry.license,
    redistributable: entry.redistributable,
    redistributableLabel: POSTURE_LABEL[entry.redistributable] ?? entry.redistributable,
    attributionText: entry.attributionText,
    termsUrl: entry.termsUrl,
    lastReviewed: entry.lastReviewed,
    kind,
  };
}

export function registerDataSourcesRoutes(app: Express): void {
  // GET /api/trust/data-sources — the "How AcreOS sources data" disclosure.
  app.get("/api/trust/data-sources", async (_req: Request, res: Response) => {
    try {
      const sources = Object.values(DATA_LICENSE_REGISTER)
        .map(toPayload)
        // Open data first (our differentiator), then paid; alphabetical within.
        .sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === "open" ? -1 : 1;
          return a.source.localeCompare(b.source);
        });

      // Attribution lines that must be rendered wherever these sources appear
      // (OSM ODbL + any other attribution-required source). Closes Beatrice's
      // attribution-surface need in one place.
      const attributions = sources
        .filter((s) => s.attributionText)
        .map((s) => ({ source: s.source, text: s.attributionText as string }));

      // The disclosure changes on the order of weeks (when a license is
      // re-reviewed or a source is added). 1-hour public cache is safe.
      res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
      return res.json({
        sources,
        classifications: CLASSIFICATION_LEGEND,
        attributions,
        lastUpdated: new Date().toISOString(),
      });
    } catch (err: unknown) {
      logger.error("[trust] data-sources fetch failed", err);
      return Errors.internal(res, err);
    }
  });
}
