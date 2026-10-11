/**
 * Known export layouts the importer recognises in one click (W5b).
 *
 * ONLY LAYOUTS WE COULD VERIFY. A preset is a claim that a file from that tool
 * has these columns meaning these things; a wrong preset silently puts every
 * postcard on a vacant lot (the mailing-vs-situs rule in csvImportMapping.ts).
 * So a tool is listed here only when its column names were read from the
 * vendor's own public documentation, cited per preset. Everything else gets
 * the guided column mapper — the header heuristic plus a dropdown per column —
 * and the UI says WHY there is no preset for it (UNVERIFIED_SOURCES).
 *
 * Checked 2026-10-11:
 *   Regrid parcel export — verified (support.regrid.com/docs/addresses,
 *     /docs/ownership, /docs/identification list every column used below).
 *   AcreOS's own lead export — verified (server/services/importExport.ts
 *     exportLeadsToCSV writes exactly these headers).
 *   PropStream, LandInsights / Land Portal, DataTree, REI Pipeline — NOT
 *     verified: see UNVERIFIED_SOURCES for what each publishes.
 *
 * No preset maps a language column: a vendor's "language" field is commonly
 * derived from surname, a national-origin proxy (shared/outreach/
 * outreachLanguage.ts). Pure; browser-safe.
 */
import type { CsvImportTargetField } from "./csvImportMapping";

export interface ImportFormatPreset {
  id: string;
  label: string;
  /** Where the column names were verified. */
  source: string;
  /** Every one of these headers (case-insensitive, trimmed) must be present. */
  signature: readonly string[];
  /** header (lower-case) → field. Headers not listed are left to the heuristic. */
  columns: Readonly<Record<string, CsvImportTargetField>>;
}

export const IMPORT_FORMAT_PRESETS: readonly ImportFormatPreset[] = [
  {
    id: "regrid_parcels",
    label: "Regrid parcel export",
    source: "Regrid parcel schema — support.regrid.com/docs/addresses, /docs/ownership, /docs/identification",
    signature: ["parcelnumb", "owner", "mailadd"],
    columns: {
      parcelnumb: "apn",
      owner: "ownerName",
      ownfrst: "firstName",
      ownlast: "lastName",
      // Owner MAILING block — where the tax bill (and our letter) goes.
      mailadd: "address",
      mail_city: "city",
      mail_state2: "state",
      mail_zip: "zip",
      // The parcel's situs.
      address: "propertyAddress",
      scity: "propertyCity",
      state2: "propertyState",
      szip: "propertyZip",
      szip5: "propertyZip",
      county: "county",
      // Regrid's `city` is the Census county subdivision, NOT a city.
      city: "skip",
      owner2: "skip",
      owner3: "skip",
      owner4: "skip",
      careof: "skip",
      mail_address2: "skip",
      mail_country: "skip",
    },
  },
  {
    id: "acreos_export",
    label: "AcreOS lead export",
    source: "AcreOS's own export (server/services/importExport.ts exportLeadsToCSV)",
    signature: ["first name", "last name", "address", "city", "state", "zip", "status", "source"],
    columns: {
      id: "skip",
      type: "skip",
      "first name": "firstName",
      "last name": "lastName",
      email: "email",
      phone: "phone",
      address: "address",
      city: "city",
      state: "state",
      zip: "zip",
      status: "skip",
      source: "skip",
      notes: "skip",
      tags: "skip",
      score: "skip",
      "last contacted at": "skip",
      "created at": "skip",
      "updated at": "skip",
    },
  },
];

export interface UnverifiedSource {
  tool: string;
  why: string;
}

/** Tools customers move from whose export layout we could NOT verify — guided mapper. */
export const UNVERIFIED_SOURCES: readonly UnverifiedSource[] = [
  { tool: "PropStream", why: "export columns follow each user's saved list layout (the gear menu), so there is no one layout to preset" },
  { tool: "LandInsights / Land Portal", why: "the help center documents how to export, not the column names" },
  { tool: "DataTree", why: "the export file layout is not published" },
  { tool: "REI Pipeline", why: "no public description of its export columns could be found" },
];

const norm = (h: string) => h.replace(/^﻿/, "").trim().toLowerCase();

/**
 * The preset whose signature this header row carries, with the mapping it
 * implies (headers the preset does not name are returned as undefined so the
 * caller can fall back to the heuristic for them). Null when none matches.
 */
export function detectImportFormat(
  headers: readonly string[],
): { preset: ImportFormatPreset; mapping: Record<string, CsvImportTargetField | undefined> } | null {
  const present = new Set(headers.map(norm));
  for (const preset of IMPORT_FORMAT_PRESETS) {
    if (!preset.signature.every((h) => present.has(h))) continue;
    const mapping: Record<string, CsvImportTargetField | undefined> = {};
    for (const h of headers) mapping[h] = preset.columns[norm(h)];
    return { preset, mapping };
  }
  return null;
}
