import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { storage, db } from "./storage";
import { eq, and, gte, desc } from "drizzle-orm";
import { notes, payments } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { createRateLimiter, RATE_LIMIT_CONFIGS } from "./middleware/rateLimit";

const portalPaymentRateLimiter = createRateLimiter(RATE_LIMIT_CONFIGS.public, (req) => req.ip || req.socket.remoteAddress || 'unknown');
const deprecatedPaymentRateLimiter = createRateLimiter({ maxRequests: 2, windowMs: 60 * 1000 }, (req) => req.ip || req.socket.remoteAddress || 'unknown');

// Middleware to validate borrower session from cookie or header
async function validateBorrowerSession(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionToken = req.cookies?.borrower_session || req.headers['x-borrower-session'] as string;
    if (!sessionToken) {
      return res.status(401).json({ message: "Session required" });
    }
    const session = await storage.getBorrowerSession(sessionToken);
    if (!session) {
      res.clearCookie('borrower_session');
      return res.status(401).json({ message: "Invalid or expired session" });
    }
    if (new Date(session.expiresAt) < new Date()) {
      await storage.deleteBorrowerSession(sessionToken);
      res.clearCookie('borrower_session');
      return res.status(401).json({ message: "Session expired" });
    }
    await storage.updateBorrowerSessionAccess(sessionToken);
    (req as any).borrowerSession = session;
    next();
  } catch (err) {
    console.error("Borrower session validation error:", err);
    return res.status(500).json({ message: "Session validation failed" });
  }
}

const logger = {
  info: (msg: string, meta?: Record<string, any>) => console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), message: msg, ...meta })),
  warn: (msg: string, meta?: Record<string, any>) => console.warn(JSON.stringify({ level: 'WARN', timestamp: new Date().toISOString(), message: msg, ...meta })),
  error: (msg: string, meta?: Record<string, any>) => console.error(JSON.stringify({ level: 'ERROR', timestamp: new Date().toISOString(), message: msg, ...meta })),
};

export function registerBorrowerRoutes(app: Express): void {
  const api = app;

  // BORROWER PORTAL (Public)
  // ============================================
  
  api.post("/api/borrower/verify", async (req, res) => {
    try {
      const { accessToken, email } = req.body;
      
      if (!accessToken || !email) {
        return res.status(400).json({ message: "Access token and email are required" });
      }
      
      // Look up note by access token
      const note = await storage.getNoteByAccessToken(accessToken);
      
      // Security: Use generic "not found" for all failure cases to avoid information leakage
      // Do NOT expose whether access token exists or email matches
      if (!note) {
        return res.status(404).json({ message: "Loan not found or credentials invalid" });
      }
      
      // Verify borrower email - return same generic error if mismatch
      if (note.borrowerId) {
        const borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (!borrower || borrower.email?.toLowerCase() !== email.toLowerCase()) {
          return res.status(404).json({ message: "Loan not found or credentials invalid" });
        }
      } else {
        // No borrower linked - cannot verify, treat as not found
        return res.status(404).json({ message: "Loan not found or credentials invalid" });
      }
      
      // Create a session for the borrower
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
      
      await storage.createBorrowerSession({
        noteId: note.id,
        sessionToken,
        email: email.toLowerCase(),
        ipAddress: req.ip || req.socket.remoteAddress || null,
        userAgent: req.headers['user-agent'] || null,
        expiresAt,
      });
      
      // Set session cookie (httpOnly for security)
      res.cookie('borrower_session', sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/',
      });
      
      // Get payments for this note
      const notePayments = await storage.getPayments(note.organizationId, note.id);
      
      // Get property info if linked
      let property = null;
      if (note.propertyId) {
        property = await storage.getProperty(note.organizationId, note.propertyId);
      }
      
      // Get borrower info
      let borrower = null;
      if (note.borrowerId) {
        borrower = await storage.getLead(note.organizationId, note.borrowerId);
      }
      
      res.json({
        note: { ...note, property },
        payments: notePayments,
        borrower: borrower ? { firstName: borrower.firstName, lastName: borrower.lastName } : null,
        sessionToken, // Also return in response for clients that prefer header-based auth
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  
  // Check borrower session status
  api.get("/api/borrower/session", validateBorrowerSession, async (req, res) => {
    try {
      const session = (req as any).borrowerSession;
      
      // Get the note associated with the session
      const note = await storage.getNoteByAccessToken(session.noteId.toString());
      if (!note) {
        // Also try getting note by ID directly
        const noteById = await db.select().from(notes).where(eq(notes.id, session.noteId));
        if (noteById.length === 0) {
          return res.status(404).json({ message: "Loan not found" });
        }
        
        const foundNote = noteById[0];
        
        // Get payments for this note
        const notePayments = await storage.getPayments(foundNote.organizationId, foundNote.id);
        
        // Get property info if linked
        let property = null;
        if (foundNote.propertyId) {
          property = await storage.getProperty(foundNote.organizationId, foundNote.propertyId);
        }
        
        // Get borrower info
        let borrower = null;
        if (foundNote.borrowerId) {
          borrower = await storage.getLead(foundNote.organizationId, foundNote.borrowerId);
        }
        
        return res.json({
          note: { ...foundNote, property },
          payments: notePayments,
          borrower: borrower ? { firstName: borrower.firstName, lastName: borrower.lastName } : null,
          session: {
            email: session.email,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
          },
        });
      }
      
      // Get payments for this note
      const notePayments = await storage.getPayments(note.organizationId, note.id);
      
      // Get property info if linked
      let property = null;
      if (note.propertyId) {
        property = await storage.getProperty(note.organizationId, note.propertyId);
      }
      
      // Get borrower info
      let borrower = null;
      if (note.borrowerId) {
        borrower = await storage.getLead(note.organizationId, note.borrowerId);
      }
      
      res.json({
        note: { ...note, property },
        payments: notePayments,
        borrower: borrower ? { firstName: borrower.firstName, lastName: borrower.lastName } : null,
        session: {
          email: session.email,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  
  // Borrower logout
  api.post("/api/borrower/logout", async (req, res) => {
    try {
      const sessionToken = req.cookies?.borrower_session || req.headers['x-borrower-session'] as string;
      
      if (sessionToken) {
        await storage.deleteBorrowerSession(sessionToken);
      }
      
      res.clearCookie('borrower_session', { path: '/' });
      res.json({ message: "Logged out successfully" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  
  // Session-based payment endpoint (preferred for security)
  api.post("/api/borrower/payment", validateBorrowerSession, portalPaymentRateLimiter, async (req, res) => {
    try {
      const session = (req as any).borrowerSession;
      const { amount } = req.body;
      
      // Get note by session's noteId
      const noteResults = await db.select().from(notes).where(eq(notes.id, session.noteId));
      if (noteResults.length === 0) {
        return res.status(404).json({ message: "Loan not found" });
      }
      const note = noteResults[0];
      
      const paymentAmount = amount ? Number(amount) : Number(note.monthlyPayment || 0);
      if (paymentAmount <= 0) {
        return res.status(400).json({ message: "Invalid payment amount" });
      }
      
      // Get Stripe client
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      
      // Get borrower info for customer description
      let borrowerName = "Borrower";
      let borrowerEmail = session.email;
      if (note.borrowerId) {
        const borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (borrower) {
          borrowerName = `${borrower.firstName} ${borrower.lastName}`;
          borrowerEmail = borrower.email || session.email;
        }
      }
      
      // Create checkout session for one-time payment
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const stripeSession = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Loan Payment - Note #${note.id}`,
              description: `Payment for ${borrowerName}`,
            },
            unit_amount: Math.round(paymentAmount * 100),
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${baseUrl}/portal/${note.accessToken}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/portal/${note.accessToken}?payment=cancelled`,
        customer_email: borrowerEmail,
        metadata: {
          noteId: note.id.toString(),
          accessToken: note.accessToken || '',
          paymentAmount: paymentAmount.toString(),
          type: 'borrower_portal_payment',
        },
      });
      
      // Store the checkout session ID on the note for webhook verification
      await storage.updateNote(note.id, { pendingCheckoutSessionId: stripeSession.id });
      
      res.json({ url: stripeSession.url, sessionId: stripeSession.id });
    } catch (err: any) {
      console.error("Session-based portal payment error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // Create Stripe checkout session for borrower portal payment
  // DEPRECATED: Use session-based auth at /api/borrower/payment instead
  // Rate limited: 2 requests per minute per IP (stricter than session-based)
  api.post("/api/portal/:accessToken/payment", deprecatedPaymentRateLimiter, async (req, res) => {
    // Log deprecation warning
    logger.warn("Deprecated endpoint accessed: /api/portal/:accessToken/payment", {
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
      accessToken: req.params.accessToken ? "[REDACTED]" : undefined,
    });
    
    // Set deprecation warning header
    res.setHeader("X-Deprecation-Warning", "This endpoint is deprecated. Use session-based auth at /api/borrower/payment instead.");
    
    try {
      const { accessToken } = req.params;
      const { amount } = req.body;
      
      if (!accessToken) {
        return res.status(400).json({ message: "Access token is required" });
      }
      
      const note = await storage.getNoteByAccessToken(accessToken);
      if (!note) {
        return res.status(404).json({ message: "Loan not found" });
      }
      
      const paymentAmount = amount ? Number(amount) : Number(note.monthlyPayment || 0);
      if (paymentAmount <= 0) {
        return res.status(400).json({ message: "Invalid payment amount" });
      }
      
      // Get Stripe client
      const { getUncachableStripeClient, getStripePublishableKey } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      
      // Get borrower info for customer description
      let borrowerName = "Borrower";
      let borrowerEmail = undefined;
      if (note.borrowerId) {
        const borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (borrower) {
          borrowerName = `${borrower.firstName} ${borrower.lastName}`;
          borrowerEmail = borrower.email || undefined;
        }
      }
      
      // Create checkout session for one-time payment
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Loan Payment - Note #${note.id}`,
              description: `Payment for ${borrowerName}`,
            },
            unit_amount: Math.round(paymentAmount * 100), // Convert to cents
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${baseUrl}/portal/${accessToken}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/portal/${accessToken}?payment=cancelled`,
        customer_email: borrowerEmail,
        metadata: {
          noteId: note.id.toString(),
          accessToken,
          paymentAmount: paymentAmount.toString(),
          type: 'borrower_portal_payment',
        },
      });
      
      // Store the checkout session ID on the note for webhook verification
      await storage.updateNote(note.id, { pendingCheckoutSessionId: session.id });
      
      res.json({ url: session.url, sessionId: session.id });
    } catch (err: any) {
      console.error("Portal payment error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // Verify Stripe payment and create payment record
  api.post("/api/portal/:accessToken/verify-payment", async (req, res) => {
    try {
      const { accessToken } = req.params;
      const { sessionId } = req.body;
      
      if (!accessToken || !sessionId) {
        return res.status(400).json({ message: "Access token and session ID are required" });
      }
      
      const note = await storage.getNoteByAccessToken(accessToken);
      if (!note) {
        return res.status(404).json({ message: "Loan not found" });
      }
      
      // Verify Stripe session
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      if (session.payment_status !== 'paid') {
        return res.status(400).json({ message: "Payment not completed" });
      }
      
      // Check if payment already recorded for this session
      const existingPayments = await storage.getPayments(note.organizationId, note.id);
      const alreadyRecorded = existingPayments.some(p => p.transactionId === sessionId);
      if (alreadyRecorded) {
        return res.json({ success: true, message: "Payment already recorded" });
      }
      
      const paymentAmount = session.amount_total ? session.amount_total / 100 : Number(note.monthlyPayment);
      
      // Calculate principal/interest split from amortization schedule
      const schedule = note.amortizationSchedule || [];
      const nextPendingPayment = schedule.find(s => s.status === 'pending');
      
      let principalAmount = 0;
      let interestAmount = 0;
      
      if (nextPendingPayment) {
        // Use amortization schedule for split
        const ratio = paymentAmount / nextPendingPayment.payment;
        principalAmount = Number((nextPendingPayment.principal * ratio).toFixed(2));
        interestAmount = Number((nextPendingPayment.interest * ratio).toFixed(2));
      } else {
        // Calculate split based on current balance and rate
        const monthlyRate = Number(note.interestRate) / 100 / 12;
        interestAmount = Number((Number(note.currentBalance) * monthlyRate).toFixed(2));
        principalAmount = Number((paymentAmount - interestAmount).toFixed(2));
        if (principalAmount < 0) principalAmount = 0;
      }
      
      // Create payment record
      const payment = await storage.createPayment({
        organizationId: note.organizationId,
        noteId: note.id,
        amount: paymentAmount.toString(),
        principalAmount: principalAmount.toString(),
        interestAmount: interestAmount.toString(),
        feeAmount: "0",
        lateFeeAmount: "0",
        paymentDate: new Date(),
        dueDate: note.nextPaymentDate || new Date(),
        paymentMethod: 'card',
        transactionId: sessionId,
        status: 'completed',
      });
      
      // Update note balance
      const newBalance = Math.max(0, Number(note.currentBalance) - principalAmount);
      
      // Update amortization schedule status
      let updatedSchedule = schedule;
      if (nextPendingPayment) {
        updatedSchedule = schedule.map(s => 
          s.paymentNumber === nextPendingPayment.paymentNumber 
            ? { ...s, status: 'paid' } 
            : s
        );
      }
      
      // Calculate next payment date
      const nextPaymentDate = new Date(note.nextPaymentDate || new Date());
      nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
      
      await storage.updateNote(note.id, {
        currentBalance: newBalance.toString(),
        amortizationSchedule: updatedSchedule,
        nextPaymentDate: nextPaymentDate,
        status: newBalance <= 0 ? 'paid_off' : 'active',
      });
      
      res.json({ 
        success: true, 
        payment,
        newBalance,
      });
    } catch (err: any) {
      console.error("Payment verification error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // Toggle autopay for borrower portal
  api.post("/api/portal/:accessToken/autopay", async (req, res) => {
    try {
      const { accessToken } = req.params;
      const { enabled, email } = req.body;
      
      if (!accessToken) {
        return res.status(400).json({ message: "Access token is required" });
      }
      
      const note = await storage.getNoteByAccessToken(accessToken);
      if (!note) {
        return res.status(404).json({ message: "Loan not found" });
      }
      
      // Verify borrower email for security
      if (note.borrowerId) {
        const borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (!borrower || borrower.email?.toLowerCase() !== email?.toLowerCase()) {
          return res.status(403).json({ message: "Unauthorized" });
        }
      } else {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      await storage.updateNote(note.id, {
        autoPayEnabled: enabled === true,
      });
      
      res.json({ 
        success: true, 
        autopayEnabled: enabled === true,
        nextPaymentDate: note.nextPaymentDate,
      });
    } catch (err: any) {
      console.error("Autopay toggle error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // Get payoff quote for borrower portal
  api.get("/api/borrower/payoff-quote", async (req, res) => {
    try {
      const { accessToken, email } = req.query;
      
      if (!accessToken || !email) {
        return res.status(400).json({ message: "Access token and email are required" });
      }
      
      const note = await storage.getNoteByAccessToken(accessToken as string);
      if (!note) {
        return res.status(404).json({ message: "Loan not found" });
      }
      
      // Verify borrower email
      if (note.borrowerId) {
        const borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (!borrower || borrower.email?.toLowerCase() !== (email as string).toLowerCase()) {
          return res.status(403).json({ message: "Unauthorized" });
        }
      } else {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      // Calculate payoff amount
      const currentBalance = Number(note.currentBalance || 0);
      const interestRate = Number(note.interestRate || 0);
      const dailyRate = interestRate / 100 / 365;
      
      // Calculate accrued interest since last payment
      const lastPaymentDate = note.nextPaymentDate 
        ? new Date(new Date(note.nextPaymentDate).getTime() - 30 * 24 * 60 * 60 * 1000) 
        : new Date(note.startDate);
      const daysSinceLastPayment = Math.max(0, Math.floor((Date.now() - lastPaymentDate.getTime()) / (24 * 60 * 60 * 1000)));
      const accruedInterest = Number((currentBalance * dailyRate * daysSinceLastPayment).toFixed(2));
      
      // Any applicable fees (e.g., payoff processing fee)
      const payoffFee = 0; // Can be configured per organization
      
      const totalPayoff = Number((currentBalance + accruedInterest + payoffFee).toFixed(2));
      
      // Expiration date: 30 days from now
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + 30);
      
      res.json({
        principalBalance: currentBalance,
        accruedInterest,
        payoffFee,
        totalPayoff,
        goodThroughDate: expirationDate.toISOString(),
        quoteDate: new Date().toISOString(),
        daysValid: 30,
      });
    } catch (err: any) {
      console.error("Payoff quote error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // Generate PDF statement for borrower portal
  api.get("/api/borrower/statements/generate", async (req, res) => {
    try {
      const { accessToken, email, type, year, startDate, endDate } = req.query;
      
      if (!accessToken || !email) {
        return res.status(400).json({ message: "Access token and email are required" });
      }
      
      const note = await storage.getNoteByAccessToken(accessToken as string);
      if (!note) {
        return res.status(404).json({ message: "Loan not found" });
      }
      
      // Verify borrower email
      let borrower = null;
      if (note.borrowerId) {
        borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (!borrower || borrower.email?.toLowerCase() !== (email as string).toLowerCase()) {
          return res.status(403).json({ message: "Unauthorized" });
        }
      } else {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      // Get payments for this note
      const allPayments = await storage.getPayments(note.organizationId, note.id);
      
      // Get organization info for company details
      const org = await storage.getOrganization(note.organizationId);
      
      // Filter payments by date range if provided
      let filteredPayments = allPayments.filter(p => p.status === 'completed');
      if (startDate) {
        const start = new Date(startDate as string);
        filteredPayments = filteredPayments.filter(p => new Date(p.paymentDate) >= start);
      }
      if (endDate) {
        const end = new Date(endDate as string);
        filteredPayments = filteredPayments.filter(p => new Date(p.paymentDate) <= end);
      }
      
      // Calculate totals
      const totalPaid = filteredPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const totalPrincipal = filteredPayments.reduce((sum, p) => sum + Number(p.principalAmount || 0), 0);
      const totalInterest = filteredPayments.reduce((sum, p) => sum + Number(p.interestAmount || 0), 0);
      
      // Generate statement data based on type
      const statementType = type === '1098' ? '1098' : 'statement';
      
      if (statementType === '1098') {
        // 1098 Interest Statement for tax year
        const taxYear = year ? Number(year) : new Date().getFullYear() - 1;
        const yearStart = new Date(taxYear, 0, 1);
        const yearEnd = new Date(taxYear, 11, 31, 23, 59, 59);
        
        const yearPayments = allPayments.filter(p => {
          const payDate = new Date(p.paymentDate);
          return p.status === 'completed' && payDate >= yearStart && payDate <= yearEnd;
        });
        
        const yearInterest = yearPayments.reduce((sum, p) => sum + Number(p.interestAmount || 0), 0);
        
        res.json({
          type: '1098',
          taxYear,
          borrowerName: `${borrower.firstName} ${borrower.lastName}`,
          borrowerAddress: borrower.address || '',
          borrowerCity: borrower.city || '',
          borrowerState: borrower.state || '',
          borrowerZip: borrower.zip || '',
          lenderName: org?.name || 'Lender',
          lenderAddress: org?.settings?.companyAddress || '',
          interestPaid: yearInterest,
          principalBalance: Number(note.currentBalance),
          originalPrincipal: Number(note.originalPrincipal),
          loanOriginationDate: note.startDate,
        });
      } else {
        // Regular account statement
        res.json({
          type: 'statement',
          generatedDate: new Date().toISOString(),
          borrowerName: `${borrower.firstName} ${borrower.lastName}`,
          borrowerAddress: borrower.address || '',
          borrowerEmail: borrower.email || '',
          lenderName: org?.name || 'Lender',
          lenderPhone: org?.settings?.companyPhone || '',
          lenderEmail: org?.settings?.companyEmail || '',
          noteId: note.id,
          originalPrincipal: Number(note.originalPrincipal),
          currentBalance: Number(note.currentBalance),
          interestRate: Number(note.interestRate),
          termMonths: note.termMonths,
          monthlyPayment: Number(note.monthlyPayment),
          startDate: note.startDate,
          maturityDate: note.maturityDate,
          nextPaymentDate: note.nextPaymentDate,
          nextPaymentAmount: Number(note.monthlyPayment),
          autopayEnabled: note.autoPayEnabled || false,
          payments: filteredPayments.map(p => ({
            date: p.paymentDate,
            amount: Number(p.amount),
            principal: Number(p.principalAmount),
            interest: Number(p.interestAmount),
            method: p.paymentMethod,
          })),
          summary: {
            totalPaid,
            totalPrincipal,
            totalInterest,
            paymentsCount: filteredPayments.length,
          },
        });
      }
    } catch (err: any) {
      console.error("Statement generation error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // Generate borrower portal link
  api.post("/api/notes/:id/portal-link", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = Number(req.params.id);
      
      const note = await storage.getNote(org.id, noteId);
      if (!note) {
        return res.status(404).json({ message: "Note not found" });
      }
      
      // Use the access token for the portal URL
      const portalUrl = `${req.protocol}://${req.get('host')}/portal/${note.accessToken}`;
      
      res.json({ url: portalUrl });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


}
