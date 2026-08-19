import type { Express } from "express";
import { storage } from "./storage";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { usageMeteringService, creditService } from "./services/credits";
import { logger } from "./utils/logger";
import { assertFeeSimpleOrThrow, handleLandStatusError } from "./utils/landStatus";
import { noteGracePeriodDays } from "@shared/notes/delinquency";

/**
 * The LATE CHARGES clause of a generated promissory note.
 *
 * This was a template literal reading `note.gracePeriodDays || 10`. Two things
 * were wrong with it, and this is a document with a SIGNATURES block:
 *
 *  1. `||` fires on `0`, so a note whose record explicitly grants NO grace
 *     period produced an instrument promising ten days;
 *  2. when the record states no grace period at all, the clause asserted a term
 *     nobody agreed to — while `acquiredNoteAging` measured that same note's
 *     delinquency against ZERO days. The engine and the signed note disagreed.
 *
 * Both now read `noteGracePeriodDays`. When the record does not state a term,
 * the clause says so instead of inventing one, and names the field to set.
 */
function lateChargeClause(note: {
  gracePeriodDays?: number | null;
  lateFee?: unknown;
}): string {
  const grace = noteGracePeriodDays(note.gracePeriodDays);
  const lateFee = Number(note.lateFee ?? 0);
  const feeText = `$${lateFee.toLocaleString()}`;

  if (grace === null) {
    return (
      "This note does not state a grace period. No late charge terms are " +
      "included; set the note's grace period before issuing this instrument " +
      "if a late charge is intended."
    );
  }
  if (grace === 0) {
    return (
      `If any payment is not received on its due date, Borrower agrees to pay ` +
      `a late charge of ${feeText}.`
    );
  }
  return (
    `If any payment is not received within ${grace} day${grace === 1 ? "" : "s"} ` +
    `after its due date, Borrower agrees to pay a late charge of ${feeText}.`
  );
}

import { Errors } from "./utils/errors";

export function registerDocumentRoutes(app: Express): void {
  const api = app;

  // DOCUMENT GENERATION
  // ============================================
  
  // Generate promissory note PDF
  api.get("/api/notes/:id/document", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generatePromissoryNote } = await import("./services/documents");
      const org = req.organization;
      
      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return Errors.paymentRequired(res, "Insufficient credits", {
          required: pdfCost / 100,
          balance: balance / 100,
        });
      }
      
      const pdfBuffer = await generatePromissoryNote(Number(req.params.id), org.id);
      
      // Record usage after successful PDF generation
      await usageMeteringService.recordUsage(org.id, "pdf_generated", 1, {
        documentType: "promissory_note",
        noteId: Number(req.params.id),
      });
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="promissory-note-${req.params.id}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      logger.error("PDF generation error", err);
      if (err.message === "Note not found") return Errors.notFound(res, "Note");
      return Errors.internal(res, err);
    }
  });
  
  // Generate warranty deed PDF
  api.get("/api/properties/:id/deed", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generateWarrantyDeed } = await import("./services/documents");
      const org = req.organization;

      // Aniyah §2 — block deed auto-doc on Indian-Country / federal trust
      // parcels. Title transfers on these parcels require BIA approval
      // (25 CFR §152) and a generic warranty deed would be federally void.
      const parcelForDeed = await storage.getProperty(org.id, Number(req.params.id));
      assertFeeSimpleOrThrow(parcelForDeed ?? null, "warranty-deed");

      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return Errors.paymentRequired(res, "Insufficient credits", {
          required: pdfCost / 100,
          balance: balance / 100,
        });
      }
      
      const pdfBuffer = await generateWarrantyDeed(Number(req.params.id), org.id);
      
      // Record usage after successful PDF generation
      await usageMeteringService.recordUsage(org.id, "pdf_generated", 1, {
        documentType: "warranty_deed",
        propertyId: Number(req.params.id),
      });
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="warranty-deed-${req.params.id}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      if (handleLandStatusError(res, err)) return;
      logger.error("PDF generation error", err);
      if (err.message === "Property not found") return Errors.notFound(res, "Property");
      return Errors.internal(res, err);
    }
  });

  // Generate offer letter PDF
  api.post("/api/documents/offer-letter", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generateOfferLetter } = await import("./services/documents");
      const org = req.organization;
      const { leadId, propertyId, offerAmount, earnestMoney, closingDate, contingencies, additionalTerms } = req.body;

      if (!leadId || !propertyId) {
        return Errors.badRequest(res, "leadId and propertyId are required");
      }

      // Aniyah §2 — block offer-letter auto-doc on Indian-Country parcels.
      const parcelForOffer = await storage.getProperty(org.id, Number(propertyId));
      assertFeeSimpleOrThrow(parcelForOffer ?? null, "offer-letter");

      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return Errors.paymentRequired(res, "Insufficient credits", {
          required: pdfCost / 100,
          balance: balance / 100,
        });
      }

      const pdfBuffer = await generateOfferLetter(
        Number(leadId),
        Number(propertyId),
        org.id,
        { offerAmount, earnestMoney, closingDate, contingencies, additionalTerms }
      );

      // Record usage after successful PDF generation
      await usageMeteringService.recordUsage(org.id, "pdf_generated", 1, {
        documentType: "offer_letter",
        leadId: Number(leadId),
        propertyId: Number(propertyId),
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="offer-letter-${leadId}-${propertyId}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      if (handleLandStatusError(res, err)) return;
      logger.error("PDF generation error", err);
      if (err.message === "Lead not found") return Errors.notFound(res, "Lead");
      if (err.message === "Property not found") return Errors.notFound(res, "Property");
      return Errors.internal(res, err);
    }
  });
  
  // Generate settlement statement PDF (HUD-1 style)
  api.post("/api/documents/generate/settlement-statement", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generateSettlementStatement } = await import("./services/documents");
      const org = req.organization;
      const { propertyId, purchasePrice, closingDate, buyerName, sellerName, earnestMoney, titleInsurance, recordingFees, escrowFees, transferTax, prorations, additionalCosts } = req.body;

      if (!propertyId) {
        return Errors.badRequest(res, "propertyId is required");
      }

      // Aniyah §2 — block settlement-statement auto-doc on Indian-Country parcels.
      const parcelForSettlement = await storage.getProperty(org.id, Number(propertyId));
      assertFeeSimpleOrThrow(parcelForSettlement ?? null, "settlement-statement");

      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return Errors.paymentRequired(res, "Insufficient credits", {
          required: pdfCost / 100,
          balance: balance / 100,
        });
      }

      const pdfBuffer = await generateSettlementStatement(
        Number(propertyId),
        org.id,
        { purchasePrice, closingDate, buyerName, sellerName, earnestMoney, titleInsurance, recordingFees, escrowFees, transferTax, prorations, additionalCosts }
      );

      // Record usage after successful PDF generation
      await usageMeteringService.recordUsage(org.id, "pdf_generated", 1, {
        documentType: "settlement_statement",
        propertyId: Number(propertyId),
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="settlement-statement-${propertyId}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      if (handleLandStatusError(res, err)) return;
      logger.error("PDF generation error", err);
      if (err.message === "Property not found") return Errors.notFound(res, "Property");
      return Errors.internal(res, err);
    }
  });
  
  // Generate property flyer PDF (marketing material)
  api.post("/api/documents/generate/property-flyer", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generatePropertyFlyer } = await import("./services/documents");
      const org = req.organization;
      const { propertyId, headline, price, priceLabel, highlights, contactName, contactPhone, contactEmail, qrCodePlaceholder } = req.body;
      
      if (!propertyId) {
        return Errors.badRequest(res, "propertyId is required");
      }
      
      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return Errors.paymentRequired(res, "Insufficient credits", {
          required: pdfCost / 100,
          balance: balance / 100,
        });
      }
      
      const pdfBuffer = await generatePropertyFlyer(
        Number(propertyId),
        org.id,
        { headline, price, priceLabel, highlights, contactName, contactPhone, contactEmail, qrCodePlaceholder }
      );
      
      // Record usage after successful PDF generation
      await usageMeteringService.recordUsage(org.id, "pdf_generated", 1, {
        documentType: "property_flyer",
        propertyId: Number(propertyId),
      });
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="property-flyer-${propertyId}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      logger.error("PDF generation error", err);
      if (err.message === "Property not found") return Errors.notFound(res, "Property");
      return Errors.internal(res, err);
    }
  });
  
  // Generate promissory note PDF
  api.post("/api/documents/generate/promissory-note", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generatePromissoryNote } = await import("./services/documents");
      const org = req.organization;
      const { noteId } = req.body;
      
      if (!noteId) {
        return Errors.badRequest(res, "noteId is required");
      }
      
      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return Errors.paymentRequired(res, "Insufficient credits", {
          required: pdfCost / 100,
          balance: balance / 100,
        });
      }
      
      const pdfBuffer = await generatePromissoryNote(Number(noteId), org.id);
      
      // Record usage after successful PDF generation
      await usageMeteringService.recordUsage(org.id, "pdf_generated", 1, {
        documentType: "promissory_note",
        noteId: Number(noteId),
      });
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="promissory-note-${noteId}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      logger.error("PDF generation error", err);
      if (err.message === "Note not found") return Errors.notFound(res, "Note");
      return Errors.internal(res, err);
    }
  });
  
  // Generate warranty deed PDF
  api.post("/api/documents/generate/warranty-deed", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generateWarrantyDeed } = await import("./services/documents");
      const org = req.organization;
      const { propertyId } = req.body;

      if (!propertyId) {
        return Errors.badRequest(res, "propertyId is required");
      }

      // Aniyah §2 — block deed auto-doc on Indian-Country parcels.
      const parcelForDeedPost = await storage.getProperty(org.id, Number(propertyId));
      assertFeeSimpleOrThrow(parcelForDeedPost ?? null, "warranty-deed");

      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return Errors.paymentRequired(res, "Insufficient credits", {
          required: pdfCost / 100,
          balance: balance / 100,
        });
      }

      const pdfBuffer = await generateWarrantyDeed(Number(propertyId), org.id);

      // Record usage after successful PDF generation
      await usageMeteringService.recordUsage(org.id, "pdf_generated", 1, {
        documentType: "warranty_deed",
        propertyId: Number(propertyId),
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="warranty-deed-${propertyId}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      if (handleLandStatusError(res, err)) return;
      logger.error("PDF generation error", err);
      if (err.message === "Property not found") return Errors.notFound(res, "Property");
      return Errors.internal(res, err);
    }
  });
  
  // ============================================

  // DOCUMENT GENERATION
  // ============================================
  
  api.post("/api/documents/generate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { type, entityType, entityId } = req.body;
      
      let documentContent = "";
      let documentTitle = "";
      
      if (entityType === "note" && type === "promissory_note") {
        const note = await storage.getNote(org.id, Number(entityId));
        if (!note) {
          return Errors.notFound(res, "Note");
        }
        
        let borrowerName = "Borrower";
        if (note.borrowerId) {
          const borrower = await storage.getLead(org.id, note.borrowerId);
          if (borrower) {
            borrowerName = `${borrower.firstName} ${borrower.lastName}`;
          }
        }
        
        let propertyDesc = "Property";
        if (note.propertyId) {
          const property = await storage.getProperty(org.id, note.propertyId);
          if (property) {
            propertyDesc = `${property.county} County, ${property.state} - APN: ${property.apn}`;
          }
        }
        
        const startDateStr = note.startDate ? new Date(note.startDate).toLocaleDateString() : new Date().toLocaleDateString();
        
        documentTitle = `Promissory Note - ${borrowerName}`;
        documentContent = `
PROMISSORY NOTE

Date: ${startDateStr}
Lender: ${org.name}
Borrower: ${borrowerName}

Property: ${propertyDesc}

PROMISE TO PAY
For value received, Borrower promises to pay to Lender the principal sum of $${Number(note.originalPrincipal).toLocaleString()} with interest at the rate of ${note.interestRate}% per annum.

PAYMENT TERMS
- Monthly Payment: $${Number(note.monthlyPayment).toLocaleString()}
- Term: ${note.termMonths} months
- First Payment Due: ${note.firstPaymentDate ? new Date(note.firstPaymentDate).toLocaleDateString() : 'TBD'}

LATE CHARGES
${lateChargeClause(note)}

DEFAULT
If Borrower fails to make any payment when due, the entire unpaid principal balance and accrued interest shall become immediately due and payable at Lender's option.

SIGNATURES

_______________________          _______________________
Lender                           Borrower
${org.name}                      ${borrowerName}
`;
      } else if (entityType === "property" && type === "deed") {
        const property = await storage.getProperty(org.id, Number(entityId));
        if (!property) {
          return Errors.notFound(res, "Property");
        }
        
        documentTitle = `Warranty Deed - ${property.apn}`;
        documentContent = `
WARRANTY DEED

This Warranty Deed is made this _____ day of ____________, 20___

GRANTOR: ${org.name}

GRANTEE: _________________________________

PROPERTY DESCRIPTION:
County: ${property.county}
State: ${property.state}
Assessor's Parcel Number (APN): ${property.apn}

Legal Description:
${property.legalDescription || "[ATTACH LEGAL DESCRIPTION]"}

CONSIDERATION: $________________

GRANTOR hereby conveys and warrants to GRANTEE the above-described property, together with all improvements thereon, free and clear of all encumbrances except those of record.

SIGNATURES

_______________________          Date: ________________
Grantor

STATE OF ${property.state}
COUNTY OF ${property.county}

[NOTARY ACKNOWLEDGMENT]
`;
      } else if (entityType === "lead" && type === "offer_letter") {
        const lead = await storage.getLead(org.id, Number(entityId));
        if (!lead) {
          return Errors.notFound(res, "Lead");
        }
        
        const sellerAddress = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ");
        
        documentTitle = `Offer Letter - ${lead.firstName} ${lead.lastName}`;
        documentContent = `
OFFER TO PURCHASE REAL ESTATE

Date: ${new Date().toLocaleDateString()}

From: ${org.name}

To: ${lead.firstName} ${lead.lastName}
${sellerAddress || "[Address]"}

Dear ${lead.firstName} ${lead.lastName},

We are interested in purchasing your property and would like to make you the following offer:

PROPERTY INFORMATION:
[Property details to be filled in]

OFFER TERMS:
Purchase Price: $________________
Closing Date: Within 30 days of acceptance
Payment Method: [Cash/Financing]

This offer is subject to clear title and satisfactory inspection.

This offer is valid for 14 days from the date above.

If you have any questions or would like to discuss this offer, please contact us.

Sincerely,

_______________________
${org.name}

---

ACCEPTANCE

I/We accept this offer on the terms stated above.

_______________________          Date: ________________
Seller Signature

_______________________          Date: ________________
Seller Signature (if applicable)
`;
      } else {
        return Errors.badRequest(res, "Invalid document type or entity");
      }
      
      res.json({
        title: documentTitle,
        content: documentContent,
        type,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ─── Deed of Trust PDF ───────────────────────────────────────────────────
  api.post("/api/documents/deed-of-trust", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generateDeedOfTrust } = await import("./services/documents");
      const org = req.organization;

      // Aniyah §2 — block deed-of-trust auto-doc on Indian-Country parcels.
      // Caller may pass propertyId in the body to bind the deed to a specific
      // parcel; if so we look up its landStatus and require 'fee'.
      if (req.body?.propertyId) {
        const parcelForDot = await storage.getProperty(org.id, Number(req.body.propertyId));
        assertFeeSimpleOrThrow(parcelForDot ?? null, "deed-of-trust");
      }

      const pdfBuffer = await generateDeedOfTrust({ ...req.body, orgName: org.name });
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `attachment; filename="deed-of-trust.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      if (handleLandStatusError(res, err)) return;
      Errors.internal(res, err);
    }
  });

  // ─── Land Contract PDF ───────────────────────────────────────────────────
  api.post("/api/documents/land-contract", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generateLandContract } = await import("./services/documents");
      const org = req.organization;

      // Aniyah §2 — block land-contract (contract for deed) auto-doc on
      // Indian-Country parcels. Trust-land transfers require BIA approval
      // (25 CFR §152) and a generic land contract would be federally void.
      if (req.body?.propertyId) {
        const parcelForLc = await storage.getProperty(org.id, Number(req.body.propertyId));
        assertFeeSimpleOrThrow(parcelForLc ?? null, "land-contract");
      }

      const pdfBuffer = await generateLandContract({ ...req.body, orgName: org.name });
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `attachment; filename="land-contract.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      if (handleLandStatusError(res, err)) return;
      Errors.internal(res, err);
    }
  });

  // ============================================

}
