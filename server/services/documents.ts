import { jsPDF } from "jspdf";
import { storage } from "../storage";
import type { Note, Property, Lead, Organization } from "@shared/schema";
import { format } from "date-fns";

function formatCurrency(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num || 0);
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "N/A";
  return format(new Date(date), "MMMM d, yyyy");
}

function addHeader(doc: jsPDF, orgName: string, y: number = 20): number {
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(34, 139, 87);
  doc.text("AcreOS", 20, y);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  doc.text(orgName, 20, y + 8);
  doc.text(`Generated: ${format(new Date(), "MMMM d, yyyy")}`, 20, y + 14);
  
  doc.setDrawColor(200, 200, 200);
  doc.line(20, y + 20, 190, y + 20);
  
  return y + 30;
}

function addSection(doc: jsPDF, title: string, y: number): number {
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text(title, 20, y);
  return y + 8;
}

function addField(doc: jsPDF, label: string, value: string, y: number, x: number = 20): number {
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(80, 80, 80);
  doc.text(label + ":", x, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(40, 40, 40);
  doc.text(value || "N/A", x + 50, y);
  return y + 6;
}

function checkPageBreak(doc: jsPDF, y: number, needed: number = 40): number {
  if (y + needed > 280) {
    doc.addPage();
    return 20;
  }
  return y;
}

export async function generatePromissoryNote(
  noteId: number,
  organizationId: number
): Promise<Buffer> {
  const note = await storage.getNote(organizationId, noteId);
  if (!note) {
    throw new Error("Note not found");
  }

  const org = await storage.getOrganization(organizationId);
  if (!org) {
    throw new Error("Organization not found");
  }

  let borrower: Lead | undefined;
  if (note.borrowerId) {
    borrower = await storage.getLead(organizationId, note.borrowerId);
  }

  let property: Property | undefined;
  if (note.propertyId) {
    property = await storage.getProperty(organizationId, note.propertyId);
  }

  const doc = new jsPDF();
  let y = addHeader(doc, org.name);

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text("PROMISSORY NOTE", 105, y, { align: "center" });
  y += 15;

  y = addSection(doc, "Borrower Information", y);
  if (borrower) {
    y = addField(doc, "Name", `${borrower.firstName} ${borrower.lastName}`, y);
    y = addField(doc, "Address", borrower.address || "N/A", y);
    y = addField(doc, "City/State", `${borrower.city || ""}, ${borrower.state || ""} ${borrower.zip || ""}`.trim(), y);
    y = addField(doc, "Email", borrower.email || "N/A", y);
    y = addField(doc, "Phone", borrower.phone || "N/A", y);
  } else {
    y = addField(doc, "Borrower ID", String(note.borrowerId || "N/A"), y);
  }
  y += 5;

  y = addSection(doc, "Property Information", y);
  if (property) {
    y = addField(doc, "APN", property.apn, y);
    y = addField(doc, "Address", property.address || "N/A", y);
    y = addField(doc, "County/State", `${property.county}, ${property.state}`, y);
    if (property.legalDescription) {
      y = addField(doc, "Legal Desc.", property.legalDescription.substring(0, 60) + (property.legalDescription.length > 60 ? "..." : ""), y);
    }
    y = addField(doc, "Size", `${property.sizeAcres} acres`, y);
  } else {
    y = addField(doc, "Property ID", String(note.propertyId || "N/A"), y);
  }
  y += 5;

  y = addSection(doc, "Loan Terms", y);
  y = addField(doc, "Principal", formatCurrency(note.originalPrincipal), y);
  y = addField(doc, "Balance", formatCurrency(note.currentBalance), y);
  y = addField(doc, "Interest Rate", `${note.interestRate}% per annum`, y);
  y = addField(doc, "Term", `${note.termMonths} months`, y);
  y = addField(doc, "Monthly Payment", formatCurrency(note.monthlyPayment), y);
  y = addField(doc, "Start Date", formatDate(note.startDate), y);
  y = addField(doc, "First Payment", formatDate(note.firstPaymentDate), y);
  y = addField(doc, "Maturity Date", formatDate(note.maturityDate), y);
  
  if (note.downPayment && Number(note.downPayment) > 0) {
    y = addField(doc, "Down Payment", formatCurrency(note.downPayment), y);
    y = addField(doc, "Down Received", note.downPaymentReceived ? "Yes" : "No", y);
  }
  
  if (note.lateFee && Number(note.lateFee) > 0) {
    y = addField(doc, "Late Fee", formatCurrency(note.lateFee), y);
    y = addField(doc, "Grace Period", `${note.gracePeriodDays || 10} days`, y);
  }
  y += 10;

  y = checkPageBreak(doc, y, 60);
  y = addSection(doc, "Amortization Schedule", y);
  
  const schedule = note.amortizationSchedule || [];
  if (schedule.length > 0) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(80, 80, 80);
    
    const tableHeaders = ["#", "Due Date", "Payment", "Principal", "Interest", "Balance", "Status"];
    const colWidths = [10, 30, 25, 25, 25, 30, 20];
    let x = 20;
    
    tableHeaders.forEach((header, i) => {
      doc.text(header, x, y);
      x += colWidths[i];
    });
    y += 5;
    
    doc.setDrawColor(200, 200, 200);
    doc.line(20, y, 190, y);
    y += 4;
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    
    const maxRows = Math.min(schedule.length, 24);
    for (let i = 0; i < maxRows; i++) {
      y = checkPageBreak(doc, y, 5);
      const row = schedule[i];
      x = 20;
      
      doc.text(String(row.paymentNumber), x, y);
      doc.text(row.dueDate ? format(new Date(row.dueDate), "MM/dd/yyyy") : "", x + colWidths[0], y);
      doc.text(formatCurrency(row.payment), x + colWidths[0] + colWidths[1], y);
      doc.text(formatCurrency(row.principal), x + colWidths[0] + colWidths[1] + colWidths[2], y);
      doc.text(formatCurrency(row.interest), x + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], y);
      doc.text(formatCurrency(row.balance), x + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], y);
      doc.text(row.status || "pending", x + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5], y);
      
      y += 4;
    }
    
    if (schedule.length > maxRows) {
      doc.setFont("helvetica", "italic");
      doc.text(`... and ${schedule.length - maxRows} more payments`, 20, y + 4);
      y += 8;
    }
  } else {
    doc.setFontSize(10);
    doc.setFont("helvetica", "italic");
    doc.text("No amortization schedule available", 20, y);
    y += 6;
  }

  y = checkPageBreak(doc, y, 50);
  y += 20;
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(40, 40, 40);
  
  doc.text("_________________________________", 20, y);
  doc.text("_________________________________", 110, y);
  y += 6;
  doc.text("Borrower Signature", 20, y);
  doc.text("Lender Signature", 110, y);
  y += 10;
  doc.text("Date: _______________", 20, y);
  doc.text("Date: _______________", 110, y);

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}

export async function generateWarrantyDeed(
  propertyId: number,
  organizationId: number
): Promise<Buffer> {
  const property = await storage.getProperty(organizationId, propertyId);
  if (!property) {
    throw new Error("Property not found");
  }

  const org = await storage.getOrganization(organizationId);
  if (!org) {
    throw new Error("Organization not found");
  }

  let seller: Lead | undefined;
  if (property.sellerId) {
    seller = await storage.getLead(organizationId, property.sellerId);
  }

  let buyer: Lead | undefined;
  if (property.buyerId) {
    buyer = await storage.getLead(organizationId, property.buyerId);
  }

  const doc = new jsPDF();
  let y = addHeader(doc, org.name);

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text("WARRANTY DEED", 105, y, { align: "center" });
  y += 15;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(40, 40, 40);
  
  const introText = `This WARRANTY DEED is made on ${format(new Date(), "MMMM d, yyyy")}, by and between the Grantor(s) and Grantee(s) named below, for the property described herein.`;
  const splitIntro = doc.splitTextToSize(introText, 170);
  doc.text(splitIntro, 20, y);
  y += splitIntro.length * 5 + 10;

  y = addSection(doc, "Grantor (Seller) Information", y);
  if (seller) {
    y = addField(doc, "Name", `${seller.firstName} ${seller.lastName}`, y);
    y = addField(doc, "Address", seller.address || "N/A", y);
    y = addField(doc, "City/State", `${seller.city || ""}, ${seller.state || ""} ${seller.zip || ""}`.trim(), y);
  } else {
    y = addField(doc, "Name", "_________________________________", y);
    y = addField(doc, "Address", "_________________________________", y);
    y = addField(doc, "City/State", "_________________________________", y);
  }
  y += 5;

  y = addSection(doc, "Grantee (Buyer) Information", y);
  if (buyer) {
    y = addField(doc, "Name", `${buyer.firstName} ${buyer.lastName}`, y);
    y = addField(doc, "Address", buyer.address || "N/A", y);
    y = addField(doc, "City/State", `${buyer.city || ""}, ${buyer.state || ""} ${buyer.zip || ""}`.trim(), y);
  } else {
    y = addField(doc, "Name", org.name, y);
    const settings = org.settings as any;
    y = addField(doc, "Address", settings?.companyAddress || "_________________________________", y);
  }
  y += 5;

  y = addSection(doc, "Property Description", y);
  y = addField(doc, "APN", property.apn, y);
  y = addField(doc, "Address", property.address || "N/A", y);
  y = addField(doc, "County", property.county, y);
  y = addField(doc, "State", property.state, y);
  y = addField(doc, "Size", `${property.sizeAcres} acres`, y);
  
  if (property.subdivision) {
    y = addField(doc, "Subdivision", property.subdivision, y);
  }
  if (property.lotNumber) {
    y = addField(doc, "Lot Number", property.lotNumber, y);
  }
  y += 5;

  if (property.legalDescription) {
    y = addSection(doc, "Legal Description", y);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    const splitDesc = doc.splitTextToSize(property.legalDescription, 170);
    doc.text(splitDesc, 20, y);
    y += splitDesc.length * 4 + 10;
  }

  y = checkPageBreak(doc, y, 40);
  y = addSection(doc, "Consideration", y);
  if (property.purchasePrice) {
    y = addField(doc, "Purchase Price", formatCurrency(property.purchasePrice), y);
  } else {
    y = addField(doc, "Purchase Price", "$_________________", y);
  }
  if (property.purchaseDate) {
    y = addField(doc, "Date of Sale", formatDate(property.purchaseDate), y);
  }
  y += 10;

  y = checkPageBreak(doc, y, 60);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const warrantyText = `The Grantor(s) hereby convey(s) and warrant(s) to the Grantee(s), their heirs and assigns forever, the above-described property, together with all and singular the rights, members and appurtenances thereof, to the same being, belonging, or in anywise appertaining, and the reversion and reversions, remainder and remainders, rents, issues and profits thereof; and all the estate, right, title, interest, claim and demand whatsoever of the Grantor(s), either in law or equity, of, in, and to the above-bargained premises, with the hereditaments and appurtenances.`;
  
  const splitWarranty = doc.splitTextToSize(warrantyText, 170);
  doc.text(splitWarranty, 20, y);
  y += splitWarranty.length * 5 + 20;

  y = checkPageBreak(doc, y, 50);
  
  doc.text("_________________________________", 20, y);
  doc.text("_________________________________", 110, y);
  y += 6;
  doc.text("Grantor Signature", 20, y);
  doc.text("Grantee Signature", 110, y);
  y += 10;
  doc.text("Date: _______________", 20, y);
  doc.text("Date: _______________", 110, y);
  y += 20;

  y = checkPageBreak(doc, y, 40);
  doc.setFont("helvetica", "bold");
  doc.text("NOTARY ACKNOWLEDGMENT", 20, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const notaryText = `State of _________________, County of _________________

On this _____ day of _________________, 20____, before me personally appeared _________________________________, known to me (or proved to me on the basis of satisfactory evidence) to be the person(s) whose name(s) is/are subscribed to the within instrument and acknowledged to me that he/she/they executed the same in his/her/their authorized capacity(ies), and that by his/her/their signature(s) on the instrument the person(s), or the entity upon behalf of which the person(s) acted, executed the instrument.

WITNESS my hand and official seal.

_________________________________
Notary Public`;
  
  const splitNotary = doc.splitTextToSize(notaryText, 170);
  doc.text(splitNotary, 20, y);

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}

export async function generateOfferLetter(
  leadId: number,
  propertyId: number,
  organizationId: number,
  offerDetails?: {
    offerAmount?: number;
    earnestMoney?: number;
    closingDate?: string;
    contingencies?: string[];
    additionalTerms?: string;
  }
): Promise<Buffer> {
  const lead = await storage.getLead(organizationId, leadId);
  if (!lead) {
    throw new Error("Lead not found");
  }

  const property = await storage.getProperty(organizationId, propertyId);
  if (!property) {
    throw new Error("Property not found");
  }

  const org = await storage.getOrganization(organizationId);
  if (!org) {
    throw new Error("Organization not found");
  }

  const doc = new jsPDF();
  let y = addHeader(doc, org.name);

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text("LETTER OF INTENT TO PURCHASE", 105, y, { align: "center" });
  y += 15;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(40, 40, 40);
  
  doc.text(`Date: ${format(new Date(), "MMMM d, yyyy")}`, 20, y);
  y += 10;
  
  doc.text("Dear " + lead.firstName + " " + lead.lastName + ",", 20, y);
  y += 10;
  
  const introText = `We are pleased to present this offer to purchase your property located in ${property.county} County, ${property.state}. This letter outlines the key terms of our proposed purchase.`;
  const splitIntro = doc.splitTextToSize(introText, 170);
  doc.text(splitIntro, 20, y);
  y += splitIntro.length * 5 + 10;

  y = addSection(doc, "Property Details", y);
  y = addField(doc, "APN", property.apn, y);
  if (property.address) {
    y = addField(doc, "Address", property.address, y);
  }
  y = addField(doc, "County/State", `${property.county}, ${property.state}`, y);
  y = addField(doc, "Size", `${property.sizeAcres} acres`, y);
  if (property.legalDescription) {
    const shortDesc = property.legalDescription.substring(0, 80) + (property.legalDescription.length > 80 ? "..." : "");
    y = addField(doc, "Legal Desc.", shortDesc, y);
  }
  y += 5;

  y = addSection(doc, "Offer Terms", y);
  
  const offerAmount = offerDetails?.offerAmount || Number(property.assessedValue || 0) * 0.3;
  y = addField(doc, "Offer Price", formatCurrency(offerAmount), y);
  
  if (offerDetails?.earnestMoney) {
    y = addField(doc, "Earnest Money", formatCurrency(offerDetails.earnestMoney), y);
  }
  
  const closingDate = offerDetails?.closingDate || format(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), "MMMM d, yyyy");
  y = addField(doc, "Closing Date", closingDate, y);
  y = addField(doc, "Closing Costs", "Buyer to pay all closing costs", y);
  y += 5;

  y = addSection(doc, "Contingencies", y);
  const contingencies = offerDetails?.contingencies || [
    "Clear and marketable title",
    "Satisfactory title commitment",
    "No outstanding liens or encumbrances"
  ];
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  contingencies.forEach((contingency, i) => {
    doc.text(`${i + 1}. ${contingency}`, 25, y);
    y += 5;
  });
  y += 5;

  y = checkPageBreak(doc, y, 60);
  
  y = addSection(doc, "Buyer Information", y);
  y = addField(doc, "Company", org.name, y);
  const settings = org.settings as any;
  if (settings?.companyAddress) {
    y = addField(doc, "Address", settings.companyAddress, y);
  }
  if (settings?.companyPhone) {
    y = addField(doc, "Phone", settings.companyPhone, y);
  }
  if (settings?.companyEmail) {
    y = addField(doc, "Email", settings.companyEmail, y);
  }
  y += 10;

  if (offerDetails?.additionalTerms) {
    y = addSection(doc, "Additional Terms", y);
    const splitTerms = doc.splitTextToSize(offerDetails.additionalTerms, 170);
    doc.text(splitTerms, 20, y);
    y += splitTerms.length * 5 + 10;
  }

  y = checkPageBreak(doc, y, 50);
  
  const closingText = `This offer is valid for 14 days from the date above. We look forward to working with you on this transaction. Please feel free to contact us with any questions.`;
  const splitClosing = doc.splitTextToSize(closingText, 170);
  doc.text(splitClosing, 20, y);
  y += splitClosing.length * 5 + 10;
  
  doc.text("Sincerely,", 20, y);
  y += 15;
  
  doc.text("_________________________________", 20, y);
  y += 6;
  doc.text(org.name, 20, y);
  y += 20;

  doc.setFont("helvetica", "bold");
  doc.text("SELLER ACCEPTANCE", 20, y);
  y += 10;
  doc.setFont("helvetica", "normal");
  
  doc.text("I/We accept this offer and agree to the terms stated above.", 20, y);
  y += 15;
  
  doc.text("_________________________________", 20, y);
  doc.text("Date: _______________", 110, y);
  y += 6;
  doc.text("Seller Signature", 20, y);

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}
