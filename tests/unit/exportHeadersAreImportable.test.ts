/**
 * G11 Defects 2, 3 and the export sweep (c): every header an exporter writes
 * must be read by the importer that is supposed to take the file back — or be
 * named, with a reason, in EXPORT_ONLY_HEADERS. The resolution goes through
 * `resolveImportHeader`, the function the importers read cells with, so this
 * decides importability by the importing code and not by a list kept beside it.
 */
import { describe, expect, it } from "vitest";
import { IMPORT_EXPORT_CONTRACT } from "../../server/services/importExport";
import { classifyParcelFactHeader } from "../../shared/leads/parcelFacts";
import { ACQUIRED_NOTES_EXPORT } from "../../server/services/notes/acquiredNotesExport";
import { NOTE_TAPE_FIELDS, REQUIRED_NOTE_TAPE_FIELDS } from "../../shared/notes/noteTapeFields";
import { suggestNoteTapeMapping } from "../../server/services/notes/noteTapeImport";

const C = IMPORT_EXPORT_CONTRACT;
const resolveImportHeader = C.resolveHeader;
const EXPORT_ONLY_HEADERS = C.exportOnlyHeaders;
const LEAD_COLUMN_MAP = C.importMaps.leads;
const PROPERTY_COLUMN_MAP = C.importMaps.properties;
const DEAL_COLUMN_MAP = C.importMaps.deals;
const NOTE_COLUMN_MAP = C.importMaps.notes;
const LEAD_EXPORT_HEADERS = C.exportHeaders.leads;
const PROPERTY_EXPORT_HEADERS = C.exportHeaders.properties;
const DEAL_EXPORT_HEADERS = C.exportHeaders.deals;
const NOTE_EXPORT_HEADERS = C.exportHeaders.notes;
const ACQUIRED_NOTE_EXPORT_HEADERS = ACQUIRED_NOTES_EXPORT.headers;
const ACQUIRED_NOTE_EXPORT_FIELDS = ACQUIRED_NOTES_EXPORT.fields;

const unreadable = (headers: readonly string[], read: (h: string) => unknown, ignored: readonly string[]) =>
  headers.filter((h) => !ignored.includes(h) && !read(h));

describe("export headers are all importable", () => {
  it("properties: every header resolves through PROPERTY_COLUMN_MAP (incl. 'Size (Acres)')", () => {
    expect(PROPERTY_EXPORT_HEADERS).toContain("Size (Acres)");
    expect(resolveImportHeader(PROPERTY_COLUMN_MAP, "Size (Acres)")).toBe("sizeAcres");
    expect(unreadable(PROPERTY_EXPORT_HEADERS, (h) => resolveImportHeader(PROPERTY_COLUMN_MAP, h), EXPORT_ONLY_HEADERS.properties)).toEqual([]);
  });

  it("leads: every header is read by the lead importer (map or parcel-fact classifier)", () => {
    const read = (h: string) => resolveImportHeader(LEAD_COLUMN_MAP, h) ?? classifyParcelFactHeader(h);
    expect(unreadable(LEAD_EXPORT_HEADERS, read, EXPORT_ONLY_HEADERS.leads)).toEqual([]);
  });

  it("leads: the exporter covers every parcel fact the importer reads", () => {
    const facts = new Set(LEAD_EXPORT_HEADERS.map((h) => classifyParcelFactHeader(h)).filter(Boolean));
    for (const f of ["acreage", "assessedValue", "estimatedValue", "taxDelinquent", "taxDelinquentAmount", "taxDelinquentYears"]) {
      expect(facts.has(f as never), f).toBe(true);
    }
    for (const f of ["county", "apn"]) {
      expect(LEAD_EXPORT_HEADERS.some((h) => resolveImportHeader(LEAD_COLUMN_MAP, h) === f), f).toBe(true);
    }
  });

  it("every importable lead field in the column map has an exported header", () => {
    const exported = new Set(LEAD_EXPORT_HEADERS.map((h) => resolveImportHeader(LEAD_COLUMN_MAP, h)).filter(Boolean));
    // assignedTo is a team member id on this side; DNC is exported as 'Do Not Contact'.
    for (const field of new Set(Object.values(LEAD_COLUMN_MAP))) {
      if (field === "assignedTo") continue;
      expect(exported.has(field), `lead field ${field} has no exported column`).toBe(true);
    }
  });

  it("deals: every header resolves through DEAL_COLUMN_MAP", () => {
    expect(unreadable(DEAL_EXPORT_HEADERS, (h) => resolveImportHeader(DEAL_COLUMN_MAP, h), EXPORT_ONLY_HEADERS.deals)).toEqual([]);
  });

  it("originated notes: every header resolves through NOTE_COLUMN_MAP", () => {
    expect(unreadable(NOTE_EXPORT_HEADERS, (h) => resolveImportHeader(NOTE_COLUMN_MAP, h), EXPORT_ONLY_HEADERS.notes)).toEqual([]);
    expect(resolveImportHeader(NOTE_COLUMN_MAP, "Start Date")).toBe("startDate");
    expect(resolveImportHeader(NOTE_COLUMN_MAP, "First Payment Date")).toBe("firstPaymentDate");
  });

  it("acquired notes: the note-tape importer maps EVERY exported header to its own field", () => {
    const { mapping, unmatchedHeaders } = suggestNoteTapeMapping(ACQUIRED_NOTE_EXPORT_HEADERS);
    expect(unmatchedHeaders).toEqual([]);
    ACQUIRED_NOTE_EXPORT_FIELDS.forEach((key, i) => expect(mapping[key], key).toBe(i));
  });

  it("acquired notes: the export carries every required tape field and every tape field the book can hold", () => {
    for (const k of REQUIRED_NOTE_TAPE_FIELDS) expect(ACQUIRED_NOTE_EXPORT_FIELDS, k).toContain(k);
    expect(NOTE_TAPE_FIELDS.map((f) => f.key).filter((k) => !ACQUIRED_NOTE_EXPORT_FIELDS.includes(k))).toEqual([]);
  });

  it("the guard bites: a renamed header is caught", () => {
    expect(unreadable(["Size (Hectares)"], (h) => resolveImportHeader(PROPERTY_COLUMN_MAP, h), [])).toEqual(["Size (Hectares)"]);
  });
});
