/**
 * Rosy River B9 — Property report PDF.
 *
 * Generates a branded single-property report from the data we already
 * have in `properties` + `parcel_snapshots`. Renders with pdfkit (already
 * in deps, used elsewhere in the codebase — see routes-ai.ts, -borrower,
 * -finance for the import pattern).
 *
 * Caller responsibility: set Content-Type / Content-Disposition, then
 * pipe the returned PDFDocument into the response. This module knows
 * nothing about Express.
 *
 *   const doc = await generatePropertyReport({ propertyId, organizationId });
 *   res.setHeader("Content-Type", "application/pdf");
 *   res.setHeader("Content-Disposition", `attachment; filename="property-${propertyId}.pdf"`);
 *   doc.pipe(res);
 *   doc.end();
 */

import { db } from "../db";
import { properties, parcelSnapshots, organizations } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { parcelSnapshotVisibleTo } from "../storage/gisRepo";

const PRIMARY = "#9C4221"; // terracotta — matches the AcreOS brand
const TEXT = "#1f2937";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";

export interface PropertyReportInput {
  propertyId: number;
  organizationId: number;
}

/**
 * Returns a PDFDocument that the caller should pipe to a response. We
 * don't `doc.end()` here — that's the caller's responsibility so the
 * stream lifecycle stays in their hands.
 */
export async function generatePropertyReport(input: PropertyReportInput) {
  const [prop] = await db
    .select()
    .from(properties)
    .where(
      and(
        eq(properties.id, input.propertyId),
        eq(properties.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!prop) {
    throw new Error("Property not found");
  }

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);

  // Pull the freshest parcel snapshot (county_gis, regrid, or loveland).
  // Prefer the most-recent row, regardless of source — but only among rows this
  // org may see. `organizationId` is nullable on this table and means the shared
  // cache when null; matching on apn+state+county alone would put another org's
  // manually corrected row on this customer's report.
  const [snap] = await db
    .select()
    .from(parcelSnapshots)
    .where(
      and(
        eq(parcelSnapshots.apn, prop.apn),
        eq(parcelSnapshots.state, prop.state),
        eq(parcelSnapshots.county, prop.county),
        parcelSnapshotVisibleTo(input.organizationId),
      ),
    )
    .orderBy(desc(parcelSnapshots.fetchedAt))
    .limit(1);

  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ margin: 50, info: { Title: `Property report — APN ${prop.apn}` } });

  // ── Header band ──
  doc.rect(0, 0, doc.page.width, 80).fill(PRIMARY);
  doc.fillColor("#ffffff").fontSize(20).font("Helvetica-Bold").text("Property Report", 50, 30);
  doc.fontSize(10).font("Helvetica").text(`Generated ${new Date().toLocaleDateString()} · ${org?.name ?? "AcreOS"}`, 50, 55);

  doc.moveTo(0, 80).fillColor(TEXT);
  doc.moveDown(2);

  // ── Title block ──
  doc.fillColor(TEXT).fontSize(16).font("Helvetica-Bold").text(prop.address || `APN ${prop.apn}`);
  doc
    .fontSize(10)
    .font("Helvetica")
    .fillColor(MUTED)
    .text([prop.city, prop.county + " County", prop.state, prop.zip].filter(Boolean).join(" · "));
  doc.moveDown(1);

  // ── Section: Parcel summary ──
  section(doc, "Parcel summary");
  kvRows(doc, [
    ["APN", prop.apn],
    ["County / State", `${prop.county}, ${prop.state}`],
    ["Subdivision", prop.subdivision ?? "—"],
    ["Lot", prop.lotNumber ?? prop.childLotNumber ?? "—"],
    ["Size", prop.sizeAcres ? `${prop.sizeAcres} acres` : "—"],
    ["Zoning", prop.zoning ?? snap?.zoning ?? "—"],
    ["Terrain", prop.terrain ?? "—"],
    ["Road access", prop.roadAccess ?? "—"],
  ]);

  // ── Section: Ownership ──
  if (snap?.owner) {
    section(doc, "Ownership");
    kvRows(doc, [
      ["Owner of record", snap.owner],
      ["Mailing address", snap.mailingAddress ?? snap.ownerAddress ?? "—"],
      ["Source", snap.source ? `${snap.source} · fetched ${snap.fetchedAt?.toLocaleDateString() ?? "—"}` : "—"],
    ]);
  }

  // ── Section: Valuation ──
  section(doc, "Valuation");
  kvRows(doc, [
    ["Assessed value", money(prop.assessedValue ?? snap?.assessedValue)],
    ["Market value", money(prop.marketValue ?? snap?.marketValue)],
    ["Property tax", money(snap?.taxAmount)],
    ["Tax year", snap?.taxYear ? String(snap.taxYear) : "—"],
    ["Purchase price", money(prop.purchasePrice)],
    ["Purchase date", prop.purchaseDate?.toLocaleDateString() ?? "—"],
    ["List price", money(prop.listPrice)],
  ]);

  // ── Section: Sales history (last sale from snapshot) ──
  if (snap?.lastSalePrice || snap?.lastSaleDate) {
    section(doc, "Sales history");
    kvRows(doc, [
      ["Last sale price", money(snap.lastSalePrice)],
      ["Last sale date", snap.lastSaleDate?.toLocaleDateString() ?? "—"],
    ]);
  }

  // ── Section: Legal description ──
  if (prop.legalDescription || snap?.legalDescription) {
    section(doc, "Legal description");
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor(TEXT)
      .text(prop.legalDescription || snap?.legalDescription || "—", { width: 500, lineGap: 2 });
    doc.moveDown(0.8);
  }

  // ── Footer ──
  const footerY = doc.page.height - 70;
  doc
    .moveTo(50, footerY)
    .lineTo(doc.page.width - 50, footerY)
    .strokeColor(RULE)
    .lineWidth(0.5)
    .stroke();
  doc
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      `Sources: ${snap?.source ?? "—"} (parcel) · AcreOS internal records. Generated by AcreOS Property Reports. ` +
        `This report is informational only and not a title commitment or appraisal.`,
      50,
      footerY + 8,
      { width: doc.page.width - 100 },
    );

  return doc;
}

// ── helpers ──

function section(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.6);
  const y = doc.y;
  doc.rect(50, y - 2, 4, 14).fill(PRIMARY);
  doc.fillColor(TEXT).font("Helvetica-Bold").fontSize(12).text(`  ${title}`);
  doc.moveDown(0.4);
}

function kvRows(doc: PDFKit.PDFDocument, rows: Array<[string, string | null | undefined]>) {
  for (const [label, value] of rows) {
    doc.fontSize(9).font("Helvetica").fillColor(MUTED).text(label, { continued: true, width: 150 });
    doc.fillColor(TEXT).font("Helvetica").text(`  ${value || "—"}`);
  }
  doc.moveDown(0.6);
}

function money(v: string | number | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
