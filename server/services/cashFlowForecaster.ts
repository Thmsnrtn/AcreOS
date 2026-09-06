import { db } from "../db";
import {
  cashFlowForecasts,
  notes,
  payments,
  properties,
  agentEvents,
  type InsertCashFlowForecast,
  type CashFlowForecast,
  type Note,
  type Payment,
  type Property,
} from "@shared/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { getOpenAIClient } from "../utils/openaiClient";
import { addMonths } from "../utils/dateUtils";
import { noteGracePeriodDays } from "@shared/notes/delinquency";

/**
 * Thrown when a note, property or forecast id does not belong to the calling
 * organization. Rendered as 404 by the routes — never 403, which would confirm
 * the record exists.
 */
export class CashFlowNotInOrgError extends Error {
  constructor(what: string, id: number) {
    super(`${what} ${id} not found in this organization`);
    this.name = "CashFlowNotInOrgError";
  }
}


type IncomeSource = "note_payment" | "interest" | "sale_proceeds" | "rent" | "lease";
type ExpenseCategory = "taxes" | "insurance" | "maintenance" | "legal" | "marketing";
type PaymentPattern = "consistent" | "declining" | "improving" | "erratic";

interface IncomeProjection {
  month: string;
  expectedAmount: number;
  probability: number;
  source: IncomeSource;
  notes?: string;
}

interface ExpenseProjection {
  month: string;
  amount: number;
  category: ExpenseCategory;
  notes?: string;
}

interface PaymentHealthAnalysis {
  onTimePayments: number;
  latePayments: number;
  missedPayments: number;
  averageDaysLate: number;
  paymentPattern: PaymentPattern;
  defaultProbability: number;
}

interface RiskFactor {
  factor: string;
  impact: "high" | "medium" | "low";
  mitigation?: string;
}

interface ForecastInsight {
  type: string;
  message: string;
  urgency: "low" | "medium" | "high" | "critical";
}

interface ForecastParams {
  noteId?: number;
  propertyId?: number;
  periodMonths?: number;
}

interface PortfolioCashFlowSummary {
  totalProjectedIncome: number;
  totalProjectedExpenses: number;
  netCashFlow: number;
  incomeBySource: Record<string, number>;
  expensesByCategory: Record<string, number>;
  monthlyBreakdown: Array<{
    month: string;
    income: number;
    expenses: number;
    net: number;
  }>;
  highRiskNoteCount: number;
  averagePaymentRiskScore: number;
}

interface ActualVsProjectedComparison {
  periodMonths: number;
  forecasts: Array<{
    forecastId: number;
    forecastDate: Date;
    projectedIncome: number;
    actualIncome: number;
    variancePercent: number;
    projectedExpenses: number;
    actualExpenses: number;
    expenseVariancePercent: number;
  }>;
  overallAccuracy: number;
}

class CashFlowForecasterService {
  async generateForecast(
    organizationId: number,
    params: ForecastParams
  ): Promise<CashFlowForecast> {
    const { noteId, propertyId, periodMonths = 12 } = params;

    let projectedIncome: IncomeProjection[] = [];
    let projectedExpenses: ExpenseProjection[] = [];
    let paymentRiskScore: number | undefined;
    let riskFactors: RiskFactor[] = [];
    let paymentHealth: PaymentHealthAnalysis | undefined;

    if (noteId) {
      projectedIncome = await this.projectNoteIncome(noteId, organizationId, periodMonths);
      paymentHealth = await this.analyzePaymentHealth(noteId, organizationId);
      paymentRiskScore = await this.calculatePaymentRiskScore(noteId, organizationId);
      riskFactors = await this.identifyRiskFactors(noteId, organizationId);
      projectedExpenses = await this.projectExpenses("note", noteId, organizationId, periodMonths);
    }

    if (propertyId) {
      const propertyIncome = await this.projectPropertyIncome(propertyId, organizationId, periodMonths);
      projectedIncome = [...projectedIncome, ...propertyIncome];
      const propertyExpenses = await this.projectExpenses("property", propertyId, organizationId, periodMonths);
      projectedExpenses = [...projectedExpenses, ...propertyExpenses];
    }

    // Portfolio-level forecast when no specific holding is targeted: aggregate every
    // active note + owned property for the org. The /cash-flow page's "Generate
    // forecast" CTA has no note/property picker — it intends exactly this org-wide
    // view — so the previous "Either noteId or propertyId must be provided" guard
    // made that CTA a guaranteed 400. The forecast row persists with both ids null.
    if (!noteId && !propertyId) {
      const [activeNotes, ownedProperties] = await Promise.all([
        db.select().from(notes)
          .where(and(eq(notes.organizationId, organizationId), eq(notes.status, "active"))),
        db.select().from(properties)
          .where(and(eq(properties.organizationId, organizationId), eq(properties.status, "owned"))),
      ]);

      if (activeNotes.length === 0 && ownedProperties.length === 0) {
        throw new Error("No active notes or owned properties to forecast yet — add a note or mark a property owned first.");
      }

      const noteRiskScores: number[] = [];
      for (const note of activeNotes) {
        projectedIncome.push(...await this.projectNoteIncome(note.id, organizationId, periodMonths));
        projectedExpenses.push(...await this.projectExpenses("note", note.id, organizationId, periodMonths));
        riskFactors.push(...await this.identifyRiskFactors(note.id, organizationId));
        noteRiskScores.push(await this.calculatePaymentRiskScore(note.id, organizationId));
      }
      for (const property of ownedProperties) {
        projectedIncome.push(...await this.projectPropertyIncome(property.id, organizationId, periodMonths));
        projectedExpenses.push(...await this.projectExpenses("property", property.id, organizationId, periodMonths));
      }

      // Portfolio payment risk = mean of per-note risk scores (properties carry no
      // payment-risk score). Undefined when the portfolio holds no notes.
      paymentRiskScore = noteRiskScores.length > 0
        ? Math.round(noteRiskScores.reduce((a, b) => a + b, 0) / noteRiskScores.length)
        : undefined;
    }

    const totalProjectedIncome = projectedIncome.reduce(
      (sum, item) => sum + item.expectedAmount * item.probability,
      0
    );
    const totalProjectedExpenses = projectedExpenses.reduce(
      (sum, item) => sum + item.amount,
      0
    );
    const netCashFlow = totalProjectedIncome - totalProjectedExpenses;

    const forecastData: InsertCashFlowForecast = {
      organizationId,
      noteId: noteId || null,
      propertyId: propertyId || null,
      forecastDate: new Date(),
      forecastPeriodMonths: periodMonths,
      projectedIncome,
      projectedExpenses,
      totalProjectedIncome: totalProjectedIncome.toString(),
      totalProjectedExpenses: totalProjectedExpenses.toString(),
      netCashFlow: netCashFlow.toString(),
      paymentRiskScore,
      riskFactors,
      paymentHealth: paymentHealth
        ? {
            onTimePayments: paymentHealth.onTimePayments,
            latePayments: paymentHealth.latePayments,
            missedPayments: paymentHealth.missedPayments,
            averageDaysLate: paymentHealth.averageDaysLate,
            paymentPattern: paymentHealth.paymentPattern,
            defaultProbability: paymentHealth.defaultProbability,
          }
        : undefined,
    };

    const [forecast] = await db
      .insert(cashFlowForecasts)
      .values(forecastData)
      .returning();

    const insights = await this.generateInsights(forecast.id, organizationId);
    if (insights.length > 0) {
      await db
        .update(cashFlowForecasts)
        .set({ insights })
        .where(
          and(
            eq(cashFlowForecasts.id, forecast.id),
            eq(cashFlowForecasts.organizationId, organizationId),
          ),
        );
      forecast.insights = insights;
    }

    await this.logAgentEvent(organizationId, "cash_flow_forecast_generated", {
      forecastId: forecast.id,
      noteId,
      propertyId,
      periodMonths,
      totalProjectedIncome,
      netCashFlow,
      paymentRiskScore,
    });

    return forecast;
  }

  async projectNoteIncome(noteId: number, organizationId: number, months: number): Promise<IncomeProjection[]> {
    const [note] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.id, noteId), eq(notes.organizationId, organizationId)));

    if (!note) {
      throw new CashFlowNotInOrgError("Note", noteId);
    }

    const paymentHealth = await this.analyzePaymentHealth(noteId, organizationId);
    const baseProbability = 1 - paymentHealth.defaultProbability;

    const projections: IncomeProjection[] = [];
    // Task #218: Use cent-rounded values throughout amortization to prevent floating-point drift
    const monthlyPayment = Math.round(parseFloat(note.monthlyPayment) * 100) / 100;
    const interestRate = parseFloat(note.interestRate) / 100 / 12;
    // Track balance in integer cents to avoid IEEE-754 cumulative error
    let currentBalanceCents = Math.round(parseFloat(note.currentBalance) * 100);

    const today = new Date();
    const nextPaymentDate = note.nextPaymentDate ? new Date(note.nextPaymentDate) : new Date(today);

    for (let i = 0; i < months; i++) {
      if (currentBalanceCents <= 0) break;
      const currentBalance = currentBalanceCents / 100;

      const paymentDate = addMonths(new Date(nextPaymentDate), i);
      const monthStr = paymentDate.toISOString().slice(0, 7);

      const interestPayment = Math.round(currentBalance * interestRate * 100) / 100;
      const principalPayment = Math.min(monthlyPayment - interestPayment, currentBalance);
      const totalPayment = Math.min(monthlyPayment, currentBalance + interestPayment);

      let probability = baseProbability;
      if (paymentHealth.paymentPattern === "declining") {
        probability = Math.max(0.3, baseProbability - i * 0.02);
      } else if (paymentHealth.paymentPattern === "improving") {
        probability = Math.min(0.98, baseProbability + i * 0.01);
      } else if (paymentHealth.paymentPattern === "erratic") {
        probability = baseProbability * 0.9;
      }

      projections.push({
        month: monthStr,
        expectedAmount: totalPayment,
        probability,
        source: "note_payment",
        notes: `Principal: $${principalPayment.toFixed(2)}, Interest: $${interestPayment.toFixed(2)}`,
      });

      currentBalanceCents -= Math.round(principalPayment * 100);
    }

    return projections;
  }

  async projectPropertyIncome(propertyId: number, organizationId: number, months: number): Promise<IncomeProjection[]> {
    const [property] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)));

    if (!property) {
      throw new CashFlowNotInOrgError("Property", propertyId);
    }

    const projections: IncomeProjection[] = [];
    const today = new Date();

    if (property.status === "listed" && property.listPrice) {
      const listPrice = parseFloat(property.listPrice);
      const estimatedSaleMonth = 3;
      const saleDate = addMonths(new Date(today), estimatedSaleMonth);
      
      projections.push({
        month: saleDate.toISOString().slice(0, 7),
        expectedAmount: listPrice,
        probability: 0.4,
        source: "sale_proceeds",
        notes: "Estimated sale based on listing price",
      });
    }

    if (property.status === "owned") {
      const marketValue = property.marketValue ? parseFloat(property.marketValue) : null;
      if (marketValue) {
        const estimatedMonthlyRent = marketValue * 0.008;
        
        for (let i = 0; i < months; i++) {
          const rentDate = addMonths(new Date(today), i);
          
          projections.push({
            month: rentDate.toISOString().slice(0, 7),
            expectedAmount: estimatedMonthlyRent,
            probability: 0.7,
            source: "rent",
            notes: "Potential rental income estimate",
          });
        }
      }
    }

    return projections;
  }

  async projectExpenses(
    entityType: "note" | "property",
    entityId: number,
    organizationId: number,
    months: number
  ): Promise<ExpenseProjection[]> {
    const projections: ExpenseProjection[] = [];
    const today = new Date();

    if (entityType === "property") {
      const [property] = await db
        .select()
        .from(properties)
        .where(and(eq(properties.id, entityId), eq(properties.organizationId, organizationId)));

      if (property) {
        // A PROPERTY WE CANNOT VALUE HAS UNKNOWN CARRY, NOT ZERO CARRY.
        //
        // This read `property.assessedValue ? parseFloat(...) : 0`, and every
        // carrying cost below is a percentage OF that value — so a property
        // with no assessed value produced a monthly tax, insurance and
        // maintenance of exactly 0, and the `> 0` guards then skipped pushing
        // them at all. The forecast came out with no carrying costs and no
        // indication that any were missing, which reads as "this property costs
        // nothing to hold" and makes projected cash flow look better than it is.
        //
        // Silence is the failure mode here, not the zero: a reader of a cash
        // flow forecast cannot tell an omitted expense from an absent one.
        const rawAssessed = property.assessedValue === null || property.assessedValue === undefined
          ? null
          : parseFloat(property.assessedValue);
        const assessedValue =
          rawAssessed !== null && Number.isFinite(rawAssessed) && rawAssessed > 0
            ? rawAssessed
            : null;

        if (assessedValue === null) {
          // One row, amount 0, that EXISTS to say the carry is unknown. A
          // labelled gap beats both an invented cost and an invisible one —
          // the same shape `LandProfileGap` uses on the parcel surface.
          projections.push({
            month: today.toISOString().slice(0, 7),
            amount: 0,
            category: "taxes",
            notes:
              `Carrying costs (tax, insurance, maintenance) are NOT included for ` +
              `property #${entityId}: no assessed value is on file, and these are ` +
              `derived from it. This forecast understates holding cost by an ` +
              `unknown amount.`,
          });
          return projections;
        }

        // The three rates below are platform assumptions, not measurements, and
        // are named as such in every row's `notes` for the same reason the land
        // exit model badges its defaults.
        const annualTaxRate = 0.015;
        const monthlyTax = (assessedValue * annualTaxRate) / 12;
        
        const monthlyInsurance = (assessedValue * 0.005) / 12;
        
        const monthlyMaintenance = (assessedValue * 0.01) / 12;

        for (let i = 0; i < months; i++) {
          const expenseDate = addMonths(new Date(today), i);
          const monthStr = expenseDate.toISOString().slice(0, 7);

          if (monthlyTax > 0) {
            projections.push({
              month: monthStr,
              amount: monthlyTax,
              category: "taxes",
              notes: "Property tax estimate",
            });
          }

          if (monthlyInsurance > 0) {
            projections.push({
              month: monthStr,
              amount: monthlyInsurance,
              category: "insurance",
            });
          }

          if (monthlyMaintenance > 0) {
            projections.push({
              month: monthStr,
              amount: monthlyMaintenance,
              category: "maintenance",
            });
          }
        }

        if (property.status === "listed") {
          const marketingBudget = (property.listPrice ? parseFloat(property.listPrice) : 0) * 0.02;
          projections.push({
            month: today.toISOString().slice(0, 7),
            amount: marketingBudget,
            category: "marketing",
            notes: "Listing and marketing expenses",
          });
        }
      }
    }

    if (entityType === "note") {
      const [note] = await db
        .select()
        .from(notes)
        .where(and(eq(notes.id, entityId), eq(notes.organizationId, organizationId)));

      if (note) {
        const serviceFee = note.serviceFee ? parseFloat(note.serviceFee) : 0;
        
        for (let i = 0; i < months; i++) {
          const expenseDate = addMonths(new Date(today), i);
          const monthStr = expenseDate.toISOString().slice(0, 7);

          if (serviceFee > 0) {
            projections.push({
              month: monthStr,
              amount: serviceFee,
              category: "maintenance",
              notes: "Note servicing fee",
            });
          }
        }

        const paymentHealth = await this.analyzePaymentHealth(entityId, organizationId);
        if (paymentHealth.defaultProbability > 0.3) {
          projections.push({
            month: today.toISOString().slice(0, 7),
            amount: 500,
            category: "legal",
            notes: "Potential collection/legal costs due to payment risk",
          });
        }
      }
    }

    return projections;
  }

  async analyzePaymentHealth(noteId: number, organizationId: number): Promise<PaymentHealthAnalysis> {
    const [note] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.id, noteId), eq(notes.organizationId, organizationId)));

    if (!note) {
      throw new CashFlowNotInOrgError("Note", noteId);
    }

    const paymentHistory = await db
      .select()
      .from(payments)
      .where(eq(payments.noteId, noteId))
      .orderBy(desc(payments.paymentDate));

    let onTimePayments = 0;
    let latePayments = 0;
    let missedPayments = 0;
    let totalDaysLate = 0;
    let lateCount = 0;

    // WAS `note.gracePeriodDays || 10` at three sites. `||` fires on 0, so a
  // note granting NO grace was forecast as if it granted ten days; and when
  // the record states no term, ten was invented. This is an internal SIGNAL,
  // not money and not an instrument, so it takes the aging sweep's convention
  // — unstated measures as ZERO (acquiredNoteAging.ts:291) — rather than a
  // third answer for the same question.
  const graceForForecast = noteGracePeriodDays(note.gracePeriodDays) ?? 0;
  for (const payment of paymentHistory) {
      if (payment.status === "completed") {
        const dueDate = new Date(payment.dueDate);
        const paymentDate = new Date(payment.paymentDate);
        const daysLate = Math.floor((paymentDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysLate <= graceForForecast) {
          onTimePayments++;
        } else {
          latePayments++;
          totalDaysLate += daysLate;
          lateCount++;
        }
      } else if (payment.status === "failed") {
        missedPayments++;
      }
    }

    const expectedPayments = this.calculateExpectedPayments(note);
    const completedPayments = onTimePayments + latePayments;
    missedPayments = Math.max(missedPayments, expectedPayments - completedPayments - 1);

    const averageDaysLate = lateCount > 0 ? totalDaysLate / lateCount : 0;

    const paymentPattern = this.determinePaymentPattern(paymentHistory, note);

    const defaultProbability = this.calculateDefaultProbability({
      onTimePayments,
      latePayments,
      missedPayments,
      averageDaysLate,
      paymentPattern,
      currentDelinquencyStatus: note.delinquencyStatus || "current",
      daysDelinquent: note.daysDelinquent || 0,
    });

    return {
      onTimePayments,
      latePayments,
      missedPayments,
      averageDaysLate,
      paymentPattern,
      defaultProbability,
    };
  }

  private calculateExpectedPayments(note: Note): number {
    const startDate = new Date(note.startDate);
    const today = new Date();
    const monthsDiff = (today.getFullYear() - startDate.getFullYear()) * 12 + 
                       (today.getMonth() - startDate.getMonth());
    return Math.max(0, Math.min(monthsDiff, note.termMonths));
  }

  private determinePaymentPattern(paymentHistory: Payment[], note: Note): PaymentPattern {
    if (paymentHistory.length < 3) {
      return "consistent";
    }

    // Same convention as the on-time count above: this is an internal signal,
    // so an unstated grace period measures as ZERO rather than as an invented
    // ten days, and `|| 10` no longer overrides a deliberate zero.
    const graceForForecast = noteGracePeriodDays(note.gracePeriodDays) ?? 0;

    const recentPayments = paymentHistory.slice(0, Math.min(6, paymentHistory.length));
    const olderPayments = paymentHistory.slice(Math.min(6, paymentHistory.length));

    const recentLateCount = recentPayments.filter(p => {
      if (p.status !== "completed") return false;
      const daysLate = Math.floor(
        (new Date(p.paymentDate).getTime() - new Date(p.dueDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      return daysLate > graceForForecast;
    }).length;

    const olderLateCount = olderPayments.filter(p => {
      if (p.status !== "completed") return false;
      const daysLate = Math.floor(
        (new Date(p.paymentDate).getTime() - new Date(p.dueDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      return daysLate > graceForForecast;
    }).length;

    const recentLateRate = recentPayments.length > 0 ? recentLateCount / recentPayments.length : 0;
    const olderLateRate = olderPayments.length > 0 ? olderLateCount / olderPayments.length : 0;

    if (recentLateRate > olderLateRate + 0.2) {
      return "declining";
    } else if (olderLateRate > recentLateRate + 0.2) {
      return "improving";
    } else if (recentLateRate > 0.3 && olderLateRate > 0.3) {
      return "erratic";
    }

    return "consistent";
  }

  private calculateDefaultProbability(params: {
    onTimePayments: number;
    latePayments: number;
    missedPayments: number;
    averageDaysLate: number;
    paymentPattern: PaymentPattern;
    currentDelinquencyStatus: string;
    daysDelinquent: number;
  }): number {
    let probability = 0;

    const totalPayments = params.onTimePayments + params.latePayments + params.missedPayments;
    if (totalPayments > 0) {
      const missedRate = params.missedPayments / totalPayments;
      const lateRate = params.latePayments / totalPayments;
      probability += missedRate * 0.4 + lateRate * 0.15;
    }

    if (params.averageDaysLate > 60) {
      probability += 0.2;
    } else if (params.averageDaysLate > 30) {
      probability += 0.1;
    }

    switch (params.paymentPattern) {
      case "declining":
        probability += 0.15;
        break;
      case "erratic":
        probability += 0.1;
        break;
      case "improving":
        probability -= 0.05;
        break;
    }

    switch (params.currentDelinquencyStatus) {
      case "seriously_delinquent":
        probability += 0.25;
        break;
      case "delinquent":
        probability += 0.15;
        break;
      case "early_delinquent":
        probability += 0.05;
        break;
      case "default_candidate":
        probability += 0.35;
        break;
    }

    if (params.daysDelinquent > 90) {
      probability += 0.15;
    } else if (params.daysDelinquent > 60) {
      probability += 0.08;
    } else if (params.daysDelinquent > 30) {
      probability += 0.03;
    }

    return Math.max(0, Math.min(1, probability));
  }

  async calculatePaymentRiskScore(noteId: number, organizationId: number): Promise<number> {
    const health = await this.analyzePaymentHealth(noteId, organizationId);
    
    const riskScore = Math.round(health.defaultProbability * 100);
    
    return Math.max(0, Math.min(100, riskScore));
  }

  async identifyRiskFactors(noteId: number, organizationId: number): Promise<RiskFactor[]> {
    const [note] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.id, noteId), eq(notes.organizationId, organizationId)));

    if (!note) {
      throw new CashFlowNotInOrgError("Note", noteId);
    }

    const health = await this.analyzePaymentHealth(noteId, organizationId);
    const factors: RiskFactor[] = [];

    if (health.missedPayments > 0) {
      factors.push({
        factor: `${health.missedPayments} missed payment(s) in history`,
        impact: health.missedPayments >= 3 ? "high" : health.missedPayments >= 2 ? "medium" : "low",
        mitigation: "Set up automatic payment reminders and consider restructuring",
      });
    }

    if (health.averageDaysLate > 30) {
      factors.push({
        factor: `Average ${Math.round(health.averageDaysLate)} days late on payments`,
        impact: health.averageDaysLate > 60 ? "high" : "medium",
        mitigation: "Consider adjusting payment due date or setting up autopay",
      });
    }

    if (health.paymentPattern === "declining") {
      factors.push({
        factor: "Payment timeliness is declining over time",
        impact: "high",
        mitigation: "Proactive outreach to borrower to understand situation",
      });
    } else if (health.paymentPattern === "erratic") {
      factors.push({
        factor: "Inconsistent payment behavior",
        impact: "medium",
        mitigation: "Consider more frequent communication and reminders",
      });
    }

    if (note.daysDelinquent && note.daysDelinquent > 0) {
      factors.push({
        factor: `Currently ${note.daysDelinquent} days delinquent`,
        impact: note.daysDelinquent > 60 ? "high" : note.daysDelinquent > 30 ? "medium" : "low",
        mitigation: "Immediate outreach and payment plan discussion",
      });
    }

    const ltvRatio = this.estimateLTV(note);
    if (ltvRatio && ltvRatio > 0.9) {
      factors.push({
        factor: "High loan-to-value ratio",
        impact: "medium",
        mitigation: "Monitor property value and consider additional security",
      });
    }

    if (!note.autoPayEnabled) {
      factors.push({
        factor: "Automatic payments not enabled",
        impact: "low",
        mitigation: "Encourage borrower to set up autopay",
      });
    }

    return factors;
  }

  private estimateLTV(note: Note): number | null {
    return null;
  }

  async generateInsights(forecastId: number, organizationId: number): Promise<ForecastInsight[]> {
    const [forecast] = await db
      .select()
      .from(cashFlowForecasts)
      .where(and(eq(cashFlowForecasts.id, forecastId), eq(cashFlowForecasts.organizationId, organizationId)));

    if (!forecast) {
      throw new CashFlowNotInOrgError("Forecast", forecastId);
    }

    const insights: ForecastInsight[] = [];

    const totalIncome = forecast.totalProjectedIncome ? parseFloat(forecast.totalProjectedIncome) : 0;
    const totalExpenses = forecast.totalProjectedExpenses ? parseFloat(forecast.totalProjectedExpenses) : 0;
    const netCashFlow = forecast.netCashFlow ? parseFloat(forecast.netCashFlow) : 0;

    if (netCashFlow < 0) {
      insights.push({
        type: "cash_flow_warning",
        message: `Projected negative cash flow of $${Math.abs(netCashFlow).toFixed(2)} over forecast period`,
        urgency: "high",
      });
    }

    if (forecast.paymentRiskScore && forecast.paymentRiskScore > 70) {
      insights.push({
        type: "payment_risk",
        message: "High payment risk detected. Consider proactive borrower outreach.",
        urgency: "critical",
      });
    } else if (forecast.paymentRiskScore && forecast.paymentRiskScore > 50) {
      insights.push({
        type: "payment_risk",
        message: "Moderate payment risk. Monitor payment behavior closely.",
        urgency: "medium",
      });
    }

    const health = forecast.paymentHealth as PaymentHealthAnalysis | null;
    if (health?.paymentPattern === "declining") {
      insights.push({
        type: "trend_alert",
        message: "Payment timeliness has been declining. Early intervention recommended.",
        urgency: "high",
      });
    } else if (health?.paymentPattern === "improving") {
      insights.push({
        type: "positive_trend",
        message: "Payment behavior is improving. Consider positive reinforcement.",
        urgency: "low",
      });
    }

    if (totalIncome > 0) {
      const incomeProjections = forecast.projectedIncome as IncomeProjection[];
      const avgProbability = incomeProjections.reduce((sum, p) => sum + p.probability, 0) / incomeProjections.length;
      if (avgProbability < 0.7) {
        insights.push({
          type: "income_uncertainty",
          message: `Average income probability is ${(avgProbability * 100).toFixed(0)}%. Consider contingency planning.`,
          urgency: "medium",
        });
      }
    }

    try {
      const aiInsights = await this.getAIInsights(forecast);
      insights.push(...aiInsights);
    } catch (error) {
    }

    return insights;
  }

  private async getAIInsights(forecast: CashFlowForecast): Promise<ForecastInsight[]> {
    const openai = getOpenAIClient();
    if (!openai) {
      return [];
    }

    try {
      const response = await openai.chat.completions.create({
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a financial analyst specializing in real estate note investing. 
Analyze the cash flow forecast data and provide 1-3 actionable insights.
Return valid JSON array with objects containing: type (string), message (string), urgency (low|medium|high|critical).`,
          },
          {
            role: "user",
            content: JSON.stringify({
              totalProjectedIncome: forecast.totalProjectedIncome,
              totalProjectedExpenses: forecast.totalProjectedExpenses,
              netCashFlow: forecast.netCashFlow,
              paymentRiskScore: forecast.paymentRiskScore,
              paymentHealth: forecast.paymentHealth,
              riskFactors: forecast.riskFactors,
              forecastPeriodMonths: forecast.forecastPeriodMonths,
            }),
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          return parsed.slice(0, 3).map((item: any) => ({
            type: item.type || "ai_insight",
            message: item.message || "",
            urgency: ["low", "medium", "high", "critical"].includes(item.urgency) 
              ? item.urgency 
              : "medium",
          }));
        }
      }
    } catch (error) {
    }
    return [];
  }

  async flagHighRiskNotes(organizationId: number): Promise<Array<{ note: Note; riskScore: number; riskFactors: RiskFactor[] }>> {
    const allNotes = await db
      .select()
      .from(notes)
      .where(and(eq(notes.organizationId, organizationId), eq(notes.status, "active")));

    const highRiskNotes: Array<{ note: Note; riskScore: number; riskFactors: RiskFactor[] }> = [];

    for (const note of allNotes) {
      const riskScore = await this.calculatePaymentRiskScore(note.id, organizationId);
      if (riskScore >= 50) {
        const riskFactors = await this.identifyRiskFactors(note.id, organizationId);
        highRiskNotes.push({ note, riskScore, riskFactors });
      }
    }

    highRiskNotes.sort((a, b) => b.riskScore - a.riskScore);

    return highRiskNotes;
  }

  async getPortfolioCashFlowSummary(organizationId: number): Promise<PortfolioCashFlowSummary> {
    const activeNotes = await db
      .select()
      .from(notes)
      .where(and(eq(notes.organizationId, organizationId), eq(notes.status, "active")));

    const ownedProperties = await db
      .select()
      .from(properties)
      .where(and(eq(properties.organizationId, organizationId), eq(properties.status, "owned")));

    let totalProjectedIncome = 0;
    let totalProjectedExpenses = 0;
    const incomeBySource: Record<string, number> = {};
    const expensesByCategory: Record<string, number> = {};
    const monthlyData: Record<string, { income: number; expenses: number }> = {};

    let totalRiskScore = 0;
    let riskScoreCount = 0;
    let highRiskCount = 0;

    for (const note of activeNotes) {
      const income = await this.projectNoteIncome(note.id, organizationId, 12);
      const expenses = await this.projectExpenses("note", note.id, organizationId, 12);
      const riskScore = await this.calculatePaymentRiskScore(note.id, organizationId);

      totalRiskScore += riskScore;
      riskScoreCount++;
      if (riskScore >= 50) highRiskCount++;

      for (const item of income) {
        const weightedAmount = item.expectedAmount * item.probability;
        totalProjectedIncome += weightedAmount;
        incomeBySource[item.source] = (incomeBySource[item.source] || 0) + weightedAmount;
        
        if (!monthlyData[item.month]) {
          monthlyData[item.month] = { income: 0, expenses: 0 };
        }
        monthlyData[item.month].income += weightedAmount;
      }

      for (const item of expenses) {
        totalProjectedExpenses += item.amount;
        expensesByCategory[item.category] = (expensesByCategory[item.category] || 0) + item.amount;
        
        if (!monthlyData[item.month]) {
          monthlyData[item.month] = { income: 0, expenses: 0 };
        }
        monthlyData[item.month].expenses += item.amount;
      }
    }

    for (const property of ownedProperties) {
      const income = await this.projectPropertyIncome(property.id, organizationId, 12);
      const expenses = await this.projectExpenses("property", property.id, organizationId, 12);

      for (const item of income) {
        const weightedAmount = item.expectedAmount * item.probability;
        totalProjectedIncome += weightedAmount;
        incomeBySource[item.source] = (incomeBySource[item.source] || 0) + weightedAmount;
        
        if (!monthlyData[item.month]) {
          monthlyData[item.month] = { income: 0, expenses: 0 };
        }
        monthlyData[item.month].income += weightedAmount;
      }

      for (const item of expenses) {
        totalProjectedExpenses += item.amount;
        expensesByCategory[item.category] = (expensesByCategory[item.category] || 0) + item.amount;
        
        if (!monthlyData[item.month]) {
          monthlyData[item.month] = { income: 0, expenses: 0 };
        }
        monthlyData[item.month].expenses += item.amount;
      }
    }

    const monthlyBreakdown = Object.entries(monthlyData)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, data]) => ({
        month,
        income: data.income,
        expenses: data.expenses,
        net: data.income - data.expenses,
      }));

    return {
      totalProjectedIncome,
      totalProjectedExpenses,
      netCashFlow: totalProjectedIncome - totalProjectedExpenses,
      incomeBySource,
      expensesByCategory,
      monthlyBreakdown,
      highRiskNoteCount: highRiskCount,
      averagePaymentRiskScore: riskScoreCount > 0 ? totalRiskScore / riskScoreCount : 0,
    };
  }

  async compareActualVsProjected(
    organizationId: number,
    periodMonths: number
  ): Promise<ActualVsProjectedComparison> {
    const cutoffDate = addMonths(new Date(), -periodMonths);

    const historicalForecasts = await db
      .select()
      .from(cashFlowForecasts)
      .where(
        and(
          eq(cashFlowForecasts.organizationId, organizationId),
          gte(cashFlowForecasts.forecastDate, cutoffDate)
        )
      )
      .orderBy(desc(cashFlowForecasts.forecastDate));

    const comparisons: ActualVsProjectedComparison["forecasts"] = [];
    let totalAccuracy = 0;
    let accuracyCount = 0;

    for (const forecast of historicalForecasts) {
      if (!forecast.noteId) continue;

      const forecastEndDate = addMonths(new Date(forecast.forecastDate), forecast.forecastPeriodMonths || 12);

      if (forecastEndDate > new Date()) continue;

      const actualPayments = await db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.noteId, forecast.noteId),
            gte(payments.paymentDate, forecast.forecastDate),
            lte(payments.paymentDate, forecastEndDate),
            eq(payments.status, "completed")
          )
        );

      const actualIncome = actualPayments.reduce(
        (sum, p) => sum + parseFloat(p.amount),
        0
      );
      const projectedIncome = forecast.totalProjectedIncome 
        ? parseFloat(forecast.totalProjectedIncome) 
        : 0;

      const projectedExpenses = forecast.totalProjectedExpenses
        ? parseFloat(forecast.totalProjectedExpenses)
        : 0;

      const variancePercent = projectedIncome > 0
        ? ((actualIncome - projectedIncome) / projectedIncome) * 100
        : 0;

      const accuracy = 100 - Math.min(100, Math.abs(variancePercent));
      totalAccuracy += accuracy;
      accuracyCount++;

      comparisons.push({
        forecastId: forecast.id,
        forecastDate: forecast.forecastDate,
        projectedIncome,
        actualIncome,
        variancePercent,
        projectedExpenses,
        actualExpenses: 0,
        expenseVariancePercent: 0,
      });
    }

    return {
      periodMonths,
      forecasts: comparisons,
      overallAccuracy: accuracyCount > 0 ? totalAccuracy / accuracyCount : 0,
    };
  }

  /**
   * Returns a month-indexed portfolio cash flow timeline for the next N months.
   * Sums income from all active notes + owned properties across every month.
   */
  async getPortfolioTimeline(organizationId: number, months: number = 24): Promise<{
    month: string;
    income: number;
    incomeHigh: number;
    incomeLow: number;
    isBalloon: boolean;
  }[]> {
    const activeNotes = await db
      .select()
      .from(notes)
      .where(and(eq(notes.organizationId, organizationId), eq(notes.status, "active")));

    const ownedProperties = await db
      .select()
      .from(properties)
      .where(and(eq(properties.organizationId, organizationId), eq(properties.status, "owned")));

    // Accumulate income by month string (YYYY-MM)
    const byMonth: Record<string, { income: number; probability: number; count: number; isBalloon: boolean }> = {};

    const addToMonth = (m: string, amount: number, probability: number, isBalloon = false) => {
      if (!byMonth[m]) byMonth[m] = { income: 0, probability: 0, count: 0, isBalloon: false };
      byMonth[m].income += amount * probability;
      byMonth[m].probability += probability;
      byMonth[m].count += 1;
      if (isBalloon) byMonth[m].isBalloon = true;
    };

    for (const note of activeNotes) {
      const projections = await this.projectNoteIncome(note.id, organizationId, months);
      const maturityDate = note.maturityDate ? new Date(note.maturityDate) : null;

      for (const p of projections) {
        const isBalloon = maturityDate
          ? p.month === maturityDate.toISOString().slice(0, 7)
          : false;
        addToMonth(p.month, p.expectedAmount, p.probability, isBalloon);
      }
    }

    for (const property of ownedProperties) {
      const projections = await this.projectPropertyIncome(property.id, organizationId, months);
      for (const p of projections) {
        addToMonth(p.month, p.expectedAmount, p.probability);
      }
    }

    // Build sorted timeline covering the full requested window
    const today = new Date();
    const result = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const key = d.toISOString().slice(0, 7);
      const row = byMonth[key];
      const income = row ? Math.round(row.income) : 0;
      // ±30% uncertainty band widened for low-probability months
      const uncertainty = row && row.count > 0 ? 0.25 : 0.4;
      result.push({
        month: key,
        income,
        incomeHigh: Math.round(income * (1 + uncertainty)),
        incomeLow: Math.round(income * (1 - uncertainty)),
        isBalloon: row?.isBalloon ?? false,
      });
    }

    return result;
  }

  private async logAgentEvent(
    organizationId: number,
    eventType: string,
    payload: Record<string, any>
  ): Promise<void> {
    try {
      await db.insert(agentEvents).values({
        organizationId,
        eventType,
        eventSource: "system",
        payload,
        relatedEntityType: payload.noteId ? "note" : payload.propertyId ? "property" : undefined,
        relatedEntityId: payload.noteId || payload.propertyId,
      });
    } catch (error) {
    }
  }
}

export const cashFlowForecasterService = new CashFlowForecasterService();
