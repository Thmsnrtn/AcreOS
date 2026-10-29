/**
 * The certificate ledger — V-Tax-1 T3b. Records a subsequent tax paid, a
 * redemption notice the operator sent (outside AcreOS), or the foreclosure-
 * filing deadline as tax_events (append-only, org-private), and builds the
 * ledger view from them. The projection is pure, in shared/tax/ledger.ts.
 */
import { and, asc, eq } from "drizzle-orm";
import { taxCertificates, taxEvents, type TaxRuleCited } from "@shared/schema";
import { certificateLedger, type CertificateLedger } from "@shared/tax/ledger";
import { computeRedemptionAmount } from "../redemptionClock";
import { clock } from "../../utils/clock";

async function loadCertificate(organizationId: number, certificateId: string) {
  const { db } = await import("../../db");
  const [row] = await db
    .select()
    .from(taxCertificates)
    .where(and(eq(taxCertificates.id, certificateId), eq(taxCertificates.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export type LedgerEntry =
  | { kind: "subsequent_tax_paid"; paidOn: string; amountCents: number; taxYear: string | null; source: string }
  | { kind: "redemption_notice_recorded"; sentOn: string; method: string; note: string | null; source: string }
  | { kind: "foreclosure_filing_deadline"; date: string; source: string };

/** Record one ledger entry. Returns false when the certificate is not this organization's. */
export async function recordLedgerEntry(organizationId: number, certificateId: string, entry: LedgerEntry, recordedBy: string): Promise<boolean> {
  const cert = await loadCertificate(organizationId, certificateId);
  if (!cert) return false;
  const ruleCited: TaxRuleCited = { kind: "county_record", source: entry.source };
  const { db } = await import("../../db");
  await db.insert(taxEvents).values({
    organizationId,
    certificateId,
    eventType: entry.kind,
    eventDate: entry.kind === "subsequent_tax_paid" ? entry.paidOn : entry.kind === "redemption_notice_recorded" ? entry.sentOn : entry.date,
    ruleCited,
    detail:
      entry.kind === "subsequent_tax_paid"
        ? { amountCents: entry.amountCents, taxYear: entry.taxYear }
        : entry.kind === "redemption_notice_recorded"
          ? { method: entry.method, note: entry.note, sentByOperator: true }
          : {},
    recordedBy,
  });
  return true;
}

export async function buildCertificateLedger(organizationId: number, certificateId: string, deadlineBasis: string): Promise<CertificateLedger | null> {
  const cert = await loadCertificate(organizationId, certificateId);
  if (!cert) return null;
  const { db } = await import("../../db");
  const events = await db
    .select()
    .from(taxEvents)
    .where(and(eq(taxEvents.organizationId, organizationId), eq(taxEvents.certificateId, certificateId)))
    .orderBy(asc(taxEvents.recordedAt));
  const today = clock.now().toISOString().slice(0, 10);
  const amount = computeRedemptionAmount({
    state: cert.state,
    saleDate: cert.saleDate as unknown as string,
    asOfDate: today,
    purchaseAmountCents: cert.purchaseAmountCents,
    bidDownRateBps: cert.bidDownRateBps ?? undefined,
  });
  const { countyBidStanding } = await import("./taxProcedures");
  const standing = await countyBidStanding(organizationId, cert.state, cert.county, today);
  const rule = standing.current?.fields.subsequentTaxRules;
  return certificateLedger({
    purchaseAmountCents: cert.purchaseAmountCents,
    bidDownRateBps: cert.bidDownRateBps ?? null,
    redemptionDeadline: cert.redemptionDeadline as unknown as string,
    deadlineBasis,
    interest: { interestCents: amount.interestCents, asOfDate: amount.asOfDate, refusalReason: amount.refusalReason, preliminary: amount.preliminary },
    subsequentTaxRule: rule && standing.current ? { value: rule.value, source: rule.source, asOf: rule.asOf, version: standing.current.version } : null,
    events: events.map((e) => ({
      eventType: e.eventType,
      eventDate: e.eventDate as unknown as string,
      ruleCited: e.ruleCited as LedgerRule,
      detail: e.detail,
      recordedBy: e.recordedBy,
      recordedAt: e.recordedAt.toISOString(),
    })),
  });
}

type LedgerRule = { kind: string; source?: string; [k: string]: unknown };
