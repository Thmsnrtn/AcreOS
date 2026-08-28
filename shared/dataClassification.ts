/**
 * THE canonical truth-state vocabulary — single-sourced (2026-08-28).
 *
 * The master directive asks for one product-wide language for truth-states.
 * The step-1 decision (docs/company/experience-legibility.md, "Epistemic-UX
 * frontier") is recorded there; the short form: AcreOS distinguishes exactly
 * these four states, with staleness and source-freshness carried as
 * ORTHOGONAL fields (`stale`, `sourceAsOf` on LookupResult), never as extra
 * states. The directive's finer words map on: verified/observed/
 * provider-reported → "authoritative" (+ the `source` label saying who);
 * estimated → "estimate"; inferred → "modeled"; unknown/unavailable →
 * "unknown". "customer-reported" and "conflicting" are NOT states AcreOS
 * distinguishes today; they are admitted here only when a real surface
 * carries them (the no-interface-before-a-second-consumer precedent), and
 * adding a member is a product-identity change, not a convenience.
 *
 * Before this file, the same four values were declared FOUR times —
 * server/services/providers/types.ts (DataClassification),
 * client/src/components/data-provenance-chip.tsx (re-declared),
 * shared/evidence/claim.ts (EvidenceAuthority, "deliberately the same four
 * values"), shared/landProfile.ts (structural mirror) — each aligned by
 * discipline and a comment. All four now derive from here, so drift is a
 * compile error instead of a code-review hope. shared/ is the one home the
 * boundary rule (scripts/check-boundaries.mjs S1: shared must not import
 * server) permits for a type that server, client and shared all consume.
 *
 *  - "authoritative": a system-of-record fact (open-data parcel/federal
 *    layer, county assessor of record). Reliable modulo freshness.
 *  - "estimate": derived/heuristic but data-backed (e.g. comp-based
 *    valuation).
 *  - "modeled": output of a computed score/model. NEVER present a modeled
 *    value as authoritative.
 *  - "unknown": no value — render "Not yet pulled", never a default
 *    (refuse-not-fabricate).
 */
export type DataClassification =
  | "authoritative"
  | "estimate"
  | "modeled"
  | "unknown";
