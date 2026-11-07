/**
 * The wholesale disposition packet and the wholesale outcome record (Leg 4).
 *
 * ── THE PACKET ──────────────────────────────────────────────────────────────
 * What an operator sends their cash buyers about a deal under contract,
 * assembled from the deal's facts and the property's frozen wholesale decision.
 *
 * THE PRICE IS RE-DERIVED AT DRAFT TIME, never read from a stored figure:
 *   buyer price = the deal's accepted contract price (now) + the target fee
 *                 the operator underwrote (frozen with the decision);
 * and it is checked against the end buyer's ceiling RE-COMPUTED from the
 * decision's frozen inputs with the engine's own function. A contract price
 * renegotiated after the decision changes the packet; nothing about it is
 * ever persisted, so there is no copy to go stale.
 *
 * The packet is a DRAFT: it writes nothing and sends nothing. It is delivered
 * only by the operator handing it to the existing buyer-blast lane (opt-out
 * filtered, cadence-guarded, the org's own sending identity), which is where
 * the assignment compliance gate decides a real send.
 *
 * NOTHING IS INVENTED. Only facts on the deal, the property and the frozen
 * scenario appear: no bedroom count, no photos, no "motivated seller". The
 * comps are the operator's own, as they entered them.
 *
 * ── THE OUTCOME ─────────────────────────────────────────────────────────────
 * Realised fee, days to close and the exit actually executed, recorded through
 * the existing outcome loop (`recordOutcome`) against the frozen decision, so
 * its variance is computed against what was predicted. The realised fee is
 * READ from the deal's own record — the signed assignment's fee, or the
 * double-close's two sides less the funder's fee — never typed a second time.
 * A record, not money: AcreOS holds and moves none of it.
 */
import { and, desc, eq, isNull, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { contractAssignments, deals, doubleCloseDeals, properties, scenarios } from "@shared/schema";
import { decisionsForSubject, getDecision, type RecordedDecision } from "../decisions/decisionStore";
import { recordOutcome, type StoredOutcome } from "../outcomes/outcomeStore";
import { computeWholesaleMao } from "../economics/engines/wholesaleMao";

export class DispositionRefusal extends Error {
  constructor(message: string, readonly status: 404 | 409 | 422 = 409) {
    super(message);
  }
}

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Dollars-as-numeric (deals.accepted_amount) to integer cents, or null. */
function centsOf(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/**
 * The property's newest wholesale OFFER decision citing a wholesale_mao
 * scenario. A `pass` is a decision not to buy: it prices nothing, so it never
 * feeds a packet.
 */
async function latestWholesaleOffer(organizationId: number, propertyId: number): Promise<RecordedDecision | null> {
  const history = await decisionsForSubject(organizationId, "property", propertyId);
  return (
    history.find(
      (d) =>
        d.body.kind === "offer" &&
        d.body.strategyPackId === "residential_wholesaler" &&
        d.body.scenarios.some((s) => s.engineId === "wholesale_mao"),
    ) ?? null
  );
}

/** The frozen scenario row a decision cites — org-scoped, by id. */
async function citedScenario(organizationId: number, decision: RecordedDecision) {
  const ref = decision.body.scenarios.find((s) => s.engineId === "wholesale_mao");
  if (!ref) return null;
  const [row] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.organizationId, organizationId), eq(scenarios.id, ref.scenarioId)))
    .limit(1);
  return row ?? null;
}

export interface DispositionPacket {
  propertyId: number;
  dealId: number;
  decisionId: number;
  scenarioId: number;
  /** When THIS derivation ran. The packet is never stored. */
  derivedAt: string;
  price: {
    contractPriceCents: number;
    targetFeeCents: number;
    buyerPriceCents: number;
    buyerSideMaoCents: number;
    withinBuyerCeiling: boolean;
  };
  subject: string;
  html: string;
}

export async function buildDispositionPacket(organizationId: number, propertyId: number, now: Date): Promise<DispositionPacket> {
  const [property] = await db
    .select({ id: properties.id, address: properties.address, city: properties.city, county: properties.county, state: properties.state, status: properties.status })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
    .limit(1);
  if (!property) throw new DispositionRefusal("Property", 404);

  const [deal] = await db
    .select({ id: deals.id, acceptedAmount: deals.acceptedAmount, closingDate: deals.closingDate })
    .from(deals)
    .where(
      and(
        eq(deals.organizationId, organizationId),
        eq(deals.propertyId, propertyId),
        eq(deals.type, "acquisition"),
        isNull(deals.deletedAt),
        isNotNull(deals.acceptedAmount),
      ),
    )
    .orderBy(desc(deals.updatedAt), desc(deals.id))
    .limit(1);
  const contractPriceCents = centsOf(deal?.acceptedAmount);
  if (!deal || contractPriceCents === null) {
    throw new DispositionRefusal("No accepted contract price on a deal for this property yet — a buyer price cannot be derived without one.");
  }

  const decision = await latestWholesaleOffer(organizationId, propertyId);
  if (!decision) throw new DispositionRefusal("Underwrite this property as a wholesale offer first — the packet's fee and buyer ceiling come from that offer decision (a pass prices nothing).");
  const scenario = await citedScenario(organizationId, decision);
  if (!scenario) throw new DispositionRefusal("The decision's scenario could not be read.");

  // RE-DERIVED now, from the frozen inputs, with the engine's own function.
  const frozen = computeWholesaleMao(scenario.inputs);
  const buyerPriceCents = contractPriceCents + frozen.targetFeeCents;
  const withinBuyerCeiling = buyerPriceCents <= frozen.buyerSideMaoCents;

  const where = [property.address, property.city, property.state].filter(Boolean).join(", ") || [property.county && `${property.county} County`, property.state].filter(Boolean).join(", ") || `Property ${property.id}`;
  const comps = (scenario.assumptions as Array<{ key: string; value: unknown; basis?: string }>).filter((a) => /^comp_\d+$/.test(a.key));
  const rehab = typeof scenario.inputs.rehabEstimateCents === "number" ? scenario.inputs.rehabEstimateCents : null;
  const arv = typeof scenario.inputs.arvCents === "number" ? scenario.inputs.arvCents : null;

  const rows: string[] = [
    `<p><strong>${escapeHtml(where)}</strong></p>`,
    `<p>Price: <strong>${usd(buyerPriceCents)}</strong> (assignment of contract)</p>`,
    ...(arv !== null ? [`<p>After-repair value: ${usd(arv)} — my estimate from the sold comps below.</p>`] : []),
    ...(rehab !== null ? [`<p>Rehab estimate: ${usd(rehab)} — my estimate, before contingency. Walk it yourself.</p>`] : []),
    ...(comps.length > 0
      ? [`<p>Sold comps:</p><ul>${comps.map((c) => `<li>${escapeHtml((c.basis ?? "").replace(/^Sold comp: /, ""))} — ${usd(Number(c.value))}</li>`).join("")}</ul>`]
      : []),
    ...(deal.closingDate ? [`<p>Closing by: ${new Date(deal.closingDate).toISOString().slice(0, 10)}</p>`] : []),
    `<p>Figures are my own estimates. Verify everything independently before you commit.</p>`,
  ];

  return {
    propertyId,
    dealId: deal.id,
    decisionId: decision.id,
    scenarioId: scenario.id,
    derivedAt: now.toISOString(),
    price: { contractPriceCents, targetFeeCents: frozen.targetFeeCents, buyerPriceCents, buyerSideMaoCents: frozen.buyerSideMaoCents, withinBuyerCeiling },
    subject: `Assignment: ${where} — ${usd(buyerPriceCents)}`,
    html: rows.join("\n"),
  };
}

// ── The outcome ─────────────────────────────────────────────────────────────

export type WholesaleExit = "assignment" | "double_close" | "walked";

export interface WholesaleOutcomeInput {
  exit: WholesaleExit;
  /** Required for `assignment`: the SIGNED contract_assignments row. */
  assignmentId?: number;
  /** Required for `double_close`: the BOTH-CLOSED double_close_deals row. */
  doubleCloseId?: string;
  /** The day it closed (or, for `walked`, the day the operator walked). */
  closedOn: string;
}

const DAY_MS = 86_400_000;

/** Whole days from the decision to the close, never negative. */
export function daysToClose(decidedAt: Date, closedOn: string): number {
  const closed = Date.parse(`${closedOn}T00:00:00Z`);
  const decided = Date.UTC(decidedAt.getUTCFullYear(), decidedAt.getUTCMonth(), decidedAt.getUTCDate());
  return Math.round((closed - decided) / DAY_MS);
}

export async function recordWholesaleOutcome(
  organizationId: number,
  decisionId: number,
  input: WholesaleOutcomeInput,
  now: Date,
): Promise<StoredOutcome & { realizedFeeCents: number | null; daysToClose: number; exit: WholesaleExit }> {
  const decision = await getDecision(organizationId, decisionId);
  if (!decision) throw new DispositionRefusal("Decision", 404);
  if (decision.body.strategyPackId !== "residential_wholesaler" || !decision.body.scenarios.some((s) => s.engineId === "wholesale_mao")) {
    throw new DispositionRefusal("This is not a wholesale decision — its outcome is recorded where it was made.", 422);
  }
  if (decision.body.subjectType !== "property") throw new DispositionRefusal("A wholesale decision is about a property.", 422);
  const propertyId = decision.body.subjectId;

  const closedMs = Date.parse(`${input.closedOn}T00:00:00Z`);
  if (!Number.isFinite(closedMs) || closedMs > now.getTime()) throw new DispositionRefusal("The close date must be a real date, not in the future.", 422);
  const days = daysToClose(decision.decidedAt, input.closedOn);
  if (days < 0) throw new DispositionRefusal("The close date is before the decision was made.", 422);

  let realizedFeeCents: number | null;
  let detail: string;
  if (input.exit === "assignment") {
    if (!input.assignmentId) throw new DispositionRefusal("Name the signed assignment this deal closed on.", 422);
    const [row] = await db
      .select({ fee: contractAssignments.assignmentFeeCents, status: contractAssignments.status, propertyId: deals.propertyId })
      .from(contractAssignments)
      .innerJoin(deals, and(eq(deals.id, contractAssignments.dealId), eq(deals.organizationId, organizationId)))
      .where(and(eq(contractAssignments.id, input.assignmentId), eq(contractAssignments.organizationId, organizationId)))
      .limit(1);
    if (!row || row.propertyId !== propertyId) throw new DispositionRefusal("Assignment", 404);
    if (row.status !== "signed") throw new DispositionRefusal(`That assignment is ${row.status}, not signed — an unsigned assignment realised nothing.`, 409);
    realizedFeeCents = Number(row.fee);
    detail = "assigned";
  } else if (input.exit === "double_close") {
    if (!input.doubleCloseId) throw new DispositionRefusal("Name the double-close this deal closed on.", 422);
    const [row] = await db
      .select()
      .from(doubleCloseDeals)
      .where(and(eq(doubleCloseDeals.id, input.doubleCloseId), eq(doubleCloseDeals.organizationId, organizationId)))
      .limit(1);
    if (!row || row.propertyId !== propertyId) throw new DispositionRefusal("Double-close", 404);
    if (row.status !== "both_closed") throw new DispositionRefusal(`That double-close is ${row.status}, not both_closed.`, 409);
    if (row.bcSidePurchasePriceCents === null) throw new DispositionRefusal("The double-close has no B-C price recorded, so its spread is unknown.", 409);
    realizedFeeCents = Number(row.bcSidePurchasePriceCents) - Number(row.aSidePurchasePriceCents) - Number(row.transactionalFunderFeeCents ?? 0);
    detail = row.transactionalFunderFeeCents === null ? "double-closed (no funder fee recorded)" : "double-closed, net of the funder's fee";
  } else {
    realizedFeeCents = null;
    detail = "walked away";
  }

  const summary =
    input.exit === "walked"
      ? `Exit: walked away on ${input.closedOn}, ${days} days after the decision. No fee realised; any earnest money lost is not recorded here.`
      : `Exit: ${detail} on ${input.closedOn}, ${days} days after the decision. Realised fee ${usd(realizedFeeCents!)}.`;

  const stored = await recordOutcome(organizationId, {
    decisionSnapshotId: decisionId,
    kind: input.exit === "walked" ? "abandoned" : "sold",
    summary,
    // A walked deal's fee is a measured nothing; its PROFIT is unknown (lost
    // earnest money is not on any record here), so it is null, never zero.
    actuals: [
      { id: "assignment_fee", value: realizedFeeCents ?? 0 },
      { id: "profit", value: realizedFeeCents },
    ],
    observedAt: new Date(closedMs),
  });
  return { ...stored, realizedFeeCents, daysToClose: days, exit: input.exit };
}
