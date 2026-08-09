// ============================================================================
// SHARED/RENTAL/UTILITYBILLBACK.TS — utility pass-through billback, honestly.
// ----------------------------------------------------------------------------
// Pure and browser-safe: no DB, no `process`, no imports. A mobile-home park
// buys a master utility (water, sewer, trash, electric, gas) and passes the cost
// back to the pads. There are exactly two lawful ways to do that, and this is
// the ONE place either is computed, so the rules that keep a passed-through
// utility charge honest live once here:
//
//   SUBMETER — each pad has its own meter. The pad's usage is (currentRead −
//     priorRead), billed at the operator's rate. A missing read cannot be
//     invented and a meter that reads LOWER than before (a rollback, a swapped
//     meter) is not consumption — either case REFUSES that pad (its bill is not
//     computable) and the statement discloses it (coverageComplete = false),
//     rather than bill a fabricated usage.
//
//   RUBS (Ratio Utility Billing System) — no submeters; the master bill is
//     ALLOCATED across pads by a recorded basis (equal shares / occupants /
//     square feet). Two invariants make a RUBS allocation defensible: it needs a
//     master bill AND a basis (neither is inferred — REFUSE without them), and
//     the allocations CONSERVE — they sum EXACTLY to the master bill, with a
//     deterministic rounding remainder absorbed by the last allocated pad so not
//     a cent is invented or lost. A pad missing its basis input (no occupant
//     count, no measured sqft) is DISCLOSED (coverageComplete = false), never
//     assigned a guessed share.
//
// MONEY POSTURE (founder ruling "be the rail, not the provider"): this computes
// a PROPOSED per-pad charge. It moves no money and posts no charge — the caller
// freezes the statement and the operator bills on their own rails, elsewhere.
// ============================================================================

export type UtilityKind = "water" | "sewer" | "trash" | "electric" | "gas";
export type BillbackMethod = "submeter" | "rubs";
export type RubsBasis = "equal" | "occupants" | "sqft";

/** A pad's meter pair for a submeter billback. */
export interface SubmeterPadInput {
  unitId: string;
  /** Reading at the start of the period; null when not recorded. */
  priorReading: number | null;
  /** Reading at the end of the period; null when not recorded. */
  currentReading: number | null;
}

export interface SubmeterBillbackArgs {
  method: "submeter";
  /** Cents charged per unit of consumption (the operator's rate). */
  ratePerUnitCents: number | null;
  pads: SubmeterPadInput[];
}

/** A pad's basis weight for a RUBS allocation. */
export interface RubsPadInput {
  unitId: string;
  /**
   * The basis weight: occupant count ('occupants') or square feet ('sqft'). For
   * 'equal' it is ignored. Null means the input is not recorded for this pad —
   * the pad is disclosed as uncovered, never assigned a guessed share.
   */
  basisValue: number | null;
}

export interface RubsBillbackArgs {
  method: "rubs";
  /** The master utility bill to allocate, in cents; null refuses the whole allocation. */
  masterBillCents: number | null;
  /** How the master bill is split; null refuses the whole allocation. */
  basis: RubsBasis | null;
  pads: RubsPadInput[];
}

export type UtilityBillbackArgs = SubmeterBillbackArgs | RubsBillbackArgs;

/** The proposed charge line for one pad. */
export interface PadBillbackLine {
  unitId: string;
  /** The pad's proposed charge, in cents; null when the pad was refused. */
  allocatedCents: number | null;
  /**
   * The measurable behind the line: submeter consumption (currentRead −
   * priorRead), or the RUBS basis weight used. Null when refused/not applicable.
   */
  basisAmount: number | null;
  /** Non-null when this pad could not be billed — surface it, invent nothing. */
  refusedReason: string | null;
}

export interface UtilityBillbackResult {
  method: BillbackMethod;
  basis: RubsBasis | null;
  perPad: PadBillbackLine[];
  /** Sum of the per-pad allocations actually proposed, in cents. */
  allocatedCents: number;
  /** The master bill, echoed for the frozen record (null for submeter). */
  masterBillCents: number | null;
  /** True only when every pad was billable (no pad refused). */
  coverageComplete: boolean;
  /** Non-null when the WHOLE computation refused (bad rate / no master bill / no basis / no pads). */
  refusedReason: string | null;
}

function refuseWhole(
  method: BillbackMethod,
  basis: RubsBasis | null,
  masterBillCents: number | null,
  reason: string,
): UtilityBillbackResult {
  return {
    method,
    basis,
    perPad: [],
    allocatedCents: 0,
    masterBillCents,
    coverageComplete: false,
    refusedReason: reason,
  };
}

/** SUBMETER: perPad = (current − prior) × rate; refuse missing/non-monotonic pairs. */
function computeSubmeter(args: SubmeterBillbackArgs): UtilityBillbackResult {
  if (args.ratePerUnitCents == null || !Number.isFinite(args.ratePerUnitCents) || args.ratePerUnitCents < 0) {
    return refuseWhole("submeter", null, null, "A submeter billback needs a non-negative per-unit rate.");
  }
  if (args.pads.length === 0) {
    return refuseWhole("submeter", null, null, "No pads supplied to bill.");
  }

  const perPad: PadBillbackLine[] = [];
  let allocatedCents = 0;
  let coverageComplete = true;

  for (const pad of args.pads) {
    if (pad.priorReading == null || pad.currentReading == null) {
      coverageComplete = false;
      perPad.push({
        unitId: pad.unitId,
        allocatedCents: null,
        basisAmount: null,
        refusedReason:
          "Missing a meter read (prior and/or current) for this pad. Refusing to bill fabricated usage.",
      });
      continue;
    }
    if (pad.currentReading < pad.priorReading) {
      coverageComplete = false;
      perPad.push({
        unitId: pad.unitId,
        allocatedCents: null,
        basisAmount: null,
        refusedReason:
          "The current read is lower than the prior read (a meter rollback or swap), which is not " +
          "consumption. Refusing to bill it — record a corrected read.",
      });
      continue;
    }
    const consumption = pad.currentReading - pad.priorReading;
    const cents = Math.round(consumption * args.ratePerUnitCents);
    allocatedCents += cents;
    perPad.push({
      unitId: pad.unitId,
      allocatedCents: cents,
      basisAmount: consumption,
      refusedReason: null,
    });
  }

  return {
    method: "submeter",
    basis: null,
    perPad,
    allocatedCents,
    masterBillCents: null,
    coverageComplete,
    refusedReason: null,
  };
}

/** RUBS: allocate the master bill by a recorded basis; conserve to the cent. */
function computeRubs(args: RubsBillbackArgs): UtilityBillbackResult {
  if (args.masterBillCents == null) {
    return refuseWhole("rubs", args.basis, null, "A RUBS billback needs a master bill to allocate.");
  }
  if (args.basis == null) {
    return refuseWhole(
      "rubs",
      null,
      args.masterBillCents,
      "A RUBS billback needs an allocation basis (equal, occupants, or sqft).",
    );
  }
  if (args.pads.length === 0) {
    return refuseWhole("rubs", args.basis, args.masterBillCents, "No pads supplied to allocate across.");
  }

  // A pad's weight: 1 for equal shares, else the recorded basis value. A pad
  // whose weight is not recorded (null) or non-positive is DISCLOSED as
  // uncovered — never assigned a share by guessing its occupancy or size.
  const weighted: Array<{ unitId: string; weight: number }> = [];
  const uncovered: PadBillbackLine[] = [];
  for (const pad of args.pads) {
    const weight = args.basis === "equal" ? 1 : pad.basisValue;
    if (weight == null || !Number.isFinite(weight) || weight <= 0) {
      uncovered.push({
        unitId: pad.unitId,
        allocatedCents: null,
        basisAmount: null,
        refusedReason:
          `No ${args.basis} basis recorded for this pad, so it cannot take a RUBS share. ` +
          "Refusing to guess its allocation.",
      });
      continue;
    }
    weighted.push({ unitId: pad.unitId, weight });
  }

  if (weighted.length === 0) {
    return refuseWhole(
      "rubs",
      args.basis,
      args.masterBillCents,
      `No pad has a recorded ${args.basis} basis to allocate the master bill by.`,
    );
  }

  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);

  // Deterministic conservation: floor each share, then the LAST allocated pad
  // absorbs the rounding remainder so the allocations sum EXACTLY to the master
  // bill — not a cent invented, not a cent lost.
  const billed: PadBillbackLine[] = [];
  let running = 0;
  for (let i = 0; i < weighted.length; i++) {
    const w = weighted[i];
    let cents: number;
    if (i === weighted.length - 1) {
      cents = args.masterBillCents - running;
    } else {
      cents = Math.floor((args.masterBillCents * w.weight) / totalWeight);
      running += cents;
    }
    billed.push({
      unitId: w.unitId,
      allocatedCents: cents,
      basisAmount: w.weight,
      refusedReason: null,
    });
  }

  const perPad = [...billed, ...uncovered];
  const allocatedCents = billed.reduce((s, p) => s + (p.allocatedCents ?? 0), 0);

  return {
    method: "rubs",
    basis: args.basis,
    perPad,
    allocatedCents,
    masterBillCents: args.masterBillCents,
    coverageComplete: uncovered.length === 0,
    refusedReason: null,
  };
}

/** Compute a utility pass-through billback in either mode. */
export function computeUtilityBillback(args: UtilityBillbackArgs): UtilityBillbackResult {
  return args.method === "submeter" ? computeSubmeter(args) : computeRubs(args);
}

/** cents → "$1,234.56" (a real minus sign for negatives), locale-independent. */
export function formatCents(cents: number): string {
  const neg = cents < 0;
  const s = (Math.abs(cents) / 100).toFixed(2);
  const [int, frac] = s.split(".");
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "−" : ""}$${withCommas}.${frac}`;
}

/**
 * Render the billback as the operator-facing statement text — pure, so the one
 * honesty that matters (the partial-coverage caveat) is decided in a testable
 * place and cannot be dropped at a call site. A wholly-refused billback renders
 * its refusal, never a fabricated statement.
 */
export function renderUtilityBillbackStatement(
  result: UtilityBillbackResult,
  ctx: { utilityKind: UtilityKind; periodStart: string; periodEnd: string },
): string {
  if (result.refusedReason) {
    return (
      `## Utility billback (${ctx.utilityKind}) — could not be produced\n\n` +
      `${result.refusedReason}\n`
    );
  }
  const lines: string[] = [];
  const methodLabel =
    result.method === "submeter" ? "submeter" : `RUBS (${result.basis} basis)`;
  lines.push(
    `## Utility billback (${ctx.utilityKind}, ${methodLabel}) — ${ctx.periodStart} to ${ctx.periodEnd}`,
  );
  lines.push("");
  if (result.masterBillCents != null) {
    lines.push(`- Master bill: ${formatCents(result.masterBillCents)}`);
  }
  lines.push(`- Allocated to pads: ${formatCents(result.allocatedCents)}`);
  lines.push("");
  for (const p of result.perPad) {
    if (p.refusedReason) {
      lines.push(`- Pad ${p.unitId}: not billed — ${p.refusedReason}`);
    } else {
      lines.push(`- Pad ${p.unitId}: ${formatCents(p.allocatedCents ?? 0)}`);
    }
  }
  if (!result.coverageComplete) {
    const uncovered = result.perPad.filter((p) => p.refusedReason).length;
    lines.push("");
    lines.push(
      `> ⚠️ ${uncovered} pad(s) could not be billed for lack of a read or basis input. This is a PARTIAL ` +
        `billback — review the uncovered pads before charging, and treat the allocation as provisional.`,
    );
  }
  return lines.join("\n") + "\n";
}
