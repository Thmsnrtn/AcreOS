import { db } from '../db';
import { 
  noteSecurities, 
  lenderNetwork,
  capitalRaises,
  deals,
  notes,
  properties 
} from '../../shared/schema';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { logger } from "../utils/logger";

interface NotePooling {
  noteIds: number[];
  totalValue: number;
  avgInterestRate: number;
  avgLTV: number;
  avgMaturity: number;
  diversificationScore: number;
}

interface SecuritizationOffer {
  poolId: string;
  noteCount: number;
  totalPrincipal: number;
  expectedYield: number;
  rating: string;
  minimumInvestment: number;
}

class CapitalMarkets {
  /**
   * Pool seller-financed notes for securitization
   */
  async poolNotes(
    organizationId: number,
    noteIds: number[]
  ): Promise<NotePooling> {
    try {
      const pooledNotes = await db.query.notes.findMany({
        where: and(
          eq(notes.organizationId, organizationId),
          inArray(notes.id, noteIds)
        ),
      });

      if (pooledNotes.length === 0) {
        throw new Error('No valid notes found for pooling');
      }

      // notes.originalPrincipal is the canonical principal column (numeric →
      // returned as a string by drizzle).
      const totalValue = pooledNotes.reduce((sum, n) =>
        sum + Number(n.originalPrincipal || 0), 0
      );

      const avgInterestRate = pooledNotes.reduce((sum, n) =>
        sum + Number(n.interestRate || 0), 0
      ) / pooledNotes.length;

      // TODO(tsc): notes has no ltvRatio column — LTV requires joining the
      // property's market value, which isn't loaded here. Defaulting to 0
      // until an LTV source is wired in.
      const avgLTV = 0;

      // TODO(tsc): notes has no paymentsMade column — payments-made can be
      // derived from the amortizationSchedule (count of status==="paid"), but
      // that is out of scope for this type fix. Approximate remaining term
      // with the full term for now.
      const avgMaturity = pooledNotes.reduce((sum, n) => {
        const termMonths = n.termMonths || 0;
        return sum + termMonths;
      }, 0) / pooledNotes.length;

      // Calculate diversification score (0-100)
      // TODO(tsc): notes has no state column (geography lives on the linked
      // property). Approximate diversity by distinct linked properties.
      const propertySet = new Set(pooledNotes.map(n => n.propertyId).filter(Boolean));
      const diversificationScore = Math.min(100, propertySet.size * 20);

      return {
        noteIds,
        totalValue,
        avgInterestRate,
        avgLTV,
        avgMaturity,
        diversificationScore,
      };
    } catch (error) {
      logger.error('Failed to pool notes', error);
      throw error;
    }
  }

  /**
   * Create securitization offering
   */
  async createSecuritization(
    organizationId: number,
    pooling: NotePooling,
    offeringDetails: {
      minimumInvestment: number;
      targetRaise: number;
      terms: string;
    }
  ): Promise<string> {
    try {
      // Calculate credit rating based on pool characteristics
      const rating = this.calculateCreditRating(pooling);

      // TODO(tsc): note_securities is a per-note securitization record, not a
      // pool/offering table — it has no poolId, noteIds, totalPrincipal,
      // avgInterestRate, avgLTV, rating, minimumInvestment, targetRaise, or
      // raisedAmount columns. The pool's aggregate values are mapped onto the
      // closest real columns; offering-level metadata (rating, targetRaise,
      // etc.) has no home in this schema and is not persisted. A dedicated
      // securitization-offering table (or use of capital_raises) is needed to
      // restore the original intent.
      void rating;
      void offeringDetails;
      const avgTermMonths = pooling.avgMaturity > 0 ? Math.round(pooling.avgMaturity) : 1;
      const [security] = await db.insert(noteSecurities).values({
        organizationId,
        principalAmount: String(pooling.totalValue),
        interestRate: String(pooling.avgInterestRate),
        termMonths: avgTermMonths,
        monthlyPayment: '0',
        status: 'pending',
      }).returning();

      return security.id.toString();
    } catch (error) {
      logger.error('Failed to create securitization', error);
      throw error;
    }
  }

  /**
   * Calculate credit rating for note pool
   */
  private calculateCreditRating(pooling: NotePooling): string {
    let score = 100;

    // Penalize high LTV
    if (pooling.avgLTV > 80) score -= 30;
    else if (pooling.avgLTV > 70) score -= 20;
    else if (pooling.avgLTV > 60) score -= 10;

    // Reward good interest rates (8-12% is optimal)
    if (pooling.avgInterestRate < 6) score -= 20;
    else if (pooling.avgInterestRate > 15) score -= 15;

    // Reward diversification
    score += pooling.diversificationScore * 0.2;

    // Assign rating
    if (score >= 90) return 'AAA';
    if (score >= 80) return 'AA';
    if (score >= 70) return 'A';
    if (score >= 60) return 'BBB';
    if (score >= 50) return 'BB';
    return 'B';
  }

  /**
   * List available securitization offerings
   */
  async listSecurities(
    organizationId: number,
    status?: string
  ): Promise<any[]> {
    try {
      // The org term is UNCONDITIONAL: status only narrows it. The previous
      // shape led with `organizationId && status`, so a falsy org — including
      // the literal 0 this repo has been bitten by before — fell through to a
      // status-only predicate that read every tenant's rows.
      const where = status
        ? and(
            eq(noteSecurities.organizationId, organizationId),
            eq(noteSecurities.status, status)
          )
        : eq(noteSecurities.organizationId, organizationId);

      return await db.query.noteSecurities.findMany({
        where,
        orderBy: [desc(noteSecurities.createdAt)],
      });
    } catch (error) {
      logger.error('Failed to list securities', error);
      return [];
    }
  }

  // investInSecurity was DELETED 2026-08-27 (rule-1 tenancy adjudication).
  // It fetched noteSecurities by raw id with no org check and added an
  // unvalidated amount to current_balance — a loan-performance column — so
  // any org could corrupt any other org's figures once the rails opened. Its
  // own TODO conceded note_securities cannot record an investment. The route
  // now answers 501; see routes-capital-markets.ts for the full story.

  /**
   * Add lender to network
   */
  async addLender(
    organizationId: number,
    lenderData: {
      name: string;
      type: string;
      contactName?: string;
      contactEmail?: string;
      contactPhone?: string;
      minLoanAmount?: number;
      maxLoanAmount?: number;
      minLTV?: number;
      maxLTV?: number;
      interestRateRange?: string;
      terms?: string;
    }
  ): Promise<string> {
    try {
      // TODO(tsc): lender_network has no minLTV, terms, status, dealCount, or
      // totalFunded columns, and interestRateRange is a jsonb { min, max }
      // (not the free-text string the caller passes). Those inputs have no
      // home in the schema and are not persisted. Active state maps to
      // isActive; deal volume maps to loansIssued.
      const [lender] = await db.insert(lenderNetwork).values({
        organizationId,
        lenderName: lenderData.name,
        lenderType: lenderData.type,
        contactName: lenderData.contactName || null,
        contactEmail: lenderData.contactEmail || null,
        contactPhone: lenderData.contactPhone || null,
        minLoanAmount: lenderData.minLoanAmount != null ? String(lenderData.minLoanAmount) : null,
        maxLoanAmount: lenderData.maxLoanAmount != null ? String(lenderData.maxLoanAmount) : null,
        maxLTV: lenderData.maxLTV != null ? String(lenderData.maxLTV) : null,
        isActive: true,
        loansIssued: 0,
      }).returning();

      return lender.id.toString();
    } catch (error) {
      logger.error('Failed to add lender', error);
      throw error;
    }
  }

  /**
   * Get lender network for organization
   */
  async getLenderNetwork(
    organizationId: number,
    filters?: {
      type?: string;
      minAmount?: number;
      maxAmount?: number;
    }
  ): Promise<any[]> {
    try {
      const conditions = [eq(lenderNetwork.organizationId, organizationId)];

      if (filters?.type) {
        conditions.push(eq(lenderNetwork.lenderType, filters.type));
      }

      const lenders = await db.query.lenderNetwork.findMany({
        where: and(...conditions),
        // lender_network has no totalFunded column; loansIssued is the closest
        // volume proxy.
        orderBy: [desc(lenderNetwork.loansIssued)],
      });

      // Filter by amount if specified (numeric columns are returned as strings)
      if (filters?.minAmount || filters?.maxAmount) {
        return lenders.filter(l => {
          if (filters.minAmount && l.maxLoanAmount && Number(l.maxLoanAmount) < filters.minAmount) {
            return false;
          }
          if (filters.maxAmount && l.minLoanAmount && Number(l.minLoanAmount) > filters.maxAmount) {
            return false;
          }
          return true;
        });
      }

      return lenders;
    } catch (error) {
      logger.error('Failed to get lender network', error);
      return [];
    }
  }

  /**
   * Match property to suitable lenders
   */
  async matchLenders(
    organizationId: number,
    propertyId: number,
    loanAmount: number,
    ltv: number
  ): Promise<any[]> {
    try {
      const property = await db.query.properties.findFirst({
        // organizationId is the first parameter of matchLenders; the property
        // it matches lenders against must be the caller's own.
        where: and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)),
      });

      if (!property) {
        throw new Error('Property not found');
      }

      const lenders = await db.query.lenderNetwork.findMany({
        where: and(
          eq(lenderNetwork.organizationId, organizationId),
          eq(lenderNetwork.isActive, true)
        ),
      });

      // Filter lenders that match criteria (numeric columns are strings).
      // TODO(tsc): lender_network has no minLTV column — only maxLTV is
      // enforceable here.
      const matchedLenders = lenders.filter(l => {
        if (l.minLoanAmount && loanAmount < Number(l.minLoanAmount)) return false;
        if (l.maxLoanAmount && loanAmount > Number(l.maxLoanAmount)) return false;
        if (l.maxLTV && ltv > Number(l.maxLTV)) return false;
        return true;
      });

      // Sort by best fit (highest loan volume). lender_network has no
      // dealCount column; loansIssued is the closest proxy.
      return matchedLenders.sort((a, b) => {
        return (b.loansIssued || 0) - (a.loansIssued || 0);
      });
    } catch (error) {
      logger.error('Failed to match lenders', error);
      return [];
    }
  }

  /**
   * Create capital raise campaign
   */
  async createCapitalRaise(
    organizationId: number,
    raiseData: {
      raiseType: string;
      targetAmount: number;
      minimumInvestment: number;
      useOfFunds: string;
      terms: string;
      equityOffered?: number;
    }
  ): Promise<string> {
    try {
      // TODO(tsc): capital_raises has no raiseType (it's offeringType),
      // useOfFunds, terms, equityOffered, or closingDate columns. raiseType
      // maps to offeringType; title is required so we derive one. The other
      // inputs have no home in the schema and are not persisted.
      const [raise] = await db.insert(capitalRaises).values({
        organizationId,
        title: raiseData.useOfFunds?.slice(0, 120) || `${raiseData.raiseType} raise`,
        offeringType: raiseData.raiseType,
        targetAmount: String(raiseData.targetAmount),
        raisedAmount: '0',
        minInvestment: String(raiseData.minimumInvestment),
        investorCount: 0,
        status: 'active',
      }).returning();

      return raise.id.toString();
    } catch (error) {
      logger.error('Failed to create capital raise', error);
      throw error;
    }
  }

  /**
   * Get capital raise campaigns
   */
  async getCapitalRaises(
    organizationId: number,
    status?: string
  ): Promise<any[]> {
    try {
      // The org term is UNCONDITIONAL: status only narrows it. The previous
      // shape led with `organizationId && status`, so a falsy org — including
      // the literal 0 this repo has been bitten by before — fell through to a
      // status-only predicate that read every tenant's rows.
      const where = status
        ? and(
            eq(capitalRaises.organizationId, organizationId),
            eq(capitalRaises.status, status)
          )
        : eq(capitalRaises.organizationId, organizationId);

      return await db.query.capitalRaises.findMany({
        where,
        orderBy: [desc(capitalRaises.createdAt)],
      });
    } catch (error) {
      logger.error('Failed to get capital raises', error);
      return [];
    }
  }

  /**
   * Calculate capital efficiency metrics
   */
  async calculateCapitalEfficiency(organizationId: number): Promise<{
    totalDeployed: number;
    totalReturns: number;
    roi: number;
    leverageRatio: number;
    cashOnCashReturn: number;
  }> {
    try {
      // Query actual deal/payment data for this organization
      const completedDeals = await db.query.deals.findMany({
        where: and(
          eq(deals.organizationId, organizationId),
          eq(deals.status, 'closed')
        ),
      });

      let totalDeployed = 0;
      let totalReturns = 0;

      for (const deal of completedDeals) {
        // deals has no purchasePrice/salePrice columns. The accepted offer is
        // the deployed capital; the expected sale price lives in the ROI
        // analysisResults jsonb.
        const purchasePrice = parseFloat(deal.acceptedAmount || deal.offerAmount || '0');
        const salePrice = Number(deal.analysisResults?.expectedSalePrice ?? 0);
        totalDeployed += purchasePrice;
        if (salePrice > 0) {
          totalReturns += salePrice;
        }
      }

      const roi = totalDeployed > 0 ? ((totalReturns - totalDeployed) / totalDeployed) * 100 : 0;

      return {
        totalDeployed,
        totalReturns,
        roi: Math.round(roi * 100) / 100,
        leverageRatio: 0, // Would need loan/financing data
        cashOnCashReturn: roi, // Simplified — same as ROI without leverage
      };
    } catch (error) {
      logger.error('Failed to calculate capital efficiency', error);
      return {
        totalDeployed: 0,
        totalReturns: 0,
        roi: 0,
        leverageRatio: 0,
        cashOnCashReturn: 0,
      };
    }
  }
}

export const capitalMarkets = new CapitalMarkets();
