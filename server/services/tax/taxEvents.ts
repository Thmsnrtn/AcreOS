/**
 * The tax calendar — V-Tax-1 T2b. Every write to a certificate's redemption
 * deadline registers a calendar event citing the rule it rests on; the reader
 * takes the latest per type. Append-only (tax_events, migration 0296).
 * Org-private: every read and write carries the organization id.
 */

import { and, asc, eq } from "drizzle-orm";
import { taxEvents, type TaxEvent, type TaxRuleCited } from "@shared/schema";
import { STATE_REDEMPTION_RULES } from "../redemptionClock";

type Db = Pick<typeof import("../../db")["db"], "insert" | "select">;

/** What a deadline rests on, from where it came from. */
function deadlineRule(state: string, source: "computed_preliminary" | "operator_entered", operatorSource?: string): TaxRuleCited {
  if (source === "operator_entered") return { kind: "county_record", source: operatorSource ?? "entered by the operator from the county's records" };
  const rule = STATE_REDEMPTION_RULES[state.toUpperCase()];
  return { kind: "preliminary_state_rule", state: state.toUpperCase(), citation: rule?.citation ?? null, note: "computed by AcreOS from its encoded state rule — preliminary, not attorney-reviewed; confirm with the county" };
}

/**
 * What a COMPUTED deadline rests on, with the county's procedure object
 * considered. The date is computed from AcreOS's encoded state rule; when the
 * county's current procedure is county-verified and its stated redemption
 * period gives the SAME date from the sale date, the date rests on that
 * sourced, verified period and cites it. Otherwise (no procedure, unverified,
 * no period stated, or a different date) it stays the preliminary state rule
 * — the clock's procedure cross-check then surfaces any disagreement.
 */
export async function deadlineRuleFor(
  organizationId: number,
  c: { state: string; county: string; saleDate: string; deadline: string },
  source: "computed_preliminary" | "operator_entered",
  operatorSource?: string,
): Promise<TaxRuleCited> {
  if (source === "operator_entered") return deadlineRule(c.state, source, operatorSource);
  const { currentProcedure } = await import("./taxProcedures");
  const { addMonthsIso } = await import("../redemptionClock");
  const current = await currentProcedure(organizationId, c.state, c.county);
  const period = current?.fields.redemptionPeriodMonths;
  if (current?.countyVerification && period && addMonthsIso(c.saleDate, period.value) === c.deadline) {
    return { kind: "procedure_object", procedureId: current.id, version: current.version, field: "redemptionPeriodMonths", source: period.source, asOf: period.asOf };
  }
  return deadlineRule(c.state, source);
}

/**
 * The quiet-title petition was filed: on the calendar with what it rests on —
 * the operator's record on the case, not a statute (AcreOS does not file).
 */
export async function registerQuietTitleFiled(db: Db, a: { organizationId: number; certificateId: string; caseId: string; stepId: string; date: string; recordedBy: string }): Promise<void> {
  await db.insert(taxEvents).values({
    organizationId: a.organizationId,
    certificateId: a.certificateId,
    eventType: "quiet_title_filed",
    eventDate: a.date,
    ruleCited: { kind: "county_record", source: `quiet-title case ${a.caseId}: the petition-filed step was marked complete by the operator` },
    detail: { caseId: a.caseId, stepId: a.stepId },
    recordedBy: a.recordedBy,
  });
}

export async function registerRedemptionExpiry(db: Db, a: { organizationId: number; certificateId: string; date: string; ruleCited: TaxRuleCited; recordedBy: string; detail?: Record<string, unknown> }): Promise<void> {
  await db.insert(taxEvents).values({
    organizationId: a.organizationId,
    certificateId: a.certificateId,
    eventType: "redemption_expiry",
    eventDate: a.date,
    ruleCited: a.ruleCited,
    detail: a.detail ?? {},
    recordedBy: a.recordedBy,
  });
}

/** The latest registration of each event type for one certificate (org-scoped). */
export async function latestTaxEvents(organizationId: number, certificateId: string): Promise<Partial<Record<TaxEvent["eventType"], TaxEvent>>> {
  const { db } = await import("../../db");
  const rows = await db
    .select()
    .from(taxEvents)
    .where(and(eq(taxEvents.organizationId, organizationId), eq(taxEvents.certificateId, certificateId)))
    .orderBy(asc(taxEvents.recordedAt));
  const out: Partial<Record<TaxEvent["eventType"], TaxEvent>> = {};
  for (const r of rows) out[r.eventType] = r;
  return out;
}
