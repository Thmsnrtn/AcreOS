/**
 * The AcreOS Constitution — a machine-readable registry of standing founder
 * decisions and HOW each one is enforced.
 *
 * WHY THIS EXISTS
 * ---------------
 * The ">$500 spends are founder-only" hard stop lived as prose in CLAUDE.md
 * while the code (SPENDING_TIERS) quietly let $500–$50K auto-execute — the two
 * drifted apart and nobody noticed until a deep audit found it. Doctrine kept
 * in prose rots silently. This registry is the single source of truth: every
 * standing decision is listed here with a pointer to the code/test/lint that
 * enforces it, or an honest "prose-only" flag when nothing automated backs it.
 *
 * The ratchet in tests/unit/constitution.test.ts then guarantees:
 *   1. every enforcement pointer resolves to a file that actually exists, and
 *   2. the number of *unenforced hard stops* may only SHRINK, never grow.
 *
 * A hard stop with no automated backstop is a governance debt. This file makes
 * that debt countable so it can be driven to zero — the same "ratchet toward
 * the north star" discipline used for the founder-route and deletion floors.
 *
 * This registry does NOT create or change any decision. Decisions are made by
 * the founder and recorded in CLAUDE.md, the roadmap, or a dated founder
 * decision; this file mirrors them into a checkable form. To CHANGE a decision,
 * change it at its source (only the founder may) — then reflect it here.
 */

/** What kind of standing decision this is. */
export type InvariantCategory =
  | "hard-stop" // founder-only forever; MUST end up machine-enforced
  | "nav-doctrine" // the fixed customer/founder doors
  | "no-fabrication" // never present invented data as real
  | "expansion-gate" // the approved growth ladder (marketplace/API triggers)
  | "data-plane" // gated data planes (residential comps)
  | "rails" // BYO send rails; platform sender for system mail only
  | "ai-surface"; // Pax stays ambient, never a separate destination

/** How strongly a decision is backed by automation. */
export type EnforcementKind =
  | "code-invariant" // enforced structurally in code + covered by a test
  | "ratchet-test" // a vitest ratchet fails the build on drift
  | "lint" // a scripts/*.mjs gate in `npm run check`
  | "prose-only"; // recorded, but NO automated backstop — relies on vigilance

export interface Enforcement {
  kind: EnforcementKind;
  /** Repo-relative paths that enforce (or embody) the decision. */
  refs: string[];
  note?: string;
}

export interface ConstitutionInvariant {
  /** Stable kebab-case id — never reused, never renamed. */
  id: string;
  /** Short human title. */
  title: string;
  /** The decision itself, one sentence, in plain language. */
  statement: string;
  category: InvariantCategory;
  /** Where the decision is recorded (its authoritative source). */
  source: string;
  enforcement: Enforcement;
}

export const CONSTITUTION: readonly ConstitutionInvariant[] = [
  // ── Hard stops (founder-only forever) ──────────────────────────────────
  {
    id: "hard-stop.spend-over-500",
    title: "Spends over $500 are founder-only",
    statement:
      "The autopilot may spend up to $500 autonomously; every larger spend routes to the founder and never self-executes.",
    category: "hard-stop",
    source: "CLAUDE.md DO-NOT-DO list; founder decision (this session)",
    enforcement: {
      kind: "code-invariant",
      refs: [
        "server/services/financialAuthorityGate.ts",
        "server/services/autonomousDecisionExecutor.ts",
        "tests/unit/spendHardStop.test.ts",
        "tests/unit/spendGateStatusRouting.test.ts",
        "tests/unit/founderHardStopGuardrails.test.ts",
      ],
      note: "Two independent enforcements: spendIsAutonomous() is true only for Tier 1 ($0–$500) and the executor hard-stops every non-approved gate status; separately checkHardGuardrails() blocks any actionPayload.amount over HARD_GUARDRAIL_AMOUNT_LIMIT (50_000 cents = $500) before the AI is consulted.",
    },
  },
  {
    id: "hard-stop.pricing-changes",
    title: "Pricing changes are founder-only",
    statement:
      "No price, tier, or allowance change ships without an explicit founder decision.",
    category: "hard-stop",
    source: "CLAUDE.md DO-NOT-DO list",
    enforcement: {
      kind: "code-invariant",
      refs: [
        "server/services/autonomousDecisionExecutor.ts",
        "tests/unit/founderHardStopGuardrails.test.ts",
        "shared/billing/tier-pricing.ts",
        "server/services/railSunsetDecisionCards.ts",
      ],
      note: "checkHardGuardrails() blocks BILLING_SUBSCRIPTION_ACTIONS (incl. 'pricing_change') before the AI is consulted, matched against actionType/itemType/category. Prices themselves are static constants, and open pricing questions reach the founder as decision cards.",
    },
  },
  {
    id: "hard-stop.legal-signing",
    title: "Legal signing is founder-only",
    statement:
      "No contract or legally binding document is signed or executed autonomously.",
    category: "hard-stop",
    source: "CLAUDE.md DO-NOT-DO list",
    enforcement: {
      kind: "code-invariant",
      refs: [
        "server/services/autonomousDecisionExecutor.ts",
        "tests/unit/founderHardStopGuardrails.test.ts",
      ],
      note:
        "checkHardGuardrails() blocks LEGAL_SIGNING_ACTIONS (legal_signing, " +
        "contract_execute, contract_sign, document_sign, esign, envelope_send, " +
        "agreement_execute) matched against actionType/itemType/category, plus " +
        "sign/execute_contract payload flags, before the AI is consulted. The " +
        "native e-sign surfaces are human-initiated route handlers (signers " +
        "act via HMAC-tokened links); no autonomous envelope dispatch exists — " +
        "the DocuSign connector entry is catalog-only with no implementation. " +
        "HONEST SCOPE: this gate covers the autonomous executor's action " +
        "classes; it does NOT cover legal exposure from non-signing acts — an " +
        "accepted sub-$500 offer letter can still form a contract. That " +
        "residual exposure is real and named deliberately, per " +
        "refuse-not-fabricate.",
    },
  },
  {
    id: "hard-stop.customer-data-deletion",
    title: "Customer-data deletion is founder-only",
    statement:
      "Destructive deletion of customer data requires an explicit founder action.",
    category: "hard-stop",
    source: "CLAUDE.md DO-NOT-DO list",
    enforcement: {
      kind: "code-invariant",
      refs: [
        "server/services/autonomousDecisionExecutor.ts",
        "tests/unit/founderHardStopGuardrails.test.ts",
        "server/services/founder-chat/tool-registry.ts",
      ],
      note: "checkHardGuardrails() blocks DATA_DELETION_ACTIONS (data_deletion, bulk_delete, account_deletion, record_purge, permanent_delete) AND any payload carrying a delete/permanent/purge intent flag, before the AI is consulted. Founder-chat destructive tools additionally carry a kill switch + confirmation.",
    },
  },

  // ── Navigation doctrine ────────────────────────────────────────────────
  {
    id: "nav.customer-five-doors",
    title: "Exactly five customer doors",
    statement:
      "The customer nav is exactly Today · Map · Deals · Finance · Pax (+ Inbox, Settings), identical for every persona; new surfaces live behind a door, never as a new top-level entry.",
    category: "nav-doctrine",
    source: "CLAUDE.md 'Customer navigation'",
    enforcement: {
      kind: "ratchet-test",
      refs: [
        "tests/unit/mobileNavFixedDoors.test.ts",
        "client/src/lib/nav-items.ts",
        "client/src/components/layout-sidebar.tsx",
      ],
    },
  },
  {
    id: "nav.customer-doors-never-hidden",
    title: "The five doors are never hidden per-persona",
    statement:
      "The five customer doors may never be hidden for any persona (PROTECTED_DOOR_ROUTES).",
    category: "nav-doctrine",
    source: "CLAUDE.md DO-NOT-DO list",
    enforcement: {
      kind: "ratchet-test",
      refs: [
        "tests/unit/sidebarHiddenRoutes.test.ts",
        "client/src/lib/sidebar-hidden-routes.ts",
      ],
    },
  },
  {
    id: "nav.founder-four-doors",
    title: "Exactly four founder doors",
    statement:
      "The founder surface is exactly The Letter · Decisions · Controls · Story (+ the /founder/admin/* namespace); the /founder/* route count may only shrink.",
    category: "nav-doctrine",
    source: "CLAUDE.md 'Founder navigation'",
    enforcement: {
      kind: "ratchet-test",
      refs: [
        "tests/unit/founderFourDoors.test.ts",
        "client/src/lib/founder-doors.ts",
      ],
    },
  },

  // ── Truth ──────────────────────────────────────────────────────────────
  {
    id: "truth.no-fabrication",
    title: "Fabrication is never acceptable",
    statement:
      "No invented numbers, fake activity, or placeholder data presented as real — refuse, don't fabricate.",
    category: "no-fabrication",
    source: "CLAUDE.md DO-NOT-DO list",
    enforcement: {
      kind: "lint",
      refs: ["scripts/check-no-fabrication.mjs"],
    },
  },

  // ── Expansion ladder ───────────────────────────────────────────────────
  {
    id: "expansion.marketplace-25-api-50",
    title: "Marketplace ~25 customers, API ~50",
    statement:
      "No marketplace before ~25 customers and no public API before ~50 (the approved expansion ladder).",
    category: "expansion-gate",
    source: "docs/company/roadmap-2026-07.md; CLAUDE.md DO-NOT-DO list",
    enforcement: {
      kind: "prose-only",
      refs: ["docs/company/roadmap-2026-07.md"],
      note: "Enforced today by the marketplace/API surfaces staying feature-flagged off. No automated customer-count gate. GOVERNANCE DEBT (not a hard stop).",
    },
  },

  // ── Rails ──────────────────────────────────────────────────────────────
  {
    id: "rails.byo-not-refront",
    title: "No re-fronting platform send rails",
    statement:
      "Counterparty mail requires the org's own connected identity (BYO); the platform sender is for system mail only.",
    category: "rails",
    source: "CLAUDE.md DO-NOT-DO list; founder decision 2026-07-17",
    enforcement: {
      kind: "code-invariant",
      refs: ["server/services/emailService.ts"],
      note: "emailService purpose lanes separate system mail from counterparty mail. A dedicated ratchet test would strengthen this (GOVERNANCE DEBT).",
    },
  },

  // ── Data planes & AI surface ───────────────────────────────────────────
  {
    id: "data.no-residential-comps-pre-trigger",
    title: "No residential-comps data plane before its revenue trigger",
    statement:
      "The residential-comps data plane does not ship before its revenue trigger; residential verticals stay on the waitlist until then.",
    category: "data-plane",
    source: "CLAUDE.md DO-NOT-DO list; business-types maturity",
    enforcement: {
      kind: "code-invariant",
      refs: ["shared/business-types.ts", "tests/unit/verticalPackPurchasable.test.ts"],
      note: "Residential verticals are maturity:'roadmap' and their packs are unsellable until promoted.",
    },
  },
  {
    id: "ai.pax-stays-ambient",
    title: "Pax stays ambient, never a separate app",
    statement:
      "No new AI destinations — Pax is ambient fabric behind the existing doors, never an app-within-the-app.",
    category: "ai-surface",
    source: "CLAUDE.md DO-NOT-DO list",
    enforcement: {
      kind: "prose-only",
      refs: ["CLAUDE.md"],
      note: "Enforced by the five-door ratchet indirectly (no new top-level entry). No dedicated Pax-surface gate. GOVERNANCE DEBT (not a hard stop).",
    },
  },
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────

export function invariantById(id: string): ConstitutionInvariant | undefined {
  return CONSTITUTION.find((i) => i.id === id);
}

export function hardStops(): ConstitutionInvariant[] {
  return CONSTITUTION.filter((i) => i.category === "hard-stop");
}

/** Invariants with no automated backstop (kind === "prose-only"). */
export function unenforced(): ConstitutionInvariant[] {
  return CONSTITUTION.filter((i) => i.enforcement.kind === "prose-only");
}

/** Hard stops that are not yet machine-enforced — the debt to drive to zero. */
export function unenforcedHardStops(): ConstitutionInvariant[] {
  return hardStops().filter((i) => i.enforcement.kind === "prose-only");
}
