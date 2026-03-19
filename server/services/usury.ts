// State usury limits for seller-financed real property notes (simplified)
// Sources: state statutes as of 2024. Always verify with local counsel.
const STATE_USURY_LIMITS: Record<string, { maxRate: number; notes: string }> = {
  "AL": { maxRate: 8, notes: "Ala. Code § 8-8-1; 8% general limit" },
  "AK": { maxRate: 10.5, notes: "AS § 45.45.010" },
  "AZ": { maxRate: 10, notes: "A.R.S. § 44-1202" },
  "AR": { maxRate: 17, notes: "Ark. Code § 4-57-101" },
  "CA": { maxRate: 10, notes: "Cal. Const. Art. XV § 1; real property exemptions may apply" },
  "CO": { maxRate: 45, notes: "C.R.S. § 5-12-103; very permissive" },
  "CT": { maxRate: 12, notes: "Conn. Gen. Stat. § 37-4" },
  "DE": { maxRate: 5, notes: "Del. Code tit. 6 § 2301; written contracts may exceed" },
  "FL": { maxRate: 18, notes: "Fla. Stat. § 687.01; 25% criminal usury limit" },
  "GA": { maxRate: 16, notes: "O.C.G.A. § 7-4-2" },
  "HI": { maxRate: 10, notes: "Haw. Rev. Stat. § 478-2" },
  "ID": { maxRate: 12, notes: "Idaho Code § 28-22-104" },
  "IL": { maxRate: 9, notes: "815 ILCS 205/4" },
  "IN": { maxRate: 25, notes: "Ind. Code § 24-4.5; very permissive for real estate" },
  "IA": { maxRate: 24, notes: "Iowa Code § 535.2" },
  "KS": { maxRate: 15, notes: "K.S.A. § 16-201" },
  "KY": { maxRate: 19, notes: "KRS § 360.010" },
  "LA": { maxRate: 12, notes: "La. R.S. § 9:3500" },
  "ME": { maxRate: 18, notes: "Me. Rev. Stat. tit. 9-A § 2-401" },
  "MD": { maxRate: 6, notes: "Md. Code, Com. Law § 12-102; real property may be higher" },
  "MA": { maxRate: 20, notes: "Mass. Gen. Laws ch. 107 § 3" },
  "MI": { maxRate: 7, notes: "MCL § 438.31; written contracts: 25%" },
  "MN": { maxRate: 8, notes: "Minn. Stat. § 334.01" },
  "MS": { maxRate: 10, notes: "Miss. Code § 75-17-1" },
  "MO": { maxRate: 10, notes: "Mo. Rev. Stat. § 408.020" },
  "MT": { maxRate: 15, notes: "Mont. Code § 31-1-107" },
  "NE": { maxRate: 16, notes: "Neb. Rev. Stat. § 45-101.03" },
  "NV": { maxRate: 40, notes: "NRS § 99.050; very permissive" },
  "NH": { maxRate: 10, notes: "RSA § 336:1" },
  "NJ": { maxRate: 30, notes: "N.J.S.A. § 31:1-1; commercial real estate exempt" },
  "NM": { maxRate: 15, notes: "NMSA § 56-8-3" },
  "NY": { maxRate: 16, notes: "N.Y. Gen. Oblig. Law § 5-501; criminal usury: 25%" },
  "NC": { maxRate: 16, notes: "N.C.G.S. § 24-1" },
  "ND": { maxRate: 6, notes: "N.D.C.C. § 47-14-05; written contracts may be higher" },
  "OH": { maxRate: 8, notes: "ORC § 1343.01; written contracts: 25%" },
  "OK": { maxRate: 10, notes: "Okla. Stat. tit. 15 § 266" },
  "OR": { maxRate: 12, notes: "ORS § 82.010" },
  "PA": { maxRate: 6, notes: "41 Pa. Cons. Stat. § 201; commercial loans exempt" },
  "RI": { maxRate: 21, notes: "R.I. Gen. Laws § 6-26-2" },
  "SC": { maxRate: 8.75, notes: "S.C. Code § 34-31-20" },
  "SD": { maxRate: 0, notes: "No limit — SD removed usury cap" },
  "TN": { maxRate: 10, notes: "Tenn. Code § 47-14-103" },
  "TX": { maxRate: 18, notes: "Tex. Fin. Code § 302.001; real property max 18%" },
  "UT": { maxRate: 10, notes: "Utah Code § 15-1-1; written: no limit" },
  "VT": { maxRate: 12, notes: "9 V.S.A. § 41a" },
  "VA": { maxRate: 12, notes: "Va. Code § 6.2-302" },
  "WA": { maxRate: 12, notes: "RCW § 19.52.020" },
  "WV": { maxRate: 8, notes: "W. Va. Code § 47-6-5" },
  "WI": { maxRate: 12, notes: "Wis. Stat. § 138.05" },
  "WY": { maxRate: 10, notes: "Wyo. Stat. § 40-14-106" },
};

export interface UsuryClearance {
  state: string;
  proposedRate: number;
  maxAllowedRate: number;
  isCompliant: boolean;
  warningLevel: "ok" | "warning" | "violation";
  message: string;
  statuteNote: string;
  disclaimer: string;
}

export function checkUsury(state: string, annualInterestRate: number): UsuryClearance {
  const limit = STATE_USURY_LIMITS[state.toUpperCase()];
  const disclaimer = "This is an automated screening tool only. Always consult a licensed real estate attorney before finalizing note terms.";

  if (!limit) {
    return {
      state, proposedRate: annualInterestRate, maxAllowedRate: 0,
      isCompliant: true, warningLevel: "warning",
      message: `No usury data available for ${state}. Verify with local counsel.`,
      statuteNote: "Unknown", disclaimer,
    };
  }

  if (limit.maxRate === 0) {
    return {
      state, proposedRate: annualInterestRate, maxAllowedRate: 0,
      isCompliant: true, warningLevel: "ok",
      message: `${state} has no statutory usury cap.`,
      statuteNote: limit.notes, disclaimer,
    };
  }

  const isCompliant = annualInterestRate <= limit.maxRate;
  const buffer = limit.maxRate - annualInterestRate;

  return {
    state, proposedRate: annualInterestRate, maxAllowedRate: limit.maxRate,
    isCompliant,
    warningLevel: isCompliant ? (buffer < 2 ? "warning" : "ok") : "violation",
    message: isCompliant
      ? buffer < 2
        ? `Rate is within ${buffer.toFixed(1)}% of the ${state} usury limit (${limit.maxRate}%). Consider reducing.`
        : `Rate is compliant. Maximum allowed in ${state} is ${limit.maxRate}%.`
      : `USURY VIOLATION: ${annualInterestRate}% exceeds ${state}'s limit of ${limit.maxRate}%.`,
    statuteNote: limit.notes, disclaimer,
  };
}

// Check all existing notes in an org for usury compliance
export async function auditOrgUsury(orgId: number): Promise<{
  compliant: number;
  warnings: number;
  violations: number;
  results: Array<{ noteId: number; borrowerName: string | null; rate: number; clearance: UsuryClearance }>;
}> {
  const { db } = await import("../db");
  const { notes, properties } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");

  const orgNotes = await db.select().from(notes).where(eq(notes.organizationId, orgId));

  const results = orgNotes.map(note => {
    const rate = Number(note.interestRate || 0);
    const state = (note as any).propertyState || "TX"; // Try to get state from note; fallback TX
    const clearance = checkUsury(state, rate);
    return {
      noteId: note.id,
      borrowerName: (note as any).borrowerName || null,
      rate,
      clearance,
    };
  });

  return {
    compliant: results.filter(r => r.clearance.warningLevel === "ok").length,
    warnings: results.filter(r => r.clearance.warningLevel === "warning").length,
    violations: results.filter(r => r.clearance.warningLevel === "violation").length,
    results,
  };
}
