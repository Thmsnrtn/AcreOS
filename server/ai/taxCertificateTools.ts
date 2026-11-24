/**
 * Pax tax-certificate tool family (T7, promised bar item (c)).
 *
 * The reads and the one record change go through the SAME service layer the
 * REST routes use (routes-tax-certificates.ts): `clockForCertificate`,
 * `buildCertificateLedger`, `recordLedgerEntry`, `computeRedemptionAmount`,
 * and the one shared ledger-entry schema. The organization always comes from
 * the session (`orgId`), never from a model-supplied argument.
 *
 * NOT here, by founder decision FD5: sending a redemption notice. Pax drafts
 * and asks; the send stays on the Settlement & Documents Rail
 * (POST /api/tax-certificates/:id/redemption-notice) behind a human tap.
 *
 * Simulation honesty (T-DEF-4): the ledger projection drops the rail receipt's
 * `testMode` marker. These reads re-read the notice events and carry it, so a
 * simulated notice is never described as mailed.
 */
import { and, asc, eq } from "drizzle-orm";
import { taxCertificates, taxEvents, TAX_CERT_STATUSES } from "@shared/schema";
import { toolRefusal, type RefusalParts } from "@shared/refusal/plainRefusal";
import { computeRedemptionAmount } from "../services/redemptionClock";
import { ledgerEntrySchema, happenedOnOf } from "../services/tax/ledgerEntryInput";
import { clock } from "../utils/clock";

export type TaxToolOutcome = { ok: true; data: Record<string, unknown> } | { ok: false; refusal: RefusalParts };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_CAP = 100;

const TAX_BOOK_NOT_COVERED =
  "It does not include tax-sale listings, lots you have not bought, or any other account's certificates.";

function taxCertificateCoverage(shown: number, total: number, filters: string): string {
  return (
    `Coverage: this answer reads THIS account's tax certificates only (${total} match${total === 1 ? "es" : ""}${filters}; ${shown} shown). ` +
    TAX_BOOK_NOT_COVERED
  );
}

const noCertificate = (): TaxToolOutcome => ({
  ok: false,
  refusal: {
    what: "No tax certificate with that id is in this account",
    why: "It may have been removed, or the id came from another list",
    unlock: "Ask me to list your tax certificates and pick the one you mean",
  },
});

const badId = (): TaxToolOutcome => ({
  ok: false,
  refusal: {
    what: "That is not a tax certificate id",
    why: "Certificate ids are long identifiers, not the certificate number printed on the paper",
    unlock: "Ask me to list your tax certificates and use the id it shows",
  },
});

async function loadCertificate(orgId: number, certificateId: unknown) {
  if (typeof certificateId !== "string" || !UUID.test(certificateId.trim())) return "bad_id" as const;
  const { db } = await import("../db");
  const [row] = await db
    .select()
    .from(taxCertificates)
    .where(and(eq(taxCertificates.id, certificateId.trim()), eq(taxCertificates.organizationId, orgId)))
    .limit(1);
  return row ?? null;
}

function redemptionAmountFor(row: typeof taxCertificates.$inferSelect, today: string) {
  const amt = computeRedemptionAmount({
    state: row.state,
    saleDate: row.saleDate as unknown as string,
    asOfDate: today,
    purchaseAmountCents: row.purchaseAmountCents,
    bidDownRateBps: row.bidDownRateBps ?? undefined,
  });
  return {
    currentRedemptionAmountCents: amt.totalRedemptionCents,
    currentInterestCents: amt.interestCents,
    appliedRateBps: amt.appliedRateBps,
    modelUsed: amt.modelUsed,
    amountRefusalReason: amt.refusalReason,
    preliminary: amt.preliminary,
  };
}

function daysRemaining(row: typeof taxCertificates.$inferSelect, today: string): number {
  const deadline = new Date(row.redemptionDeadline as unknown as string);
  return Math.ceil((deadline.getTime() - new Date(today).getTime()) / 86_400_000);
}

function shapeCertificate(row: typeof taxCertificates.$inferSelect, today: string) {
  return {
    id: row.id,
    state: row.state,
    county: row.county,
    apn: row.apn,
    certificateNumber: row.certificateNumber ?? null,
    saleType: row.saleType,
    saleDate: row.saleDate,
    status: row.status,
    purchaseAmountCents: row.purchaseAmountCents,
    bidDownRateBps: row.bidDownRateBps ?? null,
    redemptionDeadline: row.redemptionDeadline,
    deadlineSource: row.deadlineSource ?? null,
    daysRemaining: daysRemaining(row, today),
    ...redemptionAmountFor(row, today),
  };
}

export async function paxGetTaxCertificates(
  orgId: number,
  args: { status?: string; state?: string },
): Promise<TaxToolOutcome> {
  const { db } = await import("../db");
  const status = typeof args.status === "string" && args.status ? args.status : "active";
  const conditions = [eq(taxCertificates.organizationId, orgId)];
  const filters: string[] = [];
  if ((TAX_CERT_STATUSES as readonly string[]).includes(status)) {
    conditions.push(eq(taxCertificates.status, status as (typeof TAX_CERT_STATUSES)[number]));
    filters.push(`status ${status}`);
  } else {
    filters.push("every status");
  }
  const state = typeof args.state === "string" ? args.state.trim().toUpperCase() : "";
  if (/^[A-Z]{2}$/.test(state)) {
    conditions.push(eq(taxCertificates.state, state));
    filters.push(`state ${state}`);
  }
  const rows = await db
    .select()
    .from(taxCertificates)
    .where(and(...conditions))
    .orderBy(asc(taxCertificates.redemptionDeadline))
    .limit(LIST_CAP + 1);
  const today = clock.now().toISOString().slice(0, 10);
  const shown = rows.slice(0, LIST_CAP);
  const capped = rows.length > LIST_CAP;
  return {
    ok: true,
    data: {
      coverage:
        taxCertificateCoverage(shown.length, capped ? shown.length : rows.length, ` — ${filters.join(", ")}`) +
        (capped ? ` The list is capped at ${LIST_CAP}, soonest deadline first; more exist.` : "") +
        " Sorted by redemption deadline, soonest first.",
      asOf: today,
      certificates: shown.map((r) => shapeCertificate(r, today)),
    },
  };
}

export async function paxGetTaxCertificate(orgId: number, certificateId: unknown): Promise<TaxToolOutcome> {
  const row = await loadCertificate(orgId, certificateId);
  if (row === "bad_id") return badId();
  if (!row) return noCertificate();
  const today = clock.now().toISOString().slice(0, 10);
  return {
    ok: true,
    data: {
      coverage: `Coverage: one certificate, read from THIS account's records. ${TAX_BOOK_NOT_COVERED}`,
      asOf: today,
      certificate: shapeCertificate(row, today),
    },
  };
}

export async function paxGetTaxCertificateClock(orgId: number, certificateId: unknown): Promise<TaxToolOutcome> {
  const row = await loadCertificate(orgId, certificateId);
  if (row === "bad_id") return badId();
  if (!row) return noCertificate();
  const { clockForCertificate } = await import("../services/tax/certificateClock");
  const c = await clockForCertificate(orgId, row);
  return {
    ok: true,
    data: {
      coverage:
        "Coverage: the redemption clock for ONE certificate in THIS account, computed by the same rule as the Redemption clock page. " +
        "A redemption deadline is a legal fact: state it with the basis shown, and where the clock says no rule is encoded or the county procedure disagrees, say so — never improvise a date.",
      certificateId: row.id,
      clock: c,
    },
  };
}

type NoticeMarker = {
  sentOn: string;
  method: string;
  viaRail: boolean;
  providerId: string | null;
  /** true = simulated, not mailed; false = a real send; null = the record does not say. */
  simulated: boolean | null;
};

/** Notice events with the simulation marker the ledger projection drops (T-DEF-4). */
async function noticeMarkers(orgId: number, certificateId: string): Promise<NoticeMarker[]> {
  const { db } = await import("../db");
  const events = await db
    .select()
    .from(taxEvents)
    .where(and(eq(taxEvents.organizationId, orgId), eq(taxEvents.certificateId, certificateId), eq(taxEvents.eventType, "redemption_notice_recorded")))
    .orderBy(asc(taxEvents.recordedAt));
  return events.map((e) => {
    const d = (e.detail ?? {}) as Record<string, unknown>;
    const viaRail = d.sentViaRail === true;
    const providerId = typeof d.providerId === "string" ? d.providerId : null;
    // Operator-recorded entries are the operator's word about a send made
    // outside AcreOS. Only a rail receipt can carry the marker.
    const simulated = !viaRail ? false : d.testMode === true || (providerId?.startsWith("sim_") ?? false) ? true : d.testMode === false ? false : null;
    return { sentOn: e.eventDate as unknown as string, method: String(d.method ?? "not stated"), viaRail, providerId, simulated };
  });
}

function simulationStatement(markers: NoticeMarker[]): string {
  const sim = markers.filter((m) => m.simulated === true).length;
  const unknown = markers.filter((m) => m.viaRail && m.simulated === null).length;
  if (markers.length === 0) return "No redemption notice is recorded on this certificate.";
  const parts: string[] = [];
  if (sim > 0) parts.push(`${sim} notice${sim === 1 ? " was" : "s were"} SIMULATED — recorded in test mode, NOT mailed. Never tell the customer a simulated notice went out.`);
  if (unknown > 0) parts.push(`${unknown} notice${unknown === 1 ? "" : "s"} sent through AcreOS carr${unknown === 1 ? "ies" : "y"} no simulation marker either way — say the record does not show whether ${unknown === 1 ? "it was" : "they were"} mailed for real.`);
  if (parts.length === 0) parts.push("Every recorded notice is either a real send or one the operator says they sent themselves outside AcreOS.");
  return parts.join(" ");
}

export async function paxGetTaxCertificateLedger(orgId: number, certificateId: unknown): Promise<TaxToolOutcome> {
  const row = await loadCertificate(orgId, certificateId);
  if (row === "bad_id") return badId();
  if (!row) return noCertificate();
  const { latestTaxEvents } = await import("../services/tax/taxEvents");
  const { deadlineBasisOf } = await import("../services/tax/certificateClock");
  const { buildCertificateLedger } = await import("../services/tax/certificateLedger");
  const events = await latestTaxEvents(orgId, row.id);
  const ledger = await buildCertificateLedger(orgId, row.id, deadlineBasisOf(events.redemption_expiry?.ruleCited ?? null));
  if (!ledger) return noCertificate();
  const markers = await noticeMarkers(orgId, row.id);
  return {
    ok: true,
    data: {
      coverage:
        `Coverage: the ledger of ONE certificate in THIS account — payments, notices and the foreclosure-filing deadline recorded here. ` +
        `It shows what is recorded, not everything that may have happened outside AcreOS. ${TAX_BOOK_NOT_COVERED}`,
      certificateId: row.id,
      ledger,
      noticeSimulation: { statement: simulationStatement(markers), notices: markers },
    },
  };
}

export async function paxRecordTaxLedgerEntry(
  orgId: number,
  userId: string | null | undefined,
  args: Record<string, unknown>,
): Promise<TaxToolOutcome & { receipt?: { before: unknown; after: unknown; description: string } }> {
  const row = await loadCertificate(orgId, args.certificate_id);
  if (row === "bad_id") return badId();
  if (!row) return noCertificate();
  // Camel/snake tolerant: the model-facing parameters are snake_case.
  const raw: Record<string, unknown> = { kind: args.kind };
  switch (args.kind) {
    case "subsequent_tax_paid":
      Object.assign(raw, { paidOn: args.paid_on, amountCents: args.amount_cents, taxYear: args.tax_year ?? null, source: args.source });
      break;
    case "redemption_notice_recorded":
      Object.assign(raw, { sentOn: args.sent_on, method: args.method, note: args.note ?? null, source: args.source });
      break;
    case "foreclosure_filing_deadline":
      Object.assign(raw, { date: args.date, source: args.source });
      break;
  }
  const parsed = ledgerEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      refusal: {
        what: "Nothing was recorded on the ledger",
        why: `The entry is incomplete or malformed: ${parsed.error.issues.map((i) => `${i.path.join(".") || "kind"} — ${i.message}`).join("; ")}`,
        unlock: "Give the kind, the date, the amount where one applies, and where the customer got it (the source), then I will record it",
      },
    };
  }
  const e = parsed.data;
  const today = clock.now().toISOString().slice(0, 10);
  const happenedOn = happenedOnOf(e);
  if (happenedOn && happenedOn > today) {
    return {
      ok: false,
      refusal: {
        what: "Nothing was recorded on the ledger",
        why: "That date is in the future — a payment or a notice is recorded once it has happened",
        unlock: "Tell me again when it has happened, with the real date",
      },
    };
  }
  const { recordLedgerEntry } = await import("../services/tax/certificateLedger");
  const recorded = await recordLedgerEntry(orgId, row.id, e, userId ?? "pax");
  if (!recorded) return noCertificate();
  const label = e.kind === "subsequent_tax_paid" ? "a subsequent tax payment" : e.kind === "redemption_notice_recorded" ? "a redemption notice the operator sent themselves" : "the foreclosure-filing deadline";
  return {
    ok: true,
    data: {
      message: `Recorded ${label} on the certificate ledger. This is a record of what the customer told me; AcreOS did not send anything.`,
      certificateId: row.id,
      entry: e,
    },
    receipt: {
      before: { certificateId: row.id },
      after: { certificateId: row.id, entry: e },
      description: `Recorded ${label} on tax certificate ${row.county}, ${row.state} (${row.apn})`,
    },
  };
}

/** Plain-words converter for the executor. */
export function taxOutcomeToResult(o: TaxToolOutcome): { success: boolean; data?: Record<string, unknown>; refusal?: RefusalParts; error?: string } {
  return o.ok ? { success: true, data: o.data } : toolRefusal(o.refusal);
}
