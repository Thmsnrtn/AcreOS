/**
 * Giving — $1 per paying member per month (founder decision 2026-10-09).
 *
 * AcreOS's OWN money, from its own revenue, to a food bank serving each
 * member's area. Three rules this file holds, each mutation-tested in
 * tests/unit/givingPolicy.test.ts:
 *
 *   1. COUNT, NEVER INVENT. The pledge is $1 × paying members counted from the
 *      billing tables, grouped by the county the member gave. A member with no
 *      county is counted and reported, never assigned one. A county with no
 *      food bank the founder entered is reported, never pledged.
 *   2. NOTHING MOVES AUTOMATICALLY. A pledge is a proposal on the founder's
 *      Decisions door. Approval needs the founder, a founder-set monthly cap
 *      (unset ⇒ nothing can be approved), and an amount within it; anything
 *      over $500 is founder-only regardless of who asks (a hard stop).
 *   3. ONLY RECEIPTS ARE "GIVEN". A member sees a total only when the founder
 *      recorded a receipt for money paid outside AcreOS. Pledged and approved
 *      amounts are never shown to a member as given.
 *
 * Browser-safe and pure.
 */

export const CENTS_PER_MEMBER_PER_MONTH = 100;
/** Hard stop: spends over $500 are founder-only forever (CLAUDE.md DO-NOT-DO). */
const GIVING_FOUNDER_ONLY_ABOVE_CENTS = 50_000;

export function normalizeGivingCounty(county: string): string {
  return county
    .trim()
    .replace(/\s+(county|parish|borough)$/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface PayingMember {
  organizationId: number;
  area: { state: string; county: string } | null;
}

export interface FoodBankMapping {
  id: number;
  state: string;
  county: string;
  name: string;
}

export interface PledgeLine {
  state: string;
  county: string;
  members: number;
  cents: number;
  foodBankId: number | null;
  foodBankName: string | null;
}

export interface PledgeComputation {
  payingMembers: number;
  membersWithoutCounty: number;
  lines: PledgeLine[];
  /** Only lines with a mapped food bank. Unmapped counties pledge nothing. */
  pledgeCents: number;
  /** Members in counties the founder has not mapped yet. */
  unmappedMembers: number;
}

export function computeGivingPledge(members: PayingMember[], foodBanks: FoodBankMapping[]): PledgeComputation {
  const bank = new Map(foodBanks.map((f) => [`${f.state.toUpperCase()}|${normalizeGivingCounty(f.county)}`, f]));
  const byCounty = new Map<string, { state: string; county: string; members: number }>();
  let membersWithoutCounty = 0;
  for (const m of members) {
    if (!m.area || !m.area.state?.trim() || !m.area.county?.trim()) {
      membersWithoutCounty += 1;
      continue;
    }
    const state = m.area.state.trim().toUpperCase();
    const county = normalizeGivingCounty(m.area.county);
    const key = `${state}|${county}`;
    const cur = byCounty.get(key) ?? { state, county, members: 0 };
    cur.members += 1;
    byCounty.set(key, cur);
  }
  const lines: PledgeLine[] = Array.from(byCounty.entries())
    .map(([key, c]) => {
      const fb = bank.get(key) ?? null;
      return {
        state: c.state,
        county: c.county,
        members: c.members,
        cents: fb ? c.members * CENTS_PER_MEMBER_PER_MONTH : 0,
        foodBankId: fb?.id ?? null,
        foodBankName: fb?.name ?? null,
      };
    })
    .sort((a, b) => b.members - a.members || a.state.localeCompare(b.state) || a.county.localeCompare(b.county));
  return {
    payingMembers: members.length,
    membersWithoutCounty,
    lines,
    pledgeCents: lines.reduce((s, l) => s + l.cents, 0),
    unmappedMembers: lines.filter((l) => l.foodBankId == null).reduce((s, l) => s + l.members, 0),
  };
}

export type GivingApprovalVerdict = { ok: true } | { ok: false; reason: string };

/**
 * May this approval go ahead? Every branch refuses unless the founder, with a
 * cap set, approves a whole-cent amount within both the cap and the pledge.
 */
export function evaluateGivingApproval(input: {
  amountCents: number;
  pledgeCents: number;
  capCents: number | null;
  approverIsFounder: boolean;
  monthStatus: "awaiting_founder" | "approved" | "declined";
}): GivingApprovalVerdict {
  if (input.monthStatus !== "awaiting_founder") return { ok: false, reason: "This month has already been decided." };
  if (!input.approverIsFounder) {
    return {
      ok: false,
      reason:
        input.amountCents > GIVING_FOUNDER_ONLY_ABOVE_CENTS
          ? "Over $500: a founder-only hard stop."
          : "Giving is approved by the founder only.",
    };
  }
  if (input.capCents == null) return { ok: false, reason: "Set a monthly giving cap first. Nothing can be approved without one." };
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return { ok: false, reason: "Approve a whole-cent amount above zero." };
  if (input.amountCents > input.pledgeCents) return { ok: false, reason: "The approval cannot exceed the computed pledge." };
  if (input.amountCents > input.capCents) {
    return { ok: false, reason: `Over your monthly cap of $${(input.capCents / 100).toFixed(2)}. Lower the amount or raise the cap.` };
  }
  return { ok: true };
}

/**
 * A receipt may be recorded only against an approved month, and the month's
 * receipted total may not exceed what was approved (the cap stays meaningful).
 */
export function evaluateGivingReceipt(input: {
  amountCents: number;
  monthStatus: "awaiting_founder" | "approved" | "declined";
  approvedCents: number | null;
  alreadyReceiptedCents: number;
  reference: string;
}): GivingApprovalVerdict {
  if (input.monthStatus !== "approved" || input.approvedCents == null) return { ok: false, reason: "Record receipts only for an approved month." };
  if (!input.reference.trim()) return { ok: false, reason: "A receipt needs its reference (confirmation number or link)." };
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return { ok: false, reason: "Enter the amount paid, in whole cents above zero." };
  if (input.alreadyReceiptedCents + input.amountCents > input.approvedCents) {
    return { ok: false, reason: "Receipts for this month would exceed the approved amount." };
  }
  return { ok: true };
}

export interface MemberGivingPanel {
  /** "nothing_yet" also covers a member with no county or no mapped food bank. */
  state: "given" | "nothing_yet";
  foodBankName: string | null;
  givenCents: number;
  asOf: string | null;
  receiptReference: string | null;
  receiptUrl: string | null;
}

/**
 * The member's panel, from RECEIPTS ONLY. The function's input type has no
 * pledge or approval field, so a pledged number cannot reach it.
 */
export function memberGivingPanel(
  foodBank: { name: string } | null,
  receipts: Array<{ amountCents: number; paidOn: string; reference: string; receiptUrl: string | null }>,
): MemberGivingPanel {
  if (!foodBank || receipts.length === 0) {
    return { state: "nothing_yet", foodBankName: foodBank?.name ?? null, givenCents: 0, asOf: null, receiptReference: null, receiptUrl: null };
  }
  const latest = [...receipts].sort((a, b) => b.paidOn.localeCompare(a.paidOn))[0];
  return {
    state: "given",
    foodBankName: foodBank.name,
    givenCents: receipts.reduce((s, r) => s + r.amountCents, 0),
    asOf: latest.paidOn,
    receiptReference: latest.reference,
    receiptUrl: latest.receiptUrl,
  };
}

/** The month a run on `now` counts: the previous calendar month, "YYYY-MM". */
export function givingMonthFor(now: Date): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based current month = previous month 1-based
  return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, "0")}`;
}
