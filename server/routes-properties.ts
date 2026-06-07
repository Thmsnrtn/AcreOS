import type { Express } from "express";
import { storage, db } from "./storage";
import { z } from "zod";
import { insertPropertySchema, landStatusSchema } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { checkUsageLimit } from "./services/usageLimits";
import { usageMeteringService, creditService } from "./services/credits";
import { parseCSV, importProperties, exportPropertiesToCSV, getExpectedColumns, type ExportFilters } from "./services/importExport";
import { propertyEnrichmentService } from "./services/propertyEnrichment";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { createUploadMiddleware, validateFileMiddleware } from "./middleware/fileUploadSecurity";
import { compsGuard } from "./middleware/expensiveEndpointGuard";

// Partial update schema for PUT endpoints.
// insertPropertySchema already omits organizationId, so no further omit needed.
const updatePropertySchema = insertPropertySchema.partial();

// Zod schema for comps search
const compsSearchSchema = z.object({
  lat: z.number({ message: "lat is required" }),
  lng: z.number({ message: "lng is required" }),
  radius: z.number().min(0.1).max(50).optional(),
  subjectAcreage: z.number().min(0).optional(),
  filters: z.object({
    minAcreage: z.number().optional(),
    maxAcreage: z.number().optional(),
    propertyType: z.string().optional(),
    minSaleDate: z.string().optional(),
    maxSaleDate: z.string().optional(),
    maxResults: z.number().int().positive().optional(),
  }).optional(),
});

// Zod schema for parcel lookup
const parcelLookupSchema = z.object({
  apn: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  state: z.string().optional(),
  county: z.string().optional(),
}).refine(
  (data) => data.apn || (data.lat !== undefined && data.lng !== undefined),
  { message: "Provide either APN or coordinates (lat/lng)" }
);

// Task #202: Zod schemas for bulk operations
const bulkIdsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, "ids must be a non-empty array"),
});
const bulkUpdateSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, "ids must be a non-empty array"),
  updates: updatePropertySchema,
});

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

const upload = createUploadMiddleware({ maxSizeMB: 5, allowedTypes: ["text"] });
const validateCSV = validateFileMiddleware(["text"]);

// Zod schema for pagination query params
const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.string().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export function registerPropertyRoutes(app: Express): void {
  const api = app;

  // ── Rosy River B9 — Property report PDF ─────────────────────────────────
  // Registered BEFORE /api/properties/:id so the .pdf suffix doesn't get
  // swallowed by the generic detail handler.
  api.get(
    "/api/properties/:id/report.pdf",
    isAuthenticated,
    getOrCreateOrg,
    async (req, res) => {
      try {
        const org = req.organization;
        const propertyId = parseInt(req.params.id, 10);
        if (!Number.isFinite(propertyId)) {
          return Errors.badRequest(res, "Invalid property id");
        }
        const { generatePropertyReport } = await import("./services/propertyReportPdf");
        const doc = await generatePropertyReport({
          propertyId,
          organizationId: org.id,
        });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `inline; filename="property-${propertyId}.pdf"`,
        );
        doc.pipe(res);
        doc.end();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "Property not found") {
          return Errors.notFound(res, "Property");
        }
        return Errors.internal(res, err);
      }
    },
  );

  // PROPERTIES (INVENTORY)
  // ============================================

  api.get("/api/properties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;

    const pagination = paginationQuerySchema.safeParse(req.query);
    if (!pagination.success) {
      return Errors.badRequest(res, "Invalid pagination parameters", pagination.error.issues);
    }
    const { page, pageSize, sortBy, sortOrder } = pagination.data;

    const result = await storage.getPropertiesPaginated(org.id, { page, pageSize, sortBy, sortOrder });

    res.json({
      data: result.data,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    });
  });
  
  // STR-023: GET /api/properties/by-location — registered BEFORE /:id so
  // Express resolves the verb-style path to this handler rather than
  // treating "by-location" as an :id and NaN-querying the DB.
  api.get("/api/properties/by-location", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const radius = Number(req.query.radius) || 5;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return Errors.badRequest(res, "lat and lng are required numeric query params");
      }
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return Errors.badRequest(res, "lat must be in [-90, 90] and lng in [-180, 180]");
      }
      const clampedRadius = Math.min(Math.max(radius, 0.1), 50);
      const { findNearbyProperties } = await import("./services/propertyIntelligenceEnhancements");
      const nearby = await findNearbyProperties(org.id, lat, lng, clampedRadius);
      const withDistance = nearby.map((p: any) => {
        const pLat = p.latitude ? Number(p.latitude) : null;
        const pLng = p.longitude ? Number(p.longitude) : null;
        const R = 3959; // miles
        let distanceMiles: number | null = null;
        if (pLat !== null && pLng !== null) {
          const dLat = ((pLat - lat) * Math.PI) / 180;
          const dLng = ((pLng - lng) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos((lat * Math.PI) / 180) * Math.cos((pLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
          distanceMiles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }
        return { ...p, distanceMiles: distanceMiles !== null ? Number(distanceMiles.toFixed(2)) : null };
      });
      withDistance.sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity));
      res.json({ properties: withDistance, count: withDistance.length, radius: clampedRadius, lat, lng });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // ── Land Snapshot — the canonical decision-grade LandProfile ────────────
  // Cache-first: serves the persisted free-enrichment bundle assembled into a
  // LandProfile. On a cold parcel (never enriched) it runs the fast
  // coordinate-only pre-warm live, then assembles. Registered BEFORE /:id so
  // "land-profile" isn't swallowed as an :id.
  api.get(
    "/api/properties/:id/land-profile",
    isAuthenticated,
    getOrCreateOrg,
    async (req, res) => {
      try {
        const org = req.organization;
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          return Errors.notFound(res, "Property");
        }
        const property = await storage.getProperty(org.id, id);
        if (!property) return Errors.notFound(res, "Property");

        const { assembleLandProfile } = await import("./services/landProfile");
        const lat = property.latitude ? parseFloat(String(property.latitude)) : NaN;
        const lng = property.longitude ? parseFloat(String(property.longitude)) : NaN;

        // 1) Cache-first: use the persisted enrichment bundle if present.
        const cached = property.enrichmentData as
          | (import("./services/propertyEnrichment").EnrichmentResult & {
              lastEnrichedAt?: string;
            })
          | null
          | undefined;
        if (cached && (cached.provenance || cached.parcel || cached.hazards)) {
          return res.json(assembleLandProfile(property, cached, true));
        }

        // 2) Cold parcel: run the fast coordinate-only pre-warm live, then
        //    assemble. Falls back to an honest all-gaps profile if no coords.
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          const result = await propertyEnrichmentService.prewarmLandProfile(lat, lng, {
            organizationId: org.id,
            propertyId: id,
            state: property.state || undefined,
            county: property.county || undefined,
            apn: property.apn || undefined,
          });
          return res.json(assembleLandProfile(property, result, false));
        }

        // 3) No coordinates — assemble an honest, all-gaps profile.
        return res.json(assembleLandProfile(property, null, false));
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  api.get("/api/properties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const id = Number(req.params.id);
    // STR-023 defense-in-depth: reject non-numeric :id even if a sibling
    // verb-style path isn't registered above.
    if (!Number.isFinite(id) || id <= 0) {
      return Errors.notFound(res, "Property");
    }
    const property = await storage.getProperty(org.id, id);
    if (!property) return Errors.notFound(res, "Property");
    res.json(property);
  });

  api.post("/api/properties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      
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
      // F-D27: callers sometimes send `acreage` (matches lead form + everyday English)
      // while the property schema persists `sizeAcres`. Alias before validation so a
      // typed body of `{ acreage: 5 }` doesn't fail with "sizeAcres required".
      if (sanitizedBody.acreage !== undefined && sanitizedBody.sizeAcres === undefined) {
        sanitizedBody.sizeAcres = sanitizedBody.acreage;
        delete sanitizedBody.acreage;
      }
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

      // insertPropertySchema omits organizationId, so re-attach it for the
      // createProperty(InsertProperty & { organizationId }) contract.
      const input = insertPropertySchema.parse({ ...sanitizedBody, organizationId: org.id });
      const property = await storage.createProperty({ ...input, organizationId: org.id });

      const user = req.user as any;
      const userId = user?.id || user?.id;
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

      // Phase 3 Week 14 — Activation telemetry. Idempotent FIRST-occurrence.
      try {
        const { recordActivationEventAsync } = await import("./services/activation");
        recordActivationEventAsync({
          orgId: org.id,
          userId,
          eventName: "first_property_added",
          eventValue: { propertyId: property.id },
        });
      } catch { /* non-fatal */ }

      // Cache-first pre-warm: fire-and-forget the fast coordinate-only
      // land-profile enrich (flood/soil/elevation/etc. need only lat/lng) so the
      // first parcel-detail "Land Snapshot" view is warm (<800ms) instead of
      // cold-fetching ~8 federal endpoints live. The full ~21-category enrich
      // still runs on demand via /api/properties/:id/enrich.
      if (property.latitude && property.longitude) {
        const lat = parseFloat(String(property.latitude));
        const lng = parseFloat(String(property.longitude));
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          propertyEnrichmentService
            .prewarmLandProfile(lat, lng, {
              organizationId: org.id,
              propertyId: property.id,
              state: property.state || undefined,
              county: property.county || undefined,
              apn: property.apn || undefined,
            })
            .catch((err: Error) => {
              logger.error(`[Prewarm] Background pre-warm failed for property ${property.id}: ${err.message}`);
            });
        }
      }

      res.status(201).json(property);
    } catch (err: any) {
      if (err instanceof z.ZodError || err?.errors) {
        return Errors.badRequest(res, "Validation failed", (err.issues || []).map((e: any) => ({ field: e.path?.join?.('.') || '', message: e.message || String(e) })));
      }
      return Errors.internal(res, err);
    }
  });

  api.put("/api/properties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.id);
      const existingProperty = await storage.getProperty(org.id, propertyId);
      if (!existingProperty) return Errors.notFound(res, "Property");

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
      const property = await storage.updateProperty(propertyId, validated, org.id);

      const user = req.user as any;
      const userId = user?.id || user?.id;
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

      // Auto-enrich when coordinates are newly set or changed
      const coordChanged =
        (validated.latitude !== undefined || validated.longitude !== undefined) &&
        property.latitude && property.longitude &&
        (String(existingProperty.latitude) !== String(property.latitude) ||
          String(existingProperty.longitude) !== String(property.longitude));
      if (coordChanged) {
        const lat = parseFloat(String(property.latitude));
        const lng = parseFloat(String(property.longitude));
        if (!isNaN(lat) && !isNaN(lng)) {
          propertyEnrichmentService.enrichByCoordinates(lat, lng, {
            propertyId,
            state: property.state || undefined,
            county: property.county || undefined,
            apn: property.apn || undefined,
          }).catch(err =>
            logger.warn(`[AutoEnrich] Background enrichment failed for property ${propertyId}`, err instanceof Error ? err : undefined)
          );
        }
      }

      res.json(property);
    } catch (err: any) {
      if (err instanceof z.ZodError || err?.errors) {
        return Errors.badRequest(res, "Validation failed", (err.issues || []).map((e: any) => ({ field: e.path?.join?.('.') || '', message: e.message || String(e) })));
      }
      return Errors.internal(res, err);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PATCH /api/properties/:id/land-status (Aniyah §2)
  //
  // Manual land-status verification surface. After human due diligence
  // (review of BIA records, county assessor flags, tribal jurisdiction,
  // restricted-fee patents), the user sets the parcel's landStatus so
  // automation can either run (fee) or stay blocked (any trust variant).
  //
  // Audit log captures before/after — this is a regulated decision and we
  // need a clear chain of custody.
  // ──────────────────────────────────────────────────────────────────────────
  const landStatusUpdateSchema = z.object({
    landStatus: landStatusSchema,
    verificationNotes: z.string().max(2000).optional(),
  });

  api.patch("/api/properties/:id/land-status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.id);

      if (isNaN(propertyId)) {
        return Errors.badRequest(res, "Invalid property ID");
      }

      const parsed = landStatusUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.badRequest(
          res,
          "Validation failed",
          parsed.error.issues.map((e) => ({ field: e.path.join("."), message: e.message })),
        );
      }

      const existing = await storage.getProperty(org.id, propertyId);
      if (!existing) {
        return Errors.notFound(res, "Property");
      }

      const updated = await storage.updateProperty(
        propertyId,
        { landStatus: parsed.data.landStatus },
        org.id,
      );

      const user = req.user as any;
      const userId = user?.id || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "update",
        entityType: "property",
        entityId: propertyId,
        changes: {
          before: { landStatus: existing.landStatus },
          after: {
            landStatus: parsed.data.landStatus,
            verificationNotes: parsed.data.verificationNotes,
            regulatoryBasis: ["25 USC §177", "25 CFR §152"],
          },
          fields: ["landStatus"],
        },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });

      logger.info(
        `[LandStatus] Property ${propertyId} set to ${parsed.data.landStatus} by user ${userId} (org ${org.id})`,
      );

      res.json({
        id: updated.id,
        landStatus: updated.landStatus,
      });
    } catch (err: any) {
      logger.error("Land status update error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  api.delete("/api/properties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.id);
      
      if (isNaN(propertyId)) {
        return Errors.badRequest(res, "Invalid property ID");
      }
      
      const existingProperty = await storage.getProperty(org.id, propertyId);
      
      if (!existingProperty) {
        return Errors.notFound(res, "Property");
      }

      await storage.deleteProperty(propertyId, org.id);
      
      const user = req.user as any;
      const userId = user?.id || user?.id;
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
      logger.error("Delete property error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });
  
  api.post("/api/properties/bulk-delete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = bulkIdsSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.badRequest(res, parsed.error.issues[0].message);
      }
      const { ids } = parsed.data;

      const deletedCount = await storage.bulkDeleteProperties(org.id, ids);
      
      const user = req.user as any;
      const userId = user?.id || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "bulk_delete",
        entityType: "property",
        entityId: 0,
        changes: { after: { ids, count: deletedCount } },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ deletedCount });
    } catch (error: any) {
      logger.error("Bulk delete properties error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });
  
  api.post("/api/properties/bulk-update", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = bulkUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.badRequest(res, parsed.error.issues[0].message);
      }
      const { ids, updates } = parsed.data;

      const updatedCount = await storage.bulkUpdateProperties(org.id, ids, updates);
      
      const user = req.user as any;
      const userId = user?.id || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "bulk_update",
        entityType: "property",
        entityId: 0,
        changes: { after: { ids, updates, count: updatedCount } },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ updatedCount });
    } catch (error: any) {
      logger.error("Bulk update properties error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });
  
  api.get("/api/properties/export", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const csv = await exportPropertiesToCSV(org.id);
    const date = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="properties-${date}.csv"`);
    res.send(csv);
  });
  
  api.post("/api/properties/import", isAuthenticated, getOrCreateOrg, upload.single("file"), validateCSV, async (req, res) => {
    try {
      const org = req.organization;
      const file = req.file;
      
      if (!file) {
        return Errors.badRequest(res, "No file uploaded");
      }

      const csvString = file.buffer.toString("utf-8");
      const csvData = parseCSV(csvString);

      if (csvData.length === 0) {
        return Errors.badRequest(res, "CSV file is empty or has no data rows");
      }

      // Check row count limit
      if (csvData.length > MAX_CSV_IMPORT_ROWS) {
        return Errors.badRequest(res, `CSV file exceeds maximum of ${MAX_CSV_IMPORT_ROWS} rows. Your file has ${csvData.length} rows. Please split into smaller files.`, {
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
      logger.error("Property import error", err instanceof Error ? err : undefined);
      Errors.badRequest(res, err instanceof Error ? err.message : "Failed to import properties");
    }
  });
  
  api.post("/api/properties/import/preview", isAuthenticated, getOrCreateOrg, upload.single("file"), validateCSV, async (req, res) => {
    try {
      const file = req.file;
      
      if (!file) {
        return Errors.badRequest(res, "No file uploaded");
      }

      const csvString = file.buffer.toString("utf-8");
      const csvData = parseCSV(csvString);

      if (csvData.length === 0) {
        return Errors.badRequest(res, "CSV file is empty or has no data rows");
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
      logger.error("Property import preview error", err instanceof Error ? err : undefined);
      Errors.badRequest(res, err instanceof Error ? err.message : "Failed to parse CSV");
    }
  });
  
  // ============================================
  // COMPS ANALYSIS (Comparable Properties)
  // ============================================
  
  api.get("/api/properties/:id/comps", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const property = await storage.getProperty(org.id, Number(req.params.id));
      
      if (!property) {
        return Errors.notFound(res, "Property");
      }

      const lat = property.parcelCentroid?.lat || (property.latitude ? parseFloat(String(property.latitude)) : null);
      const lng = property.parcelCentroid?.lng || (property.longitude ? parseFloat(String(property.longitude)) : null);

      if (!lat || !lng) {
        return Errors.badRequest(res, "Property coordinates not available. Please fetch parcel data first.", { error: "missing_coordinates" });
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
        logger.info(`[CompsEndpoint] Skipping credit pre-check for org ${org.id} - using org Regrid credentials`);
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
        logger.info(`[CompsEndpoint] Skipping credit usage for org ${org.id} - using org Regrid credentials`);
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
      logger.error("Comps lookup error", err instanceof Error ? err : undefined);
      Errors.internal(res, err instanceof Error ? err : new Error("Failed to fetch comparable properties"));
    }
  });
  
  api.post("/api/comps/search", isAuthenticated, getOrCreateOrg, compsGuard, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = compsSearchSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { lat, lng, radius, subjectAcreage, filters } = parsed.data;
      
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
        logger.info(`[CompsSearch] Skipping credit pre-check for org ${org.id} - using org Regrid credentials`);
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
        logger.info(`[CompsSearch] Skipping credit usage for org ${org.id} - using org Regrid credentials`);
      }
      
      res.json(result);
    } catch (err) {
      logger.error("Comps search error", err instanceof Error ? err : undefined);
      Errors.internal(res, err instanceof Error ? err : new Error("Failed to search comparable properties"));
    }
  });
  
  // ============================================
  // PARCEL LOOKUP (Regrid Integration)
  // ============================================
  
  api.post("/api/parcels/lookup", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { lookupParcelByAPN, lookupParcelByCoordinates } = await import("./services/parcel");

      const parsed = parcelLookupSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { apn, lat, lng, state, county } = parsed.data;
      
      let result;
      if (apn) {
        // Build state/county path if provided
        let path: string | undefined;
        if (state && county) {
          path = `/us/${state.toLowerCase()}/${county.toLowerCase().replace(/\s+/g, "-")}`;
        }
        const org = req.organization;
        result = await lookupParcelByAPN(apn, path, org?.id);
      } else if (lat != null && lng != null) {
        result = await lookupParcelByCoordinates(lat, lng);
      } else {
        return Errors.badRequest(res, "Provide either an apn or lat/lng coordinates");
      }
      
      if (!result.found) {
        return Errors.notFound(res, "Parcel");
      }

      res.json(result.parcel);
    } catch (err) {
      logger.error("Parcel lookup error", err instanceof Error ? err : undefined);
      Errors.internal(res, err instanceof Error ? err : new Error("Failed to lookup parcel data"));
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
        return Errors.badRequest(res, "Valid lat/lng coordinates required");
      }
      
      if (!state || !county) {
        return Errors.badRequest(res, "State and county required");
      }
      
      const result = await getNearbyParcelsFromCountyGIS(lat, lng, state, county, radius);
      res.json(result);
    } catch (err) {
      logger.error("Nearby parcels error", err instanceof Error ? err : undefined);
      Errors.internal(res, err instanceof Error ? err : new Error("Failed to fetch nearby parcels"));
    }
  });

  // Get nearby parcels for a specific property by ID
  api.get("/api/properties/:id/nearby", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const property = await storage.getProperty(org.id, Number(req.params.id));
      
      if (!property) {
        return Errors.notFound(res, "Property");
      }

      const lat = property.parcelCentroid?.lat || (property.latitude ? parseFloat(String(property.latitude)) : null);
      const lng = property.parcelCentroid?.lng || (property.longitude ? parseFloat(String(property.longitude)) : null);

      if (!lat || !lng) {
        return Errors.badRequest(res, "Property coordinates not available. Please fetch parcel data first.", { error: "missing_coordinates" });
      }

      if (!property.state || !property.county) {
        return Errors.badRequest(res, "Property state and county required for nearby parcel lookup.", { error: "missing_location" });
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
      logger.error("Nearby parcels by property error", err instanceof Error ? err : undefined);
      Errors.internal(res, err instanceof Error ? err : new Error("Failed to fetch nearby parcels"));
    }
  });

  // Update property with parcel data
  api.post("/api/properties/:id/fetch-parcel", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { lookupParcelByAPN } = await import("./services/parcel");
      const org = req.organization;
      
      const property = await storage.getProperty(org.id, Number(req.params.id));
      if (!property) {
        return Errors.notFound(res, "Property");
      }

      // Build state/county path
      let path: string | undefined;
      if (property.state && property.county) {
        path = `/us/${property.state.toLowerCase()}/${property.county.toLowerCase().replace(/\s+/g, "-")}`;
      }
      
      const result = await lookupParcelByAPN(property.apn, path, org.id);
      
      if (!result.found || !result.parcel) {
        return Errors.notFound(res, "Parcel");
      }
      
      // Update property with parcel data
      const updated = await storage.updateProperty(property.id, {
        parcelBoundary: result.parcel.boundary,
        parcelCentroid: result.parcel.centroid,
        parcelData: result.parcel.data,
        latitude: String(result.parcel.centroid.lat),
        longitude: String(result.parcel.centroid.lng),
      }, org.id);

      res.json(updated);
    } catch (err) {
      logger.error("Fetch parcel error", err instanceof Error ? err : undefined);
      Errors.internal(res, err instanceof Error ? err : new Error("Failed to fetch parcel data"));
    }
  });

  // Bulk fetch parcel data for properties missing boundaries
  api.post("/api/properties/fetch-all-parcels", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { lookupParcelByAPN } = await import("./services/parcel");
      const org = req.organization;
      
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
      
      logger.info(`[BulkParcel] Fetching parcels for ${propertiesWithoutBoundaries.length} properties`);
      
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
            }, org.id);
            results.push({ propertyId: property.id, apn: property.apn, success: true, source: result.source });
            logger.info(`[BulkParcel] Found parcel for ${property.apn} from ${result.source}`);
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
      logger.error("Bulk fetch parcel error", err instanceof Error ? err : undefined);
      Errors.internal(res, err instanceof Error ? err : new Error("Failed to bulk fetch parcel data"));
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/properties/:id/detect-land-status (P0-18 Phase B — LAR overlay)
  //
  // Runs the parcel's lat/lng through the BIA Land Area Representations
  // overlay. When the dataset is loaded and the point falls inside a LAR
  // polygon, returns { status: 'tribal_trust' | ..., confidence: 1, ... }.
  // When the dataset isn't loaded, returns 'unknown' with source =
  // 'no_overlay_loaded' so the operator's manual-verification flow stays
  // authoritative.
  //
  // Doesn't auto-WRITE the detected status — surfaces the result so the
  // existing PATCH /land-status endpoint can take it as input. Audit log
  // captures every detection for chain-of-custody.
  // ──────────────────────────────────────────────────────────────────────────
  api.post("/api/properties/:id/detect-land-status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.id);
      if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");

      const property = await storage.getProperty(org.id, propertyId);
      if (!property) return Errors.notFound(res, "Property");

      const lat = property.latitude != null ? parseFloat(property.latitude as any) : NaN;
      const lng = property.longitude != null ? parseFloat(property.longitude as any) : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return Errors.badRequest(res, "Property has no lat/lng — geocode it first");
      }

      const { detectLandStatusFromCoords } = await import("./services/landStatusLAR");
      const result = detectLandStatusFromCoords(lat, lng);

      const user = req.user as any;
      const userId = user?.id || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "detect_land_status",
        entityType: "property",
        entityId: propertyId,
        changes: {
          after: {
            coords: { lat, lng },
            result,
            regulatoryBasis: ["25 USC §177", "25 CFR §152"],
          },
        },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });

      logger.info(`[LAR] Property ${propertyId} detected: ${result.status} (${result.source}, confidence ${result.confidence})`);
      res.json(result);
    } catch (err) {
      logger.error("Land-status detection error", err instanceof Error ? err : undefined);
      Errors.internal(res, err instanceof Error ? err : new Error("Land-status detection failed"));
    }
  });

}
