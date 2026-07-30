/**
 * Itemised security-deposit disposition letter.
 *
 * Every state that lets a landlord withhold any part of a deposit conditions
 * that right on delivering a WRITTEN, ITEMISED statement within the statutory
 * window. Before this module AcreOS could reconcile deductions
 * (`POST /api/inspections/:id/reconcile-deposit`) and then produced nothing to
 * send — the operator had the numbers and no letter, which is the exact posture
 * that loses the withholding right.
 *
 * Rules this builder obeys
 * ────────────────────────
 *   1. It renders only recorded facts. No placeholder tenant, no invented
 *      forwarding address, no assumed deduction. Anything missing becomes a
 *      BLOCKING issue (refuse) or a WARNING (render, flag) — never filler.
 *   2. Every deduction must carry a description and a positive amount. A line
 *      reading "Repairs — $450" with no description is what an itemisation
 *      requirement exists to prevent, so we refuse to emit one.
 *   3. It never asserts delivery, and never asserts that money moved. The
 *      letter states the amount to be refunded; the refund itself is issued by
 *      the landlord on their own rails (AcreOS holds no tenant funds).
 *   4. When the statutory deadline is unknown for the jurisdiction, the letter
 *      omits the deadline sentence entirely rather than printing a guess, and
 *      the caller is handed the unknown-reason to show the operator.
 *
 * Pure module: no DB, no clock (the letter date is passed in), so the output is
 * deterministic and unit-testable.
 */

import type { DepositDeadlineResult } from "@shared/regulatory/depositReturnRules";

export const DISPOSITION_LETTER_VERSION = "2026-07-30-v1";

export interface DispositionDeduction {
  description: string;
  amountCents: number;
  category?: string;
}

export interface DispositionLetterInput {
  /** Landlord / org display name, as it should appear on the letter. */
  landlordName: string;
  landlordContact?: string | null;
  /** Full property address line, plus unit where applicable. */
  propertyAddress: string | null;
  unitLabel?: string | null;
  /** Every tenant on the lease, in the order they should be addressed. */
  tenantNames: string[];
  /** Tenant-supplied forwarding address, when one was recorded. */
  forwardingAddress?: string | null;
  heldCents: number;
  deductions: DispositionDeduction[];
  moveOutDate: string | null;
  deadline: DepositDeadlineResult;
  /** YYYY-MM-DD the letter is dated. */
  letterDate: string;
  state: string | null;
}

export interface DispositionLetterResult {
  markdown: string;
  version: string;
  deductionsTotalCents: number;
  refundCents: number;
  /** Withheld amount that exceeds the deposit — a claim, not a refund. */
  balanceDueFromTenantCents: number;
  /** Non-fatal gaps the operator should close before sending. */
  warnings: string[];
}

export class DispositionLetterBlockedError extends Error {
  readonly code = "DISPOSITION_LETTER_BLOCKED";
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Disposition letter cannot be generated: ${issues.join(" ")}`);
    this.name = "DispositionLetterBlockedError";
    this.issues = issues;
  }
}

function usd(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Build the letter, or throw DispositionLetterBlockedError listing exactly what
 * is missing. Integer cents throughout; the arithmetic is addition only.
 */
export function buildDispositionLetter(input: DispositionLetterInput): DispositionLetterResult {
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (!input.moveOutDate) {
    blocking.push(
      "No move-out date is recorded, so neither the statutory deadline nor the letter's own accounting period can be stated.",
    );
  }
  if (input.tenantNames.length === 0) {
    blocking.push("No tenant is attached to this lease, so the letter has no addressee.");
  }
  if (!Number.isInteger(input.heldCents) || input.heldCents < 0) {
    blocking.push("The deposit amount held is not a valid whole-cent figure.");
  }
  input.deductions.forEach((d, i) => {
    if (!d.description || d.description.trim().length < 3) {
      blocking.push(
        `Deduction ${i + 1} has no description. Every withheld amount must be itemised with what it is for.`,
      );
    }
    if (!Number.isInteger(d.amountCents) || d.amountCents <= 0) {
      blocking.push(`Deduction ${i + 1} ("${d.description || "untitled"}") has no positive whole-cent amount.`);
    }
  });
  if (blocking.length > 0) throw new DispositionLetterBlockedError(blocking);

  const deductionsTotalCents = input.deductions.reduce((s, d) => s + d.amountCents, 0);
  const refundCents = Math.max(0, input.heldCents - deductionsTotalCents);
  const balanceDueFromTenantCents = Math.max(0, deductionsTotalCents - input.heldCents);

  if (!input.propertyAddress) {
    warnings.push("No property address is on record — add one before sending; the letter identifies the unit by lease only.");
  }
  if (!input.forwardingAddress) {
    warnings.push(
      "No forwarding address is recorded for the tenant. Most statutes excuse the landlord only where the tenant failed to provide one — record how and where this letter was delivered.",
    );
  }
  if (!input.deadline.known) {
    warnings.push(
      input.deadline.unknownReason ??
        "No statutory return deadline is encoded for this jurisdiction; confirm it with counsel and calendar it manually.",
    );
  }
  if (input.deductions.length === 0 && refundCents === input.heldCents) {
    warnings.push("No deductions are recorded — this letter returns the deposit in full.");
  }
  if (balanceDueFromTenantCents > 0) {
    warnings.push(
      `Withheld amounts exceed the deposit by ${usd(balanceDueFromTenantCents)}. The letter states that as a balance claimed, not as a refund — collecting it is a separate matter.`,
    );
  }

  const unitLine = input.unitLabel ? `, Unit ${input.unitLabel}` : "";
  const addressLine = input.propertyAddress ? `${input.propertyAddress}${unitLine}` : `(unit${unitLine || ""})`;

  const lines: string[] = [];
  lines.push(`# Security Deposit Disposition`);
  lines.push("");
  lines.push(`**Date:** ${input.letterDate}`);
  lines.push(`**From:** ${input.landlordName}${input.landlordContact ? ` · ${input.landlordContact}` : ""}`);
  lines.push(`**To:** ${input.tenantNames.join(", ")}`);
  if (input.forwardingAddress) lines.push(`**Sent to:** ${input.forwardingAddress}`);
  lines.push(`**Premises:** ${addressLine}`);
  lines.push(`**Tenancy ended:** ${input.moveOutDate}`);
  lines.push("");
  lines.push(
    `This is the itemised written statement of the security deposit held for the tenancy at ${addressLine}.`,
  );
  lines.push("");
  lines.push(`## Accounting`);
  lines.push("");
  lines.push(`| Item | Amount |`);
  lines.push(`| --- | ---: |`);
  lines.push(`| Security deposit held | ${usd(input.heldCents)} |`);
  if (input.deductions.length === 0) {
    lines.push(`| Amounts withheld | ${usd(0)} |`);
  } else {
    for (const d of input.deductions) {
      const label = d.category ? `${d.description} (${d.category})` : d.description;
      lines.push(`| Less: ${label} | −${usd(d.amountCents)} |`);
    }
    lines.push(`| **Total withheld** | **−${usd(deductionsTotalCents)}** |`);
  }
  lines.push(`| **Amount to be refunded to you** | **${usd(refundCents)}** |`);
  if (balanceDueFromTenantCents > 0) {
    lines.push(`| **Amount claimed in excess of the deposit** | **${usd(balanceDueFromTenantCents)}** |`);
  }
  lines.push("");

  if (input.deadline.known && input.deadline.deadlineDate) {
    const unit = input.deadline.businessDays ? "business days" : "days";
    lines.push(
      `This statement is furnished within the ${input.deadline.deadlineDays} ${unit} required by ` +
        `${input.deadline.citation ?? "applicable state law"} following the end of the tenancy ` +
        `(on or before ${input.deadline.deadlineDate}).`,
    );
    lines.push("");
  }

  if (input.deductions.length > 0) {
    lines.push(
      "Each amount above reflects a specific charge against the premises. Supporting documentation for these amounts is available on request.",
    );
    lines.push("");
  }
  lines.push(
    "If you believe any amount above is incorrect, contact us in writing at the address on this letter so we can review it with you.",
  );
  lines.push("");
  lines.push(`_Prepared from the lease ledger and the move-out inspection of record. Template ${DISPOSITION_LETTER_VERSION}._`);

  return {
    markdown: lines.join("\n"),
    version: DISPOSITION_LETTER_VERSION,
    deductionsTotalCents,
    refundCents,
    balanceDueFromTenantCents,
    warnings,
  };
}
