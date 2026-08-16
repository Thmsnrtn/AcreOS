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
  // An absolute standing decision — either founder-only forever (pricing,
  // legal signing, >$500 spends, customer-data deletion) or an outright ban
  // (customer money never moves on AcreOS's own account). Either way it MUST
  // end up machine-enforced; the ratchet in constitution.test.ts counts the
  // ones that aren't.
  | "hard-stop"
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
      note: "Two independent enforcements: spendIsAutonomous() is true only for Tier 1 ($0–$500) and the executor hard-stops every non-approved gate status; separately checkHardGuardrails() blocks any actionPayload.amount over HARD_GUARDRAIL_AMOUNT_LIMIT (50_000 cents = $500) before the AI is consulted. HARDENED unit 118: an enforcement audit bypassed the old checkHardGuardrails deny-list with trivially varied strings (execute_agreement, countersign, gdpr_erasure, discount_apply and eleven more — every one returned blocked:false). It now classifies INTENT TOKENS (single-token triggers plus noun+verb pairs in either order, camelCase/underscore-split), erring CLOSED — a false block defers to founder review, a false pass would execute a hard-stop autonomously. hardStopIntentClassifier.test.ts pins the full bypass corpus blocked AND the executor's legitimate universe unblocked, and pins the execution switch's default honest (it used to record success:true for item types with no executor). CORRECTED unit 123, and this note is itself part of the finding: the sentence above named `spendIsAutonomous()` as the first enforcement, and the reachability linter counts a symbol named in a COMMENT as a use — so THIS REGISTRY ENTRY is what kept `spendIsAutonomous` out of the unreached-exports register while it had no production caller at all. It resolved tiers through `tierForAmount`, which the file's own comment called a 'public mirror of the service's private getTier — kept in sync', while the live path (requestSpend -> getTier -> tier.founderApprovalRequired, reached from autonomousDecisionExecutor.ts) used the private copy. spendHardStop.test.ts therefore pinned a function production could not reach. MUTATION-VERIFIED before the fix: one early return in getTier making $0-$2,500 resolve to the autonomous Tier 1 — the exact autonomous $500-$50K regression this hard stop exists to prevent — left that test passing 2/2. The private getTier is now DELETED and its single call site resolves through the one function the test reaches; the $500 boundary is a single exported constant (AUTONOMOUS_SPEND_CEILING_CENTS) serving as Tier 1's ceiling, Tier 2's floor AND the executor's HARD_GUARDRAIL_AMOUNT_LIMIT, which were three independent 50_000 literals. Two independent ENFORCEMENTS of one rule are a safety property; two spellings of one NUMBER are a drift waiting to happen. The test now sweeps ~1,600 amounts across every tier edge instead of nine hand-picked points.",
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
      note: "checkHardGuardrails() blocks BILLING_SUBSCRIPTION_ACTIONS (incl. 'pricing_change') before the AI is consulted, matched against actionType/itemType/category. Prices themselves are static constants, and open pricing questions reach the founder as decision cards. HARDENED unit 118: an enforcement audit bypassed the old checkHardGuardrails deny-list with trivially varied strings (execute_agreement, countersign, gdpr_erasure, discount_apply and eleven more — every one returned blocked:false). It now classifies INTENT TOKENS (single-token triggers plus noun+verb pairs in either order, camelCase/underscore-split), erring CLOSED — a false block defers to founder review, a false pass would execute a hard-stop autonomously. hardStopIntentClassifier.test.ts pins the full bypass corpus blocked AND the executor's legitimate universe unblocked, and pins the execution switch's default honest (it used to record success:true for item types with no executor).",
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
        "refuse-not-fabricate. HARDENED unit 118: an enforcement audit " +
        "bypassed the deny-list with execute_agreement (word order), " +
        "countersign, accept_loi, bind_terms and purchase_agreement_send — " +
        "all blocked:false. checkHardGuardrails now classifies intent tokens " +
        "(singles + noun/verb pairs, order-free), erring closed; " +
        "hardStopIntentClassifier.test.ts pins the bypass corpus blocked and " +
        "the executor's legitimate universe unblocked.",
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
      note: "checkHardGuardrails() blocks DATA_DELETION_ACTIONS (data_deletion, bulk_delete, account_deletion, record_purge, permanent_delete) AND any payload carrying a delete/permanent/purge intent flag, before the AI is consulted. Founder-chat destructive tools additionally carry a kill switch + confirmation. HARDENED unit 118: an enforcement audit bypassed the old checkHardGuardrails deny-list with trivially varied strings (execute_agreement, countersign, gdpr_erasure, discount_apply and eleven more — every one returned blocked:false). It now classifies INTENT TOKENS (single-token triggers plus noun+verb pairs in either order, camelCase/underscore-split), erring CLOSED — a false block defers to founder review, a false pass would execute a hard-stop autonomously. hardStopIntentClassifier.test.ts pins the full bypass corpus blocked AND the executor's legitimate universe unblocked, and pins the execution switch's default honest (it used to record success:true for item types with no executor).",
    },
  },
  {
    id: "hard-stop.no-platform-money-custody",
    title: "Customer money never moves on AcreOS's own account",
    statement:
      "Customer money never moves on AcreOS's own account. Subscription payments TO AcreOS are the only payments AcreOS is a party to. Any customer-managed money movement (borrower note payments, rent, escrow, distributions) runs on the customer's OWN connected processor account or is routed out entirely — no platform-account fallback, no application fee, no funds transiting AcreOS's balance.",
    category: "hard-stop",
    source:
      'CLAUDE.md DO-NOT-DO list; founder ruling 2026-07-29 ("be the rail, not the provider")',
    enforcement: {
      kind: "code-invariant",
      refs: [
        "server/services/customerMoneyRouting.ts",
        "server/services/achMandateSetup.ts",
        "server/services/achAutopay.ts",
        "tests/unit/moneyCustodyHardStop.test.ts",
      ],
      note:
        "Three layers. (1) RUNTIME CHOKEPOINT: prepareCustomerMoneyCall() is " +
        "the only sanctioned way to build a customer-money Stripe call — it " +
        "sets the org's own `stripeAccount` scope and throws " +
        "PlatformTakeError if the params carry application_fee_amount / " +
        "application_fee_percent / transfer_data / on_behalf_of at ANY depth, " +
        "and UnscopedCustomerMoneyCallError when there is no org account to " +
        "scope to. resolveOrgCardProcessor() refuses with a typed reason " +
        "instead of falling back to the platform account; the ACH lane " +
        "(achMandateSetup / achAutopay) does the same for us_bank_account on " +
        "the lender's own connected account. (2) STRUCTURAL RATCHET: " +
        "moneyCustodyHardStop.test.ts asserts those platform-take parameter " +
        "names appear NOWHERE in server/, shared/ or client/src/ except " +
        "inside the guard that forbids them, that no HTTP route names raw " +
        "bank routing/account numbers, and that the deleted custody surfaces " +
        "(transactionFeeService, /api/transaction-fees, /fee-dashboard, the " +
        "platform-merchant /api/actum/* routes) stay deleted. (3) The " +
        "no-fabrication scan in the same test forbids simulated processor " +
        "identifiers in money fields — the retired escrow engine wrote " +
        "`tr_simulated_<ts>` into a transfer-id column.",
    },
  },

  {
    id: "hard-stop.ads-founder-only-rail",
    title: "Paid advertising is a founder instrument, never a customer feature",
    statement:
      "Meta ads run on AcreOS's OWN ad account, spending AcreOS's own money on AcreOS's own advertising, and only the founder may reach them. No customer-facing path to paid advertising exists; if an org is ever to advertise, it runs on the org's OWN connected ad account, exactly as customer money movement must.",
    category: "hard-stop",
    source:
      'Founder ruling 2026-08-13 (BLOCKERS B11): "this was meant for me as the founder to run ads for this AcreOS only. Never for a customer to be able to run their own ads." Resolves the question left open by the 2026-07-29 "be the rail, not the provider" ruling.',
    enforcement: {
      kind: "ratchet-test",
      refs: [
        "server/routes-elite-features.ts",
        "server/middleware/metaWebhookSignature.ts",
        "tests/unit/metaAdsFounderOnly.test.ts",
        "tests/unit/adSpendAuthority.test.ts",
      ],
      note:
        "The platform ad account is the MIRROR IMAGE of the ACTUM case, not an " +
        "exception to it: one platform ACTUM_MERCHANT_ID for all orgs meant " +
        "CUSTOMER money moving on AcreOS's account, which is banned; one " +
        "platform META_AD_ACCOUNT_ID spending ACREOS's money on AcreOS's own " +
        "advertising is AcreOS being its own customer, which is fine. The only " +
        "thing keeping them apart is that no customer path exists, so that is " +
        "what is asserted: every /api/founder/meta-ads/* route carries " +
        "requireFounder (creation, catalog sync AND stats reads — stats had no " +
        "gate until this ruling), no client bundle calls them, the $500/day " +
        "ceiling survives in code because the hard-stop is about the AMOUNT not " +
        "the caller, `ads` stays a simulated category so a dev or CI boot with " +
        "the env vars present cannot buy real advertising, and the public lead " +
        "webhook verifies its signature fail-closed.",
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
      refs: [
        "scripts/check-no-fabrication.mjs",
        "scripts/no-fabrication.allowlist.json",
        "tests/unit/noFabricationScope.test.ts",
      ],
      note:
        "SCOPE, stated because this entry used to imply more than the gate " +
        "delivered. The lint enumerates `Math.random` across the server " +
        "fact-producing paths AND, since 2026-08-13, client/src/** — the " +
        "rendering layer, which its own rationale named (\"we are lying with " +
        "a confident UI\") while scanning only the server. Every hit is " +
        "annotated in the allowlist; a new one fails the build and a fixed " +
        "one goes stale and also fails, so the register only shrinks. " +
        "WHAT IT DOES NOT CATCH: a hardcoded plausible constant. `Math.random` " +
        "is one way to invent a number and the only one a token scan can see; " +
        "refuse-not-fabricate is still a judgement the reviewer makes.",
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
      kind: "ratchet-test",
      refs: [
        "tests/unit/expansionLadder.test.ts",
        "server/middleware/featureGate.ts",
        "docs/company/roadmap-2026-07.md",
      ],
      note:
        "Was prose-only, and the note claimed both surfaces were simply " +
        "'feature-flagged off'. Half true: the public API is genuinely " +
        "unmounted (registerPublicApiV1 has no caller), but the marketplace sat " +
        "behind featureGate, whose enterprise-tier bypass let a SUBSCRIPTION " +
        "TIER override the ladder and whose flag-store catch failed OPEN. It " +
        "now uses requireLadderFlag: founder bypass kept, tier bypass dropped, " +
        "fails closed. No automated customer-count gate exists — the ratchet " +
        "instead fails the moment either surface is switched on, and says to " +
        "confirm the threshold and change the assertion deliberately. " +
        "STRENGTHENED 2026-08-15: the API assertions were NAME-based " +
        "(registerPublicApiV1, /api/v1) and a SECOND public-API surface existed " +
        "under a different name — routes-epic-services.ts's /developer/* block, " +
        "mounted at /api behind plain isAuthenticated, minting `acr_…` keys for " +
        "any customer and serving a spec titled 'AcreOS Public API', while " +
        "routes-api-keys.ts stayed dormant for this same ladder. The decision " +
        "was enforced in one place and defeated in another. The keys were also " +
        "INERT (nothing verified provider='api_key'), so the response's 'store " +
        "this key securely' was a promise the product could not keep. Founder " +
        "ruling (picker): the three endpoints are removed, developerApiService.ts " +
        "is KEPT as a staged seam. The assertions are now SHAPE-based — no " +
        "mounted route may mint an API key outside a founder gate, and none may " +
        "serve the spec — so a third surface under a third name trips them too.",
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
      refs: [
        "server/services/emailService.ts",
        "tests/unit/emailPurposeEnforcement.test.ts",
      ],
      note:
        "emailService purpose lanes separate system mail from counterparty " +
        "mail. CORRECTED 2026-08-16: this entry claimed `code-invariant` — " +
        "which this file defines as \"enforced structurally in code + covered " +
        "by a test\" — while naming ONLY the implementation, and its own note " +
        "said a ratchet test 'would strengthen this (GOVERNANCE DEBT)'. That " +
        "note was stale: emailPurposeEnforcement.test.ts (founder decision " +
        "2026-07-17) already pins the two-lane contract — purpose " +
        "'counterparty' with no org identity refuses honestly and the SES " +
        "client is NEVER constructed, no silent @acreos.io fallback, while " +
        "BYO creds and a verified sending domain both pass. The enforcement " +
        "existed and the registry did not know it. Nothing was downgraded and " +
        "no debt counter moved; the pointer was corrected to name the test " +
        "that was already running.",
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
      refs: [
        "scripts/check-residential-comps-hold.mjs",
        "tests/unit/residentialCompsHold.test.ts",
        "shared/business-types.ts",
        "tests/unit/verticalPackPurchasable.test.ts",
      ],
      note:
        "The hard-stop bars building a dedicated residential-comps data PLANE (bulk ingest, dedicated vendors, new tables) — it does not bar routing residential lookups through the EXISTING provider registry. Ruling #11 wave V3 (2026-07-29) promoted residential verticals by routing comps/valuation via the registry's ATTOM seam (pay-per-call/BYOK, honest unkeyed degradation, server/services/residentialComps.ts); no plane was built and none ships before the revenue trigger. " +
        "CORRECTED 2026-08-16: this entry claimed code-invariant while naming ONLY business-types.ts and verticalPackPurchasable.test.ts, which govern whether a residential vertical PACK is PURCHASABLE. Neither can see a data plane being built — the label said code-invariant and the code enforced an adjacent thing. check-residential-comps-hold.mjs (wired into `npm run check`) is the actual backstop: five rules over dedicated vendors, a comps corpus caught by SHAPE as well as name, bulk-ingest residential filters, and the integrity of the sanctioned seam itself. It must pass at zero, so residentialCompsHold.test.ts drives the real script against synthetic repos and proves each predicate still fires — a preventative gate whose only evidence is a green run is indistinguishable from one that matches nothing.",
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
      kind: "ratchet-test",
      refs: [
        "tests/unit/paxStaysAmbient.test.ts",
        "client/src/lib/sidebar-hidden-routes.ts",
        "shared/feature-freeze.ts",
        "CLAUDE.md",
      ],
      note:
        "Was prose-only, backed only by the five-door ratchet INDIRECTLY. That " +
        "ratchet governs the NAV, so a second AI destination reached by a link " +
        "or a typed URL — never appearing in the sidebar — passed it untouched " +
        "while being exactly the app-within-the-app this forbids. Now asserted " +
        "directly: /ai is the one destination that renders, every other " +
        "AI-named customer route must redirect INTO it, and /ai must stay a " +
        "protected door. The check matches on the RENDERED COMPONENT as well " +
        "as the path, which is what found /negotiation — a 607-line standalone " +
        "copilot at a top-level route that no path-name scan sees, in no nav " +
        "module, linked from nowhere. It carries a deletion-ledger KILL " +
        "verdict and is hard-denied by shared/feature-freeze.ts, so the rule " +
        "holds today BY THE FREEZE rather than by absence; unfreezing it fails " +
        "the ratchet. The founder plane is deliberately out of scope — it has " +
        "its own four-doors rule and an explicit admin namespace.",
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
