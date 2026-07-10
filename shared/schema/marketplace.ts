// ============================================================================
// SHARED/SCHEMA/MARKETPLACE.TS
// ----------------------------------------------------------------------------
// Marketplace + financial intelligence + capital markets + voice/visual AI +
// AcreOS Academy + regulatory AI + white-label tenants + Stripe webhook dedup.
//
// Includes: marketplace listings/bids, investor profiles, deal rooms,
// marketplace transactions, buyer behavior events, demand heatmaps, portfolio
// simulations, optimization recs, transaction training data, valuation
// predictions, land credit scores, note securities, lender network, capital
// raises, voice calls, property photos + analysis, satellite snapshots,
// courses + modules + enrollments + tutor sessions, regulatory changes +
// compliance alerts, white-label tenants, processed webhook events.
//
// Extracted from shared/schema.ts.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  date,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organizations, properties } from "../schema";

// ============================================
// PHASE 2: NETWORK EFFECTS & MARKETPLACE
// ============================================

// Marketplace Listings - Properties for sale between AcreOS users
export const marketplaceListings = pgTable("marketplace_listings", {
  id: serial("id").primaryKey(),
  
  // Seller info
  sellerOrganizationId: integer("seller_organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Listing details
  listingType: text("listing_type").notNull(), // wholesale, assignment, partnership, note_sale
  title: text("title").notNull(),
  description: text("description"),
  
  // Pricing
  askingPrice: numeric("asking_price").notNull(),
  minAcceptablePrice: numeric("min_acceptable_price"), // private, not shown
  
  // Terms
  closingTimelineDays: integer("closing_timeline_days"),
  isNegotiable: boolean("is_negotiable").default(true),
  acceptsPartnership: boolean("accepts_partnership").default(false),
  partnershipTerms: text("partnership_terms"),
  
  // Visibility
  visibility: text("visibility").notNull().default("public"), // public, private, verified_only
  isPremiumPlacement: boolean("is_premium_placement").default(false),
  premiumExpiresAt: timestamp("premium_expires_at"),
  
  // Status
  status: text("status").notNull().default("active"), // active, under_offer, sold, expired, cancelled
  
  // Metrics
  views: integer("views").default(0),
  favorites: integer("favorites").default(0),
  inquiries: integer("inquiries").default(0),
  
  // Deal protection
  exclusivityPeriod: integer("exclusivity_period"), // hours for accepted offer
  
  expiresAt: timestamp("expires_at"),
  soldAt: timestamp("sold_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("marketplace_listings_seller_idx").on(table.sellerOrganizationId),
  index("marketplace_listings_status_idx").on(table.status),
  index("marketplace_listings_type_idx").on(table.listingType),
]);

export const insertMarketplaceListingSchema = createInsertSchema(marketplaceListings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMarketplaceListing = z.infer<typeof insertMarketplaceListingSchema>;
export type MarketplaceListing = typeof marketplaceListings.$inferSelect;

// Marketplace Bids - Offers on marketplace listings
export const marketplaceBids = pgTable("marketplace_bids", {
  id: serial("id").primaryKey(),
  
  listingId: integer("listing_id").references(() => marketplaceListings.id).notNull(),
  bidderOrganizationId: integer("bidder_organization_id").references(() => organizations.id).notNull(),
  
  bidAmount: numeric("bid_amount").notNull(),
  message: text("message"),
  proposedTerms: text("proposed_terms"),
  
  // Bid type
  bidType: text("bid_type").notNull().default("purchase"), // purchase, partnership, assignment
  partnershipSplit: numeric("partnership_split"), // percentage if partnership
  
  status: text("status").notNull().default("pending"), // pending, accepted, rejected, countered, expired, withdrawn
  
  // Seller response
  sellerResponse: text("seller_response"),
  counterOffer: numeric("counter_offer"),
  respondedAt: timestamp("responded_at"),
  
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("marketplace_bids_listing_idx").on(table.listingId),
  index("marketplace_bids_bidder_idx").on(table.bidderOrganizationId),
  index("marketplace_bids_status_idx").on(table.status),
]);

export const insertMarketplaceBidSchema = createInsertSchema(marketplaceBids).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMarketplaceBid = z.infer<typeof insertMarketplaceBidSchema>;
export type MarketplaceBid = typeof marketplaceBids.$inferSelect;

// Investor Profiles - Public profiles for marketplace trust
export const investorProfiles = pgTable("investor_profiles", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull().unique(),
  
  // Public info
  displayName: text("display_name").notNull(),
  bio: text("bio"),
  location: text("location"),
  website: text("website"),
  
  // Specialization
  specialties: jsonb("specialties").$type<string[]>(), // raw_land, recreational, agricultural
  preferredStates: jsonb("preferred_states").$type<string[]>(),
  investmentRange: jsonb("investment_range").$type<{ min: number; max: number }>(),
  
  // Verification
  isVerified: boolean("is_verified").default(false),
  verifiedAt: timestamp("verified_at"),
  verificationDocuments: jsonb("verification_documents").$type<string[]>(),
  
  // Reputation
  dealsClosed: integer("deals_closed").default(0),
  avgResponseTimeHours: numeric("avg_response_time_hours"),
  reliabilityScore: numeric("reliability_score"), // 0-100
  rating: numeric("rating"), // 0-5
  reviewCount: integer("review_count").default(0),
  
  // Activity
  lastActiveAt: timestamp("last_active_at").defaultNow(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("investor_profiles_verified_idx").on(table.isVerified),
  index("investor_profiles_org_idx").on(table.organizationId),
]);

export const insertInvestorProfileSchema = createInsertSchema(investorProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvestorProfile = z.infer<typeof insertInvestorProfileSchema>;
export type InvestorProfile = typeof investorProfiles.$inferSelect;

// Deal Rooms - Private collaboration spaces
export const dealRooms = pgTable("deal_rooms", {
  id: serial("id").primaryKey(),
  
  listingId: integer("listing_id").references(() => marketplaceListings.id),
  
  // Participants
  participants: jsonb("participants").$type<Array<{
    organizationId: number;
    role: string; // seller, buyer, partner
    joinedAt: string;
  }>>().notNull(),
  
  // Deal details
  dealType: text("deal_type"), // purchase, partnership, joint_venture
  agreedPrice: numeric("agreed_price"),
  dealTerms: text("deal_terms"),
  
  status: text("status").notNull().default("active"), // active, closed, cancelled
  
  // Documents
  sharedDocuments: jsonb("shared_documents").$type<Array<{
    name: string;
    url: string;
    uploadedBy: number;
    uploadedAt: string;
  }>>(),
  
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),

  // FW-MIREILLE-1 (push-forward 2026-05-08): deal-room growth-loop retrofit.
  // Mireille's lead: deal-rooms are the only viable acquisition loop on the
  // platform. Operator opts in by generating a publicShareSlug; an
  // unauthenticated viewer hits /deal-rooms/share/:slug, sees a sanitized
  // view (no PII, no internal notes), and gets a signup CTA. View count
  // tracked for share→signup loop conversion measurement.
  publicShareSlug: text("public_share_slug").unique(),
  publicShareEnabledAt: timestamp("public_share_enabled_at"),
  publicViewCount: integer("public_view_count").notNull().default(0),
});

export const insertDealRoomSchema = createInsertSchema(dealRooms).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDealRoom = z.infer<typeof insertDealRoomSchema>;
export type DealRoom = typeof dealRooms.$inferSelect;

// Marketplace Transactions - Completed deals with fees
export const marketplaceTransactions = pgTable("marketplace_transactions", {
  id: serial("id").primaryKey(),
  
  listingId: integer("listing_id").references(() => marketplaceListings.id).notNull(),
  sellerOrganizationId: integer("seller_organization_id").references(() => organizations.id).notNull(),
  buyerOrganizationId: integer("buyer_organization_id").references(() => organizations.id).notNull(),
  
  transactionType: text("transaction_type").notNull(), // wholesale, partnership, assignment
  
  // Financial details
  salePrice: numeric("sale_price").notNull(),
  platformFeePercent: numeric("platform_fee_percent").notNull().default("1.5"),
  platformFeeCents: integer("platform_fee_cents").notNull(),
  
  // Payment processing
  sellerPayoutStatus: text("seller_payout_status").notNull().default("pending"), // pending, processing, completed, failed
  sellerPayoutAmount: numeric("seller_payout_amount"),
  sellerStripeTransferId: text("seller_stripe_transfer_id"),
  
  // Status
  status: text("status").notNull().default("pending"), // pending, completed, refunded, disputed
  
  closingDate: timestamp("closing_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("marketplace_transactions_seller_idx").on(table.sellerOrganizationId),
  index("marketplace_transactions_buyer_idx").on(table.buyerOrganizationId),
  index("marketplace_transactions_status_idx").on(table.status),
]);

export const insertMarketplaceTransactionSchema = createInsertSchema(marketplaceTransactions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMarketplaceTransaction = z.infer<typeof insertMarketplaceTransactionSchema>;
export type MarketplaceTransaction = typeof marketplaceTransactions.$inferSelect;

// Buyer Behavior Events - Anonymized tracking for intelligence network
export const buyerBehaviorEvents = pgTable("buyer_behavior_events", {
  id: serial("id").primaryKey(),
  
  // Anonymized identifier (NOT organizationId)
  anonymousId: text("anonymous_id").notNull(), // hash of orgId
  
  eventType: text("event_type").notNull(), // view, favorite, inquiry, bid, purchase
  
  // Property characteristics (NOT specific property)
  propertyType: text("property_type"),
  acreageRange: text("acreage_range"),
  priceRange: text("price_range"),
  
  // Location (county level only)
  state: text("state"),
  county: text("county"),
  
  eventDate: timestamp("event_date").notNull().defaultNow(),
  
  // Aggregate only, no PII
  metadata: jsonb("metadata").$type<{
    timeOnPage?: number;
    deviceType?: string;
  }>(),
}, (table) => [
  index("buyer_behavior_state_county_idx").on(table.state, table.county),
  index("buyer_behavior_type_idx").on(table.eventType),
  index("buyer_behavior_date_idx").on(table.eventDate),
]);

export const insertBuyerBehaviorEventSchema = createInsertSchema(buyerBehaviorEvents).omit({ id: true });
export type InsertBuyerBehaviorEvent = z.infer<typeof insertBuyerBehaviorEventSchema>;
export type BuyerBehaviorEvent = typeof buyerBehaviorEvents.$inferSelect;

// Demand Heatmaps - Pre-computed geographic demand
export const demandHeatmaps = pgTable("demand_heatmaps", {
  id: serial("id").primaryKey(),
  
  state: text("state").notNull(),
  county: text("county").notNull(),
  
  // Time period
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  
  // Demand metrics
  demandScore: integer("demand_score").notNull(), // 0-100
  viewCount: integer("view_count").default(0),
  inquiryCount: integer("inquiry_count").default(0),
  bidCount: integer("bid_count").default(0),
  purchaseCount: integer("purchase_count").default(0),
  
  // Price insights
  avgBidToAskRatio: numeric("avg_bid_to_ask_ratio"),
  competitionLevel: text("competition_level"), // low, medium, high
  
  // Trends
  demandTrend: text("demand_trend"), // increasing, stable, decreasing
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("demand_heatmaps_state_county_idx").on(table.state, table.county),
  index("demand_heatmaps_score_idx").on(table.demandScore),
]);

export const insertDemandHeatmapSchema = createInsertSchema(demandHeatmaps).omit({ id: true, createdAt: true });
export type InsertDemandHeatmap = z.infer<typeof insertDemandHeatmapSchema>;
export type DemandHeatmap = typeof demandHeatmaps.$inferSelect;

// ============================================
// PHASE 3: FINANCIAL INTELLIGENCE
// ============================================

// Portfolio Simulations - Monte Carlo analysis results
export const portfolioSimulations = pgTable("portfolio_simulations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  name: text("name").notNull(),
  description: text("description"),
  
  // Simulation parameters
  iterations: integer("iterations").notNull().default(10000),
  timeHorizonMonths: integer("time_horizon_months").notNull(),
  
  assumptions: jsonb("assumptions").$type<{
    appreciationRate?: { min: number; max: number; likely: number };
    dispositionRate?: { min: number; max: number; likely: number };
    defaultRate?: { min: number; max: number; likely: number };
    marketVolatility?: number;
  }>(),
  
  // Results
  results: jsonb("results").$type<{
    portfolioValue: { p10: number; p50: number; p90: number };
    totalReturn: { p10: number; p50: number; p90: number };
    cashFlow: { p10: number; p50: number; p90: number };
    riskOfLoss: number; // percentage
  }>(),
  
  status: text("status").notNull().default("pending"), // pending, running, completed, failed
  
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("portfolio_simulations_org_idx").on(table.organizationId),
  index("portfolio_simulations_status_idx").on(table.status),
]);

export const insertPortfolioSimulationSchema = createInsertSchema(portfolioSimulations).omit({ id: true, createdAt: true });
export type InsertPortfolioSimulation = z.infer<typeof insertPortfolioSimulationSchema>;
export type PortfolioSimulation = typeof portfolioSimulations.$inferSelect;

// Optimization Recommendations - AI suggestions for portfolio
export const optimizationRecommendations = pgTable("optimization_recommendations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  recommendationType: text("recommendation_type").notNull(), // diversification, tax_optimization, cash_flow, risk_reduction
  title: text("title").notNull(),
  description: text("description").notNull(),
  reasoning: text("reasoning").notNull(),
  
  priority: text("priority").notNull().default("medium"), // low, medium, high, critical
  
  // Estimated impact
  estimatedImpact: jsonb("estimated_impact").$type<{
    returnIncrease?: number; // percentage
    riskReduction?: number; // percentage
    taxSavings?: number; // dollars
    cashFlowImprovement?: number; // dollars per month
  }>(),
  
  // Action items
  actionItems: jsonb("action_items").$type<Array<{
    action: string;
    propertyId?: number;
    estimatedCost?: number;
  }>>(),
  
  status: text("status").notNull().default("new"), // new, reviewed, implemented, dismissed
  
  reviewedAt: timestamp("reviewed_at"),
  implementedAt: timestamp("implemented_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("optimization_recommendations_org_idx").on(table.organizationId),
  index("optimization_recommendations_type_idx").on(table.recommendationType),
  index("optimization_recommendations_status_idx").on(table.status),
]);

export const insertOptimizationRecommendationSchema = createInsertSchema(optimizationRecommendations).omit({ id: true, createdAt: true });
export type InsertOptimizationRecommendation = z.infer<typeof insertOptimizationRecommendationSchema>;
export type OptimizationRecommendation = typeof optimizationRecommendations.$inferSelect;

// Transaction Training Data - Anonymized for valuation model
export const transactionTraining = pgTable("transaction_training", {
  id: serial("id").primaryKey(),
  
  // Anonymized (no orgId)
  transactionHash: text("transaction_hash").notNull().unique(),
  
  // Location
  state: text("state").notNull(),
  county: text("county").notNull(),
  
  // Property characteristics
  propertyType: text("property_type").notNull(),
  sizeAcres: numeric("size_acres").notNull(),
  zoning: text("zoning"),
  
  // Features (from DataSourceBroker)
  hasRoadAccess: boolean("has_road_access"),
  hasUtilities: boolean("has_utilities"),
  hasWater: boolean("has_water"),
  floodZone: text("flood_zone"),
  hasWetlands: boolean("has_wetlands"),
  soilQuality: text("soil_quality"),
  
  // Economic context
  countyMedianIncome: numeric("county_median_income"),
  populationDensity: numeric("population_density"),
  distanceToMetro: numeric("distance_to_metro"), // miles
  
  // Transaction
  salePrice: numeric("sale_price").notNull(),
  pricePerAcre: numeric("price_per_acre").notNull(),
  saleDate: timestamp("sale_date").notNull(),
  
  // Quality indicators
  dataQuality: text("data_quality").notNull(), // high, medium, low
  isOutlier: boolean("is_outlier").default(false),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("transaction_training_state_county_idx").on(table.state, table.county),
  index("transaction_training_type_idx").on(table.propertyType),
  index("transaction_training_date_idx").on(table.saleDate),
]);

export const insertTransactionTrainingSchema = createInsertSchema(transactionTraining).omit({ id: true, createdAt: true });
export type InsertTransactionTraining = z.infer<typeof insertTransactionTrainingSchema>;
export type TransactionTraining = typeof transactionTraining.$inferSelect;

// Valuation Predictions - Cached AcreOS Market Value predictions
export const valuationPredictions = pgTable("valuation_predictions", {
  id: serial("id").primaryKey(),
  
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Prediction
  predictedValue: numeric("predicted_value").notNull(),
  confidenceScore: numeric("confidence_score").notNull(), // 0-100
  valueRange: jsonb("value_range").$type<{ low: number; high: number }>(),
  
  // Model info
  modelVersion: text("model_version").notNull(),
  featuresUsed: jsonb("features_used").$type<string[]>(),
  
  // Comparables
  comparableCount: integer("comparable_count"),
  
  validUntil: timestamp("valid_until").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("valuation_predictions_property_idx").on(table.propertyId),
  index("valuation_predictions_valid_idx").on(table.validUntil),
]);

export const insertValuationPredictionSchema = createInsertSchema(valuationPredictions).omit({ id: true, createdAt: true });
export type InsertValuationPrediction = z.infer<typeof insertValuationPredictionSchema>;
export type ValuationPrediction = typeof valuationPredictions.$inferSelect;

// Land Credit Scores - Multi-dimensional property scoring
export const landCreditScores = pgTable("land_credit_scores", {
  id: serial("id").primaryKey(),

  propertyId: integer("property_id").references(() => properties.id).notNull(),

  // Parcel identity (migration 0152, Tier 2A) — scores used to be reachable
  // only through the org-owned property row, which made network cohort
  // benchmarks impossible without walking org structure. apn/state/county let
  // cohorts ("all scored parcels in this state") be assembled from parcel
  // identity alone, with no org linkage in the cohort path. Nullable: rows
  // written before 0152 stay NULL and are simply excluded from cohorts.
  apn: text("apn"),
  state: text("state"),
  county: text("county"),

  // Core scores (0-100)
  liquidityScore: integer("liquidity_score").notNull(),
  riskScore: integer("risk_score").notNull(),
  developmentPotentialScore: integer("development_potential_score").notNull(),
  marketabilityScore: integer("marketability_score").notNull(),
  
  // Overall grade
  overallScore: integer("overall_score").notNull(),
  grade: text("grade").notNull(), // A+, A, B+, B, C+, C, D, F
  
  // Detailed breakdown. Outcome loop (S2a): rows now persist the canonical
  // six-dimension breakdown (numeric top-level dims + a rich `factors`
  // object for the calibrator) alongside the legacy display keys. Older rows
  // carry only the legacy shape — readers must treat every key as optional.
  scoreBreakdown: jsonb("score_breakdown").$type<{
    location: number;
    physical?: number;
    legal?: number;
    financial?: number;
    environmental?: number;
    market?: number;
    factors?: Record<string, { score: number; weight: number }>;
    characteristics: number;
    marketDemand: number;
    economicFactors: number;
    timeOnMarket: number;
  }>(),
  
  modelVersion: text("model_version").notNull(),
  validUntil: timestamp("valid_until").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("land_credit_scores_property_idx").on(table.propertyId),
  index("land_credit_scores_grade_idx").on(table.grade),
  // Cohort assembly path (migration 0152): benchmarks group by state/county.
  index("land_credit_scores_state_county_idx").on(table.state, table.county, table.apn),
]);

export const insertLandCreditScoreSchema = createInsertSchema(landCreditScores).omit({ id: true, createdAt: true });
export type InsertLandCreditScore = z.infer<typeof insertLandCreditScoreSchema>;
export type LandCreditScore = typeof landCreditScores.$inferSelect;

// ===========================
// PHASE 3: CAPITAL MARKETS
// ===========================

// Note Securities - Seller financing securitization
export const noteSecurities = pgTable("note_securities", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  propertyId: integer("property_id").references(() => properties.id),
  
  // Note details
  principalAmount: numeric("principal_amount").notNull(),
  interestRate: numeric("interest_rate").notNull(),
  termMonths: integer("term_months").notNull(),
  monthlyPayment: numeric("monthly_payment").notNull(),
  
  // Securitization
  isSecuritized: boolean("is_securitized").default(false),
  securitizationDate: timestamp("securitization_date"),
  investorId: text("investor_id"),
  purchasePrice: numeric("purchase_price"),
  discount: numeric("discount"), // % discount from face value
  
  // Performance
  paymentsReceived: integer("payments_received").default(0),
  totalPaymentsDue: integer("total_payments_due"),
  currentBalance: numeric("current_balance"),
  delinquentDays: integer("delinquent_days").default(0),
  
  status: text("status").notNull(), // performing, delinquent, default, paid_off
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("note_securities_org_idx").on(table.organizationId),
  index("note_securities_investor_idx").on(table.investorId),
  index("note_securities_status_idx").on(table.status),
]);

export const insertNoteSecuritySchema = createInsertSchema(noteSecurities).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNoteSecurity = z.infer<typeof insertNoteSecuritySchema>;
export type NoteSecurity = typeof noteSecurities.$inferSelect;

// Lender Network - Connect with institutional lenders
export const lenderNetwork = pgTable("lender_network", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  lenderName: text("lender_name").notNull(),
  lenderType: text("lender_type").notNull(), // bank, private_lender, hard_money, institutional
  
  // Lending criteria
  minLoanAmount: numeric("min_loan_amount"),
  maxLoanAmount: numeric("max_loan_amount"),
  maxLTV: numeric("max_ltv"), // Loan-to-value %
  minCreditScore: integer("min_credit_score"),
  
  // Terms
  interestRateRange: jsonb("interest_rate_range").$type<{ min: number; max: number }>(),
  typicalTermMonths: integer("typical_term_months"),
  
  // Specializations
  propertyTypes: jsonb("property_types").$type<string[]>(),
  states: jsonb("states").$type<string[]>(),
  
  // Contact
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  
  // Performance
  loansIssued: integer("loans_issued").default(0),
  avgClosingDays: integer("avg_closing_days"),
  approvalRate: numeric("approval_rate"),
  
  isActive: boolean("is_active").default(true),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("lender_network_org_idx").on(table.organizationId),
  index("lender_network_type_idx").on(table.lenderType),
]);

export const insertLenderNetworkSchema = createInsertSchema(lenderNetwork).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLenderNetwork = z.infer<typeof insertLenderNetworkSchema>;
export type LenderNetwork = typeof lenderNetwork.$inferSelect;

// Capital Raises - Syndication and fund raising
export const capitalRaises = pgTable("capital_raises", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  title: text("title").notNull(),
  description: text("description"),
  
  // Raise details
  targetAmount: numeric("target_amount").notNull(),
  raisedAmount: numeric("raised_amount").default("0"),
  minInvestment: numeric("min_investment").notNull(),
  
  // Terms
  offeringType: text("offering_type").notNull(), // equity, debt, preferred
  returnStructure: text("return_structure"), // profit_share, interest, appreciation
  targetReturn: numeric("target_return"),
  holdPeriod: integer("hold_period"), // months
  
  // Properties
  propertyIds: jsonb("property_ids").$type<number[]>(),
  
  // Investors
  investorCount: integer("investor_count").default(0),
  investors: jsonb("investors").$type<{ userId: number; amount: number; date: string }[]>(),
  
  status: text("status").notNull(), // draft, active, funded, closed
  
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("capital_raises_org_idx").on(table.organizationId),
  index("capital_raises_status_idx").on(table.status),
]);

export const insertCapitalRaiseSchema = createInsertSchema(capitalRaises).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCapitalRaise = z.infer<typeof insertCapitalRaiseSchema>;
export type CapitalRaise = typeof capitalRaises.$inferSelect;

// ===========================
// PHASE 4: VOICE & VISUAL AI
// ===========================

// Voice Calls - AI voice agent call logs
export const voiceCalls = pgTable("voice_calls", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // Call details
  callSid: text("call_sid").unique(),
  direction: text("direction").notNull(), // inbound, outbound
  fromNumber: text("from_number"),
  toNumber: text("to_number"),
  
  // Contact
  contactId: integer("contact_id"),
  leadId: integer("lead_id"),
  propertyId: integer("property_id"),
  
  // Call metrics
  durationSeconds: integer("duration_seconds"),
  callStatus: text("call_status"), // ringing, in-progress, completed, failed
  
  // AI agent
  agentType: text("agent_type").notNull(), // pax, pax, custom
  agentObjective: text("agent_objective"), // qualify_lead, schedule_showing, answer_questions
  
  // Results
  wasAnswered: boolean("was_answered"),
  sentimentScore: numeric("sentiment_score"), // -1 to 1
  motivationScore: numeric("motivation_score"), // 0 to 1 — seller motivation confidence
  objectiveAchieved: boolean("objective_achieved"),

  // Outcome tagging (also mirrored to agent_events for the activity feed).
  outcome: text("outcome"), // e.g. interested, not_interested, callback, wrong_number, voicemail
  outcomeNotes: text("outcome_notes"),
  intent: text("intent"), // detected caller intent, surfaced in the post-call summary
  updatedAt: timestamp("updated_at"),

  // Follow-up
  actionItems: jsonb("action_items").$type<string[]>(),
  scheduledAppointment: timestamp("scheduled_appointment"),
  
  recordingUrl: text("recording_url"),
  transcriptId: integer("transcript_id"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("voice_calls_org_idx").on(table.organizationId),
  index("voice_calls_contact_idx").on(table.contactId),
  index("voice_calls_date_idx").on(table.createdAt),
]);

export const insertVoiceCallSchema = createInsertSchema(voiceCalls).omit({ id: true, createdAt: true });
export type InsertVoiceCall = z.infer<typeof insertVoiceCallSchema>;
export type VoiceCall = typeof voiceCalls.$inferSelect;

// Call Transcripts - Full conversation transcription (DUPLICATE - ALREADY EXISTS ABOVE)
// Using existing callTranscripts table definition from earlier in file

// Property Photos - Visual assets for properties
export const propertyPhotos = pgTable("property_photos", {
  id: serial("id").primaryKey(),
  
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Image details
  url: text("url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  storageKey: text("storage_key").notNull(),
  
  // Metadata
  filename: text("filename"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  width: integer("width"),
  height: integer("height"),
  
  // Organization
  sortOrder: integer("sort_order").default(0),
  isPrimary: boolean("is_primary").default(false),
  category: text("category"), // aerial, street, feature, misc
  
  // Capture info
  capturedAt: timestamp("captured_at"),
  capturedBy: text("captured_by"), // drone, camera, satellite, street_view
  gpsCoordinates: jsonb("gps_coordinates").$type<{ lat: number; lng: number }>(),
  
  // AI analysis
  hasAnalysis: boolean("has_analysis").default(false),
  analysisId: integer("analysis_id"),
  
  uploadedBy: text("uploaded_by"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("property_photos_property_idx").on(table.propertyId),
  index("property_photos_primary_idx").on(table.isPrimary),
]);

export const insertPropertyPhotoSchema = createInsertSchema(propertyPhotos).omit({ id: true, createdAt: true });
export type InsertPropertyPhoto = z.infer<typeof insertPropertyPhotoSchema>;
export type PropertyPhoto = typeof propertyPhotos.$inferSelect;

// Photo Analysis - OpenAI Vision API analysis
export const photoAnalysis = pgTable("photo_analysis", {
  id: serial("id").primaryKey(),
  
  photoId: integer("photo_id").references(() => propertyPhotos.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Vision API results
  detectedFeatures: jsonb("detected_features").$type<string[]>(),
  landscapeType: text("landscape_type"), // forest, grassland, desert, mixed
  buildingDetected: boolean("building_detected"),
  roadDetected: boolean("road_detected"),
  waterDetected: boolean("water_detected"),
  
  // Quality assessment
  photoQuality: text("photo_quality"), // excellent, good, fair, poor
  isUsableForMarketing: boolean("is_usable_for_marketing"),
  
  // Detailed analysis
  aiDescription: text("ai_description"),
  estimatedAcreageVisible: numeric("estimated_acreage_visible"),
  vegetationDensity: numeric("vegetation_density"), // 0-100
  
  // Comparison
  similarPhotos: jsonb("similar_photos").$type<number[]>(), // Other photo IDs
  
  modelVersion: text("model_version"),
  confidence: numeric("confidence"), // 0-100
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("photo_analysis_photo_idx").on(table.photoId),
  index("photo_analysis_property_idx").on(table.propertyId),
]);

export const insertPhotoAnalysisSchema = createInsertSchema(photoAnalysis).omit({ id: true, createdAt: true });
export type InsertPhotoAnalysis = z.infer<typeof insertPhotoAnalysisSchema>;
export type PhotoAnalysis = typeof photoAnalysis.$inferSelect;

// Satellite Snapshots - Regular satellite imagery monitoring
export const satelliteSnapshots = pgTable("satellite_snapshots", {
  id: serial("id").primaryKey(),
  
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  
  // Imagery
  imageUrl: text("image_url").notNull(),
  provider: text("provider"), // google, mapbox, sentinel
  resolution: numeric("resolution"), // meters per pixel
  
  // Timing
  captureDate: timestamp("capture_date").notNull(),
  cloudCoverage: numeric("cloud_coverage"), // %
  
  // Analysis
  changeDetected: boolean("change_detected").default(false),
  changeType: text("change_type"), // vegetation, construction, clearing
  changeSeverity: text("change_severity"), // minor, moderate, major
  
  // Comparison
  comparedToSnapshotId: integer("compared_to_snapshot_id"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("satellite_snapshots_property_idx").on(table.propertyId),
  index("satellite_snapshots_date_idx").on(table.captureDate),
]);

export const insertSatelliteSnapshotSchema = createInsertSchema(satelliteSnapshots).omit({ id: true, createdAt: true });
export type InsertSatelliteSnapshot = z.infer<typeof insertSatelliteSnapshotSchema>;
export type SatelliteSnapshot = typeof satelliteSnapshots.$inferSelect;

// ===========================
// PHASE 5: ACREOS ACADEMY
// ===========================

// Courses - Educational content
export const courses = pgTable("courses", {
  id: serial("id").primaryKey(),
  
  // Content
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull(), // beginner, intermediate, advanced, specialty
  difficultyLevel: integer("difficulty_level"), // 1-5
  
  // Media
  thumbnailUrl: text("thumbnail_url"),
  previewVideoUrl: text("preview_video_url"),
  
  // Structure
  moduleCount: integer("module_count").default(0),
  totalDurationMinutes: integer("total_duration_minutes"),
  
  // Pricing
  price: numeric("price").notNull(),
  discountedPrice: numeric("discounted_price"),
  
  // Instructor
  instructorName: text("instructor_name"),
  instructorBio: text("instructor_bio"),
  
  // Status
  isPublished: boolean("is_published").default(false),
  publishedAt: timestamp("published_at"),
  
  // Analytics
  enrollmentCount: integer("enrollment_count").default(0),
  completionRate: numeric("completion_rate"),
  avgRating: numeric("avg_rating"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("courses_category_idx").on(table.category),
  index("courses_published_idx").on(table.isPublished),
]);

export const insertCourseSchema = createInsertSchema(courses).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCourse = z.infer<typeof insertCourseSchema>;
export type Course = typeof courses.$inferSelect;

// Course Modules - Lessons within courses
export const courseModules = pgTable("course_modules", {
  id: serial("id").primaryKey(),
  
  courseId: integer("course_id").references(() => courses.id).notNull(),
  
  title: text("title").notNull(),
  description: text("description"),
  
  // Content
  contentType: text("content_type").notNull(), // video, text, quiz, interactive
  videoUrl: text("video_url"),
  content: text("content"),
  
  // Structure
  sortOrder: integer("sort_order").notNull(),
  durationMinutes: integer("duration_minutes"),
  
  // Requirements
  isPreview: boolean("is_preview").default(false), // Free preview
  requiredScore: integer("required_score"), // For quizzes
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("course_modules_course_idx").on(table.courseId),
]);

export const insertCourseModuleSchema = createInsertSchema(courseModules).omit({ id: true, createdAt: true });
export type InsertCourseModule = z.infer<typeof insertCourseModuleSchema>;
export type CourseModule = typeof courseModules.$inferSelect;

// Course Enrollments - Student registrations
export const courseEnrollments = pgTable("course_enrollments", {
  id: serial("id").primaryKey(),
  
  userId: text("user_id").notNull(),
  courseId: integer("course_id").references(() => courses.id).notNull(),
  
  // Progress
  completedModules: jsonb("completed_modules").$type<number[]>(),
  progressPercentage: numeric("progress_percentage").default("0"),
  
  // Completion
  isCompleted: boolean("is_completed").default(false),
  completedAt: timestamp("completed_at"),
  
  // Certificate
  certificateIssued: boolean("certificate_issued").default(false),
  certificateUrl: text("certificate_url"),
  
  // Payment
  amountPaid: numeric("amount_paid"),
  paymentStatus: text("payment_status"), // pending, paid, refunded
  
  // Engagement
  lastAccessedAt: timestamp("last_accessed_at"),
  totalTimeMinutes: integer("total_time_minutes").default(0),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("course_enrollments_user_idx").on(table.userId),
  index("course_enrollments_course_idx").on(table.courseId),
]);

export const insertCourseEnrollmentSchema = createInsertSchema(courseEnrollments).omit({ id: true, createdAt: true });
export type InsertCourseEnrollment = z.infer<typeof insertCourseEnrollmentSchema>;
export type CourseEnrollment = typeof courseEnrollments.$inferSelect;

// Tutor Sessions - AI tutor interactions
export const tutorSessions = pgTable("tutor_sessions", {
  id: serial("id").primaryKey(),
  
  userId: text("user_id").notNull(),
  courseId: integer("course_id").references(() => courses.id),
  
  // Session
  topic: text("topic"),
  messages: jsonb("messages").$type<{ role: string; content: string; timestamp: string }[]>(),
  
  // Metrics
  messageCount: integer("message_count").default(0),
  durationMinutes: integer("duration_minutes"),
  
  // Outcomes
  questionAnswered: boolean("question_answered"),
  satisfactionRating: integer("satisfaction_rating"), // 1-5
  
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("tutor_sessions_user_idx").on(table.userId),
]);

export const insertTutorSessionSchema = createInsertSchema(tutorSessions).omit({ id: true, createdAt: true });
export type InsertTutorSession = z.infer<typeof insertTutorSessionSchema>;
export type TutorSession = typeof tutorSessions.$inferSelect;

// ===========================
// PHASE 5: REGULATORY AI
// ===========================

// Regulatory Changes - Zoning & compliance monitoring
export const regulatoryChanges = pgTable("regulatory_changes", {
  id: serial("id").primaryKey(),
  
  // Location
  state: text("state").notNull(),
  county: text("county").notNull(),
  municipality: text("municipality"),
  
  // Change details
  changeType: text("change_type").notNull(), // zoning, tax, environmental, building_code
  title: text("title").notNull(),
  description: text("description"),
  
  // Impact
  impactLevel: text("impact_level"), // high, medium, low
  affectedProperties: jsonb("affected_properties").$type<number[]>(),
  
  // Timing
  effectiveDate: timestamp("effective_date"),
  proposedDate: timestamp("proposed_date"),
  
  // Source
  sourceUrl: text("source_url"),
  sourceDocument: text("source_document"),
  
  // Status
  status: text("status"), // proposed, approved, active, repealed
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("regulatory_changes_location_idx").on(table.state, table.county),
  index("regulatory_changes_type_idx").on(table.changeType),
  index("regulatory_changes_date_idx").on(table.effectiveDate),
]);

export const insertRegulatoryChangeSchema = createInsertSchema(regulatoryChanges).omit({ id: true, createdAt: true });
export type InsertRegulatoryChange = z.infer<typeof insertRegulatoryChangeSchema>;
export type RegulatoryChange = typeof regulatoryChanges.$inferSelect;

// Compliance Alerts - Property-specific alerts
export const complianceAlerts = pgTable("compliance_alerts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  regulatoryChangeId: integer("regulatory_change_id").references(() => regulatoryChanges.id),
  
  // Alert
  alertType: text("alert_type").notNull(), // action_required, informational, deadline
  severity: text("severity").notNull(), // critical, high, medium, low
  
  title: text("title").notNull(),
  description: text("description"),
  
  // Action
  actionRequired: text("action_required"),
  deadline: timestamp("deadline"),
  
  // Status
  status: text("status").default('pending'), // pending, acknowledged, resolved, dismissed
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: text("acknowledged_by"),
  resolvedAt: timestamp("resolved_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("compliance_alerts_org_idx").on(table.organizationId),
  index("compliance_alerts_property_idx").on(table.propertyId),
  index("compliance_alerts_status_idx").on(table.status),
]);

export const insertComplianceAlertSchema = createInsertSchema(complianceAlerts).omit({ id: true, createdAt: true });
export type InsertComplianceAlert = z.infer<typeof insertComplianceAlertSchema>;
export type ComplianceAlert = typeof complianceAlerts.$inferSelect;

// ===========================
// PHASE 5: WHITE-LABEL
// ===========================

// White-label Tenants - Enterprise customers
export const whitelabelTenants = pgTable("whitelabel_tenants", {
  id: serial("id").primaryKey(),
  
  // Tenant info
  tenantName: text("tenant_name").notNull(),
  subdomain: text("subdomain").notNull().unique(),
  customDomain: text("custom_domain").unique(),
  
  // Branding
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  
  // Features enabled
  features: jsonb("features").$type<string[]>(),
  
  // Limits
  maxUsers: integer("max_users"),
  maxProperties: integer("max_properties"),
  maxStorage: integer("max_storage"), // GB
  
  // Billing
  plan: text("plan").notNull(), // starter, professional, enterprise
  monthlyFee: numeric("monthly_fee").notNull(),
  
  // Admin
  adminUserId: text("admin_user_id"),
  adminEmail: text("admin_email"),
  
  // Status
  isActive: boolean("is_active").default(true),
  suspendedAt: timestamp("suspended_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("whitelabel_tenants_subdomain_idx").on(table.subdomain),
]);

export const insertWhitelabelTenantSchema = createInsertSchema(whitelabelTenants).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWhitelabelTenant = z.infer<typeof insertWhitelabelTenantSchema>;
export type WhitelabelTenant = typeof whitelabelTenants.$inferSelect;

// ===========================
// STRIPE WEBHOOK DEDUP
// ===========================

// Tracks processed Stripe events for idempotency
export const stripeProcessedEvents = pgTable("stripe_processed_events", {
  id: serial("id").primaryKey(),
  stripeEventId: text("stripe_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at").defaultNow(),
}, (table) => [
  index("stripe_processed_events_event_id_idx").on(table.stripeEventId),
]);

// Pillar 9.5 — generic webhook idempotency.
// Provider-agnostic dedup ledger for inbound webhooks (Twilio, SendGrid,
// Lob, PostGrid, Telnyx, …). Stripe keeps its dedicated table because the
// existing flow is battle-tested and we don't want to risk regression.
// UNIQUE(provider, event_id) guarantees a single insert per
// (provider, event) pair; an INSERT … ON CONFLICT DO NOTHING claim
// makes the dispatch exactly-once even when the provider retries.
export const processedWebhookEvents = pgTable("processed_webhook_events", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(), // twilio | sendgrid | lob | postgrid | telnyx
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
}, (table) => [
  uniqueIndex("processed_webhook_events_provider_event_uidx").on(table.provider, table.eventId),
  index("processed_webhook_events_processed_at_idx").on(table.processedAt),
]);

export type ProcessedWebhookEvent = typeof processedWebhookEvents.$inferSelect;
export type InsertProcessedWebhookEvent = typeof processedWebhookEvents.$inferInsert;

// P0-10 (master findings): Dropbox Sign / HelloSign webhook events claimed
// before processing. Mirrors the stripeProcessedEvents pattern: an INSERT
// ON CONFLICT DO NOTHING claim guarantees exactly-once dispatch even when
// Dropbox Sign retries the same event under load. eventId derives from
// the Dropbox Sign payload's `event.event_hash` (HMAC of timestamp +
// event_time + event_type per their spec); falls back to a synthesized
// id when missing so old/replayed events can't slip through.
export const esignWebhookEvents = pgTable("esign_webhook_events", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().default("dropbox_sign"),
  eventId: text("event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  signatureRequestId: text("signature_request_id"),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
}, (table) => [
  index("esign_webhook_events_event_id_idx").on(table.eventId),
  index("esign_webhook_events_sig_req_idx").on(table.signatureRequestId),
]);
