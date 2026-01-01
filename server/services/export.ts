import { storage } from "../storage";

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

export async function exportLeadsToCSV(organizationId: number): Promise<string> {
  const leads = await storage.getLeads(organizationId);
  
  const headers = [
    "ID", "Type", "First Name", "Last Name", "Email", "Phone",
    "Address", "City", "State", "Zip", "Status", "Source",
    "Notes", "Tags", "Last Contacted At", "Created At", "Updated At"
  ];
  
  const rows = leads.map(lead => [
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
    escapeCSV(formatDate(lead.lastContactedAt)),
    escapeCSV(formatDate(lead.createdAt)),
    escapeCSV(formatDate(lead.updatedAt))
  ].join(","));
  
  return [headers.join(","), ...rows].join("\n");
}

export async function exportPropertiesToCSV(organizationId: number): Promise<string> {
  const properties = await storage.getProperties(organizationId);
  
  const headers = [
    "ID", "APN", "Legal Description", "County", "State", "Address", "City", "Zip",
    "Subdivision", "Lot Number", "Size (Acres)", "Zoning", "Terrain", "Road Access",
    "Status", "Assessed Value", "Market Value", "Purchase Price", "Purchase Date",
    "List Price", "Sold Price", "Sold Date", "Latitude", "Longitude",
    "Description", "Created At", "Updated At"
  ];
  
  const rows = properties.map(property => [
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
    escapeCSV(formatDate(property.updatedAt))
  ].join(","));
  
  return [headers.join(","), ...rows].join("\n");
}

export async function exportNotesToCSV(organizationId: number): Promise<string> {
  const notes = await storage.getNotes(organizationId);
  
  const headers = [
    "ID", "Property ID", "Borrower ID", "Original Principal", "Current Balance",
    "Interest Rate", "Term (Months)", "Monthly Payment", "Service Fee", "Late Fee",
    "Grace Period (Days)", "Start Date", "First Payment Date", "Next Payment Date",
    "Maturity Date", "Status", "Down Payment", "Down Payment Received",
    "Payment Method", "Auto Pay Enabled", "Notes", "Created At", "Updated At"
  ];
  
  const rows = notes.map(note => [
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
    escapeCSV(formatDate(note.updatedAt))
  ].join(","));
  
  return [headers.join(","), ...rows].join("\n");
}
