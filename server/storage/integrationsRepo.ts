// Connected provider channels: organization integrations (BYOK provider
// credentials), verified email domains, and provisioned phone numbers.
// Extracted from the god-class server/storage.ts in the storage refactor.
// Methods are merged into DatabaseStorage.prototype at construction time;
// `this` therefore refers to the full DatabaseStorage instance and may
// call methods from any sibling repo (e.g. upsertOrganizationIntegration
// reads back via this.getOrganizationIntegration).

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { forOrg } from "../utils/orgScopedDb";
import {
  organizationIntegrations,
  verifiedEmailDomains,
  provisionedPhoneNumbers,
  type OrganizationIntegration,
  type InsertOrganizationIntegration,
  type VerifiedEmailDomain,
  type InsertVerifiedEmailDomain,
  type ProvisionedPhoneNumber,
  type InsertProvisionedPhoneNumber,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const integrationsRepo = {
  // Organization Integrations CRUD
  async getOrganizationIntegrations(this: DatabaseStorage, orgId: number): Promise<OrganizationIntegration[]> {
    return await db.select().from(organizationIntegrations)
      .where(eq(organizationIntegrations.organizationId, orgId))
      .orderBy(organizationIntegrations.provider);
  },

  async getOrganizationIntegration(this: DatabaseStorage, orgId: number, provider: string): Promise<OrganizationIntegration | undefined> {
    const [integration] = await db.select().from(organizationIntegrations)
      .where(and(
        eq(organizationIntegrations.organizationId, orgId),
        eq(organizationIntegrations.provider, provider)
      ));
    return integration;
  },

  async upsertOrganizationIntegration(this: DatabaseStorage, data: InsertOrganizationIntegration): Promise<OrganizationIntegration> {
    const existing = await this.getOrganizationIntegration(data.organizationId, data.provider);

    if (existing) {
      const [updated] = await db.update(organizationIntegrations)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(organizationIntegrations.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(organizationIntegrations).values(data).returning();
      return created;
    }
  },

  async deleteOrganizationIntegration(this: DatabaseStorage, orgId: number, provider: string): Promise<void> {
    await db.delete(organizationIntegrations)
      .where(and(
        eq(organizationIntegrations.organizationId, orgId),
        eq(organizationIntegrations.provider, provider)
      ));
  },

  async findOrganizationIntegrationByCredential(
    this: DatabaseStorage,
    provider: string,
    credentialKey: string,
    credentialValue: string
  ): Promise<OrganizationIntegration | undefined> {
    const integrations = await db.select().from(organizationIntegrations)
      .where(eq(organizationIntegrations.provider, provider));

    return integrations.find(integration => {
      const credentials = integration.credentials as Record<string, unknown> | null;
      return credentials && credentials[credentialKey] === credentialValue;
    });
  },

  async updateIntegrationValidation(this: DatabaseStorage, orgId: number, provider: string, validatedAt: Date | null, error: string | null): Promise<void> {
    await db.update(organizationIntegrations)
      .set({
        lastValidatedAt: validatedAt,
        validationError: error,
        updatedAt: new Date(),
      })
      .where(and(
        eq(organizationIntegrations.organizationId, orgId),
        eq(organizationIntegrations.provider, provider)
      ));
  },

  // Verified Email Domains CRUD
  async getVerifiedEmailDomains(this: DatabaseStorage, orgId: number): Promise<VerifiedEmailDomain[]> {
    return await db.select().from(verifiedEmailDomains)
      .where(eq(verifiedEmailDomains.organizationId, orgId))
      .orderBy(desc(verifiedEmailDomains.isDefault), verifiedEmailDomains.domain);
  },

  // Tier 1F: org-scoped by construction.
  async getVerifiedEmailDomain(this: DatabaseStorage, organizationId: number, id: number): Promise<VerifiedEmailDomain | undefined> {
    return await forOrg(organizationId).findById(verifiedEmailDomains, id);
  },

  async createVerifiedEmailDomain(this: DatabaseStorage, data: InsertVerifiedEmailDomain): Promise<VerifiedEmailDomain> {
    const [domain] = await db.insert(verifiedEmailDomains).values(data).returning();
    return domain;
  },

  async updateVerifiedEmailDomain(this: DatabaseStorage, id: number, data: Partial<InsertVerifiedEmailDomain>, organizationId?: number): Promise<VerifiedEmailDomain> {
    const conditions = [eq(verifiedEmailDomains.id, id)];
    if (organizationId) conditions.push(eq(verifiedEmailDomains.organizationId, organizationId));
    const [domain] = await db.update(verifiedEmailDomains)
      .set({ ...data, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return domain;
  },

  async deleteVerifiedEmailDomain(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(verifiedEmailDomains.id, id)];
    if (organizationId) conditions.push(eq(verifiedEmailDomains.organizationId, organizationId));
    await db.delete(verifiedEmailDomains).where(and(...conditions));
  },

  // Provisioned Phone Numbers CRUD
  async getProvisionedPhoneNumbers(this: DatabaseStorage, orgId: number): Promise<ProvisionedPhoneNumber[]> {
    return await db.select().from(provisionedPhoneNumbers)
      .where(eq(provisionedPhoneNumbers.organizationId, orgId))
      .orderBy(desc(provisionedPhoneNumbers.isDefault), provisionedPhoneNumbers.phoneNumber);
  },

  // Tier 1F: org-scoped by construction.
  async getProvisionedPhoneNumber(this: DatabaseStorage, organizationId: number, id: number): Promise<ProvisionedPhoneNumber | undefined> {
    return await forOrg(organizationId).findById(provisionedPhoneNumbers, id);
  },

  async createProvisionedPhoneNumber(this: DatabaseStorage, data: InsertProvisionedPhoneNumber): Promise<ProvisionedPhoneNumber> {
    const [phone] = await db.insert(provisionedPhoneNumbers).values(data).returning();
    return phone;
  },

  async updateProvisionedPhoneNumber(this: DatabaseStorage, id: number, data: Partial<InsertProvisionedPhoneNumber>, organizationId?: number): Promise<ProvisionedPhoneNumber> {
    const conditions = [eq(provisionedPhoneNumbers.id, id)];
    if (organizationId) conditions.push(eq(provisionedPhoneNumbers.organizationId, organizationId));
    const [phone] = await db.update(provisionedPhoneNumbers)
      .set({ ...data, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return phone;
  },

  async deleteProvisionedPhoneNumber(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(provisionedPhoneNumbers.id, id)];
    if (organizationId) conditions.push(eq(provisionedPhoneNumbers.organizationId, organizationId));
    await db.delete(provisionedPhoneNumbers).where(and(...conditions));
  },
};

export type IntegrationsRepo = typeof integrationsRepo;
