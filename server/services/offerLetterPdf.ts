// @ts-nocheck
/**
 * T23 — Offer Letter PDF Generation
 *
 * Generates a professional PDF offer letter from deal/property data.
 * Uses jsPDF (already installed) for server-side PDF generation.
 *
 * Output: PDF buffer ready for:
 *   - Direct download response
 *   - Email attachment
 *   - Document storage in S3
 *
 * Usage:
 *   import { generateOfferLetterPdf } from "./offerLetterPdf";
 *   const buffer = await generateOfferLetterPdf(deal, property, org, seller);
 *   res.set("Content-Type", "application/pdf");
 *   res.set("Content-Disposition", `attachment; filename="offer-${deal.id}.pdf"`);
 *   res.send(buffer);
 *
 * Also exposed via: POST /api/deals/:id/offer-letter-pdf
 */

import { jsPDF } from "jspdf";

interface OfferLetterData {
  // Organization (buyer)
  orgName: string;
  orgAddress?: string;
  orgPhone?: string;
  orgEmail?: string;
  buyerEntityName?: string; // e.g. "Acme Land LLC"

  // Property
  apn: string;
  propertyAddress?: string;
  legalDescription?: string;
  acres?: number;
  state?: string;
  county?: string;

  // Seller
  sellerName: string;
  sellerAddress?: string;

  // Offer terms
  purchasePrice: number;
  earnestMoneyDeposit?: number;
  closingDays?: number; // e.g. 30
  closingDateFixed?: string; // ISO date
  contingencies?: string[];

  // Seller financing (if applicable)
  sellerFinancing?: {
    downPayment: number;
    interestRate: number;
    termMonths: number;
    monthlyPayment: number;
  };

  // Dates
  offerExpirationDays?: number; // default 10
  offerDate?: string; // ISO date, defaults to today

  // Custom message
  customMessage?: string;
}

export async function generateOfferLetterPdf(data: OfferLetterData): Promise<Buffer> {
  const doc = new jsPDF({ unit: "in", format: "letter" });

  const margin = 1;
  const pageWidth = 8.5;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const offerDate = data.offerDate
    ? new Date(data.offerDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + (data.offerExpirationDays ?? 10));
  const expStr = expirationDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // ── Header ────────────────────────────────────────────────────────────────

  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 58, 30); // dark forest green
  doc.text(data.buyerEntityName || data.orgName, margin, y);
  y += 0.35;

  if (data.orgAddress) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 80);
    doc.text(data.orgAddress, margin, y);
    y += 0.18;
  }
  if (data.orgPhone || data.orgEmail) {
    doc.text(
      [data.orgPhone, data.orgEmail].filter(Boolean).join("  •  "),
      margin,
      y
    );
    y += 0.18;
  }

  // Horizontal rule
  y += 0.1;
  doc.setDrawColor(180, 160, 120);
  doc.setLineWidth(0.02);
  doc.line(margin, y, pageWidth - margin, y);
  y += 0.3;

  // Date
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(60, 60, 60);
  doc.text(offerDate, margin, y);
  y += 0.35;

  // Seller address block
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(data.sellerName, margin, y);
  y += 0.2;
  if (data.sellerAddress) {
    doc.text(data.sellerAddress, margin, y);
    y += 0.2;
  }
  y += 0.1;

  // Subject line
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 58, 30);
  doc.text(`PURCHASE OFFER — ${data.propertyAddress || `APN: ${data.apn}`}`, margin, y);
  y += 0.4;

  // Salutation
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(40, 40, 40);
  doc.text(`Dear ${data.sellerName.split(" ")[0] || "Property Owner"},`, margin, y);
  y += 0.3;

  // Opening paragraph
  const openingLines = doc.splitTextToSize(
    `${data.buyerEntityName || data.orgName} is pleased to present this formal written offer to purchase the following property. This offer is made in good faith and we are prepared to move quickly toward a closing that works on your timeline.`,
    contentWidth
  );
  doc.text(openingLines, margin, y);
  y += openingLines.length * 0.18 + 0.25;

  // ── Property details ───────────────────────────────────────────────────────

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 58, 30);
  doc.text("PROPERTY INFORMATION", margin, y);
  y += 0.25;

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(40, 40, 40);

  const propDetails: [string, string][] = [
    ["Assessor Parcel Number (APN)", data.apn],
    ["Property Address", data.propertyAddress || "Per county records"],
    ["County / State", [data.county, data.state].filter(Boolean).join(", ")],
    data.acres ? ["Approximate Acreage", `${data.acres.toLocaleString()} acres`] : ["", ""],
    data.legalDescription ? ["Legal Description", data.legalDescription] : ["", ""],
  ].filter(([k]) => k);

  for (const [label, value] of propDetails) {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    const valueX = margin + 2.5;
    const wrapped = doc.splitTextToSize(value, contentWidth - 2.5);
    doc.text(wrapped, valueX, y);
    y += Math.max(0.2, wrapped.length * 0.18);
  }

  y += 0.2;

  // ── Offer terms ────────────────────────────────────────────────────────────

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 58, 30);
  doc.text("OFFER TERMS", margin, y);
  y += 0.25;

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(40, 40, 40);

  const terms: [string, string][] = [
    ["Purchase Price", `$${data.purchasePrice.toLocaleString()}`],
    ...(data.earnestMoneyDeposit ? [["Earnest Money Deposit", `$${data.earnestMoneyDeposit.toLocaleString()}`] as [string, string]] : []),
    ["Closing Timeline", data.closingDateFixed
      ? `On or before ${new Date(data.closingDateFixed).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`
      : `${data.closingDays ?? 30} days from acceptance`],
  ];

  for (const [label, value] of terms) {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "bold");
    if (label === "Purchase Price") doc.setTextColor(30, 80, 30);
    doc.text(value, margin + 2.5, y);
    doc.setTextColor(40, 40, 40);
    y += 0.22;
  }

  // Seller financing terms if applicable
  if (data.sellerFinancing) {
    y += 0.15;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 58, 30);
    doc.text("SELLER FINANCING TERMS", margin, y);
    y += 0.25;

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);

    const sf = data.sellerFinancing;
    const sfTerms: [string, string][] = [
      ["Down Payment", `$${sf.downPayment.toLocaleString()}`],
      ["Interest Rate", `${sf.interestRate}% per annum`],
      ["Term", `${sf.termMonths} months (${Math.floor(sf.termMonths / 12)} years)`],
      ["Monthly Payment", `$${sf.monthlyPayment.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
    ];

    for (const [label, value] of sfTerms) {
      doc.setFont("helvetica", "bold");
      doc.text(`${label}:`, margin, y);
      doc.setFont("helvetica", "normal");
      doc.text(value, margin + 2.5, y);
      y += 0.22;
    }
  }

  y += 0.2;

  // Custom message
  if (data.customMessage) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);
    const msgLines = doc.splitTextToSize(data.customMessage, contentWidth);
    doc.text(msgLines, margin, y);
    y += msgLines.length * 0.18 + 0.2;
  }

  // Expiration notice
  doc.setFontSize(10);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(100, 100, 100);
  const expireText = `This offer expires on ${expStr}. Please contact us at your earliest convenience to discuss.`;
  const expLines = doc.splitTextToSize(expireText, contentWidth);
  doc.text(expLines, margin, y);
  y += expLines.length * 0.16 + 0.3;

  // Closing
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(40, 40, 40);
  doc.text("Sincerely,", margin, y);
  y += 0.4;

  doc.setFont("helvetica", "bold");
  doc.text(data.buyerEntityName || data.orgName, margin, y);
  y += 0.2;
  if (data.orgPhone) {
    doc.setFont("helvetica", "normal");
    doc.text(data.orgPhone, margin, y);
    y += 0.18;
  }
  if (data.orgEmail) {
    doc.text(data.orgEmail, margin, y);
    y += 0.18;
  }

  // Signature line
  y += 0.4;
  doc.setDrawColor(100, 100, 100);
  doc.setLineWidth(0.01);
  doc.line(margin, y, margin + 2.5, y);
  y += 0.15;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  doc.text("Authorized Signature / Date", margin, y);

  // Footer
  const footerY = 10.5;
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(150, 150, 150);
  doc.text(
    `This offer is not a binding contract until signed by all parties. Generated by AcreOS on ${offerDate}.`,
    margin,
    footerY
  );

  // Return as Buffer
  const output = doc.output("arraybuffer");
  return Buffer.from(output);
}
