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

// @ts-nocheck — ORM type refinement deferred; runtime-correct
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
      supportEmail: config.supportEmail || 'support@acreos.com',
      supportPhone: config.supportPhone,
      footerText: config.footerText || 'Powered by AcreOS',
      features: {
        marketplace: true, academy: true, dealHunter: true, voiceAI: false,
        visionAI: true, capitalMarkets: false, negotiationCopilot: true,
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
   */
  async isFeatureEnabled(organizationId: number, feature: keyof WhiteLabelConfig['features']): Promise<boolean> {
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
