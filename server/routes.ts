import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage, calculateMonthlyPayment, db } from "./storage";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { 
  insertLeadSchema, insertPropertySchema, insertNoteSchema, 
  insertCampaignSchema, insertAgentTaskSchema, insertDealSchema,
  insertPaymentSchema, insertOrganizationSchema, insertAgentConfigSchema,
  SUBSCRIPTION_TIERS, payments, notes, deals, properties, leads, activityLog
} from "@shared/schema";

// Auth imports
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";

// AI imports
import { processChat, processChatStream, agentProfiles, getOrCreateConversation } from "./ai/executive";

// Export imports
import { exportLeadsToCSV, exportPropertiesToCSV, exportNotesToCSV } from "./services/export";

// Import imports
import multer from "multer";
import { parseCSV, importLeads, importProperties, getExpectedLeadColumns, getExpectedPropertyColumns } from "./services/import";

// Usage limits
import { checkUsageLimit, getAllUsageLimits, UsageLimitError, TIER_LIMITS } from "./services/usageLimits";

// Configure multer for CSV file uploads (5MB max)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
});

// Middleware to get/create organization for authenticated user
async function getOrCreateOrg(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  // Get user ID from Replit Auth claims
  const user = req.user as any;
  const userId = user.claims?.sub || user.id;
  
  if (!userId) {
    console.error("No user ID found in session:", user);
    return res.status(401).json({ message: "Invalid user session" });
  }
  
  let org = await storage.getOrganizationByOwner(userId);
  
  if (!org) {
    // Create default organization for new user
    const displayName = user.claims?.first_name || user.username || user.email || "User";
    const slug = `org-${userId}-${Date.now()}`;
    org = await storage.createOrganization({
      name: `${displayName}'s Organization`,
      slug,
      ownerId: userId,
      subscriptionTier: "free",
      subscriptionStatus: "active",
    });
    
    // Add user as owner team member
    await storage.createTeamMember({
      organizationId: org.id,
      userId,
      displayName,
      role: "owner",
      isActive: true,
    });
  }
  
  (req as any).organization = org;
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Register Auth
  await setupAuth(app);
  registerAuthRoutes(app);
  
  // Protected API routes - all require authentication
  const api = app;
  
  // ============================================
  // DASHBOARD
  // ============================================
  
  api.get("/api/dashboard/stats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const stats = await storage.getDashboardStats(org.id);
    res.json(stats);
  });
  
  // ============================================
  // ORGANIZATION
  // ============================================
  
  api.get("/api/organization", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    res.json(org);
  });
  
  api.patch("/api/organization", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const updates = req.body;
    const updated = await storage.updateOrganization(org.id, updates);
    res.json(updated);
  });
  
  api.get("/api/subscription/tiers", async (req, res) => {
    res.json(SUBSCRIPTION_TIERS);
  });
  
  api.get("/api/usage", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const usage = await getAllUsageLimits(org.id);
    res.json(usage);
  });
  
  api.get("/api/usage/limits", async (req, res) => {
    res.json(TIER_LIMITS);
  });
  
  // ============================================
  // TEAM MEMBERS
  // ============================================
  
  api.get("/api/team", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const members = await storage.getTeamMembers(org.id);
    res.json(members);
  });
  
  // ============================================
  // LEADS (CRM)
  // ============================================
  
  api.get("/api/leads", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leads = await storage.getLeads(org.id);
    res.json(leads);
  });
  
  api.get("/api/leads/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const lead = await storage.getLead(org.id, Number(req.params.id));
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    res.json(lead);
  });
  
  api.post("/api/leads", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      const usageCheck = await checkUsageLimit(org.id, "leads");
      if (!usageCheck.allowed) {
        return res.status(429).json({
          message: `Lead limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade your plan to add more leads.`,
          current: usageCheck.current,
          limit: usageCheck.limit,
          resourceType: usageCheck.resourceType,
          tier: usageCheck.tier,
        });
      }
      
      const input = insertLeadSchema.parse({ ...req.body, organizationId: org.id });
      const lead = await storage.createLead(input);
      res.status(201).json(lead);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/leads/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const lead = await storage.updateLead(Number(req.params.id), req.body);
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    res.json(lead);
  });
  
  api.delete("/api/leads/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    await storage.deleteLead(Number(req.params.id));
    res.status(204).send();
  });
  
  api.get("/api/leads/export", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const csv = await exportLeadsToCSV(org.id);
    const date = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="leads-${date}.csv"`);
    res.send(csv);
  });
  
  api.post("/api/leads/import", isAuthenticated, getOrCreateOrg, upload.single("file"), async (req, res) => {
    try {
      const org = (req as any).organization;
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const csvString = file.buffer.toString("utf-8");
      const csvData = parseCSV(csvString);
      
      if (csvData.length === 0) {
        return res.status(400).json({ message: "CSV file is empty or has no data rows" });
      }
      
      const result = await importLeads(csvData, org.id);
      res.json(result);
    } catch (err) {
      console.error("Lead import error:", err);
      res.status(400).json({ 
        message: err instanceof Error ? err.message : "Failed to import leads" 
      });
    }
  });
  
  api.post("/api/leads/import/preview", isAuthenticated, getOrCreateOrg, upload.single("file"), async (req, res) => {
    try {
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const csvString = file.buffer.toString("utf-8");
      const csvData = parseCSV(csvString);
      
      if (csvData.length === 0) {
        return res.status(400).json({ message: "CSV file is empty or has no data rows" });
      }
      
      const headers = Object.keys(csvData[0]);
      const preview = csvData.slice(0, 5);
      const expectedColumns = getExpectedLeadColumns();
      
      res.json({
        totalRows: csvData.length,
        headers,
        preview,
        expectedColumns,
      });
    } catch (err) {
      console.error("Lead import preview error:", err);
      res.status(400).json({ 
        message: err instanceof Error ? err.message : "Failed to parse CSV" 
      });
    }
  });
  
  // ============================================
  // PROPERTIES (INVENTORY)
  // ============================================
  
  api.get("/api/properties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const properties = await storage.getProperties(org.id);
    res.json(properties);
  });
  
  api.get("/api/properties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const property = await storage.getProperty(org.id, Number(req.params.id));
    if (!property) return res.status(404).json({ message: "Property not found" });
    res.json(property);
  });
  
  api.post("/api/properties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      const usageCheck = await checkUsageLimit(org.id, "properties");
      if (!usageCheck.allowed) {
        return res.status(429).json({
          message: `Property limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade your plan to add more properties.`,
          current: usageCheck.current,
          limit: usageCheck.limit,
          resourceType: usageCheck.resourceType,
          tier: usageCheck.tier,
        });
      }
      
      const input = insertPropertySchema.parse({ ...req.body, organizationId: org.id });
      const property = await storage.createProperty(input);
      res.status(201).json(property);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/properties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const property = await storage.updateProperty(Number(req.params.id), req.body);
    if (!property) return res.status(404).json({ message: "Property not found" });
    res.json(property);
  });
  
  api.delete("/api/properties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    await storage.deleteProperty(Number(req.params.id));
    res.status(204).send();
  });
  
  api.get("/api/properties/export", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const csv = await exportPropertiesToCSV(org.id);
    const date = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="properties-${date}.csv"`);
    res.send(csv);
  });
  
  api.post("/api/properties/import", isAuthenticated, getOrCreateOrg, upload.single("file"), async (req, res) => {
    try {
      const org = (req as any).organization;
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const csvString = file.buffer.toString("utf-8");
      const csvData = parseCSV(csvString);
      
      if (csvData.length === 0) {
        return res.status(400).json({ message: "CSV file is empty or has no data rows" });
      }
      
      const result = await importProperties(csvData, org.id);
      res.json(result);
    } catch (err) {
      console.error("Property import error:", err);
      res.status(400).json({ 
        message: err instanceof Error ? err.message : "Failed to import properties" 
      });
    }
  });
  
  api.post("/api/properties/import/preview", isAuthenticated, getOrCreateOrg, upload.single("file"), async (req, res) => {
    try {
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const csvString = file.buffer.toString("utf-8");
      const csvData = parseCSV(csvString);
      
      if (csvData.length === 0) {
        return res.status(400).json({ message: "CSV file is empty or has no data rows" });
      }
      
      const headers = Object.keys(csvData[0]);
      const preview = csvData.slice(0, 5);
      const expectedColumns = getExpectedPropertyColumns();
      
      res.json({
        totalRows: csvData.length,
        headers,
        preview,
        expectedColumns,
      });
    } catch (err) {
      console.error("Property import preview error:", err);
      res.status(400).json({ 
        message: err instanceof Error ? err.message : "Failed to parse CSV" 
      });
    }
  });
  
  // ============================================
  // COMPS ANALYSIS (Comparable Properties)
  // ============================================
  
  api.get("/api/properties/:id/comps", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const property = await storage.getProperty(org.id, Number(req.params.id));
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      const lat = property.parcelCentroid?.lat || (property.latitude ? parseFloat(String(property.latitude)) : null);
      const lng = property.parcelCentroid?.lng || (property.longitude ? parseFloat(String(property.longitude)) : null);
      
      if (!lat || !lng) {
        return res.status(400).json({ 
          message: "Property coordinates not available. Please fetch parcel data first.",
          error: "missing_coordinates"
        });
      }
      
      const radiusMiles = parseFloat(req.query.radius as string) || 5;
      const filters: import("./services/comps").CompsFilters = {};
      
      if (req.query.minAcreage) filters.minAcreage = parseFloat(req.query.minAcreage as string);
      if (req.query.maxAcreage) filters.maxAcreage = parseFloat(req.query.maxAcreage as string);
      if (req.query.propertyType) filters.propertyType = req.query.propertyType as string;
      if (req.query.minSaleDate) filters.minSaleDate = req.query.minSaleDate as string;
      if (req.query.maxSaleDate) filters.maxSaleDate = req.query.maxSaleDate as string;
      if (req.query.maxResults) filters.maxResults = parseInt(req.query.maxResults as string);
      
      const subjectAcreage = property.sizeAcres ? parseFloat(String(property.sizeAcres)) : 0;
      
      const { getPropertyComps } = await import("./services/comps");
      const result = await getPropertyComps(lat, lng, subjectAcreage, radiusMiles, filters);
      
      res.json({
        ...result,
        subjectProperty: {
          id: property.id,
          apn: property.apn,
          address: property.address,
          acreage: subjectAcreage,
          coordinates: { lat, lng },
        },
      });
    } catch (err) {
      console.error("Comps lookup error:", err);
      res.status(500).json({ 
        message: err instanceof Error ? err.message : "Failed to fetch comparable properties" 
      });
    }
  });
  
  api.post("/api/comps/search", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { lat, lng, radius, subjectAcreage, filters } = req.body;
      
      if (!lat || !lng) {
        return res.status(400).json({ message: "Latitude and longitude are required" });
      }
      
      const radiusMiles = radius || 5;
      const acreage = subjectAcreage || 0;
      
      const { getPropertyComps } = await import("./services/comps");
      const result = await getPropertyComps(lat, lng, acreage, radiusMiles, filters || {});
      
      res.json(result);
    } catch (err) {
      console.error("Comps search error:", err);
      res.status(500).json({ 
        message: err instanceof Error ? err.message : "Failed to search comparable properties" 
      });
    }
  });
  
  // ============================================
  // PARCEL LOOKUP (Regrid Integration)
  // ============================================
  
  api.post("/api/parcels/lookup", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { lookupParcelByAPN, lookupParcelByCoordinates } = await import("./services/parcel");
      
      const { apn, lat, lng, state, county } = req.body;
      
      if (!apn && (!lat || !lng)) {
        return res.status(400).json({ message: "Provide either APN or coordinates (lat/lng)" });
      }
      
      let result;
      if (apn) {
        // Build state/county path if provided
        let path: string | undefined;
        if (state && county) {
          path = `/us/${state.toLowerCase()}/${county.toLowerCase().replace(/\s+/g, "-")}`;
        }
        result = await lookupParcelByAPN(apn, path);
      } else {
        result = await lookupParcelByCoordinates(lat, lng);
      }
      
      if (!result.found) {
        return res.status(404).json({ message: result.error || "Parcel not found" });
      }
      
      res.json(result.parcel);
    } catch (err) {
      console.error("Parcel lookup error:", err);
      res.status(500).json({ message: "Failed to lookup parcel data" });
    }
  });
  
  // Update property with parcel data
  api.post("/api/properties/:id/fetch-parcel", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { lookupParcelByAPN } = await import("./services/parcel");
      const org = (req as any).organization;
      
      const property = await storage.getProperty(org.id, Number(req.params.id));
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      // Build state/county path
      let path: string | undefined;
      if (property.state && property.county) {
        path = `/us/${property.state.toLowerCase()}/${property.county.toLowerCase().replace(/\s+/g, "-")}`;
      }
      
      const result = await lookupParcelByAPN(property.apn, path);
      
      if (!result.found || !result.parcel) {
        return res.status(404).json({ message: result.error || "Parcel not found" });
      }
      
      // Update property with parcel data
      const updated = await storage.updateProperty(property.id, {
        parcelBoundary: result.parcel.boundary,
        parcelCentroid: result.parcel.centroid,
        parcelData: result.parcel.data,
        latitude: String(result.parcel.centroid.lat),
        longitude: String(result.parcel.centroid.lng),
      });
      
      res.json(updated);
    } catch (err) {
      console.error("Fetch parcel error:", err);
      res.status(500).json({ message: "Failed to fetch parcel data" });
    }
  });
  
  // ============================================
  // DEALS (Acquisitions/Dispositions)
  // ============================================
  
  api.get("/api/deals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const deals = await storage.getDeals(org.id);
    res.json(deals);
  });
  
  api.get("/api/deals/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const deal = await storage.getDeal(org.id, Number(req.params.id));
    if (!deal) return res.status(404).json({ message: "Deal not found" });
    res.json(deal);
  });
  
  api.post("/api/deals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const input = insertDealSchema.parse({ ...req.body, organizationId: org.id });
      const deal = await storage.createDeal(input);
      res.status(201).json(deal);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/deals/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const deal = await storage.updateDeal(Number(req.params.id), req.body);
    if (!deal) return res.status(404).json({ message: "Deal not found" });
    res.json(deal);
  });
  
  // ============================================
  // DUE DILIGENCE TEMPLATES & CHECKLISTS
  // ============================================
  
  api.get("/api/due-diligence/templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const templates = await storage.getDueDiligenceTemplates(org.id);
    if (templates.length === 0) {
      const initialized = await storage.initializeDefaultTemplates(org.id);
      return res.json(initialized);
    }
    res.json(templates);
  });
  
  api.get("/api/due-diligence/templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const template = await storage.getDueDiligenceTemplate(Number(req.params.id));
    if (!template) return res.status(404).json({ message: "Template not found" });
    res.json(template);
  });
  
  api.post("/api/due-diligence/templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const template = await storage.createDueDiligenceTemplate({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(template);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/due-diligence/templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const template = await storage.updateDueDiligenceTemplate(Number(req.params.id), req.body);
    if (!template) return res.status(404).json({ message: "Template not found" });
    res.json(template);
  });
  
  api.delete("/api/due-diligence/templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    await storage.deleteDueDiligenceTemplate(Number(req.params.id));
    res.status(204).send();
  });
  
  api.get("/api/properties/:id/due-diligence", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const items = await storage.getPropertyDueDiligence(Number(req.params.id));
    res.json(items);
  });
  
  api.post("/api/properties/:id/due-diligence/apply-template", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { templateId } = req.body;
      if (!templateId) {
        return res.status(400).json({ message: "templateId is required" });
      }
      const items = await storage.applyTemplateToProperty(Number(req.params.id), templateId);
      res.json(items);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to apply template" });
    }
  });
  
  api.post("/api/properties/:id/due-diligence", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const item = await storage.createDueDiligenceItem({
        ...req.body,
        propertyId: Number(req.params.id),
      });
      res.status(201).json(item);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/due-diligence/items/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const user = req.user as any;
    const userId = user?.claims?.sub || user?.id;
    const updates = { ...req.body };
    if (updates.completed === true && userId) {
      updates.completedBy = userId;
    }
    const item = await storage.updateDueDiligenceItem(Number(req.params.id), updates);
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  });
  
  api.delete("/api/due-diligence/items/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    await storage.deleteDueDiligenceItem(Number(req.params.id));
    res.status(204).send();
  });
  
  // ============================================
  // NOTES (Seller Financing)
  // ============================================
  
  api.get("/api/notes", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const notes = await storage.getNotes(org.id);
    res.json(notes);
  });
  
  api.get("/api/notes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const note = await storage.getNote(org.id, Number(req.params.id));
    if (!note) return res.status(404).json({ message: "Note not found" });
    res.json(note);
  });
  
  api.post("/api/notes", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      const usageCheck = await checkUsageLimit(org.id, "notes");
      if (!usageCheck.allowed) {
        return res.status(429).json({
          message: `Note limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade your plan to add more notes.`,
          current: usageCheck.current,
          limit: usageCheck.limit,
          resourceType: usageCheck.resourceType,
          tier: usageCheck.tier,
        });
      }
      
      // Calculate monthly payment if not provided
      let monthlyPayment = req.body.monthlyPayment;
      if (!monthlyPayment && req.body.originalPrincipal && req.body.interestRate && req.body.termMonths) {
        monthlyPayment = calculateMonthlyPayment(
          Number(req.body.originalPrincipal),
          Number(req.body.interestRate),
          Number(req.body.termMonths)
        );
      }
      
      const input = insertNoteSchema.parse({ 
        ...req.body, 
        organizationId: org.id,
        monthlyPayment: String(monthlyPayment),
        currentBalance: req.body.originalPrincipal,
      });
      const note = await storage.createNote(input);
      res.status(201).json(note);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/notes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const note = await storage.updateNote(Number(req.params.id), req.body);
    if (!note) return res.status(404).json({ message: "Note not found" });
    res.json(note);
  });
  
  api.delete("/api/notes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    await storage.deleteNote(Number(req.params.id));
    res.status(204).send();
  });
  
  api.get("/api/notes/export", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const csv = await exportNotesToCSV(org.id);
    const date = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="notes-${date}.csv"`);
    res.send(csv);
  });
  
  // Calculate payment helper endpoint
  api.post("/api/notes/calculate-payment", isAuthenticated, async (req, res) => {
    const { principal, interestRate, termMonths } = req.body;
    const payment = calculateMonthlyPayment(
      Number(principal),
      Number(interestRate),
      Number(termMonths)
    );
    res.json({ monthlyPayment: payment });
  });
  
  // ============================================
  // DOCUMENT GENERATION
  // ============================================
  
  // Generate promissory note PDF
  api.get("/api/notes/:id/document", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generatePromissoryNote } = await import("./services/documents");
      const org = (req as any).organization;
      
      const pdfBuffer = await generatePromissoryNote(Number(req.params.id), org.id);
      
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
      
      const pdfBuffer = await generateWarrantyDeed(Number(req.params.id), org.id);
      
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
      
      const pdfBuffer = await generateOfferLetter(
        Number(leadId),
        Number(propertyId),
        org.id,
        { offerAmount, earnestMoney, closingDate, contingencies, additionalTerms }
      );
      
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
  
  // ============================================
  // PAYMENTS
  // ============================================
  
  api.get("/api/payments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const noteId = req.query.noteId ? Number(req.query.noteId) : undefined;
    const payments = await storage.getPayments(org.id, noteId);
    res.json(payments);
  });
  
  api.post("/api/payments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { noteId, amount, paymentDate, type = "regular", paymentMethod } = req.body;
      
      // Get the note to calculate interest and principal split
      const note = await storage.getNote(org.id, noteId);
      if (!note) {
        return res.status(404).json({ message: "Note not found" });
      }
      
      const currentBalance = Number(note.currentBalance || note.originalPrincipal);
      const monthlyRate = Number(note.interestRate) / 100 / 12;
      const interestPortion = currentBalance * monthlyRate;
      const principalPortion = Math.max(0, Number(amount) - interestPortion);
      const newBalance = Math.max(0, currentBalance - principalPortion);
      
      const input = insertPaymentSchema.parse({ 
        noteId,
        organizationId: org.id,
        amount: String(amount),
        principal: String(principalPortion),
        interest: String(interestPortion),
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        type,
        status: "completed",
        paymentMethod
      });
      
      const payment = await storage.createPayment(input);
      
      // Update the note balance and status
      const paymentsCount = (await storage.getPayments(org.id, noteId)).length;
      let noteStatus = note.status;
      if (newBalance <= 0) {
        noteStatus = "paid_off";
      } else if (noteStatus === "late" || noteStatus === "delinquent") {
        noteStatus = "active"; // Payment received, restore to active
      }
      
      await storage.updateNote(note.id, { 
        currentBalance: String(newBalance),
        status: noteStatus
      });
      
      res.status(201).json(payment);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  // ============================================
  // CAMPAIGNS (Marketing)
  // ============================================
  
  api.get("/api/campaigns", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const campaigns = await storage.getCampaigns(org.id);
    res.json(campaigns);
  });
  
  api.get("/api/campaigns/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const campaign = await storage.getCampaign(org.id, Number(req.params.id));
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    res.json(campaign);
  });
  
  api.post("/api/campaigns", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const input = insertCampaignSchema.parse({ ...req.body, organizationId: org.id });
      const campaign = await storage.createCampaign(input);
      res.status(201).json(campaign);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/campaigns/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const campaign = await storage.updateCampaign(Number(req.params.id), req.body);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    res.json(campaign);
  });
  
  // ============================================
  // AI AGENTS
  // ============================================
  
  api.get("/api/agents/configs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const configs = await storage.getAgentConfigs(org.id);
    res.json(configs);
  });
  
  api.post("/api/agents/configs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const input = insertAgentConfigSchema.parse({ ...req.body, organizationId: org.id });
      const config = await storage.createAgentConfig(input);
      res.status(201).json(config);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.get("/api/agents/tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const tasks = await storage.getAgentTasks(org.id);
    res.json(tasks);
  });
  
  api.post("/api/agents/tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      const usageCheck = await checkUsageLimit(org.id, "ai_requests");
      if (!usageCheck.allowed) {
        return res.status(429).json({
          message: `Daily AI request limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade your plan for more AI requests.`,
          current: usageCheck.current,
          limit: usageCheck.limit,
          resourceType: usageCheck.resourceType,
          tier: usageCheck.tier,
        });
      }
      
      const input = insertAgentTaskSchema.parse({ ...req.body, organizationId: org.id });
      const task = await storage.createAgentTask(input);
      res.status(201).json(task);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  // ============================================
  // CONVERSATIONS (Buyer Communication)
  // ============================================
  
  api.get("/api/conversations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leadId = req.query.leadId ? Number(req.query.leadId) : undefined;
    const conversations = await storage.getConversations(org.id, leadId);
    res.json(conversations);
  });
  
  api.get("/api/conversations/:id/messages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const messages = await storage.getMessages(Number(req.params.id));
    res.json(messages);
  });
  
  // ============================================
  // AI COMMAND CENTER
  // ============================================
  
  // Get available AI agents
  api.get("/api/ai/agents", isAuthenticated, async (req, res) => {
    res.json(Object.values(agentProfiles));
  });
  
  // Get conversation history
  api.get("/api/ai/conversations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const conversations = await storage.getAiConversations(org.id);
    res.json(conversations);
  });
  
  // Get a specific conversation with messages
  api.get("/api/ai/conversations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const conversationId = parseInt(req.params.id);
    const conversation = await storage.getAiConversation(conversationId);
    
    if (!conversation || conversation.organizationId !== org.id) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    
    const messages = await storage.getAiMessages(conversationId);
    res.json({ conversation, messages });
  });
  
  // Create new conversation
  api.post("/api/ai/conversations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const user = req.user as any;
    const userId = user.claims?.sub || user.id;
    const { agentRole = "executive" } = req.body;
    
    const conversation = await storage.createAiConversation({
      organizationId: org.id,
      userId,
      title: "New Conversation",
      agentRole
    });
    
    res.status(201).json(conversation);
  });
  
  // Send a message (non-streaming)
  api.post("/api/ai/chat", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const { message, conversationId, agentRole } = req.body;
      
      if (!message) {
        return res.status(400).json({ message: "Message is required" });
      }
      
      const usageCheck = await checkUsageLimit(org.id, "ai_requests");
      if (!usageCheck.allowed) {
        return res.status(429).json({
          message: `Daily AI request limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade your plan for more AI requests.`,
          current: usageCheck.current,
          limit: usageCheck.limit,
          resourceType: usageCheck.resourceType,
          tier: usageCheck.tier,
        });
      }
      
      await storage.trackUsage(org.id, "ai_request");
      
      const result = await processChat(message, org, userId, {
        conversationId,
        agentRole
      });
      
      res.json(result);
    } catch (error: any) {
      console.error("AI Chat error:", error);
      res.status(500).json({ message: error.message || "AI processing failed" });
    }
  });
  
  // Send a message (streaming)
  api.post("/api/ai/chat/stream", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const { message, conversationId, agentRole } = req.body;
      
      if (!message) {
        return res.status(400).json({ message: "Message is required" });
      }
      
      const usageCheck = await checkUsageLimit(org.id, "ai_requests");
      if (!usageCheck.allowed) {
        return res.status(429).json({
          message: `Daily AI request limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade your plan for more AI requests.`,
          current: usageCheck.current,
          limit: usageCheck.limit,
          resourceType: usageCheck.resourceType,
          tier: usageCheck.tier,
        });
      }
      
      await storage.trackUsage(org.id, "ai_request");
      
      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      
      const stream = processChatStream(message, org, userId, {
        conversationId,
        agentRole
      });
      
      for await (const event of stream) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      
      res.end();
    } catch (error: any) {
      console.error("AI Stream error:", error);
      res.write(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`);
      res.end();
    }
  });
  
  // Delete a conversation
  api.delete("/api/ai/conversations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const conversationId = parseInt(req.params.id);
    const conversation = await storage.getAiConversation(conversationId);
    
    if (!conversation || conversation.organizationId !== org.id) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    
    await storage.deleteAiConversation(conversationId);
    res.json({ success: true });
  });
  
  // ============================================
  // VA (VIRTUAL ASSISTANTS) SYSTEM
  // ============================================
  
  // Get all VA agents for the organization
  api.get("/api/va/agents", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const agents = await storage.initializeVaAgents(org.id);
      res.json(agents);
    } catch (error: any) {
      console.error("Error fetching VA agents:", error);
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get a specific VA agent
  api.get("/api/va/agents/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const agentId = parseInt(req.params.id);
      const agent = await storage.getVaAgent(org.id, agentId);
      
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }
      
      res.json(agent);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Update a VA agent settings
  api.patch("/api/va/agents/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const agentId = parseInt(req.params.id);
      const agent = await storage.getVaAgent(org.id, agentId);
      
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }
      
      const updated = await storage.updateVaAgent(agentId, req.body);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get VA actions (activity feed)
  api.get("/api/va/actions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const options: { agentId?: number; status?: string; limit?: number } = {};
      
      if (req.query.agentId) options.agentId = parseInt(req.query.agentId as string);
      if (req.query.status) options.status = req.query.status as string;
      if (req.query.limit) options.limit = parseInt(req.query.limit as string);
      
      const actions = await storage.getVaActions(org.id, options);
      res.json(actions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get pending actions count
  api.get("/api/va/actions/pending/count", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const count = await storage.getPendingActionsCount(org.id);
      res.json({ count });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Approve an action
  api.post("/api/va/actions/:id/approve", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const actionId = parseInt(req.params.id);
      
      const action = await storage.getVaAction(actionId);
      if (!action) {
        return res.status(404).json({ message: "Action not found" });
      }
      
      const updated = await storage.approveVaAction(actionId, userId);
      
      // Execute the action after approval
      const executionResult = await vaAgentService.executeAgentAction(updated);
      
      // Get the final updated action with execution result
      const finalAction = await storage.getVaAction(actionId);
      res.json({ action: finalAction, executionResult });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Reject an action
  api.post("/api/va/actions/:id/reject", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const actionId = parseInt(req.params.id);
      const { reason } = req.body;
      
      const action = await storage.getVaAction(actionId);
      if (!action) {
        return res.status(404).json({ message: "Action not found" });
      }
      
      const updated = await storage.rejectVaAction(actionId, reason || "Rejected by user");
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Process a task with an agent
  api.post("/api/va/agents/:type/task", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const org = (req as any).organization;
      const agentType = req.params.type as any;
      const { task } = req.body;
      
      if (!task) {
        return res.status(400).json({ message: "Task description is required" });
      }
      
      const result = await vaAgentService.processAgentTask(org.id, agentType, task);
      res.json(result);
    } catch (error: any) {
      console.error("VA Task error:", error);
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get VA agent status
  api.get("/api/va/agents/:type/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const org = (req as any).organization;
      const agentType = req.params.type as any;
      
      const status = await vaAgentService.getAgentStatus(org.id, agentType);
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Execute action manually
  api.post("/api/va/actions/:id/execute", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const actionId = parseInt(req.params.id);
      
      const action = await storage.getVaAction(actionId);
      if (!action) {
        return res.status(404).json({ message: "Action not found" });
      }
      
      if (action.status !== "approved") {
        return res.status(400).json({ message: "Action must be approved before execution" });
      }
      
      const result = await vaAgentService.executeAgentAction(action);
      const finalAction = await storage.getVaAction(actionId);
      res.json({ action: finalAction, executionResult: result });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Process autonomous actions (for background job)
  api.post("/api/va/actions/process-autonomous", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const org = (req as any).organization;
      
      const result = await vaAgentService.processAutonomousActions(org.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get briefings
  api.get("/api/va/briefings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const limit = parseInt(req.query.limit as string) || 10;
      const briefings = await storage.getVaBriefings(org.id, limit);
      res.json(briefings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Generate a new briefing
  api.post("/api/va/briefings/generate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const org = (req as any).organization;
      const briefing = await vaAgentService.generateBriefing(org.id);
      res.json(briefing);
    } catch (error: any) {
      console.error("Briefing generation error:", error);
      res.status(500).json({ message: error.message });
    }
  });
  
  // Mark briefing as read
  api.post("/api/va/briefings/:id/read", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const briefingId = parseInt(req.params.id);
      const updated = await storage.markBriefingRead(briefingId);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get calendar events
  api.get("/api/va/calendar", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const startDate = req.query.start ? new Date(req.query.start as string) : undefined;
      const endDate = req.query.end ? new Date(req.query.end as string) : undefined;
      const events = await storage.getVaCalendarEvents(org.id, startDate, endDate);
      res.json(events);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Create calendar event
  api.post("/api/va/calendar", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const event = await storage.createVaCalendarEvent({
        ...req.body,
        organizationId: org.id
      });
      res.json(event);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // ============================================
  // STRIPE SUBSCRIPTION
  // ============================================
  
  api.get("/api/stripe/products", async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const rows = await stripeService.listProductsWithPrices();
      
      const productsMap = new Map();
      for (const row of rows as any[]) {
        if (!productsMap.has(row.product_id)) {
          productsMap.set(row.product_id, {
            id: row.product_id,
            name: row.product_name,
            description: row.product_description,
            active: row.product_active,
            metadata: row.product_metadata,
            prices: []
          });
        }
        if (row.price_id) {
          productsMap.get(row.product_id).prices.push({
            id: row.price_id,
            unit_amount: row.unit_amount,
            currency: row.currency,
            recurring: row.recurring,
            active: row.price_active,
            metadata: row.price_metadata,
          });
        }
      }
      
      res.json(Array.from(productsMap.values()));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/stripe/checkout", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const org = (req as any).organization;
      const { priceId } = req.body;
      
      if (!priceId) {
        return res.status(400).json({ message: "priceId is required" });
      }
      
      let customerId = org.stripeCustomerId;
      if (!customerId) {
        const user = req.user as any;
        const customer = await stripeService.createCustomer(
          user.email,
          user.id,
          org.name
        );
        await storage.updateOrganization(org.id, { stripeCustomerId: customer.id });
        customerId = customer.id;
      }
      
      const session = await stripeService.createCheckoutSession(
        customerId,
        priceId,
        `${req.protocol}://${req.get('host')}/settings?subscription=success`,
        `${req.protocol}://${req.get('host')}/settings?subscription=cancelled`,
        { organizationId: String(org.id) }
      );
      
      res.json({ url: session.url });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/stripe/portal", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const org = (req as any).organization;
      
      if (!org.stripeCustomerId) {
        return res.status(400).json({ message: "No subscription found" });
      }
      
      const session = await stripeService.createCustomerPortalSession(
        org.stripeCustomerId,
        `${req.protocol}://${req.get('host')}/settings`
      );
      
      res.json({ url: session.url });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  
  api.get("/api/stripe/subscription", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const org = (req as any).organization;
      
      if (!org.stripeCustomerId) {
        return res.json({ subscription: null });
      }
      
      const subscriptions = await stripeService.getCustomerSubscriptions(org.stripeCustomerId);
      const activeSubscription = subscriptions.find((s: any) => 
        s.status === 'active' || s.status === 'trialing'
      );
      
      res.json({ subscription: activeSubscription || null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // BORROWER PORTAL (Public, for GeekPay replacement)
  // ============================================
  
  api.post("/api/borrower/verify", async (req, res) => {
    try {
      const { accessToken, email } = req.body;
      
      if (!accessToken || !email) {
        return res.status(400).json({ message: "Access token and email are required" });
      }
      
      // Look up note by access token
      const note = await storage.getNoteByAccessToken(accessToken);
      if (!note) {
        return res.status(404).json({ message: "Loan not found" });
      }
      
      // Verify borrower email
      if (note.borrowerId) {
        const borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (!borrower || borrower.email?.toLowerCase() !== email.toLowerCase()) {
          return res.status(401).json({ message: "Email does not match our records" });
        }
      }
      
      // Get payments for this note
      const notePayments = await storage.getPayments(note.organizationId, note.id);
      
      // Get property info if linked
      let property = null;
      if (note.propertyId) {
        property = await storage.getProperty(note.organizationId, note.propertyId);
      }
      
      // Get borrower info
      let borrower = null;
      if (note.borrowerId) {
        borrower = await storage.getLead(note.organizationId, note.borrowerId);
      }
      
      res.json({
        note: { ...note, property },
        payments: notePayments,
        borrower: borrower ? { firstName: borrower.firstName, lastName: borrower.lastName } : null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  
  // Create Stripe checkout session for borrower portal payment
  api.post("/api/portal/:accessToken/payment", async (req, res) => {
    try {
      const { accessToken } = req.params;
      const { amount } = req.body;
      
      if (!accessToken) {
        return res.status(400).json({ message: "Access token is required" });
      }
      
      const note = await storage.getNoteByAccessToken(accessToken);
      if (!note) {
        return res.status(404).json({ message: "Loan not found" });
      }
      
      const paymentAmount = amount ? Number(amount) : Number(note.monthlyPayment || 0);
      if (paymentAmount <= 0) {
        return res.status(400).json({ message: "Invalid payment amount" });
      }
      
      // Get Stripe client
      const { getUncachableStripeClient, getStripePublishableKey } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      
      // Get borrower info for customer description
      let borrowerName = "Borrower";
      let borrowerEmail = undefined;
      if (note.borrowerId) {
        const borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (borrower) {
          borrowerName = `${borrower.firstName} ${borrower.lastName}`;
          borrowerEmail = borrower.email || undefined;
        }
      }
      
      // Create checkout session for one-time payment
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Loan Payment - Note #${note.id}`,
              description: `Payment for ${borrowerName}`,
            },
            unit_amount: Math.round(paymentAmount * 100), // Convert to cents
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${baseUrl}/portal/${accessToken}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/portal/${accessToken}?payment=cancelled`,
        customer_email: borrowerEmail,
        metadata: {
          noteId: note.id.toString(),
          accessToken,
          paymentAmount: paymentAmount.toString(),
          type: 'borrower_portal_payment',
        },
      });
      
      res.json({ url: session.url, sessionId: session.id });
    } catch (err: any) {
      console.error("Portal payment error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // Verify Stripe payment and create payment record
  api.post("/api/portal/:accessToken/verify-payment", async (req, res) => {
    try {
      const { accessToken } = req.params;
      const { sessionId } = req.body;
      
      if (!accessToken || !sessionId) {
        return res.status(400).json({ message: "Access token and session ID are required" });
      }
      
      const note = await storage.getNoteByAccessToken(accessToken);
      if (!note) {
        return res.status(404).json({ message: "Loan not found" });
      }
      
      // Verify Stripe session
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      if (session.payment_status !== 'paid') {
        return res.status(400).json({ message: "Payment not completed" });
      }
      
      // Check if payment already recorded for this session
      const existingPayments = await storage.getPayments(note.organizationId, note.id);
      const alreadyRecorded = existingPayments.some(p => p.transactionId === sessionId);
      if (alreadyRecorded) {
        return res.json({ success: true, message: "Payment already recorded" });
      }
      
      const paymentAmount = session.amount_total ? session.amount_total / 100 : Number(note.monthlyPayment);
      
      // Calculate principal/interest split from amortization schedule
      const schedule = note.amortizationSchedule || [];
      const nextPendingPayment = schedule.find(s => s.status === 'pending');
      
      let principalAmount = 0;
      let interestAmount = 0;
      
      if (nextPendingPayment) {
        // Use amortization schedule for split
        const ratio = paymentAmount / nextPendingPayment.payment;
        principalAmount = Number((nextPendingPayment.principal * ratio).toFixed(2));
        interestAmount = Number((nextPendingPayment.interest * ratio).toFixed(2));
      } else {
        // Calculate split based on current balance and rate
        const monthlyRate = Number(note.interestRate) / 100 / 12;
        interestAmount = Number((Number(note.currentBalance) * monthlyRate).toFixed(2));
        principalAmount = Number((paymentAmount - interestAmount).toFixed(2));
        if (principalAmount < 0) principalAmount = 0;
      }
      
      // Create payment record
      const payment = await storage.createPayment({
        organizationId: note.organizationId,
        noteId: note.id,
        amount: paymentAmount.toString(),
        principalAmount: principalAmount.toString(),
        interestAmount: interestAmount.toString(),
        feeAmount: "0",
        lateFeeAmount: "0",
        paymentDate: new Date(),
        dueDate: note.nextPaymentDate || new Date(),
        paymentMethod: 'card',
        transactionId: sessionId,
        status: 'completed',
      });
      
      // Update note balance
      const newBalance = Math.max(0, Number(note.currentBalance) - principalAmount);
      
      // Update amortization schedule status
      let updatedSchedule = schedule;
      if (nextPendingPayment) {
        updatedSchedule = schedule.map(s => 
          s.paymentNumber === nextPendingPayment.paymentNumber 
            ? { ...s, status: 'paid' } 
            : s
        );
      }
      
      // Calculate next payment date
      const nextPaymentDate = new Date(note.nextPaymentDate || new Date());
      nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
      
      await storage.updateNote(note.id, {
        currentBalance: newBalance.toString(),
        amortizationSchedule: updatedSchedule,
        nextPaymentDate: nextPaymentDate,
        status: newBalance <= 0 ? 'paid_off' : 'active',
      });
      
      res.json({ 
        success: true, 
        payment,
        newBalance,
      });
    } catch (err: any) {
      console.error("Payment verification error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // Generate borrower portal link
  api.post("/api/notes/:id/portal-link", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = Number(req.params.id);
      
      const note = await storage.getNote(org.id, noteId);
      if (!note) {
        return res.status(404).json({ message: "Note not found" });
      }
      
      // Use the access token for the portal URL
      const portalUrl = `${req.protocol}://${req.get('host')}/portal/${note.accessToken}`;
      
      res.json({ url: portalUrl });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // DOCUMENT GENERATION (LgPass replacement)
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
  // DEMO DATA SEEDING
  // ============================================
  
  api.post("/api/seed-demo-data", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      // Sample leads
      const demoLeads = [
        { firstName: "John", lastName: "Martinez", type: "seller", email: "john.martinez@email.com", phone: "(602) 555-1234", address: "123 Desert Rose Lane", city: "Tucson", state: "AZ", zip: "85701", status: "responded", source: "tax_list", notes: "Inherited property, motivated to sell" },
        { firstName: "Sarah", lastName: "Thompson", type: "seller", email: "sarah.t@email.com", phone: "(505) 555-2345", address: "456 Canyon View Dr", city: "Albuquerque", state: "NM", zip: "87101", status: "negotiating", source: "facebook", notes: "Moving out of state, needs quick close" },
        { firstName: "Robert", lastName: "Chen", type: "buyer", email: "rchen@email.com", phone: "(512) 555-3456", address: "789 Oak Street", city: "Austin", state: "TX", zip: "78701", status: "qualified", source: "website", notes: "Looking for 5-10 acre recreational parcels" },
        { firstName: "Maria", lastName: "Garcia", type: "seller", email: "mgarcia@email.com", phone: "(623) 555-4567", address: "321 Sunset Blvd", city: "Phoenix", state: "AZ", zip: "85001", status: "mailed", source: "tax_list", notes: "Initial mailer sent 2 weeks ago" },
        { firstName: "David", lastName: "Wilson", type: "buyer", email: "dwilson@email.com", phone: "(702) 555-5678", address: "555 Palm Way", city: "Las Vegas", state: "NV", zip: "89101", status: "interested", source: "referral", notes: "Pre-approved for $50K, wants AZ or NM" },
        { firstName: "Jennifer", lastName: "Brown", type: "seller", email: "jbrown@email.com", phone: "(480) 555-6789", address: "888 Cactus Court", city: "Scottsdale", state: "AZ", zip: "85251", status: "new", source: "craigslist", notes: "Responded to online ad" },
      ];
      
      const createdLeads = [];
      for (const lead of demoLeads) {
        const created = await storage.createLead({ ...lead, organizationId: org.id });
        createdLeads.push(created);
      }
      
      // Sample properties
      const demoProperties = [
        { apn: "123-45-678", county: "Cochise", state: "AZ", sizeAcres: "5.2", status: "owned", purchasePrice: "8500", marketValue: "15000", description: "Beautiful 5+ acre parcel with mountain views near Willcox" },
        { apn: "234-56-789", county: "Mohave", state: "AZ", sizeAcres: "2.5", status: "listed", purchasePrice: "3200", listPrice: "7900", marketValue: "7500", description: "2.5 acre lot in Golden Valley with road access" },
        { apn: "345-67-890", county: "Luna", state: "NM", sizeAcres: "10.0", status: "owned", purchasePrice: "5000", marketValue: "12000", description: "10 acres of open desert land near Deming" },
        { apn: "456-78-901", county: "Navajo", state: "AZ", sizeAcres: "1.25", status: "prospect", assessedValue: "4500", marketValue: "6000", description: "1.25 acre residential lot in Show Low area" },
        { apn: "567-89-012", county: "Pinal", state: "AZ", sizeAcres: "40.0", status: "under_contract", purchasePrice: "28000", marketValue: "55000", description: "40 acre ranch parcel with well and power nearby" },
      ];
      
      const createdProperties = [];
      for (const prop of demoProperties) {
        const created = await storage.createProperty({ ...prop, organizationId: org.id });
        createdProperties.push(created);
      }
      
      // Sample deals
      const demoDeals = [
        { name: "Cochise 5-Acre Purchase", type: "acquisition", stage: "closed", propertyId: createdProperties[0]?.id, leadId: createdLeads[0]?.id, purchasePrice: "8500", closingDate: new Date("2024-06-15") },
        { name: "Mohave Lot Sale", type: "disposition", stage: "in_escrow", propertyId: createdProperties[1]?.id, leadId: createdLeads[2]?.id, salePrice: "7900", closingDate: new Date("2025-02-01") },
        { name: "Luna County Acquisition", type: "acquisition", stage: "closed", propertyId: createdProperties[2]?.id, leadId: createdLeads[1]?.id, purchasePrice: "5000", closingDate: new Date("2024-09-20") },
        { name: "Pinal Ranch Deal", type: "acquisition", stage: "offer_sent", propertyId: createdProperties[4]?.id, leadId: createdLeads[3]?.id, purchasePrice: "28000" },
      ];
      
      for (const deal of demoDeals) {
        await storage.createDeal({ ...deal, organizationId: org.id });
      }
      
      // Sample notes (seller financing)
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 3);
      const firstPaymentDate = new Date(startDate);
      firstPaymentDate.setMonth(firstPaymentDate.getMonth() + 1);
      
      const demoNotes = [
        { 
          propertyId: createdProperties[0]?.id, 
          borrowerName: "Michael Rodriguez", 
          borrowerEmail: "mrodriguez@email.com", 
          borrowerPhone: "(520) 555-7890",
          originalPrincipal: "12000", 
          currentBalance: "10800",
          interestRate: "9.9", 
          termMonths: 36, 
          monthlyPayment: "387.50",
          downPayment: "3000",
          startDate,
          firstPaymentDate,
          status: "active",
          gracePeriodDays: 10,
          lateFee: "25",
        },
        { 
          propertyId: createdProperties[2]?.id, 
          borrowerName: "Amanda Foster", 
          borrowerEmail: "afoster@email.com", 
          borrowerPhone: "(575) 555-8901",
          originalPrincipal: "8500", 
          currentBalance: "7700",
          interestRate: "10.5", 
          termMonths: 24, 
          monthlyPayment: "395.00",
          downPayment: "2000",
          startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          firstPaymentDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          status: "active",
          gracePeriodDays: 10,
          lateFee: "25",
        },
      ];
      
      for (const note of demoNotes) {
        await storage.createNote({ ...note, organizationId: org.id });
      }
      
      res.json({ 
        success: true, 
        message: "Demo data created successfully",
        counts: {
          leads: createdLeads.length,
          properties: createdProperties.length,
          deals: demoDeals.length,
          notes: demoNotes.length,
        }
      });
    } catch (err: any) {
      console.error("Seed error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // Clear demo data endpoint
  api.post("/api/clear-demo-data", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      // Delete in order to respect foreign key constraints
      await db.delete(payments).where(eq(payments.organizationId, org.id));
      await db.delete(notes).where(eq(notes.organizationId, org.id));
      await db.delete(deals).where(eq(deals.organizationId, org.id));
      await db.delete(properties).where(eq(properties.organizationId, org.id));
      await db.delete(leads).where(eq(leads.organizationId, org.id));
      await db.delete(activityLog).where(eq(activityLog.organizationId, org.id));
      
      res.json({ success: true, message: "All data cleared for your organization" });
    } catch (err: any) {
      console.error("Clear data error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
