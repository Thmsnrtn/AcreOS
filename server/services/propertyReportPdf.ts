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
import { resolveEgressLicense, postureMayLeave, withholdingNotice } from "./licenseEgress";

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
  // Prefer the most-recent row, regardless of source.
  const [snap] = await db
    .select()
    .from(parcelSnapshots)
    .where(
      and(
        eq(parcelSnapshots.apn, prop.apn),
        eq(parcelSnapshots.state, prop.state),
        eq(parcelSnapshots.county, prop.county),
      ),
    )
    .orderBy(desc(parcelSnapshots.fetchedAt))
    .limit(1);

  // ── LICENSE SCREEN (Wave 2.5) ────────────────────────────────────────────
  // A branded PDF is the most redistributive artifact we produce: the customer
  // downloads it and forwards it to a counterparty. parcel_snapshots carries a
  // declared `source`, and for ATTOM / BatchData / Regrid that source resolves
  // to redistributable:"no" — those facts may not ride out in a document we
  // hand over. Property columns the CUSTOMER entered are theirs and are
  // unaffected; only the snapshot-derived block is screened.
  const snapLicense = resolveEgressLicense(snap?.source);
  const snapMayLeave = snap != null && postureMayLeave(snapLicense.posture);
  const licensedSnap = snapMayLeave ? snap : null;
  const pdfNotice = snap != null && !snapMayLeave
    ? withholdingNotice("pdf-artifact", [
        {
          path: "parcelSnapshot",
          label: "parcel snapshot",
          source: snapLicense.source,
          posture: snapLicense.posture,
          reason: snapLicense.reason,
        },
      ])
    : null;

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
    ["Zoning", prop.zoning ?? licensedSnap?.zoning ?? "—"],
    ["Terrain", prop.terrain ?? "—"],
    ["Road access", prop.roadAccess ?? "—"],
  ]);

  // ── Section: Ownership ──
  if (licensedSnap?.owner) {
    section(doc, "Ownership");
    kvRows(doc, [
      ["Owner of record", licensedSnap.owner],
      ["Mailing address", licensedSnap.mailingAddress ?? licensedSnap.ownerAddress ?? "—"],
      ["Source", licensedSnap.source ? `${licensedSnap.source} · fetched ${licensedSnap.fetchedAt?.toLocaleDateString() ?? "—"}` : "—"],
    ]);
  }

  // ── Section: Valuation ──
  section(doc, "Valuation");
  kvRows(doc, [
    ["Assessed value", money(prop.assessedValue ?? licensedSnap?.assessedValue)],
    ["Market value", money(prop.marketValue ?? licensedSnap?.marketValue)],
    ["Property tax", money(licensedSnap?.taxAmount)],
    ["Tax year", licensedSnap?.taxYear ? String(licensedSnap.taxYear) : "—"],
    ["Purchase price", money(prop.purchasePrice)],
    ["Purchase date", prop.purchaseDate?.toLocaleDateString() ?? "—"],
    ["List price", money(prop.listPrice)],
  ]);

  // ── Section: Sales history (last sale from snapshot) ──
  if (licensedSnap?.lastSalePrice || licensedSnap?.lastSaleDate) {
    section(doc, "Sales history");
    kvRows(doc, [
      ["Last sale price", money(licensedSnap.lastSalePrice)],
      ["Last sale date", licensedSnap.lastSaleDate?.toLocaleDateString() ?? "—"],
    ]);
  }

  // ── Section: Legal description ──
  if (prop.legalDescription || licensedSnap?.legalDescription) {
    section(doc, "Legal description");
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor(TEXT)
      .text(prop.legalDescription || licensedSnap?.legalDescription || "—", { width: 500, lineGap: 2 });
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
  // The sources line names what is actually IN the document. When the parcel
  // block was withheld, saying "Sources: ATTOM" would credit a vendor whose
  // facts this PDF does not contain — and hide the hole. The withholding
  // notice rides here so the reader knows the report is thinner and why.
  doc
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      `Sources: ${licensedSnap?.source ?? "AcreOS internal records only"} · Generated by AcreOS Property Reports. ` +
        `This report is informational only and not a title commitment or appraisal.` +
        (pdfNotice ? ` ${pdfNotice}` : ""),
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
