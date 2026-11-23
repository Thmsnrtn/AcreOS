/**
 * Pax wholesale tool family (promised bar item (c) for residential_wholesaler).
 *
 * Reads and the one record change go through the SAME service layer the REST
 * routes use: `buyBoxTriage` (routes-wholesale-buy-box), `decisionStore` /
 * `outcomeStore` and `disposition` (routes-wholesale-disposition), the
 * `contract_assignments` read behind GET /api/deals/:id/assignments, the blast
 * reads behind /api/buyer-blasts, and `buyerResponse` (PATCH
 * /api/buyer-blasts/recipients/:id). The organization always comes from the
 * session (`orgId`), never from a model-supplied argument.
 *
 * THE COMPLIANCE GATE BINDS PAX. The disposition packet is what an operator
 * hands their buyers about a property held under an assignable contract. The
 * REST packet route is a pure derivation, but the blast it feeds is gated in
 * every state that restricts assignment advertising. This module runs the packet
 * through `offerComplianceGate` (the REST blast's own gate, previewOnly) BEFORE
 * deriving anything, so a `wholesaler_compliance_blocked` state refuses through
 * the AI door exactly as it refuses through the REST door — a tool that
 * skipped it would recreate the IL-block defect through Pax. A warn is surfaced,
 * never acknowledged: an acknowledgement is the operator's own recorded act.
 *
 * NOT here, by FD5 and W-DEF-1: sending or blasting. A wholesale blast is
 * counterparty email and goes out only on the org's own connected identity, from
 * the product, behind a human. No tool here can reach a send path.
 */
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  buyerBlastRecipients,
  buyerBlasts,
  buyerProfiles,
  buyerPropertyMatches,
  contractAssignments,
  deals,
  leads,
  properties,
} from "@shared/schema";
import { toolRefusal, type RefusalParts } from "@shared/refusal/plainRefusal";
import { CANDIDATE_STATUSES } from "@shared/wholesale/buyBox";
import { clock } from "../utils/clock";

type WholesaleToolOutcome = { ok: true; data: Record<string, unknown> } | { ok: false; refusal: RefusalParts };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUYER_LIST_CAP = 50;
const MATCH_CAP = 25;
const BLAST_CAP = 10;
const RECIPIENT_CAP = 100;
const NOTES_CAP = 4_000;

/** The cross-book honesty sentence (RW-D): what a wholesale answer never covers. */
const OWN_BUYERS_ONLY =
  "It covers this account's OWN buyer list only — buyers you entered or imported here. It does not include any other account's buyers, a shared buyer network, or buyers you have not added.";
const OWN_BOOK_NOT_COVERED = "It does not include any other account's deals, buyers or records.";

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

function refuse(what: string, why: string, unlock: string): WholesaleToolOutcome {
  return { ok: false, refusal: { what, why, unlock } };
}
const noDeal = () =>
  refuse("No deal with that number is in this account", "It may have been removed, or the number came from another list", "Ask me to list your deals and pick the one you mean");
const noProperty = () =>
  refuse("No property with that number is in this account", "It may have been removed, or the number came from another list", "Ask me to list your properties and pick the one you mean");
const needDeal = () =>
  refuse("I need to know which deal you mean", "These answers are about one deal at a time", "Tell me the deal, or ask me to list your deals first");

function positiveInt(v: unknown): number | null {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

async function loadDeal(orgId: number, dealId: unknown) {
  const id = positiveInt(dealId);
  if (id === null) return "bad_id" as const;
  const { db } = await import("../db");
  const [row] = await db
    .select({ id: deals.id, propertyId: deals.propertyId, type: deals.type, status: deals.status })
    .from(deals)
    .where(and(eq(deals.id, id), eq(deals.organizationId, orgId), isNull(deals.deletedAt)))
    .limit(1);
  return row ?? null;
}

async function loadProperty(orgId: number, propertyId: number) {
  const { db } = await import("../db");
  const [row] = await db
    .select({ id: properties.id, address: properties.address, state: properties.state, county: properties.county, status: properties.status })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId), isNull(properties.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** The deal and its property, both this org's — or the refusal to return. */
type DealRow = Exclude<Awaited<ReturnType<typeof loadDeal>>, "bad_id" | null>;
type PropertyRow = NonNullable<Awaited<ReturnType<typeof loadProperty>>>;
type DealAndProperty = { refusal: WholesaleToolOutcome } | { deal: DealRow; property: PropertyRow };

async function dealAndProperty(orgId: number, dealId: unknown): Promise<DealAndProperty> {
  const deal = await loadDeal(orgId, dealId);
  if (deal === "bad_id") return { refusal: needDeal() };
  if (!deal) return { refusal: noDeal() };
  const property = await loadProperty(orgId, deal.propertyId);
  if (!property) return { refusal: noProperty() };
  return { deal, property };
}

// ── The compliance gate, run exactly as the REST blast preview runs it ───────

type GateView =
  | { status: "not_applicable"; statement: string }
  | { status: "clear"; statement: string }
  | { status: "warn"; statement: string; recommendation?: unknown; citation?: unknown }
  | { status: "blocked"; statement: string; recommendation?: unknown; citation?: unknown };

async function gateFor(orgId: number, userId: string | null, property: { id: number; status: string | null; state: string | null }): Promise<GateView> {
  const { offerComplianceGate } = await import("../services/wholesale/offerCompliance");
  const g = await offerComplianceGate({
    organizationId: orgId,
    userId,
    property: { id: property.id, status: property.status, state: property.state },
    surface: "buyer_blast",
    acknowledged: false,
    previewOnly: true,
  });
  if (!g.ok) {
    if (g.status === 503) return { status: "blocked", statement: String(g.body.message ?? "The compliance check could not be completed.") };
    return { status: "blocked", statement: String(g.body.message ?? "Assignment advertising is blocked in this state."), recommendation: g.body.recommendation, citation: g.body.citation };
  }
  if (!g.applies) return { status: "not_applicable", statement: "The state assignment-advertising gate applies only to a property held under an assignable contract; this one is not." };
  if (g.warning) {
    return {
      status: "warn",
      statement: String(g.warning.message ?? "This state warns on assignment advertising."),
      recommendation: g.warning.recommendation,
      citation: g.warning.citation,
    };
  }
  return { status: "clear", statement: "The state assignment-advertising gate raised no block or warning for this property's state. That is a rule check on the seeded states, not legal advice." };
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function paxGetWholesaleBuyBox(orgId: number): Promise<WholesaleToolOutcome> {
  const { buyBoxVersionsFor } = await import("../services/wholesale/buyBoxTriage");
  const versions = await buyBoxVersionsFor(orgId);
  const current = versions[0] ?? null;
  return {
    ok: true,
    data: {
      coverage:
        "Coverage: this answer reads THIS account's wholesale buy box only (the criteria you saved here, and its version history). " +
        "It does not include any other account's criteria, or a buy box you have not saved.",
      hasBuyBox: current !== null,
      current: current ? { version: current.version, criteria: current.criteria, savedAt: current.createdAt } : null,
      versionCount: versions.length,
      history: versions.slice(0, 10).map((v) => ({ version: v.version, savedAt: v.createdAt })),
      ...(current ? {} : { statement: "No buy box is saved yet. Triage means nothing until one is — the customer saves it on the Wholesale Buy box screen." }),
    },
  };
}

export async function paxGetWholesaleTriage(orgId: number, args: { deal_id?: unknown }): Promise<WholesaleToolOutcome> {
  const dp = await dealAndProperty(orgId, args.deal_id);
  if ("refusal" in dp) return dp.refusal;
  const { triageForOrg } = await import("../services/wholesale/buyBoxTriage");
  const read = await triageForOrg(orgId, clock.now(), { propertyId: dp.property.id });
  if (read.kind === "no_buy_box") {
    return refuse("There is no buy box to score this deal against", "Triage compares a property with the criteria you saved, and none are saved yet", "Ask the customer to save their buy box first, then ask me again");
  }
  const coverage =
    "Coverage: this answer scores ONE of THIS account's properties against THIS account's current buy box (version " +
    `${read.buyBoxVersion}), using only facts recorded here. A criterion with nothing recorded is reported as unknown, never as a pass. ${OWN_BOOK_NOT_COVERED}`;
  const row = read.rows[0] ?? null;
  if (!row) {
    return {
      ok: true,
      data: {
        coverage,
        scored: false,
        propertyId: dp.property.id,
        propertyStatus: dp.property.status,
        statement: `Not scored: triage scores candidates (${CANDIDATE_STATUSES.join(", ")}), and this property's status is ${dp.property.status ?? "not set"}.`,
      },
    };
  }
  return { ok: true, data: { coverage, scored: true, buyBoxVersion: read.buyBoxVersion, dealId: dp.deal.id, fit: row } };
}

function buyerPrefsSummary(b: { preferences: unknown; financialInfo: unknown; intent: unknown; engagement: unknown }) {
  const p = (b.preferences ?? {}) as Record<string, unknown>;
  const f = (b.financialInfo ?? {}) as Record<string, unknown>;
  const i = (b.intent ?? {}) as Record<string, unknown>;
  const e = (b.engagement ?? {}) as Record<string, unknown>;
  return {
    states: p.states ?? null,
    counties: p.counties ?? null,
    minPrice: p.minPrice ?? null,
    maxPrice: p.maxPrice ?? null,
    financingType: f.financingType ?? null,
    proofOfFunds: f.preApproved ?? null,
    purchaseTimeline: i.purchaseTimeline ?? null,
    lastContactDate: e.lastContactDate ?? null,
  };
}

export async function paxGetWholesaleBuyers(orgId: number, args: { include_inactive?: unknown }): Promise<WholesaleToolOutcome> {
  const { db } = await import("../db");
  const includeInactive = args.include_inactive === true;
  const conds = [eq(buyerProfiles.organizationId, orgId)];
  if (!includeInactive) conds.push(eq(buyerProfiles.isActive, true));
  const [{ total }] = await db.select({ total: count() }).from(buyerProfiles).where(and(...conds));
  const rows = await db
    .select({
      id: buyerProfiles.id,
      profileType: buyerProfiles.profileType,
      isActive: buyerProfiles.isActive,
      preferences: buyerProfiles.preferences,
      financialInfo: buyerProfiles.financialInfo,
      intent: buyerProfiles.intent,
      engagement: buyerProfiles.engagement,
      firstName: leads.firstName,
      lastName: leads.lastName,
    })
    .from(buyerProfiles)
    // Only the org's own lead names a buyer; name only — no email or phone leaves here.
    .leftJoin(leads, and(eq(leads.id, buyerProfiles.leadId), eq(leads.organizationId, orgId)))
    .where(and(...conds))
    .orderBy(desc(buyerProfiles.updatedAt))
    .limit(BUYER_LIST_CAP);
  const capped = Number(total) > rows.length;
  return {
    ok: true,
    data: {
      coverage:
        `Coverage: ${OWN_BUYERS_ONLY} ${total} buyer${Number(total) === 1 ? "" : "s"} match (${includeInactive ? "active and inactive" : "active only"}); ${rows.length} shown` +
        (capped ? `, most recently updated first — capped at ${BUYER_LIST_CAP}; more exist.` : "."),
      total: Number(total),
      buyers: rows.map((r) => ({
        buyerProfileId: r.id,
        name: [r.firstName, r.lastName].filter(Boolean).join(" ") || null,
        profileType: r.profileType,
        active: r.isActive !== false,
        ...buyerPrefsSummary(r),
      })),
    },
  };
}

export async function paxGetWholesaleBuyerMatches(orgId: number, userId: string | null, args: { deal_id?: unknown }): Promise<WholesaleToolOutcome> {
  const dp = await dealAndProperty(orgId, args.deal_id);
  if ("refusal" in dp) return dp.refusal;
  const { db } = await import("../db");
  const conds = [
    eq(buyerPropertyMatches.organizationId, orgId),
    eq(buyerPropertyMatches.propertyId, dp.property.id),
    eq(buyerProfiles.isActive, true),
  ];
  const [{ total }] = await db
    .select({ total: count() })
    .from(buyerPropertyMatches)
    .innerJoin(buyerProfiles, and(eq(buyerProfiles.id, buyerPropertyMatches.buyerProfileId), eq(buyerProfiles.organizationId, orgId)))
    .where(and(...conds));
  const rows = await db
    .select({
      buyerProfileId: buyerPropertyMatches.buyerProfileId,
      matchScore: buyerPropertyMatches.matchScore,
      matchReasons: buyerPropertyMatches.matchReasons,
      potentialConcerns: buyerPropertyMatches.potentialConcerns,
      status: buyerPropertyMatches.status,
      financialInfo: buyerProfiles.financialInfo,
      firstName: leads.firstName,
      lastName: leads.lastName,
    })
    .from(buyerPropertyMatches)
    .innerJoin(buyerProfiles, and(eq(buyerProfiles.id, buyerPropertyMatches.buyerProfileId), eq(buyerProfiles.organizationId, orgId)))
    .leftJoin(leads, and(eq(leads.id, buyerProfiles.leadId), eq(leads.organizationId, orgId)))
    .where(and(...conds))
    .orderBy(desc(buyerPropertyMatches.matchScore))
    .limit(MATCH_CAP);
  const gate = await gateFor(orgId, userId, dp.property);
  const capped = Number(total) > rows.length;
  return {
    ok: true,
    data: {
      coverage:
        `Coverage: this answer reads the matches STORED for ONE of THIS account's properties against THIS account's OWN buyer list only — ${OWN_BUYERS_ONLY} ` +
        `It shows the scores from the last time matching ran; asking does not re-run matching. ${total} active buyer match${Number(total) === 1 ? "" : "es"}; ${rows.length} shown` +
        (capped ? `, best score first — capped at ${MATCH_CAP}; more exist.` : ", best score first.") +
        " A blast would also skip buyers who opted out and buyers who already had two blasts this week.",
      dealId: dp.deal.id,
      propertyId: dp.property.id,
      total: Number(total),
      matches: rows.map((r) => ({
        buyerProfileId: r.buyerProfileId,
        name: [r.firstName, r.lastName].filter(Boolean).join(" ") || null,
        matchScore: r.matchScore,
        reasons: r.matchReasons ?? [],
        concerns: r.potentialConcerns ?? [],
        status: r.status,
        financingType: ((r.financialInfo ?? {}) as Record<string, unknown>).financingType ?? null,
      })),
      blastGate: gate,
      ...(Number(total) === 0 ? { statement: "No stored matches for this property. Matching has not run for it, or no active buyer fits; I cannot tell which, and I did not run it." } : {}),
    },
  };
}

export async function paxGetWholesaleAssignments(orgId: number, args: { deal_id?: unknown }): Promise<WholesaleToolOutcome> {
  const deal = await loadDeal(orgId, args.deal_id);
  if (deal === "bad_id") return needDeal();
  if (!deal) return noDeal();
  const { db } = await import("../db");
  const rows = await db
    .select()
    .from(contractAssignments)
    .where(and(eq(contractAssignments.organizationId, orgId), eq(contractAssignments.dealId, deal.id)))
    .orderBy(desc(contractAssignments.createdAt));
  const signed = rows.filter((r) => r.status === "signed");
  const signedFeeCents = signed.reduce((s, r) => s + Number(r.assignmentFeeCents), 0);
  return {
    ok: true,
    data: {
      coverage:
        "Coverage: this answer reads the contract assignments recorded on ONE deal in THIS account. " +
        `An assignment fee is a RECORD of the fee in the contract — AcreOS holds and moves no money. Only a signed assignment counts toward the fee total. ${OWN_BOOK_NOT_COVERED}`,
      dealId: deal.id,
      assignments: rows.map((r) => ({
        assignmentId: r.id,
        status: r.status,
        assignmentFeeCents: Number(r.assignmentFeeCents),
        assignmentFee: usd(Number(r.assignmentFeeCents)),
        endBuyer: r.endBuyerName ?? (r.endBuyerProfileId ? `buyer profile ${r.endBuyerProfileId}` : null),
        originalContractDate: r.originalContractDate ?? null,
        notes: r.notes ?? null,
      })),
      signedCount: signed.length,
      signedFeeCents,
      signedFee: usd(signedFeeCents),
      ...(rows.length === 0 ? { statement: "No assignment is recorded on this deal." } : signed.length === 0 ? { statement: "No assignment on this deal is signed yet, so no fee is counted." } : {}),
    },
  };
}

export async function paxGetWholesaleDecision(orgId: number, args: { deal_id?: unknown }): Promise<WholesaleToolOutcome> {
  const dp = await dealAndProperty(orgId, args.deal_id);
  if ("refusal" in dp) return dp.refusal;
  const { decisionsForSubject } = await import("../services/decisions/decisionStore");
  const { outcomesForDecision } = await import("../services/outcomes/outcomeStore");
  const history = await decisionsForSubject(orgId, "property", dp.property.id);
  const latest = history.find((d) => d.body.strategyPackId === "residential_wholesaler" && d.body.scenarios.some((s) => s.engineId === "wholesale_mao")) ?? null;
  const coverage =
    "Coverage: this answer reads the latest wholesale underwriting decision THIS account recorded on ONE property (the max-allowable-offer scenario it cited), and the outcomes recorded against it. " +
    "Comps and ARV in it are the operator's own inputs — AcreOS supplies no residential comps. A decision is the operator's act on the Underwrite screen; I can read it, never make one. " +
    OWN_BOOK_NOT_COVERED;
  if (!latest) {
    return { ok: true, data: { coverage, dealId: dp.deal.id, propertyId: dp.property.id, decision: null, statement: "No wholesale underwriting decision is recorded on this property yet." } };
  }
  const outcomes = await outcomesForDecision(orgId, latest.id);
  return {
    ok: true,
    data: {
      coverage,
      dealId: dp.deal.id,
      propertyId: dp.property.id,
      decision: {
        decisionId: latest.id,
        decidedAt: latest.decidedAt,
        kind: latest.body.kind,
        choice: latest.body.choice,
        rationale: latest.body.rationale,
        reviewDueAt: latest.body.reviewDueAt,
        unknownsRecorded: latest.body.unknowns.length,
        scenarios: latest.body.scenarios.map((s) => ({ engineId: s.engineId, scenarioId: s.scenarioId, predicted: s.predicted })),
      },
      outcomes: outcomes.map((o) => ({ outcomeId: o.id, observedAt: o.observedAt, kind: o.body.kind, summary: o.body.summary, actuals: o.body.actuals, varianceSummary: o.varianceSummary })),
      ...(outcomes.length === 0 ? { statement: "No outcome is recorded against this decision yet." } : {}),
    },
  };
}

export async function paxGetWholesaleDispositionPacket(orgId: number, userId: string | null, args: { deal_id?: unknown }): Promise<WholesaleToolOutcome> {
  const dp = await dealAndProperty(orgId, args.deal_id);
  if ("refusal" in dp) return dp.refusal;

  // The gate first — a block refuses before anything is derived, as the REST blast preview does.
  const gate = await gateFor(orgId, userId, dp.property);
  if (gate.status === "blocked") {
    return {
      ok: false,
      refusal: {
        what: "I did not prepare a disposition packet for this property",
        why: `${gate.statement}${gate.citation ? ` (${String(gate.citation)})` : ""} This is the same state rule that blocks the buyer blast.`,
        unlock: "The customer can talk to their attorney about this state; the packet is not prepared until the rule allows offering it",
      },
    };
  }

  const { buildDispositionPacket, DispositionRefusal } = await import("../services/wholesale/disposition");
  let packet;
  try {
    packet = await buildDispositionPacket(orgId, dp.property.id, clock.now());
  } catch (err) {
    if (err instanceof DispositionRefusal) {
      if (err.status === 404) return noProperty();
      return refuse("I could not prepare a disposition packet", err.message, "Fix what that says on the deal or the underwriting, then ask me again");
    }
    throw err;
  }
  return {
    ok: true,
    data: {
      coverage:
        "Coverage: a PREVIEW of the packet for ONE of THIS account's deals, derived just now from the deal's accepted contract price and this account's own underwriting decision. " +
        "Nothing was stored and nothing was sent. The figures and comps are the operator's own estimates.",
      prepared: true,
      sent: false,
      statement:
        "PREPARED, NOT SENT. This is a preview only. To send it, the customer uses Buyer blast, which goes out under their OWN connected email identity and runs the state compliance check again. I cannot send it.",
      compliance: gate,
      dealId: packet.dealId,
      propertyId: packet.propertyId,
      decisionId: packet.decisionId,
      derivedAt: packet.derivedAt,
      subject: packet.subject,
      price: packet.price,
      html: packet.html,
    },
  };
}

export async function paxGetWholesaleBlasts(orgId: number, args: { deal_id?: unknown }): Promise<WholesaleToolOutcome> {
  const dp = await dealAndProperty(orgId, args.deal_id);
  if ("refusal" in dp) return dp.refusal;
  const { db } = await import("../db");
  const blasts = await db
    .select()
    .from(buyerBlasts)
    .where(and(eq(buyerBlasts.organizationId, orgId), eq(buyerBlasts.propertyId, dp.property.id)))
    .orderBy(desc(buyerBlasts.createdAt))
    .limit(BLAST_CAP);
  const ids = blasts.map((b) => b.id);
  const recipients = ids.length
    ? await db
        .select({
          recipientId: buyerBlastRecipients.id,
          blastId: buyerBlastRecipients.blastId,
          buyerProfileId: buyerBlastRecipients.buyerProfileId,
          status: buyerBlastRecipients.status,
          sentAt: buyerBlastRecipients.sentAt,
          respondedAt: buyerBlastRecipients.respondedAt,
          responseNotes: buyerBlastRecipients.responseNotes,
          failureReason: buyerBlastRecipients.failureReason,
          firstName: leads.firstName,
          lastName: leads.lastName,
        })
        .from(buyerBlastRecipients)
        .innerJoin(buyerProfiles, and(eq(buyerProfiles.id, buyerBlastRecipients.buyerProfileId), eq(buyerProfiles.organizationId, orgId)))
        .leftJoin(leads, and(eq(leads.id, buyerProfiles.leadId), eq(leads.organizationId, orgId)))
        .where(and(eq(buyerBlastRecipients.organizationId, orgId), inArray(buyerBlastRecipients.blastId, ids)))
        .orderBy(desc(buyerBlastRecipients.sentAt))
        .limit(RECIPIENT_CAP)
    : [];
  return {
    ok: true,
    data: {
      coverage:
        `Coverage: this answer reads the buyer blasts THIS account already sent for ONE property, and each recipient's recorded status — a record of what happened, read-only. Up to ${BLAST_CAP} newest blasts and ${RECIPIENT_CAP} recipients. ` +
        `${OWN_BOOK_NOT_COVERED} I cannot send or re-send a blast.`,
      dealId: dp.deal.id,
      propertyId: dp.property.id,
      blasts: blasts.map((b) => ({ blastId: b.id, subject: b.subject, status: b.status, createdAt: b.createdAt })),
      recipients: recipients.map((r) => ({
        recipientId: r.recipientId,
        blastId: r.blastId,
        buyerProfileId: r.buyerProfileId,
        name: [r.firstName, r.lastName].filter(Boolean).join(" ") || null,
        status: r.status,
        sentAt: r.sentAt,
        respondedAt: r.respondedAt,
        responseNotes: r.responseNotes ?? null,
        failureReason: r.failureReason ?? null,
      })),
      ...(blasts.length === 0 ? { statement: "No buyer blast has been sent for this property." } : {}),
    },
  };
}

// ── The one record change ────────────────────────────────────────────────────

/** The only statuses Pax may record: what a buyer SAID. Delivery states belong to the mail system. */
const PAX_BUYER_REPLY_STATUSES = ["replied_interested", "replied_not_interested"] as const;

export async function paxRecordBuyerBlastResponse(
  orgId: number,
  args: Record<string, unknown>,
): Promise<WholesaleToolOutcome & { receipt?: { before: unknown; after: unknown; description: string } }> {
  const id = typeof args.recipient_id === "string" ? args.recipient_id.trim() : "";
  if (!UUID.test(id)) {
    return refuse("That is not a blast recipient id", "Recipient ids are long identifiers shown when you read a deal's blasts", "Ask me to show the blasts for the deal, then tell me which recipient replied");
  }
  const status = args.status === undefined || args.status === null || args.status === "" ? undefined : args.status;
  if (status !== undefined && !(PAX_BUYER_REPLY_STATUSES as readonly unknown[]).includes(status)) {
    return refuse("Nothing was recorded", "I can record only that a buyer replied interested or not interested — delivery states come from the mail system", "Tell me whether the buyer was interested, or give me a note to save");
  }
  const note = typeof args.response_notes === "string" ? args.response_notes.trim() : "";
  if (status === undefined && !note) {
    return refuse("Nothing was recorded", "There is no reply status and no note to save", "Tell me what the buyer said, or whether they were interested");
  }

  const { db } = await import("../db");
  const [existing] = await db
    .select({ id: buyerBlastRecipients.id, status: buyerBlastRecipients.status, responseNotes: buyerBlastRecipients.responseNotes, blastId: buyerBlastRecipients.blastId })
    .from(buyerBlastRecipients)
    .where(and(eq(buyerBlastRecipients.id, id), eq(buyerBlastRecipients.organizationId, orgId)))
    .limit(1);
  if (!existing) {
    return refuse("No blast recipient with that id is in this account", "It may have come from another list, or the blast was removed", "Ask me to show the blasts for the deal and use a recipient id from there");
  }
  // A note is ADDED to what is already recorded, never written over it.
  const merged = [existing.responseNotes?.trim(), note].filter(Boolean).join("\n");
  if (merged.length > NOTES_CAP) {
    return refuse("Nothing was recorded", `The notes on this recipient would pass ${NOTES_CAP} characters`, "Give me a shorter note, or have the customer tidy the existing notes");
  }

  const { recordBlastRecipientResponse, recipientResponseSchema } = await import("../services/wholesale/buyerResponse");
  const parsed = recipientResponseSchema.safeParse({ ...(status !== undefined ? { status } : {}), ...(note ? { responseNotes: merged } : {}) });
  if (!parsed.success) {
    return refuse("Nothing was recorded", `The reply is malformed: ${parsed.error.issues.map((i) => `${i.path.join(".") || "reply"} — ${i.message}`).join("; ")}`, "Tell me the buyer's reply again");
  }
  const row = await recordBlastRecipientResponse(orgId, id, parsed.data);
  if (!row) {
    return refuse("No blast recipient with that id is in this account", "It may have come from another list, or the blast was removed", "Ask me to show the blasts for the deal and use a recipient id from there");
  }
  const before = { status: existing.status, responseNotes: existing.responseNotes ?? null };
  const after = { status: row.status, responseNotes: row.responseNotes ?? null };
  return {
    ok: true,
    data: {
      message: "Recorded the buyer's reply on the blast recipient. This is a record of what the customer told me; nothing was sent to anyone.",
      recipientId: row.id,
      before,
      after,
    },
    receipt: {
      before,
      after,
      description: `Recorded a buyer's reply on a blast recipient${status ? ` (${status === "replied_interested" ? "interested" : "not interested"})` : " (note added)"}`,
    },
  };
}

/** Plain-words converter for the executor. */
export function wholesaleOutcomeToResult(o: WholesaleToolOutcome): { success: boolean; data?: Record<string, unknown>; refusal?: RefusalParts; error?: string } {
  return o.ok ? { success: true, data: o.data } : toolRefusal(o.refusal);
}
