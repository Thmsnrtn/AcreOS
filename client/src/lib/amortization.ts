/**
 * Pure client-side amortization utilities for seller-financed notes.
 * Mirrors the server-side calculateAmortizationSchedule in server/storage.ts
 * so the UI can compute schedules without a round-trip when note data is available.
 */

export type AmortizationRow = {
  paymentNumber: number;
  dueDate: string; // ISO string
  payment: number;
  principal: number;
  interest: number;
  balance: number;
  status: "pending" | "paid" | "late" | "missed";
};

export type AmortizationSummary = {
  totalPayments: number;
  totalInterest: number;
  totalPrincipal: number;
  payoffDate: string | null;
  monthlyPayment: number;
};

/**
 * Calculate the fixed monthly payment for a fully-amortizing loan.
 * Returns 0 if any required input is missing or invalid.
 */
export function calcMonthlyPayment(
  principal: number,
  annualRatePct: number,
  termMonths: number
): number {
  if (!principal || !termMonths || principal <= 0 || termMonths <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return Number((principal / termMonths).toFixed(2));
  const payment =
    (principal * (r * Math.pow(1 + r, termMonths))) /
    (Math.pow(1 + r, termMonths) - 1);
  return Number(payment.toFixed(2));
}

/**
 * Generate a full amortization schedule for a seller-financed note.
 *
 * @param principal    Original loan principal
 * @param annualRatePct  Annual interest rate as a percentage (e.g. 10 for 10%)
 * @param termMonths   Total loan term in months
 * @param startDate    Loan start date — first payment is one month after this
 * @param monthlyPayment  Optional override; computed via calcMonthlyPayment if omitted
 * @returns Array of AmortizationRow — one entry per scheduled payment
 */
export function calculateAmortization(
  principal: number,
  annualRatePct: number,
  termMonths: number,
  startDate: Date | string,
  monthlyPayment?: number
): AmortizationRow[] {
  if (!principal || !termMonths || principal <= 0 || termMonths <= 0) return [];

  const payment =
    monthlyPayment && monthlyPayment > 0
      ? monthlyPayment
      : calcMonthlyPayment(principal, annualRatePct, termMonths);

  const r = annualRatePct / 100 / 12;
  const start = typeof startDate === "string" ? new Date(startDate) : startDate;
  const schedule: AmortizationRow[] = [];
  let balance = principal;

  for (let i = 1; i <= termMonths && balance > 0.005; i++) {
    const interest = Number((balance * r).toFixed(2));
    const principalPayment = Number(
      Math.min(payment - interest, balance).toFixed(2)
    );
    balance = Number(Math.max(0, balance - principalPayment).toFixed(2));

    const dueDate = new Date(start);
    dueDate.setMonth(dueDate.getMonth() + i);

    schedule.push({
      paymentNumber: i,
      dueDate: dueDate.toISOString(),
      payment: i === termMonths ? Number((principalPayment + interest).toFixed(2)) : payment,
      principal: principalPayment,
      interest,
      balance,
      status: "pending",
    });
  }

  return schedule;
}

/**
 * Compute high-level summary stats for an amortization schedule.
 */
export function getAmortizationSummary(
  schedule: AmortizationRow[]
): AmortizationSummary {
  if (!schedule || schedule.length === 0) {
    return {
      totalPayments: 0,
      totalInterest: 0,
      totalPrincipal: 0,
      payoffDate: null,
      monthlyPayment: 0,
    };
  }

  const totalInterest = Number(
    schedule.reduce((s, r) => s + r.interest, 0).toFixed(2)
  );
  const totalPrincipal = Number(
    schedule.reduce((s, r) => s + r.principal, 0).toFixed(2)
  );

  return {
    totalPayments: schedule.length,
    totalInterest,
    totalPrincipal,
    payoffDate: schedule[schedule.length - 1].dueDate,
    monthlyPayment: schedule[0]?.payment ?? 0,
  };
}
