import { z } from "zod";
import { insertLeadSchema, insertPropertySchema, insertDealSchema } from "@shared/schema";
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

export interface ImportPreview {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: Array<{
    rowNumber: number;
    data: Record<string, string>;
    valid: boolean;
    errors: string[];
  }>;
  columns: string[];
}

export interface ExportFilters {
  status?: string;
  startDate?: string;
  endDate?: string;
  type?: string;
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

const DEAL_COLUMN_MAP: Record<string, string> = {
  propertyId: "propertyId",
  property_id: "propertyId",
  "property id": "propertyId",
  type: "type",
  status: "status",
  offerAmount: "offerAmount",
  offer_amount: "offerAmount",
  "offer amount": "offerAmount",
  counterAmount: "counterAmount",
  counter_amount: "counterAmount",
  "counter amount": "counterAmount",
  acceptedAmount: "acceptedAmount",
  accepted_amount: "acceptedAmount",
  "accepted amount": "acceptedAmount",
  closingCosts: "closingCosts",
  closing_costs: "closingCosts",
  "closing costs": "closingCosts",
  titleCompany: "titleCompany",
  title_company: "titleCompany",
  "title company": "titleCompany",
  escrowNumber: "escrowNumber",
  escrow_number: "escrowNumber",
  "escrow number": "escrowNumber",
  notes: "notes",
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

const dealImportSchema = insertDealSchema.omit({ organizationId: true }).extend({
  propertyId: z.number().or(z.string().transform((v) => parseInt(v, 10))),
  type: z.string().min(1, "Type is required"),
});

export function previewImport(
  csvData: Array<Record<string, string>>,
  entityType: "leads" | "properties" | "deals"
): ImportPreview {
  const columnMap =
    entityType === "leads"
      ? LEAD_COLUMN_MAP
      : entityType === "properties"
      ? PROPERTY_COLUMN_MAP
      : DEAL_COLUMN_MAP;

  const schema =
    entityType === "leads"
      ? leadImportSchema
      : entityType === "properties"
      ? propertyImportSchema
      : dealImportSchema;

  const columns = csvData.length > 0 ? Object.keys(csvData[0]) : [];
  let validRows = 0;
  let invalidRows = 0;

  const rows = csvData.slice(0, 100).map((rawRow, i) => {
    const row = normalizeRow<Record<string, string>>(rawRow, columnMap);
    const parseResult = validateRow(row, entityType);

    if (parseResult.valid) {
      validRows++;
    } else {
      invalidRows++;
    }

    return {
      rowNumber: i + 2,
      data: rawRow,
      valid: parseResult.valid,
      errors: parseResult.errors,
    };
  });

  return {
    totalRows: csvData.length,
    validRows,
    invalidRows,
    rows,
    columns,
  };
}

function validateRow(
  row: Record<string, string>,
  entityType: "leads" | "properties" | "deals"
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (entityType === "leads") {
    if (!row.firstName) errors.push("First name is required");
    if (!row.lastName) errors.push("Last name is required");
  } else if (entityType === "properties") {
    if (!row.apn) errors.push("APN is required");
    if (!row.county) errors.push("County is required");
    if (!row.state) errors.push("State is required");
    if (!row.sizeAcres) errors.push("Size (acres) is required");
  } else if (entityType === "deals") {
    if (!row.propertyId) errors.push("Property ID is required");
    if (!row.type) errors.push("Type is required");
  }

  return { valid: errors.length === 0, errors };
}

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
        sizeAcres: String(parseResult.data.sizeAcres),
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

export async function importDeals(
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
    const row = normalizeRow<Record<string, string>>(rawRow, DEAL_COLUMN_MAP);

    try {
      const propertyId = parseInt(row.propertyId, 10);
      if (isNaN(propertyId)) {
        throw new Error("Invalid property ID");
      }

      const property = await storage.getProperty(organizationId, propertyId);
      if (!property) {
        throw new Error("Property not found or doesn't belong to this organization");
      }

      await storage.createDeal({
        organizationId,
        propertyId,
        type: row.type || "acquisition",
        status: row.status || "negotiating",
        offerAmount: row.offerAmount || null,
        counterAmount: row.counterAmount || null,
        acceptedAmount: row.acceptedAmount || null,
        closingCosts: row.closingCosts || null,
        titleCompany: row.titleCompany || null,
        escrowNumber: row.escrowNumber || null,
        notes: row.notes || null,
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

function escapeCSV(value: any): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
}

function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const num = Number(value);
  if (isNaN(num)) return "";
  return num.toFixed(2);
}

export async function exportLeadsToCSV(
  organizationId: number,
  filters?: ExportFilters
): Promise<string> {
  let leads = await storage.getLeads(organizationId);

  if (filters) {
    if (filters.status) {
      leads = leads.filter((l) => l.status === filters.status);
    }
    if (filters.type) {
      leads = leads.filter((l) => l.type === filters.type);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      leads = leads.filter((l) => l.createdAt && new Date(l.createdAt) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      leads = leads.filter((l) => l.createdAt && new Date(l.createdAt) <= end);
    }
  }

  const headers = [
    "ID",
    "Type",
    "First Name",
    "Last Name",
    "Email",
    "Phone",
    "Address",
    "City",
    "State",
    "Zip",
    "Status",
    "Source",
    "Notes",
    "Tags",
    "Score",
    "Last Contacted At",
    "Created At",
    "Updated At",
  ];

  const rows = leads.map((lead) =>
    [
      escapeCSV(lead.id),
      escapeCSV(lead.type),
      escapeCSV(lead.firstName),
      escapeCSV(lead.lastName),
      escapeCSV(lead.email),
      escapeCSV(lead.phone),
      escapeCSV(lead.address),
      escapeCSV(lead.city),
      escapeCSV(lead.state),
      escapeCSV(lead.zip),
      escapeCSV(lead.status),
      escapeCSV(lead.source),
      escapeCSV(lead.notes),
      escapeCSV(lead.tags ? lead.tags.join("; ") : ""),
      escapeCSV(lead.score),
      escapeCSV(formatDate(lead.lastContactedAt)),
      escapeCSV(formatDate(lead.createdAt)),
      escapeCSV(formatDate(lead.updatedAt)),
    ].join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

export async function exportPropertiesToCSV(
  organizationId: number,
  filters?: ExportFilters
): Promise<string> {
  let properties = await storage.getProperties(organizationId);

  if (filters) {
    if (filters.status) {
      properties = properties.filter((p) => p.status === filters.status);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      properties = properties.filter((p) => p.createdAt && new Date(p.createdAt) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      properties = properties.filter((p) => p.createdAt && new Date(p.createdAt) <= end);
    }
  }

  const headers = [
    "ID",
    "APN",
    "Legal Description",
    "County",
    "State",
    "Address",
    "City",
    "Zip",
    "Subdivision",
    "Lot Number",
    "Size (Acres)",
    "Zoning",
    "Terrain",
    "Road Access",
    "Status",
    "Assessed Value",
    "Market Value",
    "Purchase Price",
    "Purchase Date",
    "List Price",
    "Sold Price",
    "Sold Date",
    "Latitude",
    "Longitude",
    "Description",
    "Created At",
    "Updated At",
  ];

  const rows = properties.map((property) =>
    [
      escapeCSV(property.id),
      escapeCSV(property.apn),
      escapeCSV(property.legalDescription),
      escapeCSV(property.county),
      escapeCSV(property.state),
      escapeCSV(property.address),
      escapeCSV(property.city),
      escapeCSV(property.zip),
      escapeCSV(property.subdivision),
      escapeCSV(property.lotNumber),
      escapeCSV(formatCurrency(property.sizeAcres)),
      escapeCSV(property.zoning),
      escapeCSV(property.terrain),
      escapeCSV(property.roadAccess),
      escapeCSV(property.status),
      escapeCSV(formatCurrency(property.assessedValue)),
      escapeCSV(formatCurrency(property.marketValue)),
      escapeCSV(formatCurrency(property.purchasePrice)),
      escapeCSV(formatDate(property.purchaseDate)),
      escapeCSV(formatCurrency(property.listPrice)),
      escapeCSV(formatCurrency(property.soldPrice)),
      escapeCSV(formatDate(property.soldDate)),
      escapeCSV(property.latitude),
      escapeCSV(property.longitude),
      escapeCSV(property.description),
      escapeCSV(formatDate(property.createdAt)),
      escapeCSV(formatDate(property.updatedAt)),
    ].join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

export async function exportDealsToCSV(
  organizationId: number,
  filters?: ExportFilters
): Promise<string> {
  let deals = await storage.getDeals(organizationId);

  if (filters) {
    if (filters.status) {
      deals = deals.filter((d) => d.status === filters.status);
    }
    if (filters.type) {
      deals = deals.filter((d) => d.type === filters.type);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      deals = deals.filter((d) => d.createdAt && new Date(d.createdAt) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      deals = deals.filter((d) => d.createdAt && new Date(d.createdAt) <= end);
    }
  }

  const headers = [
    "ID",
    "Property ID",
    "Type",
    "Status",
    "Offer Amount",
    "Offer Date",
    "Counter Amount",
    "Accepted Amount",
    "Closing Date",
    "Closing Costs",
    "Title Company",
    "Escrow Number",
    "Notes",
    "Created At",
    "Updated At",
  ];

  const rows = deals.map((deal) =>
    [
      escapeCSV(deal.id),
      escapeCSV(deal.propertyId),
      escapeCSV(deal.type),
      escapeCSV(deal.status),
      escapeCSV(formatCurrency(deal.offerAmount)),
      escapeCSV(formatDate(deal.offerDate)),
      escapeCSV(formatCurrency(deal.counterAmount)),
      escapeCSV(formatCurrency(deal.acceptedAmount)),
      escapeCSV(formatDate(deal.closingDate)),
      escapeCSV(formatCurrency(deal.closingCosts)),
      escapeCSV(deal.titleCompany),
      escapeCSV(deal.escrowNumber),
      escapeCSV(deal.notes),
      escapeCSV(formatDate(deal.createdAt)),
      escapeCSV(formatDate(deal.updatedAt)),
    ].join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

export async function exportNotesToCSV(
  organizationId: number,
  filters?: ExportFilters
): Promise<string> {
  let notes = await storage.getNotes(organizationId);

  if (filters) {
    if (filters.status) {
      notes = notes.filter((n) => n.status === filters.status);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      notes = notes.filter((n) => n.createdAt && new Date(n.createdAt) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      notes = notes.filter((n) => n.createdAt && new Date(n.createdAt) <= end);
    }
  }

  const headers = [
    "ID",
    "Property ID",
    "Borrower ID",
    "Original Principal",
    "Current Balance",
    "Interest Rate",
    "Term (Months)",
    "Monthly Payment",
    "Service Fee",
    "Late Fee",
    "Grace Period (Days)",
    "Start Date",
    "First Payment Date",
    "Next Payment Date",
    "Maturity Date",
    "Status",
    "Down Payment",
    "Down Payment Received",
    "Payment Method",
    "Auto Pay Enabled",
    "Notes",
    "Created At",
    "Updated At",
  ];

  const rows = notes.map((note) =>
    [
      escapeCSV(note.id),
      escapeCSV(note.propertyId),
      escapeCSV(note.borrowerId),
      escapeCSV(formatCurrency(note.originalPrincipal)),
      escapeCSV(formatCurrency(note.currentBalance)),
      escapeCSV(formatCurrency(note.interestRate)),
      escapeCSV(note.termMonths),
      escapeCSV(formatCurrency(note.monthlyPayment)),
      escapeCSV(formatCurrency(note.serviceFee)),
      escapeCSV(formatCurrency(note.lateFee)),
      escapeCSV(note.gracePeriodDays),
      escapeCSV(formatDate(note.startDate)),
      escapeCSV(formatDate(note.firstPaymentDate)),
      escapeCSV(formatDate(note.nextPaymentDate)),
      escapeCSV(formatDate(note.maturityDate)),
      escapeCSV(note.status),
      escapeCSV(formatCurrency(note.downPayment)),
      escapeCSV(note.downPaymentReceived ? "Yes" : "No"),
      escapeCSV(note.paymentMethod),
      escapeCSV(note.autoPayEnabled ? "Yes" : "No"),
      escapeCSV(note.notes),
      escapeCSV(formatDate(note.createdAt)),
      escapeCSV(formatDate(note.updatedAt)),
    ].join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

export async function getLeadsData(
  organizationId: number,
  filters?: ExportFilters
): Promise<any[]> {
  let leads = await storage.getLeads(organizationId);

  if (filters) {
    if (filters.status) {
      leads = leads.filter((l) => l.status === filters.status);
    }
    if (filters.type) {
      leads = leads.filter((l) => l.type === filters.type);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      leads = leads.filter((l) => l.createdAt && new Date(l.createdAt) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      leads = leads.filter((l) => l.createdAt && new Date(l.createdAt) <= end);
    }
  }

  return leads;
}

export async function getPropertiesData(
  organizationId: number,
  filters?: ExportFilters
): Promise<any[]> {
  let properties = await storage.getProperties(organizationId);

  if (filters) {
    if (filters.status) {
      properties = properties.filter((p) => p.status === filters.status);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      properties = properties.filter((p) => p.createdAt && new Date(p.createdAt) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      properties = properties.filter((p) => p.createdAt && new Date(p.createdAt) <= end);
    }
  }

  return properties;
}

export async function getDealsData(
  organizationId: number,
  filters?: ExportFilters
): Promise<any[]> {
  let deals = await storage.getDeals(organizationId);

  if (filters) {
    if (filters.status) {
      deals = deals.filter((d) => d.status === filters.status);
    }
    if (filters.type) {
      deals = deals.filter((d) => d.type === filters.type);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      deals = deals.filter((d) => d.createdAt && new Date(d.createdAt) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      deals = deals.filter((d) => d.createdAt && new Date(d.createdAt) <= end);
    }
  }

  return deals;
}

export async function getNotesData(
  organizationId: number,
  filters?: ExportFilters
): Promise<any[]> {
  let notes = await storage.getNotes(organizationId);

  if (filters) {
    if (filters.status) {
      notes = notes.filter((n) => n.status === filters.status);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      notes = notes.filter((n) => n.createdAt && new Date(n.createdAt) >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      notes = notes.filter((n) => n.createdAt && new Date(n.createdAt) <= end);
    }
  }

  return notes;
}

export async function createBackupZip(organizationId: number): Promise<{
  files: Array<{ name: string; content: string }>;
  organization: any;
}> {
  const org = await storage.getOrganization(organizationId);
  
  const [leadsCSV, propertiesCSV, dealsCSV, notesCSV] = await Promise.all([
    exportLeadsToCSV(organizationId),
    exportPropertiesToCSV(organizationId),
    exportDealsToCSV(organizationId),
    exportNotesToCSV(organizationId),
  ]);

  const metadata = {
    organizationId,
    organizationName: org?.name,
    exportedAt: new Date().toISOString(),
    version: "1.0",
    counts: {
      leads: leadsCSV.split("\n").length - 1,
      properties: propertiesCSV.split("\n").length - 1,
      deals: dealsCSV.split("\n").length - 1,
      notes: notesCSV.split("\n").length - 1,
    },
  };

  return {
    files: [
      { name: "leads.csv", content: leadsCSV },
      { name: "properties.csv", content: propertiesCSV },
      { name: "deals.csv", content: dealsCSV },
      { name: "notes.csv", content: notesCSV },
      { name: "metadata.json", content: JSON.stringify(metadata, null, 2) },
    ],
    organization: org,
  };
}

// ============================================================
// NOTES (seller-financed) IMPORT — GeekPay CSV compatible
// ============================================================

// Maps GeekPay column headers AND generic variants to AcreOS note fields.
// A user-provided fieldMap (from the UI's field-mapping step) takes precedence.
export const NOTE_COLUMN_MAP: Record<string, string> = {
  // GeekPay-style headers
  "Borrower First Name": "borrowerFirstName",
  "borrower first name": "borrowerFirstName",
  borrowerFirstName: "borrowerFirstName",
  borrower_first_name: "borrowerFirstName",
  firstName: "borrowerFirstName",
  first_name: "borrowerFirstName",
  "first name": "borrowerFirstName",

  "Borrower Last Name": "borrowerLastName",
  "borrower last name": "borrowerLastName",
  borrowerLastName: "borrowerLastName",
  borrower_last_name: "borrowerLastName",
  lastName: "borrowerLastName",
  last_name: "borrowerLastName",
  "last name": "borrowerLastName",

  "Borrower Email": "borrowerEmail",
  "borrower email": "borrowerEmail",
  borrowerEmail: "borrowerEmail",
  borrower_email: "borrowerEmail",
  email: "borrowerEmail",

  "Borrower Phone": "borrowerPhone",
  "borrower phone": "borrowerPhone",
  borrowerPhone: "borrowerPhone",
  phone: "borrowerPhone",

  "Note Amount": "originalPrincipal",
  "note amount": "originalPrincipal",
  "Original Principal": "originalPrincipal",
  "original principal": "originalPrincipal",
  originalPrincipal: "originalPrincipal",
  original_principal: "originalPrincipal",
  principal: "originalPrincipal",
  amount: "originalPrincipal",

  "Current Balance": "currentBalance",
  "current balance": "currentBalance",
  currentBalance: "currentBalance",
  current_balance: "currentBalance",
  balance: "currentBalance",

  "Interest Rate": "interestRate",
  "interest rate": "interestRate",
  interestRate: "interestRate",
  interest_rate: "interestRate",
  rate: "interestRate",

  "Term (Months)": "termMonths",
  "term (months)": "termMonths",
  "Term Months": "termMonths",
  "term months": "termMonths",
  termMonths: "termMonths",
  term_months: "termMonths",
  term: "termMonths",

  "Monthly Payment": "monthlyPayment",
  "monthly payment": "monthlyPayment",
  monthlyPayment: "monthlyPayment",
  monthly_payment: "monthlyPayment",
  payment: "monthlyPayment",

  "Payment Day": "paymentDayOfMonth",
  "payment day": "paymentDayOfMonth",
  paymentDayOfMonth: "paymentDayOfMonth",
  payment_day_of_month: "paymentDayOfMonth",

  "Service Fee": "serviceFee",
  "service fee": "serviceFee",
  serviceFee: "serviceFee",
  service_fee: "serviceFee",

  "Late Fee": "lateFeeAmount",
  "late fee": "lateFeeAmount",
  lateFeeAmount: "lateFeeAmount",
  late_fee: "lateFeeAmount",

  "Grace Period": "gracePeriodDays",
  "grace period": "gracePeriodDays",
  gracePeriodDays: "gracePeriodDays",
  grace_period_days: "gracePeriodDays",

  Status: "status",
  status: "status",

  "Property Address": "propertyAddress",
  "property address": "propertyAddress",
  propertyAddress: "propertyAddress",
  property_address: "propertyAddress",
  address: "propertyAddress",

  Notes: "internalNotes",
  notes: "internalNotes",
  comment: "internalNotes",
  comments: "internalNotes",
};

// Note status mapping: normalize GeekPay status strings to AcreOS enum values
function normalizeNoteStatus(raw: string): string {
  const lower = (raw || "").toLowerCase().trim();
  if (lower === "active" || lower === "current") return "active";
  if (lower === "paid off" || lower === "paid_off" || lower === "closed") return "paid_off";
  if (lower === "default" || lower === "defaulted") return "defaulted";
  if (lower === "late") return "late";
  if (lower === "suspended" || lower === "paused") return "suspended";
  return "active"; // default
}

export interface NoteImportFieldMap {
  [csvColumn: string]: string; // csvColumn -> acreos field name
}

export async function importNotesFromCSV(
  csvData: Array<Record<string, string>>,
  organizationId: number,
  userFieldMap?: NoteImportFieldMap
): Promise<ImportResult> {
  const result: ImportResult = {
    totalRows: csvData.length,
    successCount: 0,
    errorCount: 0,
    errors: [],
  };

  for (let i = 0; i < csvData.length; i++) {
    const rawRow = csvData[i];

    // Apply user's custom field map first, then fall back to the built-in NOTE_COLUMN_MAP
    const effectiveMap: Record<string, string> = { ...NOTE_COLUMN_MAP };
    if (userFieldMap) {
      for (const [csvCol, acreosField] of Object.entries(userFieldMap)) {
        if (acreosField) effectiveMap[csvCol] = acreosField;
      }
    }

    const row = normalizeRow<Record<string, string>>(rawRow, effectiveMap);

    try {
      // Require at minimum a borrower name and a principal amount
      const firstName = row.borrowerFirstName?.trim();
      const lastName = row.borrowerLastName?.trim();
      const principalRaw = row.originalPrincipal?.replace(/[$,\s]/g, "");

      if (!firstName && !lastName) {
        throw new Error("Borrower name is required (first name or last name)");
      }
      if (!principalRaw || isNaN(parseFloat(principalRaw))) {
        throw new Error("Original principal amount is required and must be a number");
      }

      const originalPrincipal = parseFloat(principalRaw);
      const currentBalance = row.currentBalance
        ? parseFloat(row.currentBalance.replace(/[$,\s]/g, ""))
        : originalPrincipal;
      const interestRate = row.interestRate
        ? parseFloat(row.interestRate.replace(/[%\s]/g, ""))
        : 0;
      const termMonths = row.termMonths ? parseInt(row.termMonths, 10) : 120;
      const monthlyPayment = row.monthlyPayment
        ? parseFloat(row.monthlyPayment.replace(/[$,\s]/g, ""))
        : null;
      const paymentDayOfMonth = row.paymentDayOfMonth
        ? parseInt(row.paymentDayOfMonth, 10)
        : 1;
      const serviceFee = row.serviceFee
        ? parseFloat(row.serviceFee.replace(/[$,\s]/g, ""))
        : "0";
      const lateFeeAmount = row.lateFeeAmount
        ? parseFloat(row.lateFeeAmount.replace(/[$,\s]/g, ""))
        : "0";
      const gracePeriodDays = row.gracePeriodDays
        ? parseInt(row.gracePeriodDays, 10)
        : 10;

      // Create a borrower lead if none exists with this email/name combo
      let borrowerId: number | null = null;
      const borrowerEmail = row.borrowerEmail?.trim() || null;

      if (borrowerEmail) {
        const existingLeads = await storage.getLeads(organizationId);
        const match = existingLeads.find(
          (l) => l.email?.toLowerCase() === borrowerEmail.toLowerCase()
        );
        if (match) {
          borrowerId = match.id;
        }
      }

      if (!borrowerId) {
        const newLead = await storage.createLead({
          organizationId,
          type: "buyer",
          firstName: firstName || "",
          lastName: lastName || "",
          email: borrowerEmail,
          phone: row.borrowerPhone?.trim() || null,
          status: "active",
          source: "import",
        });
        borrowerId = newLead.id;
      }

      await storage.createNote({
        organizationId,
        borrowerId,
        originalPrincipal: String(originalPrincipal),
        currentBalance: String(currentBalance),
        interestRate: String(interestRate),
        termMonths,
        monthlyPayment: monthlyPayment ? String(monthlyPayment) : null,
        paymentDayOfMonth,
        serviceFee: String(serviceFee),
        lateFeeAmount: String(lateFeeAmount),
        gracePeriodDays,
        status: normalizeNoteStatus(row.status || ""),
        paymentMethod: "manual",
        autoPayEnabled: false,
        internalNotes: row.internalNotes || null,
      } as any);

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

export function getExpectedColumns(entityType: "leads" | "properties" | "deals"): string[] {
  if (entityType === "leads") {
    return [
      "firstName",
      "lastName",
      "email",
      "phone",
      "address",
      "city",
      "state",
      "zip",
      "type",
      "status",
      "source",
      "notes",
    ];
  } else if (entityType === "properties") {
    return [
      "apn",
      "county",
      "state",
      "sizeAcres",
      "address",
      "city",
      "zip",
      "subdivision",
      "lotNumber",
      "zoning",
      "terrain",
      "roadAccess",
      "status",
      "assessedValue",
      "marketValue",
      "description",
      "latitude",
      "longitude",
    ];
  } else {
    return [
      "propertyId",
      "type",
      "status",
      "offerAmount",
      "counterAmount",
      "acceptedAmount",
      "closingCosts",
      "titleCompany",
      "escrowNumber",
      "notes",
    ];
  }
}
