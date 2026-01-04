import { storage } from "../storage";
import type { InsertActivityEvent, ActivityEventType } from "@shared/schema";

export class ActivityLoggerService {
  async logEvent(data: InsertActivityEvent): Promise<void> {
    try {
      await storage.createActivityEvent(data);
    } catch (error) {
      console.error("Failed to log activity event:", error);
    }
  }

  async logEmailSent(
    orgId: number,
    entityType: "lead" | "property" | "deal",
    entityId: number,
    recipient: string,
    subject: string,
    campaignId?: number,
    userId?: string
  ): Promise<void> {
    await this.logEvent({
      organizationId: orgId,
      entityType,
      entityId,
      eventType: "email_sent",
      description: `Email sent to ${recipient}: ${subject}`,
      metadata: { subject, recipient },
      campaignId,
      userId,
      eventDate: new Date(),
    });
  }

  async logSMSSent(
    orgId: number,
    entityType: "lead" | "property" | "deal",
    entityId: number,
    recipient: string,
    messagePreview: string,
    campaignId?: number,
    userId?: string
  ): Promise<void> {
    await this.logEvent({
      organizationId: orgId,
      entityType,
      entityId,
      eventType: "sms_sent",
      description: `SMS sent to ${recipient}`,
      metadata: { recipient, messagePreview: messagePreview.substring(0, 100) },
      campaignId,
      userId,
      eventDate: new Date(),
    });
  }

  async logDirectMailSent(
    orgId: number,
    entityType: "lead" | "property" | "deal",
    entityId: number,
    recipientName: string,
    templateUsed?: string,
    campaignId?: number,
    userId?: string
  ): Promise<void> {
    await this.logEvent({
      organizationId: orgId,
      entityType,
      entityId,
      eventType: "mail_sent",
      description: `Direct mail sent to ${recipientName}`,
      metadata: { recipient: recipientName, templateUsed },
      campaignId,
      userId,
      eventDate: new Date(),
    });
  }

  async logCallMade(
    orgId: number,
    entityType: "lead" | "property" | "deal",
    entityId: number,
    phoneNumber: string,
    duration?: number,
    outcome?: string,
    userId?: string
  ): Promise<void> {
    await this.logEvent({
      organizationId: orgId,
      entityType,
      entityId,
      eventType: "call_made",
      description: `Call made to ${phoneNumber}${outcome ? ` - ${outcome}` : ""}`,
      metadata: { recipient: phoneNumber, callDuration: duration, outcome },
      userId,
      eventDate: new Date(),
    });
  }

  async logCallReceived(
    orgId: number,
    entityType: "lead" | "property" | "deal",
    entityId: number,
    phoneNumber: string,
    duration?: number,
    notes?: string,
    userId?: string
  ): Promise<void> {
    await this.logEvent({
      organizationId: orgId,
      entityType,
      entityId,
      eventType: "call_received",
      description: `Call received from ${phoneNumber}`,
      metadata: { recipient: phoneNumber, callDuration: duration, notes },
      userId,
      eventDate: new Date(),
    });
  }

  async logNoteAdded(
    orgId: number,
    entityType: "lead" | "property" | "deal",
    entityId: number,
    noteTitle: string,
    userId?: string
  ): Promise<void> {
    await this.logEvent({
      organizationId: orgId,
      entityType,
      entityId,
      eventType: "note_added",
      description: `Note added: ${noteTitle}`,
      metadata: { subject: noteTitle },
      userId,
      eventDate: new Date(),
    });
  }

  async logStageChanged(
    orgId: number,
    entityType: "lead" | "property" | "deal",
    entityId: number,
    previousStage: string,
    newStage: string,
    userId?: string
  ): Promise<void> {
    await this.logEvent({
      organizationId: orgId,
      entityType,
      entityId,
      eventType: "stage_changed",
      description: `Stage changed from ${previousStage} to ${newStage}`,
      metadata: { previousStage, newStage },
      userId,
      eventDate: new Date(),
    });
  }

  async logPaymentReceived(
    orgId: number,
    dealId: number,
    amount: number,
    paymentMethod?: string,
    userId?: string
  ): Promise<void> {
    const formattedAmount = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
    
    await this.logEvent({
      organizationId: orgId,
      entityType: "deal",
      entityId: dealId,
      eventType: "payment_received",
      description: `Payment received: ${formattedAmount}`,
      metadata: { amount, paymentMethod },
      userId,
      eventDate: new Date(),
    });
  }

  async logDocumentUploaded(
    orgId: number,
    entityType: "lead" | "property" | "deal",
    entityId: number,
    documentName: string,
    documentUrl?: string,
    userId?: string
  ): Promise<void> {
    await this.logEvent({
      organizationId: orgId,
      entityType,
      entityId,
      eventType: "document_uploaded",
      description: `Document uploaded: ${documentName}`,
      metadata: { documentName, documentUrl },
      userId,
      eventDate: new Date(),
    });
  }

  async logTaskCreated(
    orgId: number,
    taskId: number,
    taskTitle: string,
    linkedEntityType?: "lead" | "property" | "deal" | "none",
    linkedEntityId?: number,
    userId?: string
  ): Promise<void> {
    if (linkedEntityType && linkedEntityType !== "none" && linkedEntityId) {
      await this.logEvent({
        organizationId: orgId,
        entityType: linkedEntityType,
        entityId: linkedEntityId,
        eventType: "task_created",
        description: `Task created: ${taskTitle}`,
        metadata: { taskId, taskTitle },
        userId,
        eventDate: new Date(),
      });
    }
  }

  async logTaskUpdated(
    orgId: number,
    taskId: number,
    taskTitle: string,
    changes: string,
    linkedEntityType?: "lead" | "property" | "deal" | "none",
    linkedEntityId?: number,
    userId?: string
  ): Promise<void> {
    if (linkedEntityType && linkedEntityType !== "none" && linkedEntityId) {
      await this.logEvent({
        organizationId: orgId,
        entityType: linkedEntityType,
        entityId: linkedEntityId,
        eventType: "task_updated",
        description: `Task updated: ${taskTitle} - ${changes}`,
        metadata: { taskId, taskTitle, changes },
        userId,
        eventDate: new Date(),
      });
    }
  }

  async logTaskCompleted(
    orgId: number,
    taskId: number,
    taskTitle: string,
    linkedEntityType?: "lead" | "property" | "deal" | "none",
    linkedEntityId?: number,
    userId?: string
  ): Promise<void> {
    if (linkedEntityType && linkedEntityType !== "none" && linkedEntityId) {
      await this.logEvent({
        organizationId: orgId,
        entityType: linkedEntityType,
        entityId: linkedEntityId,
        eventType: "task_completed",
        description: `Task completed: ${taskTitle}`,
        metadata: { taskId, taskTitle },
        userId,
        eventDate: new Date(),
      });
    }
  }
}

export const activityLogger = new ActivityLoggerService();
