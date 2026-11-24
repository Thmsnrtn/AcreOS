/**
 * Whether a statutory redemption notice may be drafted (and sent) for one
 * certificate — the Tax transplant onto the Settlement & Documents Rail
 * (P3-2 / T-P1). Pure.
 *
 * A statutory notice is the compulsory end of the Tax vertical: it tells the
 * owner of record, in the county's own required terms, that their property
 * will be lost unless they redeem by a stated deadline. Every fact on it
 * must rest on a record, so the gate is fail-closed — the same discipline
 * the redemption clock already keeps (no encoded rule → no computed
 * deadline, ever):
 *
 *   - The certificate must still be redeemable (`active`). A redeemed,
 *     cancelled or deed-held position has no redemption left to notice.
 *   - The county procedure object must RECORD its notice requirements,
 *     with a source. AcreOS never authors statutory notice language: with
 *     nothing recorded it refuses rather than improvising the text a
 *     statute requires.
 *   - The recorded requirements must not be STALE (source older than 12
 *     months — the procedure object's own stale-law rule). Bidding locks
 *     on stale law; sending a legal notice on stale law locks too.
 *   - The redemption amount must be DETERMINABLE: computed from the
 *     encoded state rule, or supplied by the operator from the county's
 *     records WITH its source (the operator-entered pattern the deadline
 *     itself uses). With neither, the notice refuses — a notice stating a
 *     guessed amount is worse than no notice.
 *   - A mailed notice needs the owner of record's complete mailing
 *     address on the certificate. A download (the operator mails it
 *     themselves) does not.
 */

import { isStale, type ProcedureField, type ProcedureFields } from "./procedure";

export type TaxNoticeLane = "download" | "mail" | "certified_mail";

export type TaxNoticeRefusalCode =
  | "not_redeemable"
  | "notice_requirements_not_recorded"
  | "notice_requirements_stale"
  | "amount_not_determinable"
  | "recipient_incomplete";

export interface TaxNoticeAmount {
  cents: number;
  basis: "computed_preliminary" | "operator_supplied";
  /** What the amount rests on, in words (rule citation or the operator's source). */
  basisText: string;
}

export type TaxNoticeReadiness =
  | {
      ready: true;
      noticeRequirements: ProcedureField<"noticeRequirements">;
      amount: TaxNoticeAmount;
      recipient: { name: string; address: { line1: string; line2?: string; city: string; state: string; zip: string } } | null;
    }
  | { ready: false; code: TaxNoticeRefusalCode; message: string };

export interface TaxNoticeGateInput {
  status: string;
  /** The county's CURRENT recorded procedure fields (null = no procedure recorded). */
  procedureFields: ProcedureFields | null;
  today: string;
  /** The encoded-rule computation: cents when it computed, refusal text when it did not. */
  computedAmount: { cents: number; citation: string | null } | { refusalReason: string };
  /** The operator's county-sourced amount, when they supplied one (both or neither). */
  operatorAmount: { cents: number; source: string } | null;
  ownerName: string | null;
  ownerAddress: { line1?: string; city?: string; state?: string; zip?: string } | null;
  lane: TaxNoticeLane;
}

export function assessTaxNoticeReadiness(i: TaxNoticeGateInput): TaxNoticeReadiness {
  if (i.status !== "active") {
    return {
      ready: false,
      code: "not_redeemable",
      message: `A redemption notice can only be sent while the certificate is still redeemable — this certificate's status is "${i.status}".`,
    };
  }
  const noticeRequirements = i.procedureFields?.noticeRequirements;
  if (!noticeRequirements) {
    return {
      ready: false,
      code: "notice_requirements_not_recorded",
      message:
        "No notice requirements are recorded for this county. Record what the county requires a redemption notice to say — with its source — on the county procedure card first; AcreOS will not improvise statutory notice language.",
    };
  }
  if (isStale(noticeRequirements.asOf, i.today)) {
    return {
      ready: false,
      code: "notice_requirements_stale",
      message: `The recorded notice requirements rest on a source as of ${noticeRequirements.asOf}, more than 12 months ago. Re-verify them with the county before a notice goes out on them.`,
    };
  }
  let amount: TaxNoticeAmount;
  if ("cents" in i.computedAmount) {
    amount = {
      cents: i.computedAmount.cents,
      basis: "computed_preliminary",
      basisText: i.computedAmount.citation
        ? `computed by AcreOS from its encoded state rule (${i.computedAmount.citation}) — preliminary, not attorney-reviewed; confirm with the county`
        : "computed by AcreOS from its encoded state rule — preliminary, not attorney-reviewed; confirm with the county",
    };
  } else if (i.operatorAmount) {
    amount = { cents: i.operatorAmount.cents, basis: "operator_supplied", basisText: `supplied by the operator from the county's records — source: ${i.operatorAmount.source}` };
  } else {
    return {
      ready: false,
      code: "amount_not_determinable",
      message: `${i.computedAmount.refusalReason} Supply the redemption amount from the county's records, with its source, or do not send the notice.`,
    };
  }
  let recipient: Extract<TaxNoticeReadiness, { ready: true }>["recipient"] = null;
  if (i.lane !== "download") {
    const a = i.ownerAddress;
    const complete = !!(i.ownerName?.trim() && a?.line1?.trim() && a?.city?.trim() && a?.state?.trim() && a?.zip?.trim());
    if (!complete) {
      return {
        ready: false,
        code: "recipient_incomplete",
        message:
          "The owner of record's name and complete mailing address are not on the certificate, so the notice cannot be mailed. Complete them first, or download the notice and mail it yourself.",
      };
    }
    recipient = {
      name: i.ownerName!.trim(),
      address: { line1: a!.line1!.trim(), city: a!.city!.trim(), state: a!.state!.trim(), zip: a!.zip!.trim() },
    };
  }
  return { ready: true, noticeRequirements, amount, recipient };
}
