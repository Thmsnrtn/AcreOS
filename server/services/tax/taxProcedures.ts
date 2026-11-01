/**
 * Procedure objects — V-Tax-1 T2a. Org-scoped reads and versioned writes.
 *
 *   - Recording a procedure creates a NEW VERSION (the table refuses edits).
 *     A new version starts unverified: changing what the county's procedure
 *     says needs the county-verification task again.
 *   - Completing the county-verification task records a new version carrying
 *     the same fields plus who verified it, when, and how.
 *   - Standing (biddable or locked, stale-law banner, county-practice flags)
 *     is the pure rule in shared/tax/procedure.ts.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { taxProcedureObjects, type TaxProcedureObject } from "@shared/schema";
import { PROCEDURE_FIELD_KEYS, procedureStanding, type CountyVerification, type ProcedureFields, type ProcedureStanding } from "@shared/tax/procedure";
import { isCalendarDate } from "@shared/dates/calendar";

const date = z.string().refine(isCalendarDate, "not a calendar date (YYYY-MM-DD)");
const field = <T extends z.ZodTypeAny>(value: T) =>
  z
    .object({
      value,
      source: z.string().trim().min(3, "cite the statute section or the county document").max(500),
      asOf: date,
      basis: z.enum(["state_law", "county_practice"]),
      verification: z.enum(["unverified", "checked_against_statute", "confirmed_with_county"]),
    })
    .strict();

export const procedureFieldsSchema = z
  .object({
    instrument: field(z.enum(["lien", "deed", "hybrid", "redeemable_deed"])).optional(),
    bidMethod: field(z.string().trim().min(1).max(300)).optional(),
    returnModel: field(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("annual_rate"), rateBps: z.number().int().min(0).max(10_000) }).strict(),
        z.object({ kind: z.literal("flat_penalty"), penaltyBps: z.number().int().min(0).max(10_000) }).strict(),
        z.object({ kind: z.literal("tiered_penalty"), schedule: z.string().trim().min(3).max(500) }).strict(),
        z.object({ kind: z.literal("none") }).strict(),
      ]),
    ).optional(),
    redemptionPeriodMonths: field(z.number().int().min(0).max(600)).optional(),
    noticeRequirements: field(z.string().trim().min(1).max(2_000)).optional(),
    foreclosurePath: field(z.string().trim().min(1).max(2_000)).optional(),
    subsequentTaxRules: field(z.string().trim().min(1).max(2_000)).optional(),
  })
  .strict();

export const countyVerificationSchema = z
  .object({ completedOn: date, method: z.string().trim().min(3, "say how it was verified (e.g. called the county tax office)").max(500) })
  .strict();

const ref = (organizationId: number, state: string, county: string) =>
  and(eq(taxProcedureObjects.organizationId, organizationId), eq(taxProcedureObjects.state, state), sql`lower(${taxProcedureObjects.county}) = lower(${county})`);

export async function procedureHistory(organizationId: number, state: string, county: string): Promise<TaxProcedureObject[]> {
  const { db } = await import("../../db");
  return db.select().from(taxProcedureObjects).where(ref(organizationId, state, county)).orderBy(desc(taxProcedureObjects.version));
}

export async function currentProcedure(organizationId: number, state: string, county: string): Promise<TaxProcedureObject | null> {
  return (await procedureHistory(organizationId, state, county))[0] ?? null;
}

export async function countyBidStanding(organizationId: number, state: string, county: string, today: string): Promise<ProcedureStanding & { current: TaxProcedureObject | null }> {
  const current = await currentProcedure(organizationId, state, county);
  return { ...procedureStanding(current, today), current };
}

async function insertVersion(organizationId: number, actor: string, state: string, county: string, fields: ProcedureFields, countyVerification: CountyVerification | null): Promise<TaxProcedureObject> {
  const { db } = await import("../../db");
  const prior = await currentProcedure(organizationId, state, county);
  const [row] = await db
    .insert(taxProcedureObjects)
    .values({ organizationId, state, county: prior?.county ?? county, version: (prior?.version ?? 0) + 1, fields, countyVerification, recordedBy: actor })
    .returning();
  return row;
}

/** Record what the county's procedure says. A new version always starts unverified. */
export async function recordProcedureVersion(organizationId: number, actor: string, state: string, county: string, fields: ProcedureFields): Promise<TaxProcedureObject> {
  // Keep only known keys, in catalogue order.
  const clean: ProcedureFields = {};
  for (const k of PROCEDURE_FIELD_KEYS) if (fields[k]) (clean as Record<string, unknown>)[k] = fields[k];
  return insertVersion(organizationId, actor, state, county, clean, null);
}

/** Complete the county-verification task for the current version. null when there is nothing to verify. */
export async function recordCountyVerification(organizationId: number, actor: string, state: string, county: string, v: { completedOn: string; method: string }): Promise<TaxProcedureObject | null> {
  const current = await currentProcedure(organizationId, state, county);
  if (!current) return null;
  return insertVersion(organizationId, actor, state, county, current.fields, { completedOn: v.completedOn, method: v.method, completedBy: actor });
}
