import { z } from "zod";
import { insertLeadSchema, insertPropertySchema, leads, properties } from "@shared/schema";
import { storage, db } from "../storage";

export interface ImportValidationError {
  row: number;
  field: string;
  value: string;
  expectedType: string;
  actualType: string;
  message: string;
}

export interface ImportRejection {
  row: number;
  data: Record<string, string>;
  errors: ImportValidationError[];
}

export interface ImportResult {
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors: Array<{
    row: number;
    data: Record<string, string>;
    error: string;
  }>;
  rejections: ImportRejection[];
  validatedSchema: boolean;
  transactionUsed: boolean;
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
  tcpaConsent: "tcpaConsent",
  tcpa_consent: "tcpaConsent",
  "tcpa consent": "tcpaConsent",
  doNotContact: "doNotContact",
  do_not_contact: "doNotContact",
  "do not contact": "doNotContact",
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

function detectValueType(value: string): string {
  if (value === "" || value === null || value === undefined) return "empty";
  if (value.toLowerCase() === "true" || value.toLowerCase() === "false") return "boolean";
  if (!isNaN(Number(value)) && value.trim() !== "") return "number";
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return "date";
  return "string";
}

interface CoercionResult {
  success: boolean;
  value: any;
  error?: string;
}

function coerceValue(value: string, expectedType: string): CoercionResult {
  if (value === "" || value === null || value === undefined) {
    return { success: true, value: null };
  }
  
  switch (expectedType) {
    case "boolean":
      if (value.toLowerCase() === "true" || value === "1" || value.toLowerCase() === "yes") {
        return { success: true, value: true };
      }
      if (value.toLowerCase() === "false" || value === "0" || value.toLowerCase() === "no") {
        return { success: true, value: false };
      }
      return { success: false, value: null, error: `Expected boolean (true/false/yes/no/1/0) but got '${value}'` };
    case "number":
      const num = Number(value);
      if (isNaN(num)) {
        return { success: false, value: null, error: `Expected number but got '${value}'` };
      }
      return { success: true, value: num };
    case "string":
      return { success: true, value: String(value) };
    default:
      return { success: true, value };
  }
}

function coerceValueStrict(value: string, expectedType: string, field: string, rowNum: number): { value: any; error?: ImportValidationError } {
  const result = coerceValue(value, expectedType);
  if (!result.success) {
    return {
      value: null,
      error: {
        row: rowNum,
        field,
        value,
        expectedType,
        actualType: detectValueType(value),
        message: result.error || `Failed to coerce '${value}' to ${expectedType}`,
      },
    };
  }
  return { value: result.value };
}

function validateSchemaBeforeImport(
  csvData: Array<Record<string, string>>,
  columnMap: Record<string, string>,
  entityType: "lead" | "property"
): { valid: boolean; errors: ImportValidationError[] } {
  const errors: ImportValidationError[] = [];
  
  const requiredFields = entityType === "lead" 
    ? ["firstName", "lastName"] 
    : ["apn", "county", "state", "sizeAcres"];

  const numericFields = entityType === "lead" 
    ? [] 
    : ["sizeAcres", "assessedValue", "marketValue", "purchasePrice", "listPrice", "latitude", "longitude"];
  
  const booleanFields = entityType === "lead" 
    ? ["tcpaConsent", "doNotContact"] 
    : [];

  for (let i = 0; i < csvData.length; i++) {
    const rawRow = csvData[i];
    const row = normalizeRow<Record<string, string>>(rawRow, columnMap);
    const rowNum = i + 2;

    for (const field of requiredFields) {
      if (!row[field] || row[field].trim() === "") {
        errors.push({
          row: rowNum,
          field,
          value: row[field] || "",
          expectedType: "string (required)",
          actualType: "empty",
          message: `Required field '${field}' is missing or empty`,
        });
      }
    }

    for (const field of numericFields) {
      const value = row[field];
      if (value && value.trim() !== "") {
        const actualType = detectValueType(value);
        if (actualType !== "number" && actualType !== "empty") {
          errors.push({
            row: rowNum,
            field,
            value,
            expectedType: "number",
            actualType,
            message: `Field '${field}' expected a number but got '${value}'`,
          });
        }
      }
    }

    for (const field of booleanFields) {
      const value = row[field];
      if (value && value.trim() !== "") {
        const lowered = value.toLowerCase();
        const validBooleans = ["true", "false", "1", "0", "yes", "no"];
        if (!validBooleans.includes(lowered)) {
          errors.push({
            row: rowNum,
            field,
            value,
            expectedType: "boolean",
            actualType: detectValueType(value),
            message: `Field '${field}' expected a boolean (true/false/yes/no/1/0) but got '${value}'`,
          });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

const leadImportSchema = insertLeadSchema.omit({ organizationId: true }).extend({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  tcpaConsent: z.boolean().optional().nullable(),
  doNotContact: z.boolean().optional().nullable(),
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
    rejections: [],
    validatedSchema: true,
    transactionUsed: true,
  };

  const schemaValidation = validateSchemaBeforeImport(csvData, LEAD_COLUMN_MAP, "lead");
  if (!schemaValidation.valid) {
    result.validatedSchema = false;
    
    const rejectionsByRow = new Map<number, ImportRejection>();
    for (const error of schemaValidation.errors) {
      if (!rejectionsByRow.has(error.row)) {
        rejectionsByRow.set(error.row, {
          row: error.row,
          data: csvData[error.row - 2] || {},
          errors: [],
        });
      }
      rejectionsByRow.get(error.row)!.errors.push(error);
    }
    
    result.rejections = Array.from(rejectionsByRow.values());
    result.errorCount = result.rejections.length;
    
    for (const rejection of result.rejections) {
      result.errors.push({
        row: rejection.row,
        data: rejection.data,
        error: rejection.errors.map(e => e.message).join("; "),
      });
    }
    
    return result;
  }

  const validRows: Array<{ index: number; rawRow: Record<string, string>; data: any }> = [];
  const invalidRows: Array<{ index: number; rawRow: Record<string, string>; error: string; validation: ImportValidationError[] }> = [];

  for (let i = 0; i < csvData.length; i++) {
    const rawRow = csvData[i];
    const row = normalizeRow<Record<string, string>>(rawRow, LEAD_COLUMN_MAP);
    const rowNum = i + 2;
    const coercionErrors: ImportValidationError[] = [];

    const tcpaConsentResult = coerceValueStrict(row.tcpaConsent || "", "boolean", "tcpaConsent", rowNum);
    if (tcpaConsentResult.error) coercionErrors.push(tcpaConsentResult.error);

    const doNotContactResult = coerceValueStrict(row.doNotContact || "", "boolean", "doNotContact", rowNum);
    if (doNotContactResult.error) coercionErrors.push(doNotContactResult.error);

    if (coercionErrors.length > 0) {
      invalidRows.push({
        index: i,
        rawRow,
        error: coercionErrors.map(e => e.message).join("; "),
        validation: coercionErrors,
      });
      continue;
    }

    const leadData = {
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
      tcpaConsent: tcpaConsentResult.value,
      doNotContact: doNotContactResult.value,
    };

    const parseResult = leadImportSchema.safeParse(leadData);

    if (!parseResult.success) {
      const errorMessages = parseResult.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
      
      const validationErrors: ImportValidationError[] = parseResult.error.errors.map(e => ({
        row: i + 2,
        field: e.path.join("."),
        value: String((leadData as any)[e.path[0]] || ""),
        expectedType: "valid value",
        actualType: detectValueType(String((leadData as any)[e.path[0]] || "")),
        message: e.message,
      }));

      invalidRows.push({
        index: i,
        rawRow,
        error: errorMessages,
        validation: validationErrors,
      });
    } else {
      validRows.push({
        index: i,
        rawRow,
        data: parseResult.data,
      });
    }
  }

  for (const invalid of invalidRows) {
    result.errorCount++;
    result.errors.push({
      row: invalid.index + 2,
      data: invalid.rawRow,
      error: invalid.error,
    });
    result.rejections.push({
      row: invalid.index + 2,
      data: invalid.rawRow,
      errors: invalid.validation,
    });
  }

  if (validRows.length === 0) {
    return result;
  }

  try {
    await db.transaction(async (tx) => {
      for (const valid of validRows) {
        await tx.insert(leads).values({
          ...valid.data,
          organizationId,
        });
        result.successCount++;
      }
    });
  } catch (error) {
    result.transactionUsed = true;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    for (const valid of validRows) {
      result.errorCount++;
      result.successCount = 0;
      result.errors.push({
        row: valid.index + 2,
        data: valid.rawRow,
        error: `Transaction failed: ${errorMessage}`,
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
    rejections: [],
    validatedSchema: true,
    transactionUsed: true,
  };

  const schemaValidation = validateSchemaBeforeImport(csvData, PROPERTY_COLUMN_MAP, "property");
  if (!schemaValidation.valid) {
    result.validatedSchema = false;
    
    const rejectionsByRow = new Map<number, ImportRejection>();
    for (const error of schemaValidation.errors) {
      if (!rejectionsByRow.has(error.row)) {
        rejectionsByRow.set(error.row, {
          row: error.row,
          data: csvData[error.row - 2] || {},
          errors: [],
        });
      }
      rejectionsByRow.get(error.row)!.errors.push(error);
    }
    
    result.rejections = Array.from(rejectionsByRow.values());
    result.errorCount = result.rejections.length;
    
    for (const rejection of result.rejections) {
      result.errors.push({
        row: rejection.row,
        data: rejection.data,
        error: rejection.errors.map(e => e.message).join("; "),
      });
    }
    
    return result;
  }

  const validRows: Array<{ index: number; rawRow: Record<string, string>; data: any }> = [];
  const invalidRows: Array<{ index: number; rawRow: Record<string, string>; error: string; validation: ImportValidationError[] }> = [];

  for (let i = 0; i < csvData.length; i++) {
    const rawRow = csvData[i];
    const row = normalizeRow<Record<string, string>>(rawRow, PROPERTY_COLUMN_MAP);
    const rowNum = i + 2;
    const coercionErrors: ImportValidationError[] = [];

    const sizeAcresResult = coerceValueStrict(row.sizeAcres || "", "number", "sizeAcres", rowNum);
    if (row.sizeAcres && row.sizeAcres.trim() !== "" && sizeAcresResult.error) {
      coercionErrors.push(sizeAcresResult.error);
    }

    const assessedValueResult = coerceValueStrict(row.assessedValue || "", "number", "assessedValue", rowNum);
    if (row.assessedValue && row.assessedValue.trim() !== "" && assessedValueResult.error) {
      coercionErrors.push(assessedValueResult.error);
    }

    const marketValueResult = coerceValueStrict(row.marketValue || "", "number", "marketValue", rowNum);
    if (row.marketValue && row.marketValue.trim() !== "" && marketValueResult.error) {
      coercionErrors.push(marketValueResult.error);
    }

    const purchasePriceResult = coerceValueStrict(row.purchasePrice || "", "number", "purchasePrice", rowNum);
    if (row.purchasePrice && row.purchasePrice.trim() !== "" && purchasePriceResult.error) {
      coercionErrors.push(purchasePriceResult.error);
    }

    const latitudeResult = coerceValueStrict(row.latitude || "", "number", "latitude", rowNum);
    if (row.latitude && row.latitude.trim() !== "" && latitudeResult.error) {
      coercionErrors.push(latitudeResult.error);
    }

    const longitudeResult = coerceValueStrict(row.longitude || "", "number", "longitude", rowNum);
    if (row.longitude && row.longitude.trim() !== "" && longitudeResult.error) {
      coercionErrors.push(longitudeResult.error);
    }

    if (coercionErrors.length > 0) {
      invalidRows.push({
        index: i,
        rawRow,
        error: coercionErrors.map(e => e.message).join("; "),
        validation: coercionErrors,
      });
      continue;
    }

    const propertyData = {
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
    };

    const parseResult = propertyImportSchema.safeParse(propertyData);

    if (!parseResult.success) {
      const errorMessages = parseResult.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
      
      const validationErrors: ImportValidationError[] = parseResult.error.errors.map(e => ({
        row: i + 2,
        field: e.path.join("."),
        value: String((propertyData as any)[e.path[0]] || ""),
        expectedType: "valid value",
        actualType: detectValueType(String((propertyData as any)[e.path[0]] || "")),
        message: e.message,
      }));

      invalidRows.push({
        index: i,
        rawRow,
        error: errorMessages,
        validation: validationErrors,
      });
    } else {
      validRows.push({
        index: i,
        rawRow,
        data: parseResult.data,
      });
    }
  }

  for (const invalid of invalidRows) {
    result.errorCount++;
    result.errors.push({
      row: invalid.index + 2,
      data: invalid.rawRow,
      error: invalid.error,
    });
    result.rejections.push({
      row: invalid.index + 2,
      data: invalid.rawRow,
      errors: invalid.validation,
    });
  }

  if (validRows.length === 0) {
    return result;
  }

  try {
    await db.transaction(async (tx) => {
      for (const valid of validRows) {
        await tx.insert(properties).values({
          ...valid.data,
          sizeAcres: String(valid.data.sizeAcres),
          organizationId,
        });
        result.successCount++;
      }
    });
  } catch (error) {
    result.transactionUsed = true;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    for (const valid of validRows) {
      result.errorCount++;
      result.successCount = 0;
      result.errors.push({
        row: valid.index + 2,
        data: valid.rawRow,
        error: `Transaction failed: ${errorMessage}`,
      });
    }
  }

  return result;
}

export function getExpectedLeadColumns(): string[] {
  return ["firstName", "lastName", "email", "phone", "address", "city", "state", "zip", "type", "status", "source", "notes", "tcpaConsent", "doNotContact"];
}

export function getExpectedPropertyColumns(): string[] {
  return ["apn", "county", "state", "sizeAcres", "address", "city", "zip", "subdivision", "lotNumber", "zoning", "terrain", "roadAccess", "status", "assessedValue", "marketValue", "description", "latitude", "longitude"];
}
