import type { Express } from "express";
import crypto from "crypto";
import { storage } from "./storage";
import { db } from "./db";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { usageMeteringService, creditService } from "./services/credits";
import { deals, properties, leads, notes } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { format as formatDate } from "date-fns";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import {
  checkDisclosure,
  buildDisclosureMissingPayload,
} from "./services/disclosureRegistry";
import { idempotencyMiddleware } from "./middleware/idempotency";

/**
 * Document statuses where the content is considered legally frozen.
 * Any mutation of `content` (or other content-bearing fields) on a document
 * in one of these states would invalidate the SHA-256 hash captured on the
 * associated signature row, breaking evidentiary value. See R2.
 */
const IMMUTABLE_DOCUMENT_STATUSES = new Set([
  "signed",
  "partially_signed",
  "final",
]);

/**
 * Fields whose mutation changes the canonical content of a generated
 * document. When the document is in an immutable status these fields
 * must be rejected.
 */
const CONTENT_BEARING_FIELDS = ["content", "variables", "signers"] as const;

/**
 * Resolve standard context variables from deal/property context.
 * Maps DB fields to the {{variable_name}} namespace used in templates.
 */
async function resolveContextVariables(
  orgId: number,
  dealId?: number | null,
  propertyId?: number | null
): Promise<Record<string, string>> {
  const ctx: Record<string, string> = {};

  // Resolve property context
  let propId = propertyId;
  let deal: any = null;

  if (dealId) {
    const [d] = await db.select().from(deals).where(and(eq(deals.id, dealId), eq(deals.organizationId, orgId))).limit(1);
    if (d) {
      deal = d;
      if (!propId) propId = d.propertyId ?? undefined;
    }
  }

  if (propId) {
    const [prop] = await db.select().from(properties).where(and(eq(properties.id, propId), eq(properties.organizationId, orgId))).limit(1);
    if (prop) {
      ctx['property_address'] = [prop.address, prop.city, prop.state, prop.zip].filter(Boolean).join(', ') || '';
      ctx['property_county'] = prop.county ?? '';
      ctx['property_state'] = prop.state ?? '';
      ctx['property_acres'] = prop.sizeAcres != null ? String(prop.sizeAcres) : '';
      ctx['county'] = prop.county ?? '';
      ctx['state'] = prop.state ?? '';
      ctx['acres'] = prop.sizeAcres != null ? String(prop.sizeAcres) : '';
      ctx['apn'] = prop.apn ?? '';
      ctx['zoning'] = prop.zoning ?? '';

      if (prop.purchasePrice) ctx['purchase_price'] = `$${Number(prop.purchasePrice).toLocaleString()}`;
      if (prop.listPrice) ctx['list_price'] = `$${Number(prop.listPrice).toLocaleString()}`;
      if (prop.marketValue) ctx['market_value'] = `$${Number(prop.marketValue).toLocaleString()}`;

      // Seller
      if (prop.sellerId) {
        const [seller] = await db.select().from(leads).where(eq(leads.id, prop.sellerId)).limit(1);
        if (seller) {
          ctx['seller_name'] = [seller.firstName, seller.lastName].filter(Boolean).join(' ');
          ctx['seller_first_name'] = seller.firstName ?? '';
          ctx['seller_last_name'] = seller.lastName ?? '';
          ctx['seller_email'] = seller.email ?? '';
          ctx['seller_phone'] = seller.phone ?? '';
        }
      }

      // Buyer
      if (prop.buyerId) {
        const [buyer] = await db.select().from(leads).where(eq(leads.id, prop.buyerId)).limit(1);
        if (buyer) {
          ctx['buyer_name'] = [buyer.firstName, buyer.lastName].filter(Boolean).join(' ');
          ctx['buyer_first_name'] = buyer.firstName ?? '';
          ctx['buyer_last_name'] = buyer.lastName ?? '';
          ctx['buyer_email'] = buyer.email ?? '';
          ctx['buyer_phone'] = buyer.phone ?? '';
        }
      }
    }
  }

  // Deal-level fields
  if (deal) {
    if (deal.offerAmount) ctx['offer_amount'] = `$${Number(deal.offerAmount).toLocaleString()}`;
    if (deal.acceptedAmount) ctx['accepted_amount'] = `$${Number(deal.acceptedAmount).toLocaleString()}`;
    if (deal.acceptedAmount || deal.offerAmount) {
      ctx['purchase_price'] = ctx['purchase_price'] || `$${Number(deal.acceptedAmount || deal.offerAmount).toLocaleString()}`;
    }
    if (deal.closingDate) ctx['closing_date'] = formatDate(new Date(deal.closingDate), 'MMMM d, yyyy');
    ctx['deal_type'] = deal.type ?? '';
    ctx['deal_status'] = deal.status ?? '';

    // W6.1 — Assignment Contract auto-fill. The system template's
    // assignment_fee / original_contract_date merge vars were never
    // resolved from context (operators re-typed them). The latest live
    // assignment record on the deal is the source of truth; buyer_name
    // falls back to the assignment's end buyer when the property carries
    // no buyerId.
    try {
      const { contractAssignments } = await import("@shared/schema");
      const [assignment] = await db
        .select()
        .from(contractAssignments)
        .where(and(
          eq(contractAssignments.organizationId, orgId),
          eq(contractAssignments.dealId, deal.id),
          sql`${contractAssignments.status} != 'cancelled'`,
        ))
        .orderBy(desc(contractAssignments.createdAt))
        .limit(1);
      if (assignment) {
        ctx['assignment_fee'] = `$${(assignment.assignmentFeeCents / 100).toLocaleString()}`;
        if (assignment.originalContractDate) {
          ctx['original_contract_date'] = formatDate(new Date(assignment.originalContractDate), 'MMMM d, yyyy');
        }
        if (!ctx['buyer_name'] && assignment.endBuyerName) {
          ctx['buyer_name'] = assignment.endBuyerName;
        }
      }
    } catch { /* assignment table missing on fresh installs — vars stay manual */ }
  }

  // Standard date fields
  ctx['today'] = formatDate(new Date(), 'MMMM d, yyyy');
  ctx['today_short'] = formatDate(new Date(), 'MM/dd/yyyy');

  return ctx;
}

export function registerDocSystemRoutes(app: Express): void {
  const api = app;

  // DOCUMENT TEMPLATES (Phase 4.3-4.5)
  // ============================================

  // GET /api/documents/overview — the Documents page's single-round-trip
  // aggregate (mirrors /api/today's gather-once pattern). Returns the three
  // page-owned lists together; deals/properties dropdown data intentionally
  // stays on the shared /api/deals + /api/properties caches.
  api.get("/api/documents/overview", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      await storage.seedSystemTemplates();
      const [templates, documents, packages] = await Promise.all([
        storage.getDocumentTemplates(org.id),
        storage.getGeneratedDocuments(org.id, {}),
        storage.getDocumentPackages(org.id, {}),
      ]);
      res.json({ templates, documents, packages, generatedAt: new Date().toISOString() });
    } catch (error: any) {
      logger.error("Documents overview error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // GET /api/document-templates - List all templates (system + org-specific)
  api.get("/api/document-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      
      // Seed system templates if none exist
      await storage.seedSystemTemplates();
      
      const templates = await storage.getDocumentTemplates(org.id);
      res.json(templates);
    } catch (error: any) {
      logger.error("Get document templates error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // GET /api/document-templates/:id - Get template by ID
  api.get("/api/document-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);

      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid template ID");
      }

      const template = await storage.getDocumentTemplate(org.id, id);
      // 2026-06-10 (T0-2 sweep): org check was on PUT/PATCH/DELETE but missed
      // on GET — cross-tenant read of another org's contract templates.
      // System templates stay shared (same gate as the preview route).
      if (!template || (!template.isSystemTemplate && template.organizationId !== org.id)) {
        return Errors.notFound(res, "Template");
      }

      res.json(template);
    } catch (error: any) {
      logger.error("Get document template error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // POST /api/document-templates - Create new custom template
  api.post("/api/document-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { name, type, category, content, variables } = req.body;
      
      if (!name || !type || !content) {
        return Errors.badRequest(res, "Name, type, and content are required");
      }
      
      const template = await storage.createDocumentTemplate({
        organizationId: org.id,
        name,
        type,
        category: category || "closing",
        content,
        variables: variables || [],
        isSystemTemplate: false,
        isActive: true,
      });
      
      res.status(201).json(template);
    } catch (error: any) {
      logger.error("Create document template error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // PUT /api/document-templates/:id - Update template
  api.put("/api/document-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid template ID");
      }

      const existing = await storage.getDocumentTemplate(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Template");
      }

      // Only allow editing org-specific templates, not system templates
      if (existing.isSystemTemplate) {
        return Errors.forbidden(res, "Cannot edit system templates");
      }

      // Verify template belongs to this org
      if (existing.organizationId !== org.id) {
        return Errors.forbidden(res, "Not authorized to edit this template");
      }

      const { name, type, category, content, variables, isActive } = req.body;

      const updated = await storage.updateDocumentTemplate(org.id, id, {
        ...(name && { name }),
        ...(type && { type }),
        ...(category && { category }),
        ...(content && { content }),
        ...(variables && { variables }),
        ...(isActive !== undefined && { isActive }),
      });

      res.json(updated);
    } catch (error: any) {
      logger.error("Update document template error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // PATCH /api/document-templates/:id - Update template (alias for PUT)
  api.patch("/api/document-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);

      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid template ID");
      }

      const existing = await storage.getDocumentTemplate(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Template");
      }

      // Only allow editing org-specific templates, not system templates
      if (existing.isSystemTemplate) {
        return Errors.forbidden(res, "Cannot edit system templates");
      }

      // Verify template belongs to this org
      if (existing.organizationId !== org.id) {
        return Errors.forbidden(res, "Not authorized to edit this template");
      }

      const { name, type, category, content, variables, isActive } = req.body;

      const updated = await storage.updateDocumentTemplate(org.id, id, {
        ...(name && { name }),
        ...(type && { type }),
        ...(category && { category }),
        ...(content && { content }),
        ...(variables && { variables }),
        ...(isActive !== undefined && { isActive }),
      });

      res.json(updated);
    } catch (error: any) {
      logger.error("Update document template error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // DELETE /api/document-templates/:id - Delete template
  api.delete("/api/document-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid template ID");
      }

      const existing = await storage.getDocumentTemplate(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Template");
      }

      // Cannot delete system templates
      if (existing.isSystemTemplate) {
        return Errors.forbidden(res, "Cannot delete system templates");
      }

      // Verify template belongs to this org
      if (existing.organizationId !== org.id) {
        return Errors.forbidden(res, "Not authorized to delete this template");
      }

      await storage.deleteDocumentTemplate(id);
      res.json({ success: true });
    } catch (error: any) {
      logger.error("Delete document template error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // POST /api/document-templates/:id/preview - Preview template with sample data
  api.post("/api/document-templates/:id/preview", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid template ID");
      }

      const template = await storage.getDocumentTemplate(org.id, id);
      if (!template) {
        return Errors.notFound(res, "Template");
      }

      // Verify access - either system template or belongs to this org
      if (!template.isSystemTemplate && template.organizationId !== org.id) {
        return Errors.forbidden(res, "Not authorized to preview this template");
      }
      
      // Get sample data from request body or use defaults
      const { sampleData } = req.body;
      
      // Default sample data for common placeholders
      const defaultSampleData: Record<string, string> = {
        // Property fields
        "property.address": "123 Oak Lane, Austin, TX 78701",
        "property.apn": "APN-12345-678",
        "property.county": "Travis",
        "property.state": "Texas",
        "property.sizeAcres": "5.5",
        "property.purchasePrice": "$45,000",
        "property.assessedValue": "$52,000",
        "property.legalDescription": "Lot 42, Block 3, Oak Ridge Subdivision",
        // Lead/Contact fields  
        "lead.firstName": "John",
        "lead.lastName": "Smith",
        "lead.fullName": "John Smith",
        "lead.email": "john.smith@example.com",
        "lead.phone": "(555) 123-4567",
        "lead.address": "456 Maple Street, Dallas, TX 75201",
        // Organization fields
        "organization.name": org.name,
        "organization.email": (org.settings as any)?.companyEmail || "contact@company.com",
        "organization.phone": (org.settings as any)?.companyPhone || "(555) 999-0000",
        "organization.address": (org.settings as any)?.companyAddress || "789 Business Ave, Suite 100",
        // Deal fields
        "deal.title": "Oak Lane Property Acquisition",
        "deal.offerAmount": "$40,000",
        "deal.earnestMoney": "$1,000",
        "deal.closingDate": new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
        // Date fields
        "date.today": new Date().toLocaleDateString(),
        "date.current": new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        // Note/Finance fields
        "note.principal": "$35,000",
        "note.interestRate": "9.9%",
        "note.termMonths": "60",
        "note.monthlyPayment": "$741.52",
        "note.downPayment": "$5,000",
      };
      
      // Merge provided sample data with defaults
      const mergedData = { ...defaultSampleData, ...(sampleData || {}) };
      
      // Replace all placeholders in template content
      let previewContent = template.content;
      for (const [key, value] of Object.entries(mergedData)) {
        // Support both {{key}} and {{key.subkey}} formats
        const regex = new RegExp(`\\{\\{${key.replace('.', '\\.')}\\}\\}`, 'g');
        previewContent = previewContent.replace(regex, String(value));
      }
      
      // Also replace any simple placeholders without dots
      if (template.variables && Array.isArray(template.variables)) {
        for (const variable of template.variables) {
          const varName = variable.name;
          if (!varName.includes('.') && !mergedData[varName]) {
            const defaultValue = variable.defaultValue || `[${varName}]`;
            const regex = new RegExp(`\\{\\{${varName}\\}\\}`, 'g');
            previewContent = previewContent.replace(regex, defaultValue);
          }
        }
      }
      
      // Mark any remaining unresolved placeholders
      previewContent = previewContent.replace(/\{\{([^}]+)\}\}/g, '[$1]');
      
      res.json({
        templateId: template.id,
        templateName: template.name,
        previewContent,
        usedData: mergedData,
      });
    } catch (error: any) {
      logger.error("Preview document template error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // DOCUMENT VERSION HISTORY
  // ============================================

  // GET /api/document-templates/:id/versions - Get version history for a template
  api.get("/api/document-templates/:id/versions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid template ID");
      }

      const versions = await storage.getDocumentVersions(org.id, id, "template");
      res.json(versions);
    } catch (error: any) {
      logger.error("Get template versions error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // POST /api/document-templates/:id/versions - Create a version snapshot for a template
  api.post("/api/document-templates/:id/versions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid template ID");
      }

      const template = await storage.getDocumentTemplate(org.id, id);
      if (!template) {
        return Errors.notFound(res, "Template");
      }

      if (!template.isSystemTemplate && template.organizationId !== org.id) {
        return Errors.forbidden(res, "Not authorized to version this template");
      }
      
      const versions = await storage.getDocumentVersions(org.id, id, "template");
      const nextVersion = versions.length > 0 ? Math.max(...versions.map(v => v.version)) + 1 : 1;
      
      const version = await storage.createDocumentVersion({
        organizationId: org.id,
        documentId: id,
        documentType: "template",
        version: nextVersion,
        content: template.content,
        variables: template.variables,
        changes: req.body.changes || `Version ${nextVersion} created`,
        createdBy: user?.id || user?.id || "system",
      });
      
      res.status(201).json(version);
    } catch (error: any) {
      logger.error("Create template version error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // GET /api/generated-documents/:id/versions - Get version history for a generated document
  api.get("/api/generated-documents/:id/versions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid document ID");
      }

      const versions = await storage.getDocumentVersions(org.id, id, "generated");
      res.json(versions);
    } catch (error: any) {
      logger.error("Get document versions error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // POST /api/generated-documents/:id/versions - Create a version snapshot for a generated document
  api.post("/api/generated-documents/:id/versions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid document ID");
      }

      const doc = await storage.getGeneratedDocument(org.id, id);
      if (!doc) {
        return Errors.notFound(res, "Document");
      }
      
      const versions = await storage.getDocumentVersions(org.id, id, "generated");
      const nextVersion = versions.length > 0 ? Math.max(...versions.map(v => v.version)) + 1 : 1;
      
      const version = await storage.createDocumentVersion({
        organizationId: org.id,
        documentId: id,
        documentType: "generated",
        version: nextVersion,
        content: doc.content || "",
        changes: req.body.changes || `Version ${nextVersion} created`,
        createdBy: user?.id || user?.id || "system",
      });
      
      res.status(201).json(version);
    } catch (error: any) {
      logger.error("Create document version error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // GET /api/documents/versions/:versionId - Get a specific version
  api.get("/api/documents/versions/:versionId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const versionId = parseInt(req.params.versionId);
      
      if (isNaN(versionId)) {
        return Errors.badRequest(res, "Invalid version ID");
      }

      const version = await storage.getDocumentVersion(org.id, versionId);
      if (!version) {
        return Errors.notFound(res, "Version");
      }

      if (version.organizationId !== org.id) {
        return Errors.forbidden(res, "Not authorized to view this version");
      }

      res.json(version);
    } catch (error: any) {
      logger.error("Get version error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // POST /api/documents/versions/:versionId/restore - Restore to a previous version
  api.post("/api/documents/versions/:versionId/restore", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const versionId = parseInt(req.params.versionId);
      
      if (isNaN(versionId)) {
        return Errors.badRequest(res, "Invalid version ID");
      }

      const result = await storage.restoreDocumentVersion(org.id, versionId);

      if (!result.success) {
        return Errors.badRequest(res, result.message);
      }
      
      res.json(result);
    } catch (error: any) {
      logger.error("Restore version error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // GENERATED DOCUMENTS (Phase 4.3-4.5)
  // ============================================

  // GET /api/documents - List generated documents (alias)
  api.get("/api/documents", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = req.query.dealId ? parseInt(req.query.dealId as string) : undefined;
      const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : undefined;
      const status = req.query.status as string | undefined;
      
      const documents = await storage.getGeneratedDocuments(org.id, { dealId, propertyId, status });
      res.json(documents);
    } catch (error: any) {
      logger.error("Get documents error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // POST /api/documents/generate - Generate document from template
  api.post("/api/documents/generate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const { templateId, dealId, propertyId, name, variables } = req.body;
      
      if (!templateId) {
        return Errors.badRequest(res, "Template ID is required");
      }

      const template = await storage.getDocumentTemplate(org.id, templateId);
      // 2026-06-10 (T0-2 sweep): templateId comes from the body — without an
      // org check this rendered another org's template content into a document.
      // System templates (org NULL) stay shared.
      if (!template || (!template.isSystemTemplate && template.organizationId !== org.id)) {
        return Errors.notFound(res, "Template");
      }

      // Auto-resolve context from deal/property, then merge with caller-supplied variables
      // (caller-supplied values take precedence over auto-resolved ones)
      const resolvedCtx = await resolveContextVariables(org.id, dealId, propertyId);
      const mergedVars: Record<string, string> = {
        ...resolvedCtx,
        ...(variables && typeof variables === 'object' ? variables : {}),
      };
      let generatedContent = template.content;
      for (const [key, value] of Object.entries(mergedVars)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        generatedContent = generatedContent.replace(regex, String(value));
      }

      const document = await storage.createGeneratedDocument({
        organizationId: org.id,
        templateId,
        dealId: dealId || null,
        propertyId: propertyId || null,
        name: name || `${template.name} - ${new Date().toLocaleDateString()}`,
        type: template.type,
        content: generatedContent,
        variables: mergedVars,
        status: "draft",
        createdBy: user?.id ? parseInt(user.id) : undefined,
      });

      res.status(201).json(document);
    } catch (error: any) {
      logger.error("Generate document error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // GET /api/documents/resolve-context - Preview resolved template variables for a deal/property
  api.get("/api/documents/resolve-context", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = req.query.dealId ? parseInt(req.query.dealId as string) : null;
      const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : null;
      const ctx = await resolveContextVariables(org.id, dealId, propertyId);
      res.json(ctx);
    } catch (error: any) {
      logger.error("Resolve context error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // GET /api/generated-documents - List generated documents
  api.get("/api/generated-documents", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = req.query.dealId ? parseInt(req.query.dealId as string) : undefined;
      const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : undefined;
      const status = req.query.status as string | undefined;
      
      const documents = await storage.getGeneratedDocuments(org.id, { dealId, propertyId, status });
      res.json(documents);
    } catch (error: any) {
      logger.error("Get generated documents error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // GET /api/generated-documents/:id - Get document by ID
  api.get("/api/generated-documents/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid document ID");
      }

      const document = await storage.getGeneratedDocument(org.id, id);
      if (!document) {
        return Errors.notFound(res, "Document");
      }

      res.json(document);
    } catch (error: any) {
      logger.error("Get generated document error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // POST /api/generated-documents - Generate document from template
  api.post("/api/generated-documents", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const { templateId, dealId, propertyId, name, variables, ackComplianceWarning } = req.body;

      if (!templateId) {
        return Errors.badRequest(res, "Template ID is required");
      }

      const template = await storage.getDocumentTemplate(org.id, templateId);
      // 2026-06-10 (T0-2 sweep): same body-supplied templateId IDOR as
      // /api/documents/generate — enforce org ownership (system templates shared).
      if (!template || (!template.isSystemTemplate && template.organizationId !== org.id)) {
        return Errors.notFound(res, "Template");
      }

      // Auto-resolve context from deal/property, merge with caller-supplied variables
      const resolvedCtx = await resolveContextVariables(org.id, dealId, propertyId);
      const mergedVars: Record<string, string> = {
        ...resolvedCtx,
        ...(variables && typeof variables === 'object' ? variables : {}),
      };

      // ── W-1: Wholesaler state-rule compliance gate ─────────────────────
      // Trey's deal-killer: "If AcreOS lets me generate and send an
      // assignment-of-contract document in a regulated state without a
      // warning, the platform is materially complicit." Block when the
      // state requires a license; warn (with ack) when restrictions apply
      // but assignment may still be permissible.
      if (template.type === "assignment_of_contract") {
        const { checkAssignmentCompliance } = await import("./routes-wholesaler-rules");
        const result = await checkAssignmentCompliance(mergedVars.state);
        if (result.blocked) {
          return res.status(409).json({
            error: "wholesaler_compliance_blocked",
            message: result.summary,
            recommendation: result.recommendation,
            citation: result.citation,
            attorneyReviewed: result.attorneyReviewed,
            statusCode: 409,
          });
        }
        if (result.warn && !ackComplianceWarning) {
          return res.status(409).json({
            error: "wholesaler_compliance_warn",
            message: result.summary,
            recommendation: result.recommendation,
            citation: result.citation,
            attorneyReviewed: result.attorneyReviewed,
            actionRequired: "set ackComplianceWarning=true in the request to acknowledge and proceed",
            statusCode: 409,
          });
        }
      }

      let generatedContent = template.content;
      for (const [key, value] of Object.entries(mergedVars)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        generatedContent = generatedContent.replace(regex, String(value));
      }

      const document = await storage.createGeneratedDocument({
        organizationId: org.id,
        templateId,
        dealId: dealId || null,
        propertyId: propertyId || null,
        name: name || `${template.name} - ${new Date().toLocaleDateString()}`,
        type: template.type,
        content: generatedContent,
        variables: mergedVars,
        status: "draft",
        createdBy: user?.id ? parseInt(user.id) : undefined,
      });

      res.status(201).json(document);
    } catch (error: any) {
      logger.error("Create generated document error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // PUT /api/generated-documents/:id - Update document
  api.put("/api/generated-documents/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid document ID");
      }

      const existing = await storage.getGeneratedDocument(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Document");
      }

      const { name, content, status, signers } = req.body;

      // R2: signed documents are immutable. Reject any update that
      // touches content-bearing fields once the document has reached
      // a frozen status. Renames + status transitions remain allowed
      // (e.g. archive after signing) but the canonical content cannot
      // change without invalidating the signature hash.
      const existingStatus = existing.status ?? "";
      if (IMMUTABLE_DOCUMENT_STATUSES.has(existingStatus)) {
        const attemptedContentChange =
          content !== undefined || signers !== undefined;
        if (attemptedContentChange) {
          logger.warn("Rejected mutation on immutable document", {
            documentId: id,
            organizationId: org.id,
            existingStatus,
            attemptedFields: CONTENT_BEARING_FIELDS.filter(
              (f) => req.body[f] !== undefined,
            ),
          });
          return Errors.forbidden(res, "Signed documents are immutable");
        }
      }

      const updated = await storage.updateGeneratedDocument(
        id,
        {
          ...(name && { name }),
          ...(content && { content }),
          ...(status && { status }),
          ...(signers && { signers }),
        },
        org.id,
      );

      res.json(updated);
    } catch (error: any) {
      logger.error("Update generated document error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // NATIVE E-SIGNATURE SYSTEM (No external service required)
  // ============================================

  // POST /api/signatures - Create a new signature
  api.post("/api/signatures", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { documentId, signerName, signerEmail, signerRole, signatureData, signatureType, consentGiven, consentText } = req.body;
      
      if (!signerName || !signatureData) {
        return Errors.badRequest(res, "Signer name and signature data are required");
      }

      // R2: capture a SHA-256 hash of the document content at the moment
      // this signature is created. Combined with the immutability guard on
      // PUT /api/generated-documents/:id, this provides tamper-evidence:
      // any subsequent mutation of the content will not match the stored hash.
      let documentContentHash: string | null = null;
      if (documentId) {
        const targetDoc = await storage.getGeneratedDocument(org.id, documentId);
        if (targetDoc?.content) {
          documentContentHash = crypto
            .createHash("sha256")
            .update(targetDoc.content)
            .digest("hex");
        }
      }

      const signature = await storage.createSignature({
        organizationId: org.id,
        documentId: documentId || null,
        signerName,
        signerEmail: signerEmail || null,
        signerRole: signerRole || "signer",
        signatureData,
        signatureType: signatureType || "drawn",
        ipAddress: req.ip || (req.headers['x-forwarded-for'] as string) || null,
        userAgent: req.headers['user-agent'] || null,
        consentGiven: consentGiven !== false,
        consentText: consentText || "I agree that this electronic signature is legally binding.",
        documentContentHash,
      });
      
      // If linked to a document, update document signers
      if (documentId) {
        const document = await storage.getGeneratedDocument(org.id, documentId);
        if (document) {
          const existingSigners = (document.signers || []) as Array<{
            id: string;
            name: string;
            email: string;
            role: string;
            signedAt?: string;
            signatureUrl?: string;
          }>;
          
          const updatedSigners = existingSigners.map(s => {
            if (s.name === signerName || s.email === signerEmail) {
              return {
                ...s,
                signedAt: new Date().toISOString(),
                signatureUrl: signatureData,
              };
            }
            return s;
          });
          
          // Check if all signers have signed
          const allSigned = updatedSigners.every(s => s.signedAt);
          
          await storage.updateGeneratedDocument(documentId, {
            signers: updatedSigners,
            status: allSigned ? "signed" : "partially_signed",
            ...(allSigned && { completedAt: new Date() }),
          });
        }
      }
      
      res.json({ success: true, signature });
    } catch (error: any) {
      logger.error("Create signature error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // GET /api/signatures - List signatures
  api.get("/api/signatures", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const documentId = req.query.documentId ? parseInt(req.query.documentId as string) : undefined;
      
      const signatures = await storage.getSignatures(org.id, documentId);
      res.json(signatures);
    } catch (error: any) {
      logger.error("Get signatures error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // GET /api/signatures/:id - Get a specific signature
  api.get("/api/signatures/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid signature ID");
      }

      const signature = await storage.getSignature(org.id, id);
      if (!signature) {
        return Errors.notFound(res, "Signature");
      }

      res.json(signature);
    } catch (error: any) {
      logger.error("Get signature error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // GET /api/generated-documents/:id/signatures - Get signatures for a document
  api.get("/api/generated-documents/:id/signatures", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const documentId = parseInt(req.params.id);
      
      if (isNaN(documentId)) {
        return Errors.badRequest(res, "Invalid document ID");
      }

      const document = await storage.getGeneratedDocument(org.id, documentId);
      if (!document) {
        return Errors.notFound(res, "Document");
      }

      const signatures = await storage.getDocumentSignatures(documentId);
      res.json(signatures);
    } catch (error: any) {
      logger.error("Get document signatures error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // FW-HARLOWE-1 (push-forward 2026-05-08): ESIGN integrity Phase 2 —
  // completion certificate. Returns the legal artifact: doc identity,
  // captured content-hash, hash re-verification (tamper detection), and
  // every signature row with name + email + IP + UA + timestamp +
  // consent text.
  //
  // Harlowe's lead recommendation: "ESIGN content-hash integrity layer +
  // ASC 606 subscription ledger — non-negotiable for acquirer diligence
  // or Series-A." Sam, Wynne, Indira all converged. Post-sign immutability
  // (route-level) + BEFORE-trigger (DB-level, this same migration) +
  // completion certificate (this route) + content-hash re-verification
  // form the four-part ESIGN evidentiary stack.
  //
  // GET /api/generated-documents/:id/completion-certificate
  api.get("/api/generated-documents/:id/completion-certificate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const documentId = parseInt(req.params.id);
      if (isNaN(documentId)) {
        return Errors.badRequest(res, "Invalid document ID");
      }

      const document = await storage.getGeneratedDocument(org.id, documentId);
      if (!document) {
        return Errors.notFound(res, "Document");
      }

      const signatures = await storage.getDocumentSignatures(documentId);
      const currentContentHash = document.content
        ? crypto.createHash("sha256").update(document.content).digest("hex")
        : null;

      // Tamper detection: every signature captures the doc's hash at sign
      // time. If any signature's captured hash differs from the current
      // content hash, the document was mutated post-signature (a route-level
      // and DB-trigger guard SHOULD make this impossible — this check is
      // belt-and-suspenders).
      const tamperEvidence = signatures.map((sig: any) => ({
        signatureId: sig.id,
        signerName: sig.signerName,
        signerEmail: sig.signerEmail,
        signerRole: sig.signerRole,
        signedAt: sig.createdAt,
        ipAddress: sig.ipAddress,
        userAgent: sig.userAgent,
        consentGiven: sig.consentGiven,
        consentText: sig.consentText,
        capturedContentHash: sig.documentContentHash,
        currentContentHash,
        hashMatchesNow: !!sig.documentContentHash
          && sig.documentContentHash === currentContentHash,
      }));

      const allHashesMatch = tamperEvidence.length > 0
        && tamperEvidence.every((s) => s.hashMatchesNow);

      return res.json({
        documentId: document.id,
        documentName: document.name,
        documentType: document.type,
        documentStatus: document.status,
        currentContentHash,
        signatureCount: signatures.length,
        allSignatureHashesMatchCurrentContent: allHashesMatch,
        signatures: tamperEvidence,
        certificateGeneratedAt: new Date().toISOString(),
        certificateAuthority: "AcreOS",
      });
    } catch (error) {
      logger.error("Completion certificate error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // GET /api/generated-documents/:id/sealed-pdf — the sealed signed artifact.
  // Composites the agreement + every signature image + full audit trail +
  // a live content-hash integrity attestation into one portable, court-
  // presentable PDF. The bytes' SHA-256 is returned in X-Document-Sha256 so
  // a downloader can record a fingerprint of the exact artifact served. This
  // is the human-readable face of the evidentiary stack (per-signature hash +
  // DB immutability trigger + completion certificate); it adds no new state.
  api.get("/api/generated-documents/:id/sealed-pdf", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const documentId = parseInt(req.params.id);
      if (isNaN(documentId)) {
        return Errors.badRequest(res, "Invalid document ID");
      }

      const document = await storage.getGeneratedDocument(org.id, documentId);
      if (!document) {
        return Errors.notFound(res, "Document");
      }

      const { generateSealedDocumentPdf } = await import("./services/esign/sealedDocumentPdf");
      const sealed = await generateSealedDocumentPdf({ organizationId: org.id, documentId });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="signed-document-${documentId}.pdf"`);
      res.setHeader("X-Document-Sha256", sealed.sha256);
      res.setHeader("X-Document-Integrity-Verified", String(sealed.allHashesMatch));
      return res.send(sealed.pdf);
    } catch (error) {
      logger.error("Sealed PDF error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // POST /api/generated-documents/:id/request-signature - Request signatures (native system)
  api.post("/api/generated-documents/:id/request-signature", isAuthenticated, getOrCreateOrg, idempotencyMiddleware, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid document ID");
      }

      const document = await storage.getGeneratedDocument(org.id, id);
      if (!document) {
        return Errors.notFound(res, "Document");
      }

      if (document.status !== "draft") {
        return Errors.badRequest(res, "Document has already been sent or signed");
      }

      const { signers } = req.body;

      if (!signers || !Array.isArray(signers) || signers.length === 0) {
        return Errors.badRequest(res, "At least one signer is required");
      }

      // -----------------------------------------------------------------
      // Pre-dispatch state disclosure gate. Returns HTTP 422 with a
      // `DISCLOSURE_MISSING` payload the client UI uses to prompt the
      // operator.
      // -----------------------------------------------------------------
      {
        const variables = ((document.variables as Record<string, unknown>) || {});
        const state =
          (variables.state as string | undefined) ??
          (variables.State as string | undefined) ??
          (variables.stateCode as string | undefined) ??
          "";
        const docType = (document.type || "").toString();
        try {
          const dCheck = checkDisclosure(state, docType, document.content || "");
          if (!dCheck.ok) {
            const payload = buildDisclosureMissingPayload(dCheck);
            return Errors.validationFailed(res, payload);
          }
        } catch (e: any) {
          // Unverified registry entry — fail closed at HTTP 422 with
          // the message the operator (and counsel) needs to act on.
          return Errors.validationFailed(res, {
            code: "DISCLOSURE_MISSING",
            state,
            docType,
            statute: "registry-incomplete",
            requiredHeading: "<<unverified>>",
            missingHeading: true,
            missingPhrases: [],
            friendlyName: e?.message || "Disclosure registry incomplete",
          });
        }
      }

      // Format signers with IDs
      const formattedSigners = signers.map((signer: any, index: number) => ({
        id: `signer-${Date.now()}-${index}`,
        name: signer.name,
        email: signer.email,
        role: signer.role || "signer",
        order: index + 1,
      }));
      
      const updated = await storage.updateGeneratedDocument(id, {
        status: "pending_signature",
        esignProvider: "native",
        esignStatus: "pending",
        signers: formattedSigners,
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      // Per-signer signing links. The token is an HMAC over (docId,
      // signerId) so each external signer's URL is unique, unforgeable,
      // and safe to email. Operators paste these into their own email /
      // SMS send — we don't auto-email from this endpoint.
      const { makeSigningToken } = await import("./services/signingTokens");
      const base = (process.env.APP_URL || req.headers.origin || "").toString().replace(/\/$/, "");
      const signingLinks = formattedSigners.map((s) => ({
        signerId: s.id,
        name: s.name,
        email: s.email,
        role: s.role,
        url: `${base}/sign/${id}?s=${encodeURIComponent(s.id)}&t=${makeSigningToken(id, s.id)}`,
      }));

      res.json({
        success: true,
        message: "Document ready for signature",
        document: updated,
        signingLinks,
      });
    } catch (error: any) {
      logger.error("Request signature error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // NOTE: Public /api/public/sign/:docId endpoints moved to
  // server/routes-public-sign.ts and registered earlier in routes.ts
  // so they are not captured by the /api catch-all isAuthenticated
  // middleware. Search for registerPublicSignRoutes in routes.ts.

  // POST /api/generated-documents/:id/send-for-signature - Send document for e-signature (legacy)
  api.post("/api/generated-documents/:id/send-for-signature", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid document ID");
      }

      const document = await storage.getGeneratedDocument(org.id, id);
      if (!document) {
        return Errors.notFound(res, "Document");
      }

      if (document.status !== "draft") {
        return Errors.badRequest(res, "Document has already been sent or signed");
      }

      const { signers } = req.body;

      const updated = await storage.updateGeneratedDocument(id, {
        status: "pending_signature",
        esignProvider: "native",
        esignStatus: "pending",
        signers: signers || [],
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      
      res.json({
        success: true,
        message: "Document ready for signature",
        document: updated,
      });
    } catch (error: any) {
      logger.error("Send for signature error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // DOCUMENT PACKAGES
  // ============================================

  // GET /api/document-packages - List packages
  api.get("/api/document-packages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = req.query.dealId ? parseInt(req.query.dealId as string) : undefined;
      const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : undefined;
      const status = req.query.status as string | undefined;
      
      const packages = await storage.getDocumentPackages(org.id, { dealId, propertyId, status });
      res.json(packages);
    } catch (error: any) {
      logger.error("Get document packages error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // GET /api/document-packages/:id - Get package with documents
  api.get("/api/document-packages/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid package ID");
      }

      const pkg = await storage.getDocumentPackage(org.id, id);
      if (!pkg) {
        return Errors.notFound(res, "Document package");
      }

      res.json(pkg);
    } catch (error: any) {
      logger.error("Get document package error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // POST /api/document-packages - Create package
  api.post("/api/document-packages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const { name, description, dealId, propertyId, documents } = req.body;
      
      if (!name) {
        return Errors.badRequest(res, "Package name is required");
      }
      
      const pkg = await storage.createDocumentPackage({
        organizationId: org.id,
        name,
        description,
        dealId: dealId || null,
        propertyId: propertyId || null,
        documents: documents || [],
        status: "draft",
        createdBy: user?.id || null,
      });
      
      res.status(201).json(pkg);
    } catch (error: any) {
      logger.error("Create document package error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // PUT /api/document-packages/:id - Update package
  api.put("/api/document-packages/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid package ID");
      }

      const existing = await storage.getDocumentPackage(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Document package");
      }

      const { name, description, dealId, propertyId, documents, status, sentAt, completedAt } = req.body;
      
      const updated = await storage.updateDocumentPackage(id, {
        name,
        description,
        dealId,
        propertyId,
        documents,
        status,
        sentAt: sentAt ? new Date(sentAt) : undefined,
        completedAt: completedAt ? new Date(completedAt) : undefined,
      });
      
      res.json(updated);
    } catch (error: any) {
      logger.error("Update document package error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // DELETE /api/document-packages/:id - Delete package
  api.delete("/api/document-packages/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid package ID");
      }

      const deleted = await storage.deleteDocumentPackage(org.id, id);
      if (!deleted) {
        return Errors.notFound(res, "Document package");
      }
      
      res.json({ success: true, message: "Document package deleted" });
    } catch (error: any) {
      logger.error("Delete document package error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // POST /api/document-packages/:id/documents - Add document/template to package
  api.post("/api/document-packages/:id/documents", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid package ID");
      }

      const pkg = await storage.getDocumentPackage(org.id, id);
      if (!pkg) {
        return Errors.notFound(res, "Document package");
      }

      const { templateId, documentId, name } = req.body;

      if (!templateId && !documentId) {
        return Errors.badRequest(res, "Either templateId or documentId is required");
      }
      
      const currentDocs = pkg.documents || [];
      const newOrder = currentDocs.length + 1;
      
      const newDoc = {
        templateId: templateId || 0,
        documentId: documentId || undefined,
        order: newOrder,
        status: "pending",
        name: name || undefined,
      };
      
      const updated = await storage.updateDocumentPackage(id, {
        documents: [...currentDocs, newDoc],
      });
      
      res.json(updated);
    } catch (error: any) {
      logger.error("Add document to package error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // DELETE /api/document-packages/:id/documents/:docIndex - Remove document from package
  api.delete("/api/document-packages/:id/documents/:docIndex", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const docIndex = parseInt(req.params.docIndex);
      
      if (isNaN(id) || isNaN(docIndex)) {
        return Errors.badRequest(res, "Invalid package ID or document index");
      }

      const pkg = await storage.getDocumentPackage(org.id, id);
      if (!pkg) {
        return Errors.notFound(res, "Document package");
      }
      
      const currentDocs = pkg.documents || [];
      if (docIndex < 0 || docIndex >= currentDocs.length) {
        return Errors.badRequest(res, "Invalid document index");
      }
      
      const updatedDocs = currentDocs.filter((_, i) => i !== docIndex);
      const reorderedDocs = updatedDocs.map((doc, i) => ({ ...doc, order: i + 1 }));
      
      const updated = await storage.updateDocumentPackage(id, {
        documents: reorderedDocs,
      });
      
      res.json(updated);
    } catch (error: any) {
      logger.error("Remove document from package error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // POST /api/document-packages/:id/generate-all - Generate all documents in package
  api.post("/api/document-packages/:id/generate-all", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid package ID");
      }

      const pkg = await storage.getDocumentPackage(org.id, id);
      if (!pkg) {
        return Errors.notFound(res, "Document package");
      }

      const { variables } = req.body;
      const currentDocs = pkg.documents || [];
      const generatedDocs: any[] = [];
      
      for (const docItem of currentDocs) {
        if (docItem.documentId) {
          generatedDocs.push({ ...docItem, status: "generated" });
          continue;
        }
        
        const template = await storage.getDocumentTemplate(org.id, docItem.templateId);
        if (!template) {
          generatedDocs.push({ ...docItem, status: "error" });
          continue;
        }
        
        // Security: Ensure template belongs to this org or is a system template
        if (template.organizationId !== null && template.organizationId !== org.id) {
          generatedDocs.push({ ...docItem, status: "error" });
          continue;
        }
        
        let content = template.content;
        const mergedVars = { ...variables };
        
        if (pkg.dealId) {
          const deal = await storage.getDeal(org.id, pkg.dealId);
          if (deal) {
            Object.assign(mergedVars, {
              // deals has no `name` column; compose a stable label from type+id.
              deal_name: `${deal.type ?? "Deal"} #${deal.id}`,
              offer_amount: deal.offerAmount,
              accepted_amount: deal.acceptedAmount,
            });
          }
        }
        
        if (pkg.propertyId) {
          const property = await storage.getProperty(org.id, pkg.propertyId);
          if (property) {
            Object.assign(mergedVars, {
              property_address: property.address,
              property_city: property.city,
              property_state: property.state,
              property_zip: property.zip,
              parcel_number: property.apn,
              acreage: property.sizeAcres,
            });
          }
        }
        
        for (const [key, value] of Object.entries(mergedVars)) {
          const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
          content = content.replace(regex, String(value || ''));
        }
        
        const generatedDoc = await storage.createGeneratedDocument({
          organizationId: org.id,
          templateId: template.id,
          dealId: pkg.dealId || undefined,
          propertyId: pkg.propertyId || undefined,
          name: docItem.name || template.name,
          type: template.type,
          content,
          variables: mergedVars,
          status: "draft",
          generatedBy: user?.id,
        });
        
        generatedDocs.push({
          ...docItem,
          documentId: generatedDoc.id,
          status: "generated",
        });
      }
      
      const updated = await storage.updateDocumentPackage(id, {
        documents: generatedDocs,
        status: "complete",
      });
      
      res.json({
        success: true,
        message: `Generated ${generatedDocs.filter(d => d.status === 'generated').length} documents`,
        package: updated,
      });
    } catch (error: any) {
      logger.error("Generate all documents error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // GET /api/deals/:id/packages - Get packages for a deal
  api.get("/api/deals/:id/packages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const dealId = parseInt(req.params.id);
      
      if (isNaN(dealId)) {
        return Errors.badRequest(res, "Invalid deal ID");
      }
      
      const packages = await storage.getPackagesByDeal(org.id, dealId);
      res.json(packages);
    } catch (error: any) {
      logger.error("Get deal packages error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // GET /api/properties/:id/packages - Get packages for a property
  api.get("/api/properties/:id/packages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = parseInt(req.params.id);
      
      if (isNaN(propertyId)) {
        return Errors.badRequest(res, "Invalid property ID");
      }
      
      const packages = await storage.getPackagesByProperty(org.id, propertyId);
      res.json(packages);
    } catch (error: any) {
      logger.error("Get property packages error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // ============================================

}
