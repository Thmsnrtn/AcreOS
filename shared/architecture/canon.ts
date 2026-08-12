/**
 * The AcreOS Canon — a machine-readable registry of the CANONICAL ARCHITECTURE
 * declared by the Master Audit (Appendix BI "Architecture Consolidation" and
 * Appendix BL "Macro Synthesis of the 100-Audit Batch"), and an honest map of
 * how far the live repository currently sits from it.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Master Audit is ~19,000 lines of prose across ~60 appendices. Prose that
 * large cannot govern a 3,400-file repository: every session re-reads it,
 * re-derives the same conclusions, and re-litigates decisions that were already
 * made. Worse, prose cannot tell you whether the code still obeys it — which is
 * exactly the failure mode `shared/governance/constitution.ts` was written to
 * close for founder decisions (the ">$500 founder-only" hard stop drifted out
 * of enforcement for months because doctrine lived in prose and nothing
 * cross-checked the code).
 *
 * This file does for ARCHITECTURE what constitution.ts does for founder
 * DECISIONS. Same registry + ratchet shape, same enforcement vocabulary. Do not
 * invent a second pattern.
 *
 * WHAT IS IN HERE
 * ---------------
 *   CANONICAL_LAYERS    — the seven authoritative layers (BI3) and what each
 *                         owns / must not own.
 *   CANONICAL_LOOP      — the nine-stage loop every feature must be locatable
 *                         on (BI155): REALITY → EVIDENCE → ECONOMICS →
 *                         DECISION → PLAN → AUTHORIZED ACTION → WORKFLOW →
 *                         OUTCOME → LEARNING.
 *   CANONICAL_LAWS      — the fifteen constitutional laws (BL8). These are
 *                         architectural law, distinct from the founder's
 *                         standing business decisions in constitution.ts.
 *   CANONICAL_OBJECTS   — the minimum canonical object set (BI12), each mapped
 *                         to the table(s) that represent it in THIS repo today,
 *                         with an honest gap classification and disposition.
 *   FITNESS_FUNCTIONS   — the twelve architecture fitness functions (BL3), each
 *                         with its fail condition and what (if anything)
 *                         actually enforces it.
 *
 * WHAT IS *NOT* IN HERE
 * ---------------------
 * Aspiration. Every `tables` entry names a table that really exists in
 * shared/schema.ts or shared/schema/*.ts, and every enforcement `ref` names a
 * file that really exists — `tests/unit/canonicalArchitecture.test.ts` fails
 * the build otherwise. A registry that claims coverage it does not have is
 * worse than no registry, because it reads as assurance.
 *
 * HOW IT RATCHETS
 * ---------------
 * tests/unit/canonicalArchitecture.test.ts guarantees:
 *   1. every enforcement ref resolves to a file that exists;
 *   2. every named table exists in the Drizzle schema;
 *   3. the number of UNENFORCED fitness functions may only SHRINK;
 *   4. the number of canonical objects with no canonical home may only SHRINK.
 *
 * When you make a fitness function real, reclassify it here and LOWER the
 * baseline in the same commit. That is the whole mechanism: convergence on the
 * canonical architecture becomes a number that can only go down.
 *
 * PRECEDENCE
 * ----------
 * Appendix BI is the canonical reconciliation layer over all earlier audit
 * sections (BI164). Where an earlier audit recommendation conflicts with BI,
 * BI wins — unless a newer explicit repository ADR deliberately supersedes it.
 * Where the AUDIT makes a factual claim about the repo that HEAD disproves, the
 * repo wins and the claim is recorded here as corrected.
 */

// ── Vocabulary ────────────────────────────────────────────────────────────

/** How strongly an architectural rule is backed by automation. Mirrors
 *  `EnforcementKind` in shared/governance/constitution.ts deliberately. */
export type ArchEnforcementKind =
  | "code-invariant" // enforced structurally in code + covered by a test
  | "ratchet-test" // a vitest ratchet fails the build on drift
  | "lint" // a scripts/*.mjs gate inside `npm run check`
  | "partial" // something enforces part of it; the gap is named in `note`
  | "unenforced"; // recorded, but NO automated backstop — relies on vigilance

export interface ArchEnforcement {
  kind: ArchEnforcementKind;
  /** Repo-relative paths that enforce (or embody) the rule. Must all exist. */
  refs: string[];
  /** Required when kind is "partial" or "unenforced": what is NOT covered. */
  note?: string;
}

/**
 * How a canonical object is represented in the live repo TODAY.
 *  - canonical      — one table owns this concept's identity and lifecycle.
 *  - conflated      — the concept exists but shares a table with other
 *                     concepts (e.g. Parcel identity living inside
 *                     `properties` alongside economics and deal status).
 *  - role-table     — the concept is represented only as a role/state on some
 *                     other record, or as several role-specific side tables.
 *  - projection     — correctly derived from other state; no table needed.
 *  - absent         — no representation at all.
 */
export type RepoStatus =
  | "canonical"
  | "conflated"
  | "role-table"
  | "projection"
  | "absent";

/** What should happen to the current representation. Matches the audit's
 *  disposition vocabulary (KEEP / MERGE / REFACTOR / … ). */
export type Disposition =
  | "KEEP"
  | "KEEP_HARDEN"
  | "MERGE"
  | "REFACTOR"
  | "MIGRATE"
  | "BUILD"
  | "DEPRECATE"
  | "DEFER";

// ── The seven authoritative layers (BI3) ──────────────────────────────────

export interface CanonicalLayer {
  /** 1..7, the dependency order — lower layers never depend on higher ones. */
  ordinal: number;
  id: string;
  title: string;
  /** What state this layer is the single owner of. */
  owns: string;
  /** What this layer must NOT own — the boundary that keeps it honest. */
  doesNotOwn: string;
}

export const CANONICAL_LAYERS: readonly CanonicalLayer[] = [
  {
    ordinal: 1,
    id: "identity-tenancy",
    title: "Identity & Tenancy",
    owns: "users, organizations, roles, authorization context",
    doesNotOwn: "investment semantics",
  },
  {
    ordinal: 2,
    id: "reality-graph",
    title: "Canonical Reality Graph",
    owns: "property, parcel, party, relationship, opportunity, deal, holding, instrument, document references",
    doesNotOwn: "source claims as truth",
  },
  {
    ordinal: 3,
    id: "evidence-fabric",
    title: "Evidence Fabric",
    owns: "claims, sources, provenance, freshness, conflicts, confidence, jurisdiction coverage",
    doesNotOwn: "final investment decisions",
  },
  {
    ordinal: 4,
    id: "economics-strategy",
    title: "Economics & Strategy",
    owns: "deterministic calculations, scenarios, Strategy Pack rules, sensitivities",
    doesNotOwn: "external side effects",
  },
  {
    ordinal: 5,
    id: "decision-memory",
    title: "Decision Memory",
    owns: "decision snapshots, assumptions, alternatives, rationale, unknowns, authority",
    doesNotOwn: "workflow execution",
  },
  {
    ordinal: 6,
    id: "action-workflow",
    title: "Action & Workflow",
    owns: "plans, approvals, capabilities, durable state, idempotency, receipts, exceptions",
    doesNotOwn: "domain truth ownership",
  },
  {
    ordinal: 7,
    id: "outcome-learning",
    title: "Outcome & Learning",
    owns: "actual results, variances, calibration, personal benchmarks",
    doesNotOwn: "rewriting historical decisions",
  },
] as const;

/**
 * Pax and Founder OS are deliberately NOT layers.
 *
 * Pax is a cross-cutting interface over the seven layers (BI4) — it may reason,
 * retrieve, compare, explain, propose and invoke capabilities, but authoritative
 * state stays in domain services. Founder OS is a privileged control plane over
 * the SAME substrate (BI5), not a second product database. Anything that gives
 * either of them its own truth store is an architecture violation, not a
 * feature.
 */
export const NON_LAYERS = [
  {
    id: "pax",
    title: "Pax",
    role: "primary AI interaction/orchestration layer across all seven layers",
    prohibition: "must not become a parallel source of truth (BI4)",
  },
  {
    id: "founder-os",
    title: "Founder OS",
    role: "privileged, explicitly scoped control plane over the production substrate",
    prohibition:
      "must not create duplicate founder-only copies of customer, source, workflow or cost state (BI5)",
  },
] as const;

// ── The canonical loop (BI1 / BI155) ──────────────────────────────────────

/**
 * Every customer-facing and founder-facing capability must create, transform,
 * explain, govern, execute or observe one of these stages. A feature that
 * cannot be located on this loop should be challenged (BI155, the New Feature
 * Test).
 */
export const CANONICAL_LOOP = [
  "REALITY",
  "EVIDENCE",
  "ECONOMICS",
  "DECISION",
  "PLAN",
  "AUTHORIZED_ACTION",
  "WORKFLOW",
  "OUTCOME",
  "LEARNING",
] as const;

export type LoopStage = (typeof CANONICAL_LOOP)[number];

// ── The fifteen constitutional laws (BL8) ─────────────────────────────────

export interface CanonicalLaw {
  /** Stable ordinal from BL8 — never renumber. */
  n: number;
  id: string;
  statement: string;
}

/**
 * These are ARCHITECTURAL law. They are distinct from — and do not supersede —
 * the founder's standing business decisions in shared/governance/constitution.ts
 * (the DO-NOT-DO list). Both are binding; they govern different things.
 */
export const CANONICAL_LAWS: readonly CanonicalLaw[] = [
  {
    n: 1,
    id: "one-owner",
    statement:
      "Canonical state has one owner; views do not create alternate truth.",
  },
  {
    n: 2,
    id: "evidence-known",
    statement:
      "Every material assertion should know its evidence, provenance, freshness and uncertainty.",
  },
  {
    n: 3,
    id: "unknown-is-valid",
    statement:
      "Unknown and conflict are valid states and must not be silently converted into certainty.",
  },
  {
    n: 4,
    id: "deterministic-math",
    statement: "Financial and geometric truth is deterministic, tested and versioned.",
  },
  {
    n: 5,
    id: "packs-extend-kernel",
    statement:
      "Strategy Packs extend one kernel; investor profiles do not fork the platform.",
  },
  {
    n: 6,
    id: "decisions-immutable",
    statement: "Historical decisions preserve what was known and assumed at the time.",
  },
  {
    n: 7,
    id: "pax-not-truth",
    statement: "Pax reasons over canonical state but does not become canonical state.",
  },
  {
    n: 8,
    id: "governed-actions",
    statement:
      "Consequential actions require explicit authority, durable execution, idempotency and receipts.",
  },
  {
    n: 9,
    id: "outcomes-append",
    statement: "Outcomes append learning; they do not rewrite history.",
  },
  {
    n: 10,
    id: "providers-replaceable",
    statement:
      "Providers are replaceable machinery behind AcreOS-owned semantic contracts.",
  },
  {
    n: 11,
    id: "earned-infrastructure",
    statement: "Infrastructure complexity must be earned by measured need.",
  },
  {
    n: 12,
    id: "attention-is-scarce",
    statement:
      "Customer attention and founder attention are scarce resources to protect.",
  },
  {
    n: 13,
    id: "cost-attributable",
    statement:
      "Variable cost must be attributable and optimized per successful outcome.",
  },
  {
    n: 14,
    id: "portability-is-trust",
    statement:
      "Portability and export are trust features; retention must be earned through compounding value.",
  },
  {
    n: 15,
    id: "loops-beat-breadth",
    statement:
      "When architecture and feature breadth conflict, complete coherent vertical loops win.",
  },
] as const;

// ── The canonical object set (BI12) ───────────────────────────────────────

export interface CanonicalObject {
  id: string;
  /** The canonical purpose, quoted from BI12. */
  purpose: string;
  layer: string;
  status: RepoStatus;
  /** Real Drizzle table names in this repo. Verified to exist by the ratchet. */
  tables: string[];
  /** The honest gap: what is wrong with the current representation, or "" if
   *  the current representation is already canonical. */
  gap: string;
  disposition: Disposition;
}

/**
 * The minimum canonical object set from BI12, mapped onto what this repo
 * actually has at HEAD.
 *
 * Reading this table is the fastest way to understand the architecture delta:
 * `status: "canonical"` rows are done; everything else is the work.
 */
export const CANONICAL_OBJECTS: readonly CanonicalObject[] = [
  {
    id: "organization",
    purpose: "security and ownership boundary",
    layer: "identity-tenancy",
    status: "canonical",
    tables: ["organizations"],
    gap: "",
    disposition: "KEEP_HARDEN",
  },
  {
    id: "user",
    purpose: "human/service identity",
    layer: "identity-tenancy",
    status: "canonical",
    tables: ["team_members"],
    gap: "",
    disposition: "KEEP_HARDEN",
  },
  {
    id: "property",
    purpose: "economic real-estate object",
    layer: "reality-graph",
    status: "conflated",
    tables: ["properties"],
    gap:
      "`properties` is a god table (BI9/AW96): it carries cadastral identity (apn, " +
      "legalDescription, parentParcelId), economic state (purchasePrice, marketValue), " +
      "deal/pipeline status, due-diligence state, and direct sellerId/buyerId foreign " +
      "keys into `leads`. Parcel identity and Property economics must separate before " +
      "multi-parcel assemblage or multi-strategy evaluation can be modelled honestly.",
    disposition: "REFACTOR",
  },
  {
    id: "parcel",
    purpose: "cadastral/legal parcel identity",
    layer: "reality-graph",
    status: "conflated",
    tables: ["properties"],
    gap:
      "No distinct Parcel entity. APN identity is overloaded onto the economic object " +
      "(BI9 forbids). One Property may span many Parcels; today that is inexpressible " +
      "except via the subdivision parentParcelId self-reference.",
    disposition: "BUILD",
  },
  {
    id: "party",
    purpose: "person/company/government/service entity",
    layer: "reality-graph",
    status: "role-table",
    tables: ["leads", "buyer_profiles", "investor_profiles"],
    gap:
      "`leads` is the de-facto person table and is also the target of " +
      "properties.sellerId AND properties.buyerId — i.e. the same real-world person " +
      "occupying two roles needs two rows. Buyer/borrower/investor identity lives in " +
      "further side tables. BI10: Lead is a STATE/ROLE, not a core person table.",
    disposition: "REFACTOR",
  },
  {
    id: "relationship",
    purpose: "typed relationship between canonical entities",
    layer: "reality-graph",
    status: "absent",
    tables: [],
    gap:
      "No first-class typed relationship edge. Every new investor profile has been " +
      "expressed by adding convenience foreign keys instead (BI184 forbids), which is " +
      "why role-specific person tables keep multiplying.",
    disposition: "BUILD",
  },
  {
    id: "opportunity",
    purpose: "potential investment/disposition/financing action",
    layer: "reality-graph",
    status: "absent",
    tables: [],
    gap:
      "Early acquisition intelligence is carried on `leads` and on properties.status. " +
      "BI11: a Deal represents a transaction process AFTER sufficient commitment; " +
      "pre-commitment interest belongs to Opportunity. Without it, one Property cannot " +
      "host several simultaneous strategy evaluations (BI93).",
    disposition: "BUILD",
  },
  {
    id: "deal",
    purpose: "transaction in progress",
    layer: "reality-graph",
    status: "canonical",
    tables: ["deals"],
    gap: "",
    disposition: "KEEP_HARDEN",
  },
  {
    id: "holding",
    purpose: "owned/controlled economic position",
    layer: "reality-graph",
    status: "role-table",
    tables: ["properties"],
    gap:
      "Ownership is a `status` string on `properties` ('owned'), not a Holding with its " +
      "own lifecycle, basis, cash flows and disposition history.",
    disposition: "BUILD",
  },
  {
    id: "instrument",
    purpose: "note, loan, lease or other contractual economic instrument",
    layer: "reality-graph",
    status: "role-table",
    tables: ["notes", "rental_leases"],
    gap:
      "Notes and leases are separate vertical tables rather than one Instrument concept " +
      "with typed extensions (BI43/BI44). Cross-strategy reasoning (a note secured by a " +
      "property the customer also holds) has no shared shape to reason over.",
    disposition: "MERGE",
  },
  {
    id: "document",
    purpose: "document identity/metadata/content references",
    layer: "reality-graph",
    status: "conflated",
    tables: [
      "document_versions",
      "generated_documents",
      "deal_room_documents",
      "document_templates",
    ],
    gap:
      "There is no single Document identity. Documents exist as several " +
      "surface-specific tables (versions, generated, deal-room, templates), so a " +
      "document cannot be referenced once and linked to the decision, workflow and " +
      "evidence claims it produced (BI36/BI145).",
    disposition: "MERGE",
  },
  {
    id: "evidence-claim",
    purpose: "source-backed assertion about reality",
    layer: "evidence-fabric",
    status: "canonical",
    tables: ["evidence_claims"],
    gap: "",
    disposition: "KEEP_HARDEN",
  },
  {
    id: "scenario",
    purpose: "deterministic economic hypothesis",
    layer: "economics-strategy",
    status: "absent",
    tables: [],
    gap:
      "Calculations are transient. `scenario_simulations` and " +
      "`scenario_outcome_comparisons` are founder-plane autopilot tables, not customer " +
      "investment scenarios. Nothing persists a versioned economic hypothesis with its " +
      "assumptions, so a DecisionSnapshot has nothing stable to freeze a reference to.",
    disposition: "BUILD",
  },
  {
    id: "decision-snapshot",
    purpose: "versioned investment/operating decision",
    layer: "decision-memory",
    status: "canonical",
    tables: ["decision_snapshots"],
    gap: "",
    disposition: "KEEP_HARDEN",
  },
  {
    id: "plan",
    purpose: "proposed sequence of work",
    layer: "action-workflow",
    status: "role-table",
    tables: ["plan_proposals"],
    gap:
      "`plan_proposals` exists but Plan-vs-WorkflowRun is not a clean boundary (BI21): " +
      "a proposal is not the same object as accepted, executing durable work.",
    disposition: "REFACTOR",
  },
  {
    id: "workflow-run",
    purpose: "durable execution state",
    layer: "action-workflow",
    status: "canonical",
    tables: ["workflow_runs"],
    gap: "",
    disposition: "KEEP_HARDEN",
  },
  {
    id: "action-receipt",
    purpose: "verified external/internal side effect",
    layer: "action-workflow",
    status: "role-table",
    tables: ["proof_receipts"],
    gap:
      "A genuinely strong receipt primitive EXISTS but only on the FOUNDER autopilot " +
      "plane (server/services/autopilot/proofReceipt.ts — hash-chained, " +
      "prediction-sealed, constitution-versioned, TenantScope-attributed). No customer " +
      "outward action (email, SMS, physical mail, e-sign) emits one. Generalising the " +
      "existing kernel primitive is the right move; building a second receipt system " +
      "is not.",
    disposition: "REFACTOR",
  },
  {
    id: "outcome",
    purpose: "actual realized result/event",
    layer: "outcome-learning",
    status: "role-table",
    tables: ["outcome_telemetry", "outcome_calibrations"],
    gap:
      "Outcome capture exists on the founder/autopilot plane. There is no customer-side " +
      "Outcome that links back to an investment decision and records what actually " +
      "happened, so the Decision → Outcome → calibration loop cannot close for the " +
      "customer.",
    disposition: "BUILD",
  },
] as const;

// ── Architecture fitness functions (BL3) ──────────────────────────────────

export interface FitnessFunction {
  id: string;
  title: string;
  /** The condition that means this fitness function has FAILED. Quoted BL3. */
  failCondition: string;
  enforcement: ArchEnforcement;
}

/**
 * The twelve fitness functions from BL3, with an honest account of what
 * enforces each one TODAY.
 *
 * `unenforced` here is not an accusation — it is the work queue. The ratchet in
 * tests/unit/canonicalArchitecture.test.ts holds the unenforced count at or
 * below its baseline, so this list can only improve.
 */
export const FITNESS_FUNCTIONS: readonly FitnessFunction[] = [
  {
    id: "single-canonical-identity",
    title: "Single source of canonical identity",
    failCondition:
      "A feature creates a second property/party/deal identity universe.",
    enforcement: {
      kind: "partial",
      refs: ["scripts/check-boundaries.mjs", "scripts/check-kernel-boundary.mjs"],
      note:
        "Import boundaries are enforced, but nothing prevents a new table from " +
        "creating a parallel person/property identity — `leads` + buyer_profiles + " +
        "investor_profiles already demonstrate the drift.",
    },
  },
  {
    id: "evidence-traceability",
    title: "Evidence traceability",
    failCondition:
      "A material factual field cannot identify source/observation/freshness.",
    enforcement: {
      kind: "partial",
      refs: [
        "shared/evidence/claim.ts",
        "shared/schema/evidence.ts",
        "server/services/evidence/evidenceStore.ts",
        "server/services/evidence/enrichmentToClaims.ts",
        "tests/unit/evidenceResolution.test.ts",
        "tests/unit/enrichmentToClaims.test.ts",
        "server/services/providers/types.ts",
        "server/services/providers/data-licenses.ts",
        "scripts/check-no-fabrication.mjs",
      ],
      note:
        "The Evidence Fabric now EXISTS and is wired: `evidence_claims` persists " +
        "source-attributed, append-only claims and the deterministic policy in " +
        "shared/evidence/claim.ts resolves them into a recomputable current answer " +
        "with unknown/conflict/stale as first-class states. REMAINING GAP: only the " +
        "property-enrichment write path emits claims. Every other write that sets a " +
        "material factual column (bulk import, manual edit, due-diligence, " +
        "residential comps, the AVM/ARV surfaces) still writes an unattributed value " +
        "straight onto the canonical row. Until those paths route through claims — " +
        "and until a lint bars new ones — a material field can still exist with no " +
        "identifiable source.",
    },
  },
  {
    id: "historical-decision-fidelity",
    title: "Historical decision fidelity",
    failCondition:
      "A prior decision changes meaning when current data or Pack rules change.",
    enforcement: {
      kind: "ratchet-test",
      refs: [
        "shared/decisions/snapshot.ts",
        "shared/schema/decision-snapshots.ts",
        "server/services/decisions/decisionStore.ts",
        "server/routes-decisions.ts",
        "tests/unit/decisionSnapshotFidelity.test.ts",
      ],
      note:
        "decisionSnapshotFidelity.test.ts writes a snapshot, then MUTATES the " +
        "evidence underneath it (a new claim arrives, a source changes its mind, an " +
        "unknown becomes known) and asserts the snapshot still reports what was " +
        "believed THEN — a record that passes only when nothing changes is a cache, " +
        "not a record. Immutability is structural: no updatedAt column, no " +
        "UPDATE/DELETE in the store, no PUT/PATCH/DELETE endpoint, each pinned by a " +
        "test. Strategy Pack id+version are frozen per BI91.",
    },
  },
  {
    id: "deterministic-money-math",
    title: "Deterministic money math",
    failCondition: "A model response is required to reproduce a financial result.",
    enforcement: {
      kind: "partial",
      refs: [
        "shared/finance/cents.ts",
        "shared/calculators/landDeal.ts",
        "server/services/notePaymentMath.ts",
        "scripts/check-no-fabrication.mjs",
      ],
      note:
        "Deterministic helpers exist and the no-fabrication lint bars invented " +
        "numbers, but there is no single versioned economics kernel and no gate " +
        "asserting that a financial field is never sourced from a model response.",
    },
  },
  {
    id: "governed-side-effects",
    title: "Governed side effects",
    failCondition:
      "An external/financial/contractual action can bypass authority/idempotency/receipt.",
    enforcement: {
      kind: "partial",
      refs: [
        "server/middleware/idempotency.ts",
        "server/services/autopilot/proofReceipt.ts",
        "server/services/customerMoneyRouting.ts",
        "tests/unit/moneyCustodyHardStop.test.ts",
      ],
      note:
        "Money custody is hard-gated and the founder plane has hash-chained receipts, " +
        "but idempotency is an HTTP-REQUEST-level middleware, not an ACTION/provider " +
        "boundary key (BI74). emailService, smsService, lobService and " +
        "directMailService carry no idempotency key, so a retried job can double-send.",
    },
  },
  {
    id: "provider-replaceability",
    title: "Provider replaceability",
    failCondition: "Vendor schema appears in canonical domain contracts.",
    enforcement: {
      kind: "partial",
      refs: [
        "server/services/providers/types.ts",
        "server/services/providers/provider-registry.ts",
        "docs/adr/003-bullmq-job-queue.md",
      ],
      note:
        "The provider category interface is real and adapters normalise into " +
        "LookupResult, but nothing gates a vendor-shaped field being added to a " +
        "canonical table.",
    },
  },
  {
    id: "tenant-isolation",
    title: "Tenant isolation",
    failCondition:
      "Any cache, AI context, job or founder tool can traverse tenants unintentionally.",
    enforcement: {
      kind: "code-invariant",
      refs: [
        "scripts/check-org-leading-index.mjs",
        "scripts/check-org-scoped-fetch.mjs",
        "tests/unit/orgScopedDb.test.ts",
        "tests/unit/securityTests.test.ts",
        "server/services/autopilot/tenantScope.ts",
      ],
      note:
        "The strongest layer in the repo: org-leading index lint, org-scoped fetch " +
        "lint, an orgScopedDb test and a typed TenantScope primitive.",
    },
  },
  {
    id: "cost-attribution",
    title: "Cost attribution",
    failCondition:
      "Material variable spend cannot be mapped to tenant/capability/workflow.",
    enforcement: {
      kind: "partial",
      refs: [
        "server/services/autopilot/cognitionBudget.ts",
        "tests/unit/aiSpendGuard.test.ts",
        "tests/unit/aiCostCeilingDefault.test.ts",
      ],
      note:
        "AI spend has a per-org ceiling and a guard test; paid DATA lookups deduct " +
        "credits. Neither is attributed to a WORKFLOW or an OUTCOME, so cost per " +
        "successful outcome (Law 13) is not computable.",
    },
  },
  {
    id: "profile-extensibility",
    title: "Profile extensibility",
    failCondition: "Adding a Strategy Pack requires copying core schemas/services.",
    enforcement: {
      kind: "partial",
      refs: [
        "shared/business-types.ts",
        "server/services/autopilot/domainPack.ts",
        "scripts/check-kernel-boundary.mjs",
      ],
      note:
        "A real kernel/pack seam exists — but on the FOUNDER autopilot plane. The " +
        "CUSTOMER side has no Strategy Pack contract: business-types.ts is a maturity " +
        "registry, and profile behaviour is expressed as scattered conditionals.",
    },
  },
  {
    id: "founder-operability",
    title: "Founder operability",
    failCondition:
      "A routine failure requires undocumented database/server surgery.",
    enforcement: {
      kind: "partial",
      refs: [
        "docs/operations-runbook.md",
        "docs/INCIDENT_RESPONSE.md",
        "server/routes-founder-dlq.ts",
      ],
      note:
        "Runbooks and a DLQ surface exist. Not every routine failure class has an " +
        "audited domain repair capability (BI180), so some repairs still mean SQL.",
    },
  },
  {
    id: "outcome-learning",
    title: "Outcome learning",
    failCondition: "Important forecasts cannot later be compared with actual results.",
    enforcement: {
      kind: "partial",
      refs: [
        "server/services/autopilot/proofReceipt.ts",
        "server/services/autopilot/decisionEval.ts",
        "tests/unit/autopilotDecisionEval.test.ts",
      ],
      note:
        "The founder plane seals a prediction into the receipt hash and scores it " +
        "later — genuinely best-in-class. The CUSTOMER plane has no equivalent: no " +
        "investment forecast is recorded in a form that can be graded.",
    },
  },
  {
    id: "infrastructure-restraint",
    title: "Infrastructure restraint",
    failCondition: "A new primitive is introduced without a measured requirement.",
    enforcement: {
      kind: "lint",
      refs: [
        "scripts/check-infrastructure-restraint.mjs",
        "tests/unit/infrastructureRestraint.test.ts",
      ],
      note:
        "BI152's New Database Test is now a gate inside `npm run check`: every " +
        "banned primitive (graph DB, standalone vector service, streaming bus, " +
        "warehouse, k8s, service mesh, search cluster) is scanned for in both " +
        "package.json AND deploy config, and anything found must carry a written " +
        "MEASURED need in REGISTERED_EXCEPTIONS. It is preventative, not " +
        "remedial — the repo passes today with 165 dependencies and zero banned " +
        "primitives, and the exception list is empty. The gate deliberately does " +
        "NOT ban pgvector: a Postgres extension is a derived index inside the one " +
        "primary relational database (BI57/BI61), not an alternate system of " +
        "record. Twelve tests run the real script against synthetic repos to prove " +
        "it bites, because a check that only ever passes is indistinguishable from " +
        "one that cannot fail.",
    },
  },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────

export function layerById(id: string): CanonicalLayer | undefined {
  return CANONICAL_LAYERS.find((l) => l.id === id);
}

export function objectById(id: string): CanonicalObject | undefined {
  return CANONICAL_OBJECTS.find((o) => o.id === id);
}

export function fitnessById(id: string): FitnessFunction | undefined {
  return FITNESS_FUNCTIONS.find((f) => f.id === id);
}

/** Fitness functions with NO automated backstop — the debt to drive to zero. */
export function unenforcedFitness(): FitnessFunction[] {
  return FITNESS_FUNCTIONS.filter((f) => f.enforcement.kind === "unenforced");
}

/** Fitness functions only partly enforced — the second tier of the same debt. */
export function partialFitness(): FitnessFunction[] {
  return FITNESS_FUNCTIONS.filter((f) => f.enforcement.kind === "partial");
}

/** Canonical objects with no canonical home yet (the Reality Graph delta). */
export function objectsWithoutCanonicalHome(): CanonicalObject[] {
  return CANONICAL_OBJECTS.filter(
    (o) => o.status !== "canonical" && o.status !== "projection",
  );
}

/** Every table name this registry claims exists, de-duplicated. */
export function allClaimedTables(): string[] {
  return [...new Set(CANONICAL_OBJECTS.flatMap((o) => o.tables))].sort();
}

/** Every enforcement ref this registry claims exists, de-duplicated. */
export function allEnforcementRefs(): string[] {
  return [...new Set(FITNESS_FUNCTIONS.flatMap((f) => f.enforcement.refs))].sort();
}
