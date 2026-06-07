/**
 * taxPackage — Self-file package generator (FOUNDER-SIDE ONLY).
 *
 * Turns a computed DraftReturn into a clear, transcription-ready package the
 * founder hands to IRS Free File Fillable Forms / MassTaxConnect, or to a CPA.
 * We do NOT machine e-file (no IRS MeF). The output is a structured text/markdown
 * document: headline figures, the line-by-line federal 1040 + MA Form 1 estimate
 * (with each figure's BASIS), the explicit "not modeled" list, and the
 * estimate-not-advice disclaimer on top.
 *
 * Pure module: no db, no encryption, no logging, no PII beyond the figures the
 * founder already owns. Deterministic so it is unit-testable.
 */

import type {
  DraftReturn,
  FederalReturnEstimate,
  MassachusettsReturnEstimate,
  ReturnLine,
} from "./taxEngine";
import { humanFilingStatus } from "./taxEngine";

export interface SelfFilePackage {
  /** Suggested download filename, e.g. "acreos-tax-draft-2025-MFJ.md". */
  filename: string;
  /** "text/markdown" — native, no external service. */
  mimeType: string;
  /** The full transcription-ready document. */
  content: string;
}

function usd(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function renderLines(lines: ReturnLine[]): string {
  return lines
    .map((l) => `| ${l.formRef} | ${l.label} | ${usd(l.amount)} | ${l.basis} |`)
    .join("\n");
}

function renderFederal(f: FederalReturnEstimate): string {
  const refundLine =
    f.summary.refundOrOwed >= 0
      ? `**Estimated federal refund: ${usd(f.summary.refundOrOwed)}**`
      : `**Estimated federal balance due: ${usd(Math.abs(f.summary.refundOrOwed))}**`;
  return [
    `## Federal — Form 1040 estimate (tax year ${f.taxYear})`,
    "",
    f.provisional
      ? `> PROVISIONAL figures (${f.rulesYearUsed} rules${f.exactYearMatch ? "" : ", substituted for an unencoded year"}). Verify against the final IRS instructions before filing.`
      : `> Final ${f.rulesYearUsed} IRS figures.`,
    "",
    `Rules basis: ${f.rulesSource}`,
    "",
    "| Form line | Item | Amount | Basis |",
    "| --- | --- | --- | --- |",
    renderLines(f.lines),
    "",
    `- Effective tax rate: ${pct(f.summary.effectiveRate)} (total tax ÷ total income)`,
    refundLine,
    "",
    "Transcribe these into IRS Free File Fillable Forms (https://www.irs.gov/e-file-providers/free-file-fillable-forms) or your tax software / CPA.",
  ].join("\n");
}

function renderMassachusetts(m: MassachusettsReturnEstimate): string {
  const refundLine =
    m.summary.refundOrOwed >= 0
      ? `**Estimated MA refund: ${usd(m.summary.refundOrOwed)}**`
      : `**Estimated MA balance due: ${usd(Math.abs(m.summary.refundOrOwed))}**`;
  return [
    `## Massachusetts — Form 1 estimate (tax year ${m.taxYear})`,
    "",
    m.provisional
      ? `> PROVISIONAL figures (${m.rulesYearUsed} rules${m.exactYearMatch ? "" : ", substituted for an unencoded year"}). Verify against the final MA DOR Form 1 instructions before filing.`
      : `> Final ${m.rulesYearUsed} MA DOR figures.`,
    "",
    `Rules basis: ${m.rulesSource}`,
    "",
    "| Form line | Item | Amount | Basis |",
    "| --- | --- | --- | --- |",
    renderLines(m.lines),
    "",
    `- Effective MA tax rate: ${pct(m.summary.effectiveRate)} (total MA tax ÷ MA income)`,
    refundLine,
    "",
    "File via MassTaxConnect (https://mtc.dor.state.ma.us/) or your tax software / CPA.",
  ].join("\n");
}

export function buildSelfFilePackage(draft: DraftReturn): SelfFilePackage {
  const statusLabel = humanFilingStatus(draft.filingStatus);
  const parts: string[] = [
    `# AcreOS Life-Cockpit — Draft Tax Package (${draft.taxYear})`,
    "",
    `Filing status: **${statusLabel}** · State: **${draft.state}** · Generated: ${draft.generatedAt}`,
    "",
    "---",
    "",
    "> " + draft.disclaimer.split("\n").join("\n> "),
    "",
    draft.provisional
      ? "> NOTE: This draft uses one or more PROVISIONAL (not-yet-final) tax-year figures. Treat every number as preliminary until you verify it against the final published instructions."
      : "",
    "",
    "---",
    "",
    renderFederal(draft.federal),
    "",
  ];

  if (draft.massachusetts) {
    parts.push("---", "", renderMassachusetts(draft.massachusetts), "");
  }

  parts.push(
    "---",
    "",
    "## What this draft does NOT model",
    "",
    "This is a focused estimate. The following are intentionally out of scope and",
    "you must account for them separately before filing:",
    "",
    ...draft.notModeled.map((item) => `- ${item}`),
    "",
    "---",
    "",
    "## Next steps",
    "",
    "1. Confirm every figure against your official W-2s, 1099s, and prior return.",
    "2. Account for anything in the \"not modeled\" list above.",
    "3. Transcribe the federal figures into IRS Free File Fillable Forms (or your software / CPA).",
    draft.massachusetts ? "4. Transcribe the MA figures into MassTaxConnect (or your software / CPA)." : "",
    "",
    "_AcreOS Life-Cockpit is self-prepared tax software. It is not tax advice and does not e-file on your behalf._",
    "",
  );

  return {
    filename: `acreos-tax-draft-${draft.taxYear}-${draft.filingStatus}.md`,
    mimeType: "text/markdown",
    content: parts.filter((p) => p !== undefined).join("\n").replace(/\n{3,}/g, "\n\n"),
  };
}
