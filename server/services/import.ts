import { z } from "zod";
import { insertLeadSchema, insertPropertySchema } from "@shared/schema";
import { storage } from "../storage";

export interface ImportResult {
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors: Array<{
    row: number;
    data: Record<string, string>;
    error: string;
  }>;
}

export function parseCSV(csvString: string): Array<Record<string, string>> {
  const lines = csvString.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  const headers = parseCSVLine(lines[0]);
  const data: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row: Record<string, string> = {};

    headers.forEach((header, idx) => {
      row[header.trim()] = values[idx]?.trim() || "";
    });

    data.push(row);
  }

  return data;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

const LEAD_COLUMN_MAP: Record<string, string> = {
  type: "type",
  firstName: "firstName",
  first_name: "firstName",
  "first name": "firstName",
  lastName: "lastName",
  last_name: "lastName",
  "last name": "lastName",
  email: "email",
  phone: "phone",
  address: "address",
  city: "city",
  state: "state",
  zip: "zip",
  status: "status",
  source: "source",
  notes: "notes",
};

const PROPERTY_COLUMN_MAP: Record<string, string> = {
  apn: "apn",
  APN: "apn",
  "parcel number": "apn",
  parcelNumber: "apn",
  legalDescription: "legalDescription",
  legal_description: "legalDescription",
  "legal description": "legalDescription",
  county: "county",
  state: "state",
  address: "address",
  city: "city",
  zip: "zip",
  subdivision: "subdivision",
  lotNumber: "lotNumber",
  lot_number: "lotNumber",
  "lot number": "lotNumber",
  sizeAcres: "sizeAcres",
  size_acres: "sizeAcres",
  "size acres": "sizeAcres",
  size: "sizeAcres",
  acres: "sizeAcres",
  zoning: "zoning",
  terrain: "terrain",
  roadAccess: "roadAccess",
  road_access: "roadAccess",
  "road access": "roadAccess",
  status: "status",
  assessedValue: "assessedValue",
  assessed_value: "assessedValue",
  "assessed value": "assessedValue",
  marketValue: "marketValue",
  market_value: "marketValue",
  "market value": "marketValue",
  purchasePrice: "purchasePrice",
  purchase_price: "purchasePrice",
  "purchase price": "purchasePrice",
  listPrice: "listPrice",
  list_price: "listPrice",
  "list price": "listPrice",
  description: "description",
  latitude: "latitude",
  lat: "latitude",
  longitude: "longitude",
  lng: "longitude",
  lon: "longitude",
};

function normalizeRow<T extends Record<string, string>>(
  row: Record<string, string>,
  columnMap: Record<string, string>
): T {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = columnMap[key.toLowerCase()] || columnMap[key] || key;
    normalized[normalizedKey] = value;
  }

  return normalized as T;
}

const leadImportSchema = insertLeadSchema.omit({ organizationId: true }).extend({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
});

const propertyImportSchema = insertPropertySchema.omit({ organizationId: true }).extend({
  apn: z.string().min(1, "APN is required"),
  county: z.string().min(1, "County is required"),
  state: z.string().min(1, "State is required"),
  sizeAcres: z.string().min(1, "Size is required").or(z.number()),
});

export async function importLeads(
  csvData: Array<Record<string, string>>,
  organizationId: number
): Promise<ImportResult> {
  const result: ImportResult = {
    totalRows: csvData.length,
    successCount: 0,
    errorCount: 0,
    errors: [],
  };

  for (let i = 0; i < csvData.length; i++) {
    const rawRow = csvData[i];
    const row = normalizeRow<Record<string, string>>(rawRow, LEAD_COLUMN_MAP);

    try {
      const parseResult = leadImportSchema.safeParse({
        type: row.type || "seller",
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email || null,
        phone: row.phone || null,
        address: row.address || null,
        city: row.city || null,
        state: row.state || null,
        zip: row.zip || null,
        status: row.status || "new",
        source: row.source || "import",
        notes: row.notes || null,
      });

      if (!parseResult.success) {
        const errorMessages = parseResult.error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        throw new Error(errorMessages);
      }

      await storage.createLead({
        ...parseResult.data,
        organizationId,
      });

      result.successCount++;
    } catch (error) {
      result.errorCount++;
      result.errors.push({
        row: i + 2,
        data: rawRow,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

export async function importProperties(
  csvData: Array<Record<string, string>>,
  organizationId: number
): Promise<ImportResult> {
  const result: ImportResult = {
    totalRows: csvData.length,
    successCount: 0,
    errorCount: 0,
    errors: [],
  };

  for (let i = 0; i < csvData.length; i++) {
    const rawRow = csvData[i];
    const row = normalizeRow<Record<string, string>>(rawRow, PROPERTY_COLUMN_MAP);

    try {
      const parseResult = propertyImportSchema.safeParse({
        apn: row.apn,
        legalDescription: row.legalDescription || null,
        county: row.county,
        state: row.state,
        address: row.address || null,
        city: row.city || null,
        zip: row.zip || null,
        subdivision: row.subdivision || null,
        lotNumber: row.lotNumber || null,
        sizeAcres: row.sizeAcres,
        zoning: row.zoning || null,
        terrain: row.terrain || null,
        roadAccess: row.roadAccess || null,
        status: row.status || "prospect",
        assessedValue: row.assessedValue || null,
        marketValue: row.marketValue || null,
        purchasePrice: row.purchasePrice || null,
        listPrice: row.listPrice || null,
        description: row.description || null,
        latitude: row.latitude || null,
        longitude: row.longitude || null,
      });

      if (!parseResult.success) {
        const errorMessages = parseResult.error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        throw new Error(errorMessages);
      }

      await storage.createProperty({
        ...parseResult.data,
        organizationId,
      });

      result.successCount++;
    } catch (error) {
      result.errorCount++;
      result.errors.push({
        row: i + 2,
        data: rawRow,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

export function getExpectedLeadColumns(): string[] {
  return ["firstName", "lastName", "email", "phone", "address", "city", "state", "zip", "type", "status", "source", "notes"];
}

export function getExpectedPropertyColumns(): string[] {
  return ["apn", "county", "state", "sizeAcres", "address", "city", "zip", "subdivision", "lotNumber", "zoning", "terrain", "roadAccess", "status", "assessedValue", "marketValue", "description", "latitude", "longitude"];
}
