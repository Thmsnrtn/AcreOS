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
export function deadlineRule(state: string, source: "computed_preliminary" | "operator_entered", operatorSource?: string): TaxRuleCited {
  if (source === "operator_entered") return { kind: "county_record", source: operatorSource ?? "entered by the operator from the county's records" };
  const rule = STATE_REDEMPTION_RULES[state.toUpperCase()];
  return { kind: "preliminary_state_rule", state: state.toUpperCase(), citation: rule?.citation ?? null, note: "computed by AcreOS from its encoded state rule — preliminary, not attorney-reviewed; confirm with the county" };
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
