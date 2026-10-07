/**
 * Header → lead-field mapping for the column-mapping CSV importer
 * (client/src/components/leads/CsvImportSheet.tsx → POST /api/leads/csv-import).
 *
 * Shared so the client's auto-mapping and the server's row limit come from one
 * place, and so the mapping can be tested against the land-list shapes
 * customers actually upload.
 *
 * THE ADDRESS RULE. A lead's `address / city / state / zip` is the OWNER'S
 * MAILING address: it is what direct mail is sent to
 * (services/communications.ts → sendDirectMailToLead). The parcel's situs
 * address is a different place — for absentee land owners almost always a
 * different state — and is stored as `propertyAddress`. Land lists carry both,
 * so a mapper that sends both to one field puts every postcard on a vacant lot.
 *
 *   - a header that says mail/mailing/owner → mailing fields;
 *   - a header that says situs/property/site/parcel → property fields;
 *   - a bare "Address"/"City"/"State"/"Zip" is the mailing address, UNLESS the
 *     file also has an explicit mailing column for the same part — then the
 *     bare one is the property's (PropStream: "Owner Mailing City" + "City").
 *
 * When several columns map to the same field ("Phone 1", "Phone 2"), the FIRST
 * non-empty value in column order wins — never the last column.
 */

/** One request to /api/leads/csv-import carries at most this many rows. */
export const CSV_IMPORT_MAX_ROWS_PER_REQUEST = 500;

export const CSV_IMPORT_TARGET_FIELDS = [
  { id: "skip", label: "— Don't import —" },
  { id: "firstName", label: "First name" },
  { id: "lastName", label: "Last name" },
  { id: "ownerName", label: "Owner name (whole name, as written)" },
  { id: "address", label: "Mailing address (where mail is sent)" },
  { id: "city", label: "Mailing city" },
  { id: "state", label: "Mailing state" },
  { id: "zip", label: "Mailing ZIP" },
  { id: "mailingCityStateZip", label: "Mailing city + state + ZIP (one column)" },
  { id: "propertyAddress", label: "Property (situs) address" },
  { id: "propertyCity", label: "Property city" },
  { id: "propertyState", label: "Property state" },
  { id: "propertyZip", label: "Property ZIP" },
  { id: "county", label: "County" },
  { id: "phone", label: "Phone" },
  { id: "email", label: "Email" },
  { id: "apn", label: "APN / Parcel number" },
  { id: "doNotContact", label: "Do-not-contact / DNC flag" },
] as const;

export type CsvImportTargetField = (typeof CSV_IMPORT_TARGET_FIELDS)[number]["id"];

type AddressPart = "address" | "city" | "state" | "zip" | "cityStateZip";
type AddressKind = "mailing" | "property" | "bare";

interface Classified {
  field: CsvImportTargetField;
  /** Set for address parts, so suggestMapping can resolve a bare column. */
  part?: AddressPart;
  kind?: AddressKind;
}

const MAILING_FIELD: Record<AddressPart, CsvImportTargetField> = {
  address: "address",
  city: "city",
  state: "state",
  zip: "zip",
  cityStateZip: "mailingCityStateZip",
};
const PROPERTY_FIELD: Record<AddressPart, CsvImportTargetField> = {
  address: "propertyAddress",
  city: "propertyCity",
  state: "propertyState",
  zip: "propertyZip",
  // No single-column property city/state/zip target; the street is what matters.
  cityStateZip: "skip",
};

/** "Phone1 Type" → "phone 1 type"; "MAIL_ADDR1" → "mail addr 1". */
function normalizeHeader(header: string): string {
  return header
    .replace(/^﻿/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function classify(header: string): Classified {
  const h = normalizeHeader(header);
  const has = (re: RegExp) => re.test(h);
  const phoneWord = /\b(phone|phones|mobile|cell|cellphone|landline|tel|telephone|wireless)\b/;

  // Flags first: a "Phone1 DNC" column is a flag, not a phone.
  if (has(/\b(dnc|donotcall|donotcontact)\b|\bdo not (call|contact|mail)\b/)) return { field: "doNotContact" };
  // Phone metadata ("Phone1 Type", "Phone 1 Carrier") is not a number.
  if (has(phoneWord) && has(/\b(type|status|carrier|score|connected|verified|line type|litigator)\b/)) return { field: "skip" };
  if (has(/\be ?mail\b/)) return { field: "email" };
  if (has(phoneWord)) return { field: "phone" };

  // Split names before the broad owner-name rule: "Owner 1 First Name" is a
  // first name, not the whole owner name.
  if (has(/\b(first|given)\b/) && has(/\b(name|owner)\b/)) return { field: "firstName" };
  if (has(/\bsurname\b/) || (has(/\b(last|family)\b/) && has(/\b(name|owner)\b/))) return { field: "lastName" };

  // Address parts, with which place they describe.
  const kind: AddressKind = has(/\b(mail|mailing|owner)\b/)
    ? "mailing"
    : has(/\b(situs|property|prop|site|parcel|physical|location)\b/)
      ? "property"
      : "bare";
  const city = has(/\b(city|town)\b/);
  const state = has(/\b(state|st)\b/);
  const zip = has(/\b(zip|zipcode|postal)\b/);
  let part: AddressPart | null = null;
  if (city && state && zip) part = "cityStateZip";
  else if (zip) part = "zip";
  else if (state && !has(/\bcounty\b/)) part = "state";
  else if (city) part = "city";
  else if (has(/\b(address|addr|street)\b/) || h === "situs") part = "address";
  if (part) return { field: kind === "property" ? PROPERTY_FIELD[part] : MAILING_FIELD[part], part, kind };

  if (has(/\b(apn|parcel|pin)\b/)) return { field: "apn" };
  if (has(/\bcounty\b/)) return { field: "county" };
  if (has(/owner.*name|name.*owner|full ?name/) || h === "name" || h === "owner" || /^owner \d+$/.test(h) || h === "owners") {
    return { field: "ownerName" };
  }
  return { field: "skip" };
}

/**
 * Context-aware mapping for a whole header row. A bare address part is read as
 * the mailing address, unless the file has an explicit mailing column for the
 * same part — then it is the property's.
 */
export function suggestMapping(headers: string[]): Record<string, CsvImportTargetField> {
  const classified = headers.map((h) => ({ header: h, c: classify(h) }));
  // Which mailing parts does the file name explicitly?
  const explicitMailing = new Set<AddressPart>();
  for (const { c } of classified) {
    if (c.kind !== "mailing" || !c.part) continue;
    if (c.part === "cityStateZip") ["city", "state", "zip"].forEach((p) => explicitMailing.add(p as AddressPart));
    else explicitMailing.add(c.part);
  }
  const mapping: Record<string, CsvImportTargetField> = {};
  for (const { header, c } of classified) {
    let field = c.field;
    if (c.kind === "bare" && c.part) {
      const taken =
        c.part === "cityStateZip"
          ? explicitMailing.has("city") || explicitMailing.has("state") || explicitMailing.has("zip")
          : explicitMailing.has(c.part);
      if (taken) field = PROPERTY_FIELD[c.part];
    }
    mapping[header] = field;
  }
  return mapping;
}

/**
 * Lightweight CSV parser. Handles double-quote-escaped commas + CRLF.
 * Not RFC 4180-perfect, but sufficient for county tax lists (which are
 * the actual hot use case). Server-side import handles the strict edge
 * cases for power users via /api/leads/import (preview path). Moved here from
 * CsvImportSheet.tsx so the mapping tests read files the way the sheet does.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  // A spreadsheet's UTF-8 byte-order mark is not part of the first header.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      // Treat "" inside quotes as literal "
      if (inQuotes && text[i + 1] === '"') {
        buf += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((c === "\n" || c === "\r") && !inQuotes) {
      if (buf.length > 0 || lines.length === 0) lines.push(buf);
      buf = "";
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else {
      buf += c;
    }
  }
  if (buf.length > 0) lines.push(buf);

  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = !quoted;
      } else if (c === "," && !quoted) {
        cells.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    cells.push(cur);
    return cells.map((s) => s.trim());
  };

  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine).filter((r) => r.some((c) => c.length > 0));
  return { headers, rows };
}

/** "LOS ANGELES CA 90012" / "Deming, NM 88030-1234" → parts; null when unreadable. */
function splitCityStateZip(raw: string): { city: string; state: string; zip: string } | null {
  const m = raw.trim().match(/^(.*?)[\s,]+([A-Za-z]{2})\.?[\s,]+(\d{4,5}(?:-?\d{4})?)$/);
  if (!m || !m[1].trim()) return null;
  return { city: m[1].replace(/,\s*$/, "").trim(), state: m[2].toUpperCase(), zip: restoreZip(m[3]) };
}

/**
 * A 4-digit ZIP is a 5-digit ZIP whose leading zero a spreadsheet dropped
 * (New England / New Jersey: "07102" → "7102"). No 4-digit US ZIP exists, so
 * restoring the zero recovers the value the list held, it does not invent one.
 */
export function restoreZip(raw: string): string {
  const v = raw.trim();
  if (/^\d{4}$/.test(v)) return `0${v}`;
  if (/^\d{4}-\d{4}$/.test(v)) return `0${v}`;
  return v;
}

const ZIP_FIELDS = new Set<string>(["zip", "propertyZip"]);

/**
 * One CSV row → the lead fields its mapped columns hold. First non-empty value
 * per field wins (column order); a combined city/state/ZIP column fills the
 * mailing parts it can read and leaves the rest empty rather than guessing.
 */
export function mapCsvRow(
  headers: string[],
  cells: string[],
  mapping: Record<string, CsvImportTargetField>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    const target = mapping[headers[i]];
    if (!target || target === "skip") continue;
    const val = (cells[i] ?? "").trim();
    if (!val) continue;
    if (target === "mailingCityStateZip") {
      const parts = splitCityStateZip(val);
      if (!parts) continue;
      if (!out.city) out.city = parts.city;
      if (!out.state) out.state = parts.state;
      if (!out.zip) out.zip = parts.zip;
      continue;
    }
    if (out[target]) continue;
    out[target] = ZIP_FIELDS.has(target) ? restoreZip(val) : val;
  }
  return out;
}

/**
 * Reads a DNC / do-not-contact cell. Empty or an explicit no ("N", "false",
 * "0") is not a flag; ANY other value is ("Y", "true", "1", "Federal DNC",
 * "Wireless") — an unknown non-empty value in a DNC column is read in the
 * direction that cannot cause an unlawful contact.
 */
export function parseDncFlag(raw: string | null | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return false;
  return !/^(n|no|false|f|0|none|clean|ok|-)$/.test(v);
}

/** Splits mapped rows into request-sized batches, keeping each batch's first row offset. */
export function chunkCsvImportRows<T>(rows: T[], size = CSV_IMPORT_MAX_ROWS_PER_REQUEST): Array<{ offset: number; rows: T[] }> {
  const out: Array<{ offset: number; rows: T[] }> = [];
  for (let i = 0; i < rows.length; i += size) out.push({ offset: i, rows: rows.slice(i, i + size) });
  return out;
}

/** The situs block stored on the lead as `propertyAddress`; null without a street. */
export function composePropertyAddress(r: {
  propertyAddress?: string | null;
  propertyCity?: string | null;
  propertyState?: string | null;
  propertyZip?: string | null;
}): string | null {
  const street = r.propertyAddress?.trim();
  if (!street) return null;
  const stateZip = [r.propertyState?.trim(), r.propertyZip?.trim()].filter(Boolean).join(" ");
  return [street, r.propertyCity?.trim(), stateZip].filter(Boolean).join(", ");
}
