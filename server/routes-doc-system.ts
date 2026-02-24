import type { Express } from "express";
import { storage } from "./storage";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { usageMeteringService, creditService } from "./services/credits";

export function registerDocSystemRoutes(app: Express): void {
  const api = app;

  // DOCUMENT TEMPLATES (Phase 4.3-4.5)
  // ============================================

  // GET /api/document-templates - List all templates (system + org-specific)
  api.get("/api/document-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      // Seed system templates if none exist
      await storage.seedSystemTemplates();
      
      const templates = await storage.getDocumentTemplates(org.id);
      res.json(templates);
    } catch (error: any) {
      console.error("Get document templates error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch templates" });
    }
  });

  // GET /api/document-templates/:id - Get template by ID
  api.get("/api/document-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      const template = await storage.getDocumentTemplate(id);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      res.json(template);
    } catch (error: any) {
      console.error("Get document template error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch template" });
    }
  });

  // POST /api/document-templates - Create new custom template
  api.post("/api/document-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { name, type, category, content, variables } = req.body;
      
      if (!name || !type || !content) {
        return res.status(400).json({ message: "Name, type, and content are required" });
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
      console.error("Create document template error:", error);
      res.status(500).json({ message: error.message || "Failed to create template" });
    }
  });

  // PUT /api/document-templates/:id - Update template
  api.put("/api/document-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      const existing = await storage.getDocumentTemplate(id);
      if (!existing) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      // Only allow editing org-specific templates, not system templates
      if (existing.isSystemTemplate) {
        return res.status(403).json({ message: "Cannot edit system templates" });
      }
      
      // Verify template belongs to this org
      if (existing.organizationId !== org.id) {
        return res.status(403).json({ message: "Not authorized to edit this template" });
      }
      
      const { name, type, category, content, variables, isActive } = req.body;
      
      const updated = await storage.updateDocumentTemplate(id, {
        ...(name && { name }),
        ...(type && { type }),
        ...(category && { category }),
        ...(content && { content }),
        ...(variables && { variables }),
        ...(isActive !== undefined && { isActive }),
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Update document template error:", error);
      res.status(500).json({ message: error.message || "Failed to update template" });
    }
  });

  // PATCH /api/document-templates/:id - Update template (alias for PUT)
  api.patch("/api/document-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      const existing = await storage.getDocumentTemplate(id);
      if (!existing) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      // Only allow editing org-specific templates, not system templates
      if (existing.isSystemTemplate) {
        return res.status(403).json({ message: "Cannot edit system templates" });
      }
      
      // Verify template belongs to this org
      if (existing.organizationId !== org.id) {
        return res.status(403).json({ message: "Not authorized to edit this template" });
      }
      
      const { name, type, category, content, variables, isActive } = req.body;
      
      const updated = await storage.updateDocumentTemplate(id, {
        ...(name && { name }),
        ...(type && { type }),
        ...(category && { category }),
        ...(content && { content }),
        ...(variables && { variables }),
        ...(isActive !== undefined && { isActive }),
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Update document template error:", error);
      res.status(500).json({ message: error.message || "Failed to update template" });
    }
  });

  // DELETE /api/document-templates/:id - Delete template
  api.delete("/api/document-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      const existing = await storage.getDocumentTemplate(id);
      if (!existing) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      // Cannot delete system templates
      if (existing.isSystemTemplate) {
        return res.status(403).json({ message: "Cannot delete system templates" });
      }
      
      // Verify template belongs to this org
      if (existing.organizationId !== org.id) {
        return res.status(403).json({ message: "Not authorized to delete this template" });
      }
      
      await storage.deleteDocumentTemplate(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete document template error:", error);
      res.status(500).json({ message: error.message || "Failed to delete template" });
    }
  });

  // POST /api/document-templates/:id/preview - Preview template with sample data
  api.post("/api/document-templates/:id/preview", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      const template = await storage.getDocumentTemplate(id);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      // Verify access - either system template or belongs to this org
      if (!template.isSystemTemplate && template.organizationId !== org.id) {
        return res.status(403).json({ message: "Not authorized to preview this template" });
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
      console.error("Preview document template error:", error);
      res.status(500).json({ message: error.message || "Failed to preview template" });
    }
  });

  // ============================================
  // DOCUMENT VERSION HISTORY
  // ============================================

  // GET /api/document-templates/:id/versions - Get version history for a template
  api.get("/api/document-templates/:id/versions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      const versions = await storage.getDocumentVersions(org.id, id, "template");
      res.json(versions);
    } catch (error: any) {
      console.error("Get template versions error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch version history" });
    }
  });

  // POST /api/document-templates/:id/versions - Create a version snapshot for a template
  api.post("/api/document-templates/:id/versions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      const template = await storage.getDocumentTemplate(id);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      if (!template.isSystemTemplate && template.organizationId !== org.id) {
        return res.status(403).json({ message: "Not authorized to version this template" });
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
        createdBy: user?.id || user?.claims?.sub || "system",
      });
      
      res.status(201).json(version);
    } catch (error: any) {
      console.error("Create template version error:", error);
      res.status(500).json({ message: error.message || "Failed to create version" });
    }
  });

  // GET /api/generated-documents/:id/versions - Get version history for a generated document
  api.get("/api/generated-documents/:id/versions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      
      const versions = await storage.getDocumentVersions(org.id, id, "generated");
      res.json(versions);
    } catch (error: any) {
      console.error("Get document versions error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch version history" });
    }
  });

  // POST /api/generated-documents/:id/versions - Create a version snapshot for a generated document
  api.post("/api/generated-documents/:id/versions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      
      const doc = await storage.getGeneratedDocument(org.id, id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
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
        createdBy: user?.id || user?.claims?.sub || "system",
      });
      
      res.status(201).json(version);
    } catch (error: any) {
      console.error("Create document version error:", error);
      res.status(500).json({ message: error.message || "Failed to create version" });
    }
  });

  // GET /api/documents/versions/:versionId - Get a specific version
  api.get("/api/documents/versions/:versionId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const versionId = parseInt(req.params.versionId);
      
      if (isNaN(versionId)) {
        return res.status(400).json({ message: "Invalid version ID" });
      }
      
      const version = await storage.getDocumentVersion(versionId);
      if (!version) {
        return res.status(404).json({ message: "Version not found" });
      }
      
      if (version.organizationId !== org.id) {
        return res.status(403).json({ message: "Not authorized to view this version" });
      }
      
      res.json(version);
    } catch (error: any) {
      console.error("Get version error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch version" });
    }
  });

  // POST /api/documents/versions/:versionId/restore - Restore to a previous version
  api.post("/api/documents/versions/:versionId/restore", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const versionId = parseInt(req.params.versionId);
      
      if (isNaN(versionId)) {
        return res.status(400).json({ message: "Invalid version ID" });
      }
      
      const result = await storage.restoreDocumentVersion(org.id, versionId);
      
      if (!result.success) {
        return res.status(400).json({ message: result.message });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("Restore version error:", error);
      res.status(500).json({ message: error.message || "Failed to restore version" });
    }
  });

  // ============================================
  // GENERATED DOCUMENTS (Phase 4.3-4.5)
  // ============================================

  // GET /api/documents - List generated documents (alias)
  api.get("/api/documents", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = req.query.dealId ? parseInt(req.query.dealId as string) : undefined;
      const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : undefined;
      const status = req.query.status as string | undefined;
      
      const documents = await storage.getGeneratedDocuments(org.id, { dealId, propertyId, status });
      res.json(documents);
    } catch (error: any) {
      console.error("Get documents error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch documents" });
    }
  });

  // POST /api/documents/generate - Generate document from template
  api.post("/api/documents/generate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const { templateId, dealId, propertyId, name, variables } = req.body;
      
      if (!templateId) {
        return res.status(400).json({ message: "Template ID is required" });
      }
      
      const template = await storage.getDocumentTemplate(templateId);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      // Generate content by replacing variables
      let generatedContent = template.content;
      if (variables && typeof variables === 'object') {
        for (const [key, value] of Object.entries(variables)) {
          const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
          generatedContent = generatedContent.replace(regex, String(value));
        }
      }
      
      const document = await storage.createGeneratedDocument({
        organizationId: org.id,
        templateId,
        dealId: dealId || null,
        propertyId: propertyId || null,
        name: name || `${template.name} - ${new Date().toLocaleDateString()}`,
        type: template.type,
        content: generatedContent,
        variables: variables || {},
        status: "draft",
        createdBy: user?.id ? parseInt(user.id) : undefined,
      });
      
      res.status(201).json(document);
    } catch (error: any) {
      console.error("Generate document error:", error);
      res.status(500).json({ message: error.message || "Failed to generate document" });
    }
  });

  // GET /api/generated-documents - List generated documents
  api.get("/api/generated-documents", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = req.query.dealId ? parseInt(req.query.dealId as string) : undefined;
      const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : undefined;
      const status = req.query.status as string | undefined;
      
      const documents = await storage.getGeneratedDocuments(org.id, { dealId, propertyId, status });
      res.json(documents);
    } catch (error: any) {
      console.error("Get generated documents error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch documents" });
    }
  });

  // GET /api/generated-documents/:id - Get document by ID
  api.get("/api/generated-documents/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      
      const document = await storage.getGeneratedDocument(org.id, id);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      res.json(document);
    } catch (error: any) {
      console.error("Get generated document error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch document" });
    }
  });

  // POST /api/generated-documents - Generate document from template
  api.post("/api/generated-documents", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const { templateId, dealId, propertyId, name, variables } = req.body;
      
      if (!templateId) {
        return res.status(400).json({ message: "Template ID is required" });
      }
      
      const template = await storage.getDocumentTemplate(templateId);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      // Generate content by replacing variables
      let generatedContent = template.content;
      if (variables && typeof variables === 'object') {
        for (const [key, value] of Object.entries(variables)) {
          const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
          generatedContent = generatedContent.replace(regex, String(value));
        }
      }
      
      const document = await storage.createGeneratedDocument({
        organizationId: org.id,
        templateId,
        dealId: dealId || null,
        propertyId: propertyId || null,
        name: name || `${template.name} - ${new Date().toLocaleDateString()}`,
        type: template.type,
        content: generatedContent,
        variables: variables || {},
        status: "draft",
        createdBy: user?.id ? parseInt(user.id) : undefined,
      });
      
      res.status(201).json(document);
    } catch (error: any) {
      console.error("Create generated document error:", error);
      res.status(500).json({ message: error.message || "Failed to generate document" });
    }
  });

  // PUT /api/generated-documents/:id - Update document
  api.put("/api/generated-documents/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      
      const existing = await storage.getGeneratedDocument(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      const { name, content, status, signers } = req.body;
      
      const updated = await storage.updateGeneratedDocument(id, {
        ...(name && { name }),
        ...(content && { content }),
        ...(status && { status }),
        ...(signers && { signers }),
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Update generated document error:", error);
      res.status(500).json({ message: error.message || "Failed to update document" });
    }
  });

  // ============================================
  // NATIVE E-SIGNATURE SYSTEM (No external service required)
  // ============================================

  // POST /api/signatures - Create a new signature
  api.post("/api/signatures", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { documentId, signerName, signerEmail, signerRole, signatureData, signatureType, consentGiven, consentText } = req.body;
      
      if (!signerName || !signatureData) {
        return res.status(400).json({ message: "Signer name and signature data are required" });
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
      console.error("Create signature error:", error);
      res.status(500).json({ message: error.message || "Failed to create signature" });
    }
  });

  // GET /api/signatures - List signatures
  api.get("/api/signatures", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const documentId = req.query.documentId ? parseInt(req.query.documentId as string) : undefined;
      
      const signatures = await storage.getSignatures(org.id, documentId);
      res.json(signatures);
    } catch (error: any) {
      console.error("Get signatures error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch signatures" });
    }
  });

  // GET /api/signatures/:id - Get a specific signature
  api.get("/api/signatures/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid signature ID" });
      }
      
      const signature = await storage.getSignature(org.id, id);
      if (!signature) {
        return res.status(404).json({ message: "Signature not found" });
      }
      
      res.json(signature);
    } catch (error: any) {
      console.error("Get signature error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch signature" });
    }
  });

  // GET /api/generated-documents/:id/signatures - Get signatures for a document
  api.get("/api/generated-documents/:id/signatures", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const documentId = parseInt(req.params.id);
      
      if (isNaN(documentId)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      
      const document = await storage.getGeneratedDocument(org.id, documentId);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      const signatures = await storage.getDocumentSignatures(documentId);
      res.json(signatures);
    } catch (error: any) {
      console.error("Get document signatures error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch document signatures" });
    }
  });

  // POST /api/generated-documents/:id/request-signature - Request signatures (native system)
  api.post("/api/generated-documents/:id/request-signature", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      
      const document = await storage.getGeneratedDocument(org.id, id);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      if (document.status !== "draft") {
        return res.status(400).json({ message: "Document has already been sent or signed" });
      }
      
      const { signers } = req.body;
      
      if (!signers || !Array.isArray(signers) || signers.length === 0) {
        return res.status(400).json({ message: "At least one signer is required" });
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
      
      res.json({
        success: true,
        message: "Document ready for signature",
        document: updated,
        signingUrl: `/sign/${id}`,
      });
    } catch (error: any) {
      console.error("Request signature error:", error);
      res.status(500).json({ message: error.message || "Failed to request signatures" });
    }
  });

  // POST /api/generated-documents/:id/send-for-signature - Send document for e-signature (legacy)
  api.post("/api/generated-documents/:id/send-for-signature", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      
      const document = await storage.getGeneratedDocument(org.id, id);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      if (document.status !== "draft") {
        return res.status(400).json({ message: "Document has already been sent or signed" });
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
      console.error("Send for signature error:", error);
      res.status(500).json({ message: error.message || "Failed to send for signature" });
    }
  });

  // ============================================
  // DOCUMENT PACKAGES
  // ============================================

  // GET /api/document-packages - List packages
  api.get("/api/document-packages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = req.query.dealId ? parseInt(req.query.dealId as string) : undefined;
      const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : undefined;
      const status = req.query.status as string | undefined;
      
      const packages = await storage.getDocumentPackages(org.id, { dealId, propertyId, status });
      res.json(packages);
    } catch (error: any) {
      console.error("Get document packages error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch document packages" });
    }
  });

  // GET /api/document-packages/:id - Get package with documents
  api.get("/api/document-packages/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid package ID" });
      }
      
      const pkg = await storage.getDocumentPackage(org.id, id);
      if (!pkg) {
        return res.status(404).json({ message: "Document package not found" });
      }
      
      res.json(pkg);
    } catch (error: any) {
      console.error("Get document package error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch document package" });
    }
  });

  // POST /api/document-packages - Create package
  api.post("/api/document-packages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const { name, description, dealId, propertyId, documents } = req.body;
      
      if (!name) {
        return res.status(400).json({ message: "Package name is required" });
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
      console.error("Create document package error:", error);
      res.status(500).json({ message: error.message || "Failed to create document package" });
    }
  });

  // PUT /api/document-packages/:id - Update package
  api.put("/api/document-packages/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid package ID" });
      }
      
      const existing = await storage.getDocumentPackage(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Document package not found" });
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
      console.error("Update document package error:", error);
      res.status(500).json({ message: error.message || "Failed to update document package" });
    }
  });

  // DELETE /api/document-packages/:id - Delete package
  api.delete("/api/document-packages/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid package ID" });
      }
      
      const deleted = await storage.deleteDocumentPackage(org.id, id);
      if (!deleted) {
        return res.status(404).json({ message: "Document package not found" });
      }
      
      res.json({ success: true, message: "Document package deleted" });
    } catch (error: any) {
      console.error("Delete document package error:", error);
      res.status(500).json({ message: error.message || "Failed to delete document package" });
    }
  });

  // POST /api/document-packages/:id/documents - Add document/template to package
  api.post("/api/document-packages/:id/documents", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid package ID" });
      }
      
      const pkg = await storage.getDocumentPackage(org.id, id);
      if (!pkg) {
        return res.status(404).json({ message: "Document package not found" });
      }
      
      const { templateId, documentId, name } = req.body;
      
      if (!templateId && !documentId) {
        return res.status(400).json({ message: "Either templateId or documentId is required" });
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
      console.error("Add document to package error:", error);
      res.status(500).json({ message: error.message || "Failed to add document to package" });
    }
  });

  // DELETE /api/document-packages/:id/documents/:docIndex - Remove document from package
  api.delete("/api/document-packages/:id/documents/:docIndex", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const docIndex = parseInt(req.params.docIndex);
      
      if (isNaN(id) || isNaN(docIndex)) {
        return res.status(400).json({ message: "Invalid package ID or document index" });
      }
      
      const pkg = await storage.getDocumentPackage(org.id, id);
      if (!pkg) {
        return res.status(404).json({ message: "Document package not found" });
      }
      
      const currentDocs = pkg.documents || [];
      if (docIndex < 0 || docIndex >= currentDocs.length) {
        return res.status(400).json({ message: "Invalid document index" });
      }
      
      const updatedDocs = currentDocs.filter((_, i) => i !== docIndex);
      const reorderedDocs = updatedDocs.map((doc, i) => ({ ...doc, order: i + 1 }));
      
      const updated = await storage.updateDocumentPackage(id, {
        documents: reorderedDocs,
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Remove document from package error:", error);
      res.status(500).json({ message: error.message || "Failed to remove document from package" });
    }
  });

  // POST /api/document-packages/:id/generate-all - Generate all documents in package
  api.post("/api/document-packages/:id/generate-all", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid package ID" });
      }
      
      const pkg = await storage.getDocumentPackage(org.id, id);
      if (!pkg) {
        return res.status(404).json({ message: "Document package not found" });
      }
      
      const { variables } = req.body;
      const currentDocs = pkg.documents || [];
      const generatedDocs: any[] = [];
      
      for (const docItem of currentDocs) {
        if (docItem.documentId) {
          generatedDocs.push({ ...docItem, status: "generated" });
          continue;
        }
        
        const template = await storage.getDocumentTemplate(docItem.templateId);
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
              deal_name: deal.name,
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
              property_zip: property.zipCode,
              parcel_number: property.parcelNumber,
              acreage: property.acreage,
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
      console.error("Generate all documents error:", error);
      res.status(500).json({ message: error.message || "Failed to generate documents" });
    }
  });

  // GET /api/deals/:id/packages - Get packages for a deal
  api.get("/api/deals/:id/packages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = parseInt(req.params.id);
      
      if (isNaN(dealId)) {
        return res.status(400).json({ message: "Invalid deal ID" });
      }
      
      const packages = await storage.getPackagesByDeal(org.id, dealId);
      res.json(packages);
    } catch (error: any) {
      console.error("Get deal packages error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch deal packages" });
    }
  });

  // GET /api/properties/:id/packages - Get packages for a property
  api.get("/api/properties/:id/packages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = parseInt(req.params.id);
      
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }
      
      const packages = await storage.getPackagesByProperty(org.id, propertyId);
      res.json(packages);
    } catch (error: any) {
      console.error("Get property packages error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch property packages" });
    }
  });

  // ============================================

}
