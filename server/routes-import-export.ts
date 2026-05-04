import type { Express } from "express";
import { storage, db } from "./storage";
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { leads } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import {
  parseCSV, previewImport, importLeads, importProperties, importDeals,
  importNotesFromCSV, NOTE_COLUMN_MAP,
  exportLeadsToCSV, exportPropertiesToCSV, exportDealsToCSV, exportNotesToCSV,
  getLeadsData, getPropertiesData, getDealsData, getNotesData,
  createBackupZip, getExpectedColumns, type ExportFilters,
} from "./services/importExport";
import {
  createImportJob,
  createExportJob,
  getImportJob,
  getExportJob,
  listImportJobs,
  listExportJobs,
  readExportArchive,
  MAX_IMPORT_ROWS,
} from "./services/migrationJobs";
import { logger } from "./utils/logger";
import { createUploadMiddleware, validateFileMiddleware } from "./middleware/fileUploadSecurity";
import { auditFromRequest, AuditActions } from "./utils/auditLog";

// Phase 4 Week 15-16 (Magdalena §1): the synchronous /api/import/:entityType
// handler still rejects CSVs above this limit so legacy clients see a clear
// 400 instead of timing out. New job-backed flows (POST /api/import/leads etc)
// accept up to MAX_IMPORT_ROWS (50,000).
const MAX_CSV_IMPORT_ROWS = 500;

const upload = createUploadMiddleware({ maxSizeMB: 5, allowedTypes: ["text"] });
const validateCSV = validateFileMiddleware(["text"]);

// Job-backed uploads accept larger payloads (50K rows ≈ 50 MB upper bound for
// CSV). ZIP uploads for /api/import/documents go up to 100 MB.
const uploadJobCsv = createUploadMiddleware({ maxSizeMB: 50, allowedTypes: ["text"] });
const uploadJobZip = createUploadMiddleware({ maxSizeMB: 100, allowedTypes: ["zip"] });

// Safety cap so we never queue an obviously-broken CSV. Mirrors the worker's
// own check; placed here so we 400 before stashing the payload to disk.
const HARD_BYTE_CAP = 75 * 1024 * 1024;

export function registerImportExportRoutes(app: Express): void {
  const api = app;

  // IMPORT / EXPORT
  // ============================================

  api.get("/api/import/:entityType/columns", isAuthenticated, async (req, res) => {
    try {
      const entityType = req.params.entityType as "leads" | "properties" | "deals";
      if (!["leads", "properties", "deals"].includes(entityType)) {
        return res.status(400).json({ message: "Invalid entity type. Must be leads, properties, or deals." });
      }
      const columns = getExpectedColumns(entityType);
      res.json({ columns });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get columns" });
    }
  });

  api.post("/api/import/:entityType/preview", isAuthenticated, getOrCreateOrg, upload.single("file"), validateCSV, async (req, res) => {
    try {
      const entityType = req.params.entityType as "leads" | "properties" | "deals";
      if (!["leads", "properties", "deals"].includes(entityType)) {
        return res.status(400).json({ message: "Invalid entity type. Must be leads, properties, or deals." });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const csvString = req.file.buffer.toString("utf-8");
      const data = parseCSV(csvString);

      if (data.length > MAX_CSV_IMPORT_ROWS) {
        return res.status(400).json({ 
          message: `CSV file exceeds maximum of ${MAX_CSV_IMPORT_ROWS} rows. Please split into smaller files.` 
        });
      }

      const preview = previewImport(data, entityType);
      res.json(preview);
    } catch (error: any) {
      logger.error("Import preview error", error);
      res.status(500).json({ message: error.message || "Failed to preview import" });
    }
  });

  // Phase 4 Week 15-16 (Magdalena §1): this route now uses the larger-file
  // multer middleware (50 MB) and branches:
  //   - rows ≤ MAX_CSV_IMPORT_ROWS (500): run synchronously, return the
  //     classic `{ successCount, errorCount, … }` shape for back-compat.
  //   - rows > 500 and ≤ MAX_IMPORT_ROWS (50,000): queue an import_jobs row
  //     and return { jobId, status, totalRows } (HTTP 202).
  //   - rows > 50,000: 400 with a clear error.
  api.post("/api/import/:entityType", isAuthenticated, getOrCreateOrg, uploadJobCsv.single("file"), validateCSV, async (req, res, next) => {
    try {
      const org = req.organization;
      const entityType = req.params.entityType as "leads" | "properties" | "deals" | "notes" | "communications" | "documents";

      // notes / communications / documents have dedicated handlers further
      // down in this file. `next('route')` skips remaining handlers on this
      // route definition so the dedicated handlers can match instead.
      if (entityType === "notes" || entityType === "communications" || entityType === "documents") {
        return next("route");
      }

      if (!["leads", "properties", "deals"].includes(entityType)) {
        return res.status(400).json({ message: "Invalid entity type. Must be leads, properties, deals, notes, communications, or documents." });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const csvString = req.file.buffer.toString("utf-8");
      const data = parseCSV(csvString);

      if (data.length > MAX_IMPORT_ROWS) {
        return res.status(400).json({
          message: `CSV file exceeds maximum of ${MAX_IMPORT_ROWS.toLocaleString()} rows. Got ${data.length.toLocaleString()}. Please split into smaller files.`,
        });
      }

      // Large-file path: queue a job (Magdalena §1).
      if (data.length > MAX_CSV_IMPORT_ROWS) {
        const user = req.user as any;
        const userId = user?.claims?.sub || user?.id;
        let fieldMap: Record<string, string> | undefined;
        if (req.body?.fieldMap) {
          try {
            fieldMap = JSON.parse(req.body.fieldMap);
          } catch {
            // ignore malformed
          }
        }
        const job = await createImportJob({
          organizationId: org.id,
          userId,
          kind: entityType,
          filename: req.file.originalname,
          payload: req.file.buffer,
          fieldMap,
        });
        return res.status(202).json({
          jobId: job.id,
          status: job.status,
          totalRows: job.totalRows,
          kind: job.kind,
        });
      }

      let result;
      if (entityType === "leads") {
        result = await importLeads(data, org.id);
      } else if (entityType === "properties") {
        result = await importProperties(data, org.id);
      } else {
        result = await importDeals(data, org.id);
      }

      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "import",
        entityType: entityType,
        entityId: 0,
        changes: { 
          before: {},
          after: {
            totalRows: data.length,
            imported: result.successCount,
            errors: result.errorCount,
          },
          fields: ["import"],
        },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });

      res.json(result);
    } catch (error: any) {
      logger.error("Import error", error);
      res.status(500).json({ message: error.message || "Failed to import data" });
    }
  });

  // Notes import (standard CSV) — supports user-provided field mapping
  api.get("/api/import/notes/columns", isAuthenticated, (_req, res) => {
    res.json({
      columns: [
        "borrowerFirstName", "borrowerLastName", "borrowerEmail", "borrowerPhone",
        "originalPrincipal", "currentBalance", "interestRate", "termMonths",
        "monthlyPayment", "paymentDayOfMonth", "serviceFee", "lateFeeAmount",
        "gracePeriodDays", "status", "propertyAddress", "internalNotes",
      ],
      columnHints: NOTE_COLUMN_MAP,
    });
  });

  api.post("/api/import/notes", isAuthenticated, getOrCreateOrg, upload.single("file"), validateCSV, async (req, res) => {
    try {
      const org = req.organization;

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const csvString = req.file.buffer.toString("utf-8");
      const data = parseCSV(csvString);

      if (data.length > MAX_CSV_IMPORT_ROWS) {
        return res.status(400).json({
          message: `CSV file exceeds maximum of ${MAX_CSV_IMPORT_ROWS} rows. Please split into smaller files.`,
        });
      }

      // Optional user-provided field map (JSON-encoded in request body)
      let userFieldMap: Record<string, string> | undefined;
      if (req.body?.fieldMap) {
        try {
          userFieldMap = JSON.parse(req.body.fieldMap);
        } catch {
          // ignore malformed fieldMap
        }
      }

      const result = await importNotesFromCSV(data, org.id, userFieldMap);

      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "import",
        entityType: "notes",
        entityId: 0,
        changes: {
          before: {},
          after: {
            totalRows: data.length,
            imported: result.successCount,
            errors: result.errorCount,
          },
          fields: ["import"],
        },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      }).catch(() => {}); // non-blocking

      res.json(result);
    } catch (error: any) {
      logger.error("[import/notes] Error", error);
      res.status(500).json({ message: error.message || "Failed to import notes" });
    }
  });

  /**
   * @deprecated Use POST /api/export/everything instead. The legacy per-entity
   * exports remain in service through 2026-07-02 (60-day window) and ship with
   * X-Deprecation headers (see applyExportDeprecationHeaders below). New
   * clients should call POST /api/export/everything which returns a single
   * ZIP containing all entities + attachments + schema.json + README.md.
   *
   * Tobiah §1 (Phase 4 Week 15-16).
   */
  api.get("/api/export/:entityType", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const entityType = req.params.entityType as "leads" | "properties" | "deals" | "notes";
      const format = (req.query.format as string) || "csv";

      // Tobiah §1 deprecation: tag every legacy response so clients migrate.
      res.setHeader("X-Deprecation", "true");
      res.setHeader("X-Deprecation-Replacement", "POST /api/export/everything");
      res.setHeader("X-Deprecation-Sunset", "2026-07-02");

      if (!["leads", "properties", "deals", "notes"].includes(entityType)) {
        return res.status(400).json({ message: "Invalid entity type. Must be leads, properties, deals, or notes." });
      }

      if (!["csv", "json"].includes(format)) {
        return res.status(400).json({ message: "Invalid format. Must be csv or json." });
      }

      const filters: ExportFilters = {
        status: req.query.status as string | undefined,
        type: req.query.type as string | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
      };

      const date = new Date().toISOString().split("T")[0];

      // Phase 3 Week 11 — every customer-initiated data export must be
      // recorded in audit_events for compliance posture (GDPR Art. 30).
      await auditFromRequest(req, {
        action: AuditActions.DATA_EXPORT,
        target: { type: "export", id: org.id },
        metadata: { entityType, format, filters },
      });

      if (format === "json") {
        let data: any[];
        if (entityType === "leads") {
          data = await getLeadsData(org.id, filters);
        } else if (entityType === "properties") {
          data = await getPropertiesData(org.id, filters);
        } else if (entityType === "deals") {
          data = await getDealsData(org.id, filters);
        } else {
          data = await getNotesData(org.id, filters);
        }

        const filename = `${entityType}_export_${date}.json`;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(JSON.stringify(data, null, 2));
      } else {
        let csv: string;
        let filename: string;

        if (entityType === "leads") {
          csv = await exportLeadsToCSV(org.id, filters);
          filename = `leads_export_${date}.csv`;
        } else if (entityType === "properties") {
          csv = await exportPropertiesToCSV(org.id, filters);
          filename = `properties_export_${date}.csv`;
        } else if (entityType === "deals") {
          csv = await exportDealsToCSV(org.id, filters);
          filename = `deals_export_${date}.csv`;
        } else {
          csv = await exportNotesToCSV(org.id, filters);
          filename = `notes_export_${date}.csv`;
        }

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(csv);
      }
    } catch (error: any) {
      logger.error("Export error", error);
      res.status(500).json({ message: error.message || "Failed to export data" });
    }
  });

  /**
   * @deprecated Use POST /api/export/everything which returns a real ZIP
   * with the full entity set + attachments. This endpoint returns a JSON
   * envelope ("backup_*.json") which is harder for other CRMs to consume.
   * Sunset: 2026-07-02. Tobiah §1 (Phase 4 Week 15-16).
   */
  api.get("/api/export/backup", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const backup = await createBackupZip(org.id);
      res.setHeader("X-Deprecation", "true");
      res.setHeader("X-Deprecation-Replacement", "POST /api/export/everything");
      res.setHeader("X-Deprecation-Sunset", "2026-07-02");

      const jsonResponse = {
        metadata: {
          organizationId: org.id,
          organizationName: org.name,
          exportedAt: new Date().toISOString(),
        },
        files: backup.files.map((f) => ({
          name: f.name,
          content: f.content,
        })),
      };

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="backup_${org.slug}_${new Date().toISOString().split("T")[0]}.json"`
      );
      res.send(JSON.stringify(jsonResponse, null, 2));
    } catch (error: any) {
      logger.error("Backup error", error);
      res.status(500).json({ message: error.message || "Failed to create backup" });
    }
  });

  // ============================================
  // COMPLIANCE (20.1, 20.2, 20.3)
  // ============================================

  // Audit Log (20.1)
  api.get("/api/audit-log", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = req.organization!.id;
      
      const filters: {
        action?: string;
        entityType?: string;
        entityId?: number;
        userId?: string;
        startDate?: Date;
        endDate?: Date;
        limit?: number;
        offset?: number;
      } = {};
      
      if (req.query.action) filters.action = req.query.action as string;
      if (req.query.entityType) filters.entityType = req.query.entityType as string;
      if (req.query.entityId) filters.entityId = parseInt(req.query.entityId as string);
      if (req.query.userId) filters.userId = req.query.userId as string;
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);
      if (req.query.limit) filters.limit = Math.min(100, parseInt(req.query.limit as string));
      if (req.query.offset) filters.offset = parseInt(req.query.offset as string);
      
      const [logs, count] = await Promise.all([
        storage.getAuditLogs(orgId, filters),
        storage.getAuditLogCount(orgId, filters)
      ]);
      
      res.json({ logs, count });
    } catch (error: any) {
      logger.error("Audit log error", error);
      res.status(500).json({ message: error.message || "Failed to fetch audit logs" });
    }
  });

  // TCPA Compliance (20.2)
  api.get("/api/compliance/tcpa/no-consent", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = req.organization!.id;
      const leads = await storage.getLeadsWithoutConsent(orgId);
      res.json(leads);
    } catch (error: any) {
      logger.error("TCPA no-consent error", error);
      res.status(500).json({ message: error.message || "Failed to fetch leads without consent" });
    }
  });

  api.get("/api/compliance/tcpa/opted-out", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = req.organization!.id;
      const leads = await storage.getLeadsOptedOut(orgId);
      res.json(leads);
    } catch (error: any) {
      logger.error("TCPA opted-out error", error);
      res.status(500).json({ message: error.message || "Failed to fetch opted-out leads" });
    }
  });

  api.patch("/api/leads/:id/consent", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = req.organization!.id;
      const userId = (req.user as any).id;
      const leadId = parseInt(req.params.id);
      const { tcpaConsent, consentSource, optOutReason } = req.body;
      
      const existingLead = await storage.getLead(orgId, leadId);
      if (!existingLead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      const updated = await storage.updateLeadConsent(leadId, {
        tcpaConsent,
        consentSource,
        optOutReason
      });
      
      // Log consent change in audit log
      await storage.createAuditLogEntry({
        organizationId: orgId,
        userId,
        action: tcpaConsent ? "consent_granted" : "consent_revoked",
        entityType: "lead",
        entityId: leadId,
        changes: {
          before: { tcpaConsent: existingLead.tcpaConsent },
          after: { tcpaConsent },
          fields: ["tcpaConsent"]
        },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json(updated);
    } catch (error: any) {
      logger.error("Update consent error", error);
      res.status(500).json({ message: error.message || "Failed to update consent" });
    }
  });

  // Data Retention (20.3)
  api.get("/api/compliance/retention-policies", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      const policies = org.settings?.retentionPolicies || {
        leads: { enabled: false, retentionDays: 365 },
        closedDeals: { enabled: false, retentionDays: 2555 }, // 7 years for tax purposes
        auditLogs: { enabled: false, retentionDays: 2555 },
        communications: { enabled: false, retentionDays: 365 }
      };
      res.json(policies);
    } catch (error: any) {
      logger.error("Get retention policies error", error);
      res.status(500).json({ message: error.message || "Failed to fetch retention policies" });
    }
  });

  api.patch("/api/compliance/retention-policies", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = req.organization!.id;
      const userId = (req.user as any).id;
      const org = req.organization!;
      const newPolicies = req.body;
      
      const updatedSettings = {
        ...org.settings,
        retentionPolicies: newPolicies
      };
      
      const updated = await storage.updateOrganization(orgId, { settings: updatedSettings });
      
      // Log policy change in audit log
      await storage.createAuditLogEntry({
        organizationId: orgId,
        userId,
        action: "update",
        entityType: "settings",
        entityId: orgId,
        changes: {
          before: { retentionPolicies: org.settings?.retentionPolicies },
          after: { retentionPolicies: newPolicies },
          fields: ["retentionPolicies"]
        },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json(updated.settings?.retentionPolicies);
    } catch (error: any) {
      logger.error("Update retention policies error", error);
      res.status(500).json({ message: error.message || "Failed to update retention policies" });
    }
  });

  api.post("/api/compliance/purge-data", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = req.organization!.id;
      const userId = (req.user as any).id;
      const { dataType, beforeDate } = req.body;
      
      if (!dataType || !beforeDate) {
        return res.status(400).json({ message: "dataType and beforeDate are required" });
      }
      
      const date = new Date(beforeDate);
      let purgedCount = 0;
      
      switch (dataType) {
        case "leads":
          purgedCount = await storage.purgeOldLeads(orgId, date);
          break;
        case "closedDeals":
          purgedCount = await storage.purgeOldDeals(orgId, date, "closed");
          break;
        case "auditLogs":
          purgedCount = await storage.purgeOldAuditLogs(orgId, date);
          break;
        case "communications":
          purgedCount = await storage.purgeOldCommunications(orgId, date);
          break;
        default:
          return res.status(400).json({ message: "Invalid dataType" });
      }
      
      // Log purge action in audit log
      await storage.createAuditLogEntry({
        organizationId: orgId,
        userId,
        action: "data_purge",
        entityType: dataType,
        entityId: null,
        changes: null,
        metadata: {
          beforeDate: beforeDate,
          purgedCount
        },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ purgedCount, dataType, beforeDate });
    } catch (error: any) {
      logger.error("Purge data error", error);
      res.status(500).json({ message: error.message || "Failed to purge data" });
    }
  });

  // TCPA stats endpoint
  api.get("/api/compliance/tcpa/stats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = req.organization!.id;
      
      const [noConsent, optedOut, allLeads] = await Promise.all([
        storage.getLeadsWithoutConsent(orgId),
        storage.getLeadsOptedOut(orgId),
        storage.getLeads(orgId)
      ]);
      
      const withConsent = allLeads.filter(l => l.tcpaConsent === true).length;
      
      res.json({
        total: allLeads.length,
        withConsent,
        withoutConsent: noConsent.length,
        optedOut: optedOut.length
      });
    } catch (error: any) {
      logger.error("TCPA stats error", error);
      res.status(500).json({ message: error.message || "Failed to fetch TCPA stats" });
    }
  });

  // ============================================
  // PHASE 4 WEEK 15-16 — MIGRATION IN/OUT PARITY
  // ============================================
  // Magdalena §1: 50K-row CSV import + history-preserving columns +
  // communications history + document ZIP import. Job-backed.
  //
  // Tobiah §1: single-archive /api/export/everything. Replaces the four
  // legacy parallel export systems. Older /api/export/:entityType endpoints
  // remain in service with a 60-day deprecation window (X-Deprecation header).

  // POST /api/import/leads / /properties / /deals / /notes are handled by the
  // legacy `/api/import/:entityType` route above which now branches between
  // synchronous (≤500 rows) and job-backed (>500 rows) execution. See the
  // route at line ~94 for details.

  // POST /api/import/communications — CSV with leadEmail,channel,body,sentAt,direction
  api.post(
    "/api/import/communications",
    isAuthenticated,
    getOrCreateOrg,
    uploadJobCsv.single("file"),
    validateCSV,
    async (req, res) => {
      try {
        const org = req.organization!;
        const user = req.user as any;
        const userId = user?.claims?.sub || user?.id;
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });
        if (req.file.size > HARD_BYTE_CAP) {
          return res.status(400).json({ message: "File exceeds size cap" });
        }
        const job = await createImportJob({
          organizationId: org.id,
          userId,
          kind: "communications",
          filename: req.file.originalname,
          payload: req.file.buffer,
        });
        res.status(202).json({
          jobId: job.id,
          status: job.status,
          totalRows: job.totalRows,
          kind: job.kind,
        });
      } catch (error: any) {
        if (typeof error?.message === "string" && error.message.includes("exceeds maximum")) {
          return res.status(400).json({ message: error.message });
        }
        logger.error("[import/communications] error", error);
        res.status(500).json({ message: error.message || "Failed to queue communications import" });
      }
    }
  );

  // POST /api/import/documents — ZIP whose entries are matched to leads/properties by filename
  api.post(
    "/api/import/documents",
    isAuthenticated,
    getOrCreateOrg,
    uploadJobZip.single("file"),
    async (req, res) => {
      try {
        const org = req.organization!;
        const user = req.user as any;
        const userId = user?.claims?.sub || user?.id;
        if (!req.file) return res.status(400).json({ message: "No ZIP uploaded" });
        // ZIP magic check: PK\x03\x04
        const buf = req.file.buffer;
        if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
          return res.status(400).json({ message: "Uploaded file is not a ZIP archive" });
        }
        const job = await createImportJob({
          organizationId: org.id,
          userId,
          kind: "documents",
          filename: req.file.originalname,
          payload: req.file.buffer,
        });
        res.status(202).json({
          jobId: job.id,
          status: job.status,
          kind: job.kind,
        });
      } catch (error: any) {
        logger.error("[import/documents] error", error);
        res.status(500).json({ message: error.message || "Failed to queue documents import" });
      }
    }
  );

  // GET /api/import/jobs — list recent jobs for current org
  api.get("/api/import/jobs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      const limit = Math.min(50, parseInt((req.query.limit as string) || "25", 10));
      const jobs = await listImportJobs(org.id, limit);
      res.json({ jobs });
    } catch (error: any) {
      logger.error("[import/jobs list] error", error);
      res.status(500).json({ message: error.message || "Failed to list import jobs" });
    }
  });

  // GET /api/import/jobs/:id — single-job status for UI polling
  api.get("/api/import/jobs/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid job ID" });
      const job = await getImportJob(org.id, id);
      if (!job) return res.status(404).json({ message: "Job not found" });
      res.json(job);
    } catch (error: any) {
      logger.error("[import/jobs get] error", error);
      res.status(500).json({ message: error.message || "Failed to fetch import job" });
    }
  });

  // POST /api/export/everything — single-archive export (Tobiah §1)
  const exportEverythingSchema = z.object({
    entityTypes: z.array(z.string()).optional(),
    dateRange: z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .optional(),
    includeAttachments: z.boolean().optional(),
  });

  api.post("/api/export/everything", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      const parsed = exportEverythingSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(422)
          .json({ message: "Invalid export params", details: parsed.error.flatten() });
      }
      const job = await createExportJob({
        organizationId: org.id,
        userId,
        params: parsed.data,
      });
      await auditFromRequest(req, {
        action: AuditActions.DATA_EXPORT,
        target: { type: "export-job", id: job.id },
        metadata: { params: parsed.data },
      });
      res.status(202).json({ jobId: job.id, status: job.status });
    } catch (error: any) {
      logger.error("[export/everything] error", error);
      res.status(500).json({ message: error.message || "Failed to queue export" });
    }
  });

  api.get("/api/export/jobs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      const limit = Math.min(50, parseInt((req.query.limit as string) || "25", 10));
      const jobs = await listExportJobs(org.id, limit);
      res.json({ jobs });
    } catch (error: any) {
      logger.error("[export/jobs list] error", error);
      res.status(500).json({ message: error.message || "Failed to list export jobs" });
    }
  });

  api.get("/api/export/jobs/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid job ID" });
      const job = await getExportJob(org.id, id);
      if (!job) return res.status(404).json({ message: "Job not found" });
      res.json(job);
    } catch (error: any) {
      logger.error("[export/jobs get] error", error);
      res.status(500).json({ message: error.message || "Failed to fetch export job" });
    }
  });

  // GET /api/export/jobs/:id/download — stream the completed ZIP
  api.get(
    "/api/export/jobs/:id/download",
    isAuthenticated,
    getOrCreateOrg,
    async (req, res) => {
      try {
        const org = req.organization!;
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid job ID" });
        const job = await getExportJob(org.id, id);
        if (!job) return res.status(404).json({ message: "Job not found" });
        if (job.status !== "completed") {
          return res
            .status(409)
            .json({ message: `Job is ${job.status}; download is only available when completed` });
        }
        const buf = await readExportArchive(id, org.id);
        if (!buf) return res.status(410).json({ message: "Archive expired or unavailable" });
        const date = new Date().toISOString().split("T")[0];
        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="acreos-export-${date}-job${id}.zip"`
        );
        res.send(buf);
      } catch (error: any) {
        logger.error("[export/jobs download] error", error);
        res.status(500).json({ message: error.message || "Failed to download archive" });
      }
    }
  );

}

// ─── Legacy export deprecation ──────────────────────────────────────────────
// Tobiah §1: the per-entity GET /api/export/:entityType endpoints registered
// at the top of this file are superseded by /api/export/everything. We keep
// them functional through {DEPRECATION_END_DATE} but tag every response with
// an X-Deprecation header so clients migrate. When the Wave-6 route-redirects
// helper lands, swap this header for a 308 redirect to the new endpoint.
const DEPRECATION_END_DATE = "2026-07-02"; // 60 days from 2026-05-03
export function applyExportDeprecationHeaders(app: Express): void {
  app.use("/api/export/:entityType", (req, res, next) => {
    // Skip the new job-backed surfaces — they don't take a single :entityType
    // param value that overlaps with the legacy ones (e.g. /jobs).
    const t = req.params.entityType;
    if (t === "everything" || t === "jobs") return next();
    res.setHeader("X-Deprecation", "true");
    res.setHeader("X-Deprecation-Replacement", "POST /api/export/everything");
    res.setHeader("X-Deprecation-Sunset", DEPRECATION_END_DATE);
    next();
  });
}
