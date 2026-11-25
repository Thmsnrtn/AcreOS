/**
 * The buy box's versions and the candidate triage read — ONE implementation
 * for both doors (REST routes-wholesale-buy-box.ts and the Pax wholesale tools),
 * so a candidate's fit can never read differently in chat than on the screen.
 *
 * Reads only what the org already holds; writes nothing.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { decisionSnapshots, deals, properties, wholesaleBuyBoxes } from "@shared/schema";
import { buyBoxCriteriaSchema, CANDIDATE_STATUSES, triageCandidates, type CandidateFacts, type TriageRow } from "@shared/wholesale/buyBox";

/** A buy box's history is short; the cap is a runaway-writer guard. */
const VERSION_READ_CAP = 100;
/** Triage reads at most this many candidates, newest first, and says so. */
const CANDIDATE_CAP = 500;

export async function buyBoxVersionsFor(organizationId: number) {
  return db
    .select()
    .from(wholesaleBuyBoxes)
    .where(eq(wholesaleBuyBoxes.organizationId, organizationId))
    .orderBy(desc(wholesaleBuyBoxes.version))
    .limit(VERSION_READ_CAP);
}

const centsOf = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const later = (...ds: Array<Date | null | undefined>): Date | null =>
  ds.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);

export type TriageRead =
  | { kind: "no_buy_box" }
  | { kind: "ok"; buyBoxVersion: number; candidatesRead: number; capped: boolean; rows: TriageRow[] };

/** Score the org's candidates (optionally just one property) against its current buy box. */
export async function triageForOrg(organizationId: number, now: Date, opts: { propertyId?: number } = {}): Promise<TriageRead> {
  const [box] = await buyBoxVersionsFor(organizationId);
  if (!box) return { kind: "no_buy_box" };
  const criteria = buyBoxCriteriaSchema.parse(box.criteria);

  const propConds = [eq(properties.organizationId, organizationId), inArray(properties.status, [...CANDIDATE_STATUSES]), isNull(properties.deletedAt)];
  if (opts.propertyId !== undefined) propConds.push(eq(properties.id, opts.propertyId));
  const props = await db
    .select({ id: properties.id, address: properties.address, apn: properties.apn, state: properties.state, county: properties.county, zip: properties.zip, updatedAt: properties.updatedAt })
    .from(properties)
    .where(and(...propConds))
    .orderBy(desc(properties.updatedAt), desc(properties.id))
    .limit(CANDIDATE_CAP);
  const ids = props.map((p) => p.id);

  const dealRows = ids.length
    ? await db
        .select({ propertyId: deals.propertyId, offerAmount: deals.offerAmount, acceptedAmount: deals.acceptedAmount, updatedAt: deals.updatedAt })
        .from(deals)
        .where(and(eq(deals.organizationId, organizationId), inArray(deals.propertyId, ids), eq(deals.type, "acquisition"), isNull(deals.deletedAt)))
        .orderBy(desc(deals.updatedAt))
    : [];
  const decisionRows = ids.length
    ? await db
        .select({ subjectId: decisionSnapshots.subjectId, scenarios: decisionSnapshots.scenarios, decidedAt: decisionSnapshots.decidedAt })
        .from(decisionSnapshots)
        .where(
          and(
            eq(decisionSnapshots.organizationId, organizationId),
            eq(decisionSnapshots.subjectType, "property"),
            inArray(decisionSnapshots.subjectId, ids),
            eq(decisionSnapshots.strategyPackId, "residential_wholesaler"),
          ),
        )
        .orderBy(desc(decisionSnapshots.decidedAt))
    : [];

  const candidates: CandidateFacts[] = props.map((p) => {
    const deal = dealRows.find((d) => d.propertyId === p.id); // newest first
    const decision = decisionRows.find((d) => d.subjectId === p.id); // newest first
    const fee = decision?.scenarios.flatMap((s) => s.predicted).find((m) => m.id === "assignment_fee")?.value;
    return {
      propertyId: p.id,
      label: p.address || (p.apn ? `APN ${p.apn}` : `Property ${p.id}`),
      state: p.state,
      county: p.county,
      zip: p.zip,
      priceCents: centsOf(deal?.acceptedAmount) ?? centsOf(deal?.offerAmount),
      underwrittenFeeCents: typeof fee === "number" ? fee : null,
      lastActivityAt: later(p.updatedAt, deal?.updatedAt, decision?.decidedAt),
    };
  });

  return {
    kind: "ok",
    buyBoxVersion: box.version,
    candidatesRead: props.length,
    capped: props.length === CANDIDATE_CAP,
    rows: triageCandidates(criteria, candidates, now),
  };
}
