import type { Express } from "express";
import { storage } from "./storage";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { usageMeteringService, creditService } from "./services/credits";

export function registerDocumentRoutes(app: Express): void {
  const api = app;

  // DOCUMENT GENERATION
  // ============================================
  
  // Generate promissory note PDF
  api.get("/api/notes/:id/document", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generatePromissoryNote } = await import("./services/documents");
      const org = (req as any).organization;
      
      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
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
      console.error("PDF generation error:", err);
      res.status(err.message === "Note not found" ? 404 : 500).json({ 
        message: err.message || "Failed to generate PDF" 
      });
    }
  });
  
  // Generate warranty deed PDF
  api.get("/api/properties/:id/deed", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generateWarrantyDeed } = await import("./services/documents");
      const org = (req as any).organization;
      
      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
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
      console.error("PDF generation error:", err);
      res.status(err.message === "Property not found" ? 404 : 500).json({ 
        message: err.message || "Failed to generate PDF" 
      });
    }
  });
  
  // Generate offer letter PDF
  api.post("/api/documents/offer-letter", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generateOfferLetter } = await import("./services/documents");
      const org = (req as any).organization;
      const { leadId, propertyId, offerAmount, earnestMoney, closingDate, contingencies, additionalTerms } = req.body;
      
      if (!leadId || !propertyId) {
        return res.status(400).json({ message: "leadId and propertyId are required" });
      }
      
      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
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
      console.error("PDF generation error:", err);
      const notFound = err.message === "Lead not found" || err.message === "Property not found";
      res.status(notFound ? 404 : 500).json({ 
        message: err.message || "Failed to generate PDF" 
      });
    }
  });
  
  // Generate settlement statement PDF (HUD-1 style)
  api.post("/api/documents/generate/settlement-statement", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generateSettlementStatement } = await import("./services/documents");
      const org = (req as any).organization;
      const { propertyId, purchasePrice, closingDate, buyerName, sellerName, earnestMoney, titleInsurance, recordingFees, escrowFees, transferTax, prorations, additionalCosts } = req.body;
      
      if (!propertyId) {
        return res.status(400).json({ message: "propertyId is required" });
      }
      
      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
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
      console.error("PDF generation error:", err);
      res.status(err.message === "Property not found" ? 404 : 500).json({ 
        message: err.message || "Failed to generate PDF" 
      });
    }
  });
  
  // Generate property flyer PDF (marketing material)
  api.post("/api/documents/generate/property-flyer", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generatePropertyFlyer } = await import("./services/documents");
      const org = (req as any).organization;
      const { propertyId, headline, price, priceLabel, highlights, contactName, contactPhone, contactEmail, qrCodePlaceholder } = req.body;
      
      if (!propertyId) {
        return res.status(400).json({ message: "propertyId is required" });
      }
      
      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
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
      console.error("PDF generation error:", err);
      res.status(err.message === "Property not found" ? 404 : 500).json({ 
        message: err.message || "Failed to generate PDF" 
      });
    }
  });
  
  // Generate promissory note PDF
  api.post("/api/documents/generate/promissory-note", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generatePromissoryNote } = await import("./services/documents");
      const org = (req as any).organization;
      const { noteId } = req.body;
      
      if (!noteId) {
        return res.status(400).json({ message: "noteId is required" });
      }
      
      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
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
      console.error("PDF generation error:", err);
      res.status(err.message === "Note not found" ? 404 : 500).json({ 
        message: err.message || "Failed to generate PDF" 
      });
    }
  });
  
  // Generate warranty deed PDF
  api.post("/api/documents/generate/warranty-deed", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generateWarrantyDeed } = await import("./services/documents");
      const org = (req as any).organization;
      const { propertyId } = req.body;
      
      if (!propertyId) {
        return res.status(400).json({ message: "propertyId is required" });
      }
      
      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
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
      console.error("PDF generation error:", err);
      res.status(err.message === "Property not found" ? 404 : 500).json({ 
        message: err.message || "Failed to generate PDF" 
      });
    }
  });
  
  // ============================================

  // DOCUMENT GENERATION
  // ============================================
  
  api.post("/api/documents/generate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { type, entityType, entityId } = req.body;
      
      let documentContent = "";
      let documentTitle = "";
      
      if (entityType === "note" && type === "promissory_note") {
        const note = await storage.getNote(org.id, Number(entityId));
        if (!note) {
          return res.status(404).json({ message: "Note not found" });
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
If any payment is not received within ${note.gracePeriodDays || 10} days after its due date, Borrower agrees to pay a late charge of $${Number(note.lateFee || 0).toLocaleString()}.

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
          return res.status(404).json({ message: "Property not found" });
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
          return res.status(404).json({ message: "Lead not found" });
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
        return res.status(400).json({ message: "Invalid document type or entity" });
      }
      
      res.json({
        title: documentTitle,
        content: documentContent,
        type,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================

}
