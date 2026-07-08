/**
 * Sealed signed-document artifact (Gap 5 — product-truth audit).
 *
 * Until now a "signed" document was app-state: the HTML/text content in
 * generated_documents.content plus detached signature image rows in the
 * `signatures` table. There was no single, portable, court-presentable
 * artifact that composited the agreement + every signature + the audit
 * trail into one self-contained file.
 *
 * This module produces that artifact: a sealed PDF that embeds
 *   1. the document content as it stood at signing,
 *   2. each signature image (drawn/typed/uploaded) rendered inline,
 *   3. the full audit trail per signer (name, email, role, timestamp, IP,
 *      user-agent, consent text),
 *   4. the SHA-256 content hash captured on each signature row + a live
 *      tamper check (does the content still hash to what was signed?),
 * and returns the PDF bytes alongside their SHA-256 so the caller can record
 * a fingerprint of the exact artifact served.
 *
 * It does NOT weaken the existing evidentiary stack — the per-signature
 * documentContentHash + the DB-level immutability trigger
 * (acreos_block_signed_doc_mutation_trigger) + the route-level guard remain
 * the canonical anchors. The sealed PDF is the human-readable, downloadable
 * face of that same evidence.
 *
 * pdfkit is already a dependency (see services/propertyReportPdf.ts) — no new
 * dep, no Fly build-OOM risk.
 */

import crypto from "node:crypto";
import { db } from "../../db";
import { generatedDocuments, signatures as signaturesTable, organizations } from "@shared/schema";
import { and, asc, eq } from "drizzle-orm";
import { logger } from "../../utils/logger";

const PRIMARY = "#9C4221"; // terracotta — AcreOS brand
const TEXT = "#1f2937";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";
const DANGER = "#b91c1c";
const OK = "#15803d";

export interface SealedDocInput {
  organizationId: number;
  documentId: number;
}

export interface SealedDocResult {
  pdf: Buffer;
  /** SHA-256 of the exact PDF bytes returned. */
  sha256: string;
  /** SHA-256 of the document content (null when no content). */
  contentSha256: string | null;
  documentName: string;
  signatureCount: number;
  /** True when there is ≥1 signature and every captured hash matches the
   * content as it stands now (no tampering detected). */
  allHashesMatch: boolean;
}

/**
 * Strip HTML to readable plain text, preserving block boundaries as line
 * breaks. Total on any input — generated content is usually light HTML or
 * already plain text. Not a full HTML renderer (that would need a headless
 * browser); the canonical evidentiary anchor is the content hash, not the
 * pixel-faithful layout.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  return html
    // Block-level close tags / breaks → newline.
    .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\s*\/?\s*>/gi, "\n")
    .replace(/<\s*(p|div|h[1-6]|li|tr)\b[^>]*>/gi, "\n")
    // Drop all remaining tags.
    .replace(/<[^>]+>/g, "")
    // Decode the handful of entities that actually show up.
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    // Collapse runs of blank lines + trailing spaces.
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Parse a base64 data URL into an image Buffer pdfkit can embed. Returns null
 * for non-image signature data (e.g. plain typed text), which the renderer
 * falls back to drawing as text.
 */
export function parseSignatureImage(dataUrl: string): Buffer | null {
  if (typeof dataUrl !== "string") return null;
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  try {
    const buf = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

/**
 * Build the sealed PDF + return its bytes and fingerprint. Throws if the
 * document is not found in the org.
 */
export async function generateSealedDocumentPdf(input: SealedDocInput): Promise<SealedDocResult> {
  const [document] = await db
    .select()
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.id, input.documentId),
        eq(generatedDocuments.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!document) {
    throw new Error("Document not found");
  }

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);

  const sigs = await db
    .select()
    .from(signaturesTable)
    .where(eq(signaturesTable.documentId, input.documentId))
    .orderBy(asc(signaturesTable.createdAt));

  const contentSha256 = document.content
    ? crypto.createHash("sha256").update(document.content).digest("hex")
    : null;

  const allHashesMatch =
    sigs.length > 0 &&
    sigs.every((s) => !!s.documentContentHash && s.documentContentHash === contentSha256);

  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({
    margin: 50,
    info: { Title: `Signed document — ${document.name}`, Author: org?.name ?? "AcreOS" },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ── Header band ──
  doc.rect(0, 0, doc.page.width, 80).fill(PRIMARY);
  doc.fillColor("#ffffff").fontSize(20).font("Helvetica-Bold").text("Signed Document", 50, 26);
  doc
    .fontSize(10)
    .font("Helvetica")
    .text(`${org?.name ?? "AcreOS"} · sealed ${fmtDate(new Date())}`, 50, 52);
  doc.fillColor(TEXT).y = 100;

  // ── Title block ──
  doc.fillColor(TEXT).fontSize(16).font("Helvetica-Bold").text(document.name);
  doc
    .fontSize(10)
    .font("Helvetica")
    .fillColor(MUTED)
    .text(
      [
        `Type: ${document.type}`,
        `Status: ${document.status}`,
        document.completedAt ? `Completed: ${fmtDate(document.completedAt)}` : null,
      ]
        .filter(Boolean)
        .join("  ·  "),
    );
  doc.moveDown(1);

  // ── Section: Agreement ──
  section(doc, "Agreement");
  const body = document.content ? htmlToPlainText(document.content) : "[No document content was captured.]";
  doc.fontSize(10).font("Helvetica").fillColor(TEXT).text(body, { width: doc.page.width - 100, lineGap: 2 });
  doc.moveDown(1);

  // ── Section: Signatures ──
  doc.addPage();
  section(doc, `Signatures (${sigs.length})`);
  if (sigs.length === 0) {
    doc.fontSize(10).font("Helvetica").fillColor(MUTED).text("No signatures have been captured for this document.");
  }
  for (const sig of sigs) {
    // Keep a signature block on one page where possible.
    if (doc.y > doc.page.height - 200) doc.addPage();

    doc.moveDown(0.5);
    doc.fontSize(12).font("Helvetica-Bold").fillColor(TEXT).text(`${sig.signerName} — ${sig.signerRole}`);

    // Signature image (or typed fallback).
    const img = parseSignatureImage(sig.signatureData);
    const yBefore = doc.y;
    if (img) {
      try {
        doc.image(img, 50, yBefore + 4, { fit: [200, 60] });
        doc.y = yBefore + 70;
      } catch (err) {
        logger.warn("[sealedDocumentPdf] failed to embed signature image", {
          metadata: { signatureId: sig.id, error: (err as Error).message },
        });
        doc.fontSize(14).font("Helvetica-Oblique").fillColor(TEXT).text(sig.signerName, 50, yBefore + 4);
        doc.moveDown(0.5);
      }
    } else {
      // Typed/text signature.
      doc.fontSize(16).font("Helvetica-Oblique").fillColor(TEXT).text(sig.signerName, 50, yBefore + 4);
      doc.moveDown(0.5);
    }

    kvRows(doc, [
      ["Email", sig.signerEmail ?? "—"],
      ["Signed at", fmtDate(sig.signedAt ?? sig.createdAt)],
      ["IP address", sig.ipAddress ?? "—"],
      ["Device", sig.userAgent ?? "—"],
      ["Consent", sig.consentGiven ? (sig.consentText ?? "Consent given") : "NOT GIVEN"],
      ["Content hash at signing", sig.documentContentHash ?? "—"],
    ]);
    doc
      .moveTo(50, doc.y)
      .lineTo(doc.page.width - 50, doc.y)
      .strokeColor(RULE)
      .lineWidth(0.5)
      .stroke();
    doc.moveDown(0.4);
  }

  // ── Section: Integrity attestation ──
  if (doc.y > doc.page.height - 180) doc.addPage();
  doc.moveDown(0.6);
  section(doc, "Integrity attestation");
  kvRows(doc, [
    ["Document content SHA-256", contentSha256 ?? "—"],
    ["Signatures captured", String(sigs.length)],
  ]);
  doc
    .fontSize(11)
    .font("Helvetica-Bold")
    .fillColor(sigs.length === 0 ? MUTED : allHashesMatch ? OK : DANGER)
    .text(
      sigs.length === 0
        ? "No signatures to verify."
        : allHashesMatch
          ? "✓ VERIFIED — the document content matches the hash captured by every signature. No tampering detected."
          : "✗ TAMPER WARNING — the document content no longer matches the hash captured at signing.",
      { width: doc.page.width - 100 },
    );
  doc.moveDown(0.6);
  doc
    .fontSize(8)
    .font("Helvetica")
    .fillColor(MUTED)
    .text(
      "This sealed record was generated by AcreOS native e-sign. The content hash above is also enforced at the " +
        "database level (signed documents cannot be mutated) and captured on each signature row at signing time. " +
        "Electronic signatures executed under the ESIGN Act / UETA.",
      { width: doc.page.width - 100, lineGap: 1 },
    );

  doc.end();
  const pdf = await finished;
  const sha256 = crypto.createHash("sha256").update(pdf).digest("hex");

  return {
    pdf,
    sha256,
    contentSha256,
    documentName: document.name,
    signatureCount: sigs.length,
    allHashesMatch,
  };
}

// ── helpers ──

function section(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.6);
  const y = doc.y;
  doc.rect(50, y - 2, 4, 14).fill(PRIMARY);
  doc.fillColor(TEXT).font("Helvetica-Bold").fontSize(12).text(`  ${title}`);
  doc.moveDown(0.4);
}

function kvRows(doc: PDFKit.PDFDocument, rows: Array<[string, string]>) {
  for (const [label, value] of rows) {
    doc.fontSize(9).font("Helvetica").fillColor(MUTED).text(label, { continued: true, width: 170 });
    doc.fillColor(TEXT).font("Helvetica").text(`  ${value || "—"}`, { width: doc.page.width - 100 });
  }
  doc.moveDown(0.4);
}
