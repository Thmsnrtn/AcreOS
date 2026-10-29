/**
 * The redemption clock for one certificate, from the database — V-Tax-1. The
 * rule is pure (shared/tax/clock.ts); this assembles its inputs: the deadline's
 * basis from the tax calendar, the county procedure's stated period, and the
 * quiet-title state. One computation for the clock route AND the land spend
 * gate (T4b), so the gate refuses exactly what the clock shows as locked.
 * Org-scoped throughout.
 */
import { and, eq } from "drizzle-orm";
import { noteQuietTitleCases, quietTitleSteps, taxCertificates, type TaxRuleCited } from "@shared/schema";
import { redemptionClock, type Clock } from "@shared/tax/clock";
import { clock } from "../../utils/clock";

/** What a certificate's redemption deadline rests on, in words. */
export function deadlineBasisOf(rule: TaxRuleCited | null): string {
  return rule?.kind === "county_record"
    ? `entered from the county's records — ${rule.source}`
    : rule?.kind === "preliminary_state_rule"
      ? `computed by AcreOS from its encoded ${rule.state} rule${rule.citation ? ` (${rule.citation})` : ""} — preliminary, not attorney-reviewed; confirm with the county`
      : rule?.kind === "procedure_object"
        ? `the county procedure, version ${rule.version} — ${rule.source}, as of ${rule.asOf}`
        : "on record from before AcreOS tracked where deadlines came from — confirm with the county";
}

export async function clockForCertificate(organizationId: number, row: typeof taxCertificates.$inferSelect): Promise<Clock> {
  const { db } = await import("../../db");
  const { latestTaxEvents } = await import("./taxEvents");
  const { countyBidStanding } = await import("./taxProcedures");
  const today = clock.now().toISOString().slice(0, 10);
  const events = await latestTaxEvents(organizationId, row.id);
  const deadlineBasis = deadlineBasisOf(events.redemption_expiry?.ruleCited ?? null);
  const standing = await countyBidStanding(organizationId, row.state, row.county, today);
  const period = standing.current?.fields.redemptionPeriodMonths;
  const [qt] = await db
    .select({ id: noteQuietTitleCases.id, marketException: noteQuietTitleCases.marketException })
    .from(noteQuietTitleCases)
    .where(and(eq(noteQuietTitleCases.organizationId, organizationId), eq(noteQuietTitleCases.certificateId, row.id)))
    .limit(1);
  let petitionFiledOn: string | null = null;
  if (qt) {
    const [filed] = await db
      .select({ completedAt: quietTitleSteps.completedAt })
      .from(quietTitleSteps)
      .where(and(eq(quietTitleSteps.organizationId, organizationId), eq(quietTitleSteps.caseId, qt.id), eq(quietTitleSteps.stepKey, "petition_filed")))
      .limit(1);
    petitionFiledOn = filed?.completedAt ? filed.completedAt.toISOString().slice(0, 10) : null;
  }
  return redemptionClock({
    saleType: row.saleType,
    status: row.status,
    saleDate: row.saleDate as unknown as string,
    redemptionDeadline: row.redemptionDeadline as unknown as string,
    deadlineSource: row.deadlineSource ?? null,
    deadlineBasis,
    purchaseAmountCents: row.purchaseAmountCents,
    today,
    procedurePeriod: period && standing.current ? { months: period.value, source: period.source, asOf: period.asOf, version: standing.current.version } : null,
    quietTitle: qt ? { petitionFiledOn, marketException: qt.marketException ?? null } : null,
  });
}
