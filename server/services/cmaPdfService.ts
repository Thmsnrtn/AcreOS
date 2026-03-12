/**
 * T30 — CMA PDF Report Generator
 *
 * Generates a professional Comparative Market Analysis PDF.
 * Uses jsPDF (already installed).
 *
 * Output includes:
 *   - Subject property details
 *   - Up to 5 comparable sales with distance and adjustments
 *   - Calculated market value range with confidence interval
 *   - Price per acre comparison table
 *   - Atlas recommendation summary
 *
 * Usage:
 *   const buffer = await generateCmaPdf(report);
 *   res.set("Content-Type", "application/pdf");
 *   res.send(buffer);
 */

import { jsPDF } from "jspdf";
import type { ComparableProperty, OfferPrices } from "./comps";

export interface CmaReportData {
  // Organization
  orgName: string;
  preparedBy?: string;
  preparedDate?: string;

  // Subject property
  subject: {
    apn: string;
    address?: string;
    county?: string;
    state?: string;
    acreage?: number;
    zoning?: string;
    propertyType?: string;
    latitude?: number;
    longitude?: number;
  };

  // Comps
  comparables: ComparableProperty[];

  // Valuation
  offerPrices: OfferPrices;
  confidenceScore?: number; // 0-100

  // Atlas recommendation
  atlasRecommendation?: string;
  atlasNotes?: string[];
}

const GREEN = [30, 58, 30] as const;
const GRAY = [80, 80, 80] as const;
const DARK = [40, 40, 40] as const;
const GOLD = [180, 160, 120] as const;

export async function generateCmaPdf(data: CmaReportData): Promise<Buffer> {
  const doc = new jsPDF({ unit: "in", format: "letter" });
  const margin = 0.875;
  const pageWidth = 8.5;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const fmt$ = (n: number | null | undefined) =>
    n != null ? `$${n.toLocaleString()}` : "N/A";

  const fmtAcres = (n: number | null | undefined) =>
    n != null ? `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ac` : "N/A";

  const prepDate = data.preparedDate
    ? new Date(data.preparedDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // ── Header ──────────────────────────────────────────────────────────────

  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GREEN);
  doc.text(data.orgName, margin, y);
  y += 0.32;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text(`Comparative Market Analysis  •  ${prepDate}`, margin, y);
  if (data.preparedBy) {
    doc.text(`Prepared by: ${data.preparedBy}`, pageWidth - margin, y, { align: "right" });
  }
  y += 0.12;

  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.02);
  doc.line(margin, y, pageWidth - margin, y);
  y += 0.3;

  // ── Subject Property ────────────────────────────────────────────────────

  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GREEN);
  doc.text("SUBJECT PROPERTY", margin, y);
  y += 0.25;

  const subjRows: [string, string][] = [
    ["APN", data.subject.apn],
    ["Address", data.subject.address || "Per county records"],
    ["County / State", [data.subject.county, data.subject.state].filter(Boolean).join(", ") || "N/A"],
    ["Acreage", fmtAcres(data.subject.acreage)],
    ["Zoning", data.subject.zoning || "N/A"],
    ["Property Type", data.subject.propertyType || "Vacant Land"],
  ];

  doc.setFontSize(10);
  for (const [label, val] of subjRows) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DARK);
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(val, margin + 1.8, y);
    y += 0.185;
  }
  y += 0.2;

  // ── Valuation Summary ───────────────────────────────────────────────────

  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.015);
  doc.line(margin, y, pageWidth - margin, y);
  y += 0.22;

  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GREEN);
  doc.text("VALUATION SUMMARY", margin, y);
  y += 0.28;

  // Estimated market value box
  const boxX = margin;
  const boxW = contentWidth;
  const boxH = 0.72;
  doc.setFillColor(245, 248, 245);
  doc.setDrawColor(180, 210, 180);
  doc.roundedRect(boxX, y - 0.04, boxW, boxH, 0.06, 0.06, "FD");

  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text("Estimated Market Value", boxX + 0.2, y + 0.14);

  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(20, 100, 40);
  doc.text(fmt$(data.offerPrices.estimatedMarketValue), boxX + 0.2, y + 0.52);

  if (data.subject.acreage && data.offerPrices.estimatedMarketValue) {
    const ppa = data.offerPrices.estimatedMarketValue / data.subject.acreage;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    doc.text(`${fmt$(Math.round(ppa))}/acre`, boxX + boxW - 0.2, y + 0.52, { align: "right" });
  }

  if (data.confidenceScore != null) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(...GRAY);
    doc.text(`Confidence: ${data.confidenceScore}%`, boxX + boxW - 0.2, y + 0.14, { align: "right" });
  }
  y += boxH + 0.18;

  // Offer price tiers
  doc.setFontSize(10);
  const tiers: [string, string, string][] = [
    ["Conservative", fmt$(data.offerPrices.conservative.min), fmt$(data.offerPrices.conservative.max)],
    ["Standard", fmt$(data.offerPrices.standard.min), fmt$(data.offerPrices.standard.max)],
    ["Aggressive", fmt$(data.offerPrices.aggressive.min), fmt$(data.offerPrices.aggressive.max)],
  ];
  const colW = contentWidth / 3;
  for (let i = 0; i < tiers.length; i++) {
    const [tier, min, max] = tiers[i];
    const tx = margin + i * colW;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GREEN);
    doc.text(tier, tx, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...DARK);
    doc.text(`${min} – ${max}`, tx, y + 0.18);
  }
  y += 0.45;

  // ── Comparable Sales ────────────────────────────────────────────────────

  doc.setDrawColor(...GOLD);
  doc.line(margin, y, pageWidth - margin, y);
  y += 0.22;

  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GREEN);
  doc.text("COMPARABLE SALES", margin, y);
  y += 0.28;

  const comps = data.comparables.slice(0, 5);

  if (comps.length === 0) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(...GRAY);
    doc.text("No comparable sales data available for this search area.", margin, y);
    y += 0.3;
  } else {
    // Column headers
    const cols = [
      { label: "#", x: margin, w: 0.22 },
      { label: "Address / APN", x: margin + 0.22, w: 2.1 },
      { label: "Acreage", x: margin + 2.32, w: 0.85 },
      { label: "Sale Date", x: margin + 3.17, w: 0.9 },
      { label: "Sale Price", x: margin + 4.07, w: 1.0 },
      { label: "$/Acre", x: margin + 5.07, w: 0.88 },
      { label: "Dist (mi)", x: margin + 5.95, w: 0.72 },
    ];

    doc.setFillColor(240, 244, 240);
    doc.rect(margin, y - 0.14, contentWidth, 0.22, "F");
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DARK);
    for (const col of cols) {
      doc.text(col.label, col.x, y);
    }
    y += 0.18;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    for (let i = 0; i < comps.length; i++) {
      const c = comps[i];
      if (i % 2 === 0) {
        doc.setFillColor(250, 253, 250);
        doc.rect(margin, y - 0.13, contentWidth, 0.22, "F");
      }
      doc.setTextColor(...DARK);
      doc.text(`${i + 1}`, cols[0].x, y);
      const addrText = doc.splitTextToSize(c.address || c.apn, cols[1].w - 0.05);
      doc.text(addrText[0], cols[1].x, y); // truncate to one line in table
      doc.text(fmtAcres(c.acreage), cols[2].x, y);
      doc.text(c.saleDate ? c.saleDate.slice(0, 7) : "N/A", cols[3].x, y);
      doc.text(fmt$(c.salePrice), cols[4].x, y);
      doc.text(fmt$(c.pricePerAcre ? Math.round(c.pricePerAcre) : null), cols[5].x, y);
      doc.text(c.distance != null ? `${c.distance.toFixed(1)}` : "N/A", cols[6].x, y);
      y += 0.22;
    }
    y += 0.15;
  }

  // ── Atlas Recommendation ────────────────────────────────────────────────

  if (data.atlasRecommendation) {
    // Check if page space is needed
    if (y > 9.5) {
      doc.addPage();
      y = margin;
    }

    doc.setDrawColor(...GOLD);
    doc.line(margin, y, pageWidth - margin, y);
    y += 0.22;

    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GREEN);
    doc.text("ATLAS RECOMMENDATION", margin, y);
    y += 0.28;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...DARK);
    const recLines = doc.splitTextToSize(data.atlasRecommendation, contentWidth);
    doc.text(recLines, margin, y);
    y += recLines.length * 0.18 + 0.15;

    if (data.atlasNotes && data.atlasNotes.length > 0) {
      for (const note of data.atlasNotes) {
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...GRAY);
        doc.setFontSize(9.5);
        const noteLines = doc.splitTextToSize(`• ${note}`, contentWidth - 0.2);
        doc.text(noteLines, margin + 0.1, y);
        y += noteLines.length * 0.17 + 0.08;
      }
    }
  }

  // ── Footer ──────────────────────────────────────────────────────────────

  const footerY = 10.5;
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(160, 160, 160);
  doc.text(
    `CMA prepared by AcreOS on ${prepDate}. For informational purposes only. Not a guarantee of value.`,
    margin,
    footerY
  );
  doc.text(`${data.comparables.length} comparable sale(s) analyzed within the search radius.`, pageWidth - margin, footerY, { align: "right" });

  const output = doc.output("arraybuffer");
  return Buffer.from(output);
}
