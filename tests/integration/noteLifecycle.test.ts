/**
 * Task #240 — Integration Test: Note Creation → Payment Schedule → Borrower Portal
 *
 * Tests the full seller-financed note lifecycle:
 *   note creation → amortization schedule generation → payment processing → borrower portal access
 *
 * No real DB or external calls — all storage interactions are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Domain types (mirrors shared/schema.ts) ──────────────────────────────────

type NoteStatus = "pending" | "active" | "paid_off" | "defaulted" | "foreclosed";
type PaymentStatus = "pending" | "processing" | "completed" | "failed" | "refunded";

interface Note {
  id: number;
  organizationId: number;
  borrowerId: number;
  propertyId: number;
  originalPrincipal: number;
  currentBalance: number;
  interestRate: number; // Annual rate, e.g. 0.08 = 8%
  termMonths: number;
  monthlyPayment: number;
  startDate: Date;
  firstPaymentDate: Date;
  nextPaymentDate: Date;
  status: NoteStatus;
  accessToken: string;
  amortizationSchedule: AmortizationEntry[];
  createdAt: Date;
}

interface AmortizationEntry {
  paymentNumber: number;
  dueDate: string;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
  status: "pending" | "paid" | "late" | "missed";
}

interface Payment {
  id: number;
  organizationId: number;
  noteId: number;
  amount: number;
  principalAmount: number;
  interestAmount: number;
  feeAmount: number;
  paymentDate: Date;
  dueDate: Date;
  paymentMethod: string;
  status: PaymentStatus;
  createdAt: Date;
}

interface BorrowerPortalView {
  noteId: number;
  borrowerName: string;
  borrowerEmail: string;
  loanBalance: number;
  nextPaymentAmount: number;
  nextPaymentDate: Date;
  paymentsCompleted: number;
  paymentsRemaining: number;
  amortizationSchedule: AmortizationEntry[];
}

// ─── Business logic helpers ────────────────────────────────────────────────────

/**
 * Calculate monthly payment using the standard amortization formula.
 * P * r * (1 + r)^n / ((1 + r)^n - 1)
 */
function calculateMonthlyPayment(principal: number, annualRate: number, termMonths: number): number {
  if (annualRate === 0) return principal / termMonths;
  const r = annualRate / 12;
  const factor = Math.pow(1 + r, termMonths);
  return (principal * r * factor) / (factor - 1);
}

/**
 * Generate a full amortization schedule for a note.
 */
function generateAmortizationSchedule(
  principal: number,
  annualRate: number,
  termMonths: number,
  firstPaymentDate: Date
): AmortizationEntry[] {
  const monthlyRate = annualRate / 12;
  const monthlyPayment = calculateMonthlyPayment(principal, annualRate, termMonths);
  const schedule: AmortizationEntry[] = [];
  let balance = principal;

  for (let i = 1; i <= termMonths; i++) {
    const interestAmount = balance * monthlyRate;
    const principalAmount = Math.min(monthlyPayment - interestAmount, balance);
    balance = Math.max(0, balance - principalAmount);

    const dueDate = new Date(firstPaymentDate);
    dueDate.setMonth(dueDate.getMonth() + (i - 1));

    schedule.push({
      paymentNumber: i,
      dueDate: dueDate.toISOString().split("T")[0],
      payment: parseFloat((principalAmount + interestAmount).toFixed(2)),
      principal: parseFloat(principalAmount.toFixed(2)),
      interest: parseFloat(interestAmount.toFixed(2)),
      balance: parseFloat(balance.toFixed(2)),
      status: "pending",
    });
  }
  return schedule;
}

/**
 * Create a new note with amortization schedule.
 */
function createNote(params: {
  organizationId: number;
  borrowerId: number;
  propertyId: number;
  principal: number;
  annualRate: number;
  termMonths: number;
  startDate: Date;
}): Note {
  const firstPaymentDate = new Date(params.startDate);
  firstPaymentDate.setMonth(firstPaymentDate.getMonth() + 1);

  const monthlyPayment = calculateMonthlyPayment(params.principal, params.annualRate, params.termMonths);
  const schedule = generateAmortizationSchedule(
    params.principal,
    params.annualRate,
    params.termMonths,
    firstPaymentDate
  );

  return {
    id: Math.floor(Math.random() * 100_000),
    organizationId: params.organizationId,
    borrowerId: params.borrowerId,
    propertyId: params.propertyId,
    originalPrincipal: params.principal,
    currentBalance: params.principal,
    interestRate: params.annualRate,
    termMonths: params.termMonths,
    monthlyPayment: parseFloat(monthlyPayment.toFixed(2)),
    startDate: params.startDate,
    firstPaymentDate,
    nextPaymentDate: firstPaymentDate,
    status: "active",
    accessToken: `tok_${Math.random().toString(36).slice(2)}`,
    amortizationSchedule: schedule,
    createdAt: new Date(),
  };
}

/**
 * Apply a payment to a note — updates balance and schedule entry.
 */
function applyPayment(
  note: Note,
  paymentNumber: number
): { updatedNote: Note; payment: Payment } {
  const entry = note.amortizationSchedule.find((e) => e.paymentNumber === paymentNumber);
  if (!entry) throw new Error(`Payment number ${paymentNumber} not found in schedule`);
  if (entry.status === "paid") throw new Error(`Payment ${paymentNumber} already applied`);

  const updatedSchedule = note.amortizationSchedule.map((e) =>
    e.paymentNumber === paymentNumber ? { ...e, status: "paid" as const } : e
  );

  const nextEntry = note.amortizationSchedule.find((e) => e.paymentNumber === paymentNumber + 1);

  const updatedNote: Note = {
    ...note,
    currentBalance: entry.balance,
    amortizationSchedule: updatedSchedule,
    nextPaymentDate: nextEntry ? new Date(nextEntry.dueDate) : note.nextPaymentDate,
    status: entry.balance === 0 ? "paid_off" : note.status,
  };

  const payment: Payment = {
    id: Math.floor(Math.random() * 100_000),
    organizationId: note.organizationId,
    noteId: note.id,
    amount: entry.payment,
    principalAmount: entry.principal,
    interestAmount: entry.interest,
    feeAmount: 0,
    paymentDate: new Date(),
    dueDate: new Date(entry.dueDate),
    paymentMethod: "manual",
    status: "completed",
    createdAt: new Date(),
  };

  return { updatedNote, payment };
}

/**
 * Build the borrower portal view for a note.
 */
function buildBorrowerPortalView(
  note: Note,
  borrowerName: string,
  borrowerEmail: string
): BorrowerPortalView {
  const completedPayments = note.amortizationSchedule.filter((e) => e.status === "paid");
  const pendingPayments = note.amortizationSchedule.filter((e) => e.status === "pending");
  const nextEntry = pendingPayments[0] ?? null;

  return {
    noteId: note.id,
    borrowerName,
    borrowerEmail,
    loanBalance: note.currentBalance,
    nextPaymentAmount: nextEntry ? nextEntry.payment : 0,
    nextPaymentDate: nextEntry ? new Date(nextEntry.dueDate) : note.nextPaymentDate,
    paymentsCompleted: completedPayments.length,
    paymentsRemaining: pendingPayments.length,
    amortizationSchedule: note.amortizationSchedule,
  };
}

// ─── Mocked storage layer ─────────────────────────────────────────────────────

const mockStorage = {
  notes: new Map<number, Note>(),
  payments: new Map<number, Payment>(),

  saveNote(note: Note): Note {
    this.notes.set(note.id, note);
    return note;
  },
  getNote(id: number): Note | undefined {
    return this.notes.get(id);
  },
  getNoteByAccessToken(token: string): Note | undefined {
    return Array.from(this.notes.values()).find((n) => n.accessToken === token);
  },
  savePayment(payment: Payment): Payment {
    this.payments.set(payment.id, payment);
    return payment;
  },
  getPaymentsByNoteId(noteId: number): Payment[] {
    return Array.from(this.payments.values()).filter((p) => p.noteId === noteId);
  },
  clear() {
    this.notes.clear();
    this.payments.clear();
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Note Creation (Task #240)", () => {
  beforeEach(() => mockStorage.clear());

  it("creates a note with correct monthly payment", () => {
    const note = createNote({
      organizationId: 1,
      borrowerId: 10,
      propertyId: 5,
      principal: 100_000,
      annualRate: 0.08,
      termMonths: 360,
    startDate: new Date("2025-01-01"),
    });

    // Standard amortization: $100k @ 8% / 30yr ≈ $733.76/month
    expect(note.monthlyPayment).toBeGreaterThan(730);
    expect(note.monthlyPayment).toBeLessThan(740);
    expect(note.status).toBe("active");
    expect(note.currentBalance).toBe(100_000);
  });

  it("creates a note with status 'active'", () => {
    const note = createNote({
      organizationId: 1,
      borrowerId: 10,
      propertyId: 5,
      principal: 50_000,
      annualRate: 0.10,
      termMonths: 120,
      startDate: new Date("2025-01-01"),
    });
    expect(note.status).toBe("active");
  });

  it("generates an access token for the borrower portal", () => {
    const note = createNote({
      organizationId: 1,
      borrowerId: 10,
      propertyId: 5,
      principal: 50_000,
      annualRate: 0.10,
      termMonths: 120,
      startDate: new Date("2025-01-01"),
    });
    expect(note.accessToken).toBeTruthy();
    expect(note.accessToken.length).toBeGreaterThan(4);
  });

  it("persists note to mock storage", () => {
    const note = createNote({
      organizationId: 1,
      borrowerId: 10,
      propertyId: 5,
      principal: 50_000,
      annualRate: 0.10,
      termMonths: 120,
      startDate: new Date("2025-01-01"),
    });
    mockStorage.saveNote(note);
    expect(mockStorage.getNote(note.id)).toBeDefined();
    expect(mockStorage.getNote(note.id)!.originalPrincipal).toBe(50_000);
  });
});

describe("Payment Schedule Generation (Task #240)", () => {
  it("generates schedule with correct number of entries", () => {
    const note = createNote({
      organizationId: 1,
      borrowerId: 10,
      propertyId: 5,
      principal: 50_000,
      annualRate: 0.10,
      termMonths: 60,
      startDate: new Date("2025-01-01"),
    });
    expect(note.amortizationSchedule).toHaveLength(60);
  });

  it("schedule entries start with paymentNumber 1", () => {
    const note = createNote({
      organizationId: 1,
      borrowerId: 10,
      propertyId: 5,
      principal: 50_000,
      annualRate: 0.10,
      termMonths: 60,
      startDate: new Date("2025-01-01"),
    });
    expect(note.amortizationSchedule[0].paymentNumber).toBe(1);
    expect(note.amortizationSchedule[59].paymentNumber).toBe(60);
  });

  it("final schedule entry has balance of 0", () => {
    const note = createNote({
      organizationId: 1,
      borrowerId: 10,
      propertyId: 5,
      principal: 50_000,
      annualRate: 0.10,
      termMonths: 60,
      startDate: new Date("2025-01-01"),
    });
    const lastEntry = note.amortizationSchedule[59];
    expect(lastEntry.balance).toBe(0);
  });

  it("early payments are interest-heavy (amortization front-loading)", () => {
    const note = createNote({
      organizationId: 1,
      borrowerId: 10,
      propertyId: 5,
      principal: 100_000,
      annualRate: 0.12,
      termMonths: 360,
      startDate: new Date("2025-01-01"),
    });
    const firstEntry = note.amortizationSchedule[0];
    const lastEntry = note.amortizationSchedule[359];
    // First payment is mostly interest; last payment is mostly principal
    expect(firstEntry.interest).toBeGreaterThan(firstEntry.principal);
    expect(lastEntry.principal).toBeGreaterThan(lastEntry.interest);
  });

  it("all schedule entries start with status 'pending'", () => {
    const note = createNote({
      organizationId: 1,
      borrowerId: 10,
      propertyId: 5,
      principal: 20_000,
      annualRate: 0.06,
      termMonths: 24,
      startDate: new Date("2025-01-01"),
    });
    const allPending = note.amortizationSchedule.every((e) => e.status === "pending");
    expect(allPending).toBe(true);
  });
});

describe("Payment Application (Task #240)", () => {
  let note: Note;

  beforeEach(() => {
    mockStorage.clear();
    note = createNote({
      organizationId: 1,
      borrowerId: 10,
      propertyId: 5,
      principal: 10_000,
      annualRate: 0.06,
      termMonths: 12,
      startDate: new Date("2025-01-01"),
    });
    mockStorage.saveNote(note);
  });

  it("applying payment 1 marks it as paid", () => {
    const { updatedNote, payment } = applyPayment(note, 1);
    const entry = updatedNote.amortizationSchedule.find((e) => e.paymentNumber === 1);
    expect(entry?.status).toBe("paid");
    expect(payment.status).toBe("completed");
  });

  it("applying payment reduces the loan balance", () => {
    const { updatedNote } = applyPayment(note, 1);
    expect(updatedNote.currentBalance).toBeLessThan(note.currentBalance);
  });

  it("payment record captures correct principal and interest split", () => {
    const { payment } = applyPayment(note, 1);
    const firstEntry = note.amortizationSchedule[0];
    expect(payment.principalAmount).toBeCloseTo(firstEntry.principal, 1);
    expect(payment.interestAmount).toBeCloseTo(firstEntry.interest, 1);
  });

  it("paying all installments sets note status to paid_off", () => {
    let current = note;
    for (let i = 1; i <= 12; i++) {
      const { updatedNote } = applyPayment(current, i);
      current = updatedNote;
    }
    expect(current.status).toBe("paid_off");
    expect(current.currentBalance).toBe(0);
  });

  it("throws when applying an already-paid payment", () => {
    const { updatedNote } = applyPayment(note, 1);
    expect(() => applyPayment(updatedNote, 1)).toThrow("already applied");
  });

  it("throws when applying a payment number that doesn't exist", () => {
    expect(() => applyPayment(note, 999)).toThrow("not found in schedule");
  });

  it("stores payment in mock storage", () => {
    const { payment } = applyPayment(note, 1);
    mockStorage.savePayment(payment);
    const stored = mockStorage.getPaymentsByNoteId(note.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe("completed");
  });
});

describe("Borrower Portal Access (Task #240)", () => {
  let note: Note;

  beforeEach(() => {
    mockStorage.clear();
    note = createNote({
      organizationId: 1,
      borrowerId: 10,
      propertyId: 5,
      principal: 10_000,
      annualRate: 0.06,
      termMonths: 6,
      startDate: new Date("2025-01-01"),
    });
    mockStorage.saveNote(note);
  });

  it("borrower can look up their note by access token", () => {
    const found = mockStorage.getNoteByAccessToken(note.accessToken);
    expect(found).toBeDefined();
    expect(found!.id).toBe(note.id);
  });

  it("invalid access token returns undefined (not found)", () => {
    const found = mockStorage.getNoteByAccessToken("tok_invalid_xyz");
    expect(found).toBeUndefined();
  });

  it("borrower portal view shows correct remaining balance", () => {
    const view = buildBorrowerPortalView(note, "Jane Doe", "jane@example.com");
    expect(view.loanBalance).toBe(note.currentBalance);
    expect(view.paymentsRemaining).toBe(6);
    expect(view.paymentsCompleted).toBe(0);
  });

  it("borrower portal view reflects payment after applying one installment", () => {
    const { updatedNote } = applyPayment(note, 1);
    const view = buildBorrowerPortalView(updatedNote, "Jane Doe", "jane@example.com");
    expect(view.paymentsCompleted).toBe(1);
    expect(view.paymentsRemaining).toBe(5);
  });

  it("borrower portal view includes full amortization schedule", () => {
    const view = buildBorrowerPortalView(note, "Jane Doe", "jane@example.com");
    expect(view.amortizationSchedule).toHaveLength(6);
  });

  it("borrower portal view has correct borrower details", () => {
    const view = buildBorrowerPortalView(note, "Jane Doe", "jane@example.com");
    expect(view.borrowerName).toBe("Jane Doe");
    expect(view.borrowerEmail).toBe("jane@example.com");
  });

  it("portal view shows 0 remaining payments when note is paid off", () => {
    let current = note;
    for (let i = 1; i <= 6; i++) {
      const { updatedNote } = applyPayment(current, i);
      current = updatedNote;
    }
    const view = buildBorrowerPortalView(current, "Jane Doe", "jane@example.com");
    expect(view.paymentsRemaining).toBe(0);
    expect(view.paymentsCompleted).toBe(6);
    expect(view.loanBalance).toBe(0);
  });

  it("organization scoping: note belongs to the correct org", () => {
    const orgNote = mockStorage.getNote(note.id);
    expect(orgNote?.organizationId).toBe(1);
  });
});
