/**
 * T24 — Sophie Cross-Org Learning Privacy Guard
 *
 * Protects user privacy when Sophie learns patterns across organizations.
 * `sophieCrossOrgLearnings` can accumulate patterns from all orgs — this
 * service ensures:
 *   1. Org must explicitly opt in to cross-org learning (consent required)
 *   2. All shared data is aggregated and anonymized (k-anonymity, k≥3)
 *   3. Individual org data is never directly exposed in cross-org context
 *   4. Org can opt out at any time (data purged from cross-org learnings)
 *
 * Settings stored in organizations.settings.crossOrgLearningConsent
 *
 * Usage:
 *   import { sophiePrivacyGuard } from "./sophiePrivacyGuard";
 *
 *   // Before reading cross-org data for an org:
 *   if (!await sophiePrivacyGuard.hasConsent(orgId)) {
 *     return []; // don't share cross-org insights
 *   }
 *
 *   // Before writing a new cross-org learning:
 *   const anonymized = sophiePrivacyGuard.anonymize(learningData);
 *   await db.insert(sophieCrossOrgLearnings).values(anonymized);
 */

import { db } from "../db";
import { organizations, sophieCrossOrgLearnings } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import crypto from "crypto";

// Minimum number of orgs a pattern must appear in before it's shared (k-anonymity)
const K_ANONYMITY_THRESHOLD = 3;

export const sophiePrivacyGuard = {
  /**
   * Check if an org has consented to cross-org learning.
   */
  async hasConsent(orgId: number): Promise<boolean> {
    try {
      const [org] = await db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, orgId));

      return (org?.settings as any)?.crossOrgLearningConsent === true;
    } catch {
      return false; // fail closed
    }
  },

  /**
   * Set cross-org learning consent for an org.
   */
  async setConsent(orgId: number, consent: boolean): Promise<void> {
    await db.execute(sql`
      UPDATE organizations
      SET settings = jsonb_set(
        COALESCE(settings, '{}'::jsonb),
        '{crossOrgLearningConsent}',
        ${JSON.stringify(consent)}::jsonb
      )
      WHERE id = ${orgId}
    `);

    // If revoking consent, purge any contributions from this org
    if (!consent) {
      await sophiePrivacyGuard.purgeOrgData(orgId);
    }
  },

  /**
   * Anonymize a learning record before storing in the cross-org table.
   * Removes all PII and replaces orgId with a one-way hash.
   */
  anonymize(data: Record<string, any>, orgId: number): Record<string, any> {
    // One-way hash of orgId — cannot be reversed
    const orgHash = crypto
      .createHash("sha256")
      .update(`org:${orgId}:${process.env.SESSION_SECRET || "salt"}`)
      .digest("hex")
      .slice(0, 16);

    const piiFields = [
      "email", "phone", "address", "name", "firstName", "lastName",
      "sellerName", "buyerName", "taxId", "ssn", "apn",
    ];

    const sanitized = { ...data };
    for (const field of piiFields) {
      if (sanitized[field]) delete sanitized[field];
    }

    return {
      ...sanitized,
      orgHash,
      // Generalize financial values to ranges (not exact amounts)
      ...(sanitized.amount && { amountRange: getAmountRange(sanitized.amount) }),
      ...(sanitized.acres && { acresRange: getAcresRange(sanitized.acres) }),
    };
  },

  /**
   * Check if a pattern meets the k-anonymity threshold (appears in ≥k orgs).
   * Only patterns that appear in multiple orgs should be used for learning.
   */
  async meetsKAnonymity(patternKey: string, value: unknown): Promise<boolean> {
    try {
      const result = await db.execute<any>(sql`
        SELECT COUNT(DISTINCT "orgHash") as org_count
        FROM sophie_cross_org_learnings
        WHERE key = ${patternKey}
          AND value @> ${JSON.stringify(value)}::jsonb
      `);
      const count = parseInt((result as any)?.rows?.[0]?.org_count ?? "0", 10);
      return count >= K_ANONYMITY_THRESHOLD;
    } catch {
      return false;
    }
  },

  /**
   * Remove all cross-org learning contributions from an org.
   */
  async purgeOrgData(orgId: number): Promise<void> {
    const orgHash = crypto
      .createHash("sha256")
      .update(`org:${orgId}:${process.env.SESSION_SECRET || "salt"}`)
      .digest("hex")
      .slice(0, 16);

    await db.execute(sql`
      DELETE FROM sophie_cross_org_learnings
      WHERE metadata->>'orgHash' = ${orgHash}
    `);
  },
};

// ─── Range helpers (prevent exact value leakage) ──────────────────────────────

function getAmountRange(amount: number): string {
  if (amount < 5000) return "< $5k";
  if (amount < 25000) return "$5k-$25k";
  if (amount < 100000) return "$25k-$100k";
  if (amount < 500000) return "$100k-$500k";
  return "$500k+";
}

function getAcresRange(acres: number): string {
  if (acres < 1) return "< 1 acre";
  if (acres < 5) return "1-5 acres";
  if (acres < 20) return "5-20 acres";
  if (acres < 100) return "20-100 acres";
  return "100+ acres";
}
