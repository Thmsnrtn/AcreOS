/**
 * Due Diligence Report Generator — 6-page PDF orchestrator
 *
 * Gathers all data in parallel (target <3 seconds), then generates
 * a comprehensive PDF. Graceful degradation: if any source fails,
 * the report generates from whatever data is available.
 */

import { db } from "../db";
import { properties } from "@shared/schema";
import { eq } from "drizzle-orm";
import { jsPDF } from "jspdf";
import { logger } from "../utils/logger";
import {
  getWaterRightsInfo,
  getMineralRightsInfo,
  estimateCarbonCredits,
  assessClimateRisk,
} from "./environmentalIntelligence";

interface ReportResult {
  pdf: Buffer;
  summary: {
    riskLevel: string;
    redFlags: number;
    greenFlags: number;
    sourcesQueried: number;
    sourcesResponded: number;
  };
  generatedAt: string;
}

const GREEN: [number, number, number] = [30, 58, 30];
const GRAY: [number, number, number] = [120, 120, 120];
const DARK: [number, number, number] = [40, 40, 40];
const RED: [number, number, number] = [200, 50, 50];
const AMBER: [number, number, number] = [180, 130, 20];
const GOLD: [number, number, number] = [180, 160, 120];

function fmt$(n: number | null | undefined): string {
  if (n == null) return "N/A";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function riskBadge(risk: string): string {
  if (risk === "low") return "✓";
  if (risk === "medium") return "△";
  return "✗";
}

function addPageHeader(doc: jsPDF, title: string, pageNum: number, margin: number, pageWidth: number): number {
  let y = margin;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GREEN);
  doc.text(title, margin, y);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text(`Page ${pageNum} of 6`, pageWidth - margin - 0.5, y);
  y += 0.15;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.015);
  doc.line(margin, y, pageWidth - margin, y);
  return y + 0.3;
}

function addSection(doc: jsPDF, title: string, y: number, margin: number): number {
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GREEN);
  doc.text(title, margin, y);
  return y + 0.25;
}

function addRow(doc: jsPDF, label: string, value: string, y: number, margin: number): number {
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...DARK);
  doc.text(`${label}:`, margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(value, margin + 2.2, y);
  return y + 0.2;
}

export async function generateFullReport(propertyId: number, orgId: number): Promise<ReportResult> {
  const sourcesQueried = 18;
  let sourcesResponded = 0;
  let redFlags = 0;
  let greenFlags = 0;

  // Gather all data in parallel — target <3 seconds
  const [ddResult, lcsResult, compsResult, valuationResult, propertyResult] = await Promise.allSettled([
    import("./dueDiligenceEngine").then(m => m.runAutoDueDiligence(propertyId, orgId)),
    import("./landCredit").then(m => {
      const svc = new m.default();
      return svc.calculateCreditScore(orgId, propertyId);
    }),
    import("./comps").then(m => m.getComps(orgId, propertyId)),
    import("./acreOSValuation").then(m => m.estimateValue(orgId, propertyId)),
    db.query.properties.findFirst({ where: eq(properties.id, propertyId) }),
  ]);

  const dd = ddResult.status === "fulfilled" ? ddResult.value : null;
  const lcs = lcsResult.status === "fulfilled" ? lcsResult.value : null;
  const comps = compsResult.status === "fulfilled" ? compsResult.value : null;
  const valuation = valuationResult.status === "fulfilled" ? valuationResult.value : null;
  const property = propertyResult.status === "fulfilled" ? propertyResult.value : null;

  if (dd) sourcesResponded += 6;
  if (lcs) sourcesResponded += 6;
  if (comps) sourcesResponded += 3;
  if (valuation) sourcesResponded += 2;
  if (property) sourcesResponded += 1;

  // Count flags from DD checks
  if (dd?.checks) {
    for (const check of Object.values(dd.checks)) {
      if ((check as any)?.risk === "low") greenFlags++;
      else if ((check as any)?.risk === "high" || (check as any)?.risk === "critical") redFlags++;
    }
  }

  const riskLevel = redFlags >= 3 ? "high" : redFlags >= 1 ? "medium" : "low";

  // ─── Generate 6-page PDF ────────────────────────────────────────────
  const doc = new jsPDF({ unit: "in", format: "letter" });
  const margin = 0.75;
  const pageWidth = 8.5;

  // ─── Page 1: Executive Summary ──────────────────────────────────────
  let y = addPageHeader(doc, "Due Diligence Report — Executive Summary", 1, margin, pageWidth);

  // Property block
  y = addSection(doc, "Property Information", y, margin);
  const address = property?.address || `APN: ${property?.apn || "Unknown"}`;
  y = addRow(doc, "Address", address, y, margin);
  y = addRow(doc, "County/State", `${property?.county || "—"}, ${property?.state || "—"}`, y, margin);
  y = addRow(doc, "Acreage", property?.acreage ? `${property.acreage} acres` : "Acreage unknown", y, margin);
  y += 0.15;

  // LCS badge
  if (lcs) {
    y = addRow(doc, "Land Credit Score", `${lcs.overall} (${lcs.grade}) — ${lcs.riskLevel} risk`, y, margin);
  }

  // Flag summary
  y += 0.15;
  y = addRow(doc, "Red Flags", `${redFlags}`, y, margin);
  y = addRow(doc, "Green Flags", `${greenFlags}`, y, margin);
  y = addRow(doc, "Data Sources", `${sourcesResponded} of ${sourcesQueried} responded`, y, margin);
  y = addRow(doc, "Overall Risk", riskLevel.toUpperCase(), y, margin);

  // AI summary paragraph
  y += 0.2;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...DARK);
  const summaryText = riskLevel === "low"
    ? "This property shows favorable characteristics across most dimensions. Environmental checks are clear, and market conditions support the investment thesis."
    : riskLevel === "medium"
      ? "This property shows mixed signals. Some environmental or access concerns warrant further investigation before proceeding."
      : "This property has multiple risk factors that require careful evaluation. Review the detailed findings on the following pages before making a decision.";
  doc.text(summaryText, margin, y, { maxWidth: pageWidth - margin * 2 });

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(...GRAY);
  doc.text(`Confidential — Generated ${new Date().toLocaleDateString()}`, margin, 10.3);

  // ─── Page 2: Environmental & Hazards ────────────────────────────────
  doc.addPage();
  y = addPageHeader(doc, "Environmental & Hazards", 2, margin, pageWidth);

  const envChecks = [
    { name: "Flood Zone", result: dd?.checks?.floodZone, key: "floodZone" },
    { name: "Wetlands", result: dd?.checks?.wetlands, key: "wetlands" },
    { name: "EPA/Superfund", result: dd?.checks?.environmental, key: "environmental" },
    { name: "Soil Contamination", result: dd?.checks?.soil, key: "soil" },
    { name: "Wildfire Risk", result: dd?.checks?.wildfire, key: "wildfire" },
    { name: "Endangered Species", result: dd?.checks?.endangered, key: "endangered" },
  ];

  for (const check of envChecks) {
    const data = check.result as any;
    const badge = data ? riskBadge(data.risk || "unknown") : "—";
    const detail = data?.status === "done"
      ? JSON.stringify(data).substring(0, 80)
      : data ? `Data unavailable — [${check.name}] did not respond` : `Data unavailable — [${check.name}] did not respond`;

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DARK);
    doc.text(`${badge} ${check.name}`, margin, y);
    y += 0.15;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    doc.text(detail, margin + 0.3, y, { maxWidth: pageWidth - margin * 2 - 0.3 });
    y += 0.25;
  }

  // ─── Environmental Intelligence (conditional sections) ─────────────
  const propertyState = property?.state?.toUpperCase()?.trim() ?? "";
  const WESTERN_WATER_STATES = ["AZ", "NM", "CO", "NV", "UT", "MT", "WY", "ID", "OR", "WA"];
  const OIL_GAS_STATES = ["TX", "OK", "LA", "ND", "PA", "WV", "NM", "CO", "WY"];

  // Water rights warning
  try {
    if (WESTERN_WATER_STATES.includes(propertyState)) {
      y += 0.1;
      const waterInfo = getWaterRightsInfo(propertyState);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...AMBER);
      doc.text("△ Water Rights", margin, y);
      y += 0.15;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...DARK);
      doc.text(
        `Western water law state — verify water rights before acquisition. Doctrine: ${waterInfo.doctrineDescription}`,
        margin + 0.3, y, { maxWidth: pageWidth - margin * 2 - 0.3 },
      );
      y += 0.3;
    }
  } catch (err) {
    logger.warn("DD report: water rights section failed", { metadata: { propertyId, error: String(err) } });
  }

  // Mineral rights warning
  try {
    if (OIL_GAS_STATES.includes(propertyState)) {
      const mineralInfo = getMineralRightsInfo(propertyState);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...AMBER);
      doc.text("△ Mineral Rights", margin, y);
      y += 0.15;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...DARK);
      doc.text(
        `Mineral rights may be severed from surface rights. Severance risk: ${mineralInfo.severanceRisk}. ${mineralInfo.notes}`,
        margin + 0.3, y, { maxWidth: pageWidth - margin * 2 - 0.3 },
      );
      y += 0.3;
    }
  } catch (err) {
    logger.warn("DD report: mineral rights section failed", { metadata: { propertyId, error: String(err) } });
  }

  // Carbon credit estimate
  try {
    const landCover = (dd?.checks?.landCover as string) || "";
    if (landCover.toLowerCase().includes("forest") && property?.acreage) {
      const carbonEst = estimateCarbonCredits(propertyState, property.acreage, "forest");
      if (carbonEst.eligible) {
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...GREEN);
        doc.text("✓ Carbon Credit Potential", margin, y);
        y += 0.15;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...DARK);
        doc.text(
          `Carbon credit potential: ~$${carbonEst.estimatedValuePerYear}/year (${carbonEst.estimatedCreditsPerYear} credits/yr). ${carbonEst.notes}`,
          margin + 0.3, y, { maxWidth: pageWidth - margin * 2 - 0.3 },
        );
        y += 0.3;
      }
    }
  } catch (err) {
    logger.warn("DD report: carbon credit section failed", { metadata: { propertyId, error: String(err) } });
  }

  // Climate risk note
  try {
    if (propertyState) {
      const climateRisk = assessClimateRisk(propertyState, property?.county ?? undefined);
      const isDroughtProne = climateRisk.droughtRisk.level === "high" || climateRisk.droughtRisk.level === "very_high";
      const isCoastal = climateRisk.hurricaneRisk.level === "high" || climateRisk.hurricaneRisk.level === "very_high";
      if (isDroughtProne || isCoastal) {
        const riskColor = climateRisk.overallRisk === "very_high" || climateRisk.overallRisk === "high" ? RED : AMBER;
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...riskColor);
        const riskLabel = isDroughtProne && isCoastal
          ? "△ Climate Risk: Drought-Prone & Coastal"
          : isDroughtProne
            ? "△ Climate Risk: Drought-Prone Area"
            : "△ Climate Risk: Coastal Exposure";
        doc.text(riskLabel, margin, y);
        y += 0.15;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...DARK);
        const details = [
          isDroughtProne ? `Drought: ${climateRisk.droughtRisk.description}` : null,
          isCoastal ? `Hurricane: ${climateRisk.hurricaneRisk.description}` : null,
        ].filter(Boolean).join(". ");
        doc.text(details, margin + 0.3, y, { maxWidth: pageWidth - margin * 2 - 0.3 });
        y += 0.3;
      }
    }
  } catch (err) {
    logger.warn("DD report: climate risk section failed", { metadata: { propertyId, error: String(err) } });
  }

  // ─── Page 3: Physical & Access ──────────────────────────────────────
  doc.addPage();
  y = addPageHeader(doc, "Physical & Access", 3, margin, pageWidth);

  y = addRow(doc, "Elevation", dd?.checks?.elevation?.elevationFeet ? `${dd.checks.elevation.elevationFeet} ft` : "Unknown", y, margin);
  y = addRow(doc, "Slope", dd?.checks?.elevation?.slope || "Unknown", y, margin);
  y = addRow(doc, "Soil/Farmland", dd?.checks?.soil?.farmlandClassification || "Unknown", y, margin);
  y = addRow(doc, "Land Cover", dd?.checks?.landCover || "Unknown", y, margin);
  y = addRow(doc, "Road Access", dd?.checks?.roadAccess?.roadType ? `${dd.checks.roadAccess.roadType} (${dd.checks.roadAccess.nearestRoadDistanceFeet || "?"} ft)` : "Unknown", y, margin);
  y = addRow(doc, "Utilities", property?.utilities || "Unknown", y, margin);

  // ─── Page 4: Market Analysis ────────────────────────────────────────
  doc.addPage();
  y = addPageHeader(doc, "Market Analysis", 4, margin, pageWidth);

  if (comps?.comps?.length) {
    y = addSection(doc, "Comparable Sales", y, margin);
    for (const comp of comps.comps.slice(0, 8)) {
      const line = `${comp.address || "—"} | ${comp.acres || "?"}ac | ${fmt$(comp.pricePerAcre)}/ac | ${comp.saleDate || "—"}`;
      doc.setFontSize(8);
      doc.setTextColor(...DARK);
      doc.text(line, margin + 0.2, y, { maxWidth: pageWidth - margin * 2 - 0.2 });
      y += 0.18;
    }
  } else {
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text("Detailed comps available with Regrid or ATTOM data provider.", margin, y);
    y += 0.2;
  }

  y += 0.15;
  y = addRow(doc, "Estimated Value", fmt$(valuation?.estimate || property?.estimatedValue), y, margin);

  // ─── Page 5: Financial Projections ──────────────────────────────────
  doc.addPage();
  y = addPageHeader(doc, "Financial Projections", 5, margin, pageWidth);

  const estValue = valuation?.estimate || property?.estimatedValue || 0;
  const tiers = [
    { name: "Aggressive (25%)", price: Math.round(estValue * 0.25) },
    { name: "Market (40%)", price: Math.round(estValue * 0.40) },
    { name: "Generous (55%)", price: Math.round(estValue * 0.55) },
  ];

  y = addSection(doc, "Cash Flip Scenarios", y, margin);
  for (const tier of tiers) {
    const profit = estValue - tier.price;
    const roi = tier.price > 0 ? Math.round((profit / tier.price) * 100) : "N/A";
    y = addRow(doc, tier.name, `Buy ${fmt$(tier.price)} → Sell ${fmt$(estValue)} → Profit ${fmt$(profit)} (${roi}% ROI)`, y, margin);
  }

  y += 0.2;
  y = addSection(doc, "Seller Finance Scenarios", y, margin);
  const rates = [7, 9, 11];
  for (const rate of rates) {
    const loanAmt = Math.round(estValue * 0.75);
    const monthly = (loanAmt * (rate / 100 / 12)) / (1 - Math.pow(1 + rate / 100 / 12, -84));
    const totalCollected = Math.round(estValue * 0.25) + Math.round(monthly * 84);
    y = addRow(doc, `${rate}% / 84mo`, `Down ${fmt$(Math.round(estValue * 0.25))} + ${fmt$(Math.round(monthly))}/mo = ${fmt$(Math.round(totalCollected))} total`, y, margin);
  }

  // ─── Page 6: Data Sources & Methodology ─────────────────────────────
  doc.addPage();
  y = addPageHeader(doc, "Data Sources & Methodology", 6, margin, pageWidth);

  const sources = [
    "FEMA NFHL — Flood zone designation",
    "USFWS NWI — Wetlands coverage",
    "EPA ECHO — Superfund/environmental proximity",
    "OpenStreetMap — Road access analysis",
    "USDA Web Soil Survey — Soil type & farmland class",
    "USGS Elevation — Topography/slope",
    "AcreOS Land Credit — 6-dimension scoring",
    "County records — Comparable sales",
    "USDA NASS — Agricultural land values",
    "Census Bureau — Demographics",
  ];

  for (const src of sources) {
    doc.setFontSize(8);
    doc.setTextColor(...DARK);
    doc.text(`• ${src}`, margin + 0.2, y);
    y += 0.16;
  }

  y += 0.2;
  y = addSection(doc, "Disclaimer", y, margin);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text(
    "This report is for informational purposes only and does not constitute legal, financial, or real estate advice. Data is sourced from public APIs and may not reflect current conditions. Always verify critical findings with local authorities before making investment decisions.",
    margin,
    y,
    { maxWidth: pageWidth - margin * 2 },
  );

  doc.setFontSize(7);
  doc.text("Powered by AcreOS — 18 data sources analyzed", margin, 10.3);

  const pdf = Buffer.from(doc.output("arraybuffer"));

  return {
    pdf,
    summary: { riskLevel, redFlags, greenFlags, sourcesQueried, sourcesResponded },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate a 2-page preview (pages 1-2) for the public lead magnet
 */
export async function generatePreviewReport(apn: string, state: string): Promise<Buffer> {
  const doc = new jsPDF({ unit: "in", format: "letter" });
  const margin = 0.75;
  const pageWidth = 8.5;

  // Page 1 — basic property summary
  let y = margin;
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GREEN);
  doc.text("Property Due Diligence Preview", margin, y);
  y += 0.35;

  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  doc.text(`APN: ${apn}`, margin, y);
  y += 0.2;
  doc.text(`State: ${state}`, margin, y);
  y += 0.4;

  doc.setFontSize(9);
  doc.setTextColor(...GRAY);
  doc.text(
    "This is a preview of the full 6-page Due Diligence Report. Sign up for AcreOS to access the complete report with environmental checks, market analysis, financial projections, and more.",
    margin,
    y,
    { maxWidth: pageWidth - margin * 2 },
  );

  y += 0.6;
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GREEN);
  doc.text("Get the full report — Start Free →", margin, y);

  // Page 2 — sample environmental
  doc.addPage();
  y = margin;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GREEN);
  doc.text("Environmental Preview", margin, y);
  y += 0.35;

  doc.setFontSize(9);
  doc.setTextColor(...GRAY);
  doc.text("Full environmental analysis requires a free AcreOS account.", margin, y);

  return Buffer.from(doc.output("arraybuffer"));
}
