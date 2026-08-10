/**
 * The public provable-claims registry (G1.4) — every marketing/governance
 * claim AcreOS makes in public, paired with the code, test, lint, or CI gate
 * that actually enforces it TODAY.
 *
 * THE RULE: a claim may only appear here if an automated enforcement already
 * exists — a row is {claim, enforcement pointers}, and
 * tests/unit/marketingClaims.test.ts fails CI when any pointer stops
 * resolving on disk. There is deliberately NO way to register an aspirational
 * claim: rows either derive from shared/governance/constitution.ts entries
 * that are machine-enforced (prose-only invariants are structurally dropped,
 * and the test pins the drop list empty), or they are curated rows whose
 * pointers name real ratchets/lints/CI audits.
 *
 * Rendered publicly as the "Proof" section of /transparency
 * (client/src/pages/transparency.tsx). This module is browser-safe pure data:
 * no process.env, no node imports — the on-disk pointer resolution lives in
 * the test, never in the page.
 *
 * This registry does not CREATE claims — the landing copy and the
 * constitution are the sources; this file mirrors the enforced subset into a
 * renderable, checkable form. To change a claim, change it at its source.
 */

import {
  invariantById,
  type ConstitutionInvariant,
  type EnforcementKind,
} from "./constitution";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * "ci-audit" extends the constitution's enforcement kinds for claims whose
 * gate is a CI script rather than a vitest ratchet (the truth-engine audit).
 */
export type ProofEnforcementKind = EnforcementKind | "ci-audit";

export type ProofCategory =
  | "money" // where customer money can and cannot move
  | "governance" // founder-only hard stops on the autopilot
  | "honesty" // no-fabrication, audited copy, labeled sample data
  | "pricing" // pricing/limits copy vs. the enforced cap tables
  | "product"; // structural product promises (doors, rails)

export interface ProofEnforcement {
  kind: ProofEnforcementKind;
  /** Repo-relative paths — every one must resolve on disk (test-pinned). */
  refs: string[];
  note?: string;
}

export interface PublicProofClaim {
  /** Stable kebab/dotted id — never reused. */
  id: string;
  /** Short human title for the row. */
  title: string;
  /** The public claim itself, plain language. */
  claim: string;
  category: ProofCategory;
  enforcement: ProofEnforcement;
  /** Set when the row mirrors a constitution invariant (claim = statement verbatim). */
  constitutionId?: string;
  /**
   * Set when the claim text must ALSO appear verbatim in the truth-engine
   * audit (scripts/audit-public-claims.ts) — test-pinned.
   */
  auditedVerbatim?: boolean;
}

// ---------------------------------------------------------------------------
// Rows derived from the constitution — machine-enforced invariants only.
//
// The subset below is the public-meaningful slice of the constitution (the
// customer-facing promises). Internal-only doctrine (founder nav shape,
// expansion-ladder timing, data-plane sequencing) stays out of the public
// surface even where enforced. A listed id that is missing or prose-only is
// DROPPED (never rendered unenforced) and recorded in
// DROPPED_CONSTITUTION_PROOF_IDS, which marketingClaims.test.ts pins to [] —
// quiet in prod, loud in CI.
// ---------------------------------------------------------------------------

const CONSTITUTION_PROOF_ROWS: ReadonlyArray<{
  constitutionId: string;
  category: ProofCategory;
}> = [
  { constitutionId: "hard-stop.no-platform-money-custody", category: "money" },
  { constitutionId: "hard-stop.customer-data-deletion", category: "governance" },
  { constitutionId: "hard-stop.pricing-changes", category: "pricing" },
  { constitutionId: "hard-stop.legal-signing", category: "governance" },
  { constitutionId: "hard-stop.spend-over-500", category: "governance" },
  { constitutionId: "hard-stop.self-patch-never-merges", category: "governance" },
  { constitutionId: "truth.no-fabrication", category: "honesty" },
  { constitutionId: "nav.customer-five-doors", category: "product" },
  { constitutionId: "nav.customer-doors-never-hidden", category: "product" },
  { constitutionId: "rails.byo-not-refront", category: "product" },
];

export const DROPPED_CONSTITUTION_PROOF_IDS: string[] = [];

function constitutionRows(): PublicProofClaim[] {
  const rows: PublicProofClaim[] = [];
  for (const { constitutionId, category } of CONSTITUTION_PROOF_ROWS) {
    const inv: ConstitutionInvariant | undefined = invariantById(constitutionId);
    // Refuse, don't fabricate: an unenforced (or vanished) invariant renders
    // NOTHING — the claim disappears from the public page rather than appear
    // without its backstop. The test pins the drop list empty so this can
    // never happen silently in CI.
    if (!inv || inv.enforcement.kind === "prose-only") {
      DROPPED_CONSTITUTION_PROOF_IDS.push(constitutionId);
      continue;
    }
    rows.push({
      id: `constitution.${inv.id}`,
      title: inv.title,
      // Statement verbatim — the registry invents no prose for recorded
      // decisions.
      claim: inv.statement,
      category,
      enforcement: {
        kind: inv.enforcement.kind,
        // Refs come from the constitution row itself, never hand-copied —
        // constitution.test.ts and marketingClaims.test.ts both pin that
        // they resolve.
        refs: [...inv.enforcement.refs],
        note: inv.enforcement.note,
      },
      constitutionId: inv.id,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Curated rows — marketing-copy claims whose enforcement is a named ratchet,
// lint, or CI audit. Every pointer is a real file (test-pinned); every claim
// is scoped to exactly what the pointer proves.
// ---------------------------------------------------------------------------

/**
 * The hero wedge sentence — the landing page's one consolidation claim.
 * Kept verbatim-synced three ways: this string ↔ LANDING_COPY.hero.wedge
 * (marketingClaims.test.ts) ↔ scripts/audit-public-claims.ts
 * (landingReposition.test.ts + marketingClaims.test.ts).
 */
export const WEDGE_SENTENCE =
  "One platform that finds the deals, sends the mail, drafts the replies, closes the deal, and services the note after.";

const CURATED_ROWS: PublicProofClaim[] = [
  {
    id: "copy.hero-wedge-audited",
    title: "The headline claim is audited against named sources",
    claim: WEDGE_SENTENCE,
    category: "honesty",
    enforcement: {
      kind: "ci-audit",
      refs: [
        "scripts/audit-public-claims.ts",
        "tests/unit/landingReposition.test.ts",
        ".github/workflows/ci.yml",
      ],
      note: "The truth-engine audit runs in CI and fails the build when this sentence loses a source; landingReposition.test.ts pins the copy ↔ audit sync verbatim.",
    },
    auditedVerbatim: true,
  },
  {
    id: "copy.landing-claims-ci-audited",
    title: "Landing claims pass a truth-engine audit in CI",
    claim:
      "Every numeric, capability, or comparison claim registered from the landing page is string-verified against a named source by a truth-engine audit on every CI run — an unverifiable claim fails the build.",
    category: "honesty",
    enforcement: {
      kind: "ci-audit",
      refs: [
        "scripts/audit-public-claims.ts",
        "server/services/truth-engine/index.ts",
        ".github/workflows/ci.yml",
      ],
      note: "Scope: the claims registered in scripts/audit-public-claims.ts (its stated contract is that the list updates in the same commit as the copy).",
    },
  },
  {
    id: "copy.vertical-pages-derive-from-registry",
    title: "Vertical marketing pages derive from the live product registry",
    claim:
      "The landing page's investor-type labels and every /for/<vertical> page render from the live business-type registry — a registry change flows to the public pages automatically, so no page can promise a vertical the product no longer registers.",
    category: "honesty",
    enforcement: {
      kind: "ratchet-test",
      refs: [
        "tests/unit/landingVerticalTiers.test.ts",
        "tests/unit/forVerticalRoutes.test.ts",
        "client/src/pages/landing/Positioning.tsx",
        "client/src/pages/for/derive.ts",
        "shared/business-types.ts",
      ],
    },
  },
  {
    id: "pricing.numbers-derive-from-cap-tables",
    title: "Public pricing numbers come from the enforced cap tables",
    claim:
      "The prices, seat lines, and tier limits shown on the public pricing surfaces are imported from the same tier-pricing and tier-limit modules the server enforces — a price or limit change flows to the public copy automatically.",
    category: "pricing",
    enforcement: {
      kind: "code-invariant",
      refs: [
        "client/src/lib/pricing-copy.ts",
        "shared/billing/tier-limits.ts",
        "shared/billing/tier-pricing.ts",
        "tests/unit/marketingClaims.test.ts",
      ],
      note: "pricing-copy.ts imports its numbers from the shared billing modules by construction; marketingClaims.test.ts additionally checks the hand-written bullets against the cap table.",
    },
  },
  {
    id: "pricing.no-unlimited-where-capped",
    title: '"Unlimited" is never claimed where a cap exists in code',
    claim:
      'No public surface says "unlimited" for a resource the code actually caps — the check derives its cap set from the live tier-limit table, so a new cap retroactively fails any stale "unlimited" claim.',
    category: "pricing",
    enforcement: {
      kind: "ratchet-test",
      refs: [
        "tests/unit/marketingClaims.test.ts",
        "shared/billing/tier-limits.ts",
        "server/routes-outreach-mail.ts",
      ],
    },
  },
  {
    id: "pricing.free-five-letters-real-cap",
    title: "The free tier's five letters are a real, enforced cap",
    claim:
      "The free plan's five mailed letters are a lifetime cap enforced on the mail queue route itself — and the pricing page's number is test-pinned to that enforced constant, so the two cannot drift.",
    category: "pricing",
    enforcement: {
      kind: "code-invariant",
      refs: [
        "server/routes-outreach-mail.ts",
        "tests/unit/freeTierFirstSend.test.ts",
      ],
    },
  },
  // ── Continuity (master-handoff O7 / P5 §6) ────────────────────────────────
  // "What happens if the founder is hit by a bus" is a sales objection for a
  // one-person platform. These three rows are the only part of the answer that
  // is ENFORCED today; the rest of the continuity statement on /transparency
  // is derived state (how complete the kit is), test-pinned to the kit itself
  // rather than claimed here. Nothing about a deputy's existence is claimed —
  // there isn't one, and the page says so.
  {
    id: "continuity.hard-stops-stay-founder-only",
    title: "No absence hands anyone the founder-only hard stops",
    claim:
      "The founder-only hard stops — pricing changes, legal signing, spends over $500, and destructive customer-data deletion — cannot be delegated to a deputy or to anyone else, including during an absence: the continuity kit derives its non-delegable list from the same constitution registry the runtime enforces, and any proposed deputy permission naming one of those hard stops is refused by that module rather than granted.",
    category: "governance",
    enforcement: {
      kind: "ratchet-test",
      refs: [
        "shared/governance/constitution.ts",
        "server/services/continuityKit.ts",
        "tests/unit/continuityKit.test.ts",
        "tests/unit/founderHardStopGuardrails.test.ts",
      ],
      note: "Scope: the delegation path. The hard stops' own runtime enforcement is founderHardStopGuardrails.test.ts; continuityKit.test.ts additionally proves a permission naming a hard stop is refused, using a planted fixture permission.",
    },
  },
  {
    id: "continuity.kit-state-derived",
    title: "Our continuity plan's state is derived, never asserted",
    claim:
      "Every piece of our founder-absence kit — a named deputy, a way to reach them, their written authority, credential custody, the outage card, the absence runbook, the panic-stop instructions — resolves from real evidence: a file that must exist, or a declaration whose placeholder value reads as missing. A piece that does not exist renders as missing rather than as a check mark, and the continuity statement on this page is test-pinned to that derived state.",
    category: "honesty",
    enforcement: {
      kind: "ratchet-test",
      refs: [
        "docs/runbooks/deputy-break-glass-kit.md",
        "server/services/continuityKit.ts",
        "client/src/pages/transparency.tsx",
        "tests/unit/continuityKit.test.ts",
      ],
    },
  },
  {
    id: "continuity.kit-review-ratchet",
    title: "The continuity kit expires on a fixed interval",
    claim:
      "The kit declares a 100-day review interval. Once a review is recorded, our build fails when the newest recorded review ages past that interval, and the founder's own surface shows the kit as stale instead of green — a kit nobody has re-read cannot quietly keep counting as current.",
    category: "honesty",
    enforcement: {
      kind: "ratchet-test",
      refs: [
        "docs/runbooks/deputy-break-glass-kit.md",
        "server/services/continuityKit.ts",
        "client/src/pages/founder/autopilot-control.tsx",
        "tests/unit/continuityKit.test.ts",
      ],
      note: "Honest scope: no review has been recorded yet, so the ratchet is dormant — the kit's ledger must keep saying so, and the kit can never render ready while unreviewed.",
    },
  },
  {
    id: "honesty.demo-read-only-sample-data",
    title: "The public demo is read-only, on labeled sample data",
    claim:
      "The live demo workspace is read-only (every mutating request is refused before any route runs), serves only clearly labeled sample fixtures, and those sample-marked rows are exactly the ones the activation recorder refuses — demo browsing cannot pollute our activation metrics.",
    category: "honesty",
    enforcement: {
      kind: "code-invariant",
      refs: [
        "server/routes-demo.ts",
        "tests/unit/demoOrg.test.ts",
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// The registry + helpers
// ---------------------------------------------------------------------------

export const PUBLIC_PROOF_CLAIMS: readonly PublicProofClaim[] = [
  ...constitutionRows(),
  ...CURATED_ROWS,
];

export const PROOF_CATEGORY_LABELS: Record<ProofCategory, string> = {
  money: "Your money",
  governance: "AI governance",
  honesty: "Honest marketing",
  pricing: "Pricing & limits",
  product: "Product structure",
};

/** Render order for the /transparency proof section. */
export const PROOF_CATEGORY_ORDER: readonly ProofCategory[] = [
  "money",
  "honesty",
  "pricing",
  "governance",
  "product",
];

export const PROOF_KIND_LABELS: Record<ProofEnforcementKind, string> = {
  "code-invariant": "enforced in code",
  "ratchet-test": "ratchet test",
  lint: "lint gate",
  "ci-audit": "CI audit",
  "prose-only": "recorded only", // unreachable for rendered rows; kept for type totality
};

export function proofClaimsByCategory(): Array<{
  category: ProofCategory;
  label: string;
  claims: PublicProofClaim[];
}> {
  return PROOF_CATEGORY_ORDER.map((category) => ({
    category,
    label: PROOF_CATEGORY_LABELS[category],
    claims: PUBLIC_PROOF_CLAIMS.filter((c) => c.category === category),
  })).filter((g) => g.claims.length > 0);
}

export function proofClaimById(id: string): PublicProofClaim | undefined {
  return PUBLIC_PROOF_CLAIMS.find((c) => c.id === id);
}
