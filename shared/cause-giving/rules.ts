/**
 * Cause Giving — pure program rules (spec: files/cause-giving-spec-2026-11.md).
 *
 * This module is the testable heart of the program: DB-free, deterministic,
 * integer-cents only. The command layer (server/services/causeGiving.ts)
 * loads frozen rows, calls these functions, and persists what they return.
 *
 * Founder calls baked in (all DECIDED 2026-11-20):
 *   FC-CG-1 — the pool is 1% of quarterly Net Operating Profit on the
 *             Schedule C basis AS-IS: revenue − ordinary operating expenses,
 *             before the donation itself and before income taxes; a ≤ $0
 *             quarter pools $0 and publishes identically.
 *   FC-CG-2 — religious organizations are eligible for secular community
 *             programs only (enforced at vetting/ballot time, CG-3; the seed
 *             ballot below contains no religious entries).
 *   FC-CG-3 — the §8 ballot (13 charities, 6 categories) approved as drafted.
 *             The seed marks every charity `candidate` with agreement `none`:
 *             a cause reaches `ballot` only via a complete passing vetting
 *             record AND an executed agreement (spec §1.6).
 *
 * Money posture: the program's only money is AcreOS's own. No function here
 * (and no table in shared/schema/cause-giving.ts) stores, moves, or
 * references member funds.
 */

export const CAUSE_GIVING_FLAG_KEY = "cause_giving";

/** 1% of Net Operating Profit, expressed in basis points (spec §1.1). */
const POOL_BPS = 100;

/** Minimum disbursement per charity per quarter: $50 (spec §1.4). */
export const MIN_DISBURSEMENT_CENTS = 5000;

/**
 * Consecutive sub-threshold quarters after which a charity's accumulated
 * carryforward is redistributed instead of rolled again (spec §1.4).
 */
const SUB_THRESHOLD_REDISTRIBUTION_QUARTERS = 4;

/** The definition version stamped on quarters computed under this ruleset. */
export const PROFIT_DEFINITION_VERSION = "nop-schedule-c-v1";

// ── Status vocabularies (mirrored by SQL CHECKs in migration 0314) ─────────

const CAUSE_STATUSES = [
  "candidate",
  "vetted",
  "ballot",
  "suspended",
  "removed",
] as const;
export type CauseStatus = (typeof CAUSE_STATUSES)[number];

const CAUSE_AGREEMENT_STATES = ["none", "sent", "executed"] as const;
export type CauseAgreementState = (typeof CAUSE_AGREEMENT_STATES)[number];

const CAUSE_ADDED_VIA = ["seed", "nomination"] as const;
export type CauseAddedVia = (typeof CAUSE_ADDED_VIA)[number];

const VETTING_OUTCOMES = ["pass", "fail", "incomplete"] as const;
export type VettingOutcome = (typeof VETTING_OUTCOMES)[number];

const NOMINATION_STATUSES = ["pending", "approved", "declined"] as const;
export type NominationStatus = (typeof NOMINATION_STATUSES)[number];

const QUARTER_STATUSES = [
  "open",
  "snapshotted",
  "allocated",
  "disbursing",
  "reported",
] as const;
export type QuarterStatus = (typeof QUARTER_STATUSES)[number];

const ALLOCATION_DISPOSITIONS = [
  "disbursed",
  "rolled",
  "redistributed-out",
  "redistributed-in",
  "unpayable-held",
] as const;
export type AllocationDisposition = (typeof ALLOCATION_DISPOSITIONS)[number];

const DISBURSEMENT_METHODS = ["ach", "check", "dafy-grant"] as const;
export type DisbursementMethod = (typeof DISBURSEMENT_METHODS)[number];

const DISBURSEMENT_ACK_STATES = ["pending", "received"] as const;
export type DisbursementAckState = (typeof DISBURSEMENT_ACK_STATES)[number];

/**
 * The only grounds on which a cause may be removed in v1 (spec §1.6 —
 * objective triggers only; ad-hoc removal is designed out).
 */
export const CAUSE_REMOVAL_TRIGGER_CODES = [
  "loss_of_tax_exempt_status",
  "auto_revocation",
  "fraud_finding",
  "sanctions_listing",
] as const;
export type CauseRemovalTriggerCode =
  (typeof CAUSE_REMOVAL_TRIGGER_CODES)[number];

// ── Seed data (spec §8, approved as drafted — FC-CG-3) ─────────────────────

export interface CauseCategorySeed {
  key: string;
  displayName: string;
  sortOrder: number;
}

export const CAUSE_CATEGORY_SEED: readonly CauseCategorySeed[] = [
  { key: "housing_homelessness", displayName: "Housing & homelessness", sortOrder: 1 },
  { key: "disaster_relief", displayName: "Disaster relief", sortOrder: 2 },
  { key: "veterans_housing", displayName: "Veterans' housing", sortOrder: 3 },
  {
    key: "financial_literacy_first_home",
    displayName: "Financial literacy / first-home access",
    sortOrder: 4,
  },
  { key: "community_development", displayName: "Community development", sortOrder: 5 },
  { key: "environment", displayName: "Environment", sortOrder: 6 },
];

export interface CauseBallotSeed {
  legalName: string;
  /** Display name when it differs from the legal name (dba / short name). */
  displayName?: string;
  ein: string;
  categoryKey: string;
}

/**
 * The §8 ballot exactly as approved. Desk-verified 2026-11-20 (spec §8);
 * the vetting workflow re-verifies every entry in IRS TEOS before the cause
 * can reach `ballot`. National parent EINs only — grants go to that EIN or
 * nowhere (namesake-affiliate warning, spec §8).
 */
export const CAUSE_BALLOT_SEED: readonly CauseBallotSeed[] = [
  { legalName: "Habitat for Humanity International Inc", ein: "91-1914868", categoryKey: "housing_homelessness" },
  { legalName: "Rebuilding Together Inc", ein: "52-1585880", categoryKey: "housing_homelessness" },
  { legalName: "National Alliance to End Homelessness", ein: "52-1299641", categoryKey: "housing_homelessness" },
  { legalName: "Team Rubicon Inc", ein: "27-1720480", categoryKey: "disaster_relief" },
  { legalName: "Direct Relief", ein: "95-1831116", categoryKey: "disaster_relief" },
  { legalName: "Homes For Our Troops Inc", ein: "54-2143612", categoryKey: "veterans_housing" },
  { legalName: "Gary Sinise Foundation", ein: "80-0587086", categoryKey: "veterans_housing" },
  {
    legalName: "Neighborhood Reinvestment Corporation",
    displayName: "NeighborWorks America",
    ein: "52-1148078",
    categoryKey: "financial_literacy_first_home",
  },
  { legalName: "National Foundation for Credit Counseling Inc", ein: "53-0132493", categoryKey: "financial_literacy_first_home" },
  {
    legalName: "Local Initiatives Support Corporation",
    displayName: "LISC",
    ein: "13-3030229",
    categoryKey: "community_development",
  },
  { legalName: "Enterprise Community Partners Inc", ein: "52-1231931", categoryKey: "community_development" },
  { legalName: "The Nature Conservancy", ein: "53-0242652", categoryKey: "environment" },
  { legalName: "National Arbor Day Foundation", ein: "23-7169265", categoryKey: "environment" },
];

// ── Pool math (spec §1.2 / FC-CG-1) ────────────────────────────────────────

/**
 * The quarter's donation pool in cents: 1% of Net Operating Profit
 * (revenue − ordinary operating expenses, Schedule C basis as-is, before
 * the donation itself and before income taxes). NOP ≤ 0 → pool 0.
 * Integer math throughout; the 1% floors.
 */
export function computeQuarterPool(
  revenueCents: number,
  expenseCents: number,
): number {
  const nopCents = revenueCents - expenseCents;
  if (nopCents <= 0) return 0;
  return Math.floor((nopCents * POOL_BPS) / 10000);
}

// ── Tally (spec §1.3: one paying member = one vote) ────────────────────────

export interface SelectionForTally {
  causeId: number;
  /** True only when the member is paying at the snapshot moment. */
  isPayingMember: boolean;
}

export interface TallyRow {
  causeId: number;
  votes: number;
  /** Share of the total vote, 0..1 (exact division; formatting is a surface concern). */
  share: number;
}

export interface TallyResult {
  rows: TallyRow[];
  totalVotes: number;
}

/**
 * Freeze a snapshot tally from the selections held at the snapshot moment.
 * Only paying members count; a churned member contributes no vote. Sorted
 * deterministically: votes descending, then causeId ascending.
 */
export function tallySnapshot(
  selections: readonly SelectionForTally[],
): TallyResult {
  const votesByCause = new Map<number, number>();
  for (const s of selections) {
    if (!s.isPayingMember) continue;
    votesByCause.set(s.causeId, (votesByCause.get(s.causeId) ?? 0) + 1);
  }
  const totalVotes = [...votesByCause.values()].reduce((a, b) => a + b, 0);
  const rows: TallyRow[] = [...votesByCause.entries()]
    .map(([causeId, votes]) => ({
      causeId,
      votes,
      share: totalVotes > 0 ? votes / totalVotes : 0,
    }))
    .sort((a, b) => b.votes - a.votes || a.causeId - b.causeId);
  return { rows, totalVotes };
}

// ── Allocations (spec §1.4 + §1.5 + §2 invariants) ─────────────────────────

export interface AllocationInput {
  poolCents: number;
  /** Frozen tally rows for the quarter (from tallySnapshot / cause_quarter_snapshots). */
  snapshot: readonly TallyRow[];
  /** Cents rolled into this quarter per cause (prior quarters' carryforward-out). */
  carryforwardInByCause?: Readonly<Record<number, number>>;
  /**
   * Consecutive sub-threshold quarters per cause BEFORE this quarter. When
   * this quarter is also sub-threshold and the streak reaches
   * SUB_THRESHOLD_REDISTRIBUTION_QUARTERS, the accumulated balance is
   * redistributed (spec §1.4).
   */
  consecutiveSubThresholdQuartersByCause?: Readonly<Record<number, number>>;
  /** Causes payable this quarter (executed agreement, not unpayable per §1.5). */
  payableCauseIds: readonly number[];
  /**
   * Causes already held one quarter for unpayability: their balance is
   * redistributed at this quarter's allocation (spec §1.5 step 2).
   */
  unpayableHeldCauseIds?: readonly number[];
  /** Category key per cause — drives the same-category-first redistribution. */
  categoryByCause: Readonly<Record<number, string>>;
}

export interface AllocationRow {
  causeId: number;
  /** This cause's proportional share of the pool (residue-adjusted). */
  allocatedCents: number;
  carryforwardInCents: number;
  /** Amount to disburse this quarter (0 unless the row ends disbursed). */
  disbursableCents: number;
  /** Amount rolling to the next quarter as this cause's carryforward. */
  carryforwardOutCents: number;
  disposition: AllocationDisposition;
  redistributionFromCauseIds: number[];
  redistributionToCauseIds: number[];
}

/** Pro-rata integer split of `amount` across weights; residue to the largest weight (ties → lowest id). */
function splitProRata(
  amount: number,
  weights: ReadonlyMap<number, number>,
): Map<number, number> {
  const out = new Map<number, number>();
  const ids = [...weights.keys()].sort((a, b) => a - b);
  const total = ids.reduce((a, id) => a + (weights.get(id) ?? 0), 0);
  if (amount <= 0 || total <= 0) {
    for (const id of ids) out.set(id, 0);
    return out;
  }
  let assigned = 0;
  for (const id of ids) {
    const v = Math.floor((amount * (weights.get(id) ?? 0)) / total);
    out.set(id, v);
    assigned += v;
  }
  const residue = amount - assigned;
  if (residue > 0) {
    let largest = ids[0];
    for (const id of ids) {
      if ((weights.get(id) ?? 0) > (weights.get(largest) ?? 0)) largest = id;
    }
    out.set(largest, (out.get(largest) ?? 0) + residue);
  }
  return out;
}

/**
 * Compute a quarter's allocations from the frozen snapshot. Pure and
 * re-runnable: identical inputs produce identical outputs (spec §2).
 *
 * Order of operations:
 *   1. Proportional split of the pool by frozen votes; rounding residue to
 *      the largest-share cause (§2 invariant).
 *   2. Redistribution sources leave first: (a) a cause sub-threshold for the
 *      4th consecutive quarter (§1.4), (b) a cause held one quarter for
 *      unpayability (§1.5 step 2). A source's full balance (allocation +
 *      carryforward-in) moves pro-rata to above-threshold PAYABLE causes —
 *      same category first, else across all (§1.4/§1.5). With no eligible
 *      target the balance stays rolled, never vanishes.
 *   3. A cause unpayable for the first quarter is `unpayable-held`: its
 *      balance rolls exactly one quarter (§1.5 step 1).
 *   4. Remaining payable causes disburse when their final balance reaches
 *      the $50 minimum; below it they roll (§1.4).
 *
 * Invariant: Σ disbursable + Σ carryforwardOut = pool + Σ carryforwardIn.
 */
export function computeAllocations(input: AllocationInput): AllocationRow[] {
  // A positive pool with zero frozen votes has no lawful distribution: the
  // tally is the only allocation basis (§1.3), and inventing a per-cause
  // home for an undistributed pool would break the sum invariant silently.
  // Fail closed — the command layer surfaces this as a founder-visible
  // anomaly rather than an allocation.
  const totalVotes = input.snapshot.reduce((a, r) => a + r.votes, 0);
  if (input.poolCents > 0 && totalVotes <= 0) {
    throw new RangeError(
      "computeAllocations: pool is positive but the frozen snapshot has no votes",
    );
  }
  const carryIn = (id: number) => input.carryforwardInByCause?.[id] ?? 0;
  const payable = new Set(input.payableCauseIds);
  const held = new Set(input.unpayableHeldCauseIds ?? []);

  const causeIds = new Set<number>();
  for (const r of input.snapshot) causeIds.add(r.causeId);
  for (const k of Object.keys(input.carryforwardInByCause ?? {})) {
    const id = Number(k);
    if ((input.carryforwardInByCause?.[id] ?? 0) > 0) causeIds.add(id);
  }
  for (const id of held) causeIds.add(id);
  const ids = [...causeIds].sort((a, b) => a - b);

  // 1. Proportional split of the pool.
  const voteWeights = new Map<number, number>();
  for (const r of input.snapshot) voteWeights.set(r.causeId, r.votes);
  const allocated = splitProRata(input.poolCents, voteWeights);
  const gross = new Map<number, number>(
    ids.map((id) => [id, (allocated.get(id) ?? 0) + carryIn(id)]),
  );

  // 2. Redistribution sources.
  const isSource = (id: number): boolean => {
    if (held.has(id) && (gross.get(id) ?? 0) > 0) return true;
    const streak =
      (input.consecutiveSubThresholdQuartersByCause?.[id] ?? 0) + 1;
    return (
      (gross.get(id) ?? 0) > 0 &&
      (gross.get(id) ?? 0) < MIN_DISBURSEMENT_CENTS &&
      streak >= SUB_THRESHOLD_REDISTRIBUTION_QUARTERS
    );
  };
  const sources = ids.filter(isSource);
  const sourceSet = new Set(sources);

  // Eligible targets: payable, not a source, at/above threshold on gross.
  const eligibleTargets = ids.filter(
    (id) =>
      payable.has(id) &&
      !sourceSet.has(id) &&
      (gross.get(id) ?? 0) >= MIN_DISBURSEMENT_CENTS,
  );

  const redistributedIn = new Map<number, number>(ids.map((id) => [id, 0]));
  const fromMap = new Map<number, number[]>(ids.map((id) => [id, []]));
  const toMap = new Map<number, number[]>(ids.map((id) => [id, []]));
  const sourceMoved = new Map<number, number>(ids.map((id) => [id, 0]));

  for (const src of sources) {
    const amount = gross.get(src) ?? 0;
    if (amount <= 0) continue;
    const sameCategory = eligibleTargets.filter(
      (id) => input.categoryByCause[id] === input.categoryByCause[src],
    );
    const targets = sameCategory.length > 0 ? sameCategory : eligibleTargets;
    if (targets.length === 0) continue; // no eligible target — balance stays rolled
    const weights = new Map(targets.map((id) => [id, gross.get(id) ?? 0]));
    const split = splitProRata(amount, weights);
    let moved = 0;
    for (const [targetId, cents] of split) {
      if (cents <= 0) continue;
      redistributedIn.set(targetId, (redistributedIn.get(targetId) ?? 0) + cents);
      fromMap.get(targetId)!.push(src);
      moved += cents;
    }
    if (moved > 0) {
      sourceMoved.set(src, moved);
      toMap.set(
        src,
        [...split.entries()].filter(([, c]) => c > 0).map(([id]) => id),
      );
    }
  }

  // 3 + 4. Final dispositions.
  const rows: AllocationRow[] = ids.map((id) => {
    const allocatedCents = allocated.get(id) ?? 0;
    const carryforwardInCents = carryIn(id);
    const base: AllocationRow = {
      causeId: id,
      allocatedCents,
      carryforwardInCents,
      disbursableCents: 0,
      carryforwardOutCents: 0,
      disposition: "rolled",
      redistributionFromCauseIds: [...(fromMap.get(id) ?? [])].sort((a, b) => a - b),
      redistributionToCauseIds: [...(toMap.get(id) ?? [])].sort((a, b) => a - b),
    };
    const moved = sourceMoved.get(id) ?? 0;
    if (moved > 0) {
      // Source: its full balance left (moved == gross by construction).
      base.disposition = "redistributed-out";
      base.carryforwardOutCents = (gross.get(id) ?? 0) - moved;
      return base;
    }
    const finalCents = (gross.get(id) ?? 0) + (redistributedIn.get(id) ?? 0);
    if (!payable.has(id)) {
      // §1.5 step 1: unpayable rolls exactly one quarter as unpayable-held.
      base.disposition = "unpayable-held";
      base.carryforwardOutCents = finalCents;
      return base;
    }
    if (finalCents >= MIN_DISBURSEMENT_CENTS) {
      base.disposition =
        (redistributedIn.get(id) ?? 0) > 0 ? "redistributed-in" : "disbursed";
      base.disbursableCents = finalCents;
      base.carryforwardOutCents = 0;
      return base;
    }
    base.disposition = "rolled";
    base.carryforwardOutCents = finalCents;
    return base;
  });
  return rows;
}
