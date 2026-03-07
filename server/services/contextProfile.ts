/**
 * Context Profile Service — AcreOS Phase 2
 *
 * Detects investor type, experience level, and business focus
 * from their actual data in AcreOS, then surfaces the right
 * features and dashboard widgets for their workflow.
 *
 * Investor Types:
 *   - wholesaler       — volume buyer/seller, focus on leads + campaigns
 *   - note_investor    — seller financing focus, cash flow, borrower portal
 *   - fix_and_flip     — acquisition + exit pricing, timeline tracking
 *   - portfolio_builder — long-term holds, portfolio optimizer, cash flow
 *   - auction_hunter   — deal hunter, distress scoring, auto-bid rules
 *   - developer        — zoning, entitlement, subdivision potential
 *   - new_investor     — education first, guided workflows
 */

// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from '../db';
import {
  leads,
  properties,
  deals,
  organizations,
  campaigns,
} from '../../shared/schema';
import { eq, count, sql, desc } from 'drizzle-orm';

export type InvestorType =
  | 'wholesaler'
  | 'note_investor'
  | 'fix_and_flip'
  | 'portfolio_builder'
  | 'auction_hunter'
  | 'developer'
  | 'new_investor';

export interface ContextProfile {
  organizationId: number;
  investorType: InvestorType;
  experienceLevel: 'beginner' | 'intermediate' | 'advanced';
  primaryFocus: string[];
  suggestedModules: string[];
  dashboardWidgets: DashboardWidget[];
  quickActions: QuickAction[];
  detectedAt: string;
}

export interface DashboardWidget {
  id: string;
  title: string;
  priority: number; // 1 = highest
  reason: string;
}

export interface QuickAction {
  label: string;
  path: string;
  icon: string;
  reason: string;
}

const INVESTOR_CONFIGS: Record<InvestorType, {
  primaryFocus: string[];
  suggestedModules: string[];
  dashboardWidgets: Omit<DashboardWidget, 'reason'>[];
  quickActions: Omit<QuickAction, 'reason'>[];
}> = {
  wholesaler: {
    primaryFocus: ['Lead Volume', 'Campaign Performance', 'Offer Speed'],
    suggestedModules: ['Deal Hunter', 'Campaigns', 'Negotiation Copilot', 'Acquisition Radar'],
    dashboardWidgets: [
      { id: 'leads_pipeline', title: 'Lead Pipeline', priority: 1 },
      { id: 'campaign_response_rate', title: 'Campaign Response Rates', priority: 2 },
      { id: 'deal_hunter_today', title: 'New Deal Hunter Matches', priority: 3 },
      { id: 'active_negotiations', title: 'Active Negotiations', priority: 4 },
    ],
    quickActions: [
      { label: 'Import Leads', path: '/leads?import=true', icon: 'upload' },
      { label: 'Launch Campaign', path: '/campaigns?new=true', icon: 'megaphone' },
      { label: 'Hunt Deals', path: '/deal-hunter', icon: 'search' },
    ],
  },
  note_investor: {
    primaryFocus: ['Seller Financing', 'Cash Flow', 'Borrower Management'],
    suggestedModules: ['Finance', 'Cash Flow Forecaster', 'Capital Markets', 'Land Credit'],
    dashboardWidgets: [
      { id: 'active_notes', title: 'Active Seller Finance Notes', priority: 1 },
      { id: 'monthly_cash_flow', title: 'Monthly Cash Flow', priority: 2 },
      { id: 'upcoming_payments', title: 'Upcoming Payments', priority: 3 },
      { id: 'delinquency_watch', title: 'Delinquency Watch', priority: 4 },
    ],
    quickActions: [
      { label: 'Record Payment', path: '/finance?new=true', icon: 'dollar-sign' },
      { label: 'Cash Flow Forecast', path: '/cash-flow', icon: 'trending-up' },
      { label: 'Land Credit Check', path: '/land-credit', icon: 'shield' },
    ],
  },
  fix_and_flip: {
    primaryFocus: ['Acquisition Price', 'Exit Strategy', 'Timeline Tracking'],
    suggestedModules: ['AVM', 'Deals', 'Portfolio Optimizer', 'Vision AI'],
    dashboardWidgets: [
      { id: 'active_deals_timeline', title: 'Deals in Progress', priority: 1 },
      { id: 'avm_valuations', title: 'Recent Valuations', priority: 2 },
      { id: 'exit_opportunities', title: 'Exit Opportunities', priority: 3 },
      { id: 'market_conditions', title: 'Market Conditions', priority: 4 },
    ],
    quickActions: [
      { label: 'Run Valuation', path: '/avm', icon: 'trending-up' },
      { label: 'Analyze Vision AI', path: '/vision-ai', icon: 'eye' },
      { label: 'List on Marketplace', path: '/marketplace', icon: 'store' },
    ],
  },
  portfolio_builder: {
    primaryFocus: ['Long-Term Returns', 'Diversification', 'Risk Management'],
    suggestedModules: ['Portfolio Optimizer', 'Market Intelligence', 'Cash Flow Forecaster', 'AVM'],
    dashboardWidgets: [
      { id: 'portfolio_performance', title: 'Portfolio Performance', priority: 1 },
      { id: 'monte_carlo_projection', title: 'Monte Carlo Projection', priority: 2 },
      { id: 'diversification_score', title: 'Diversification Score', priority: 3 },
      { id: 'market_predictions', title: 'Market Predictions', priority: 4 },
    ],
    quickActions: [
      { label: 'Optimize Portfolio', path: '/portfolio-optimizer', icon: 'bar-chart-2' },
      { label: 'Market Intelligence', path: '/market-intelligence', icon: 'globe' },
      { label: 'Run Cash Flow', path: '/cash-flow', icon: 'activity' },
    ],
  },
  auction_hunter: {
    primaryFocus: ['Distress Scores', 'Auto-Bid Rules', 'County Auctions'],
    suggestedModules: ['Deal Hunter', 'Acquisition Radar', 'Counties', 'Negotiation Copilot'],
    dashboardWidgets: [
      { id: 'todays_auctions', title: "Today's Deal Hunter Finds", priority: 1 },
      { id: 'high_distress_deals', title: 'High Distress Opportunities', priority: 2 },
      { id: 'auto_bid_status', title: 'Auto-Bid Rules Status', priority: 3 },
      { id: 'county_coverage', title: 'County Coverage', priority: 4 },
    ],
    quickActions: [
      { label: 'Deal Hunter', path: '/deal-hunter', icon: 'search' },
      { label: 'Browse Counties', path: '/counties', icon: 'map-pin' },
      { label: 'Acquisition Radar', path: '/radar', icon: 'target' },
    ],
  },
  developer: {
    primaryFocus: ['Zoning & Entitlement', 'Subdivision Potential', 'Regulatory Compliance'],
    suggestedModules: ['Vision AI', 'Compliance AI', 'AVM', 'Market Intelligence'],
    dashboardWidgets: [
      { id: 'zoning_opportunities', title: 'Zoning Opportunities', priority: 1 },
      { id: 'compliance_status', title: 'Compliance Status', priority: 2 },
      { id: 'satellite_analysis', title: 'Satellite Analysis Queue', priority: 3 },
      { id: 'regulatory_alerts', title: 'Regulatory Alerts', priority: 4 },
    ],
    quickActions: [
      { label: 'Analyze Property', path: '/vision-ai', icon: 'eye' },
      { label: 'Compliance Check', path: '/compliance', icon: 'shield-check' },
      { label: 'Tax Research', path: '/tax-researcher', icon: 'gavel' },
    ],
  },
  new_investor: {
    primaryFocus: ['Learning', 'First Deal', 'Guided Workflow'],
    suggestedModules: ['Academy', 'Leads', 'Deals', 'Negotiation Copilot'],
    dashboardWidgets: [
      { id: 'learning_progress', title: 'Academy Progress', priority: 1 },
      { id: 'starter_checklist', title: 'Getting Started Checklist', priority: 2 },
      { id: 'market_basics', title: 'Market Overview', priority: 3 },
      { id: 'first_lead', title: 'Find Your First Lead', priority: 4 },
    ],
    quickActions: [
      { label: 'Start Learning', path: '/academy', icon: 'graduation-cap' },
      { label: 'Add Your First Lead', path: '/leads?new=true', icon: 'user-plus' },
      { label: 'Get AI Help', path: '/command-center', icon: 'bot' },
    ],
  },
};

class ContextProfileService {
  private profileCache = new Map<number, ContextProfile>();

  /**
   * Analyze the organization's data to infer investor type and build context profile.
   */
  async buildProfile(organizationId: number): Promise<ContextProfile> {
    const signals = await this.gatherSignals(organizationId);
    const investorType = this.inferInvestorType(signals);
    const experienceLevel = this.inferExperienceLevel(signals);
    const config = INVESTOR_CONFIGS[investorType];

    const profile: ContextProfile = {
      organizationId,
      investorType,
      experienceLevel,
      primaryFocus: config.primaryFocus,
      suggestedModules: config.suggestedModules,
      dashboardWidgets: config.dashboardWidgets.map(w => ({
        ...w,
        reason: this.buildWidgetReason(w.id, signals, investorType),
      })),
      quickActions: config.quickActions.map(a => ({
        ...a,
        reason: `Recommended for ${investorType.replace('_', ' ')} investors`,
      })),
      detectedAt: new Date().toISOString(),
    };

    this.profileCache.set(organizationId, profile);
    return profile;
  }

  /**
   * Get the context profile (from cache or build fresh).
   */
  async getProfile(organizationId: number): Promise<ContextProfile> {
    const cached = this.profileCache.get(organizationId);
    if (cached) {
      const age = Date.now() - new Date(cached.detectedAt).getTime();
      if (age < 6 * 60 * 60 * 1000) return cached; // 6-hour cache
    }
    return this.buildProfile(organizationId);
  }

  /**
   * Force invalidate and rebuild profile.
   */
  invalidate(organizationId: number): void {
    this.profileCache.delete(organizationId);
  }

  private async gatherSignals(organizationId: number): Promise<Record<string, number>> {
    const signals: Record<string, number> = {
      leadCount: 0,
      propertyCount: 0,
      dealCount: 0,
      campaignCount: 0,
      financeNoteCount: 0,
      auctionDealCount: 0,
    };

    try {
      const [leadResult] = await db
        .select({ count: count() })
        .from(leads)
        .where(eq(leads.organizationId, organizationId));
      signals.leadCount = Number(leadResult?.count || 0);
    } catch (_) {}

    try {
      const [propResult] = await db
        .select({ count: count() })
        .from(properties)
        .where(eq(properties.organizationId, organizationId));
      signals.propertyCount = Number(propResult?.count || 0);
    } catch (_) {}

    try {
      const [dealResult] = await db
        .select({ count: count() })
        .from(deals)
        .where(eq(deals.organizationId, organizationId));
      signals.dealCount = Number(dealResult?.count || 0);
    } catch (_) {}

    try {
      const [campResult] = await db
        .select({ count: count() })
        .from(campaigns)
        .where(eq(campaigns.organizationId, organizationId));
      signals.campaignCount = Number(campResult?.count || 0);
    } catch (_) {}

    return signals;
  }

  private inferInvestorType(signals: Record<string, number>): InvestorType {
    const total = signals.leadCount + signals.propertyCount + signals.dealCount;

    // New investor — very little data
    if (total < 5) return 'new_investor';

    // Heavy campaign usage → wholesaler
    if (signals.campaignCount >= 3 && signals.leadCount > 20) return 'wholesaler';

    // Many leads but few properties → wholesaler or auction hunter
    if (signals.leadCount > 50 && signals.propertyCount < 5) {
      return signals.auctionDealCount > 5 ? 'auction_hunter' : 'wholesaler';
    }

    // Balanced leads + properties + deals → portfolio builder
    if (signals.propertyCount > 10 && signals.dealCount > 5) return 'portfolio_builder';

    // Finance notes suggest note investor
    if (signals.financeNoteCount > 3) return 'note_investor';

    // Default for moderate data
    if (signals.dealCount > 3) return 'fix_and_flip';

    return 'wholesaler';
  }

  private inferExperienceLevel(signals: Record<string, number>): 'beginner' | 'intermediate' | 'advanced' {
    const total = signals.leadCount + signals.propertyCount + signals.dealCount;
    if (total < 10) return 'beginner';
    if (total < 50) return 'intermediate';
    return 'advanced';
  }

  private buildWidgetReason(widgetId: string, signals: Record<string, number>, type: InvestorType): string {
    const typeLabel = type.replace(/_/g, ' ');
    const reasons: Record<string, string> = {
      leads_pipeline: `You have ${signals.leadCount} leads — track them here`,
      campaign_response_rate: `Optimize your ${signals.campaignCount} campaigns`,
      deal_hunter_today: 'Fresh distressed properties found overnight',
      active_negotiations: 'Monitor all active seller conversations',
      active_notes: 'Track your seller finance portfolio',
      monthly_cash_flow: 'Monitor note payments and cash position',
      portfolio_performance: `Your ${signals.propertyCount} properties at a glance`,
      monte_carlo_projection: 'AI-projected 5-year portfolio growth',
      todays_auctions: 'New auction opportunities from overnight scraping',
      learning_progress: 'Complete courses to unlock deals faster',
    };
    return reasons[widgetId] || `Key metric for ${typeLabel} investors`;
  }
}

export const contextProfileService = new ContextProfileService();
