/**
 * T38 — Report PDF Export Service
 *
 * Generates PDF exports for key reports:
 *   - Portfolio summary
 *   - Cash flow projection
 *   - Analytics summary
 *
 * Uses jsPDF (already installed). Returns Buffer for HTTP response or S3 upload.
 *
 * Exposed via:
 *   GET /api/portfolio/export-pdf
 *   GET /api/cash-flow/export-pdf
 *   GET /api/analytics/export-pdf
 */

import { jsPDF } from "jspdf";

const GREEN: [number, number, number] = [30, 58, 30];
const GRAY: [number, number, number] = [80, 80, 80];
const DARK: [number, number, number] = [40, 40, 40];
const GOLD: [number, number, number] = [180, 160, 120];

function fmt$(n: number | null | undefined) {
  if (n == null) return "N/A";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return "N/A";
  return `${(n * 100).toFixed(1)}%`;
}

function addPageHeader(doc: jsPDF, title: string, subtitle: string, margin: number, pageWidth: number): number {
  let y = margin;
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GREEN);
  doc.text(title, margin, y);
  y += 0.3;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRAY);
  doc.text(subtitle, margin, y);
  y += 0.1;

  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.015);
  doc.line(margin, y, pageWidth - margin, y);
  return y + 0.28;
}

function addSection(doc: jsPDF, title: string, y: number, margin: number): number {
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...GREEN);
  doc.text(title, margin, y);
  return y + 0.25;
}

function addKVRow(doc: jsPDF, label: string, value: string, y: number, margin: number): number {
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...DARK);
  doc.text(`${label}:`, margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(value, margin + 2.2, y);
  return y + 0.2;
}

// ─── Portfolio Summary PDF ────────────────────────────────────────────────────

export interface PortfolioSummaryData {
  orgName: string;
  generatedDate?: string;
  totalProperties: number;
  activeDeals: number;
  closedDealsThisYear: number;
  portfolioValue: number;
  totalAcquiredCost: number;
  totalEquity: number;
  notesReceivableBalance: number;
  monthlyNoteIncome: number;
  avgCocReturn: number;
  topMarkets: { name: string; count: number; value: number }[];
  pipelineByStage: { stage: string; count: number; value: number }[];
}

export async function generatePortfolioPdf(data: PortfolioSummaryData): Promise<Buffer> {
  const doc = new jsPDF({ unit: "in", format: "letter" });
  const margin = 0.875;
  const pageWidth = 8.5;
  const contentWidth = pageWidth - margin * 2;
  const date = data.generatedDate
    ? new Date(data.generatedDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  let y = addPageHeader(doc, `${data.orgName} — Portfolio Summary`, `Generated ${date}`, margin, pageWidth);

  // Key metrics
  y = addSection(doc, "PORTFOLIO OVERVIEW", y, margin);
  y = addKVRow(doc, "Total Properties", data.totalProperties.toString(), y, margin);
  y = addKVRow(doc, "Active Deals", data.activeDeals.toString(), y, margin);
  y = addKVRow(doc, "Closed This Year", data.closedDealsThisYear.toString(), y, margin);
  y = addKVRow(doc, "Estimated Portfolio Value", fmt$(data.portfolioValue), y, margin);
  y = addKVRow(doc, "Total Acquisition Cost", fmt$(data.totalAcquiredCost), y, margin);
  y = addKVRow(doc, "Total Equity", fmt$(data.totalEquity), y, margin);
  y += 0.1;

  y = addSection(doc, "NOTES RECEIVABLE", y, margin);
  y = addKVRow(doc, "Outstanding Balance", fmt$(data.notesReceivableBalance), y, margin);
  y = addKVRow(doc, "Monthly Note Income", fmt$(data.monthlyNoteIncome), y, margin);
  y = addKVRow(doc, "Avg Cash-on-Cash Return", fmtPct(data.avgCocReturn), y, margin);
  y += 0.1;

  // Pipeline by stage
  if (data.pipelineByStage.length > 0) {
    y = addSection(doc, "PIPELINE BY STAGE", y, margin);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DARK);
    doc.text("Stage", margin, y);
    doc.text("Count", margin + 2.5, y);
    doc.text("Value", margin + 3.5, y);
    y += 0.18;
    doc.setFont("helvetica", "normal");
    for (const stage of data.pipelineByStage) {
      doc.text(stage.stage, margin, y);
      doc.text(stage.count.toString(), margin + 2.5, y);
      doc.text(fmt$(stage.value), margin + 3.5, y);
      y += 0.18;
    }
    y += 0.1;
  }

  // Top markets
  if (data.topMarkets.length > 0) {
    y = addSection(doc, "TOP MARKETS", y, margin);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DARK);
    doc.text("Market", margin, y);
    doc.text("Deals", margin + 2.5, y);
    doc.text("Value", margin + 3.5, y);
    y += 0.18;
    doc.setFont("helvetica", "normal");
    for (const market of data.topMarkets.slice(0, 10)) {
      doc.text(market.name, margin, y);
      doc.text(market.count.toString(), margin + 2.5, y);
      doc.text(fmt$(market.value), margin + 3.5, y);
      y += 0.18;
    }
  }

  // Footer
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(160, 160, 160);
  doc.text("Generated by AcreOS. Confidential — for internal use only.", margin, 10.5);

  return Buffer.from(doc.output("arraybuffer"));
}

// ─── Cash Flow Projection PDF ─────────────────────────────────────────────────

export interface CashFlowPdfData {
  orgName: string;
  propertyAddress?: string;
  months: {
    month: string;
    revenue: number;
    expenses: number;
    netCashFlow: number;
    cumulativeCashFlow: number;
  }[];
  summary: {
    totalRevenue: number;
    totalExpenses: number;
    netProfit: number;
    irr?: number;
    cocReturn?: number;
  };
}

export async function generateCashFlowPdf(data: CashFlowPdfData): Promise<Buffer> {
  const doc = new jsPDF({ unit: "in", format: "letter" });
  const margin = 0.875;
  const pageWidth = 8.5;
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  let y = addPageHeader(
    doc,
    `${data.orgName} — Cash Flow Projection`,
    `${data.propertyAddress || "Portfolio"} • ${date}`,
    margin,
    pageWidth
  );

  // Summary
  y = addSection(doc, "SUMMARY", y, margin);
  y = addKVRow(doc, "Total Revenue", fmt$(data.summary.totalRevenue), y, margin);
  y = addKVRow(doc, "Total Expenses", fmt$(data.summary.totalExpenses), y, margin);
  y = addKVRow(doc, "Net Profit", fmt$(data.summary.netProfit), y, margin);
  if (data.summary.irr != null) y = addKVRow(doc, "IRR", fmtPct(data.summary.irr), y, margin);
  if (data.summary.cocReturn != null) y = addKVRow(doc, "Cash-on-Cash Return", fmtPct(data.summary.cocReturn), y, margin);
  y += 0.15;

  // Monthly table
  y = addSection(doc, "MONTHLY BREAKDOWN", y, margin);
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...DARK);
  const cols = [margin, margin + 1.4, margin + 2.5, margin + 3.6, margin + 4.8];
  ["Month", "Revenue", "Expenses", "Net Cash Flow", "Cumulative"].forEach((h, i) => {
    doc.text(h, cols[i], y);
  });
  y += 0.18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  for (let i = 0; i < data.months.length && y < 10.2; i++) {
    const row = data.months[i];
    if (i % 2 === 0) {
      doc.setFillColor(250, 252, 250);
      doc.rect(margin, y - 0.13, pageWidth - margin * 2, 0.2, "F");
    }
    const netColor = row.netCashFlow >= 0 ? ([20, 100, 40] as [number, number, number]) : ([180, 40, 40] as [number, number, number]);
    doc.setTextColor(...DARK);
    doc.text(row.month, cols[0], y);
    doc.text(fmt$(row.revenue), cols[1], y);
    doc.text(fmt$(row.expenses), cols[2], y);
    doc.setTextColor(...netColor);
    doc.text(fmt$(row.netCashFlow), cols[3], y);
    doc.setTextColor(...DARK);
    doc.text(fmt$(row.cumulativeCashFlow), cols[4], y);
    y += 0.19;
  }

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(160, 160, 160);
  doc.text("Generated by AcreOS. Projections are estimates only.", margin, 10.5);

  return Buffer.from(doc.output("arraybuffer"));
}
