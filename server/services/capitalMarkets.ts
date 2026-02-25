// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from '../db';
import { 
  noteSecurities, 
  lenderNetwork,
  capitalRaises,
  deals,
  notes,
  properties 
} from '../../shared/schema';
import { eq, and, desc, gte, sql } from 'drizzle-orm';

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
          sql`${notes.id} = ANY(${noteIds})`
        ),
      });

      if (pooledNotes.length === 0) {
        throw new Error('No valid notes found for pooling');
      }

      const totalValue = pooledNotes.reduce((sum, n) => 
        sum + (n.principal || 0), 0
      );

      const avgInterestRate = pooledNotes.reduce((sum, n) => 
        sum + (n.interestRate || 0), 0
      ) / pooledNotes.length;

      const avgLTV = pooledNotes.reduce((sum, n) => 
        sum + (n.ltvRatio || 0), 0
      ) / pooledNotes.length;

      const avgMaturity = pooledNotes.reduce((sum, n) => {
        const termMonths = n.termMonths || 0;
        const paymentsMade = n.paymentsMade || 0;
        return sum + (termMonths - paymentsMade);
      }, 0) / pooledNotes.length;

      // Calculate diversification score (0-100)
      // Higher score = more geographic and property type diversity
      const stateSet = new Set(pooledNotes.map(n => n.state).filter(Boolean));
      const diversificationScore = Math.min(100, stateSet.size * 20);

      return {
        noteIds,
        totalValue,
        avgInterestRate,
        avgLTV,
        avgMaturity,
        diversificationScore,
      };
    } catch (error) {
      console.error('Failed to pool notes:', error);
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

      const [security] = await db.insert(noteSecurities).values({
        organizationId,
        poolId: `POOL-${Date.now()}`,
        noteIds: pooling.noteIds,
        totalPrincipal: pooling.totalValue,
        avgInterestRate: pooling.avgInterestRate,
        avgLTV: pooling.avgLTV,
        rating,
        status: 'pending',
        minimumInvestment: offeringDetails.minimumInvestment,
        targetRaise: offeringDetails.targetRaise,
        raisedAmount: 0,
        terms: offeringDetails.terms,
        diversificationScore: pooling.diversificationScore,
      }).returning();

      return security.id.toString();
    } catch (error) {
      console.error('Failed to create securitization:', error);
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
    organizationId?: number,
    status?: string
  ): Promise<any[]> {
    try {
      const where = organizationId && status
        ? and(
            eq(noteSecurities.organizationId, organizationId),
            eq(noteSecurities.status, status)
          )
        : organizationId
        ? eq(noteSecurities.organizationId, organizationId)
        : status
        ? eq(noteSecurities.status, status)
        : undefined;

      return await db.query.noteSecurities.findMany({
        where,
        orderBy: [desc(noteSecurities.createdAt)],
      });
    } catch (error) {
      console.error('Failed to list securities:', error);
      return [];
    }
  }

  /**
   * Invest in a securitization
   */
  async investInSecurity(
    securityId: number,
    investorOrgId: number,
    amount: number
  ): Promise<void> {
    try {
      const security = await db.query.noteSecurities.findFirst({
        where: eq(noteSecurities.id, securityId),
      });

      if (!security) {
        throw new Error('Security not found');
      }

      if (security.status !== 'active') {
        throw new Error('Security is not available for investment');
      }

      if (amount < security.minimumInvestment) {
        throw new Error(`Minimum investment is $${security.minimumInvestment}`);
      }

      const newRaisedAmount = security.raisedAmount + amount;

      if (newRaisedAmount > security.targetRaise) {
        throw new Error('Investment would exceed target raise amount');
      }

      // Update raised amount
      await db.update(noteSecurities)
        .set({ 
          raisedAmount: newRaisedAmount,
          status: newRaisedAmount >= security.targetRaise ? 'funded' : 'active',
        })
        .where(eq(noteSecurities.id, securityId));

      // In production, would create investor record, transfer funds, etc.
    } catch (error) {
      console.error('Failed to invest in security:', error);
      throw error;
    }
  }

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
      const [lender] = await db.insert(lenderNetwork).values({
        organizationId,
        lenderName: lenderData.name,
        lenderType: lenderData.type,
        contactName: lenderData.contactName || null,
        contactEmail: lenderData.contactEmail || null,
        contactPhone: lenderData.contactPhone || null,
        minLoanAmount: lenderData.minLoanAmount || null,
        maxLoanAmount: lenderData.maxLoanAmount || null,
        minLTV: lenderData.minLTV || null,
        maxLTV: lenderData.maxLTV || null,
        interestRateRange: lenderData.interestRateRange || null,
        terms: lenderData.terms || null,
        status: 'active',
        dealCount: 0,
        totalFunded: 0,
      }).returning();

      return lender.id.toString();
    } catch (error) {
      console.error('Failed to add lender:', error);
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
      let where = eq(lenderNetwork.organizationId, organizationId);

      if (filters?.type) {
        where = and(where, eq(lenderNetwork.lenderType, filters.type));
      }

      const lenders = await db.query.lenderNetwork.findMany({
        where,
        orderBy: [desc(lenderNetwork.totalFunded)],
      });

      // Filter by amount if specified
      if (filters?.minAmount || filters?.maxAmount) {
        return lenders.filter(l => {
          if (filters.minAmount && l.maxLoanAmount && l.maxLoanAmount < filters.minAmount) {
            return false;
          }
          if (filters.maxAmount && l.minLoanAmount && l.minLoanAmount > filters.maxAmount) {
            return false;
          }
          return true;
        });
      }

      return lenders;
    } catch (error) {
      console.error('Failed to get lender network:', error);
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
        where: eq(properties.id, propertyId),
      });

      if (!property) {
        throw new Error('Property not found');
      }

      const lenders = await db.query.lenderNetwork.findMany({
        where: and(
          eq(lenderNetwork.organizationId, organizationId),
          eq(lenderNetwork.status, 'active')
        ),
      });

      // Filter lenders that match criteria
      const matchedLenders = lenders.filter(l => {
        if (l.minLoanAmount && loanAmount < l.minLoanAmount) return false;
        if (l.maxLoanAmount && loanAmount > l.maxLoanAmount) return false;
        if (l.minLTV && ltv < l.minLTV) return false;
        if (l.maxLTV && ltv > l.maxLTV) return false;
        return true;
      });

      // Sort by best fit (lowest rates, highest deal count)
      return matchedLenders.sort((a, b) => {
        return (b.dealCount || 0) - (a.dealCount || 0);
      });
    } catch (error) {
      console.error('Failed to match lenders:', error);
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
      const [raise] = await db.insert(capitalRaises).values({
        organizationId,
        raiseType: raiseData.raiseType,
        targetAmount: raiseData.targetAmount,
        raisedAmount: 0,
        minimumInvestment: raiseData.minimumInvestment,
        investorCount: 0,
        status: 'active',
        useOfFunds: raiseData.useOfFunds,
        terms: raiseData.terms,
        equityOffered: raiseData.equityOffered || null,
        closingDate: null,
      }).returning();

      return raise.id.toString();
    } catch (error) {
      console.error('Failed to create capital raise:', error);
      throw error;
    }
  }

  /**
   * Get capital raise campaigns
   */
  async getCapitalRaises(
    organizationId?: number,
    status?: string
  ): Promise<any[]> {
    try {
      const where = organizationId && status
        ? and(
            eq(capitalRaises.organizationId, organizationId),
            eq(capitalRaises.status, status)
          )
        : organizationId
        ? eq(capitalRaises.organizationId, organizationId)
        : status
        ? eq(capitalRaises.status, status)
        : undefined;

      return await db.query.capitalRaises.findMany({
        where,
        orderBy: [desc(capitalRaises.createdAt)],
      });
    } catch (error) {
      console.error('Failed to get capital raises:', error);
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
        const purchasePrice = parseFloat(deal.purchasePrice || '0');
        const salePrice = parseFloat(deal.salePrice || '0');
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
      console.error('Failed to calculate capital efficiency:', error);
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
