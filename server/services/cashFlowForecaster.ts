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

    if (!noteId && !propertyId) {
      throw new Error("Either noteId or propertyId must be provided");
    }

    let projectedIncome: IncomeProjection[] = [];
    let projectedExpenses: ExpenseProjection[] = [];
    let paymentRiskScore: number | undefined;
    let riskFactors: RiskFactor[] = [];
    let paymentHealth: PaymentHealthAnalysis | undefined;

    if (noteId) {
      projectedIncome = await this.projectNoteIncome(noteId, periodMonths);
      paymentHealth = await this.analyzePaymentHealth(noteId);
      paymentRiskScore = await this.calculatePaymentRiskScore(noteId);
      riskFactors = await this.identifyRiskFactors(noteId);
      projectedExpenses = await this.projectExpenses("note", noteId, periodMonths);
    }

    if (propertyId) {
      const propertyIncome = await this.projectPropertyIncome(propertyId, periodMonths);
      projectedIncome = [...projectedIncome, ...propertyIncome];
      const propertyExpenses = await this.projectExpenses("property", propertyId, periodMonths);
      projectedExpenses = [...projectedExpenses, ...propertyExpenses];
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

    const insights = await this.generateInsights(forecast.id);
    if (insights.length > 0) {
      await db
        .update(cashFlowForecasts)
        .set({ insights })
        .where(eq(cashFlowForecasts.id, forecast.id));
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

  async projectNoteIncome(noteId: number, months: number): Promise<IncomeProjection[]> {
    const [note] = await db
      .select()
      .from(notes)
      .where(eq(notes.id, noteId));

    if (!note) {
      throw new Error(`Note ${noteId} not found`);
    }

    const paymentHealth = await this.analyzePaymentHealth(noteId);
    const baseProbability = 1 - paymentHealth.defaultProbability;

    const projections: IncomeProjection[] = [];
    const monthlyPayment = parseFloat(note.monthlyPayment);
    const interestRate = parseFloat(note.interestRate) / 100 / 12;
    let currentBalance = parseFloat(note.currentBalance);

    const today = new Date();
    const nextPaymentDate = note.nextPaymentDate ? new Date(note.nextPaymentDate) : new Date(today);

    for (let i = 0; i < months; i++) {
      if (currentBalance <= 0) break;

      const paymentDate = new Date(nextPaymentDate);
      paymentDate.setMonth(paymentDate.getMonth() + i);
      const monthStr = paymentDate.toISOString().slice(0, 7);

      const interestPayment = currentBalance * interestRate;
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

      currentBalance -= principalPayment;
    }

    return projections;
  }

  async projectPropertyIncome(propertyId: number, months: number): Promise<IncomeProjection[]> {
    const [property] = await db
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId));

    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }

    const projections: IncomeProjection[] = [];
    const today = new Date();

    if (property.status === "listed" && property.listPrice) {
      const listPrice = parseFloat(property.listPrice);
      const estimatedSaleMonth = 3;
      const saleDate = new Date(today);
      saleDate.setMonth(saleDate.getMonth() + estimatedSaleMonth);
      
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
          const rentDate = new Date(today);
          rentDate.setMonth(rentDate.getMonth() + i);
          
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
    months: number
  ): Promise<ExpenseProjection[]> {
    const projections: ExpenseProjection[] = [];
    const today = new Date();

    if (entityType === "property") {
      const [property] = await db
        .select()
        .from(properties)
        .where(eq(properties.id, entityId));

      if (property) {
        const assessedValue = property.assessedValue ? parseFloat(property.assessedValue) : 0;
        
        const annualTaxRate = 0.015;
        const monthlyTax = (assessedValue * annualTaxRate) / 12;
        
        const monthlyInsurance = (assessedValue * 0.005) / 12;
        
        const monthlyMaintenance = (assessedValue * 0.01) / 12;

        for (let i = 0; i < months; i++) {
          const expenseDate = new Date(today);
          expenseDate.setMonth(expenseDate.getMonth() + i);
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
        .where(eq(notes.id, entityId));

      if (note) {
        const serviceFee = note.serviceFee ? parseFloat(note.serviceFee) : 0;
        
        for (let i = 0; i < months; i++) {
          const expenseDate = new Date(today);
          expenseDate.setMonth(expenseDate.getMonth() + i);
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

        const paymentHealth = await this.analyzePaymentHealth(entityId);
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

  async analyzePaymentHealth(noteId: number): Promise<PaymentHealthAnalysis> {
    const [note] = await db
      .select()
      .from(notes)
      .where(eq(notes.id, noteId));

    if (!note) {
      throw new Error(`Note ${noteId} not found`);
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

    for (const payment of paymentHistory) {
      if (payment.status === "completed") {
        const dueDate = new Date(payment.dueDate);
        const paymentDate = new Date(payment.paymentDate);
        const daysLate = Math.floor((paymentDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysLate <= (note.gracePeriodDays || 10)) {
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

    const recentPayments = paymentHistory.slice(0, Math.min(6, paymentHistory.length));
    const olderPayments = paymentHistory.slice(Math.min(6, paymentHistory.length));

    const recentLateCount = recentPayments.filter(p => {
      if (p.status !== "completed") return false;
      const daysLate = Math.floor(
        (new Date(p.paymentDate).getTime() - new Date(p.dueDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      return daysLate > (note.gracePeriodDays || 10);
    }).length;

    const olderLateCount = olderPayments.filter(p => {
      if (p.status !== "completed") return false;
      const daysLate = Math.floor(
        (new Date(p.paymentDate).getTime() - new Date(p.dueDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      return daysLate > (note.gracePeriodDays || 10);
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

  async calculatePaymentRiskScore(noteId: number): Promise<number> {
    const health = await this.analyzePaymentHealth(noteId);
    
    const riskScore = Math.round(health.defaultProbability * 100);
    
    return Math.max(0, Math.min(100, riskScore));
  }

  async identifyRiskFactors(noteId: number): Promise<RiskFactor[]> {
    const [note] = await db
      .select()
      .from(notes)
      .where(eq(notes.id, noteId));

    if (!note) {
      throw new Error(`Note ${noteId} not found`);
    }

    const health = await this.analyzePaymentHealth(noteId);
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

  async generateInsights(forecastId: number): Promise<ForecastInsight[]> {
    const [forecast] = await db
      .select()
      .from(cashFlowForecasts)
      .where(eq(cashFlowForecasts.id, forecastId));

    if (!forecast) {
      throw new Error(`Forecast ${forecastId} not found`);
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
        model: "gpt-4o-mini",
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
      const riskScore = await this.calculatePaymentRiskScore(note.id);
      if (riskScore >= 50) {
        const riskFactors = await this.identifyRiskFactors(note.id);
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
      const income = await this.projectNoteIncome(note.id, 12);
      const expenses = await this.projectExpenses("note", note.id, 12);
      const riskScore = await this.calculatePaymentRiskScore(note.id);

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
      const income = await this.projectPropertyIncome(property.id, 12);
      const expenses = await this.projectExpenses("property", property.id, 12);

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
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - periodMonths);

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

      const forecastEndDate = new Date(forecast.forecastDate);
      forecastEndDate.setMonth(forecastEndDate.getMonth() + (forecast.forecastPeriodMonths || 12));

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
