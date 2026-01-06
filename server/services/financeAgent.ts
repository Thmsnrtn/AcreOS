import { storage } from "../storage";
import { usageMeteringService } from "./credits";
import { type Note, type Lead, type InsertPaymentReminder, type InsertSystemAlert } from "@shared/schema";
import OpenAI from "openai";

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export type DelinquencyStatus = 
  | "current" 
  | "early_delinquent" 
  | "delinquent" 
  | "seriously_delinquent" 
  | "default_candidate";

export type ReminderType = "upcoming" | "due" | "late" | "final_warning";

const DELINQUENCY_THRESHOLDS = {
  earlyDelinquent: { min: 1, max: 5 },
  delinquent: { min: 6, max: 15 },
  seriouslyDelinquent: { min: 16, max: 30 },
  defaultCandidate: { min: 31, max: Infinity },
};

const REMINDER_SCHEDULE = {
  upcoming: -3,
  due: 0,
  late: 5,
  final_warning: 15,
};

export class FinanceAgentService {
  calculateDaysDelinquent(nextPaymentDate: Date | null): number {
    if (!nextPaymentDate) return 0;
    const now = new Date();
    const diffTime = now.getTime() - nextPaymentDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  }

  getDelinquencyStatus(daysDelinquent: number): DelinquencyStatus {
    if (daysDelinquent <= 0) return "current";
    if (daysDelinquent <= DELINQUENCY_THRESHOLDS.earlyDelinquent.max) return "early_delinquent";
    if (daysDelinquent <= DELINQUENCY_THRESHOLDS.delinquent.max) return "delinquent";
    if (daysDelinquent <= DELINQUENCY_THRESHOLDS.seriouslyDelinquent.max) return "seriously_delinquent";
    return "default_candidate";
  }

  async detectDelinquency(note: Note): Promise<{
    daysDelinquent: number;
    status: DelinquencyStatus;
    statusChanged: boolean;
  }> {
    const daysDelinquent = this.calculateDaysDelinquent(note.nextPaymentDate);
    const newStatus = this.getDelinquencyStatus(daysDelinquent);
    const oldStatus = (note.delinquencyStatus as DelinquencyStatus) || "current";
    const statusChanged = newStatus !== oldStatus;

    if (statusChanged || daysDelinquent !== (note.daysDelinquent || 0)) {
      await storage.updateNote(note.id, {
        daysDelinquent,
        delinquencyStatus: newStatus,
      });
    }

    return { daysDelinquent, status: newStatus, statusChanged };
  }

  async generateReminderContent(
    note: Note,
    borrower: Lead | null,
    type: ReminderType,
    orgId: number
  ): Promise<string> {
    const openai = getOpenAIClient();
    
    const borrowerName = borrower 
      ? `${borrower.firstName} ${borrower.lastName}`
      : "Valued Customer";
    
    const amount = Number(note.monthlyPayment || 0).toFixed(2);
    const dueDate = note.nextPaymentDate 
      ? new Date(note.nextPaymentDate).toLocaleDateString("en-US", { 
          month: "long", 
          day: "numeric", 
          year: "numeric" 
        })
      : "your next due date";
    
    if (!openai) {
      return this.getFallbackContent(borrowerName, amount, dueDate, type);
    }

    try {
      await usageMeteringService.recordUsage(orgId, "ai_chat", 1, {
        action: "finance_reminder_generation",
        reminderType: type,
      });

      const prompt = this.buildReminderPrompt(borrowerName, amount, dueDate, type, note);
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a professional and empathetic financial services representative. Generate payment reminder messages that are firm but understanding. Keep messages concise (under 200 words)."
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 300,
      });

      return response.choices[0]?.message?.content || this.getFallbackContent(borrowerName, amount, dueDate, type);
    } catch (error) {
      console.error("Error generating reminder content:", error);
      return this.getFallbackContent(borrowerName, amount, dueDate, type);
    }
  }

  private buildReminderPrompt(
    borrowerName: string,
    amount: string,
    dueDate: string,
    type: ReminderType,
    note: Note
  ): string {
    const balance = Number(note.currentBalance || 0).toFixed(2);
    
    switch (type) {
      case "upcoming":
        return `Generate a friendly reminder email for ${borrowerName}. Their payment of $${amount} is due in 3 days on ${dueDate}. Current balance: $${balance}. Encourage them to set up autopay if they haven't already.`;
      
      case "due":
        return `Generate a payment due notice for ${borrowerName}. Their payment of $${amount} is due today, ${dueDate}. Current balance: $${balance}. Remind them to make their payment promptly.`;
      
      case "late":
        return `Generate a late payment notice for ${borrowerName}. Their payment of $${amount} was due on ${dueDate} and is now 5 days overdue. Current balance: $${balance}. Express concern and urge immediate payment to avoid late fees.`;
      
      case "final_warning":
        return `Generate a final warning notice for ${borrowerName}. Their payment of $${amount} is now 15 days overdue since ${dueDate}. Current balance: $${balance}. This is a serious notice warning about potential default and collections action. Be firm but professional.`;
    }
  }

  private getFallbackContent(
    borrowerName: string,
    amount: string,
    dueDate: string,
    type: ReminderType
  ): string {
    switch (type) {
      case "upcoming":
        return `Dear ${borrowerName},\n\nThis is a friendly reminder that your payment of $${amount} is due in 3 days on ${dueDate}. Please ensure your payment is submitted on time to maintain your good standing.\n\nThank you for your prompt attention to this matter.`;
      
      case "due":
        return `Dear ${borrowerName},\n\nYour payment of $${amount} is due today, ${dueDate}. Please submit your payment at your earliest convenience.\n\nIf you have already made your payment, please disregard this notice.\n\nThank you.`;
      
      case "late":
        return `Dear ${borrowerName},\n\nYour payment of $${amount} was due on ${dueDate} and is now past due. Please submit your payment immediately to avoid additional late fees.\n\nIf you are experiencing financial difficulties, please contact us to discuss payment options.\n\nThank you for your immediate attention to this matter.`;
      
      case "final_warning":
        return `Dear ${borrowerName},\n\nFINAL NOTICE: Your payment of $${amount} is now 15 days overdue. Your account is at risk of being referred to collections.\n\nPlease contact us immediately to arrange payment. Failure to respond may result in further action.\n\nThis is a serious matter requiring your immediate attention.`;
    }
  }

  async scheduleReminders(note: Note, borrower: Lead | null): Promise<number> {
    if (note.status !== "active" || !note.nextPaymentDate) {
      return 0;
    }

    const now = new Date();
    const dueDate = new Date(note.nextPaymentDate);
    const existingReminders = await storage.getRemindersForNote(note.id);
    
    const scheduledTypes = new Set(
      existingReminders
        .filter(r => r.status === "scheduled" || r.status === "sent")
        .map(r => r.type)
    );

    let remindersCreated = 0;

    for (const [type, daysOffset] of Object.entries(REMINDER_SCHEDULE) as [ReminderType, number][]) {
      if (scheduledTypes.has(type)) continue;

      const scheduledDate = new Date(dueDate);
      scheduledDate.setDate(scheduledDate.getDate() + daysOffset);

      if (scheduledDate < now && type === "upcoming") continue;

      if (type === "late" || type === "final_warning") {
        const daysDelinquent = this.calculateDaysDelinquent(note.nextPaymentDate);
        if (type === "late" && daysDelinquent < REMINDER_SCHEDULE.late) continue;
        if (type === "final_warning" && daysDelinquent < REMINDER_SCHEDULE.final_warning) continue;
      }

      const content = await this.generateReminderContent(note, borrower, type, note.organizationId);

      const reminder: InsertPaymentReminder = {
        organizationId: note.organizationId,
        noteId: note.id,
        borrowerId: borrower?.id || null,
        type,
        scheduledFor: scheduledDate,
        channel: "email",
        content,
        status: "scheduled",
      };

      await storage.createPaymentReminder(reminder);
      remindersCreated++;
    }

    return remindersCreated;
  }

  async processReminders(): Promise<{ sent: number; failed: number }> {
    return this.processRemindersWithCursor(0);
  }

  async processRemindersWithCursor(lastProcessedId: number): Promise<{ sent: number; failed: number }> {
    const JOB_TYPE = 'dunning';
    const pendingReminders = await storage.getPendingReminders(50);
    const unprocessedReminders = pendingReminders.filter(r => r.id > lastProcessedId);
    let sent = 0;
    let failed = 0;
    let maxProcessedId = lastProcessedId;

    for (const reminder of unprocessedReminders) {
      try {
        console.log(`[FinanceAgent] Sending reminder ${reminder.id} (${reminder.type}) for note ${reminder.noteId}`);
        
        const note = await storage.getNote(reminder.organizationId, reminder.noteId);
        if (!note) {
          await storage.updatePaymentReminder(reminder.id, {
            status: "failed",
            failureReason: "Note not found",
          });
          failed++;
          continue;
        }
        
        if (reminder.borrowerId) {
          const { communicationsService } = await import('./communications');
          const result = await communicationsService.sendToLead({
            organizationId: reminder.organizationId,
            leadId: reminder.borrowerId,
            channel: reminder.channel === 'sms' ? 'sms' : 'email',
            subject: `Payment Reminder - ${reminder.type === 'upcoming' ? 'Upcoming Payment' : reminder.type === 'due' ? 'Payment Due' : reminder.type === 'late' ? 'Past Due Notice' : 'Final Notice'}`,
            message: reminder.content || 'Your payment is due. Please log in to make your payment.',
          });
          
          if (!result.success) {
            console.log(`[FinanceAgent] Communication fallback for reminder ${reminder.id}: ${result.error || 'No provider configured'}`);
          }
        }
        
        await storage.markReminderSent(reminder.id);
        await storage.updateNote(note.id, {
          lastReminderSentAt: new Date(),
          reminderCount: (note.reminderCount || 0) + 1,
        });
        
        sent++;
        maxProcessedId = Math.max(maxProcessedId, reminder.id);
        await storage.updateJobCursor(JOB_TYPE, maxProcessedId, 'running');
      } catch (error) {
        console.error(`[FinanceAgent] Failed to send reminder ${reminder.id}:`, error);
        await storage.updatePaymentReminder(reminder.id, {
          status: "failed",
          failureReason: error instanceof Error ? error.message : "Unknown error",
        });
        failed++;
        maxProcessedId = Math.max(maxProcessedId, reminder.id);
        await storage.updateJobCursor(JOB_TYPE, maxProcessedId, 'running');
      }
    }

    return { sent, failed };
  }

  async updateDelinquencyStatus(note: Note): Promise<void> {
    const { daysDelinquent, status, statusChanged } = await this.detectDelinquency(note);

    if (status === "default_candidate" && statusChanged) {
      const alert: InsertSystemAlert = {
        type: "finance_delinquency",
        alertType: "revenue_at_risk",
        severity: "critical",
        title: `Default Candidate: Note #${note.id}`,
        message: `Note #${note.id} is ${daysDelinquent} days delinquent and is now a default candidate. Balance: $${Number(note.currentBalance || 0).toFixed(2)}. Immediate attention required.`,
        organizationId: note.organizationId,
        relatedEntityType: "note",
        relatedEntityId: note.id,
        status: "new",
        metadata: {
          daysDelinquent,
          currentBalance: note.currentBalance,
          borrowerId: note.borrowerId,
        },
      };

      await storage.createSystemAlert(alert);
      console.log(`[FinanceAgent] Created default candidate alert for note ${note.id}`);
    }
  }

  async processOrganizationNotes(orgId: number): Promise<{
    processed: number;
    remindersScheduled: number;
    statusUpdates: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let processed = 0;
    let remindersScheduled = 0;
    let statusUpdates = 0;

    try {
      const notesNeedingReminders = await storage.getNotesNeedingReminders(orgId);
      const delinquentNotes = await storage.getDelinquentNotes(orgId);
      
      const allNotes = new Map<number, Note>();
      for (const note of [...notesNeedingReminders, ...delinquentNotes]) {
        allNotes.set(note.id, note);
      }

      for (const note of Array.from(allNotes.values())) {
        try {
          let borrower: Lead | null = null;
          if (note.borrowerId) {
            borrower = await storage.getLead(orgId, note.borrowerId) || null;
          }

          const { statusChanged } = await this.detectDelinquency(note);
          if (statusChanged) {
            statusUpdates++;
            await this.updateDelinquencyStatus(note);
          }

          const scheduled = await this.scheduleReminders(note, borrower);
          remindersScheduled += scheduled;

          processed++;
        } catch (error) {
          const errorMsg = `Error processing note ${note.id}: ${error instanceof Error ? error.message : "Unknown error"}`;
          errors.push(errorMsg);
          console.error(`[FinanceAgent] ${errorMsg}`);
        }
      }
    } catch (error) {
      const errorMsg = `Error fetching notes for org ${orgId}: ${error instanceof Error ? error.message : "Unknown error"}`;
      errors.push(errorMsg);
      console.error(`[FinanceAgent] ${errorMsg}`);
    }

    return { processed, remindersScheduled, statusUpdates, errors };
  }

  async runFinanceAgentJob(): Promise<{
    orgsProcessed: number;
    totalNotes: number;
    remindersSent: number;
    remindersScheduled: number;
    errors: string[];
  }> {
    const JOB_TYPE = 'dunning';
    console.log("[FinanceAgent] Starting finance agent job...");
    
    const allErrors: string[] = [];
    let orgsProcessed = 0;
    let totalNotes = 0;
    let remindersScheduled = 0;

    try {
      await storage.setJobStatus(JOB_TYPE, 'running');
      
      const cursor = await storage.getJobCursor(JOB_TYPE);
      const lastProcessedId = cursor?.lastProcessedId || 0;

      const { sent, failed } = await this.processRemindersWithCursor(lastProcessedId);
      console.log(`[FinanceAgent] Processed pending reminders: ${sent} sent, ${failed} failed`);

      const orgs = await storage.getOrganizationsInDunning();
      const activeOrgs = orgs.length > 0 ? orgs : [];
      
      for (const org of activeOrgs) {
        try {
          const result = await this.processOrganizationNotes(org.id);
          totalNotes += result.processed;
          remindersScheduled += result.remindersScheduled;
          allErrors.push(...result.errors);
          orgsProcessed++;
        } catch (error) {
          allErrors.push(`Error processing org ${org.id}: ${error instanceof Error ? error.message : "Unknown"}`);
        }
      }
      
      await storage.setJobStatus(JOB_TYPE, 'idle');
    } catch (error) {
      allErrors.push(`Error in finance agent job: ${error instanceof Error ? error.message : "Unknown"}`);
      await storage.setJobStatus(JOB_TYPE, 'failed');
    }

    console.log(`[FinanceAgent] Job complete: ${orgsProcessed} orgs, ${totalNotes} notes, ${remindersScheduled} scheduled`);
    
    return {
      orgsProcessed,
      totalNotes,
      remindersSent: 0,
      remindersScheduled,
      errors: allErrors,
    };
  }

  async sendManualReminder(
    noteId: number,
    orgId: number,
    type: ReminderType = "due"
  ): Promise<{ success: boolean; reminderId?: number; error?: string }> {
    try {
      const note = await storage.getNote(orgId, noteId);
      if (!note) {
        return { success: false, error: "Note not found" };
      }

      let borrower: Lead | null = null;
      if (note.borrowerId) {
        borrower = await storage.getLead(orgId, note.borrowerId) || null;
      }

      const content = await this.generateReminderContent(note, borrower, type, orgId);

      const reminder: InsertPaymentReminder = {
        organizationId: orgId,
        noteId,
        borrowerId: borrower?.id || null,
        type,
        scheduledFor: new Date(),
        channel: "email",
        content,
        status: "sent",
        sentAt: new Date(),
      };

      const created = await storage.createPaymentReminder(reminder);

      await storage.updateNote(noteId, {
        lastReminderSentAt: new Date(),
        reminderCount: (note.reminderCount || 0) + 1,
      });

      return { success: true, reminderId: created.id };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      };
    }
  }
}

export const financeAgentService = new FinanceAgentService();
