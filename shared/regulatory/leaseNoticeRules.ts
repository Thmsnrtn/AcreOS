/**
 * State non-renewal notice windows for residential leases.
 *
 * Imelda Lens 21 (Mobile Landlord Today tab): the "leases expiring <60d"
 * row has to surface the state-specific notice window — "Send 60-day
 * notice NOW" reads very different from "60-day notice (TX)". Without
 * the state rule, a landlord on the truck can blow the window and end
 * up holding over the lease for another full term.
 *
 * Sources are state statutes; this registry is intentionally narrow
 * (operator-side, not tenant rights) and will need attorney review per
 * state before being relied on in a courtroom — same posture as the
 * late-fee rules registry in routes-rent-ledger.ts.
 *
 * Each entry is the notice the LANDLORD must give to NOT renew a
 * fixed-term lease (or to terminate a month-to-month). When the lease
 * is fixed-term, the notice window opens at `endDate - noticeDays`.
 *
 * Default for unknown states is null — the UI surfaces "rule for $STATE
 * not in registry" rather than guessing.
 */

export interface LeaseNoticeRule {
  state: string;  // 2-letter
  noticeDays: number;  // landlord-side non-renewal notice
  citation?: string;
}

// Conservative — see citations. Where the statute differs for fixed-term
// vs MTM, this picks the fixed-term rule because that's the case the
// Today tab is highlighting (lease.endDate within 60 days).
const RULES: Record<string, LeaseNoticeRule> = {
  TX: { state: "TX", noticeDays: 30, citation: "Tex. Prop. Code §91.001" },
  CA: { state: "CA", noticeDays: 60, citation: "Cal. Civ. Code §1946.1" },
  NY: { state: "NY", noticeDays: 30, citation: "NY RPL §226-c (tenancy <1yr)" },
  FL: { state: "FL", noticeDays: 15, citation: "Fla. Stat. §83.57" },
  GA: { state: "GA", noticeDays: 60, citation: "O.C.G.A. §44-7-7" },
  IL: { state: "IL", noticeDays: 30, citation: "735 ILCS 5/9-207" },
  PA: { state: "PA", noticeDays: 15, citation: "68 P.S. §250.501" },
  OH: { state: "OH", noticeDays: 30, citation: "Ohio Rev. Code §5321.17" },
  MI: { state: "MI", noticeDays: 30, citation: "MCL §554.134" },
  NC: { state: "NC", noticeDays: 30, citation: "N.C.G.S. §42-14" },
  AZ: { state: "AZ", noticeDays: 30, citation: "A.R.S. §33-1375" },
  WA: { state: "WA", noticeDays: 60, citation: "RCW 59.18.220" },
  CO: { state: "CO", noticeDays: 28, citation: "C.R.S. §13-40-107" },
  MA: { state: "MA", noticeDays: 30, citation: "Mass. Gen. Laws c.186 §12" },
  VA: { state: "VA", noticeDays: 60, citation: "Va. Code §55.1-1253" },
  NJ: { state: "NJ", noticeDays: 60, citation: "N.J.S.A. §2A:18-56" },
  TN: { state: "TN", noticeDays: 30, citation: "T.C.A. §66-28-512" },
  IN: { state: "IN", noticeDays: 30, citation: "Ind. Code §32-31-1-1" },
  MO: { state: "MO", noticeDays: 30, citation: "Mo. Rev. Stat. §441.060" },
  SC: { state: "SC", noticeDays: 30, citation: "S.C. Code §27-40-770" },
  AL: { state: "AL", noticeDays: 30, citation: "Ala. Code §35-9A-441" },
  KY: { state: "KY", noticeDays: 30, citation: "KRS §383.695" },
  OR: { state: "OR", noticeDays: 90, citation: "ORS §90.427 (12-month+)" },
};

/** Returns the notice rule for a state (2-letter, any case). Null if unknown. */
export function getLeaseNoticeRule(state: string | null | undefined): LeaseNoticeRule | null {
  if (!state) return null;
  const key = state.toUpperCase().trim();
  return RULES[key] ?? null;
}

/**
 * Given a lease end date + state, return:
 *   - noticeDays: the rule (null if unknown)
 *   - noticeWindowOpensAt: the date the operator must send notice by
 *   - noticeWindowOpen: true if today is in the "send notice now" window
 */
export function computeNoticeWindow(
  endDateIso: string | null,
  state: string | null,
  now: Date = new Date(),
): {
  noticeDays: number | null;
  noticeWindowOpensAt: string | null;
  noticeWindowOpen: boolean;
} {
  const rule = getLeaseNoticeRule(state);
  if (!rule || !endDateIso) {
    return { noticeDays: null, noticeWindowOpensAt: null, noticeWindowOpen: false };
  }
  const end = new Date(endDateIso);
  if (!Number.isFinite(end.getTime())) {
    return { noticeDays: rule.noticeDays, noticeWindowOpensAt: null, noticeWindowOpen: false };
  }
  const opensAt = new Date(end);
  opensAt.setDate(opensAt.getDate() - rule.noticeDays);
  return {
    noticeDays: rule.noticeDays,
    noticeWindowOpensAt: opensAt.toISOString().slice(0, 10),
    noticeWindowOpen: now >= opensAt && now <= end,
  };
}
