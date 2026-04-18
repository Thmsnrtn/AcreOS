import type { Express } from "express";
import { storage, db, calculateMonthlyPayment } from "./storage";
import { z } from "zod";
import { insertNoteSchema, insertPaymentSchema, paymentReminders } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { isAuthenticated } from "./auth";
import { Errors } from "./utils/errors";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { checkUsageLimit } from "./services/usageLimits";
import { usageLimitGate } from "./middleware/usageLimitGate";
import { usageMeteringService, creditService } from "./services/credits";
import { financeAgentService } from "./services/financeAgent";
import { exportNotesToCSV, type ExportFilters } from "./services/importExport";
import { checkUsury } from "./services/usury";
import { logger } from "./utils/logger";

// Zod schema for note updates — only user-editable fields are allowed.
// Sensitive fields (organizationId, currentBalance, interestRate, accessToken,
// amortizationSchedule, id, createdAt, updatedAt, deletedAt, deletedBy,
// pendingCheckoutSessionId, daysDelinquent, delinquencyStatus, reminderCount,
// lastReminderSentAt, taxEscrowBalance) are excluded to prevent field injection.
const updateNoteSchema = z.object({
  propertyId: z.number().nullable().optional(),
  borrowerId: z.number().nullable().optional(),

  // Note terms — originalPrincipal and termMonths can be corrected, but
  // interestRate is excluded (checked separately via usury logic) and
  // currentBalance is system-calculated from payments.
  originalPrincipal: z.string().optional(),
  termMonths: z.number().optional(),
  monthlyPayment: z.string().optional(),

  // Additional fees
  serviceFee: z.string().optional(),
  lateFee: z.string().optional(),
  gracePeriodDays: z.number().optional(),

  // Property Tax Escrow — enable/disable and tax amount config
  taxEscrowEnabled: z.boolean().optional(),
  annualPropertyTax: z.string().optional(),
  monthlyTaxEscrow: z.string().optional(),
  taxEscrowAccountId: z.string().nullable().optional(),
  lastTaxPaymentDate: z.coerce.date().nullable().optional(),
  nextTaxDueDate: z.coerce.date().nullable().optional(),
  taxPaymentYear: z.number().nullable().optional(),
  countyTaxPortalUrl: z.string().nullable().optional(),

  // Dates
  startDate: z.coerce.date().optional(),
  firstPaymentDate: z.coerce.date().optional(),
  nextPaymentDate: z.coerce.date().nullable().optional(),
  maturityDate: z.coerce.date().nullable().optional(),

  // Status (only valid transitions)
  status: z.enum(["pending", "active", "paid_off", "defaulted", "foreclosed"]).optional(),

  // Down payment
  downPayment: z.string().optional(),
  downPaymentReceived: z.boolean().optional(),

  // Payment method (user-facing configuration)
  paymentMethod: z.string().nullable().optional(),
  paymentAccountId: z.string().nullable().optional(),
  autoPayEnabled: z.boolean().optional(),
  fallbackPaymentAccounts: z.array(z.object({
    profileId: z.string(),
    method: z.enum(["ach_actum", "ach_authorize", "card_stripe", "card_authorize"]),
    last4: z.string().optional(),
    bankName: z.string().optional(),
    order: z.number(),
    isActive: z.boolean(),
  })).nullable().optional(),

  // Entity ownership
  owningEntity: z.string().nullable().optional(),

  // Free-text notes
  notes: z.string().nullable().optional(),
}).strict();

export function registerFinanceRoutes(app: Express): void {
  const api = app;

  // NOTES (Seller Financing)
  // ============================================
  
  api.get("/api/notes", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const notes = await storage.getNotes(org.id);
    res.json(notes);
  });
  
  api.get("/api/notes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const note = await storage.getNote(org.id, Number(req.params.id));
    if (!note) return Errors.notFound(res, "Note");
    res.json(note);
  });

  api.post("/api/notes", isAuthenticated, getOrCreateOrg, usageLimitGate("notes"), async (req, res) => {
    try {
      const org = req.organization;
      
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
      
      // Usury hard block: check interest rate against state law before saving
      if (req.body.interestRate && req.body.propertyId) {
        const property = await storage.getProperty(org.id, Number(req.body.propertyId));
        if (property?.state) {
          const usury = checkUsury(property.state, Number(req.body.interestRate));
          if (usury.warningLevel === 'violation') {
            return res.status(422).json({
              message: `Interest rate ${req.body.interestRate}% exceeds ${property.state} usury limit of ${usury.maxAllowedRate}%. This transaction cannot be saved.`,
              code: 'USURY_VIOLATION',
              limit: usury.maxAllowedRate,
              rate: req.body.interestRate,
              state: property.state,
            });
          }
        }
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

      // Convert date strings to Date objects
      const startDate = req.body.startDate ? new Date(req.body.startDate) : new Date();
      const firstPaymentDate = req.body.firstPaymentDate ? new Date(req.body.firstPaymentDate) : new Date();
      const maturityDate = req.body.maturityDate ? new Date(req.body.maturityDate) : undefined;
      const nextPaymentDate = req.body.nextPaymentDate ? new Date(req.body.nextPaymentDate) : firstPaymentDate;

      const input = insertNoteSchema.parse({
        ...req.body,
        organizationId: org.id,
        monthlyPayment: String(monthlyPayment),
        currentBalance: req.body.originalPrincipal,
        startDate,
        firstPaymentDate,
        maturityDate,
        nextPaymentDate,
      });
      const note = await storage.createNote(input);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "create",
        entityType: "note",
        entityId: note.id,
        changes: { after: input, fields: Object.keys(input) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.status(201).json(note);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, err.errors[0].message);
      }
      throw err;
    }
  });

  api.put("/api/notes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const noteId = Number(req.params.id);
    if (isNaN(noteId)) {
      return Errors.badRequest(res, "Invalid note ID");
    }
    const existingNote = await storage.getNote(org.id, noteId);
    if (!existingNote) return Errors.notFound(res, "Note");

    // Validate and whitelist fields — rejects any unexpected / sensitive keys
    let validated: z.infer<typeof updateNoteSchema>;
    try {
      validated = updateNoteSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.validationFailed(res, err.errors);
      }
      throw err;
    }

    // Usury hard block: check updated interest rate against state law before saving
    const rateToCheck = existingNote.interestRate;
    const propertyId = validated.propertyId ?? existingNote.propertyId;
    if (rateToCheck && propertyId) {
      const property = await storage.getProperty(org.id, Number(propertyId));
      if (property?.state) {
        const usury = checkUsury(property.state, Number(rateToCheck));
        if (usury.warningLevel === 'violation') {
          return res.status(422).json({
            message: `Interest rate ${rateToCheck}% exceeds ${property.state} usury limit of ${usury.maxAllowedRate}%. This transaction cannot be saved.`,
            code: 'USURY_VIOLATION',
            limit: usury.maxAllowedRate,
            rate: rateToCheck,
            state: property.state,
          });
        }
      }
    }

    const note = await storage.updateNote(noteId, validated);

    const user = req.user as any;
    const userId = user?.claims?.sub || user?.id;
    await storage.createAuditLogEntry({
      organizationId: org.id,
      userId,
      action: "update",
      entityType: "note",
      entityId: noteId,
      changes: { before: existingNote, after: note, fields: Object.keys(validated) },
      ipAddress: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers["user-agent"],
    });

    res.json(note);
  });
  
  api.delete("/api/notes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const noteId = Number(req.params.id);
    if (isNaN(noteId)) {
      return Errors.badRequest(res, "Invalid note ID");
    }
    const existingNote = await storage.getNote(org.id, noteId);
    if (!existingNote) {
      return Errors.notFound(res, "Note");
    }

    await storage.deleteNote(noteId);

    const user = req.user as any;
    const userId = user?.claims?.sub || user?.id;
    await storage.createAuditLogEntry({
      organizationId: org.id,
      userId,
      action: "delete",
      entityType: "note",
      entityId: noteId,
      changes: { before: existingNote, fields: ["deleted"] },
      ipAddress: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers["user-agent"],
    });

    res.status(204).send();
  });
  
  api.get("/api/notes/export", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
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
  // FINANCE AGENT - DELINQUENCY & REMINDERS
  // ============================================
  
  api.get("/api/notes/delinquent", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const delinquentNotes = await storage.getDelinquentNotes(org.id);
    res.json(delinquentNotes);
  });

  api.get("/api/notes/:id/reminders", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const noteId = Number(req.params.id);
    const note = await storage.getNote(org.id, noteId);
    if (!note) return Errors.notFound(res, "Note");

    const reminders = await storage.getRemindersForNote(noteId);
    res.json(reminders);
  });

  api.post("/api/notes/:id/send-reminder", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const noteId = Number(req.params.id);
      const { type = "due" } = req.body;
      
      const validTypes = ["upcoming", "due", "late", "final_warning"];
      if (!validTypes.includes(type)) {
        return Errors.badRequest(res, "Invalid reminder type");
      }
      
      const result = await financeAgentService.sendManualReminder(noteId, org.id, type);
      
      if (!result.success) {
        return Errors.badRequest(res, result.error);
      }

      res.json({ success: true, reminderId: result.reminderId });
    } catch (err: any) {
      logger.error("Error sending manual reminder", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  // ============================================
  // PHASE 6.1: AMORTIZATION SCHEDULE ROUTES
  // ============================================

  api.get("/api/notes/:id/schedule", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const noteId = Number(req.params.id);
      const note = await storage.getNote(org.id, noteId);
      if (!note) return Errors.notFound(res, "Note");

      const schedule = note.amortizationSchedule || [];
      const totalInterest = schedule.reduce((sum, s) => sum + (s.interest || 0), 0);
      const payoffDate = schedule.length > 0 ? schedule[schedule.length - 1].dueDate : null;
      
      res.json({
        noteId: note.id,
        schedule,
        summary: {
          totalPayments: schedule.length,
          paidPayments: schedule.filter(s => s.status === 'paid').length,
          totalInterest: Number(totalInterest.toFixed(2)),
          payoffDate,
          originalPrincipal: Number(note.originalPrincipal),
          monthlyPayment: Number(note.monthlyPayment),
          interestRate: Number(note.interestRate),
        }
      });
    } catch (err: any) {
      logger.error("Error getting schedule", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  api.post("/api/notes/:id/schedule/generate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const noteId = Number(req.params.id);
      const note = await storage.getNote(org.id, noteId);
      if (!note) return Errors.notFound(res, "Note");

      const principal = Number(note.originalPrincipal);
      const annualRate = Number(note.interestRate);
      const termMonths = note.termMonths;
      const monthlyPayment = Number(note.monthlyPayment);
      const startDate = note.startDate ? new Date(note.startDate) : new Date();
      
      const schedule: any[] = [];
      let balance = principal;
      const monthlyRate = annualRate / 100 / 12;
      
      for (let i = 1; i <= termMonths && balance > 0; i++) {
        const interestPayment = balance * monthlyRate;
        const principalPayment = Math.min(monthlyPayment - interestPayment, balance);
        balance = Math.max(0, balance - principalPayment);
        
        const dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + i);
        
        schedule.push({
          paymentNumber: i,
          dueDate: dueDate.toISOString(),
          payment: monthlyPayment,
          principal: Number(principalPayment.toFixed(2)),
          interest: Number(interestPayment.toFixed(2)),
          balance: Number(balance.toFixed(2)),
          status: "pending",
        });
      }
      
      const updatedNote = await storage.updateNote(noteId, { amortizationSchedule: schedule });
      
      const totalInterest = schedule.reduce((sum, s) => sum + s.interest, 0);
      
      res.json({
        noteId,
        schedule,
        summary: {
          totalPayments: schedule.length,
          paidPayments: 0,
          totalInterest: Number(totalInterest.toFixed(2)),
          payoffDate: schedule.length > 0 ? schedule[schedule.length - 1].dueDate : null,
          originalPrincipal: principal,
          monthlyPayment,
          interestRate: annualRate,
        }
      });
    } catch (err: any) {
      logger.error("Error generating schedule", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  // ============================================
  // PHASE 6.2: DUNNING & LATE PAYMENT ROUTES
  // ============================================

  api.get("/api/notes/:id/dunning", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const noteId = Number(req.params.id);
      const note = await storage.getNote(org.id, noteId);
      if (!note) return Errors.notFound(res, "Note");

      const reminders = await storage.getRemindersForNote(noteId);
      const daysDelinquent = note.daysDelinquent || 0;
      
      let dunningStage = "current";
      if (daysDelinquent > 0 && daysDelinquent <= 15) dunningStage = "friendly_reminder";
      else if (daysDelinquent > 15 && daysDelinquent <= 30) dunningStage = "formal_notice";
      else if (daysDelinquent > 30 && daysDelinquent <= 60) dunningStage = "final_warning";
      else if (daysDelinquent > 60) dunningStage = "default_notice";
      
      const schedule = note.amortizationSchedule || [];
      const missedPayments = schedule.filter(s => s.status === 'missed' || s.status === 'late').length;
      const pastDueAmount = missedPayments * Number(note.monthlyPayment);
      
      res.json({
        noteId,
        delinquencyStatus: note.delinquencyStatus || "current",
        daysDelinquent,
        dunningStage,
        reminderCount: note.reminderCount || 0,
        lastReminderSentAt: note.lastReminderSentAt,
        pastDueAmount,
        missedPayments,
        history: reminders.map(r => ({
          id: r.id,
          date: r.sentAt || r.scheduledFor,
          type: r.type,
          stage: r.type === 'final_warning' ? 'final_warning' : 
                 r.type === 'late' ? 'formal_notice' : 
                 r.type === 'due' ? 'friendly_reminder' : 'upcoming',
          channel: r.channel,
          status: r.status,
          content: r.content,
        })),
      });
    } catch (err: any) {
      logger.error("Error getting dunning info", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  api.post("/api/notes/:id/dunning", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const noteId = Number(req.params.id);
      const { action, stage, notes: actionNotes } = req.body;
      
      const note = await storage.getNote(org.id, noteId);
      if (!note) return Errors.notFound(res, "Note");

      const validActions = ["send_reminder", "escalate", "record_contact", "waive_fee", "set_payment_plan"];
      if (!validActions.includes(action)) {
        return Errors.badRequest(res, "Invalid dunning action");
      }
      
      if (action === "send_reminder" || action === "escalate") {
        const reminderType = stage || "late";
        const result = await financeAgentService.sendManualReminder(noteId, org.id, reminderType);
        
        if (!result.success) {
          return Errors.badRequest(res, result.error);
        }
        
        res.json({ 
          success: true, 
          action,
          reminderId: result.reminderId,
          message: `${action === "escalate" ? "Escalated" : "Reminder sent"} successfully` 
        });
      } else {
        const reminder = await storage.createPaymentReminder({
          organizationId: org.id,
          noteId,
          borrowerId: note.borrowerId,
          type: action === "record_contact" ? "contact_logged" : action,
          scheduledFor: new Date(),
          channel: "manual",
          content: actionNotes || `Manual action: ${action}`,
          status: "completed",
        });
        
        res.json({
          success: true,
          action,
          reminderId: reminder.id,
          message: `Action '${action}' recorded successfully`
        });
      }
    } catch (err: any) {
      logger.error("Error creating dunning action", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  api.get("/api/payment-reminders", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { noteId, status, type } = req.query;
      
      let reminders;
      if (noteId) {
        reminders = await storage.getRemindersForNote(Number(noteId));
      } else {
        reminders = await storage.getPendingReminders(100);
        reminders = reminders.filter(r => r.organizationId === org.id);
      }
      
      if (status) {
        reminders = reminders.filter(r => r.status === status);
      }
      if (type) {
        reminders = reminders.filter(r => r.type === type);
      }
      
      res.json(reminders);
    } catch (err: any) {
      logger.error("Error getting payment reminders", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  api.put("/api/payment-reminders/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const reminderId = Number(req.params.id);
      // Task #2: IDOR prevention — verify reminder belongs to requesting org
      const [existing] = await db.select({ id: paymentReminders.id })
        .from(paymentReminders)
        .where(and(eq(paymentReminders.id, reminderId), eq(paymentReminders.organizationId, org.id)))
        .limit(1);
      if (!existing) return Errors.notFound(res, "Payment reminder");
      const { status, content, channel } = req.body;

      const updates: any = {};
      if (status) updates.status = status;
      if (content) updates.content = content;
      if (channel) updates.channel = channel;
      if (status === "cancelled") updates.failureReason = req.body.reason || "Manually cancelled";

      const updated = await storage.updatePaymentReminder(reminderId, updates);

      try {
        const user = req.user as any;
        const userId = user?.claims?.sub || user?.id;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: userId?.toString() || null,
          action: "update",
          entityType: "payment_reminder",
          entityId: reminderId,
          changes: { after: updates, fields: Object.keys(updates) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json(updated);
    } catch (err: any) {
      logger.error("Error updating reminder", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  api.get("/api/finance/health", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const health = await storage.getFinancePortfolioHealth(org.id);
    res.json(health);
  });

  api.post("/api/finance/process", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const result = await financeAgentService.processOrganizationNotes(org.id);
      res.json(result);
    } catch (err: any) {
      logger.error("Error processing finance agent", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  // ============================================
  // FINANCIAL DASHBOARD API (Portfolio Analytics)
  // ============================================

  api.get("/api/finance/portfolio-summary", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const allNotes = await storage.getNotes(org.id);
      const allPayments = await storage.getPayments(org.id);

      const activeNotes = allNotes.filter(n => n.status === 'active');
      const paidOffNotes = allNotes.filter(n => n.status === 'paid_off');
      const defaultedNotes = allNotes.filter(n => n.status === 'defaulted');
      const pendingNotes = allNotes.filter(n => n.status === 'pending');

      const totalPortfolioValue = activeNotes.reduce((sum, n) => sum + Number(n.currentBalance || 0), 0);
      const totalMonthlyPayment = activeNotes.reduce((sum, n) => sum + Number(n.monthlyPayment || 0), 0);
      const totalOriginalPrincipal = allNotes.reduce((sum, n) => sum + Number(n.originalPrincipal || 0), 0);

      const avgInterestRate = activeNotes.length > 0
        ? activeNotes.reduce((sum, n) => sum + Number(n.interestRate || 0), 0) / activeNotes.length
        : 0;

      const statusBreakdown = [
        { status: 'active', count: activeNotes.length, value: activeNotes.reduce((s, n) => s + Number(n.currentBalance || 0), 0) },
        { status: 'paid_off', count: paidOffNotes.length, value: 0 },
        { status: 'defaulted', count: defaultedNotes.length, value: defaultedNotes.reduce((s, n) => s + Number(n.currentBalance || 0), 0) },
        { status: 'pending', count: pendingNotes.length, value: pendingNotes.reduce((s, n) => s + Number(n.currentBalance || 0), 0) },
      ];

      // Monthly cash flow for last 12 months
      const monthlyCashFlow: { month: string; amount: number }[] = [];
      const now = new Date();
      for (let i = 11; i >= 0; i--) {
        const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
        const monthLabel = monthStart.toISOString().slice(0, 7); // YYYY-MM
        const monthPayments = allPayments.filter(p => {
          const d = p.paymentDate ? new Date(p.paymentDate) : null;
          return d && d >= monthStart && d <= monthEnd;
        });
        const amount = monthPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
        monthlyCashFlow.push({ month: monthLabel, amount: Math.round(amount * 100) / 100 });
      }

      res.json({
        totalNotes: allNotes.length,
        activeNotes: activeNotes.length,
        totalPortfolioValue,
        totalMonthlyPayment,
        totalOriginalPrincipal,
        averageInterestRate: avgInterestRate,
        statusBreakdown,
        monthlyCashFlow,
      });
    } catch (err: any) {
      logger.error("Error getting portfolio summary", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  api.get("/api/finance/delinquency", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const allNotes = await storage.getNotes(org.id);
      const activeNotes = allNotes.filter(n => n.status === 'active');

      const now = new Date();

      const agingBuckets = {
        current: [] as typeof activeNotes,
        days30: [] as typeof activeNotes,
        days60: [] as typeof activeNotes,
        days90Plus: [] as typeof activeNotes,
      };

      activeNotes.forEach(note => {
        if (!note.nextPaymentDate) {
          agingBuckets.current.push(note);
          return;
        }
        const dueDate = new Date(note.nextPaymentDate);
        const daysPastDue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysPastDue <= 0) {
          agingBuckets.current.push(note);
        } else if (daysPastDue <= 30) {
          agingBuckets.days30.push(note);
        } else if (daysPastDue <= 60) {
          agingBuckets.days60.push(note);
        } else {
          agingBuckets.days90Plus.push(note);
        }
      });

      const delinquentNotes = [...agingBuckets.days30, ...agingBuckets.days60, ...agingBuckets.days90Plus];
      const delinquencyRate = activeNotes.length > 0 
        ? (delinquentNotes.length / activeNotes.length) * 100 
        : 0;

      const atRiskAmount = delinquentNotes.reduce((sum, n) => sum + Number(n.currentBalance || 0), 0);

      const allPayments = await storage.getPayments(org.id);
      const completedPayments = allPayments.filter(p => p.status === 'completed');
      const totalPrincipalCollected = completedPayments.reduce((sum, p) => sum + Number(p.principalAmount || 0), 0);
      const totalInterestCollected = completedPayments.reduce((sum, p) => sum + Number(p.interestAmount || 0), 0);

      const monthlyBreakdown: { month: string; principal: number; interest: number }[] = [];
      const last12Months = Array.from({ length: 12 }, (_, i) => {
        const d = new Date();
        d.setMonth(d.getMonth() - (11 - i));
        return { year: d.getFullYear(), month: d.getMonth() };
      });

      last12Months.forEach(({ year, month }) => {
        const monthPayments = completedPayments.filter(p => {
          const pd = new Date(p.paymentDate);
          return pd.getFullYear() === year && pd.getMonth() === month;
        });
        const monthName = new Date(year, month).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        monthlyBreakdown.push({
          month: monthName,
          principal: monthPayments.reduce((s, p) => s + Number(p.principalAmount || 0), 0),
          interest: monthPayments.reduce((s, p) => s + Number(p.interestAmount || 0), 0),
        });
      });

      res.json({
        delinquencyRate,
        atRiskAmount,
        totalDelinquentNotes: delinquentNotes.length,
        agingBuckets: {
          current: { count: agingBuckets.current.length, value: agingBuckets.current.reduce((s, n) => s + Number(n.currentBalance || 0), 0) },
          days30: { count: agingBuckets.days30.length, value: agingBuckets.days30.reduce((s, n) => s + Number(n.currentBalance || 0), 0) },
          days60: { count: agingBuckets.days60.length, value: agingBuckets.days60.reduce((s, n) => s + Number(n.currentBalance || 0), 0) },
          days90Plus: { count: agingBuckets.days90Plus.length, value: agingBuckets.days90Plus.reduce((s, n) => s + Number(n.currentBalance || 0), 0) },
        },
        totalPrincipalCollected,
        totalInterestCollected,
        monthlyBreakdown,
      });
    } catch (err: any) {
      logger.error("Error getting delinquency metrics", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  api.get("/api/finance/projections", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const allNotes = await storage.getNotes(org.id);
      const allPayments = await storage.getPayments(org.id);

      const activeNotes = allNotes.filter(n => n.status === 'active');
      const completedPayments = allPayments.filter(p => p.status === 'completed');

      const totalInvested = allNotes.reduce((sum, n) => sum + Number(n.originalPrincipal || 0), 0);
      const totalCollected = completedPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const totalInterestEarned = completedPayments.reduce((sum, p) => sum + Number(p.interestAmount || 0), 0);

      const firstPaymentDate = completedPayments.length > 0
        ? new Date(Math.min(...completedPayments.map(p => new Date(p.paymentDate).getTime())))
        : null;

      let annualYield = 0;
      let cashOnCashReturn = 0;

      if (firstPaymentDate && totalInvested > 0) {
        const yearsActive = Math.max(0.083, (Date.now() - firstPaymentDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
        annualYield = (totalInterestEarned / totalInvested / yearsActive) * 100;
        cashOnCashReturn = (totalCollected / totalInvested) * 100;
      }

      const projectedIncome: { month: string; expectedPayments: number; principal: number; interest: number }[] = [];
      const now = new Date();

      for (let i = 0; i < 12; i++) {
        const projMonth = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
        const monthName = projMonth.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

        let monthlyPrincipal = 0;
        let monthlyInterest = 0;
        let activeForMonth = 0;

        activeNotes.forEach(note => {
          const maturityDate = note.maturityDate ? new Date(note.maturityDate) : null;
          if (maturityDate && projMonth > maturityDate) return;

          activeForMonth++;
          const monthlyPayment = Number(note.monthlyPayment || 0);
          const interestRate = Number(note.interestRate || 0) / 100 / 12;
          const balance = Number(note.currentBalance || 0);

          const monthInterest = balance * interestRate;
          const monthPrincipal = monthlyPayment - monthInterest;

          monthlyInterest += Math.max(0, monthInterest);
          monthlyPrincipal += Math.max(0, monthPrincipal);
        });

        projectedIncome.push({
          month: monthName,
          expectedPayments: monthlyPrincipal + monthlyInterest,
          principal: monthlyPrincipal,
          interest: monthlyInterest,
        });
      }

      const totalExpectedInterest = activeNotes.reduce((sum, note) => {
        const schedule = note.amortizationSchedule || [];
        const pendingPayments = schedule.filter((p: any) => p.status === 'pending' || p.status === 'late');
        return sum + pendingPayments.reduce((s: number, p: any) => s + Number(p.interest || 0), 0);
      }, 0);

      const totalPaymentsRemaining = activeNotes.reduce((sum, note) => {
        const schedule = note.amortizationSchedule || [];
        return sum + schedule.filter((p: any) => p.status === 'pending' || p.status === 'late').length;
      }, 0);

      res.json({
        totalInvested,
        totalCollected,
        totalInterestEarned,
        annualYield,
        cashOnCashReturn,
        projectedIncome,
        amortizationSummary: {
          totalExpectedInterest,
          totalPaymentsRemaining,
          activeNotes: activeNotes.length,
        },
      });
    } catch (err: any) {
      logger.error("Error getting projections", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });
  
  // ============================================
  // PAYMENTS
  // ============================================

  // GET /api/payments — list payments, optionally filtered by noteId
  api.get("/api/payments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const noteId = req.query.noteId ? Number(req.query.noteId) : undefined;
      const result = await storage.getPayments(org.id, noteId);
      res.json(result);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/payments — record a payment against a note
  api.post("/api/payments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = insertPaymentSchema.safeParse({ ...req.body, organizationId: org.id });
      if (!parsed.success) {
        return Errors.badRequest(res, "Invalid payment data");
      }
      const payment = await storage.createPayment(parsed.data);

      try {
        const user = req.user as any;
        const userId = user?.claims?.sub || user?.id;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: userId?.toString() || null,
          action: "create",
          entityType: "payment",
          entityId: payment.id,
          changes: { after: parsed.data, fields: Object.keys(parsed.data) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.status(201).json(payment);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================

  // GET /api/finance/ltv-report
  api.get("/api/finance/ltv-report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { ltvMonitorService } = await import("./services/ltvMonitor");
      const org = req.organization;
      const report = await ltvMonitorService.getOrgLTVReport(org.id);
      res.json(report);
    } catch (e: any) {
      Errors.internal(res, e);
    }
  });

  // GET /api/notes/:id/schedule/pdf — Amortization schedule PDF download
  api.get("/api/notes/:id/schedule/pdf", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const noteId = Number(req.params.id);
      const note = await storage.getNote(org.id, noteId);
      if (!note) return Errors.notFound(res, "Note");

      const PDFDocument = (await import("pdfkit")).default;
      const doc = new PDFDocument({ margin: 50, size: "LETTER" });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="amortization-schedule-${noteId}.pdf"`);
      doc.pipe(res);

      // Header
      doc.fontSize(18).text("Amortization Schedule", { align: "center" });
      doc.moveDown();

      // Note terms
      const borrower = note.borrowerId ? await storage.getLead(org.id, note.borrowerId) : null;
      const borrowerLabel = borrower ? `${borrower.firstName} ${borrower.lastName}` : "N/A";
      doc.fontSize(10);
      doc.text(`Note ID: ${noteId}`);
      doc.text(`Borrower: ${borrowerLabel}`);
      doc.text(`Principal: $${Number(note.originalPrincipal || 0).toLocaleString()}`);
      doc.text(`Interest Rate: ${note.interestRate}%`);
      doc.text(`Term: ${note.termMonths} months`);
      doc.text(`Monthly Payment: $${Number(note.monthlyPayment || 0).toFixed(2)}`);
      doc.text(`Current Balance: $${Number(note.currentBalance || 0).toLocaleString()}`);
      doc.moveDown();

      // Schedule table
      const schedule = (note.amortizationSchedule as any[]) || [];
      if (schedule.length === 0) {
        doc.text("No amortization schedule available.");
      } else {
        const colWidths = [40, 80, 70, 70, 70, 80];
        const headers = ["#", "Date", "Payment", "Principal", "Interest", "Balance"];
        const startX = 50;
        let y = doc.y;

        // Table header
        doc.font("Helvetica-Bold").fontSize(8);
        headers.forEach((h, i) => {
          const x = startX + colWidths.slice(0, i).reduce((s, w) => s + w, 0);
          doc.text(h, x, y, { width: colWidths[i], align: "right" });
        });
        y += 15;
        doc.moveTo(startX, y).lineTo(startX + colWidths.reduce((s, w) => s + w, 0), y).stroke();
        y += 5;

        doc.font("Helvetica").fontSize(8);
        for (const row of schedule) {
          if (y > 700) { doc.addPage(); y = 50; }
          const values = [
            String(row.paymentNumber || ""),
            row.date ? new Date(row.date).toLocaleDateString() : "",
            `$${Number(row.payment || 0).toFixed(2)}`,
            `$${Number(row.principal || 0).toFixed(2)}`,
            `$${Number(row.interest || 0).toFixed(2)}`,
            `$${Number(row.balance || 0).toFixed(2)}`,
          ];
          values.forEach((v, i) => {
            const x = startX + colWidths.slice(0, i).reduce((s, w) => s + w, 0);
            doc.text(v, x, y, { width: colWidths[i], align: "right" });
          });
          y += 12;
        }
      }

      doc.moveDown(2);
      doc.fontSize(8).fillColor("gray").text(`Generated: ${new Date().toISOString()}`, { align: "center" });

      doc.end();
    } catch (err: any) {
      logger.error("Error generating schedule PDF", err instanceof Error ? err : undefined);
      if (!res.headersSent) {
        Errors.internal(res, err);
      }
    }
  });

  // GET /api/finance/ltv/:noteId
  api.get("/api/finance/ltv/:noteId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { ltvMonitorService } = await import("./services/ltvMonitor");
      const snapshot = await ltvMonitorService.getLTVSnapshot(parseInt(req.params.noteId));
      if (!snapshot) return Errors.notFound(res, "Note");
      res.json(snapshot);
    } catch (e: any) {
      Errors.internal(res, e);
    }
  });

}
