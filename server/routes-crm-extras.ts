import type { Express, Response } from "express";
import { getOrganization, type AuthenticatedRequest } from "./types/request";
import { storage, db } from "./storage";
import { z } from "zod";
import { insertTaskSchema, notificationPreferences } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { usageMeteringService, creditService } from "./services/credits";
import { activityLogger } from "./services/activityLogger";
import { generateOfferSuggestions, generateOfferLetter, predictAcceptanceProbability, type PropertyData, type OfferLetterRequest, type AcceptancePredictionRequest } from "./services/aiOfferService";
import { logger } from "./utils/logger";
import { assertFeeSimpleOrThrow, handleLandStatusError } from "./utils/landStatus";
import { Errors } from "./utils/errors";

export function registerCRMExtrasRoutes(app: Express): void {
  const api = app;

  // AI OFFER GENERATION
  // ============================================
  
  api.post("/api/ai/generate-offer", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const propertyData: PropertyData = req.body;

      if (!propertyData.county || !propertyData.state || !propertyData.sizeAcres) {
        return Errors.badRequest(res, "Missing required fields: county, state, and sizeAcres are required");
      }

      // Aniyah §2 — block AI offer generation on Indian-Country parcels.
      const org = getOrganization(req);
      if (propertyData.id && org?.id) {
        const parcel = await storage.getProperty(org.id, Number(propertyData.id));
        assertFeeSimpleOrThrow(parcel ?? null, "blind-offer");
      }

      const result = await generateOfferSuggestions(propertyData, { organizationId: org?.id });

      if (!result.success) {
        return Errors.badRequest(res, String(result.error ?? "Bad request"));
      }

      res.json(result);
    } catch (error) {
      if (handleLandStatusError(res, error)) return;
      logger.error("AI generate-offer error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/ai/generate-letter", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const request: OfferLetterRequest = req.body;

      if (!request.property || !request.offerAmount || !request.buyerName || !request.tone) {
        return Errors.badRequest(res, "Missing required fields: property, offerAmount, buyerName, and tone are required");
      }

      if (!["professional", "friendly", "urgent"].includes(request.tone)) {
        return Errors.badRequest(res, "Tone must be one of: professional, friendly, urgent");
      }

      // Aniyah §2 — block AI offer letter generation on Indian-Country parcels.
      const org = getOrganization(req);
      if (request.property?.id && org?.id) {
        const parcel = await storage.getProperty(org.id, Number(request.property.id));
        assertFeeSimpleOrThrow(parcel ?? null, "offer-letter");
      }

      const result = await generateOfferLetter(request);

      if (!result.success) {
        return Errors.badRequest(res, String(result.error ?? "Bad request"));
      }

      res.json(result);
    } catch (error) {
      if (handleLandStatusError(res, error)) return;
      logger.error("AI generate-letter error", error);
      Errors.internal(res, error);
    }
  });
  
  api.post("/api/ai/predict-acceptance", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const request: AcceptancePredictionRequest = req.body;
      
      if (!request.property || !request.offerAmount || !request.estimatedMarketValue) {
        return Errors.badRequest(res, "Missing required fields: property, offerAmount, and estimatedMarketValue are required");
      }
      
      const result = await predictAcceptanceProbability(request);
      
      if (!result.success) {
        return Errors.badRequest(res, String(result.error ?? "Bad request"));
      }
      
      res.json(result);
    } catch (error) {
      logger.error("AI predict-acceptance error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // ACTIVITY FEED (15.1)
  // ============================================
  
  api.get("/api/activity", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const eventTypes = req.query.eventTypes 
        ? (req.query.eventTypes as string).split(",") 
        : undefined;
      const entityType = req.query.entityType as string | undefined;
      
      const orgId = req.organization!.id;
      
      let events = await storage.getRecentActivityEvents(orgId, limit + offset);
      
      if (eventTypes && eventTypes.length > 0) {
        events = events.filter(e => eventTypes.includes(e.eventType));
      }
      
      if (entityType) {
        events = events.filter(e => e.entityType === entityType);
      }
      
      const paginatedEvents = events.slice(offset, offset + limit);
      
      res.json({
        events: paginatedEvents,
        hasMore: events.length > offset + limit,
        total: events.length,
      });
    } catch (error: any) {
      logger.error("Activity feed error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // NOTIFICATION PREFERENCES (15.2)
  // ============================================
  
  api.get("/api/notification-preferences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const userId = req.user.id;
      const orgId = req.organization!.id;
      
      const preferences = await storage.getNotificationPreferences(userId, orgId);
      res.json(preferences);
    } catch (error: any) {
      logger.error("Get notification preferences error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/notification-preferences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const userId = req.user.id;
      const orgId = req.organization!.id;
      
      const { eventType, emailEnabled, pushEnabled, inAppEnabled } = req.body;
      
      if (!eventType) {
        return Errors.badRequest(res, "eventType is required");
      }
      
      const pref = await storage.upsertNotificationPreference({
        userId,
        organizationId: orgId,
        eventType,
        emailEnabled: emailEnabled ?? true,
        pushEnabled: pushEnabled ?? false,
        inAppEnabled: inAppEnabled ?? true,
      });
      
      res.json(pref);
    } catch (error: any) {
      logger.error("Create notification preference error", error);
      Errors.internal(res, error);
    }
  });

  api.put("/api/notification-preferences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      // Task #2: IDOR prevention — verify notification preference belongs to requesting org
      const [existing] = await db.select({ id: notificationPreferences.id })
        .from(notificationPreferences)
        .where(and(eq(notificationPreferences.id, id), eq(notificationPreferences.organizationId, org.id)))
        .limit(1);
      if (!existing) return Errors.notFound(res, "Notification preference");
      const { emailEnabled, pushEnabled, inAppEnabled } = req.body;

      const pref = await storage.updateNotificationPreference(id, {
        emailEnabled,
        pushEnabled,
        inAppEnabled,
      });

      res.json(pref);
    } catch (error: any) {
      logger.error("Update notification preference error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // TASK MANAGEMENT (17.1, 17.2, 17.3)
  // ============================================

  api.get("/api/tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = req.organization!.id;
      const filters: { status?: string; priority?: string; assignedTo?: number; entityType?: string; entityId?: number } = {};
      
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.priority) filters.priority = req.query.priority as string;
      if (req.query.assignedTo) filters.assignedTo = parseInt(req.query.assignedTo as string);
      if (req.query.entityType) filters.entityType = req.query.entityType as string;
      if (req.query.entityId) filters.entityId = parseInt(req.query.entityId as string);
      
      const tasks = await storage.getTasks(orgId, Object.keys(filters).length > 0 ? filters : undefined);
      res.json(tasks);
    } catch (error: any) {
      logger.error("Get tasks error", error);
      Errors.internal(res, error);
    }
  });

  api.get("/api/tasks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = req.organization!.id;
      const id = parseInt(req.params.id);
      
      const task = await storage.getTask(orgId, id);
      if (!task) {
        return Errors.notFound(res, "Task");
      }
      
      res.json(task);
    } catch (error: any) {
      logger.error("Get task error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = req.organization!.id;
      const userId = req.user.id;
      
      const validated = insertTaskSchema.parse({
        ...req.body,
        organizationId: orgId,
        createdBy: userId,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
        nextOccurrence: req.body.nextOccurrence ? new Date(req.body.nextOccurrence) : null,
      });
      
      const task = await storage.createTask(validated);
      
      await activityLogger.logTaskCreated(
        orgId,
        task.id,
        task.title,
        task.entityType as any,
        task.entityId ?? undefined,
        userId
      );
      
      await storage.createAuditLogEntry({
        organizationId: orgId,
        userId,
        action: "create",
        entityType: "task",
        entityId: task.id,
        changes: { after: validated, fields: Object.keys(validated) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.status(201).json(task);
    } catch (error: any) {
      logger.error("Create task error", error);
      Errors.internal(res, error);
    }
  });

  api.put("/api/tasks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = req.organization!.id;
      const userId = req.user.id;
      const id = parseInt(req.params.id);
      
      const existingTask = await storage.getTask(orgId, id);
      if (!existingTask) {
        return Errors.notFound(res, "Task");
      }
      
      const updates: any = { ...req.body };
      if (updates.dueDate) updates.dueDate = new Date(updates.dueDate);
      if (updates.nextOccurrence) updates.nextOccurrence = new Date(updates.nextOccurrence);
      
      const task = await storage.updateTask(id, updates);
      
      const changes = Object.keys(updates).filter(k => k !== 'updatedAt').join(', ');
      await activityLogger.logTaskUpdated(
        orgId,
        task.id,
        task.title,
        changes,
        task.entityType as any,
        task.entityId ?? undefined,
        userId
      );
      
      await storage.createAuditLogEntry({
        organizationId: orgId,
        userId,
        action: "update",
        entityType: "task",
        entityId: task.id,
        changes: { before: existingTask, after: task, fields: Object.keys(updates) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json(task);
    } catch (error: any) {
      logger.error("Update task error", error);
      Errors.internal(res, error);
    }
  });

  api.delete("/api/tasks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = req.organization!.id;
      const id = parseInt(req.params.id);
      
      const task = await storage.getTask(orgId, id);
      if (!task) {
        return Errors.notFound(res, "Task");
      }
      
      const user = req.user as any;
      const userId = user?.id || user?.id;
      
      await storage.deleteTask(id);
      
      await storage.createAuditLogEntry({
        organizationId: orgId,
        userId,
        action: "delete",
        entityType: "task",
        entityId: id,
        changes: { before: task, fields: ["deleted"] },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ message: "Task deleted" });
    } catch (error: any) {
      logger.error("Delete task error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/tasks/:id/complete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = req.organization!.id;
      const userId = req.user.id;
      const id = parseInt(req.params.id);
      
      const existingTask = await storage.getTask(orgId, id);
      if (!existingTask) {
        return Errors.notFound(res, "Task");
      }
      
      const completedTask = await storage.completeTask(id);
      
      await activityLogger.logTaskCompleted(
        orgId,
        completedTask.id,
        completedTask.title,
        completedTask.entityType as any,
        completedTask.entityId ?? undefined,
        userId
      );
      
      if (completedTask.isRecurring && completedTask.recurrenceRule) {
        const nextTask = await storage.createNextRecurringTask(completedTask);
        return res.json({ completedTask, nextTask });
      }
      
      res.json({ completedTask });
    } catch (error: any) {
      logger.error("Complete task error", error);
      Errors.internal(res, error);
    }
  });

  api.post("/api/tasks/process-recurring", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const recurringTasksDue = await storage.getRecurringTasksDue();
      const createdTasks = [];
      
      for (const task of recurringTasksDue) {
        const nextTask = await storage.createNextRecurringTask(task);
        createdTasks.push(nextTask);
      }
      
      res.json({ processed: recurringTasksDue.length, created: createdTasks });
    } catch (error: any) {
      logger.error("Process recurring tasks error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================

}
