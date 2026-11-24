/**
 * Settlement & Documents Rail — Tax transplant (P3-2 / T-P1): the statutory
 * redemption notice, drafted in-product and sent through the rail.
 *
 * Until this transplant, the Tax vertical's compulsory end leaked out of
 * the product: the holder drafted the redemption notice elsewhere, mailed
 * it elsewhere, and came back to record "I sent a notice" in the
 * certificate ledger (`redemption_notice_recorded`, `sentByOperator: true`
 * — see services/tax/certificateLedger.ts). Now the notice is generated
 * from the certificate record by the rail's document registry and mailed
 * through the rail's delivery lanes, and the ledger entry is written FROM
 * THE PROVIDER'S RECEIPT — a notice is recorded as sent only when the mail
 * provider accepted it, with the provider's own id on the entry.
 *
 * Fail-closed, per shared/tax/notice.ts: no recorded county notice
 * requirements (or stale ones) → refusal, never improvised statutory text;
 * no determinable redemption amount (no encoded rule and no
 * operator-supplied county figure with its source) → refusal, never a
 * guessed amount; no complete owner address → no mail lane. A download
 * drafts the notice in-product and records NOTHING as sent — the operator
 * mailing it themselves afterwards records it the old way, as theirs.
 *
 * Nothing here moves money: redemption is paid to the county, and the
 * letter says so.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { organizations, taxCertificates, taxEvents, type TaxRuleCited } from "@shared/schema";
import { assessTaxNoticeReadiness, type TaxNoticeLane, type TaxNoticeRefusalCode } from "@shared/tax/notice";
import { computeRedemptionAmount, STATE_REDEMPTION_RULES } from "../redemptionClock";
import { currentProcedure } from "../tax/taxProcedures";
import { deadlineBasisOf } from "../tax/certificateClock";
import { latestTaxEvents } from "../tax/taxEvents";
import { buildTaxRedemptionNotice, type RailDocumentArtifact } from "./documents";
import { deliverRailLetterByMail, type RailDeliveryReceipt } from "./delivery";
import { clock } from "../../utils/clock";

export class TaxNoticeRefusedError extends Error {
  constructor(
    readonly reason: TaxNoticeRefusalCode | "certificate_not_found",
    message: string,
  ) {
    super(message);
    this.name = "TaxNoticeRefusedError";
  }
}

export interface TaxNoticeResult {
  artifact: RailDocumentArtifact;
  /** The deadline the notice states, and what it rests on — echoed for the caller's UI. */
  redemptionDeadline: string;
  deadlineBasis: string;
  amountCents: number;
  /** Present only when a mail lane actually sent (provider-accepted). Null on download. */
  delivery: RailDeliveryReceipt | null;
}

export async function sendTaxRedemptionNotice(args: {
  organizationId: number;
  certificateId: string;
  lane: TaxNoticeLane;
  recordedByUserId: string;
  /** The operator's county-sourced redemption amount (both fields or neither). */
  operatorAmountCents?: number | null;
  operatorAmountSource?: string | null;
}): Promise<TaxNoticeResult> {
  const [cert] = await db
    .select()
    .from(taxCertificates)
    .where(and(eq(taxCertificates.id, args.certificateId), eq(taxCertificates.organizationId, args.organizationId)))
    .limit(1);
  if (!cert) throw new TaxNoticeRefusedError("certificate_not_found", "Certificate not found");

  const today = clock.now().toISOString().slice(0, 10);
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, args.organizationId))
    .limit(1);
  const holderName = org?.name ?? "Certificate holder";

  const procedure = await currentProcedure(args.organizationId, cert.state, cert.county);
  const computed = computeRedemptionAmount({
    state: cert.state,
    saleDate: cert.saleDate as unknown as string,
    asOfDate: today,
    purchaseAmountCents: cert.purchaseAmountCents,
    bidDownRateBps: cert.bidDownRateBps ?? undefined,
  });
  const readiness = assessTaxNoticeReadiness({
    status: cert.status,
    procedureFields: procedure?.fields ?? null,
    today,
    computedAmount:
      computed.totalRedemptionCents !== null
        ? { cents: computed.totalRedemptionCents, citation: STATE_REDEMPTION_RULES[cert.state.toUpperCase()]?.citation ?? null }
        : { refusalReason: computed.refusalReason ?? "AcreOS does not compute a redemption amount for this certificate." },
    operatorAmount:
      args.operatorAmountCents != null && args.operatorAmountSource
        ? { cents: args.operatorAmountCents, source: args.operatorAmountSource }
        : null,
    ownerName: cert.ownerName,
    ownerAddress: cert.ownerAddress ?? null,
    lane: args.lane,
  });
  if (!readiness.ready) throw new TaxNoticeRefusedError(readiness.code, readiness.message);

  const events = await latestTaxEvents(args.organizationId, cert.id);
  const deadlineBasis = deadlineBasisOf(events.redemption_expiry?.ruleCited ?? null);
  const redemptionDeadline = cert.redemptionDeadline as unknown as string;

  const artifact = buildTaxRedemptionNotice({
    holderName,
    ownerName: cert.ownerName ?? "Owner of record",
    county: cert.county,
    state: cert.state,
    apn: cert.apn,
    certificateNumber: cert.certificateNumber,
    saleDate: cert.saleDate as unknown as string,
    purchaseAmountCents: cert.purchaseAmountCents,
    redemptionDeadline,
    deadlineBasis,
    amountCents: readiness.amount.cents,
    amountBasisText: readiness.amount.basisText,
    noticeRequirements: readiness.noticeRequirements.value,
    noticeRequirementsSource: readiness.noticeRequirements.source,
    noticeRequirementsAsOf: readiness.noticeRequirements.asOf,
  });

  if (args.lane === "download") {
    return { artifact, redemptionDeadline, deadlineBasis, amountCents: readiness.amount.cents, delivery: null };
  }

  // The gate proved the recipient complete for mail lanes.
  const receipt = await deliverRailLetterByMail({
    organizationId: args.organizationId,
    html: artifact.html,
    recipient: readiness.recipient!,
    lane: args.lane,
    // One statutory notice per certificate per day per procedure version:
    // a retry after a crash replays to the provider's recorded acceptance
    // instead of printing a second copy; a genuinely new notice (another
    // day, or re-verified requirements) is a new piece.
    idempotencyKey: `tax-redemption-notice:${cert.id}:${today}:v${procedure?.version ?? 0}`,
  });

  // Witnessed send: the ledger entry exists ONLY because the provider
  // accepted the piece, and it carries the provider's receipt — the rail
  // counterpart of the operator-recorded entry, told apart by detail.
  const ruleCited: TaxRuleCited = {
    kind: "procedure_object",
    procedureId: procedure!.id,
    version: procedure!.version,
    field: "noticeRequirements",
    source: readiness.noticeRequirements.source,
    asOf: readiness.noticeRequirements.asOf,
  };
  await db.insert(taxEvents).values({
    organizationId: args.organizationId,
    certificateId: cert.id,
    eventType: "redemption_notice_recorded",
    eventDate: today,
    ruleCited,
    detail: {
      method: args.lane === "certified_mail" ? "certified mail via AcreOS" : "mail via AcreOS",
      note: null,
      sentViaRail: true,
      providerId: receipt.providerId,
      testMode: receipt.testMode,
      alreadySent: receipt.alreadySent,
      expectedDeliveryDate: receipt.expectedDeliveryDate,
      amountCents: readiness.amount.cents,
      amountBasis: readiness.amount.basis,
    },
    recordedBy: args.recordedByUserId,
  });

  return { artifact, redemptionDeadline, deadlineBasis, amountCents: readiness.amount.cents, delivery: receipt };
}
