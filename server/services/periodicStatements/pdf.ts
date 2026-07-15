/**
 * §1026.41 periodic statement PDF renderer.
 *
 * Renders a `periodic_statements` row to a pdfkit document containing
 * every required §1026.41(d) disclosure. Caller pipes the returned
 * doc to the response (mirrors the convention in propertyReportPdf.ts).
 *
 * Voice: §1026.41(d)(8) commentary makes clear that delinquency
 * information must be PRESENTED FACTUALLY — no urgency, no advice, no
 * sales overlay. Constitution Immutable #1 (never lie) + #12 (never
 * fiduciary advice) line up cleanly here: the statement reports what
 * is, never what the borrower "should" do.
 */

import type { PeriodicStatement } from "@shared/schema/reg-z";
import { DISCLAIMER_WORKSHEET } from "../legalDisclaimers";

const PRIMARY = "#9C4221";
const TEXT = "#1f2937";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";
const WARN = "#b45309";

export interface RenderStatementInput {
  statement: PeriodicStatement;
  orgName: string;
  borrowerName?: string;
  borrowerAddress?: string;
  contactPhone?: string;
  contactEmail?: string;
}

function fmtUsd(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function fmtRate(bps: number): string {
  return `${(bps / 100).toFixed(3)}%`;
}

export async function renderPeriodicStatementPdf(input: RenderStatementInput) {
  const { statement, orgName, borrowerName, borrowerAddress, contactPhone, contactEmail } =
    input;

  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({
    margin: 50,
    info: {
      Title: `Periodic statement — cycle ${statement.cycleStart}`,
      Subject: "12 C.F.R. §1026.41 periodic statement",
    },
  });

  // ── Header band ────────────────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 80).fill(PRIMARY);
  doc.fillColor("#ffffff").fontSize(20).font("Helvetica-Bold").text("Mortgage Statement", 50, 30);
  doc.fontSize(10).font("Helvetica").text(orgName, 50, 55);
  doc.y = 100;
  doc.fillColor(TEXT);

  // ── Section 1: Payment due — §1026.41(d)(1) ───────────────────────
  doc.fontSize(11).font("Helvetica-Bold").text("Payment due");
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10);
  doc.text(`Due date: ${statement.dueDate}`);
  doc.text(`Amount due: ${fmtUsd(statement.amountDueCents)}`);
  doc.moveDown(0.5);

  // How it will be applied — §1026.41(d)(1)(ii)
  doc.font("Helvetica-Bold").fontSize(10).text("How your next payment will be applied");
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  const explain = statement.paymentApplicationExplanation;
  doc.text(`  Principal: ${fmtUsd(explain.principalCents)}`);
  doc.text(`  Interest: ${fmtUsd(explain.interestCents)}`);
  doc.text(`  Escrow: ${fmtUsd(explain.escrowCents)}`);
  doc.text(`  Fees: ${fmtUsd(explain.feesCents)}`);
  doc.fillColor(TEXT).moveDown(0.7);

  // ── Section 2: Account information — §1026.41(d)(3) ──────────────
  doc.rect(50, doc.y, doc.page.width - 100, 1).fill(RULE);
  doc.fillColor(TEXT).moveDown(0.3);
  doc.fontSize(11).font("Helvetica-Bold").text("Account information");
  doc.font("Helvetica").fontSize(10).moveDown(0.3);
  doc.text(`Outstanding principal balance: ${fmtUsd(statement.principalBalanceCents)}`);
  doc.text(`Interest rate: ${fmtRate(statement.interestRateBps)}`);
  doc.text(`Amount required to pay off in full: ${fmtUsd(statement.payoffCents)}`);
  if (statement.prepaymentPenaltyDisclosed) {
    doc.text("Prepayment penalty: applies — contact servicer for amount");
  } else {
    doc.text("Prepayment penalty: none");
  }
  doc.moveDown(0.7);

  // ── Section 3: Past payment breakdown — §1026.41(d)(4) ───────────
  doc.rect(50, doc.y, doc.page.width - 100, 1).fill(RULE);
  doc.fillColor(TEXT).moveDown(0.3);
  doc.fontSize(11).font("Helvetica-Bold").text("Past payment breakdown");
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).moveDown(0.3);
  doc.text(`This cycle (${statement.cycleStart} – ${statement.cycleEnd})`);
  const past = statement.pastPaymentBreakdown;
  doc.text(`  Total received: ${fmtUsd(past.totalReceivedCents)}`);
  doc.text(`  Applied to principal: ${fmtUsd(past.principalCents)}`);
  doc.text(`  Applied to interest: ${fmtUsd(past.interestCents)}`);
  doc.text(`  Applied to escrow: ${fmtUsd(past.escrowCents)}`);
  doc.text(`  Applied to fees: ${fmtUsd(past.feesCents)}`);
  doc.text(`  Held as partial / suspense: ${fmtUsd(past.unappliedCents)}`);
  doc.fillColor(TEXT).moveDown(0.5);

  // YTD — §1026.41(d)(4)(ii)
  doc.font("Helvetica-Bold").fontSize(10).text("Year-to-date totals");
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).moveDown(0.2);
  doc.text(`  Principal paid YTD: ${fmtUsd(statement.ytdPrincipalCents)}`);
  doc.text(`  Interest paid YTD: ${fmtUsd(statement.ytdInterestCents)}`);
  doc.text(`  Escrow paid YTD: ${fmtUsd(statement.ytdEscrowCents)}`);
  doc.text(`  Fees paid YTD: ${fmtUsd(statement.ytdFeesCents)}`);
  doc.fillColor(TEXT).moveDown(0.7);

  // ── Section 4: Transaction activity — §1026.41(d)(5) ─────────────
  doc.rect(50, doc.y, doc.page.width - 100, 1).fill(RULE);
  doc.fillColor(TEXT).moveDown(0.3);
  doc.fontSize(11).font("Helvetica-Bold").text("Transaction activity");
  doc.font("Helvetica").fontSize(9).moveDown(0.3);
  if (statement.transactions.length === 0) {
    doc.fillColor(MUTED).text("No transactions during this cycle.").fillColor(TEXT);
  } else {
    for (const tx of statement.transactions) {
      doc.text(`  ${tx.date}  ${tx.label}  ${fmtUsd(tx.amountCents)}  → ${tx.appliedTo}`);
    }
  }
  doc.moveDown(0.7);

  // ── Section 5: Partial-payment info — §1026.41(d)(7) ─────────────
  if ((statement.partialPaymentBalanceCents ?? 0) > 0) {
    doc.rect(50, doc.y, doc.page.width - 100, 1).fill(RULE);
    doc.fillColor(TEXT).moveDown(0.3);
    doc.fontSize(11).font("Helvetica-Bold").text("Partial-payment information");
    doc.font("Helvetica").fontSize(10).moveDown(0.3);
    doc.text(
      `${fmtUsd(statement.partialPaymentBalanceCents ?? 0)} is being held as partial payment because it is less than a full periodic payment. This amount will be applied to your loan once additional funds bring the total to a full periodic payment amount.`,
    );
    doc.moveDown(0.7);
  }

  // ── Section 6: Delinquency info — §1026.41(d)(8) ─────────────────
  if (statement.delinquencyInfo) {
    const d = statement.delinquencyInfo;
    doc.rect(50, doc.y, doc.page.width - 100, 1).fill(WARN);
    doc.fillColor(TEXT).moveDown(0.3);
    doc.fontSize(11).font("Helvetica-Bold").fillColor(WARN).text("Delinquency notice");
    doc.fillColor(TEXT).font("Helvetica").fontSize(10).moveDown(0.3);
    doc.text(`You are ${d.daysDelinquent} days delinquent on this loan.`);
    doc.text(`First missed payment: ${d.delinquentSinceDate}`);
    doc.text(`Total amount past due: ${fmtUsd(d.totalAmountDelinquentCents)}`);
    if (d.riskOfForeclosureNotice) {
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").text(
        "Failure to bring this loan current may lead to default and foreclosure proceedings under the terms of your note and applicable state law.",
      );
      doc.font("Helvetica");
    }
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").text("Housing counselor information");
    doc.font("Helvetica").moveDown(0.2);
    doc.text(
      `HUD-approved counselors are available to you free of charge. Call ${d.housingCounselorPhone} or visit ${d.housingCounselorUrl} to find a counselor near you.`,
    );
    doc.moveDown(0.7);
  } else {
    // Even when not delinquent, the housing counselor info must be
    // present per §1026.41(d)(8) commentary 41(d)(8)-1.
    doc.rect(50, doc.y, doc.page.width - 100, 1).fill(RULE);
    doc.fillColor(TEXT).moveDown(0.3);
    doc.fontSize(11).font("Helvetica-Bold").text("Housing counselor information");
    doc.font("Helvetica").fontSize(10).moveDown(0.3);
    doc.text(
      `If you need help with your mortgage, HUD-approved counselors are available free of charge. Call ${HUD_HOUSING_COUNSELOR_PHONE} or visit ${HUD_HOUSING_COUNSELOR_URL}.`,
    );
    doc.moveDown(0.7);
  }

  // ── Section 7: Late-payment warning — §1026.41(d)(6) ─────────────
  doc.rect(50, doc.y, doc.page.width - 100, 1).fill(RULE);
  doc.fillColor(TEXT).moveDown(0.3);
  doc.fontSize(11).font("Helvetica-Bold").text("Late-payment warning");
  doc.font("Helvetica").fontSize(10).moveDown(0.3);
  doc.text(
    "If your payment is received after the grace period stated in your note, you may be assessed a late fee as outlined in your loan documents.",
  );
  doc.moveDown(0.7);

  // ── Section 8: Contact info — §1026.41(d)(2) ─────────────────────
  doc.rect(50, doc.y, doc.page.width - 100, 1).fill(RULE);
  doc.fillColor(TEXT).moveDown(0.3);
  doc.fontSize(11).font("Helvetica-Bold").text("Contact us with questions");
  doc.font("Helvetica").fontSize(10).moveDown(0.3);
  if (contactPhone) doc.text(`Phone: ${contactPhone}`);
  if (contactEmail) doc.text(`Email: ${contactEmail}`);
  doc.text(`Servicer: ${orgName}`);
  if (borrowerName) doc.fillColor(MUTED).fontSize(9).text(`Statement for: ${borrowerName}`);
  if (borrowerAddress) doc.text(`Mailing address on file: ${borrowerAddress}`);
  doc.fillColor(TEXT).moveDown(0.5);

  // ── Footer — regulatory attestation ───────────────────────────────
  doc
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      `This statement is provided pursuant to 12 C.F.R. §1026.41. Generated ${new Date(statement.generatedAt).toISOString().slice(0, 10)} for billing cycle ${statement.cycleStart} – ${statement.cycleEnd}.`,
      { align: "center" },
    );

  // L1 liability shield — standing worksheet legend. The servicer named
  // above is the organization; AcreOS is the software that rendered this
  // statement, and the legend keeps that distinction on the artifact.
  doc.moveDown(0.4);
  doc.fontSize(7).fillColor(MUTED).text(DISCLAIMER_WORKSHEET, { align: "center" });

  return doc;
}

// Re-export for the PDF renderer's own use.
const HUD_HOUSING_COUNSELOR_PHONE = "800-569-4287";
const HUD_HOUSING_COUNSELOR_URL = "https://www.hud.gov/findacounselor";
