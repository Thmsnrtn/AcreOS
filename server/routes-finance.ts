import type { Express } from "express";
import { storage, db, calculateMonthlyPayment } from "./storage";
import { z } from "zod";
import { insertNoteSchema, insertPaymentSchema, paymentReminders } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { checkUsageLimit } from "./services/usageLimits";
import { usageMeteringService, creditService } from "./services/credits";
import { financeAgentService } from "./services/financeAgent";
import { exportNotesToCSV, type ExportFilters } from "./services/importExport";

export function registerFinanceRoutes(app: Express): void {
  const api = app;

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
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/notes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const noteId = Number(req.params.id);
    const existingNote = await storage.getNote(org.id, noteId);
    if (!existingNote) return res.status(404).json({ message: "Note not found" });
    
    const note = await storage.updateNote(noteId, req.body);
    
    const user = req.user as any;
    const userId = user?.claims?.sub || user?.id;
    await storage.createAuditLogEntry({
      organizationId: org.id,
      userId,
      action: "update",
      entityType: "note",
      entityId: noteId,
      changes: { before: existingNote, after: note, fields: Object.keys(req.body) },
      ipAddress: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers["user-agent"],
    });
    
    res.json(note);
  });
  
  api.delete("/api/notes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const noteId = Number(req.params.id);
    const existingNote = await storage.getNote(org.id, noteId);
    
    await storage.deleteNote(noteId);
    
    if (existingNote) {
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
    }
    
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
  // FINANCE AGENT - DELINQUENCY & REMINDERS
  // ============================================
  
  api.get("/api/notes/delinquent", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const delinquentNotes = await storage.getDelinquentNotes(org.id);
    res.json(delinquentNotes);
  });

  api.get("/api/notes/:id/reminders", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const noteId = Number(req.params.id);
    const note = await storage.getNote(org.id, noteId);
    if (!note) return res.status(404).json({ message: "Note not found" });
    
    const reminders = await storage.getRemindersForNote(noteId);
    res.json(reminders);
  });

  api.post("/api/notes/:id/send-reminder", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = Number(req.params.id);
      const { type = "due" } = req.body;
      
      const validTypes = ["upcoming", "due", "late", "final_warning"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ message: "Invalid reminder type" });
      }
      
      const result = await financeAgentService.sendManualReminder(noteId, org.id, type);
      
      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }
      
      res.json({ success: true, reminderId: result.reminderId });
    } catch (err: any) {
      console.error("Error sending manual reminder:", err);
      res.status(500).json({ message: err.message || "Failed to send reminder" });
    }
  });

  // ============================================
  // PHASE 6.1: AMORTIZATION SCHEDULE ROUTES
  // ============================================

  api.get("/api/notes/:id/schedule", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = Number(req.params.id);
      const note = await storage.getNote(org.id, noteId);
      if (!note) return res.status(404).json({ message: "Note not found" });
      
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
      console.error("Error getting schedule:", err);
      res.status(500).json({ message: err.message || "Failed to get schedule" });
    }
  });

  api.post("/api/notes/:id/schedule/generate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = Number(req.params.id);
      const note = await storage.getNote(org.id, noteId);
      if (!note) return res.status(404).json({ message: "Note not found" });
      
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
      console.error("Error generating schedule:", err);
      res.status(500).json({ message: err.message || "Failed to generate schedule" });
    }
  });

  // ============================================
  // PHASE 6.2: DUNNING & LATE PAYMENT ROUTES
  // ============================================

  api.get("/api/notes/:id/dunning", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = Number(req.params.id);
      const note = await storage.getNote(org.id, noteId);
      if (!note) return res.status(404).json({ message: "Note not found" });
      
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
      console.error("Error getting dunning info:", err);
      res.status(500).json({ message: err.message || "Failed to get dunning info" });
    }
  });

  api.post("/api/notes/:id/dunning", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = Number(req.params.id);
      const { action, stage, notes: actionNotes } = req.body;
      
      const note = await storage.getNote(org.id, noteId);
      if (!note) return res.status(404).json({ message: "Note not found" });
      
      const validActions = ["send_reminder", "escalate", "record_contact", "waive_fee", "set_payment_plan"];
      if (!validActions.includes(action)) {
        return res.status(400).json({ message: "Invalid dunning action" });
      }
      
      if (action === "send_reminder" || action === "escalate") {
        const reminderType = stage || "late";
        const result = await financeAgentService.sendManualReminder(noteId, org.id, reminderType);
        
        if (!result.success) {
          return res.status(400).json({ message: result.error });
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
      console.error("Error creating dunning action:", err);
      res.status(500).json({ message: err.message || "Failed to create dunning action" });
    }
  });

  api.get("/api/payment-reminders", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("Error getting payment reminders:", err);
      res.status(500).json({ message: err.message || "Failed to get reminders" });
    }
  });

  api.put("/api/payment-reminders/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const reminderId = Number(req.params.id);
      // Task #2: IDOR prevention — verify reminder belongs to requesting org
      const [existing] = await db.select({ id: paymentReminders.id })
        .from(paymentReminders)
        .where(and(eq(paymentReminders.id, reminderId), eq(paymentReminders.organizationId, org.id)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Payment reminder not found" });
      const { status, content, channel } = req.body;

      const updates: any = {};
      if (status) updates.status = status;
      if (content) updates.content = content;
      if (channel) updates.channel = channel;
      if (status === "cancelled") updates.failureReason = req.body.reason || "Manually cancelled";

      const updated = await storage.updatePaymentReminder(reminderId, updates);
      res.json(updated);
    } catch (err: any) {
      console.error("Error updating reminder:", err);
      res.status(500).json({ message: err.message || "Failed to update reminder" });
    }
  });

  api.get("/api/finance/health", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const health = await storage.getFinancePortfolioHealth(org.id);
    res.json(health);
  });

  api.post("/api/finance/process", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const result = await financeAgentService.processOrganizationNotes(org.id);
      res.json(result);
    } catch (err: any) {
      console.error("Error processing finance agent:", err);
      res.status(500).json({ message: err.message || "Failed to process notes" });
    }
  });

  // ============================================
  // FINANCIAL DASHBOARD API (Portfolio Analytics)
  // ============================================

  api.get("/api/finance/portfolio-summary", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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

      res.json({
        totalNotes: allNotes.length,
        activeNotes: activeNotes.length,
        totalPortfolioValue,
        totalMonthlyPayment,
        totalOriginalPrincipal,
        averageInterestRate: avgInterestRate,
        statusBreakdown,
      });
    } catch (err: any) {
      console.error("Error getting portfolio summary:", err);
      res.status(500).json({ message: err.message || "Failed to get portfolio summary" });
    }
  });

  api.get("/api/finance/delinquency", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("Error getting delinquency metrics:", err);
      res.status(500).json({ message: err.message || "Failed to get delinquency metrics" });
    }
  });

  api.get("/api/finance/projections", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("Error getting projections:", err);
      res.status(500).json({ message: err.message || "Failed to get projections" });
    }
  });
  
  // ============================================
  // PAYMENTS
  // ============================================

  // GET /api/payments — list payments, optionally filtered by noteId
  api.get("/api/payments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = req.query.noteId ? Number(req.query.noteId) : undefined;
      const result = await storage.getPayments(org.id, noteId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch payments" });
    }
  });

  // POST /api/payments — record a payment against a note
  api.post("/api/payments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const parsed = insertPaymentSchema.safeParse({ ...req.body, organizationId: org.id });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payment data", errors: parsed.error.flatten() });
      }
      const payment = await storage.createPayment(parsed.data);

      // Push notification for payment received (T61)
      setImmediate(async () => {
        try {
          const { notifyPaymentReceived } = await import("./services/pushNotificationService");
          const user = req.user as any;
          const userId = user?.claims?.sub ?? user?.id;
          if (userId && parsed.data.amount) {
            await notifyPaymentReceived(
              (req as any).organization.id,
              userId,
              parsed.data.noteId,
              Math.round(Number(parsed.data.amount))
            );
          }
        } catch (_) {}
      });

      res.status(201).json(payment);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to record payment" });
    }
  });

  // ============================================

}
