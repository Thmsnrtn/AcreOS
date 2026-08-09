// ============================================================================
// SHARED/RENTAL/LOTRENTSPLIT.TS — the lot-vs-home rent split, computed honestly.
// ----------------------------------------------------------------------------
// Pure and browser-safe: no DB, no `process`, no imports. A mobile-home park's
// rent is not one number. A tenant who OWNS their home (TOH — tenant-owned-home)
// rents only the GROUND under it (lot rent). When the PARK owns the home (POH —
// park-owned-home) the operator collects lot rent AND a separate home rent. This
// is the ONE place that split is decomposed and the park's POH/TOH mix is taken,
// so the rules that keep it honest live once here:
//
//   1. The split is DECOMPOSED from operator-supplied components, never INFERRED.
//      A POH lease needs BOTH its lot-rent and home-rent components recorded to
//      state a split; a lease that only records a lump sum has no split to show,
//      so the engine REFUSES that lease (refusedReason + null total) rather than
//      guess which portion is ground and which is home. A fabricated split is
//      exactly the kind of number this program exists to refuse.
//   2. The POH/TOH mix is a COUNT of what is recorded, not an estimate. A lease
//      whose ownership (POH/TOH) is not recorded is UNCLASSIFIED — it cannot be
//      placed in the mix and is reported as such, never bucketed by a guess.
//   3. The conversion-trade delta — the extra monthly rent a park-owned home
//      captures over a bare lot — is a comparison of two RECORDED cohorts
//      (average POH total rent − average TOH lot rent). When either cohort is
//      empty it is null (unavailable), never a zero that looks computed, and it
//      is NEVER a submarket lot-rent comp: the only inputs are the operator's
//      own recorded rents.
// ============================================================================

export type HomeOwnership = "park_owned" | "tenant_owned";

/** One lease's operator-supplied rent components + its POH/TOH flag. */
export interface LotRentLeaseInput {
  /** Stable identifier echoed into the per-lease result (a unit or lease id). */
  ref: string;
  /** 'park_owned' (POH) | 'tenant_owned' (TOH) | null when not recorded. */
  homeOwnership: HomeOwnership | null;
  /** The ground rent, in cents — what the tenant pays for the pad. */
  lotRentCents: number | null;
  /** The home rent, in cents — the POH-only component the operator collects for the home itself. */
  homeRentCents: number | null;
}

/** The decomposed split for one lease, or a refusal when it is not recorded. */
export interface LeaseLotRentSplit {
  ref: string;
  homeOwnership: HomeOwnership | null;
  lotRentCents: number | null;
  /** null for a TOH lease (the tenant owns the home — the operator collects no home rent). */
  homeRentCents: number | null;
  /** lot + home when the split is recorded; null when refused. */
  totalRentCents: number | null;
  /** Non-null when this lease's split could not be stated — surface it, invent nothing. */
  refusedReason: string | null;
}

export interface LotRentSplitResult {
  /** The per-lease decomposition, one entry per input lease (refusals included). */
  leases: LeaseLotRentSplit[];
  /** Recorded park-owned-home leases (both components present). */
  pohCount: number;
  /** Recorded tenant-owned-home leases (lot rent present). */
  tohCount: number;
  /** Leases with no recorded ownership, or missing a component a POH split needs. */
  unclassifiedCount: number;
  /** Sum of lot rent across recorded POH leases, in cents. */
  pohLotRentTotalCents: number;
  /** Sum of home rent across recorded POH leases, in cents. */
  pohHomeRentTotalCents: number;
  /** Sum of lot rent across recorded TOH leases, in cents. */
  tohLotRentTotalCents: number;
  /** Sum of every recorded lease's total rent, in cents. */
  parkTotalRentCents: number;
  /** Average total rent of a recorded POH lease; null when there are none. */
  avgPohTotalRentCents: number | null;
  /** Average lot rent of a recorded TOH lease; null when there are none. */
  avgTohLotRentCents: number | null;
  /**
   * The extra monthly rent a park-owned home captures over a bare lot:
   * avgPohTotalRent − avgTohLotRent. Null (unavailable) when either cohort is
   * empty — never a computed-looking zero, and never a submarket comp.
   */
  conversionTradeDeltaCents: number | null;
  /** POH share of the CLASSIFIED leases (POH + TOH), in basis points; null when none are classified. */
  pohMixBps: number | null;
}

/**
 * Decompose a set of mobile-home leases into their lot-vs-home split and take
 * the park's POH/TOH mix.
 *
 * Every figure is a sum or average of RECORDED operator-supplied components; a
 * lease whose split is not recorded refuses rather than contribute a guessed
 * decomposition, and the mix counts only leases whose ownership is recorded.
 */
export function computeLotRentSplit(leasesInput: LotRentLeaseInput[]): LotRentSplitResult {
  const leases: LeaseLotRentSplit[] = [];

  let pohCount = 0;
  let tohCount = 0;
  let unclassifiedCount = 0;
  let pohLotRentTotalCents = 0;
  let pohHomeRentTotalCents = 0;
  let tohLotRentTotalCents = 0;

  for (const l of leasesInput) {
    // Ownership must be recorded — without it we cannot say whether a missing
    // home rent means "the tenant owns the home" or "it wasn't recorded".
    if (l.homeOwnership == null) {
      unclassifiedCount++;
      leases.push({
        ref: l.ref,
        homeOwnership: null,
        lotRentCents: l.lotRentCents,
        homeRentCents: l.homeRentCents,
        totalRentCents: null,
        refusedReason:
          "Home ownership (park-owned vs tenant-owned) is not recorded for this lot, so it cannot be " +
          "placed in the POH/TOH mix or split. Refusing to infer ownership.",
      });
      continue;
    }

    if (l.homeOwnership === "tenant_owned") {
      // A tenant-owned home: the operator collects ONLY lot rent. The home rent
      // is the tenant's, not a number to invent.
      if (l.lotRentCents == null) {
        unclassifiedCount++;
        leases.push({
          ref: l.ref,
          homeOwnership: "tenant_owned",
          lotRentCents: null,
          homeRentCents: null,
          totalRentCents: null,
          refusedReason:
            "No lot rent recorded for this tenant-owned-home lot. Refusing to state a split without it.",
        });
        continue;
      }
      tohCount++;
      tohLotRentTotalCents += l.lotRentCents;
      leases.push({
        ref: l.ref,
        homeOwnership: "tenant_owned",
        lotRentCents: l.lotRentCents,
        homeRentCents: null,
        totalRentCents: l.lotRentCents,
        refusedReason: null,
      });
      continue;
    }

    // park_owned — the split needs BOTH components. Never infer the home portion.
    if (l.lotRentCents == null || l.homeRentCents == null) {
      unclassifiedCount++;
      leases.push({
        ref: l.ref,
        homeOwnership: "park_owned",
        lotRentCents: l.lotRentCents,
        homeRentCents: l.homeRentCents,
        totalRentCents: null,
        refusedReason:
          "A park-owned-home lease needs BOTH its lot-rent and home-rent components recorded to state a " +
          "split. Refusing to infer the lot-vs-home decomposition from a single figure.",
      });
      continue;
    }
    pohCount++;
    pohLotRentTotalCents += l.lotRentCents;
    pohHomeRentTotalCents += l.homeRentCents;
    leases.push({
      ref: l.ref,
      homeOwnership: "park_owned",
      lotRentCents: l.lotRentCents,
      homeRentCents: l.homeRentCents,
      totalRentCents: l.lotRentCents + l.homeRentCents,
      refusedReason: null,
    });
  }

  const pohTotalRentCents = pohLotRentTotalCents + pohHomeRentTotalCents;
  const parkTotalRentCents = pohTotalRentCents + tohLotRentTotalCents;

  const avgPohTotalRentCents = pohCount > 0 ? Math.round(pohTotalRentCents / pohCount) : null;
  const avgTohLotRentCents = tohCount > 0 ? Math.round(tohLotRentTotalCents / tohCount) : null;

  const conversionTradeDeltaCents =
    avgPohTotalRentCents != null && avgTohLotRentCents != null
      ? avgPohTotalRentCents - avgTohLotRentCents
      : null;

  const classified = pohCount + tohCount;
  const pohMixBps = classified > 0 ? Math.round((pohCount / classified) * 10000) : null;

  return {
    leases,
    pohCount,
    tohCount,
    unclassifiedCount,
    pohLotRentTotalCents,
    pohHomeRentTotalCents,
    tohLotRentTotalCents,
    parkTotalRentCents,
    avgPohTotalRentCents,
    avgTohLotRentCents,
    conversionTradeDeltaCents,
    pohMixBps,
  };
}
