// ============================================================================
// SHARED/SCHEMA/COMPLIANCE.TS
// ----------------------------------------------------------------------------
// Compliance bucket — investor verification (KYC + audit + background checks),
// tax & cost basis,
// voice/call recording metadata, satellite snapshots, ML model registry,
// regulatory compliance state DB, certificate verification, tenant usage
// metering.
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
  primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import {
  organizations,
  properties,
  investorProfiles,
  whitelabelTenants,
} from "../schema";

// ============================================
// INVESTOR VERIFICATION
// ============================================

// KYC verification requests — the request-level state machine
// (pending → reviewing → approved | rejected | more_info_needed).
// DB-BACKED (Wave A "Nothing lies", founder ruling #12(c), 2026-07-29):
// this state previously lived in a module-level Map inside
// server/services/investorVerification.ts and vanished on every
// restart/deploy — losable KYC state. The two sibling tables below
// (investor_verification_documents / investor_verification_history) carry
// per-document uploads and the org-wide audit trail, but neither holds the
// request entity itself (its id, status, submitted/reviewed timestamps,
// accreditation attestation) — hence this table. `documents` and `history`
// mirror the exact shapes the service API returns.
export const investorVerificationRequests = pgTable("investor_verification_requests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  investorProfileId: integer("investor_profile_id").references(() => investorProfiles.id).notNull(),
  status: text("status").notNull().default("pending"), // pending | reviewing | approved | rejected | more_info_needed
  documents: jsonb("documents").$type<Array<{ docType: string; fileData: any; uploadedAt: string }>>().notNull().default([]),
  submittedAt: timestamp("submitted_at"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: integer("reviewed_by"),
  decision: text("decision"),
  reason: text("reason"),
  accreditationData: jsonb("accreditation_data").$type<{ netWorth: number; annualIncome: number }>(),
  history: jsonb("history").$type<Array<{ status: string; changedAt: string; changedBy?: number; note?: string }>>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("investor_ver_requests_org_status_idx").on(table.organizationId, table.status),
  index("investor_ver_requests_profile_created_idx").on(table.investorProfileId, table.createdAt),
]);

export const insertInvestorVerificationRequestSchema = createInsertSchema(investorVerificationRequests).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvestorVerificationRequest = z.infer<typeof insertInvestorVerificationRequestSchema>;
export type InvestorVerificationRequest = typeof investorVerificationRequests.$inferSelect;

// KYC document uploads for investor verification
export const investorVerificationDocuments = pgTable("investor_verification_documents", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  investorProfileId: integer("investor_profile_id").references(() => investorProfiles.id).notNull(),
  documentType: text("document_type").notNull(), // passport | drivers_license | articles_of_org | proof_of_funds | accreditation_docs
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  status: text("status").notNull().default("pending"), // pending | reviewing | approved | rejected
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  rejectionReason: text("rejection_reason"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("investor_ver_docs_org_idx").on(table.organizationId),
  index("investor_ver_docs_profile_idx").on(table.investorProfileId),
  index("investor_ver_docs_status_idx").on(table.status),
]);

export const insertInvestorVerificationDocumentSchema = createInsertSchema(investorVerificationDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvestorVerificationDocument = z.infer<typeof insertInvestorVerificationDocumentSchema>;
export type InvestorVerificationDocument = typeof investorVerificationDocuments.$inferSelect;

// Audit trail for verification state changes
export const investorVerificationHistory = pgTable("investor_verification_history", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  investorProfileId: integer("investor_profile_id").references(() => investorProfiles.id).notNull(),
  previousStatus: text("previous_status"),
  newStatus: text("new_status").notNull(),
  changedBy: text("changed_by").notNull(), // admin user id
  reason: text("reason"),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("investor_ver_history_org_idx").on(table.organizationId),
  index("investor_ver_history_profile_idx").on(table.investorProfileId),
  index("investor_ver_history_created_idx").on(table.createdAt),
]);

export const insertInvestorVerificationHistorySchema = createInsertSchema(investorVerificationHistory).omit({ id: true, createdAt: true });
export type InsertInvestorVerificationHistory = z.infer<typeof insertInvestorVerificationHistorySchema>;
export type InvestorVerificationHistory = typeof investorVerificationHistory.$inferSelect;

// Third-party background check results
export const backgroundCheckResults = pgTable("background_check_results", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  investorProfileId: integer("investor_profile_id").references(() => investorProfiles.id).notNull(),
  provider: text("provider").notNull(), // stripe_identity | persona
  externalId: text("external_id"),
  status: text("status").notNull().default("pending"), // pending | completed | failed
  riskLevel: text("risk_level"), // low | medium | high
  reportData: jsonb("report_data").$type<Record<string, any>>(),
  checkedAt: timestamp("checked_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("background_checks_org_idx").on(table.organizationId),
  index("background_checks_profile_idx").on(table.investorProfileId),
  index("background_checks_status_idx").on(table.status),
]);

export const insertBackgroundCheckResultSchema = createInsertSchema(backgroundCheckResults).omit({ id: true, createdAt: true });
export type InsertBackgroundCheckResult = z.infer<typeof insertBackgroundCheckResultSchema>;
export type BackgroundCheckResult = typeof backgroundCheckResults.$inferSelect;

// ============================================
// FEE MANAGEMENT — DELETED 2026-07-29
// --------------------------------------------
// `transaction_fee_settlements`, `fee_payout_schedules` and `fee_audit_log`
// were the storage for a platform escrow-and-take-a-cut engine
// (server/services/transactionFeeService.ts) that had ZERO call sites: AcreOS
// would have collected a buyer/seller/platform fee, HELD it on its own
// balance for N days, then transferred it out. Founder ruling 2026-07-29 —
// "be the rail, not the provider": customer money never moves on AcreOS's own
// account. The service, its stub router (`/api/transaction-fees`), its founder
// console (`/fee-dashboard`) and these three tables are all deleted; dropped
// in migration 0214. Nothing else read them.
//
// See shared/governance/constitution.ts `hard-stop.no-platform-money-custody`.
// ============================================

// ============================================
// TAX & COST BASIS
// ============================================

// Cost basis per property for tax purposes
export const costBasis = pgTable("cost_basis", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  acquisitionDate: timestamp("acquisition_date"),
  acquisitionPrice: numeric("acquisition_price"),
  acquisitionCosts: numeric("acquisition_costs"),
  improvementCosts: numeric("improvement_costs"),
  adjustedBasis: numeric("adjusted_basis"),
  dispositionDate: timestamp("disposition_date"),
  dispositionPrice: numeric("disposition_price"),
  gainLoss: numeric("gain_loss"),
  holdingPeriod: text("holding_period"), // short | long
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("cost_basis_org_idx").on(table.organizationId),
  index("cost_basis_property_idx").on(table.propertyId),
]);

export const insertCostBasisSchema = createInsertSchema(costBasis).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCostBasis = z.infer<typeof insertCostBasisSchema>;
export type CostBasis = typeof costBasis.$inferSelect;

// Depreciation tracking per property
export const depreciationSchedules = pgTable("depreciation_schedules", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id).notNull(),
  method: text("method").notNull(), // straight_line | accelerated | bonus
  landValue: numeric("land_value"),
  improvementValue: numeric("improvement_value"),
  totalCost: numeric("total_cost"),
  usefulLifeYears: integer("useful_life_years"),
  annualDepreciation: numeric("annual_depreciation"),
  accumulatedDepreciation: numeric("accumulated_depreciation"),
  remainingBasis: numeric("remaining_basis"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  scheduleData: jsonb("schedule_data").$type<Array<{ year: number; depreciation: number; cumulativeDepreciation: number }>>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("depreciation_schedules_org_idx").on(table.organizationId),
  index("depreciation_schedules_property_idx").on(table.propertyId),
]);

export const insertDepreciationScheduleSchema = createInsertSchema(depreciationSchedules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDepreciationSchedule = z.infer<typeof insertDepreciationScheduleSchema>;
export type DepreciationSchedule = typeof depreciationSchedules.$inferSelect;

// OZ investment tracking
export const opportunityZoneHoldings = pgTable("opportunity_zone_holdings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  propertyId: integer("property_id").references(() => properties.id),
  ozFundName: text("oz_fund_name"),
  ozTractId: text("oz_tract_id"),
  investmentDate: timestamp("investment_date"),
  initialInvestment: numeric("initial_investment"),
  deferredGainRollover: numeric("deferred_gain_rollover"),
  qualifiedOpportunityFund: text("qualified_opportunity_fund"),
  holdingYears: integer("holding_years"),
  stepUpBasis: numeric("step_up_basis"),
  estimatedTaxSavings: numeric("estimated_tax_savings"),
  exitDate: timestamp("exit_date"),
  exitValue: numeric("exit_value"),
  status: text("status").notNull().default("active"), // active | exited
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("oz_holdings_org_idx").on(table.organizationId),
  index("oz_holdings_property_idx").on(table.propertyId),
  index("oz_holdings_status_idx").on(table.status),
]);

export const insertOpportunityZoneHoldingSchema = createInsertSchema(opportunityZoneHoldings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOpportunityZoneHolding = z.infer<typeof insertOpportunityZoneHoldingSchema>;
export type OpportunityZoneHolding = typeof opportunityZoneHoldings.$inferSelect;

// AI-generated tax strategy recommendations
export const taxStrategies = pgTable("tax_strategies", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  strategyType: text("strategy_type").notNull(), // 1031_exchange | oz_investment | depreciation | cost_segregation | installment_sale | harvest_losses
  title: text("title").notNull(),
  description: text("description"),
  estimatedTaxSavings: numeric("estimated_tax_savings"),
  implementationCost: numeric("implementation_cost"),
  timeframe: text("timeframe"),
  riskLevel: text("risk_level"), // low | medium | high
  requirements: jsonb("requirements").$type<Record<string, any>>(),
  applicableProperties: integer("applicable_properties").array(),
  status: text("status").notNull().default("recommended"), // recommended | implementing | completed | dismissed
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("tax_strategies_org_idx").on(table.organizationId),
  index("tax_strategies_type_idx").on(table.strategyType),
  index("tax_strategies_status_idx").on(table.status),
]);

export const insertTaxStrategySchema = createInsertSchema(taxStrategies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTaxStrategy = z.infer<typeof insertTaxStrategySchema>;
export type TaxStrategy = typeof taxStrategies.$inferSelect;

// Multi-year tax planning scenarios
export const taxForecastScenarios = pgTable("tax_forecast_scenarios", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  scenarioName: text("scenario_name").notNull(),
  holdYears: integer("hold_years"),
  scenarioType: text("scenario_type").notNull(), // hold | sell | exchange | develop
  propertyIds: integer("property_ids").array(),
  projectedSalePrice: numeric("projected_sale_price"),
  projectedCapGain: numeric("projected_cap_gain"),
  projectedTaxLiability: numeric("projected_tax_liability"),
  projectedNetProceeds: numeric("projected_net_proceeds"),
  assumptions: jsonb("assumptions").$type<Record<string, any>>(),
  yearlyBreakdown: jsonb("yearly_breakdown").$type<Array<Record<string, any>>>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("tax_forecast_scenarios_org_idx").on(table.organizationId),
  index("tax_forecast_scenarios_type_idx").on(table.scenarioType),
]);

export const insertTaxForecastScenarioSchema = createInsertSchema(taxForecastScenarios).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTaxForecastScenario = z.infer<typeof insertTaxForecastScenarioSchema>;
export type TaxForecastScenario = typeof taxForecastScenarios.$inferSelect;

// voice_call_recordings, satellite_analysis, model_versions and
// training_metrics dropped 2026-08-01 by explicit founder ruling
// (deletion-ledger rows: Voice / AI voice, Satellite / Vision AI; ML registry
// services modelServing/modelTraining/dataQuality were unreached dead code —
// their only "importer" was a barrel file nothing imported).

// ============================================
// REGULATORY COMPLIANCE
// ============================================

// State/county disclosure law database
export const regulatoryRequirements = pgTable("regulatory_requirements", {
  id: serial("id").primaryKey(),
  state: text("state").notNull(),
  county: text("county"),
  requirementType: text("requirement_type").notNull(), // disclosure | filing | recording | escrow | licensing
  title: text("title").notNull(),
  description: text("description"),
  legalCitation: text("legal_citation"),
  effectiveDate: timestamp("effective_date"),
  expirationDate: timestamp("expiration_date"),
  jurisdictionLevel: text("jurisdiction_level").notNull(), // state | county | city
  transactionTypes: text("transaction_types").array(),
  requiredDocuments: text("required_documents").array(),
  penalties: text("penalties"),
  isActive: boolean("is_active").default(true),
  lastVerified: timestamp("last_verified"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("regulatory_requirements_state_idx").on(table.state),
  index("regulatory_requirements_type_idx").on(table.requirementType),
  index("regulatory_requirements_active_idx").on(table.isActive),
]);

export const insertRegulatoryRequirementSchema = createInsertSchema(regulatoryRequirements).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRegulatoryRequirement = z.infer<typeof insertRegulatoryRequirementSchema>;
export type RegulatoryRequirement = typeof regulatoryRequirements.$inferSelect;

// Per-transaction compliance checklist
export const complianceChecklistItems = pgTable("compliance_checklist_items", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  dealId: integer("deal_id"),
  requirementId: integer("requirement_id").references(() => regulatoryRequirements.id),
  itemTitle: text("item_title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"), // pending | completed | waived | na
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  completedBy: text("completed_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("compliance_checklist_org_idx").on(table.organizationId),
  index("compliance_checklist_deal_idx").on(table.dealId),
  index("compliance_checklist_status_idx").on(table.status),
]);

export const insertComplianceChecklistItemSchema = createInsertSchema(complianceChecklistItems).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertComplianceChecklistItem = z.infer<typeof insertComplianceChecklistItemSchema>;
export type ComplianceChecklistItem = typeof complianceChecklistItems.$inferSelect;

// ============================================
// CERTIFICATE VERIFICATION
// ============================================

// Public tamper-proof cert verification
export const certificateVerification = pgTable("certificate_verification", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  certificationId: integer("certification_id"),
  recipientName: text("recipient_name").notNull(),
  recipientEmail: text("recipient_email"),
  certType: text("cert_type").notNull(),
  issuedAt: timestamp("issued_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  publicUrl: text("public_url"),
  verificationHash: text("verification_hash").unique(),
  isRevoked: boolean("is_revoked").default(false),
  revokedAt: timestamp("revoked_at"),
  revokedReason: text("revoked_reason"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("cert_verification_org_idx").on(table.organizationId),
  index("cert_verification_hash_idx").on(table.verificationHash),
  index("cert_verification_recipient_idx").on(table.recipientEmail),
]);

export const insertCertificateVerificationSchema = createInsertSchema(certificateVerification).omit({ id: true, createdAt: true });
export type InsertCertificateVerification = z.infer<typeof insertCertificateVerificationSchema>;
export type CertificateVerification = typeof certificateVerification.$inferSelect;

// ============================================
// TENANT USAGE METERING
// ============================================

// Per-tenant usage metering
export const tenantMetrics = pgTable("tenant_metrics", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => whitelabelTenants.id).notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  activeUsers: integer("active_users").default(0),
  totalApiCalls: integer("total_api_calls").default(0),
  aiCreditsConsumed: numeric("ai_credits_consumed").default("0"),
  storageUsedMb: integer("storage_used_mb").default(0),
  voiceMinutesUsed: integer("voice_minutes_used").default(0),
  revenueGenerated: numeric("revenue_generated").default("0"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("tenant_metrics_tenant_idx").on(table.tenantId),
  index("tenant_metrics_period_idx").on(table.periodStart, table.periodEnd),
]);

export const insertTenantMetricSchema = createInsertSchema(tenantMetrics).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTenantMetric = z.infer<typeof insertTenantMetricSchema>;
export type TenantMetric = typeof tenantMetrics.$inferSelect;

