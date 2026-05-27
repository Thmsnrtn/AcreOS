/**
 * Closing checklist generator — phased, state-aware, audit-grade.
 *
 * Mae Vasquez (title-ops audit, 2026-05-27): the previous 12-item flat list
 * was missing the highest-bite items in real closings — survey, HOA estoppel,
 * municipal lien search, two-channel wire verification, CD/closing-statement
 * review window, recording confirmation. Expanded to ~30 phased items
 * organized by the way a deal actually moves through a title office:
 *
 *   pre_contract       → before signatures
 *   under_contract     → contract executed, EMD wired
 *   pre_closing        → title work + payoffs + final figures
 *   closing_day        → signing, funding, disbursement
 *   post_closing       → recording, policy issuance, file close
 *
 * Items are state-specific via stateDocumentConfig.ts (deed type, lien
 * instrument, attorney-state, witness counts, transfer tax).
 *
 * State-bar attorney-required states (NY, NJ, GA, SC, LA + the others
 * configured via attorneyStateForClosing in stateDocumentConfig.ts) are
 * flagged with a retain-attorney item at the top.
 *
 * Items marked critical: true MUST be checked before the deal can be
 * advanced. The two-channel wire-verification gate is critical=true and
 * categorized as "fraud_gate" so the UI can render it as a hard interlock.
 */

import { db } from "../db";
import { dealChecklists } from "@shared/schema";
import { eq } from "drizzle-orm";
import { STATE_DOCUMENT_CONFIGS, getDeedTypeLabel } from "./stateDocumentConfig";
import { logger } from "../utils/logger";

export type ChecklistPhase =
  | "pre_contract"
  | "under_contract"
  | "pre_closing"
  | "closing_day"
  | "post_closing";

export type ChecklistCategory =
  | "title"
  | "survey"
  | "lien_clearance"
  | "deed_prep"
  | "funds"
  | "fraud_gate"
  | "compliance"
  | "recording"
  | "post_close_admin";

export interface ChecklistItem {
  id: string;
  phase: ChecklistPhase;
  category: ChecklistCategory;
  title: string;
  description?: string;
  required: boolean;
  /**
   * Hard-blocking items the UI should render as interlocks that prevent
   * advancing the deal phase until checked. Wire verification, deed
   * signing, recording confirmation are all critical.
   */
  critical: boolean;
  documentRequired: boolean;
  completed?: boolean;
  dueDate?: string;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function fmtDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Build the phased checklist for a deal. Pure function — does NOT touch
 * the database. Use `generateClosingChecklist` to persist.
 */
export function buildClosingChecklist(
  state: string,
  closingDate: Date,
  opts: {
    isSellerFinanced?: boolean;
    hasHoa?: boolean;
    isCashSale?: boolean;
    /** Lender involved (institutional financing on buyer side) */
    hasLender?: boolean;
    /** Property has a known structure (not raw land) — drives HUD-1 etc. */
    improvedProperty?: boolean;
  } = {}
): ChecklistItem[] {
  const {
    isSellerFinanced = false,
    hasHoa = false,
    isCashSale = true,
    hasLender = false,
    improvedProperty = false,
  } = opts;

  const config =
    STATE_DOCUMENT_CONFIGS[state?.toUpperCase()] || STATE_DOCUMENT_CONFIGS.TX;
  const deedLabel = getDeedTypeLabel
    ? getDeedTypeLabel(config.primaryDeedType)
    : config.primaryDeedType.replace(/_/g, " ");
  const lienLabel = config.lienInstrument.replace(/_/g, " ");

  const items: ChecklistItem[] = [];

  // ─── PRE-CONTRACT ───────────────────────────────────────────────────
  if (config.attorneyStateForClosing) {
    items.push({
      id: "retain-attorney",
      phase: "pre_contract",
      category: "compliance",
      title: `Retain closing attorney (required in ${config.stateName})`,
      description:
        "This state requires a licensed attorney to conduct the closing. Engage now to avoid scrambling 5 days out.",
      required: true,
      critical: true,
      documentRequired: false,
      dueDate: fmtDate(addDays(closingDate, -30)),
    });
  }

  items.push(
    {
      id: "verify-seller-identity",
      phase: "pre_contract",
      category: "compliance",
      title: "Verify seller identity + authority to sell",
      description:
        "Government ID, vesting on deed of record, marital status (community-property states), entity good-standing if LLC/trust. Catches identity fraud / forged-deed schemes before contract.",
      required: true,
      critical: true,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, -30)),
    },
    {
      id: "preliminary-lien-screen",
      phase: "pre_contract",
      category: "title",
      title: "Run preliminary lien screen (public records)",
      description:
        "PropStream/ATTOM pre-screen for mortgages, tax liens, judgments, mechanic's liens. NOT a title commitment — only a triage to surface deal-killers before EMD.",
      required: true,
      critical: false,
      documentRequired: false,
      dueDate: fmtDate(addDays(closingDate, -28)),
    },
    {
      id: "mineral-rights-check",
      phase: "pre_contract",
      category: "title",
      title: "Check mineral / water / timber rights severance",
      description:
        "In TX/OK/PA/WV/CO/NM, mineral rights are commonly severed from surface. Confirm what's being conveyed and have it priced into the offer.",
      required: true,
      critical: false,
      documentRequired: false,
      dueDate: fmtDate(addDays(closingDate, -28)),
    },
  );

  // ─── UNDER-CONTRACT ────────────────────────────────────────────────
  items.push(
    {
      id: "open-title-order",
      phase: "under_contract",
      category: "title",
      title: "Open title order with underwriter",
      description:
        "Order from Fidelity / First American / Stewart / Old Republic (or local agent). Provide executed contract, legal description, parties.",
      required: true,
      critical: true,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, -25)),
    },
    {
      id: "emd-to-iolta",
      phase: "under_contract",
      category: "funds",
      title: "Wire EMD to title company's IOLTA / licensed escrow account",
      description:
        "EMD MUST go to a state-bar IOLTA (attorney-state) or licensed escrow account — never a personal account or general operating account. Confirm holder is licensed in property state.",
      required: true,
      critical: true,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, -22)),
    },
    {
      id: "order-survey",
      phase: "under_contract",
      category: "survey",
      title: "Order survey (boundary + improvements)",
      description:
        "ALTA/NSPS land title survey if lender involved; otherwise boundary survey. Surveys take 14-30 days in most markets and are the single most common reason closings slip.",
      required: !isCashSale || improvedProperty,
      critical: false,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, -25)),
    },
    {
      id: "order-municipal-lien-search",
      phase: "under_contract",
      category: "lien_clearance",
      title: "Order municipal lien search",
      description:
        "Code violations, open permits, unpaid water/sewer, special assessments. Required by most underwriters in FL, common practice elsewhere. Often missed — bites at closing.",
      required: true,
      critical: false,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, -21)),
    },
    {
      id: "order-tax-cert",
      phase: "under_contract",
      category: "lien_clearance",
      title: "Order tax certificate (county + city + school)",
      description:
        "Current-year and prior-year property tax status. In TX, request a Tax Certificate from each taxing entity. Catches unpaid taxes that title would otherwise pick up.",
      required: true,
      critical: true,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, -21)),
    },
    {
      id: "order-hoa-estoppel",
      phase: "under_contract",
      category: "lien_clearance",
      title: "Order HOA estoppel letter",
      description:
        "HOA dues, special assessments, transfer fees, capital contribution. Estoppels take 10-15 business days and can add $200-$500 in transfer fees the buyer didn't budget for.",
      required: hasHoa,
      critical: hasHoa,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, -21)),
    },
  );

  // ─── PRE-CLOSING ────────────────────────────────────────────────────
  items.push(
    {
      id: "review-title-commitment",
      phase: "pre_closing",
      category: "title",
      title: "Review title commitment + Schedule B exceptions",
      description:
        "Read Schedule B-I (requirements to clear) and Schedule B-II (permitted exceptions). Every item on B-II survives closing — confirm none are deal-killers (mineral severance, ROW, restrictive covenants).",
      required: true,
      critical: true,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, -14)),
    },
    {
      id: "clear-schedule-b-requirements",
      phase: "pre_closing",
      category: "lien_clearance",
      title: "Clear all Schedule B-I requirements",
      description:
        "Payoffs, releases, satisfactions, affidavits of identity, gap indemnity. Title will not insure until B-I is cleared. Send to underwriter for approval.",
      required: true,
      critical: true,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, -7)),
    },
    {
      id: "obtain-payoffs",
      phase: "pre_closing",
      category: "lien_clearance",
      title: "Obtain mortgage / lien payoff letters (good through closing + 7)",
      description:
        "Payoff must extend past closing date to cover wire delays. Per-diem interest must be calculated. Verify payoff bank routing matches lender of record.",
      required: true,
      critical: true,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, -7)),
    },
    {
      id: "review-survey",
      phase: "pre_closing",
      category: "survey",
      title: "Review survey for encroachments / setback violations",
      description:
        "Encroachments may require survey-coverage endorsement or a fix before closing. Don't sign off on a survey you haven't read.",
      required: !isCashSale || improvedProperty,
      critical: false,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, -10)),
    },
    {
      id: "select-deed-warranty",
      phase: "pre_closing",
      category: "deed_prep",
      title: `Select deed warranty type (default: ${deedLabel})`,
      description:
        "Warranty deed = full warranty against all prior claims (use for owner-financed sales). Special/limited warranty = warrants only against grantor's acts (default for flips). Quitclaim = no warranty (tax-deed acquisitions only). Bargain-and-sale = NY/WA standard.",
      required: true,
      critical: true,
      documentRequired: false,
      dueDate: fmtDate(addDays(closingDate, -10)),
    },
    {
      id: "prepare-deed",
      phase: "pre_closing",
      category: "deed_prep",
      title: `Prepare ${deedLabel} for execution`,
      description: `Vesting verified, legal description from title commitment (not the listing), grantor exactly as on record, witnesses required: ${config.witnessCount}, notary: ${config.notaryRequired ? "yes" : "no"}.`,
      required: true,
      critical: true,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, -5)),
    },
    {
      id: "verify-wire-two-channel",
      phase: "pre_closing",
      category: "fraud_gate",
      title: "VERIFY WIRE INSTRUCTIONS — two-channel out-of-band",
      description:
        "Call the title company at a phone number you independently looked up (their website, NOT the email signature). Confirm routing + account verbally. Wire fraud at closing is the #1 loss vector in real estate. DO NOT WIRE until this is checked.",
      required: true,
      critical: true,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, -3)),
    },
    {
      id: "review-closing-disclosure",
      phase: "pre_closing",
      category: "compliance",
      title: hasLender
        ? "Review Closing Disclosure (CD) — TRID 3-day rule"
        : "Review settlement statement / ALTA Settlement Statement",
      description: hasLender
        ? "Lender-issued CD must be delivered 3 business days before consummation. Any APR change > 1/8% or product change triggers a new 3-day waiting period. Verify figures match contract + payoffs."
        : "Buyer + seller statements (ALTA combined or two-sided). Verify pro-rations (taxes, HOA, rent), credits, transfer tax allocation match contract.",
      required: true,
      critical: true,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, hasLender ? -4 : -2)),
    },
  );

  if (isSellerFinanced) {
    items.push(
      {
        id: "prepare-promissory-note",
        phase: "pre_closing",
        category: "deed_prep",
        title: "Prepare promissory note",
        description:
          "Principal, rate, term, payment schedule, default/acceleration, late fees. Must match Dodd-Frank if seller has financed 4+ properties in 12 months.",
        required: true,
        critical: true,
        documentRequired: true,
        dueDate: fmtDate(addDays(closingDate, -5)),
      },
      {
        id: "prepare-lien-instrument",
        phase: "pre_closing",
        category: "deed_prep",
        title: `Prepare ${lienLabel} for ${config.stateName}`,
        description: `${lienLabel} secures the note against the property. Record alongside the deed at closing.`,
        required: true,
        critical: true,
        documentRequired: true,
        dueDate: fmtDate(addDays(closingDate, -5)),
      },
      {
        id: "dodd-frank-check",
        phase: "pre_closing",
        category: "compliance",
        title: "Run Dodd-Frank / SAFE Act compliance check",
        description:
          "Seller-finance to owner-occupant of 1-4 family: ATR, balloon prohibitions, MLO licensing. Land + non-owner-occupant is generally exempt.",
        required: true,
        critical: true,
        documentRequired: false,
        dueDate: fmtDate(addDays(closingDate, -7)),
      },
    );
  }

  // ─── CLOSING DAY ────────────────────────────────────────────────────
  items.push(
    {
      id: "execute-deed-signing",
      phase: "closing_day",
      category: "deed_prep",
      title: `Execute deed signing (${config.witnessCount} witnesses, notary ${config.notaryRequired ? "required" : "not required"})`,
      description:
        "Grantor signs in presence of notary + required witnesses. Verify ID at signing. RON (remote online notary) acceptable in most states but check underwriter approval.",
      required: true,
      critical: true,
      documentRequired: true,
      dueDate: fmtDate(closingDate),
    },
    {
      id: "wire-purchase-funds",
      phase: "closing_day",
      category: "funds",
      title: "Wire purchase funds to title IOLTA / escrow",
      description:
        "Wire only AFTER verify-wire-two-channel is checked. Use the routing + account confirmed verbally. Federal Reserve wires settle same-day until 5 PM ET; verify receipt with title before signing.",
      required: true,
      critical: true,
      documentRequired: true,
      dueDate: fmtDate(closingDate),
    },
    {
      id: "confirm-funds-received",
      phase: "closing_day",
      category: "funds",
      title: "Confirm title has received + cleared all funds",
      description:
        "Title must confirm wire receipt + funds availability before disbursing. Phantom-wire fraud: bad actor sends a screenshot of a wire that never arrived.",
      required: true,
      critical: true,
      documentRequired: false,
      dueDate: fmtDate(closingDate),
    },
    {
      id: "disburse-seller-proceeds",
      phase: "closing_day",
      category: "funds",
      title: "Disburse seller proceeds + lien payoffs",
      description:
        "Title disburses per settlement statement. Verify lien payoffs sent to correct bank — bad payoff wires are the second most common fraud vector after buyer wires.",
      required: true,
      critical: true,
      documentRequired: true,
      dueDate: fmtDate(closingDate),
    },
  );

  // ─── POST-CLOSING ───────────────────────────────────────────────────
  items.push(
    {
      id: "submit-for-recording",
      phase: "post_closing",
      category: "recording",
      title: `Submit deed for recording at ${config.recordingOffice}`,
      description: `E-recording where available (Simplifile / ePN / CSC) — check docs/erecording-state-matrix.md for ${config.stateName} county coverage. Paper recording otherwise. Typical timeline: ${config.recordingTimeline}.`,
      required: true,
      critical: true,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, 1)),
    },
    {
      id: "confirm-recording",
      phase: "post_closing",
      category: "recording",
      title: "Confirm recording — obtain recording number + book/page",
      description:
        "Until recorded, title is at risk to subsequent recorded interests. Recording closes the gap. Save recording instrument number on the deal.",
      required: true,
      critical: true,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, 7)),
    },
    {
      id: "obtain-final-policy",
      phase: "post_closing",
      category: "title",
      title: "Obtain final owner's title policy from underwriter",
      description:
        "Policy issues post-recording once underwriter clears the gap. Verify Schedule A vesting + insured amount. Keep policy with the deed file — needed for any future claim.",
      required: true,
      critical: false,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, 30)),
    },
    {
      id: "send-recorded-deed",
      phase: "post_closing",
      category: "post_close_admin",
      title: "Send recorded deed copy to buyer",
      description:
        "Original recorded deed returns from county in 1-4 weeks. Stamp + book/page must be visible.",
      required: true,
      critical: false,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, 30)),
    },
    {
      id: "1099-s-filing",
      phase: "post_closing",
      category: "compliance",
      title: "File 1099-S (seller proceeds reporting)",
      description:
        "Settlement agent files 1099-S for sales > $250K (primary residence) or any non-primary. Due by Jan 31 following the closing year.",
      required: true,
      critical: false,
      documentRequired: true,
      dueDate: fmtDate(addDays(closingDate, 60)),
    },
    {
      id: "close-escrow-file",
      phase: "post_closing",
      category: "post_close_admin",
      title: "Close escrow file — reconcile IOLTA, archive documents",
      description:
        "All disbursements posted, no residual escrow, all docs scanned + filed per state record-retention rules (typically 7 years).",
      required: true,
      critical: false,
      documentRequired: false,
      dueDate: fmtDate(addDays(closingDate, 45)),
    },
  );

  if (isSellerFinanced) {
    items.push({
      id: "setup-note-servicing",
      phase: "post_closing",
      category: "post_close_admin",
      title: "Set up note servicing in AcreOS with payment schedule",
      description:
        "Configure amortization, auto-debit, escrow (if applicable), 1098 issuance for borrower.",
      required: true,
      critical: false,
      documentRequired: false,
      dueDate: fmtDate(addDays(closingDate, 14)),
    });
  }

  return items;
}

/**
 * Generate and persist the closing checklist for a deal. Idempotent —
 * if a checklist already exists for the deal, returns the existing one.
 */
export async function generateClosingChecklist(
  dealId: number,
  state: string,
  closingDate: Date | string,
  isSellerFinanced: boolean = false,
  opts: {
    hasHoa?: boolean;
    isCashSale?: boolean;
    hasLender?: boolean;
    improvedProperty?: boolean;
  } = {}
): Promise<{ items: ChecklistItem[]; count: number }> {
  const closing =
    typeof closingDate === "string" ? new Date(closingDate) : closingDate;
  if (isNaN(closing.getTime())) {
    return { items: [], count: 0 };
  }

  // Idempotency check — never blow away an in-progress checklist.
  const existing = await db
    .select()
    .from(dealChecklists)
    .where(eq(dealChecklists.dealId, dealId))
    .limit(1);

  if (existing.length > 0) {
    const items = existing[0].items as unknown as ChecklistItem[];
    return { items, count: items.length };
  }

  const items = buildClosingChecklist(state, closing, {
    isSellerFinanced,
    ...opts,
  });

  await db.insert(dealChecklists).values({
    dealId,
    items: items as any,
  });

  logger.info("Closing checklist generated", {
    dealId,
    state,
    itemCount: items.length,
    phases: {
      pre_contract: items.filter((i) => i.phase === "pre_contract").length,
      under_contract: items.filter((i) => i.phase === "under_contract").length,
      pre_closing: items.filter((i) => i.phase === "pre_closing").length,
      closing_day: items.filter((i) => i.phase === "closing_day").length,
      post_closing: items.filter((i) => i.phase === "post_closing").length,
    },
    critical: items.filter((i) => i.critical).length,
  });

  return { items, count: items.length };
}
