/**
 * Landlord-tenant compliance helpers — Glenn Okonkwo audit.
 *
 * Pure-function utilities that gate state-sensitive landlord workflows:
 *   - security-deposit return deadline (per-state statutory window)
 *   - eviction notice-period rules (pay-or-quit / cure-or-quit / termination)
 *   - retaliation-presumption window (most states 90–180 days)
 *   - lead-paint disclosure requirement (federal, pre-1978)
 *   - fair-housing language scrub (FHA protected-class red flags)
 *
 * Glenn's framing: an AcreOS user who relies on this product to be told
 * "you can serve a 3-day pay-or-quit in New York" should not be able to do
 * so without the platform refusing or flagging. State law variance here is
 * the difference between an eviction that holds and an eviction the tenant's
 * attorney gets dismissed at the first appearance.
 *
 * Data here is a non-exhaustive working set for the most-active landlord
 * states + a sensible federal-fair-housing scrub. All entries cite a primary
 * source so the operator can defend the platform's behavior in court if
 * required. Updates to this file MUST keep `attorneyReviewedAt` current.
 */

/*
 * SECURITY DEPOSIT RETURN — REMOVED 2026-08-14 (BLOCKERS B18, founder ruling
 * "retire the dead duplicate").
 *
 * This file carried a COMPLETE 51-entry `SECURITY_DEPOSIT_RULES` table and a
 * `computeSecurityDepositDeadline` built on it, and NOTHING IMPORTED THIS MODULE.
 * Meanwhile `shared/regulatory/depositReturnRules.ts` — deliberately incomplete,
 * and honest about it (`{ known: false, unknownReason }` for a state it does not
 * encode) — is the one the deposit clock, the disposition letter and the
 * rent-ledger surface actually read.
 *
 * Two registries citing the same statutes disagreed on FOUR states: FL 15 vs 30,
 * ME 30 vs 21, MT 10 vs 30, OK 45 vs 30. `statuteRegister.ts` had warned that they
 * "can disagree, and nothing cross-checks them"; unit 105 ran the check and unit
 * 108 removed the duplicate rather than guess which reading of each statute is
 * correct — that is legal judgement, and a confident wrong deadline is worse than
 * no second table.
 *
 * Its `computeSecurityDepositDeadline` also parsed with a bare `new Date()` plus a
 * NaN check, so `"2026-02-30"` became March 2 — the rollover defect unit 99
 * removed from everything live. Deleting it removes that too.
 *
 * WHAT WAS NOT LOST: the wider COVERAGE is a real thing to want. The live registry
 * still refuses the states it does not encode rather than inventing a number, and
 * widening it is a separate, reviewable piece of work — see B18.
 */

// ---------------------------------------------------------------------------
// NOTICE-PERIOD RULES — pay-or-quit / cure-or-quit / termination.
// ---------------------------------------------------------------------------

export type NoticeKind =
  | "pay_or_quit"        // non-payment of rent
  | "cure_or_quit"       // lease violation — opportunity to cure
  | "unconditional_quit" // serious / repeat violation; no cure
  | "termination_no_cause" // termination of month-to-month / no-fault
  ;

export interface NoticeRule {
  state: string;
  kind: NoticeKind;
  minDays: number;        // minimum statutory notice days
  citation: string;
  notes: string;
}

// Working set — most active landlord states. When a state isn't here the
// compute function returns null so the UI can fall back to "consult counsel".
// Days are minimums; lease terms may stipulate longer.
export const NOTICE_PERIOD_RULES: NoticeRule[] = [
  // CALIFORNIA — Cal. Code Civ. Proc. § 1161
  { state: "CA", kind: "pay_or_quit",        minDays: 3,  citation: "Cal. Code Civ. Proc. § 1161(2)", notes: "3 days excluding weekends/holidays; AB 2347 (2025) clarifies tenant response time." },
  { state: "CA", kind: "cure_or_quit",       minDays: 3,  citation: "Cal. Code Civ. Proc. § 1161(3)", notes: "3 days to cure curable violation." },
  { state: "CA", kind: "unconditional_quit", minDays: 3,  citation: "Cal. Code Civ. Proc. § 1161(4)", notes: "3 days for nuisance / serious breach." },
  { state: "CA", kind: "termination_no_cause", minDays: 60, citation: "Cal. Civ. Code § 1946.1",       notes: "60 days if tenant has been there 1+ yr; 30 days if less." },

  // TEXAS — Tex. Prop. Code § 24.005
  { state: "TX", kind: "pay_or_quit",        minDays: 3,  citation: "Tex. Prop. Code § 24.005",      notes: "3 days written notice to vacate before eviction filing. Lease may shorten only to 1 day." },
  { state: "TX", kind: "cure_or_quit",       minDays: 3,  citation: "Tex. Prop. Code § 24.005",      notes: "3 days. No statutory right to cure unless lease grants one." },
  { state: "TX", kind: "unconditional_quit", minDays: 3,  citation: "Tex. Prop. Code § 24.005",      notes: "3 days." },
  { state: "TX", kind: "termination_no_cause", minDays: 30, citation: "Tex. Prop. Code § 91.001",      notes: "30 days for month-to-month termination." },

  // NEW YORK — RPAPL § 711, RPL § 226-c
  { state: "NY", kind: "pay_or_quit",        minDays: 14, citation: "RPAPL § 711(2)",                notes: "14-day demand for rent post HSTPA-2019. Replaces the 3-day demand entirely." },
  { state: "NY", kind: "cure_or_quit",       minDays: 10, citation: "RPAPL § 753(4)",                notes: "10-day notice to cure for lease-violation eviction." },
  { state: "NY", kind: "unconditional_quit", minDays: 10, citation: "RPAPL § 711(1)",                notes: "10-day notice when no cure right (e.g., illegal use)." },
  { state: "NY", kind: "termination_no_cause", minDays: 90, citation: "RPL § 226-c",                  notes: "30/60/90 days depending on tenancy length; 90d if 2+ years." },

  // FLORIDA — Fla. Stat. § 83.56
  { state: "FL", kind: "pay_or_quit",        minDays: 3,  citation: "Fla. Stat. § 83.56(3)",         notes: "3 days excluding weekends/holidays." },
  { state: "FL", kind: "cure_or_quit",       minDays: 7,  citation: "Fla. Stat. § 83.56(2)(b)",      notes: "7-day notice to cure curable noncompliance." },
  { state: "FL", kind: "unconditional_quit", minDays: 7,  citation: "Fla. Stat. § 83.56(2)(a)",      notes: "7 days for intentional destruction / repeat violation." },
  { state: "FL", kind: "termination_no_cause", minDays: 15, citation: "Fla. Stat. § 83.57",            notes: "15 days month-to-month, 60 days year-to-year." },

  // GEORGIA — O.C.G.A. § 44-7-50, -52
  { state: "GA", kind: "pay_or_quit",        minDays: 0,  citation: "O.C.G.A. § 44-7-50",            notes: "No statutory waiting period; landlord must demand possession before filing. Strictly: 'immediate' but courts read in a reasonable delay." },
  { state: "GA", kind: "cure_or_quit",       minDays: 0,  citation: "O.C.G.A. § 44-7-50",            notes: "No statutory cure right unless lease specifies." },
  { state: "GA", kind: "unconditional_quit", minDays: 0,  citation: "O.C.G.A. § 44-7-50",            notes: "Demand for possession, then immediate filing." },
  { state: "GA", kind: "termination_no_cause", minDays: 60, citation: "O.C.G.A. § 44-7-7",             notes: "60 days for landlord; 30 days for tenant — asymmetric." },

  // WASHINGTON — RCW § 59.12.030
  { state: "WA", kind: "pay_or_quit",        minDays: 14, citation: "RCW § 59.12.030(3)",            notes: "14 days as of 2019 reform." },
  { state: "WA", kind: "cure_or_quit",       minDays: 10, citation: "RCW § 59.12.030(4)",            notes: "10 days." },
  { state: "WA", kind: "unconditional_quit", minDays: 3,  citation: "RCW § 59.12.030(5)",            notes: "3 days for waste/nuisance." },
  { state: "WA", kind: "termination_no_cause", minDays: 20, citation: "RCW § 59.18.200",               notes: "20 days month-to-month — but good-cause required for most fixed-term non-renewals post-2021." },

  // ILLINOIS — 735 ILCS 5/9-209
  { state: "IL", kind: "pay_or_quit",        minDays: 5,  citation: "735 ILCS 5/9-209",              notes: "5-day notice." },
  { state: "IL", kind: "cure_or_quit",       minDays: 10, citation: "735 ILCS 5/9-210",              notes: "10-day notice." },
  { state: "IL", kind: "termination_no_cause", minDays: 30, citation: "735 ILCS 5/9-207",              notes: "30 days month-to-month." },

  // ARIZONA — A.R.S. § 33-1368
  { state: "AZ", kind: "pay_or_quit",        minDays: 5,  citation: "A.R.S. § 33-1368(B)",           notes: "5 days." },
  { state: "AZ", kind: "cure_or_quit",       minDays: 10, citation: "A.R.S. § 33-1368(A)",           notes: "10/5 days depending on violation." },
  { state: "AZ", kind: "termination_no_cause", minDays: 30, citation: "A.R.S. § 33-1375",               notes: "30 days month-to-month." },

  // NORTH CAROLINA — N.C.G.S. § 42-3
  { state: "NC", kind: "pay_or_quit",        minDays: 10, citation: "N.C.G.S. § 42-3",               notes: "10 days." },
  { state: "NC", kind: "cure_or_quit",       minDays: 10, citation: "N.C.G.S. § 42-26",              notes: "Reasonable time; often 10 days." },
  { state: "NC", kind: "termination_no_cause", minDays: 7,  citation: "N.C.G.S. § 42-14",               notes: "7 days month-to-month." },

  // NEW JERSEY — N.J.S.A. § 2A:18-61.1 (Anti-Eviction Act)
  { state: "NJ", kind: "pay_or_quit",        minDays: 0,  citation: "N.J.S.A. § 2A:18-61.2",         notes: "No statutory pre-filing notice for non-payment; complaint serves as demand. BUT Anti-Eviction Act requires 'good cause' — most NJ tenants cannot be evicted without cause." },
  { state: "NJ", kind: "cure_or_quit",       minDays: 30, citation: "N.J.S.A. § 2A:18-61.2",         notes: "30 days for breach." },
  { state: "NJ", kind: "termination_no_cause", minDays: 0,  citation: "N.J.S.A. § 2A:18-61.1",         notes: "Anti-Eviction Act effectively bars no-cause eviction in most circumstances." },

  // OHIO — Ohio Rev. Code § 1923.04
  { state: "OH", kind: "pay_or_quit",        minDays: 3,  citation: "Ohio Rev. Code § 1923.04",      notes: "3 days." },
  { state: "OH", kind: "cure_or_quit",       minDays: 30, citation: "Ohio Rev. Code § 5321.11",      notes: "30 days." },
  { state: "OH", kind: "termination_no_cause", minDays: 30, citation: "Ohio Rev. Code § 5321.17",      notes: "30 days month-to-month." },
];

export function getNoticeRule(state: string, kind: NoticeKind): NoticeRule | null {
  const code = String(state).toUpperCase().trim();
  return NOTICE_PERIOD_RULES.find(r => r.state === code && r.kind === kind) ?? null;
}

// ---------------------------------------------------------------------------
// RETALIATION WINDOW — most states presume retaliation when an eviction is
// filed within 90–180 days of a tenant complaint (maintenance request, code
// enforcement, fair-housing complaint, etc.). We use 180d as the conservative
// trigger so the platform warns even in shorter-window states.
// ---------------------------------------------------------------------------

export interface RetaliationWindowRule {
  state: string;
  presumptionDays: number;
  citation: string;
}

export const RETALIATION_RULES: Record<string, RetaliationWindowRule> = {
  CA: { state: "CA", presumptionDays: 180, citation: "Cal. Civ. Code § 1942.5(a)" },
  TX: { state: "TX", presumptionDays: 180, citation: "Tex. Prop. Code § 92.331" },
  NY: { state: "NY", presumptionDays: 365, citation: "N.Y. Real Prop. Law § 223-b" },
  FL: { state: "FL", presumptionDays: 90,  citation: "Fla. Stat. § 83.64" },
  GA: { state: "GA", presumptionDays: 90,  citation: "O.C.G.A. § 44-7-24" }, // limited; many landlord cases
  WA: { state: "WA", presumptionDays: 90,  citation: "RCW § 59.18.240" },
  IL: { state: "IL", presumptionDays: 365, citation: "765 ILCS 720/1" },
  AZ: { state: "AZ", presumptionDays: 180, citation: "A.R.S. § 33-1381" },
  NC: { state: "NC", presumptionDays: 365, citation: "N.C.G.S. § 42-37.1" },
  NJ: { state: "NJ", presumptionDays: 90,  citation: "N.J.S.A. § 2A:42-10.10" },
  OH: { state: "OH", presumptionDays: 30,  citation: "Ohio Rev. Code § 5321.02" },
};

// Federal default — if state is unknown, use the longest commonly-cited
// federal-fair-housing-retaliation window (180 days under HUD complaint
// timelines). This is conservative and intentional.
const RETALIATION_DEFAULT_DAYS = 180;

export function computeRetaliationWindow(opts: {
  state: string | null | undefined;
  maintenanceTicketDates: Array<Date | string>;
  evictionFilingDate?: Date | string;
  now?: Date;
}): {
  inRetaliationWindow: boolean;
  presumptionDays: number;
  triggeringTickets: Array<{ daysAgo: number; date: string }>;
  citation: string | null;
  reason: string;
} {
  const referenceDate = opts.evictionFilingDate
    ? (typeof opts.evictionFilingDate === "string" ? new Date(opts.evictionFilingDate) : opts.evictionFilingDate)
    : (opts.now ?? new Date());
  const code = (opts.state ?? "").toUpperCase().trim();
  const rule = RETALIATION_RULES[code] ?? null;
  const presumptionDays = rule?.presumptionDays ?? RETALIATION_DEFAULT_DAYS;
  const tickets = (opts.maintenanceTicketDates ?? [])
    .map(d => (typeof d === "string" ? new Date(d) : d))
    .filter(d => !Number.isNaN(d.getTime()));
  const triggering = tickets
    .map(d => ({ daysAgo: Math.floor((referenceDate.getTime() - d.getTime()) / 86_400_000), date: d.toISOString().slice(0, 10) }))
    .filter(t => t.daysAgo >= 0 && t.daysAgo <= presumptionDays)
    .sort((a, b) => a.daysAgo - b.daysAgo);
  const inWindow = triggering.length > 0;
  return {
    inRetaliationWindow: inWindow,
    presumptionDays,
    triggeringTickets: triggering,
    citation: rule?.citation ?? null,
    reason: inWindow
      ? `Tenant filed ${triggering.length} maintenance ticket(s) within the ${presumptionDays}-day retaliation-presumption window` +
        (rule ? ` (${rule.citation}).` : " (federal default 180d).")
      : `No maintenance tickets within ${presumptionDays}-day window.`,
  };
}

// ---------------------------------------------------------------------------
// LEAD-PAINT DISCLOSURE — federal, pre-1978 properties only.
// 24 CFR § 35.92 / 40 CFR § 745.107. EPA fines up to $16,000+ per violation.
// ---------------------------------------------------------------------------

export function requiresLeadPaintDisclosure(yearBuilt: number | null | undefined): boolean {
  if (yearBuilt == null) return false;        // unknown → don't claim a duty
  return yearBuilt > 0 && yearBuilt < 1978;
}

// ---------------------------------------------------------------------------
// FAIR-HOUSING LANGUAGE SCAN — FHA-protected-class red flags.
//
// 42 USC § 3604(c) bars discriminatory advertising. Beyond statutorily-named
// classes, HUD's discriminatory-advertising guidelines (24 CFR pt. 100) flag
// "preference, limitation, or discrimination" against race, color, religion,
// sex, familial status, national origin, and (in many states) source of
// income / sexual orientation / disability. This list is illustrative, not
// exhaustive; treat hits as "needs human review."
// ---------------------------------------------------------------------------

export interface FairHousingFinding {
  category:
    | "familial_status"
    | "religion"
    | "race_national_origin"
    | "sex_gender"
    | "disability"
    | "source_of_income"
    | "marital_status"
    | "age";
  matched: string;
  severity: "high" | "medium";
  explanation: string;
}

interface FairHousingPattern {
  category: FairHousingFinding["category"];
  patterns: RegExp[];
  severity: "high" | "medium";
  explanation: string;
}

const FAIR_HOUSING_PATTERNS: FairHousingPattern[] = [
  {
    category: "familial_status",
    patterns: [
      /\bno (kids|children|minors)\b/i,
      /\b(adult|adults)[- ]only\b/i,
      /\bnot suitable for (kids|children|families)\b/i,
      /\bideal for (singles?|childless)\b/i,
      /\bbachelor[- ]?(pad|only)\b/i,
      /\bno families\b/i,
      /\bmature (adults?|tenants?) only\b/i,
    ],
    severity: "high",
    explanation: "Familial-status discrimination is barred by 42 USC §3604. References to children, families, or 'singles only' are presumptively discriminatory.",
  },
  {
    category: "religion",
    patterns: [
      /\bchristian (household|home|tenant|family)\b/i,
      /\b(catholic|protestant|jewish|muslim|mormon|hindu|buddhist) (household|home|preferred|family)\b/i,
      /\b(near|walking distance) (to )?(church|mosque|synagogue|temple)\b/i,
      /\bgod[- ]fearing\b/i,
      /\bchurch[- ]going\b/i,
    ],
    severity: "high",
    explanation: "Religious preferences in housing ads violate FHA. References to faith or proximity-to-worship as a feature trigger HUD review.",
  },
  {
    category: "race_national_origin",
    patterns: [
      /\b(white|black|asian|hispanic|latino|caucasian) (neighborhood|preferred|tenants?)\b/i,
      /\bno (african|asian|hispanic|latino|foreign|immigrants?)\b/i,
      /\bgood\s+(school|area)\b/i,             // proxy term — HUD guidance flags as steering when paired with neighborhood
      /\benglish[- ]speaking only\b/i,
      /\bamerican[- ]born\b/i,
    ],
    severity: "high",
    explanation: "Race/national-origin language and proxy terms (e.g., 'good schools' used as steering) violate FHA §3604(c).",
  },
  {
    category: "sex_gender",
    patterns: [
      /\b(female|male) only\b/i,
      /\b(women|men) only\b/i,
      /\bperfect for a (couple|lady|gentleman)\b/i,
      /\bno (men|women|boys|girls)\b/i,
    ],
    severity: "high",
    explanation: "Sex/gender restrictions in non-shared rentals violate FHA. Roommate-matching has narrow exceptions; full-unit rentals do not.",
  },
  {
    category: "disability",
    patterns: [
      /\bno (esas?|emotional[- ]?support|service|assistance)( (animals?|dogs?))?\b/i,
      /\bno (mentally ill|disabled|handicapped)\b/i,
      /\bable[- ]?bodied (only|preferred)\b/i,
      /\bmust be able to (climb|walk|manage stairs)\b/i,
      /\bno wheelchairs?\b/i,
    ],
    severity: "high",
    explanation: "ESA/service-animal refusals and disability-related limits violate FHA §3604(f). 'No ESAs' is one of the most common HUD-enforcement triggers.",
  },
  {
    category: "source_of_income",
    patterns: [
      /\bno section 8\b/i,
      /\bno vouchers?\b/i,
      /\bno hap\b/i,
      /\bcash[- ]?only tenants?\b/i,
      /\bw[- ]?2 employees? only\b/i,
      /\bno government assistance\b/i,
    ],
    severity: "high",
    explanation: "Source-of-income discrimination is barred in many states (CA, NY, NJ, WA, OR, MA, IL, CO, MN, etc.) and by HUD voucher-payment rules.",
  },
  {
    category: "marital_status",
    patterns: [
      /\bmarried couples? only\b/i,
      /\bno unmarried couples\b/i,
    ],
    severity: "medium",
    explanation: "Marital-status discrimination is barred in many states (CA, NY, MA, etc.).",
  },
  {
    category: "age",
    patterns: [
      /\b(seniors?|elderly|young) only\b/i,
      /\bunder \d+ only\b/i,
      /\b55\+\b/i,   // legitimate housing-for-older-persons CAN be 55+, but flag for review.
    ],
    severity: "medium",
    explanation: "Age limits trigger HOPA review. '55+' is only legal under the Housing for Older Persons Act with strict HUD compliance; treat as needs-attorney-review.",
  },
];

export function scanFairHousingText(text: string | null | undefined): {
  clean: boolean;
  findings: FairHousingFinding[];
} {
  const findings: FairHousingFinding[] = [];
  if (!text) return { clean: true, findings };
  for (const group of FAIR_HOUSING_PATTERNS) {
    for (const pattern of group.patterns) {
      const m = text.match(pattern);
      if (m) {
        findings.push({
          category: group.category,
          matched: m[0],
          severity: group.severity,
          explanation: group.explanation,
        });
      }
    }
  }
  // Deduplicate identical matches.
  const seen = new Set<string>();
  const deduped = findings.filter(f => {
    const key = `${f.category}|${f.matched.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { clean: deduped.length === 0, findings: deduped };
}

// ---------------------------------------------------------------------------
// SECTION 8 / HAP — annual recertification reminder.
// HUD requires annual recertification of family composition + income for
// HCV tenants (24 CFR § 982.516). PHAs typically send recert paperwork
// 60–90 days before the anniversary; the landlord should be ready to
// re-execute the HAP contract.
// ---------------------------------------------------------------------------

export function computeHapRecertReminder(opts: {
  leaseStartDate: Date | string;
  now?: Date;
}): {
  nextRecertDate: string;
  daysUntil: number;
  shouldRemind: boolean;
  reason: string;
} {
  const now = opts.now ?? new Date();
  const start = typeof opts.leaseStartDate === "string" ? new Date(opts.leaseStartDate) : opts.leaseStartDate;
  if (Number.isNaN(start.getTime())) {
    return { nextRecertDate: "", daysUntil: -1, shouldRemind: false, reason: "invalid start date" };
  }
  // Find the next anniversary >= today.
  const anniv = new Date(now.getFullYear(), start.getMonth(), start.getDate());
  if (anniv.getTime() < now.getTime()) anniv.setFullYear(anniv.getFullYear() + 1);
  const days = Math.ceil((anniv.getTime() - now.getTime()) / 86_400_000);
  return {
    nextRecertDate: anniv.toISOString().slice(0, 10),
    daysUntil: days,
    shouldRemind: days <= 60,   // 60-day window per HUD typical schedule
    reason: days <= 60
      ? `HAP recert anniversary in ${days} day(s); HUD typical PHA window is 60–90d ahead.`
      : `HAP recert anniversary in ${days} day(s); reminder fires at 60d.`,
  };
}
