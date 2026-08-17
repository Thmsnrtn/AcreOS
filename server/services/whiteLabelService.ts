/**
 * White-Label Service — AcreOS Phase 4
 *
 * Enables multi-tenant reseller support so franchises, coaching programs,
 * and land investing communities can run AcreOS under their own brand.
 *
 * Features:
 * - Custom branding (logo, colors, company name)
 * - Custom domain mapping
 * - Feature flag control per tenant
 * - Revenue share configuration
 * - Tenant user limits and plan enforcement
 * - Isolated data per tenant (via existing org isolation)
 */

import { db } from '../db';
import { organizations, whiteLabelConfigs } from '../../shared/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

export interface WhiteLabelConfig {
  tenantId: string;
  organizationId: number;
  brandName: string;
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor: string;
  accentColor: string;
  customDomain?: string;
  supportEmail: string;
  supportPhone?: string;
  footerText: string;
  // Feature flags
  features: {
    marketplace: boolean;
    academy: boolean;
    dealHunter: boolean;
    voiceAI: boolean;
    visionAI: boolean;
    capitalMarkets: boolean;
    negotiationCopilot: boolean;
    portfolioOptimizer: boolean;
    complianceAI: boolean;
    taxResearcher: boolean;
  };
  // Revenue share
  revenueShare: {
    platformFeePercent: number; // AcreOS keeps this %
    resellerFeePercent: number; // Reseller keeps this %
  };
  // Limits
  limits: {
    maxUsers: number;
    maxLeads: number;
    maxProperties: number;
    maxCampaigns: number;
  };
  // Billing
  parentOrganizationId: number; // The reseller's org ID
  plan: 'starter' | 'professional' | 'enterprise';
  billingEmail: string;
  status: 'active' | 'suspended' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

/**
 * Reseller feature flags whose subsystem carries a FREEZE or KILL verdict in
 * `docs/company/deletion-ledger.md`. Each maps to the verdict, so this list can
 * be checked against the ledger rather than trusted.
 *
 * WHY A FLOOR AND NOT JUST A DEFAULT. `createTenant` defaults these to `false`
 * now, but a config written before a verdict landed still says `true`, and
 * `isFeatureEnabled` is what a reseller asks to decide what to show their own
 * customers. Three of these have NO CODE LEFT — `services/visionAI.ts` and
 * `pages/vision-ai.tsx` went 2026-08-01, `services/voiceAI.ts` with them, and
 * the negotiation copilot 2026-08-13 — so a `true` here tells a reseller to
 * advertise a feature that cannot load.
 *
 * A flag comes OFF this list only when its subsystem is genuinely reactivated
 * under the ledger's own criterion, in the same change that reactivates it.
 */
const RETIRED_FEATURES: Record<string, string> = {
  academy: "KILL — education revenue stays dead (constitution adjacency-risk trap)",
  visionAI: "KILL — executed 2026-08-01; the service and page are deleted",
  voiceAI: "KILL — executed 2026-08-01; the pipeline and its tables are gone",
  dealHunter: "retired 2026-06-08 — superseded by /api/deal-feed (dealFeedEngine)",
  marketplace: "FREEZE — reactivate at G2's liquidity proof, not before ~25 customers",
  negotiationCopilot: "KILL — executed 2026-08-13; the service and page are deleted",
  capitalMarkets: "FREEZE — reactivate when note securitization is a real revenue line (H4)",
};

class WhiteLabelService {
  private rowToConfig(row: typeof whiteLabelConfigs.$inferSelect): WhiteLabelConfig {
    return {
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      parentOrganizationId: row.parentOrganizationId,
      brandName: row.brandName,
      logoUrl: row.logoUrl ?? undefined,
      faviconUrl: row.faviconUrl ?? undefined,
      primaryColor: row.primaryColor,
      accentColor: row.accentColor,
      customDomain: row.customDomain ?? undefined,
      supportEmail: row.supportEmail,
      supportPhone: row.supportPhone ?? undefined,
      footerText: row.footerText,
      features: row.features as WhiteLabelConfig['features'],
      revenueShare: row.revenueShare as WhiteLabelConfig['revenueShare'],
      limits: row.limits as WhiteLabelConfig['limits'],
      plan: row.plan as WhiteLabelConfig['plan'],
      billingEmail: row.billingEmail,
      status: row.status as WhiteLabelConfig['status'],
      createdAt: (row.createdAt ?? new Date()).toISOString(),
      updatedAt: (row.updatedAt ?? new Date()).toISOString(),
    };
  }

  /**
   * Create a white-label tenant configuration for an organization.
   * Called by the parent (reseller) organization to set up a sub-tenant.
   */
  async createTenant(
    parentOrganizationId: number,
    tenantOrganizationId: number,
    config: Partial<WhiteLabelConfig>
  ): Promise<WhiteLabelConfig> {
    const [existing] = await db.select().from(whiteLabelConfigs)
      .where(eq(whiteLabelConfigs.organizationId, tenantOrganizationId)).limit(1);
    if (existing) {
      throw new Error('White-label configuration already exists for this organization');
    }

    const [row] = await db.insert(whiteLabelConfigs).values({
      tenantId: crypto.randomUUID(),
      organizationId: tenantOrganizationId,
      parentOrganizationId,
      brandName: config.brandName || 'Land Investment Platform',
      logoUrl: config.logoUrl,
      faviconUrl: config.faviconUrl,
      primaryColor: config.primaryColor || '#2563eb',
      accentColor: config.accentColor || '#16a34a',
      customDomain: config.customDomain,
      supportEmail: config.supportEmail || 'support@acreos.io',
      supportPhone: config.supportPhone,
      footerText: config.footerText || 'Powered by AcreOS',
      // Every flag in RETIRED_FEATURES defaults OFF: a reseller feature set must
      // not advertise a subsystem that is frozen, killed or already deleted.
      // `...config.features` can still set one to `true` — a caller may pass
      // anything — which is why isFeatureEnabled applies the same list as a
      // floor at the READ rather than relying on these defaults.
      features: {
        marketplace: false, academy: false, dealHunter: false, voiceAI: false,
        visionAI: false, capitalMarkets: false, negotiationCopilot: false,
        portfolioOptimizer: true, complianceAI: false, taxResearcher: false,
        ...config.features,
      },
      revenueShare: { platformFeePercent: 70, resellerFeePercent: 30, ...config.revenueShare },
      limits: { maxUsers: 5, maxLeads: 1000, maxProperties: 500, maxCampaigns: 10, ...config.limits },
      plan: config.plan || 'starter',
      billingEmail: config.billingEmail || config.supportEmail || '',
      status: 'active',
    }).returning();

    return this.rowToConfig(row);
  }

  /**
   * Get white-label config for an organization.
   */
  async getConfig(organizationId: number): Promise<WhiteLabelConfig | null> {
    const [row] = await db.select().from(whiteLabelConfigs)
      .where(eq(whiteLabelConfigs.organizationId, organizationId)).limit(1);
    return row ? this.rowToConfig(row) : null;
  }

  /**
   * Update white-label config.
   */
  async updateConfig(
    organizationId: number,
    updates: Partial<WhiteLabelConfig>
  ): Promise<WhiteLabelConfig> {
    const [existing] = await db.select().from(whiteLabelConfigs)
      .where(eq(whiteLabelConfigs.organizationId, organizationId)).limit(1);
    if (!existing) {
      throw new Error('White-label configuration not found');
    }

    const [row] = await db.update(whiteLabelConfigs).set({
      ...(updates.brandName && { brandName: updates.brandName }),
      ...(updates.logoUrl !== undefined && { logoUrl: updates.logoUrl }),
      ...(updates.faviconUrl !== undefined && { faviconUrl: updates.faviconUrl }),
      ...(updates.primaryColor && { primaryColor: updates.primaryColor }),
      ...(updates.accentColor && { accentColor: updates.accentColor }),
      ...(updates.customDomain !== undefined && { customDomain: updates.customDomain }),
      ...(updates.supportEmail && { supportEmail: updates.supportEmail }),
      ...(updates.supportPhone !== undefined && { supportPhone: updates.supportPhone }),
      ...(updates.footerText && { footerText: updates.footerText }),
      ...(updates.features && { features: { ...(existing.features as object), ...updates.features } }),
      ...(updates.revenueShare && { revenueShare: { ...(existing.revenueShare as object), ...updates.revenueShare } }),
      ...(updates.limits && { limits: { ...(existing.limits as object), ...updates.limits } }),
      ...(updates.plan && { plan: updates.plan }),
      ...(updates.billingEmail && { billingEmail: updates.billingEmail }),
      updatedAt: new Date(),
    }).where(eq(whiteLabelConfigs.organizationId, organizationId)).returning();

    return this.rowToConfig(row);
  }

  /**
   * Suspend a tenant.
   */
  async suspendTenant(organizationId: number): Promise<void> {
    await db.update(whiteLabelConfigs)
      .set({ status: 'suspended', updatedAt: new Date() })
      .where(eq(whiteLabelConfigs.organizationId, organizationId));
  }

  /**
   * Resolve white-label config from a custom domain.
   */
  async resolveFromDomain(domain: string): Promise<WhiteLabelConfig | null> {
    const [row] = await db.select().from(whiteLabelConfigs)
      .where(eq(whiteLabelConfigs.customDomain, domain)).limit(1);
    return row ? this.rowToConfig(row) : null;
  }

  /**
   * List all tenants managed by a parent organization.
   */
  async listTenants(parentOrganizationId: number): Promise<WhiteLabelConfig[]> {
    const rows = await db.select().from(whiteLabelConfigs)
      .where(eq(whiteLabelConfigs.parentOrganizationId, parentOrganizationId));
    return rows.map(r => this.rowToConfig(r));
  }

  /**
   * Check if a feature is enabled for an organization.
   *
   * RETIRED FEATURES ARE FALSE REGARDLESS OF THE STORED VALUE. Seven of the ten
   * flags name subsystems carrying a FREEZE or KILL verdict in
   * `docs/company/deletion-ledger.md`, and three of them have no code left at
   * all. Flipping the DEFAULTS in `createTenant` does not fix a config created
   * before the verdict — the stored row still says `true`, and this method is
   * the API a reseller consults to decide what to show their own customers. So
   * the floor is applied at the READ, where it covers every row ever written.
   *
   * The fail-open below (`no config = everything enabled`) is left alone: an org
   * with no white-label configuration is not a reseller tenant, and the platform
   * gates govern it. But it must not answer `true` for a retired subsystem
   * either, which is why the check runs first.
   */
  async isFeatureEnabled(organizationId: number, feature: keyof WhiteLabelConfig['features']): Promise<boolean> {
    if (feature in RETIRED_FEATURES) return false;
    const config = await this.getConfig(organizationId);
    if (!config) return true; // No white-label restriction = all features enabled
    return config.features[feature] ?? false;
  }

  /**
   * Get branding CSS variables for injection into the UI.
   */
  getBrandingCSS(config: WhiteLabelConfig): string {
    return `
      :root {
        --brand-primary: ${config.primaryColor};
        --brand-accent: ${config.accentColor};
      }
    `.trim();
  }

  /**
   * Generate a white-label setup report for the reseller.
   */
  async getResellerReport(parentOrganizationId: number): Promise<{
    totalTenants: number;
    activeTenants: number;
    suspendedTenants: number;
    totalRevenue: number;
    tenants: WhiteLabelConfig[];
  }> {
    const tenants = await this.listTenants(parentOrganizationId);
    const activeTenants = tenants.filter(t => t.status === 'active').length;
    const suspendedTenants = tenants.filter(t => t.status === 'suspended').length;

    return {
      totalTenants: tenants.length,
      activeTenants,
      suspendedTenants,
      totalRevenue: 0, // Would be calculated from Stripe in production
      tenants,
    };
  }
}

export const whiteLabelService = new WhiteLabelService();
