# Pax-Jarvis — Porting the Jarvis Machinery to the Customer

_Design doc, 2026-07-14 (founder-directed). Companion to
`three-level-boundary.md`. The Jarvis stack built for Solene is a PATTERN —
perception → memory → governed action → independent verification → quiet
proactivity → full audit — and the pattern ports to Pax per-org. This is
the product: Jarvis-for-the-customer is what they pay for;
Jarvis-for-Solene is overhead that serves it. Build timing is gated by the
phase ladder (below); this doc exists so the design is decided before the
demand arrives._

## The one-line thesis

Every org gets its own bounded Jarvis: Pax remembers THEIR world, watches
THEIR pipeline, acts within autonomy THEY configure and EARN, is verified
independently, and shows receipts — with the platform's caps, compliance
gates, and disclaimers wrapped permanently around all of it.

## Autonomy = min(customer setting, platform cap, earned trust)

The single most important design decision. A customer's autonomy setting is
a **ceiling request, not a grant**:

- **Customer setting** (per capability, in Settings): Observe → Suggest →
  Act-and-confirm → Autonomous. Defaults to Suggest. One-tap "pause all
  Pax actions" — the customer's own panic stop, same physics as
  SOLENE_PANIC_STOP.
- **Platform cap** (per capability × subscription tier × product
  maturity): the founder-controlled ceiling. Outbound SMS caps at Observe
  until the DNC vendor is live, regardless of settings. Money-touching
  capabilities cap at Act-and-confirm permanently (immutable #6: never
  auto-charge without explicit, recent, easily-revoked consent).
- **Earned trust** (per org × capability): mirrors Solene's ladder —
  clean *verified* cycles promote, flagged verdicts demote, exactly the
  domainAutonomy mechanics keyed (orgId, capability) instead of domain.
  A new org starts at Observe no matter what it configures.

## What ports directly (the machinery already exists)

| Solene machinery (built) | Pax port |
|---|---|
| `successCriteria` + verify dispatches (Phase 1) | Every consequential Pax action carries criteria; an independent verify pass checks the OUTCOME (offer letter matches buy-box, outreach respected caps/compliance, import intact) before dependent steps or trust credit |
| `domainAutonomy` trust ladder + verdict binding (CP3) | Per-(org, capability) trust ledger; promotions need verified clean cycles; bounces demote |
| `founderInterruptArbiter` (2.2) | Per-customer interruption arbiter: their quiet hours (stored prefs already exist), quietest-sufficient-channel (in-app card < Pax nudge < push), digest batching — detection separated from delivery |
| Deal lifecycle events + payment-due detector (2.1) | The per-deal consumers: "this deal needs attention," payment-due nudges — same mesh events, org-scoped consumer |
| Tick metric / "verified: N/M" (CP4) | The customer's weekly Pax receipt: "Pax did N things for you, M verified, you approved K" — the trust-building surface that makes upgrades to higher autonomy feel safe |
| Witnessed taps + hash-chained proof receipts | Act-and-confirm UX: one-screen card, explicit approve, receipt stored; "why did you do that?" answerable in-app from the audit trail |
| Evidence write-back (2.3 pattern) | Org-scoped preference memory: every customer correction/approval becomes an admission-controlled memory in THEIR namespace (existing pgvector store is already org-scoped) — Pax stops re-asking what it's been told |

## The protective wrapper (non-negotiable, exists to protect the founder)

1. **Enablement disclosure + consent ledger.** Raising any capability above
   Suggest requires an explicit in-product acknowledgment (AI acting on
   your instructions; you remain responsible for your business's actions;
   not investment, legal, or tax advice — immutable #12 verbatim), and the
   acceptance is RECORDED: who, what tier, which capability, when,
   disclosure version. The consent ledger is the founder's shield.
2. **Per-action attribution.** Every autonomous/confirmed action is
   labeled in-product: "Pax did X under your [capability] setting Y at
   time Z" — never ambient, never deniable-by-us.
3. **Compliance fail-closed everywhere outbound.** TCPA/DNC/quiet-hours
   gates run inside the action path (they already do for SMS), not as
   advisories. No autonomy tier bypasses a compliance gate — structurally,
   like the hands registry's boot invariants.
4. **Money is special forever.** Spend/charge actions: hard per-action
   caps, act-and-confirm ceiling, explicit revocable consent, idempotency
   keys — the D2 auto-top-up pattern is the template.
5. **No cross-tenant learning on customer data.** Org memories stay in the
   org. Product-level learning uses aggregates or explicit opt-in only
   (immutable #5).
6. **The disclaimers are part of the feature, not legal chrome.** The
   weekly receipt, the attribution labels, and the audit trail ARE the
   product's trust story — the same honesty that makes Solene safe makes
   Pax sellable.

## Packaging (aligns monetization with trust)

- **Copilot** (all tiers): Observe + Suggest — nudges, drafts, "needs
  attention" surfacing. Much of this exists (paxNudges, action prompts).
- **Autopilot** (paid tiers): Act-and-confirm on bounded capabilities
  (outreach drafts→send, import handling, follow-up sequences) — the
  one-screen confirm card is the hero interaction.
- **Autopilot+** (upper tier, per-capability, earned): Autonomous within
  hard caps for capabilities with proven verified track records in THAT
  org. Ships last, after the trust machinery has real history.

## Phase gating (per the constitutional ranking function)

- **Now (Phase 0, pre-revenue):** this doc; keep shipping Copilot-level
  surfaces (nudges/prompts already live). No autonomy build until paying
  users exist to verify against — kill criteria apply.
- **First paying cohort:** act-and-confirm on ONE capability (outreach
  follow-ups is the wedge-aligned candidate), with the consent ledger,
  attribution, and weekly receipt shipped in the same slice.
- **G1 (25 paying):** per-(org, capability) trust ladder live; second and
  third capabilities; the customer arbiter.
- **G2 (100 paying):** Autopilot+ evaluation, capability by capability.

## Revisit triggers

- First customer asks "can Pax just send these for me?" → pull
  act-and-confirm forward.
- DNC vendor keyed → SMS capabilities exit their Observe cap.
- Any autonomy incident → the affected capability demotes platform-wide
  (cap ratchet), post-mortem to evidence files, disclosure version bump.
