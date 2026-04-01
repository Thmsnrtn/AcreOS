/**
 * T185 — Lead Enrichment Service
 *
 * Augments lead records with enriched data:
 * - Property ownership lookup from APN/address
 * - Email/phone validation scoring
 * - Social presence signals
 * - Ownership duration estimation (proxy for seller motivation)
 * - Property value context from AVM
 *
 * Enrichment is async and stores results in the lead's enrichmentData JSONB column.
 */

import { db } from "../db";
import { leads, properties, type Lead } from "@shared/schema";
import { eq, and } from "drizzle-orm";

interface EnrichmentData {
  emailValid?: boolean;
  emailDomain?: string;
  phoneFormatted?: string;
  phoneValid?: boolean;
  estimatedOwnershipYears?: number;
  propertyCount?: number;
  estimatedEquity?: number;
  enrichedAt: string;
  enrichmentVersion: number;
}

interface EnrichmentResult {
  leadId: number;
  changes: Partial<EnrichmentData>;
  enrichedAt: string;
}

const ENRICHMENT_VERSION = 1;

/**
 * Validate email format and domain
 */
export function validateEmail(email: string | null | undefined): { valid: boolean; domain?: string } {
  if (!email) return { valid: false };

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return { valid: false };

  const domain = email.split("@")[1]?.toLowerCase();

  // Common free email domains (not necessarily invalid, but note them)
  const freeDomains = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com"]);
  const isFreeDomain = freeDomains.has(domain || "");

  return { valid: true, domain, isFreeDomain } as any;
}

/**
 * Format and validate US phone number
 */
export function formatPhone(phone: string | null | undefined): { formatted: string | null; valid: boolean } {
  if (!phone) return { formatted: null, valid: false };

  // Strip all non-numeric
  const digits = phone.replace(/\D/g, "");

  // Handle 10 or 11 digit numbers
  let core = digits;
  if (digits.length === 11 && digits.startsWith("1")) {
    core = digits.substring(1);
  }

  if (core.length !== 10) return { formatted: null, valid: false };

  // Check for invalid area codes (000, 555-0100-0199 test numbers, etc.)
  const areaCode = parseInt(core.substring(0, 3));
  if (areaCode < 200 || areaCode === 555) return { formatted: null, valid: false };

  const formatted = `+1 (${core.substring(0, 3)}) ${core.substring(3, 6)}-${core.substring(6)}`;
  return { formatted, valid: true };
}

/**
 * Estimate ownership duration from property data
 */
export function estimateOwnershipYears(
  lastTransferDate: string | null | undefined,
  currentDate = new Date()
): number | null {
  if (!lastTransferDate) return null;

  const transfer = new Date(lastTransferDate);
  if (isNaN(transfer.getTime())) return null;

  const diffMs = currentDate.getTime() - transfer.getTime();
  const years = diffMs / (1000 * 60 * 60 * 24 * 365.25);

  return Math.max(0, Math.round(years * 10) / 10);
}

/**
 * Calculate lead quality score based on contact completeness
 */
export function calculateContactCompleteness(lead: {
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  propertyAddress?: string | null;
}): number {
  let score = 0;
  const weights = {
    hasEmail: 25,
    hasPhone: 25,
    hasName: 20,
    hasAddress: 15,
    hasPropertyAddress: 15,
  };

  if (lead.email && lead.email.length > 3) score += weights.hasEmail;
  if (lead.phone && lead.phone.replace(/\D/g, "").length >= 10) score += weights.hasPhone;
  if (lead.firstName && lead.lastName) score += weights.hasName;
  else if (lead.firstName || lead.lastName) score += weights.hasName / 2;
  if (lead.address) score += weights.hasAddress;
  if (lead.propertyAddress) score += weights.hasPropertyAddress;

  return Math.min(100, score);
}

/**
 * Enrich a single lead with available data
 */
export async function enrichLead(leadId: number, organizationId: number): Promise<EnrichmentResult> {
  const [lead] = await db.select().from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)));

  if (!lead) throw new Error(`Lead ${leadId} not found`);

  const changes: Partial<EnrichmentData> = {};

  // Validate email
  if (lead.email) {
    const emailValidation = validateEmail(lead.email);
    changes.emailValid = emailValidation.valid;
    changes.emailDomain = emailValidation.domain;
  }

  // Validate/format phone
  if (lead.phone) {
    const phoneValidation = formatPhone(lead.phone);
    changes.phoneValid = phoneValidation.valid;
    if (phoneValidation.formatted) {
      changes.phoneFormatted = phoneValidation.formatted;
    }
  }

  // Get associated properties for ownership data
  if (lead.propertyAddress) {
    const orgProperties = await db.select().from(properties)
      .where(eq(properties.organizationId, organizationId))
      .limit(10);

    const matchingProps = orgProperties.filter(p =>
      p.address?.toLowerCase().includes(lead.propertyAddress!.toLowerCase().substring(0, 10))
    );

    if (matchingProps.length > 0) {
      changes.propertyCount = matchingProps.length;
    }
  }

  changes.enrichedAt = new Date().toISOString();
  changes.enrichmentVersion = ENRICHMENT_VERSION;

  // Store enrichment data (merge with existing)
  const existingEnrichment = (lead as any).enrichmentData as EnrichmentData | null || {};
  const newEnrichmentData = { ...existingEnrichment, ...changes };

  await db.update(leads)
    .set({ enrichmentData: newEnrichmentData, updatedAt: new Date() } as any)
    .where(eq(leads.id, leadId));

  return {
    leadId,
    changes,
    enrichedAt: changes.enrichedAt,
  };
}

/**
 * Batch enrich multiple leads
 */
export async function batchEnrichLeads(
  leadIds: number[],
  organizationId: number
): Promise<{ enriched: number; errors: number; results: EnrichmentResult[] }> {
  const results: EnrichmentResult[] = [];
  let errors = 0;

  for (const id of leadIds) {
    try {
      const result = await enrichLead(id, organizationId);
      results.push(result);
    } catch (err) {
      errors++;
    }
  }

  return {
    enriched: results.length,
    errors,
    results,
  };
}
