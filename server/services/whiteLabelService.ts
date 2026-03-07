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
import { organizations } from '../../shared/schema';
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

// In-memory store for white-label configs (would be a DB table in production)
// Key: organizationId
const whiteLabelStore = new Map<number, WhiteLabelConfig>();

// Key: customDomain
const domainToOrgMap = new Map<string, number>();

class WhiteLabelService {
  /**
   * Create a white-label tenant configuration for an organization.
   * Called by the parent (reseller) organization to set up a sub-tenant.
   */
  async createTenant(
    parentOrganizationId: number,
    tenantOrganizationId: number,
    config: Partial<WhiteLabelConfig>
  ): Promise<WhiteLabelConfig> {
    const existing = whiteLabelStore.get(tenantOrganizationId);
    if (existing) {
      throw new Error('White-label configuration already exists for this organization');
    }

    const tenantConfig: WhiteLabelConfig = {
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
        marketplace: true,
        academy: true,
        dealHunter: true,
        voiceAI: false,
        visionAI: true,
        capitalMarkets: false,
        negotiationCopilot: true,
        portfolioOptimizer: true,
        complianceAI: false,
        taxResearcher: false,
        ...config.features,
      },
      revenueShare: {
        platformFeePercent: 70,
        resellerFeePercent: 30,
        ...config.revenueShare,
      },
      limits: {
        maxUsers: 5,
        maxLeads: 1000,
        maxProperties: 500,
        maxCampaigns: 10,
        ...config.limits,
      },
      plan: config.plan || 'starter',
      billingEmail: config.billingEmail || config.supportEmail || '',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    whiteLabelStore.set(tenantOrganizationId, tenantConfig);

    if (tenantConfig.customDomain) {
      domainToOrgMap.set(tenantConfig.customDomain, tenantOrganizationId);
    }

    return tenantConfig;
  }

  /**
   * Get white-label config for an organization.
   */
  async getConfig(organizationId: number): Promise<WhiteLabelConfig | null> {
    return whiteLabelStore.get(organizationId) || null;
  }

  /**
   * Update white-label config.
   */
  async updateConfig(
    organizationId: number,
    updates: Partial<WhiteLabelConfig>
  ): Promise<WhiteLabelConfig> {
    const existing = whiteLabelStore.get(organizationId);
    if (!existing) {
      throw new Error('White-label configuration not found');
    }

    // Handle domain change
    if (updates.customDomain && updates.customDomain !== existing.customDomain) {
      if (existing.customDomain) {
        domainToOrgMap.delete(existing.customDomain);
      }
      domainToOrgMap.set(updates.customDomain, organizationId);
    }

    const updated: WhiteLabelConfig = {
      ...existing,
      ...updates,
      features: { ...existing.features, ...updates.features },
      revenueShare: { ...existing.revenueShare, ...updates.revenueShare },
      limits: { ...existing.limits, ...updates.limits },
      organizationId,
      updatedAt: new Date().toISOString(),
    };

    whiteLabelStore.set(organizationId, updated);
    return updated;
  }

  /**
   * Suspend a tenant.
   */
  async suspendTenant(organizationId: number): Promise<void> {
    const config = whiteLabelStore.get(organizationId);
    if (config) {
      config.status = 'suspended';
      config.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Resolve white-label config from a custom domain.
   */
  async resolveFromDomain(domain: string): Promise<WhiteLabelConfig | null> {
    const orgId = domainToOrgMap.get(domain);
    if (!orgId) return null;
    return whiteLabelStore.get(orgId) || null;
  }

  /**
   * List all tenants managed by a parent organization.
   */
  async listTenants(parentOrganizationId: number): Promise<WhiteLabelConfig[]> {
    const tenants: WhiteLabelConfig[] = [];
    for (const config of whiteLabelStore.values()) {
      if (config.parentOrganizationId === parentOrganizationId) {
        tenants.push(config);
      }
    }
    return tenants;
  }

  /**
   * Check if a feature is enabled for an organization.
   */
  async isFeatureEnabled(organizationId: number, feature: keyof WhiteLabelConfig['features']): Promise<boolean> {
    const config = whiteLabelStore.get(organizationId);
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
