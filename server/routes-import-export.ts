import type { Express } from "express";
import { storage, db } from "./storage";
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { leads } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import multer from "multer";
import {
  parseCSV, previewImport, importLeads, importProperties, importDeals,
  exportLeadsToCSV, exportPropertiesToCSV, exportDealsToCSV, exportNotesToCSV,
  getLeadsData, getPropertiesData, getDealsData, getNotesData,
  createBackupZip, getExpectedColumns, type ExportFilters,
} from "./services/importExport";

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

  api.post("/api/import/:entityType/preview", isAuthenticated, getOrCreateOrg, upload.single("file"), async (req, res) => {
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
      console.error("Import preview error:", error);
      res.status(500).json({ message: error.message || "Failed to preview import" });
    }
  });

  api.post("/api/import/:entityType", isAuthenticated, getOrCreateOrg, upload.single("file"), async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("Import error:", error);
      res.status(500).json({ message: error.message || "Failed to import data" });
    }
  });

  api.get("/api/export/:entityType", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const entityType = req.params.entityType as "leads" | "properties" | "deals" | "notes";
      const format = (req.query.format as string) || "csv";

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
      console.error("Export error:", error);
      res.status(500).json({ message: error.message || "Failed to export data" });
    }
  });

  api.get("/api/export/backup", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const backup = await createBackupZip(org.id);

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
      console.error("Backup error:", error);
      res.status(500).json({ message: error.message || "Failed to create backup" });
    }
  });

  // ============================================
  // COMPLIANCE (20.1, 20.2, 20.3)
  // ============================================

  // Audit Log (20.1)
  api.get("/api/audit-log", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      
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
      if (req.query.limit) filters.limit = parseInt(req.query.limit as string);
      if (req.query.offset) filters.offset = parseInt(req.query.offset as string);
      
      const [logs, count] = await Promise.all([
        storage.getAuditLogs(orgId, filters),
        storage.getAuditLogCount(orgId, filters)
      ]);
      
      res.json({ logs, count });
    } catch (error: any) {
      console.error("Audit log error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch audit logs" });
    }
  });

  // TCPA Compliance (20.2)
  api.get("/api/compliance/tcpa/no-consent", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const leads = await storage.getLeadsWithoutConsent(orgId);
      res.json(leads);
    } catch (error: any) {
      console.error("TCPA no-consent error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch leads without consent" });
    }
  });

  api.get("/api/compliance/tcpa/opted-out", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const leads = await storage.getLeadsOptedOut(orgId);
      res.json(leads);
    } catch (error: any) {
      console.error("TCPA opted-out error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch opted-out leads" });
    }
  });

  api.patch("/api/leads/:id/consent", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
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
      console.error("Update consent error:", error);
      res.status(500).json({ message: error.message || "Failed to update consent" });
    }
  });

  // Data Retention (20.3)
  api.get("/api/compliance/retention-policies", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization!;
      const policies = org.settings?.retentionPolicies || {
        leads: { enabled: false, retentionDays: 365 },
        closedDeals: { enabled: false, retentionDays: 2555 }, // 7 years for tax purposes
        auditLogs: { enabled: false, retentionDays: 2555 },
        communications: { enabled: false, retentionDays: 365 }
      };
      res.json(policies);
    } catch (error: any) {
      console.error("Get retention policies error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch retention policies" });
    }
  });

  api.patch("/api/compliance/retention-policies", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const userId = (req.user as any).id;
      const org = (req as any).organization!;
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
      console.error("Update retention policies error:", error);
      res.status(500).json({ message: error.message || "Failed to update retention policies" });
    }
  });

  api.post("/api/compliance/purge-data", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
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
      console.error("Purge data error:", error);
      res.status(500).json({ message: error.message || "Failed to purge data" });
    }
  });

  // TCPA stats endpoint
  api.get("/api/compliance/tcpa/stats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      
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
      console.error("TCPA stats error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch TCPA stats" });
    }
  });

  // ============================================

}
