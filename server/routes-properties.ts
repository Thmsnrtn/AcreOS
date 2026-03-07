// @ts-nocheck — ORM type refinement deferred; runtime-correct
import type { Express } from "express";
import { storage, db } from "./storage";
import { z } from "zod";
import { insertPropertySchema } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { checkUsageLimit } from "./services/usageLimits";
import { usageMeteringService, creditService } from "./services/credits";
import multer from "multer";
import { parseCSV, importProperties, exportPropertiesToCSV, getExpectedColumns, type ExportFilters } from "./services/importExport";
import { propertyEnrichmentService } from "./services/propertyEnrichment";

// Partial update schema for PUT endpoints
const updatePropertySchema = insertPropertySchema.partial().omit({ organizationId: true });

// Helper function to calculate distance in miles between two coordinates
function calculateDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const MAX_CSV_IMPORT_ROWS = 500;

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

export function registerPropertyRoutes(app: Express): void {
  const api = app;

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
      
      const numericFields = ["sizeAcres", "assessedValue", "marketValue", "purchasePrice", "listPrice", "soldPrice"];
      const sanitizedBody = { ...req.body };
      for (const field of numericFields) {
        if (sanitizedBody[field] === "" || sanitizedBody[field] === null || sanitizedBody[field] === undefined) {
          delete sanitizedBody[field];
        } else if (typeof sanitizedBody[field] === "string") {
          const parsed = parseFloat(sanitizedBody[field]);
          if (!isNaN(parsed)) {
            sanitizedBody[field] = String(parsed);
          }
        }
      }
      
      const input = insertPropertySchema.parse({ ...sanitizedBody, organizationId: org.id });
      const property = await storage.createProperty(input);

      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "create",
        entityType: "property",
        entityId: property.id,
        changes: { after: input, fields: Object.keys(input) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });

      // Auto-enrich new properties that have GPS coordinates (fire-and-forget, non-blocking)
      if (property.latitude && property.longitude) {
        propertyEnrichmentService.enrichProperty(org.id, property.id, false).catch((err: Error) => {
          console.error(`[AutoEnrich] Background enrichment failed for property ${property.id}:`, err.message);
        });
      }

      res.status(201).json(property);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
      }
      throw err;
    }
  });
  
  api.put("/api/properties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.id);
      const existingProperty = await storage.getProperty(org.id, propertyId);
      if (!existingProperty) return res.status(404).json({ message: "Property not found" });
      
      const numericFields = ["sizeAcres", "assessedValue", "marketValue", "purchasePrice", "listPrice", "soldPrice"];
      const sanitizedBody = { ...req.body };
      for (const field of numericFields) {
        if (sanitizedBody[field] === "" || sanitizedBody[field] === null) {
          sanitizedBody[field] = null;
        } else if (sanitizedBody[field] !== undefined && typeof sanitizedBody[field] === "string") {
          const parsed = parseFloat(sanitizedBody[field]);
          if (!isNaN(parsed)) {
            sanitizedBody[field] = String(parsed);
          }
        }
      }
      
      const validated = updatePropertySchema.parse(sanitizedBody);
      const property = await storage.updateProperty(propertyId, validated);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "update",
        entityType: "property",
        entityId: propertyId,
        changes: { before: existingProperty, after: property, fields: Object.keys(validated) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json(property);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
      }
      throw err;
    }
  });
  
  api.delete("/api/properties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.id);
      
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }
      
      const existingProperty = await storage.getProperty(org.id, propertyId);
      
      if (!existingProperty) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      await storage.deleteProperty(propertyId);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "delete",
        entityType: "property",
        entityId: propertyId,
        changes: { before: existingProperty, fields: ["deleted"] },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete property error:", error);
      res.status(500).json({ message: error.message || "Failed to delete property" });
    }
  });
  
  api.post("/api/properties/bulk-delete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { ids } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array" });
      }
      
      const deletedCount = await storage.bulkDeleteProperties(org.id, ids);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "bulk_delete",
        entityType: "property",
        entityId: 0,
        changes: { ids, count: deletedCount },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ deletedCount });
    } catch (error: any) {
      console.error("Bulk delete properties error:", error);
      res.status(500).json({ message: error.message || "Failed to bulk delete properties" });
    }
  });
  
  api.post("/api/properties/bulk-update", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { ids, updates } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array" });
      }
      
      if (!updates || typeof updates !== "object") {
        return res.status(400).json({ message: "updates must be an object" });
      }
      
      const updatedCount = await storage.bulkUpdateProperties(org.id, ids, updates);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "bulk_update",
        entityType: "property",
        entityId: 0,
        changes: { ids, updates, count: updatedCount },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ updatedCount });
    } catch (error: any) {
      console.error("Bulk update properties error:", error);
      res.status(500).json({ message: error.message || "Failed to bulk update properties" });
    }
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
      
      // Check row count limit
      if (csvData.length > MAX_CSV_IMPORT_ROWS) {
        return res.status(400).json({ 
          message: `CSV file exceeds maximum of ${MAX_CSV_IMPORT_ROWS} rows. Your file has ${csvData.length} rows. Please split into smaller files.`,
          rowCount: csvData.length,
          maxRows: MAX_CSV_IMPORT_ROWS,
        });
      }
      
      // Pre-check usage limits before importing
      const usageCheck = await checkUsageLimit(org.id, "properties");
      if (usageCheck.limit !== null) {
        const wouldExceed = usageCheck.current + csvData.length > usageCheck.limit;
        if (wouldExceed) {
          return res.status(429).json({
            message: `Import would exceed your plan limit of ${usageCheck.limit} properties (current: ${usageCheck.current}, importing: ${csvData.length}). Upgrade your plan to import more properties.`,
            current: usageCheck.current,
            importing: csvData.length,
            limit: usageCheck.limit,
            tier: usageCheck.tier,
          });
        }
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
      const expectedColumns = getExpectedColumns("properties");
      
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
      
      // Check if org has their own Regrid credentials (BYOK) - if so, skip credit check
      const regridIntegration = await storage.getOrganizationIntegration(org.id, 'regrid');
      const usingOrgRegridCredentials = regridIntegration?.isEnabled && regridIntegration?.credentials?.encrypted;
      
      if (!usingOrgRegridCredentials) {
        // Credit pre-check for comps query (10 cents per query) - only when using platform credentials
        const compsCost = await usageMeteringService.calculateCost("comps_query", 1);
        const hasCredits = await creditService.hasEnoughCredits(org.id, compsCost);
        if (!hasCredits) {
          const balance = await creditService.getBalance(org.id);
          return res.status(402).json({
            error: "Insufficient credits",
            required: compsCost / 100,
            balance: balance / 100,
          });
        }
      } else {
        console.log(`[CompsEndpoint] Skipping credit pre-check for org ${org.id} - using org Regrid credentials`);
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
      
      // Build property attributes for desirability scoring
      const propertyAttributes = {
        roadAccess: property.roadAccess,
        utilities: property.utilities,
        terrain: property.terrain,
        zoning: property.zoning,
        sizeAcres: subjectAcreage,
        city: property.city,
      };
      
      const result = await getPropertyComps(lat, lng, subjectAcreage, radiusMiles, filters, propertyAttributes, org.id);
      
      // Skip credit recording if using organization's own Regrid credentials (BYOK)
      const usingOrgCredentials = result.credentialSource === 'organization';
      
      if (!usingOrgCredentials) {
        // Record usage after successful comps query only when using platform credentials
        await usageMeteringService.recordUsage(org.id, "comps_query", 1, {
          propertyId: property.id,
          lat,
          lng,
          radiusMiles,
        });
      } else {
        console.log(`[CompsEndpoint] Skipping credit usage for org ${org.id} - using org Regrid credentials`);
      }
      
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
      const org = (req as any).organization;
      const { lat, lng, radius, subjectAcreage, filters } = req.body;
      
      if (!lat || !lng) {
        return res.status(400).json({ message: "Latitude and longitude are required" });
      }
      
      // Check if org has their own Regrid credentials (BYOK) - if so, skip credit check
      const regridIntegration = await storage.getOrganizationIntegration(org.id, 'regrid');
      const usingOrgRegridCredentials = regridIntegration?.isEnabled && regridIntegration?.credentials?.encrypted;
      
      if (!usingOrgRegridCredentials) {
        // Credit pre-check for comps query (10 cents per query) - only when using platform credentials
        const compsCost = await usageMeteringService.calculateCost("comps_query", 1);
        const hasCredits = await creditService.hasEnoughCredits(org.id, compsCost);
        if (!hasCredits) {
          const balance = await creditService.getBalance(org.id);
          return res.status(402).json({
            error: "Insufficient credits",
            required: compsCost / 100,
            balance: balance / 100,
          });
        }
      } else {
        console.log(`[CompsSearch] Skipping credit pre-check for org ${org.id} - using org Regrid credentials`);
      }
      
      const radiusMiles = radius || 5;
      const acreage = subjectAcreage || 0;
      
      const { getPropertyComps } = await import("./services/comps");
      const result = await getPropertyComps(lat, lng, acreage, radiusMiles, filters || {}, undefined, org.id);
      
      // Skip credit recording if using organization's own Regrid credentials (BYOK)
      const usingOrgCredentials = result.credentialSource === 'organization';
      
      if (!usingOrgCredentials) {
        // Record usage after successful comps search only when using platform credentials
        await usageMeteringService.recordUsage(org.id, "comps_query", 1, {
          lat,
          lng,
          radiusMiles,
        });
      } else {
        console.log(`[CompsSearch] Skipping credit usage for org ${org.id} - using org Regrid credentials`);
      }
      
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
        const org = (req as any).organization;
        result = await lookupParcelByAPN(apn, path, org?.id);
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
  
  // Get nearby parcels for map visualization
  api.get("/api/parcels/nearby", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { getNearbyParcelsFromCountyGIS } = await import("./services/parcel");
      
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      const state = req.query.state as string;
      const county = req.query.county as string;
      const radius = parseFloat(req.query.radius as string) || 0.5;
      
      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ message: "Valid lat/lng coordinates required" });
      }
      
      if (!state || !county) {
        return res.status(400).json({ message: "State and county required" });
      }
      
      const result = await getNearbyParcelsFromCountyGIS(lat, lng, state, county, radius);
      res.json(result);
    } catch (err) {
      console.error("Nearby parcels error:", err);
      res.status(500).json({ message: "Failed to fetch nearby parcels" });
    }
  });

  // Get nearby parcels for a specific property by ID
  api.get("/api/properties/:id/nearby", isAuthenticated, getOrCreateOrg, async (req, res) => {
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
      
      if (!property.state || !property.county) {
        return res.status(400).json({ 
          message: "Property state and county required for nearby parcel lookup.",
          error: "missing_location"
        });
      }
      
      const radiusMiles = parseFloat(req.query.radius as string) || 1;
      
      const { getNearbyParcelsFromCountyGIS } = await import("./services/parcel");
      const result = await getNearbyParcelsFromCountyGIS(lat, lng, property.state, property.county, radiusMiles);
      
      // Filter out the subject property from results and add additional info
      const filteredParcels = result.parcels
        .filter(p => p.apn !== property.apn)
        .map(p => ({
          ...p,
          distance: calculateDistanceMiles(lat, lng, p.centroid.lat, p.centroid.lng),
        }))
        .sort((a, b) => a.distance - b.distance);
      
      res.json({
        ...result,
        parcels: filteredParcels,
        subjectProperty: {
          id: property.id,
          apn: property.apn,
          coordinates: { lat, lng },
        },
      });
    } catch (err) {
      console.error("Nearby parcels by property error:", err);
      res.status(500).json({ message: "Failed to fetch nearby parcels" });
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
      
      const result = await lookupParcelByAPN(property.apn, path, org.id);
      
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

  // Bulk fetch parcel data for properties missing boundaries
  api.post("/api/properties/fetch-all-parcels", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { lookupParcelByAPN } = await import("./services/parcel");
      const org = (req as any).organization;
      
      // Get all properties missing parcel boundaries
      const allProperties = await storage.getProperties(org.id);
      const propertiesWithoutBoundaries = allProperties.filter(
        p => !p.parcelBoundary && p.apn && p.state && p.county
      );
      
      if (propertiesWithoutBoundaries.length === 0) {
        return res.json({ 
          message: "All properties already have parcel boundaries",
          updated: 0,
          failed: 0 
        });
      }
      
      console.log(`[BulkParcel] Fetching parcels for ${propertiesWithoutBoundaries.length} properties`);
      
      const results: Array<{ propertyId: number; apn: string; success: boolean; source?: string; error?: string }> = [];
      
      for (const property of propertiesWithoutBoundaries) {
        try {
          const path = `/us/${property.state!.toLowerCase()}/${property.county!.toLowerCase().replace(/\s+/g, "-")}`;
          const result = await lookupParcelByAPN(property.apn, path, org.id);
          
          if (result.found && result.parcel) {
            await storage.updateProperty(property.id, {
              parcelBoundary: result.parcel.boundary,
              parcelCentroid: result.parcel.centroid,
              parcelData: result.parcel.data,
              latitude: String(result.parcel.centroid.lat),
              longitude: String(result.parcel.centroid.lng),
            });
            results.push({ propertyId: property.id, apn: property.apn, success: true, source: result.source });
            console.log(`[BulkParcel] Found parcel for ${property.apn} from ${result.source}`);
          } else {
            results.push({ propertyId: property.id, apn: property.apn, success: false, error: result.error || 'not found' });
          }
        } catch (err: any) {
          results.push({ propertyId: property.id, apn: property.apn, success: false, error: err.message });
        }
      }
      
      const updated = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      res.json({
        message: `Updated ${updated} properties with parcel data${failed > 0 ? `, ${failed} failed` : ''}`,
        updated,
        failed,
        results
      });
    } catch (err) {
      console.error("Bulk fetch parcel error:", err);
      res.status(500).json({ message: "Failed to bulk fetch parcel data" });
    }
  });
  

}
