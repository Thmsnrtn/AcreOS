/**
 * The payoff-quote PDF artifact — the document a closer actually wires against.
 *
 * WHY THIS FILE RENDERS FROM A ROW AND NEVER FROM A LOAN
 * -----------------------------------------------------
 * `note_payoff_quotes` (migration 0212) exists because a payoff statement is a
 * representation the note holder is bound by, and AcreOS was quoting payoffs
 * from several places with several day-count behaviours while persisting none
 * of them. The table freezes the engine INPUT snapshot alongside its OUTPUT,
 * one immutable row per quote issued.
 *
 * A PDF that recomputes is exactly the defect that table was created to
 * prevent: the closer wires the figure printed on the paper, and if the paper
 * is regenerated from a loan that has since taken a payment, the paper and the
 * quote diverge silently. So this module takes a FROZEN ROW and nothing else.
 * It has no database import, no engine import, and no clock dependency for any
 * figure it prints. `payoffQuotePdf.test.ts` asserts that structurally against
 * this file's own source text, so the property cannot rot.
 *
 * The only arithmetic performed here is a RECONCILIATION of the row against
 * ITSELF: the stored components must sum to the stored total. That is not a
 * recomputation — it reads no loan, no ledger, no rate, no calendar. It exists
 * so a corrupted row refuses to become a document that contradicts its own
 * line items.
 *
 * WHICH ENGINE THIS PAPER COMES FROM
 * ----------------------------------
 * The frozen row records `engine_version` per row, so the paper always names
 * the engine that produced it rather than the engine that happens to be
 * current. Today the only writer of `note_payoff_quotes` is
 * `POST /api/notes/:id/payoff/quotes` in server/routes-notes.ts, which computes
 * through `notePaymentMath.computePayoffQuote` (`payoff-engine-1`). The OTHER
 * payoff paths in this repo (the borrower-portal quote in routes-borrower.ts,
 * the `processPayoff` agent skill, the legacy `payoff_quotes` CRUD in
 * routes-va-engine.ts) do NOT write this table and are NOT unified onto that
 * engine — see the drift note in the wave report. Nothing they produce can
 * reach this renderer, because this renderer only reads rows from this table.
 *
 * REFUSE, DO NOT FABRICATE
 * ------------------------
 * A row missing any figure in `REQUIRED_QUOTE_FIELDS` throws
 * `PayoffQuoteRenderRefusal` instead of printing a blank, a zero, or a guess.
 * Optional identity fields (note number, payer, issuing user) render as
 * "Not recorded" — never as an invented value. The money block is labelled
 * "Amounts included in this payoff" rather than "amounts owed", because the
 * row records what the quote INCLUDED; it cannot establish that nothing else
 * is owed, and asserting that would be a fabricated negative.
 *
 * EGRESS
 * ------
 * A PDF a customer forwards to a counterparty is the most redistributive
 * channel there is, so the row is screened through the license-aware egress
 * chokepoint (`licenseEgress.screenRecordForExport`) on the "pdf-artifact"
 * channel before anything is drawn. A payoff row is first-party ledger data
 * today and carries no provider-derived region, so the screen releases all of
 * it and the notice is null — this is not decoration: it is the seam that
 * decides, rather than this file assuming, if a provider-derived field is ever
 * added to the row. Withheld fields are dropped AND the artifact says so.
 */

import { jsPDF } from "jspdf";

import type { NotePayoffQuote } from "@shared/schema/notes-vertical";
import { DISCLAIMER_WORKSHEET } from "./legalDisclaimers";
import { screenRecordForExport } from "./licenseEgress";

/**
 * The egress channel this artifact leaves through. Declared in
 * server/services/licenseEgress.ts; imported, never redefined.
 */
export const PAYOFF_QUOTE_PDF_CHANNEL = "pdf-artifact" as const;

// ---------------------------------------------------------------------------
// Refusal
// ---------------------------------------------------------------------------

/**
 * Every column that must be present and well-formed for a payoff statement to
 * be issuable. A quote missing any of these cannot be rendered honestly: the
 * figure would either be blank on a document a closer wires against, or filled
 * with an assumption this module is not entitled to make.
 *
 * `payoffQuotePdf.test.ts` derives one refusal case per entry, so adding a
 * required field here automatically acquires a test.
 */
export const REQUIRED_QUOTE_FIELDS = [
  "id",
  "organizationId",
  "noteSystem",
  "noteRef",
  "quotedAt",
  "payoffDate",
  "goodThroughDate",
  "accrualStartDate",
  "principalBalanceCents",
  "annualRateBpsHundredths",
  "daysAccrued",
  "dayCountConvention",
  "perDiemInterestCents",
  "accruedInterestCents",
  "unappliedCreditCents",
  "lateFeesOutstandingCents",
  "payoffFeeCents",
  "totalPayoffCents",
  "engineVersion",
] as const;

export type RequiredQuoteField = (typeof REQUIRED_QUOTE_FIELDS)[number];

/** Fields that must be finite integers (cents / counts), not merely present. */
const INTEGER_FIELDS: readonly RequiredQuoteField[] = [
  "principalBalanceCents",
  "annualRateBpsHundredths",
  "daysAccrued",
  "perDiemInterestCents",
  "accruedInterestCents",
  "unappliedCreditCents",
  "lateFeesOutstandingCents",
  "payoffFeeCents",
  "totalPayoffCents",
];

/** Fields that must parse as a `YYYY-MM-DD` calendar date. */
const DATE_FIELDS: readonly RequiredQuoteField[] = [
  "payoffDate",
  "goodThroughDate",
  "accrualStartDate",
];

/**
 * Thrown instead of rendering. Carries the specific defects so the route can
 * tell the operator WHICH figure is missing rather than "something went wrong".
 */
export class PayoffQuoteRenderRefusal extends Error {
  readonly defects: string[];
  readonly quoteId: string | null;

  constructor(quoteId: string | null, defects: string[]) {
    super(
      `Payoff quote ${quoteId ?? "(no id)"} cannot be rendered: ${defects.join("; ")}`,
    );
    this.name = "PayoffQuoteRenderRefusal";
    this.defects = defects;
    this.quoteId = quoteId;
  }
}

// ---------------------------------------------------------------------------
// Formatting — integer-exact, UTC-safe
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * `YYYY-MM-DD` → "March 4, 2026" without constructing a Date. Constructing one
 * and calling toLocaleDateString shifts the day backwards in any negative-UTC
 * server timezone, which on a payoff statement moves the as-of date and
 * therefore the amount of interest the paper claims to cover.
 */
function fmtIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const monthIdx = Number(m) - 1;
  const month = MONTHS[monthIdx] ?? m;
  return `${month} ${Number(d)}, ${y}`;
}

/** ISO timestamp for the issuance line. Always UTC, always explicit about it. */
function fmtTimestampUtc(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/**
 * Integer cents → "$48,930.11". Done with integer arithmetic: dividing by 100
 * first and formatting the float is how a cent goes missing on a legal
 * document.
 */
function fmtCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs - whole * 100;
  const wholeStr = whole.toLocaleString("en-US");
  return `${negative ? "-" : ""}$${wholeStr}.${String(frac).padStart(2, "0")}`;
}

/**
 * Hundredths-of-a-basis-point → percent string, exactly. 98750 → "9.875%".
 * Integer math for the same reason as `fmtCents`.
 */
function fmtRateFromHundredthsBps(hundredths: number): string {
  const negative = hundredths < 0;
  const abs = Math.abs(hundredths);
  const whole = Math.floor(abs / 10_000);
  let frac = String(abs - whole * 10_000).padStart(4, "0");
  // Trim trailing zeros but keep at least two decimals ("10.00%", "9.875%").
  while (frac.length > 2 && frac.endsWith("0")) frac = frac.slice(0, -1);
  return `${negative ? "-" : ""}${whole}.${frac}%`;
}

const NOTE_SYSTEM_LABEL: Record<string, string> = {
  acquired_note: "Acquired note ledger",
  serviced_note: "Seller-finance servicing ledger",
};

const NOT_RECORDED = "Not recorded";

// ---------------------------------------------------------------------------
// The content model
// ---------------------------------------------------------------------------

/** One labelled money line on the statement. */
export interface PayoffStatementLine {
  label: string;
  /** Signed cents exactly as they leave the frozen row (credits are negative). */
  cents: number;
  formatted: string;
  /** True for the bottom-line total. */
  emphasis?: boolean;
}

/**
 * Everything the PDF prints, resolved from the frozen row. The renderer draws
 * ONLY from this object, so a test that pins these figures against the row has
 * pinned the document.
 */
export interface PayoffQuoteStatement {
  quoteId: string;
  organizationId: number;
  orgName: string | null;
  noteSystem: string;
  noteSystemLabel: string;
  noteRef: string;
  noteNumber: string;
  payerName: string;
  quotedAt: string;
  quotedByUserId: string;
  channel: string;
  /** The as-of date the figure is computed to. */
  asOfDate: string;
  asOfDateFormatted: string;
  goodThroughDate: string;
  goodThroughDateFormatted: string;
  perDiemCents: number;
  perDiemFormatted: string;
  /** The money block, in printed order. */
  lines: PayoffStatementLine[];
  totalPayoffCents: number;
  totalPayoffFormatted: string;
  /** The frozen inputs, as label/value pairs, in printed order. */
  inputRows: Array<[string, string]>;
  engineVersion: string;
  dayCountConvention: string;
  operatorNotes: string | null;
  /** Non-null only when the egress chokepoint withheld something. */
  egressNotice: string | null;
  egressAttributions: string[];
  disclaimer: string;
  /** Standing exclusion sentence — see the header's refuse-not-fabricate note. */
  exclusionNote: string;
}

const EXCLUSION_NOTE =
  "This statement reproduces a payoff quote exactly as it was recorded, and states only the amounts listed above. " +
  "Amounts not listed — including any late fees, advances, escrow shortages, or other charges not captured in the " +
  "recorded quote — are excluded from this figure rather than estimated. Verify against your ledger before wiring.";

const FROZEN_NOTE =
  "Rendered from the recorded quote, not from a fresh calculation. Changes made to the loan after the issuance " +
  "timestamp above do not alter this document; a new quote must be issued to reflect them.";

// ---------------------------------------------------------------------------
// Build (pure)
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Validate the frozen row and resolve it into the printable model.
 *
 * Throws `PayoffQuoteRenderRefusal` rather than returning a partial document.
 * `row` is typed loosely on purpose: the screened record coming back from the
 * egress chokepoint is a plain object, and a row read straight out of Postgres
 * can carry nulls in columns TypeScript believes are non-null.
 */
function buildPayoffQuoteStatement(
  row: Partial<NotePayoffQuote> & Record<string, unknown>,
  opts: { orgName?: string | null } = {},
): PayoffQuoteStatement {
  const quoteId = isNonEmptyString(row.id) ? row.id : null;

  // ── EGRESS SCREEN (before anything is read for printing) ─────────────────
  // The chokepoint decides what may leave through "pdf-artifact"; this file
  // never makes that call itself. Withheld regions are removed from the record
  // AND disclosed on the face of the document.
  const { record: screened, screen } = screenRecordForExport(
    PAYOFF_QUOTE_PDF_CHANNEL,
    row as Record<string, unknown>,
  );
  const src = screened as Partial<NotePayoffQuote> & Record<string, unknown>;

  const defects: string[] = [];

  for (const field of REQUIRED_QUOTE_FIELDS) {
    const value = (src as Record<string, unknown>)[field];
    if (value === undefined || value === null || value === "") {
      defects.push(`${field} is missing`);
    }
  }
  for (const field of INTEGER_FIELDS) {
    const value = (src as Record<string, unknown>)[field];
    if (value === undefined || value === null || value === "") continue; // already reported
    const num = Number(value);
    if (!Number.isFinite(num) || !Number.isInteger(num)) {
      defects.push(`${field} is not an integer`);
    }
  }
  for (const field of DATE_FIELDS) {
    const value = (src as Record<string, unknown>)[field];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" || !ISO_DATE.test(value)) {
      defects.push(`${field} is not a YYYY-MM-DD date`);
    }
  }

  if (defects.length > 0) throw new PayoffQuoteRenderRefusal(quoteId, defects);

  const principal = Number(src.principalBalanceCents);
  const accrued = Number(src.accruedInterestCents);
  const lateFees = Number(src.lateFeesOutstandingCents);
  const payoffFee = Number(src.payoffFeeCents);
  const unapplied = Number(src.unappliedCreditCents);
  const total = Number(src.totalPayoffCents);
  const perDiem = Number(src.perDiemInterestCents);

  // ── Self-reconciliation (NOT a recomputation) ────────────────────────────
  // Sum the row's own stored components and compare to the row's own stored
  // total. Nothing outside the row is read. Only applied for the engine
  // version whose total formula is known — a future engine may total
  // differently, and refusing an old row because a NEW rule disagrees would be
  // its own dishonesty.
  // The UNCLAMPED sum, computed separately and deliberately.
  //
  // The engine floors the total at zero (`Math.max(0, …)`). Using the same
  // clamp here made the reconciliation agree with the row BY CONSTRUCTION in
  // exactly the case where the printed components do not sum to the printed
  // total — so the one check advertised as stopping "a document that
  // contradicts its own line items" was silent for the only reachable way to
  // produce one. It is reachable: `computeAcquiredNotePayoff` feeds
  // `unappliedBalanceCents`, a real column, so a borrower holding a deposit
  // larger than their payoff prints a $48,250.00 principal, a $60,000.00
  // credit, and a bare TOTAL PAYOFF $0.00 — components summing to −$11,175.63,
  // with nothing on the page saying the total was floored or that the surplus
  // is returnable. A closer wires $0.00 and the lien releases.
  const unclamped = principal + accrued + lateFees + payoffFee - unapplied;
  const surplusCents = unclamped < 0 ? -unclamped : 0;

  if (src.engineVersion === "payoff-engine-1") {
    const expected = Math.max(0, unclamped);
    if (expected !== total) {
      throw new PayoffQuoteRenderRefusal(quoteId, [
        `stored total ${total} does not reconcile with its own components ` +
          `(principal ${principal} + interest ${accrued} + late fees ${lateFees} + fee ${payoffFee} ` +
          `- credit ${unapplied} = ${expected})`,
      ]);
    }
  }

  const lines: PayoffStatementLine[] = [
    { label: "Principal balance", cents: principal, formatted: fmtCents(principal) },
    {
      label: `Accrued interest (${Number(src.daysAccrued)} ${Number(src.daysAccrued) === 1 ? "day" : "days"})`,
      cents: accrued,
      formatted: fmtCents(accrued),
    },
    { label: "Late fees included", cents: lateFees, formatted: fmtCents(lateFees) },
    { label: "Payoff / processing fee", cents: payoffFee, formatted: fmtCents(payoffFee) },
    {
      label: "Less unapplied credit held",
      cents: -unapplied,
      formatted: unapplied === 0 ? fmtCents(0) : `(${fmtCents(unapplied)})`,
    },
    {
      label: "TOTAL PAYOFF",
      cents: total,
      formatted: fmtCents(total),
      emphasis: true,
    },
    // The floor, STATED on the page rather than hidden behind a bare $0.00.
    // Only present when the components genuinely do not sum to the total —
    // which is the only case where the document would otherwise contradict
    // itself. A closer reading $0.00 is entitled to know the credit exceeded
    // the payoff and by how much; a surplus silently absorbed by a clamp is
    // money the borrower is owed and the page failed to mention.
    ...(surplusCents > 0
      ? [
          {
            label: "Credit balance remaining after payoff (returnable to borrower)",
            cents: surplusCents,
            formatted: fmtCents(surplusCents),
            emphasis: true,
          },
        ]
      : []),
  ];

  const asOf = String(src.payoffDate);
  const goodThrough = String(src.goodThroughDate);

  return {
    quoteId: String(src.id),
    organizationId: Number(src.organizationId),
    orgName: isNonEmptyString(opts.orgName) ? opts.orgName : null,
    noteSystem: String(src.noteSystem),
    noteSystemLabel: NOTE_SYSTEM_LABEL[String(src.noteSystem)] ?? String(src.noteSystem),
    noteRef: String(src.noteRef),
    noteNumber: isNonEmptyString(src.noteNumber) ? src.noteNumber : NOT_RECORDED,
    payerName: isNonEmptyString(src.payerName) ? src.payerName : NOT_RECORDED,
    quotedAt: fmtTimestampUtc(src.quotedAt as Date | string),
    quotedByUserId: isNonEmptyString(src.quotedByUserId) ? src.quotedByUserId : NOT_RECORDED,
    channel: isNonEmptyString(src.channel) ? src.channel : NOT_RECORDED,
    asOfDate: asOf,
    asOfDateFormatted: fmtIsoDate(asOf),
    goodThroughDate: goodThrough,
    goodThroughDateFormatted: fmtIsoDate(goodThrough),
    perDiemCents: perDiem,
    perDiemFormatted: fmtCents(perDiem),
    lines,
    totalPayoffCents: total,
    totalPayoffFormatted: fmtCents(total),
    inputRows: [
      ["Principal balance used", fmtCents(principal)],
      ["Annual rate", fmtRateFromHundredthsBps(Number(src.annualRateBpsHundredths))],
      ["Interest accrues from", fmtIsoDate(String(src.accrualStartDate))],
      ["Interest accrues through", fmtIsoDate(asOf)],
      ["Days accrued", String(Number(src.daysAccrued))],
      ["Day-count convention", String(src.dayCountConvention)],
      ["Calculation engine", String(src.engineVersion)],
    ],
    engineVersion: String(src.engineVersion),
    dayCountConvention: String(src.dayCountConvention),
    operatorNotes: isNonEmptyString(src.notes) ? src.notes : null,
    egressNotice: screen.notice,
    egressAttributions: screen.attributions,
    disclaimer: DISCLAIMER_WORKSHEET,
    exclusionNote: EXCLUSION_NOTE,
  };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const PAGE_LEFT = 54;
const PAGE_RIGHT = 558;
const INK = "#1f2937";
const MUTED = "#6b7280";
const BRAND = "#9C4221"; // terracotta — same brand ink as the property report

/**
 * Draw the statement. Reads ONLY the model — every figure on the page comes
 * from `PayoffQuoteStatement`, which came from the frozen row.
 */
function renderPayoffQuoteStatementPdf(s: PayoffQuoteStatement): Buffer {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let y = 54;

  const text = (
    value: string,
    size: number,
    style: "normal" | "bold",
    color: string,
    x = PAGE_LEFT,
  ) => {
    doc.setFontSize(size);
    doc.setFont("helvetica", style);
    doc.setTextColor(color);
    doc.text(value, x, y);
  };

  const rightText = (value: string, size: number, style: "normal" | "bold", color: string) => {
    doc.setFontSize(size);
    doc.setFont("helvetica", style);
    doc.setTextColor(color);
    doc.text(value, PAGE_RIGHT, y, { align: "right" });
  };

  const rule = () => {
    doc.setDrawColor("#e5e7eb");
    doc.setLineWidth(0.5);
    doc.line(PAGE_LEFT, y, PAGE_RIGHT, y);
    y += 14;
  };

  const paragraph = (value: string, size: number, color: string) => {
    doc.setFontSize(size);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(color);
    const wrapped = doc.splitTextToSize(value, PAGE_RIGHT - PAGE_LEFT);
    doc.text(wrapped, PAGE_LEFT, y);
    y += wrapped.length * (size + 3);
  };

  const kv = (label: string, value: string) => {
    text(label, 9, "normal", MUTED);
    rightText(value, 9, "normal", INK);
    y += 14;
  };

  // ── Header ───────────────────────────────────────────────────────────────
  text("PAYOFF STATEMENT", 18, "bold", BRAND);
  y += 18;
  text(s.orgName ?? "Note holder not recorded", 10, "normal", MUTED);
  y += 12;
  text(`Quote ID ${s.quoteId}`, 9, "normal", MUTED);
  y += 18;
  rule();

  // ── The figure ───────────────────────────────────────────────────────────
  text("Total payoff", 10, "normal", MUTED);
  y += 24;
  text(s.totalPayoffFormatted, 26, "bold", INK);
  y += 18;
  text(
    `Good through ${s.goodThroughDateFormatted} · thereafter ${s.perDiemFormatted} per day`,
    10,
    "normal",
    INK,
  );
  y += 14;
  text(`As of ${s.asOfDateFormatted}`, 10, "normal", MUTED);
  y += 20;
  rule();

  // ── Money block ──────────────────────────────────────────────────────────
  text("Amounts included in this payoff", 11, "bold", INK);
  y += 18;
  for (const line of s.lines) {
    if (line.emphasis) {
      y += 4;
      doc.setDrawColor("#e5e7eb");
      doc.line(PAGE_LEFT, y - 10, PAGE_RIGHT, y - 10);
      text(line.label, 11, "bold", INK);
      rightText(line.formatted, 11, "bold", INK);
    } else {
      text(line.label, 9, "normal", INK);
      rightText(line.formatted, 9, "normal", INK);
    }
    y += 16;
  }
  y += 6;
  rule();

  // ── The frozen inputs ────────────────────────────────────────────────────
  text("Inputs this figure was computed from", 11, "bold", INK);
  y += 18;
  for (const [label, value] of s.inputRows) kv(label, value);
  y += 4;
  rule();

  // ── Identity + provenance ────────────────────────────────────────────────
  text("Quote record", 11, "bold", INK);
  y += 18;
  kv("Quote ID", s.quoteId);
  kv("Issued", s.quotedAt);
  kv("Issued by", s.quotedByUserId);
  kv("Channel", s.channel);
  kv("Ledger", s.noteSystemLabel);
  kv("Note number", s.noteNumber);
  kv("Note reference", s.noteRef);
  kv("Payer", s.payerName);
  y += 4;
  rule();

  if (s.operatorNotes) {
    text("Notes recorded with this quote", 11, "bold", INK);
    y += 16;
    paragraph(s.operatorNotes, 9, INK);
    y += 8;
  }

  // ── Honesty block ────────────────────────────────────────────────────────
  paragraph(s.exclusionNote, 8, MUTED);
  y += 6;
  paragraph(FROZEN_NOTE, 8, MUTED);
  y += 6;

  if (s.egressNotice) {
    paragraph(s.egressNotice, 8, MUTED);
    y += 6;
  }
  for (const attribution of s.egressAttributions) {
    paragraph(attribution, 8, MUTED);
    y += 4;
  }

  // ── Required disclaimer legend ───────────────────────────────────────────
  y += 4;
  rule();
  paragraph(s.disclaimer, 8, MUTED);

  return Buffer.from(doc.output("arraybuffer"));
}

/** Filename a browser should save this artifact under. */
function payoffQuotePdfFilename(quoteId: string): string {
  return `payoff-quote-${quoteId}.pdf`;
}

/**
 * Build + render in one call. The route's entry point.
 *
 * Throws `PayoffQuoteRenderRefusal` when the row cannot be stated honestly.
 */
export function renderPayoffQuotePdf(
  row: Partial<NotePayoffQuote> & Record<string, unknown>,
  opts: { orgName?: string | null } = {},
): { buffer: Buffer; filename: string; statement: PayoffQuoteStatement } {
  const statement = buildPayoffQuoteStatement(row, opts);
  return {
    buffer: renderPayoffQuoteStatementPdf(statement),
    filename: payoffQuotePdfFilename(statement.quoteId),
    statement,
  };
}
