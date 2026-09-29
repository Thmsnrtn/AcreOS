/**
 * Cross-customer data consent (founder ruling 2026-09-29 #11, DEFECT-0154,
 * DEFECT-0159).
 *
 * Every figure AcreOS derives from one customer's data and shows to another —
 * the data-co-op county rollups, the market-network comps, credit
 * benchmarks, community county reviews, cross-org support learnings — obeys
 * two rules:
 *
 *   1. OPT-IN. Only organizations that have switched on
 *      `settings.crossOrgLearningConsent` contribute. Absent = no. A read
 *      error = no (fail closed). Consent is read AT PUBLICATION TIME by every
 *      surface (`consentingOrgIds()`), so switching it off removes the org
 *      from every figure from that moment — nothing needs deleting, and
 *      nothing an org contributed survives its opt-out.
 *   2. A 5-DISTINCT-OPERATOR FLOOR on every published figure
 *      (`MIN_DISTINCT_OPERATORS`, `meetsOperatorFloor` in
 *      dataCoop/privacyRollup.ts). A parcel or deal count is not a privacy
 *      floor: one operator's five deals made a "network" median that was
 *      that operator's pricing (DEFECT-0155, DEFECT-0159). A figure that
 *      cannot be computed from five consenting operators is not published.
 *
 * This file used to declare the rule and enforce nothing: it had no callers,
 * a k of 3, and its k-anonymity check and opt-out purge queried
 * `sophie_cross_org_learnings`, a table that does not exist (DEFECT-0154).
 */

import { db } from "../db";
import { organizations } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

/**
 * When the consent rule took effect. A materialized cross-org figure computed
 * before this was built without asking anyone and is never served (the county
 * rollups: server/routes-market-heat.ts).
 */
export const CROSS_ORG_CONSENT_EFFECTIVE_AT = new Date("2026-09-30T00:00:00Z");

export const sophiePrivacyGuard = {
  /** Has this org opted in to cross-customer data? Absent or unreadable = no. */
  async hasConsent(orgId: number): Promise<boolean> {
    try {
      const [org] = await db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, orgId));
      return org?.settings?.crossOrgLearningConsent === true;
    } catch {
      return false; // fail closed
    }
  },

  /**
   * Record the org's choice. Opting out needs no purge: every surface reads
   * consent at publication time, so the org's data leaves every figure the
   * next time it is computed or served.
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
  },
};

/**
 * The organizations whose data may appear in a cross-customer figure right
 * now. Fails closed: an error yields the empty set, so nothing is published.
 */
export async function consentingOrgIds(): Promise<Set<number>> {
  try {
    const rows = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(sql`${organizations.settings}->>'crossOrgLearningConsent' = 'true'`);
    return new Set(rows.map((r) => r.id));
  } catch {
    return new Set();
  }
}
