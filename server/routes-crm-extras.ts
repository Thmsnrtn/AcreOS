import type { Express } from "express";
import { storage } from "./storage";
import { z } from "zod";
import { insertTaskSchema } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { usageMeteringService, creditService } from "./services/credits";
import { activityLogger } from "./services/activityLogger";
import { generateOfferSuggestions, generateOfferLetter, predictAcceptanceProbability, type PropertyData, type OfferLetterRequest, type AcceptancePredictionRequest } from "./services/aiOfferService";

export function registerCRMExtrasRoutes(app: Express): void {
  const api = app;

  // AI OFFER GENERATION
  // ============================================
  
  api.post("/api/ai/generate-offer", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const propertyData: PropertyData = req.body;
      
      if (!propertyData.county || !propertyData.state || !propertyData.sizeAcres) {
        return res.status(400).json({ 
          message: "Missing required fields: county, state, and sizeAcres are required" 
        });
      }
      
      const result = await generateOfferSuggestions(propertyData);
      
      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("AI generate-offer error:", error);
      res.status(500).json({ 
        message: error.message || "Failed to generate offer suggestions" 
      });
    }
  });
  
  api.post("/api/ai/generate-letter", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const request: OfferLetterRequest = req.body;
      
      if (!request.property || !request.offerAmount || !request.buyerName || !request.tone) {
        return res.status(400).json({ 
          message: "Missing required fields: property, offerAmount, buyerName, and tone are required" 
        });
      }
      
      if (!["professional", "friendly", "urgent"].includes(request.tone)) {
        return res.status(400).json({ 
          message: "Tone must be one of: professional, friendly, urgent" 
        });
      }
      
      const result = await generateOfferLetter(request);
      
      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("AI generate-letter error:", error);
      res.status(500).json({ 
        message: error.message || "Failed to generate offer letter" 
      });
    }
  });
  
  api.post("/api/ai/predict-acceptance", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const request: AcceptancePredictionRequest = req.body;
      
      if (!request.property || !request.offerAmount || !request.estimatedMarketValue) {
        return res.status(400).json({ 
          message: "Missing required fields: property, offerAmount, and estimatedMarketValue are required" 
        });
      }
      
      const result = await predictAcceptanceProbability(request);
      
      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("AI predict-acceptance error:", error);
      res.status(500).json({ 
        message: error.message || "Failed to predict acceptance probability" 
      });
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
      
      const orgId = (req as any).organization!.id;
      
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
      console.error("Activity feed error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch activity feed" });
    }
  });

  // ============================================
  // NOTIFICATION PREFERENCES (15.2)
  // ============================================
  
  api.get("/api/notification-preferences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const orgId = (req as any).organization!.id;
      
      const preferences = await storage.getNotificationPreferences(userId, orgId);
      res.json(preferences);
    } catch (error: any) {
      console.error("Get notification preferences error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch notification preferences" });
    }
  });

  api.post("/api/notification-preferences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const orgId = (req as any).organization!.id;
      
      const { eventType, emailEnabled, pushEnabled, inAppEnabled } = req.body;
      
      if (!eventType) {
        return res.status(400).json({ message: "eventType is required" });
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
      console.error("Create notification preference error:", error);
      res.status(500).json({ message: error.message || "Failed to save notification preference" });
    }
  });

  api.put("/api/notification-preferences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { emailEnabled, pushEnabled, inAppEnabled } = req.body;
      
      const pref = await storage.updateNotificationPreference(id, {
        emailEnabled,
        pushEnabled,
        inAppEnabled,
      });
      
      res.json(pref);
    } catch (error: any) {
      console.error("Update notification preference error:", error);
      res.status(500).json({ message: error.message || "Failed to update notification preference" });
    }
  });

  // ============================================
  // TASK MANAGEMENT (17.1, 17.2, 17.3)
  // ============================================

  api.get("/api/tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const filters: { status?: string; priority?: string; assignedTo?: number; entityType?: string; entityId?: number } = {};
      
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.priority) filters.priority = req.query.priority as string;
      if (req.query.assignedTo) filters.assignedTo = parseInt(req.query.assignedTo as string);
      if (req.query.entityType) filters.entityType = req.query.entityType as string;
      if (req.query.entityId) filters.entityId = parseInt(req.query.entityId as string);
      
      const tasks = await storage.getTasks(orgId, Object.keys(filters).length > 0 ? filters : undefined);
      res.json(tasks);
    } catch (error: any) {
      console.error("Get tasks error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch tasks" });
    }
  });

  api.get("/api/tasks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const id = parseInt(req.params.id);
      
      const task = await storage.getTask(orgId, id);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      
      res.json(task);
    } catch (error: any) {
      console.error("Get task error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch task" });
    }
  });

  api.post("/api/tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const userId = (req.user as any).id;
      
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
      console.error("Create task error:", error);
      res.status(500).json({ message: error.message || "Failed to create task" });
    }
  });

  api.put("/api/tasks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const userId = (req.user as any).id;
      const id = parseInt(req.params.id);
      
      const existingTask = await storage.getTask(orgId, id);
      if (!existingTask) {
        return res.status(404).json({ message: "Task not found" });
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
      console.error("Update task error:", error);
      res.status(500).json({ message: error.message || "Failed to update task" });
    }
  });

  api.delete("/api/tasks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const id = parseInt(req.params.id);
      
      const task = await storage.getTask(orgId, id);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      
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
      console.error("Delete task error:", error);
      res.status(500).json({ message: error.message || "Failed to delete task" });
    }
  });

  api.post("/api/tasks/:id/complete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const userId = (req.user as any).id;
      const id = parseInt(req.params.id);
      
      const existingTask = await storage.getTask(orgId, id);
      if (!existingTask) {
        return res.status(404).json({ message: "Task not found" });
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
      console.error("Complete task error:", error);
      res.status(500).json({ message: error.message || "Failed to complete task" });
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
      console.error("Process recurring tasks error:", error);
      res.status(500).json({ message: error.message || "Failed to process recurring tasks" });
    }
  });

  // ============================================

}
