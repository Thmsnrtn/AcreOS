/**
 * The AcreOS Statute Register — a machine-readable inventory of every place
 * this codebase implements a statute, regulation, or government publication,
 * and what checks each implementation has.
 *
 * THIS IS A MAP, NOT A CLAIM OF COMPLIANCE.
 * ----------------------------------------
 * Nothing in this file asserts that AcreOS complies with anything. It asserts
 * only: "here is code that takes a legal obligation on, here is where it
 * lives, and here is who has (or has not) checked it." Read
 * docs/compliance/statute-register.md for the prose version and the honest
 * headline number.
 *
 * WHY THIS EXISTS
 * ---------------
 * In ONE recent program of work, audits found five separate places where this
 * platform encoded a legal obligation in code and got it materially wrong.
 * Every one of them passed every gate:
 *
 *   1. RESPA §1024.39 early intervention fired off a delinquency date derived
 *      from a note whose servicing history the platform had never seen — a
 *      federal obligation triggered by an invented number.
 *   2. Reg-Z §1026.41 periodic statements printed "the 1st of next month" as
 *      the payment due date for EVERY borrower, with a code comment promising
 *      a per-loan override that was never written. The §1026.41(b)(2)
 *      delivery deadline was computed off that same wrong date.
 *   3. The same §1024.39 clock counted from due-date-plus-grace instead of the
 *      due date, delaying a federal obligation by the grace period.
 *   4. An IRS Pub 1220 1099-INT record layout carried multiple wrong field
 *      positions — those e-filings would have been rejected.
 *   5. The Tex. Prop. Code §92.019 late-fee cap selected its statutory branch
 *      off a unit count the platform itself admitted was a guess.
 *
 * The common factor is not carelessness. It is that statute-implementing code
 * is INDISTINGUISHABLE FROM ORDINARY CODE: nothing marked it, nothing listed
 * it, and nobody could answer "what laws does this platform claim to
 * implement, and who checked?" That question now has a file.
 *
 * The ratchet in tests/unit/statuteRegister.test.ts then guarantees:
 *   1. every `codeSites` path resolves to a file that actually exists,
 *   2. every `unit-test` enforcement claim names a test file that exists,
 *   3. ids are unique,
 *   4. the count of UNREVIEWED entries may only SHRINK.
 *
 * Modelled deliberately on shared/governance/constitution.ts — same registry +
 * ratchet shape, same enforcement vocabulary. Do not invent a second pattern.
 *
 * RULES FOR EDITING
 * -----------------
 *  - Every entry must trace to REAL code. If you cannot point at the file,
 *    do not add the entry. An aspirational compliance register is worse than
 *    none, because it reads as assurance.
 *  - Do NOT mark anything `attorney-reviewed`. Nothing in this repo has been.
 *  - `founder-reviewed` requires a DATED decision in docs/company/ that you
 *    can point at, and the `reviewScope` must say what was actually decided.
 *  - `failureMode` is the field that makes this register worth reading. Write
 *    the consequence to the human on the other end — "a borrower is told the
 *    wrong due date on a required disclosure" beats "incorrect behaviour".
 */

/**
 * How the correctness of a statute implementation is checked TODAY.
 * Same vocabulary discipline as the constitution's EnforcementKind.
 */
export type StatuteEnforcementKind =
  /** A vitest suite exercises the rule's logic directly. */
  | "unit-test"
  /** A ratchet test fails the build on drift (counts, forbidden patterns). */
  | "ratchet"
  /** The code REFUSES the action when it cannot satisfy the rule, but no
   *  automated test pins that refusal. Stronger than prose, weaker than a test. */
  | "refusal-path"
  /** Recorded in comments/docs only. NO automated backstop. */
  | "prose-only";

/** Who has read the legal implementation. */
export type StatuteReviewStatus =
  | "attorney-reviewed"
  | "founder-reviewed"
  | "UNREVIEWED";

export interface StatuteEnforcement {
  kind: StatuteEnforcementKind;
  /** Repo-relative paths that check (or embody) the implementation. */
  refs: string[];
  note?: string;
}

export interface StatuteEntry {
  /** Stable kebab/dot id — never reused, never renamed. */
  id: string;
  /**
   * The actual statute / regulation / publication, precise enough to look up.
   * e.g. "12 C.F.R. §1026.41(d)(8)", "Tex. Prop. Code §92.019",
   * "IRS Pub 1220 (Rev. 5-2026)".
   */
  citation: string;
  /** The obligation, one sentence, in plain language. */
  what: string;
  /** Repo-relative files that IMPLEMENT it. These must resolve. */
  codeSites: string[];
  enforcement: StatuteEnforcement;
  reviewStatus: StatuteReviewStatus;
  /** ISO date of the review. Required whenever reviewStatus !== "UNREVIEWED". */
  reviewedAt?: string;
  /** Where the review is recorded, and WHAT it actually covered. */
  reviewScope?: string;
  /** What goes wrong, to whom, if this is wrong. */
  failureMode: string;
  /**
   * Honesty note. Use it when the citation is the REGISTER's characterisation
   * of the obligation rather than a string the code itself carries, or when
   * the implementation is knowingly partial.
   */
  note?: string;
}

export const STATUTE_REGISTER: readonly StatuteEntry[] = [
  // ══════════════════════════════════════════════════════════════════════
  // REGULATION Z — 12 C.F.R. Part 1026 (mortgage servicing)
  // ══════════════════════════════════════════════════════════════════════
  {
    id: "regz.periodic-statement-scope",
    citation:
      "12 C.F.R. §1026.41(a), §1026.41(e); §1026.2(a)(19); §1026.36(a)(4); 12 C.F.R. §1024.2(b)",
    what: "The periodic-statement duty attaches to the SERVICER of a closed-end consumer-purpose loan secured by a dwelling; passive holders, sub-serviced books, business-purpose credit and non-dwelling collateral are out of scope.",
    codeSites: [
      "server/services/periodicStatements/predicate.ts",
      "shared/schema/notes-vertical.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: ["server/services/periodicStatements/predicate.test.ts"],
      note: "Every skip persists a row in periodic_statement_skips carrying the §-citation that authorised it, so a scope determination is auditable rather than silent.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "Too narrow: a borrower AcreOS actually services never receives a statement the law requires, and the skip ledger records a citation justifying the omission — an audit trail that documents the violation. Too broad: AcreOS mails Reg-Z statements on behalf of an org that is a passive holder, asserting a servicing relationship that does not exist.",
  },
  {
    id: "regz.periodic-statement-due-date",
    citation: "12 C.F.R. §1026.41(d)(1)",
    what: "The payment due date printed on a periodic statement is a required disclosure and must be that loan's own due date.",
    codeSites: [
      "server/services/periodicStatements/index.ts",
      "server/services/notes/acquiredNoteSchedule.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: [
        "server/services/periodicStatements/statementDueDate.test.ts",
        "server/services/notes/acquiredNoteSchedule.test.ts",
      ],
      note: "resolveNoteDueDate / resolveAcquiredNoteDueDate return null rather than a calendar constant; the generator then SKIPS the loan with a NO_DERIVABLE_DUE_DATE reason (DUE_DATE_REFUSAL_CITATION). Refuse, never fabricate.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "Every borrower on the book is told in writing, on a federally-required disclosure, that their payment is due on a date their note does not say. They pay late on the servicer's own instruction, incur late fees, and the servicer's delinquency clocks (including RESPA §1024.39) all run off the same wrong date. This is not hypothetical — it is exactly the defect this codebase shipped and later fixed.",
    note: "The historical defect: a comment promised a per-loan override that was never written, so every statement printed 'the 1st of next month'.",
  },
  {
    id: "regz.periodic-statement-content",
    citation:
      "12 C.F.R. §1026.41(d)(1)–(d)(5) (amount due, explanation of amount due, account information, past payment breakdown, transaction activity)",
    what: "Each periodic statement must carry the full enumerated content set: amount due, how the payment will be applied, principal balance, interest rate, payoff, past-payment and year-to-date breakdowns, and the cycle's transactions.",
    codeSites: [
      "server/services/periodicStatements/index.ts",
      "server/services/periodicStatements/pdf.ts",
      "shared/schema/reg-z.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: ["server/services/periodicStatements/periodicStatements.test.ts"],
      note: "auditRequiredFields() names the missing field WITH its §-subsection; the suite drives it. Field-level VALUES (e.g. the payoff accrual approximation) are not independently verified against the regulation.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "A borrower receives a statement that looks complete but omits or misstates a required line — most consequentially the payoff figure or the payment-application split — and makes a payoff or reinstatement decision on a number the servicer computed by approximation rather than from the note.",
  },
  {
    id: "regz.periodic-statement-delivery-timing",
    citation: "12 C.F.R. §1026.41(b), §1026.41(b)(2)",
    what: "A statement must be delivered for each billing cycle, no later than a reasonably prompt time before the next payment is due.",
    codeSites: [
      "server/services/periodicStatements/index.ts",
      "server/services/periodicStatements/delivery.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: ["server/services/periodicStatements/delivery.test.ts"],
      note: "deliveryDeadlineFor() derives the deadline from the per-loan due date (21-day industry-standard lead). The 21-day figure is a convention, not a number the regulation states.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "Statements go out too late to be useful, or the deadline is computed off a wrong due date and the whole book's timing obligation shifts silently. A borrower gets a bill after the payment was already due.",
  },
  {
    id: "regz.delinquency-disclosure-45d",
    citation: "12 C.F.R. §1026.41(d)(8)",
    what: "When a borrower is 45 or more days delinquent, the periodic statement must carry the delinquency block: the date the account became delinquent, the amount needed to bring it current, and HUD housing-counselor contact information.",
    codeSites: [
      "server/services/periodicStatements/index.ts",
      "server/jobs/acquiredNoteAging.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: [
        "server/services/periodicStatements/periodicStatements.test.ts",
        "tests/unit/acquiredNoteAging.test.ts",
      ],
      note: "buildAcquiredDelinquencyInfo() returns undefined — no block at all — when the note carries no delinquency determination, rather than asserting '0 days delinquent'. The originated-notes path still back-computes delinquentSinceDate as (now − daysDelinquent), which is an approximation of a date the disclosure asks for exactly.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "A borrower in genuine distress is told the wrong amount to cure — understating it (they pay, believe they are current, and are not) or is given a delinquency-start date the loan file does not support, which is the date every downstream foreclosure timeline counts from.",
  },
  {
    id: "regz.late-fee-non-pyramiding",
    citation: "12 C.F.R. §1026.36(c)(2)",
    what: "No late fee may be imposed on a periodic payment when the only delinquency is attributable to late fees on an earlier payment and the current payment was itself paid in full within any grace period.",
    codeSites: ["server/services/lateFees/index.ts", "shared/schema/reg-z.ts"],
    enforcement: {
      kind: "unit-test",
      refs: [
        "server/services/lateFees/lateFees.test.ts",
        "server/services/lateFees/acquiredNoteLateFees.test.ts",
      ],
      note: "shouldAssessLateFee() is pure and evaluates ONE cycle in isolation; a UNIQUE index on (loan_id, period_start, loan_type) makes at most one fee per cycle structurally possible.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "A borrower who pays every subsequent month in full is charged a new late fee every month because of one old unpaid fee — the exact debt spiral the rule exists to prevent, and a well-litigated consumer claim.",
  },
  {
    id: "regz.prompt-crediting-and-suspense",
    citation: "12 C.F.R. §1026.36(c)(1)(i), §1026.36(c)(1)(ii)",
    what: "A periodic payment must be credited as of the day it is received, and a partial payment that is held rather than applied must go to a suspense account and be applied once enough accumulates to cover a full periodic payment.",
    codeSites: [
      "server/services/paymentApplication/index.ts",
      "shared/schema/reg-z.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: [
        "server/services/paymentApplication/paymentApplication.test.ts",
        "server/services/paymentApplication/acquiredNotePiggyback.test.ts",
      ],
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "A borrower's on-time payment is credited late, triggering a late fee and a delinquency day-count they did not earn; or a partial payment silently disappears into fees instead of being held, so the borrower's balance never matches their records.",
  },
  {
    id: "regz.ability-to-repay",
    citation: "12 C.F.R. §1026.43(c), §1026.43(e)",
    what: "A creditor must make a reasonable, good-faith ability-to-repay determination at or before consummation of a consumer-purpose closed-end loan secured by a dwelling.",
    codeSites: [
      "server/storage/noteRepo.ts",
      "server/routes-finance.ts",
      "shared/schema.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: ["tests/unit/abilityToRepayGate.test.ts"],
      note: "Gate refusal, evidence record, all 8 caller paths into note creation/activation, and the 0099 DB CHECK constraint are pinned by tests/unit/abilityToRepayGate.test.ts (2026-08-01). Residual: three payment-side status flips (noteRepo.createPayment, routes-borrower's Stripe transaction, achAutopay's settle path) bypass the app-layer gate via direct updates and rely on the DB CHECK alone — which the same audit found missing from scripts/migrate.mjs and which is now mirrored there.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "A seller-financed consumer mortgage is originated inside AcreOS with no ATR determination on file. The borrower gets a loan they cannot repay and, under §1026.43, a defense to foreclosure for the life of the loan — the lender's own product having removed the record that would defend them.",
  },
  {
    id: "regz.seller-financer-exclusion",
    citation:
      "12 C.F.R. §1026.36(a)(4)(i), §1026.36(a)(4)(ii); SAFE Act, 12 U.S.C. §5102; Dodd-Frank Title XIV",
    what: "A seller who finances a limited number of properties per 12-month period is excluded from the definition of loan originator (the 3-property and 1-property natural-person exclusions), and therefore from licensing obligations that otherwise attach.",
    codeSites: [
      "server/services/doddFrankChecker.ts",
      "shared/regulatory/rmloAdvisor.ts",
      "server/services/legalDisclaimers.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: ["tests/unit/doddFrankChecker.test.ts"],
      note: "Output carries DISCLAIMER_WORKSHEET ('guidance, not legal advice') on every artifact.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "An operator is told they are inside a safe harbour they are not inside, originates unlicensed, and the resulting notes are voidable — or the reverse, where a correctly-exempt seller is scared off a legal transaction. The checker's own header concedes it 'provides guidance, not legal advice', which is the honest framing but does not stop reliance.",
  },

  // ══════════════════════════════════════════════════════════════════════
  // RESPA — 12 C.F.R. Part 1024
  // ══════════════════════════════════════════════════════════════════════
  {
    id: "respa.early-intervention-36d",
    citation: "12 C.F.R. §1024.39(a)",
    what: "A servicer must establish or make good-faith efforts to establish live contact with a delinquent borrower not later than the 36th day of delinquency.",
    codeSites: [
      "server/services/respa/earlyIntervention.ts",
      "shared/schema/reg-z.ts",
      "server/jobs/acquiredNoteAging.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: [
        "server/services/respa/earlyIntervention.test.ts",
        "tests/unit/acquiredNoteAging.test.ts",
      ],
      note: "FLAG, NOT OUTREACH. The module fires an idempotent audit event at day 36 and persists the §-citation; it sends NO borrower-facing communication, and as of 2026-08-01 every surface — header, log lines, reason strings, result docs — says so in those words, so a row can no longer be read as a discharged duty. The federal duty is to make contact; wiring an automatic send is a founder decision (hard-stop territory) and is deliberately absent.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "Two distinct failures. (1) The day-36 clock runs off a delinquency date the platform derived rather than observed — a federal obligation triggered by an invented number, which is the defect this codebase actually shipped. (2) An operator sees respa_outreach_events filling up and believes the duty is being discharged, when nothing has ever been sent to a borrower.",
  },
  {
    id: "respa.escrow-account-analysis",
    citation:
      "12 C.F.R. §1024.17(c)(1), §1024.17(f)(2)–(f)(4), §1024.17(i), §1024.17(l)(1)",
    what: "Escrow accounts on federally related mortgages require an annual analysis, a cushion capped at 1/6 of annual disbursements, prescribed surplus/shortage/deficiency handling, and delivery of an annual escrow statement within 30 days of the computation year's end.",
    codeSites: ["server/services/respaEscrowAnalysis.ts", "server/routes-notes.ts"],
    enforcement: {
      kind: "unit-test",
      refs: [
        "tests/unit/respaEscrowStatement.test.ts",
        "tests/unit/respaEscrowAnalysisRoute.test.ts",
      ],
      note: "Uses the FEDERAL cushion cap. State law may be tighter and no state overlay is modelled. The ANALYSIS half is wired (2026-08-01): GET /api/notes/:id/escrow-analysis, org-scoped, seller-finance book only — the acquired book is refused because its schema lacks the 12-month trial-balance inputs and serving it would fabricate. The §1024.17(i) annual STATEMENT builder remains deliberately unwired: the actual-history records it requires exist nowhere in the schema, and the response says annualStatementProduced: false.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "A borrower is required to keep more in escrow than federal law permits, or a surplus of $50 or more is credited forward instead of refunded within 30 days — money withheld from a consumer under colour of a rule the platform read wrong.",
  },

  // ══════════════════════════════════════════════════════════════════════
  // IRS INFORMATION RETURNS
  // ══════════════════════════════════════════════════════════════════════
  {
    id: "irs.pub1220-fire-layout",
    citation: "IRS Publication 1220 (Rev. 5-2026), Part C (T/A/B/C/F record layouts)",
    what: "Electronically filed information returns must be fixed-width 750-character records with every field at its published 1-based position.",
    codeSites: [
      "server/services/irsFireFormat.ts",
      "server/services/form1099Batch.ts",
      "server/services/form1098Batch.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: ["tests/unit/form1098Batch.test.ts", "tests/unit/bookkeeping1099.test.ts"],
      note: "assembleRecord() THROWS when declared fields are non-contiguous or a value's length differs from the spec length, and validateFireFile() checks record length, type sequencing, balanced A/C counts and ascending sequence numbers. Both are STRUCTURAL checks: they prove the file is well-formed, not that any given field sits at the position Pub 1220 assigns it. Only the layout's self-consistency is machine-checked; the positions themselves were transcribed by hand.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "A whole batch of e-filings is rejected by the IRS — or worse, accepted with values landing in the wrong boxes, so every borrower's reported interest is wrong on a return the IRS already has. This codebase has already shipped a 1099-INT layout with multiple wrong field positions; the structural validator did not catch it, because a mis-transcribed position is still self-consistent.",
  },
  {
    id: "irs.form-1098-mortgage-interest",
    citation:
      "26 U.S.C. §6050H (Form 1098, Mortgage Interest Statement; $600 reporting threshold)",
    what: "A person in a trade or business who receives $600 or more of mortgage interest from an individual on a mortgage secured by real property must file Form 1098 and furnish a statement to the payer.",
    codeSites: ["server/services/form1098Batch.ts", "server/services/irsFireFormat.ts"],
    enforcement: {
      kind: "unit-test",
      refs: ["tests/unit/form1098Batch.test.ts"],
      note: "Every mortgage that cannot be reported truthfully produces a structured REFUSAL with a machine code (e.g. BELOW_600_THRESHOLD, TaxIdentityError) rather than a guessed form. The governing rule in the file is stated as 'a wrong tax form is worse than a missing one'.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "A borrower's mortgage-interest deduction is understated or overstated on a form the IRS already holds, and the borrower discovers it during an audit years later. Or the org fails to furnish a required statement at all and takes per-return penalties.",
    note: "The code paraphrases §6050H's text precisely but does not cite the section number; the citation here is the register's identification of the statute being implemented.",
  },
  {
    id: "irs.form-1099-int",
    citation:
      "26 U.S.C. §6049 (Form 1099-INT, returns regarding payments of interest; $600 threshold as applied here)",
    what: "Interest paid out to a recipient at or above the reporting threshold must be reported on Form 1099-INT with a transmittal summary.",
    codeSites: [
      "server/services/form1099Batch.ts",
      "server/services/bookkeeping.ts",
      "server/services/irsFireFormat.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: ["tests/unit/bookkeeping1099.test.ts"],
      note: "Threshold compared exactly in integer cents (60_000) — no float rounding at the boundary.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "A recipient receives a 1099-INT stating interest income they did not earn, or none at all when one was required, and must reconcile against an IRS record they cannot see.",
    note: "The code names the $600 Form 1099-INT threshold but does not cite §6049; the citation here is the register's identification of the statute.",
  },

  // ══════════════════════════════════════════════════════════════════════
  // STATE LANDLORD-TENANT
  // ══════════════════════════════════════════════════════════════════════
  {
    id: "tx.late-fee-cap-92019",
    citation: "Tex. Prop. Code §92.019",
    what: "Residential late fees are capped as a percentage of one month's rent, with a different percentage for properties under 4 units than for properties with 4 or more.",
    codeSites: [
      "shared/rental/lateFeeProposal.ts",
      "shared/schema/rental.ts",
      "scripts/seed-late-fee-rules.ts",
      "server/routes-rent-ledger.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: ["tests/unit/rentalUnitCountForCap.test.ts"],
      note: "Percentage caps are FLOORED, never rounded (one cent over a statutory cap is still over). When the unit count is not exactly known, BOTH statutory branches are computed and the LOWER fee wins. A proposal never posts itself — the operator must echo back the exact proposed figure to charge it.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "A tenant is charged a late fee above the statutory cap. In most states — Texas included — an over-cap fee is not merely refundable; it exposes the landlord to statutory damages and fees, and the tenant's counsel gets a clean claim out of a number the software chose. This codebase previously selected the statutory branch off a unit count it admitted was a guess.",
  },
  {
    id: "state.security-deposit-return",
    citation:
      "State security-deposit statutes, per-state registry (e.g. Tex. Prop. Code §92.103(a), §92.104(c); Cal. Civ. Code §1950.5(g); Fla. Stat. §83.49(3))",
    what: "Each state sets a deadline after move-out by which a landlord must return the deposit and/or furnish an itemized statement of deductions.",
    codeSites: [
      "shared/regulatory/depositReturnRules.ts",
      "server/services/rental/depositClock.ts",
      "server/services/rental/depositDisposition.ts",
    ],
    enforcement: {
      kind: "prose-only",
      refs: ["shared/regulatory/depositReturnRules.ts"],
      note: "NO TEST covers depositReturnRules.ts or the clock/disposition services built on it. The registry's own posture is honest — a state it is not confident about is ABSENT and the absence is surfaced verbatim rather than defaulted to 30 days — but nothing pins the deadlines that ARE encoded. (A separate, overlapping deposit table in server/services/landlordCompliance.ts IS tested; see state.eviction-notice-and-retaliation.)",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "A landlord relies on a countdown the platform computed and misses the statutory deadline. In most states the penalty is not 'return it late' — it is forfeiture of the right to withhold ANYTHING, plus statutory damages (often 2–3x the deposit) plus the tenant's attorney fees. Deposit mishandling is the single most common landlord-tenant claim.",
    note: "ONE deposit registry, as of 2026-08-14. There were TWO — this one and a complete 51-entry SECURITY_DEPOSIT_RULES in server/services/landlordCompliance.ts — and tests/unit/depositRegistriesAgree.test.ts cross-checked them (unit 105): 50 states in both, 46 agreeing, and FOUR giving different statutory day counts while citing the same statute (FL 15 vs 30, ME 30 vs 21, MT 10 vs 30, OK 45 vs 30). Founder ruling (picker, 2026-08-14) retired the duplicate rather than guess which reading of each statute is correct — that is legal judgement, and a confident wrong deadline is worse than an honest gap. The duplicate lived in a module NOTHING IMPORTED and parsed its move-out date with a bare new Date() plus a NaN check, so 2026-02-30 became March 2; both went with it. This registry is deliberately incomplete and REFUSES a state it does not encode ({ known: false, unknownReason }) rather than defaulting to 30 days — that posture is why it was the right survivor, and depositRegistriesAgree.test.ts now asserts single ownership plus the refusal instead of pinning four disagreements. WIDENING coverage is separate, reviewable work and remains open in BLOCKERS B18.",
  },
  {
    id: "state.lease-nonrenewal-notice",
    citation:
      "State lease-termination notice statutes, per-state registry (e.g. Tex. Prop. Code §91.001; Cal. Civ. Code §1946.1; N.Y. RPL §226-c)",
    what: "A landlord must give a state-specified number of days' notice to decline renewal of a fixed-term lease or terminate a month-to-month tenancy.",
    codeSites: ["shared/regulatory/leaseNoticeRules.ts", "server/routes-rentals.ts"],
    enforcement: {
      kind: "prose-only",
      refs: ["shared/regulatory/leaseNoticeRules.ts"],
      note: "NO TEST. Unknown states return null and the UI surfaces 'rule for $STATE not in registry' rather than guessing — the honest default — but the encoded windows themselves are unchecked. The file's own header says it 'will need attorney review per state before being relied on in a courtroom'.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "A landlord sends non-renewal notice on the platform's schedule, the window was actually longer, and the tenancy holds over for another full term — a whole extra lease term of an occupancy the owner had planned around ending.",
  },
  {
    id: "state.eviction-notice-and-retaliation",
    citation:
      "State eviction-notice and retaliation statutes, per-state registry (e.g. Tex. Prop. Code §24.005; Ga. Code §44-7-50; Ohio Rev. Code §1923.04; N.J. Stat. §2A:18-61.2)",
    what: "Pay-or-quit / cure-or-quit / termination notices carry state-specific minimum periods, and most states presume retaliation when an adverse action follows protected tenant activity within a defined window.",
    codeSites: ["server/services/landlordCompliance.ts"],
    enforcement: {
      kind: "unit-test",
      refs: ["tests/unit/landlordCompliance.test.ts"],
      note: "The suite pins the deadline math and retaliation-window logic so schema/data drift cannot silently lengthen a window. It does not verify that any encoded per-state number matches the statute.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "An operator serves a notice period the platform stated, the real statutory period was longer, and the eviction is dismissed at first appearance — the tenant stays, the landlord pays costs, and months are lost. Or an adverse action is taken inside a retaliation window the platform failed to flag.",
  },
  {
    id: "fairhousing.advertising-language",
    citation: "42 U.S.C. §3604(c), §3604(f); Housing for Older Persons Act (42 U.S.C. §3607(b))",
    what: "Housing advertisements may not state a preference, limitation, or discrimination based on a protected class; disability and familial-status language and age-restricted (55+) claims carry specific traps.",
    codeSites: ["server/services/landlordCompliance.ts"],
    enforcement: {
      kind: "unit-test",
      refs: ["tests/unit/landlordCompliance.test.ts"],
      note: "scanFairHousingText() is a red-flag scanner over listing/ad copy. It flags; it does not block. Detection is pattern-based and therefore both over- and under-inclusive.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "AI-generated or operator-written listing copy carrying a protected-class preference ships unflagged, and the org draws a HUD complaint or a testing-organization suit. The inverse failure is quieter but real: an over-eager scanner trains operators to ignore the warnings.",
  },

  // ══════════════════════════════════════════════════════════════════════
  // FEDERAL HOUSING / CONSUMER DISCLOSURE
  // ══════════════════════════════════════════════════════════════════════
  {
    id: "leadpaint.pre-1978-disclosure",
    citation: "42 U.S.C. §4852d; 24 C.F.R. §35.92; 40 C.F.R. §745.113",
    what: "Before a lease on target (pre-1978) housing is executed, the lessor must give the EPA lead-hazard pamphlet, disclose known lead-based paint, and attach the signed disclosure to the lease.",
    codeSites: [
      "server/routes-rentals.ts",
      "shared/schema/rental.ts",
      "shared/schema.ts",
      "server/services/landlordCompliance.ts",
    ],
    enforcement: {
      kind: "refusal-path",
      refs: ["server/routes-rentals.ts", "tests/unit/landlordCompliance.test.ts"],
      note: "A HARD GATE: a pre-1978 lease cannot be created or moved to an executing status without leadPaintDisclosureConfirmed=true and the lead_paint addendum. The gate itself has no dedicated test; only the requiresLeadPaintDisclosure(yearBuilt) predicate is covered.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "A lease on pre-1978 housing executes without the disclosure. Federal penalties run per violation, the lease term is voidable, and — the part that is not about money — a family moves into a unit with an undisclosed lead hazard and a child is exposed.",
  },
  {
    id: "esign.consumer-consent",
    citation: "E-SIGN Act §101(c), 15 U.S.C. §7001(c)",
    what: "Before an electronic record may substitute for a required written consumer disclosure, the consumer must receive the prescribed disclosures and affirmatively consent electronically, in a way that reasonably demonstrates they can access the format.",
    codeSites: [
      "server/routes-public-sign.ts",
      "server/routes-doc-system.ts",
      "server/services/rental/leaseSigningPacket.ts",
      "shared/schema.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: ["tests/unit/esignConsentGate.test.ts"],
      note: "Gate refusal, all five §101(c) flags individually, version-bump invalidation of stale consent, per-signer scoping, consent-before-signature ordering, and lease-execute blocking are pinned by tests/unit/esignConsentGate.test.ts (2026-08-01). KNOWN UNGUARDED SIBLING, pinned in the test as a gap with rewrite-on-fix instructions: POST /api/signatures (routes-doc-system.ts) writes a signature with no consent check. An enumeration ratchet bounds createSignature callers so a third door cannot appear silently.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "An electronically signed consumer document is later held unenforceable because the consent record does not meet §101(c) — the platform's central e-sign value proposition failing precisely in the dispute it was supposed to survive. The five-flag/version design is strong; that no test guards it is the exposure.",
  },
  {
    id: "fcra.permissible-purpose",
    citation: "15 U.S.C. §1681b, §1681b(a)(3)(F)",
    what: "A consumer report may be obtained only for a permissible purpose, and a user must certify that purpose to the reporting agency.",
    codeSites: [
      "server/services/fcraAttestation.ts",
      "server/routes-leads.ts",
      "server/routes-skip-tracing.ts",
      "server/routes-rentals.ts",
      "shared/schema/rental.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: ["tests/unit/fcraPermissiblePurposeGate.test.ts"],
      note: "Gate refusals (annual attestation, per-lookup purpose row, TTL, version), attestation-before-write ordering, adverse-action RECORD path, and skip-trace purpose validation are pinned by tests/unit/fcraPermissiblePurposeGate.test.ts (2026-08-01). The wave's audit found routes-skip-tracing.ts performing lookups with NO gate — closed in the same wave, and the test's enumeration ratchet was inverted to bound writers of createSkipTrace (the ACTION) rather than callers of the gate, so an ungated sibling now fails the suite. Remaining KNOWN GAP pinned in-test: POST /api/tenants CREATE accepts screening fields ungated.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "Consumer-report data is pulled without a permissible purpose on record, or an applicant is denied without the adverse-action notice §1681m requires. FCRA carries statutory damages per consumer and is the classic class-action vehicle — a screening product with an unpinned gate is a class waiting to be certified.",
  },
  {
    id: "scra.tolling-and-rate-cap",
    citation:
      "Servicemembers Civil Relief Act, 50 U.S.C. §3936 (tolling of redemption periods); 50 U.S.C. §3937 (6% interest cap); 50 U.S.C. §3953 (foreclosure protection)",
    what: "Active-duty servicemembers get statutory tolling of redemption periods, a 6% cap on pre-service debt interest, and protection from non-judicial foreclosure.",
    codeSites: [
      "server/services/redemptionClock.ts",
      "shared/schema/notes-vertical.ts",
      "shared/regulatory/rmloAdvisor.ts",
    ],
    enforcement: {
      kind: "prose-only",
      refs: ["server/services/redemptionClock.ts"],
      note: "KNOWINGLY UNIMPLEMENTED. redemptionClock.ts accepts an scraTolling input and discards it (`void input.scraTolling`), with a comment saying full tolling 'lands when we wire active-duty status into the certificate row'. The schema carries scra_checked_at / scra_active_duty columns; rmloAdvisor emits a 6%-cap CHECKLIST LINE. No code applies any SCRA protection.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "The platform shows a redemption deadline that has, by federal law, not yet run for an active-duty borrower — and an operator forecloses or forfeits redemption rights on the strength of it. SCRA violations carry criminal exposure and mandatory attorney fees, and the harmed party is a deployed servicemember. The deadline is presented as a date; nothing on screen distinguishes 'computed' from 'legally binding'.",
  },

  // ══════════════════════════════════════════════════════════════════════
  // OUTBOUND COMMUNICATIONS
  // ══════════════════════════════════════════════════════════════════════
  {
    id: "tcpa.quiet-hours",
    citation: "47 C.F.R. §64.1200(c)(1); 47 U.S.C. §227",
    what: "Telephone solicitations may not be made before 8:00 a.m. or after 9:00 p.m. in the called party's local time.",
    codeSites: ["server/services/tcpaCompliance.ts", "server/services/smsService.ts"],
    enforcement: {
      kind: "unit-test",
      refs: ["tests/unit/tcpaCompliance.test.ts", "tests/unit/tcpaOrgScope.test.ts"],
      note: "The recipient's timezone is NOT reliably inferable from an area code, and the code says so. Where leads.timezone is absent it falls back to an area-code heuristic deliberately skewed toward BLOCKING (widest envelope). The gate lives inside smsService.tcpaGateForRecipient, a single choke point, so no send path can skip it.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "A marketing SMS lands at 6:30 a.m. because the recipient moved states and kept their number. TCPA statutory damages are $500–$1,500 PER MESSAGE and the claim is trivially provable from the message timestamp; a campaign is thousands of messages.",
  },
  {
    id: "tcpa.dnc-and-litigator-scrub",
    citation: "47 C.F.R. §64.1200(c)(2) (federal Do-Not-Call registry); 47 U.S.C. §227(c)",
    what: "Telephone solicitations may not be made to a number on the national Do-Not-Call registry absent an established business relationship or express consent, and registry data must be re-scrubbed on the registry's cycle.",
    codeSites: [
      "server/services/compliance/dncScrub.ts",
      "server/services/compliance/searchbugDncProvider.ts",
      "server/services/smsService.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: [
        "tests/unit/dncScrub.test.ts",
        "tests/unit/searchbugDncProvider.test.ts",
        "tests/unit/smsGateAndCapture.test.ts",
      ],
      note: "Two distinct 'no verdict' states, and they are NOT the same: NO VENDOR SELECTED leaves the seam inert and reports scrubbed:false (nobody claimed a scrub happened); VENDOR SELECTED BUT UNUSABLE reports an ERROR and FAILS CLOSED for lead-matched marketing, because an operator who configured a vendor believes numbers are being scrubbed. Litigator hits always block, consent or not. This distinction exists because a selected-but-uncredentialed provider once collapsed to 'no vendor configured' and passed every number.",
    },
    reviewStatus: "founder-reviewed",
    reviewedAt: "2026-07-29",
    reviewScope:
      "docs/company/founder-decisions-2026-07-28.md §13 — the founder reviewed and decided the VENDOR and the required coverage (federal/state DNC + litigators + FCC Reassigned Numbers) and the decision to build the seam. The §64.1200 legal analysis itself has NOT been reviewed by counsel.",
    failureMode:
      "Cold outreach reaches a registered number or a known TCPA serial plaintiff. The litigator case is the severe one: a serial plaintiff is not a lead, they are a filed complaint, and they pursue it professionally.",
  },
  {
    id: "canspam.commercial-email-footer",
    citation: "CAN-SPAM Act §5(a)(3), §5(a)(5); 15 U.S.C. §7704(a)(3), (a)(5)",
    what: "Every commercial email must contain a functioning opt-out mechanism and the sender's valid physical postal address.",
    codeSites: ["server/services/emailService.ts", "server/services/unsubscribeTokens.ts"],
    enforcement: {
      kind: "unit-test",
      refs: [
        "tests/unit/canSpamFooterAddress.test.ts",
        "tests/unit/canSpamFooterDefault.test.ts",
      ],
      note: "SAFE DEFAULT: the footer renders on EVERY send unless the caller explicitly passes transactional:true — the failure mode of a mislabelled email is an unnecessary footer, not a missing one. Postal address resolves platform secret → sending org's address on file → omitted (never invented).",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "A commercial email ships with no postal address or a dead unsubscribe link. CAN-SPAM penalties run per email and, more practically, a broken opt-out is what turns one annoyed recipient into a complaint to the sending domain's provider — killing deliverability for every customer on the rail.",
  },

  // ══════════════════════════════════════════════════════════════════════
  // MONEY MOVEMENT
  // ══════════════════════════════════════════════════════════════════════
  {
    id: "money.no-platform-custody",
    citation:
      "31 C.F.R. §1010.100(ff)(5) (FinCEN 'money transmitter'); state money-transmitter licensing statutes",
    what: "AcreOS must never take custody of customer-managed money: borrower note payments, rent, escrow and distributions move on the customer's OWN connected processor account or are routed out entirely — no platform-account fallback, no application fee, no funds transiting AcreOS's balance.",
    codeSites: [
      "server/services/customerMoneyRouting.ts",
      "server/services/achMandateSetup.ts",
      "server/services/achAutopay.ts",
    ],
    enforcement: {
      kind: "ratchet",
      refs: [
        "tests/unit/moneyCustodyHardStop.test.ts",
        "tests/unit/customerMoneyRouting.test.ts",
        "tests/unit/achAutopayMoneyPath.test.ts",
      ],
      note: "Runtime chokepoint + structural ratchet. prepareCustomerMoneyCall() throws PlatformTakeError when a call carries ANY of the four Stripe platform-take parameters at any depth, and UnscopedCustomerMoneyCallError when there is no org account to scope to. The ratchet asserts those four parameter names appear NOWHERE in server/, shared/ or client/src/ except inside the guard that forbids them — which is why this note DESCRIBES them rather than spelling them: naming them here would itself trip the gate, and it did on first write. Weakening the ratchet to admit documentation was the alternative and was rejected; this is the strictest money stop in the repo and a hard-stop gate is not loosened for prose. Read the four names in server/services/customerMoneyRouting.ts. Also mirrored in shared/governance/constitution.ts as hard-stop.no-platform-money-custody.",
    },
    reviewStatus: "founder-reviewed",
    reviewedAt: "2026-07-29",
    reviewScope:
      'docs/company/founder-decisions-2026-07-28.md §15 ("be the rail, not the provider") — the founder reviewed the custody audit of 30 money-touching surfaces and ruled to route out entirely, accepting the lost fee. Not reviewed by counsel; no licensing opinion exists.',
    failureMode:
      "Consumer mortgage payments settle into AcreOS's own platform balance with no payout path — AcreOS becomes merchant of record for money it cannot release, and arguably an unlicensed money transmitter in every state where a borrower pays. This is not hypothetical: it was live on 2026-07-29 (borrower Checkout sessions created with no stripeAccount at all) and was found by audit, not by a gate.",
  },
  {
    id: "nacha.ach-authorization-record",
    citation: "NACHA Operating Rules §2.3 (Originator obligation to obtain and retain the Receiver's authorization)",
    what: "Before originating an ACH debit, the Originator must obtain the Receiver's authorization in a retainable form and retain it, including its exact text and the method by which it was obtained.",
    codeSites: [
      "shared/schema/ach-autopay.ts",
      "server/services/achMandateSetup.ts",
      "server/services/borrower/autopayAuthorizationChallenge.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: [
        "tests/unit/borrowerAutopayMandateChallenge.test.ts",
        "tests/unit/achAutopayMoneyPath.test.ts",
      ],
      note: "The mandate stores the authorization TEXT and its version, not a boolean — 'a boolean is not an authorization'. A server-issued single-use challenge (UNIQUE index on authorization_challenge_id) proves the server actually rendered that exact text to that borrower; the client-supplied authorizationAccepted flag was demoted from proof to corroboration after it was found to be the sole gate.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "An ACH debit is originated against a consumer bank account with no defensible authorization on file. The borrower disputes, the ODFI charges the return back, and the org cannot produce what it was required to retain — on the money path, where the customer is a consumer and the counterparty is a bank.",
  },

  // ══════════════════════════════════════════════════════════════════════
  // SANCTIONS / STATE LENDING / TAX SALE
  // ══════════════════════════════════════════════════════════════════════
  {
    id: "ofac.sanctions-screening-advisory",
    citation: "31 C.F.R. Chapter V (OFAC sanctions programs; SDN List)",
    what: "US persons may not transact with sanctioned parties; AcreOS screens counterparty names against an SDN-style list and records an ADVISORY result.",
    codeSites: [
      "server/services/compliance/ofacScreening.ts",
      "server/services/compliance/sanctionsListSync.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: [
        "server/services/compliance/ofacScreening.test.ts",
        "server/services/compliance/sanctionsListSync.test.ts",
      ],
      note: "EXPLICITLY ADVISORY. The module's own header refuses to be represented as a legal determination, as evidence of a compliant screening program, or as a substitute for human review. A potential_match raises a founder-visible flag for MANUAL review and does NOT block the originating action.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "The dangerous failure here is not a missed name — it is FALSE ASSURANCE. An operator sees 'clear' on a screening panel and believes they have a sanctions-screening program. They do not: this is fuzzy name matching against a cached list, it blocks nothing, and the disclaimer that says so lives in a code comment and one line of UI copy.",
    note: "Included because the platform touches a sanctions obligation, not because it claims to discharge one. Its value in this register is the disclaimer, and whether that disclaimer survives to the screen.",
  },
  {
    id: "state.usury-ceilings",
    citation:
      "State usury statutes, per-state registry (e.g. Tex. Fin. Code §302.001; Cal. Const. Art. XV §1; Fla. Stat. §687.01)",
    what: "Interest on a seller-financed note may not exceed the receiving state's applicable usury ceiling; exceeding it can forfeit all interest, void the loan, or carry criminal penalties.",
    codeSites: [
      "server/services/usury.ts",
      "server/services/usuryCeiling.ts",
      "shared/regulatory/rmloAdvisor.ts",
      "server/services/regulatoryIntelligence.ts",
      "server/middleware/complianceGate.ts",
    ],
    enforcement: {
      kind: "unit-test",
      refs: [
        "tests/unit/usury.test.ts",
        "tests/unit/usuryCeiling.test.ts",
        "tests/unit/usuryConsistency.test.ts",
      ],
      note: "usuryCeiling.test.ts now imports the real service (2026-08-01) and its 51-state table matches the independent spec on every ceiling. usuryConsistency.test.ts probes all sources through their public APIs and pins the state of agreement: 23 states agree, 3 lane-mismatches are allowlisted with reasons, and 25 states carry UNRECONCILED conflicts (pinned individually, dated it.skip on the agreement assertion). None are resolvable from the citations in-repo; resolving them is legal research, not refactoring.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "A note is written at a rate the platform said was legal and the state says is usurious — forfeiting all interest on the note, or voiding it. FOUR independent usury tables exist (usury.ts — the only one production actually calls; usuryCeiling.ts — the best-tested and entirely UNWIRED; rmloAdvisor.ts; and regulatoryIntelligence.ts, discovered during the consistency work), so different surfaces can give an operator different answers about the same rate. Named suspect entries: usury.ts NV 40% vs no-cap elsewhere; TX a three-way conflict AND the silent fallback state; rmloAdvisor AK stores a margin as a cap by its own note's admission.",
    note: "CONSOLIDATION REQUIRED: four tables must become one registry, and the survivor should be the tested one. That is a legal-content decision (25 conflicts need resolving against the actual statutes) — flagged for founder/attorney review, not a refactor to run unattended.",
  },
  {
    id: "state.tax-lien-redemption",
    citation:
      "State tax-sale redemption statutes, per-state registry (e.g. Ala. Code §40-10-29 et seq.; Ariz. Rev. Stat. §42-18101 et seq.; Fla. Stat. §197.402 et seq.)",
    what: "After a tax sale, the owner has a state-defined redemption period and redemption amount (often with statutory interest or a bid-down rate) before title can be perfected.",
    codeSites: [
      "shared/regulatory/taxLienStateRules.ts",
      "server/services/redemptionClock.ts",
      "server/jobs/redemptionClockRefresh.ts",
      "server/services/taxRuleCoverage.ts",
    ],
    enforcement: {
      kind: "prose-only",
      refs: ["shared/regulatory/taxLienStateRules.ts", "server/services/taxRuleCoverage.ts"],
      note: "NO TEST covers redemptionClock.ts's deadline arithmetic (including the first-Monday-after-sale anchor) or the per-state periods. taxRuleCoverage.ts tracks which jurisdictions have rules on file, which is coverage bookkeeping, not correctness.",
    },
    reviewStatus: "UNREVIEWED",
    failureMode:
      "An investor is shown a redemption deadline that has not actually expired and acts on it — quiet title, resale, eviction of a redeeming owner — or, on the other side, an owner is told their redemption window has closed when it has not, and loses their property to a date the software computed. See also scra.tolling-and-rate-cap: SCRA tolling on this same clock is accepted as an input and discarded.",
  },
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────

export function statuteById(id: string): StatuteEntry | undefined {
  return STATUTE_REGISTER.find((e) => e.id === id);
}

/**
 * The honest headline: statutes this platform implements that no lawyer has
 * read. This number is expected to be high for a solo founder with zero
 * customers. The register's job is to make it VISIBLE and SHRINKABLE, not to
 * pretend otherwise.
 */
export function unreviewed(): StatuteEntry[] {
  return STATUTE_REGISTER.filter((e) => e.reviewStatus === "UNREVIEWED");
}

/** Entries whose only backstop is a comment. Enforcement debt. */
export function unenforced(): StatuteEntry[] {
  return STATUTE_REGISTER.filter((e) => e.enforcement.kind === "prose-only");
}

/** Entries backed by a refusal in code that no test pins. */
export function refusalOnly(): StatuteEntry[] {
  return STATUTE_REGISTER.filter((e) => e.enforcement.kind === "refusal-path");
}

export function byEnforcement(kind: StatuteEnforcementKind): StatuteEntry[] {
  return STATUTE_REGISTER.filter((e) => e.enforcement.kind === kind);
}
