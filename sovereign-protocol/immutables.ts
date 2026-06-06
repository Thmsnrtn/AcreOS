/**
 * sovereign-protocol/immutables.ts
 * ────────────────────────────────────────────────────────────────────────────
 * Canonical typed loader for sovereign-protocol/immutables.json.
 *
 * This is the SINGLE SOURCE OF TRUTH for both immutable lists across the
 * codebase. Every downstream consumer (constitutionChecker.ts,
 * constitutionalGuard.ts, preCallConstitutionalChecker.ts,
 * shared/schema/solene-constitutional-violations.ts) re-exports the
 * derived constants from here.
 *
 * Why JSON + TS-loader instead of a hand-maintained TS module:
 *   - The JSON is the artifact whose SHA-256 the hash-asserting unit test
 *     pins (tests/unit/sovereign-protocol-immutables.test.ts). A hash
 *     anchored on a TS module would be sensitive to formatter/import-sort
 *     drift; the JSON is byte-stable.
 *   - The JSON can be loaded by non-TS tooling (codegen scripts, docs
 *     pipeline, Solene's own retro reports) without spinning a TS runtime.
 *
 * Amendment process — DO NOT skip:
 *   1. Edit sovereign-protocol/immutables.json (the JSON, never a downstream).
 *   2. Update the fixture hash in tests/unit/sovereign-protocol-immutables.test.ts.
 *   3. Update sovereign-protocol/constitution.md prose if a sovereign principle changed.
 *   4. Update docs/internal/team-roster-overview.md (or wherever immutables
 *      are described to the team) if a customer immutable changed.
 *   5. Cross-sign: the commit message must reference "constitutional amendment".
 */

import rawImmutables from "./immutables.json";

// ─── Sovereign principles (the 10) — internal-agent ethics ─────────────────

export interface SovereignPrinciple {
  readonly id: number;
  readonly name: string;
  readonly summary: string;
  readonly text: string;
}

export const SOVEREIGN_PRINCIPLES: ReadonlyArray<SovereignPrinciple> = Object.freeze(
  rawImmutables.sovereignPrinciples.items.map((p) =>
    Object.freeze({
      id: p.id,
      name: p.name,
      summary: p.summary,
      text: p.text,
    }),
  ),
);

// ─── Customer immutables (the 12) — customer-facing ethics ─────────────────

export interface CustomerImmutable {
  readonly number: number;
  /** Verbatim full wording presented to LLM screeners. */
  readonly text: string;
  /** Shorter denormalized snapshot stored in DB columns. */
  readonly short: string;
}

export const CUSTOMER_IMMUTABLES: ReadonlyArray<CustomerImmutable> = Object.freeze(
  rawImmutables.customerImmutables.items.map((i) =>
    Object.freeze({
      number: i.number,
      text: i.text,
      short: i.short,
    }),
  ),
);

/** Set of immutable numbers that escalate at `critical` severity. */
export const CRITICAL_CUSTOMER_IMMUTABLE_NUMBERS: ReadonlySet<number> =
  new Set(rawImmutables.customerImmutables.criticalSeverityNumbers);

// ─── Helpers ────────────────────────────────────────────────────────────────

export function sovereignPrincipleById(
  id: number,
): SovereignPrinciple | undefined {
  return SOVEREIGN_PRINCIPLES.find((p) => p.id === id);
}

export function customerImmutableByNumber(
  num: number,
): CustomerImmutable | undefined {
  return CUSTOMER_IMMUTABLES.find((i) => i.number === num);
}

/**
 * Raw JSON re-export, frozen, for hash-asserting consumers (the unit test
 * and any future docs codegen). Downstream code should prefer the typed
 * constants above.
 */
export const RAW_IMMUTABLES = Object.freeze(rawImmutables);

export type CustomerImmutableNumber =
  (typeof CUSTOMER_IMMUTABLES)[number]["number"];
