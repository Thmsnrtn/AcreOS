# The Foundry Decision — 30-Profession Audit Synthesis

**Date:** 2026-06-24 · **Method:** 30-discipline panel (grounded in the actual AcreOS + Foundry repos) + synthesis. **Status:** DECISION.

## Verdict in one line
**Your asset thesis is RIGHT. Your proposed action (strip AcreOS, rebuild on Foundry, build Foundry to operate everything) is the TRAP — and the evidence is already in your own repos.**

## Why the thesis is sound
The durable, defensible asset *is* the governed **body** (gate stack, witnessed-send, fail-closed money, corrigibility code-gate, reward hygiene, audit chain), and the **kernel/domain-pack seam is real** — verified across lenses: `policyGate`/`domainAutonomy`/`escalation`/`safety`/`operator`/`worldModel` carry **zero** land vocabulary; `immutables.json` already splits `sovereignPrinciples` (kernel) from `customerImmutables` (pack). Intelligence commoditizes; provable governed restraint does not. The destination — **kernel + thin domain packs** — is correct.

## Why the *action* is the trap (three facts, the first is yours)
1. **Foundry already exists** — ~94k LOC, ~104 migrations, a 12-agent advisory product, **frozen since 2026-05-08, $0 revenue, never launched.** It is the **ghost of the last strip-and-rebuild**: you ran this exact experiment, took it to 94k LOC + a convergence audit, and it produced a beautifully-audited *dormant* repo and zero customers. It's also a **weaker, divergent thesis** (advisory Gate-0-4, confidence-threshold gates, *no* witnessed-send / corrigibility / causal ledger). "Build Foundry to operate AcreOS" = starting a **third** architecture and regressing your best asset onto an older trunk.
2. **The kernel is single-tenant by construction** (acts at `orgId=null`, one budget cap, one deadman, one pager). The hard, defensible, *unbuilt* 20% — multi-tenant isolation, per-tenant blast-radius, oversight-when-nobody's-watching — **cannot be designed in advance. It is DISCOVERED from a real body running real irreversible actions under load.**
3. **The brain isn't proven** — the loop has never refined a causal edge from real consequence; $0 MRR. **The loop hasn't multiplied by 1.** You can't 100x a base of $0.

> The kernel is real, the boundary is real, the destination is right — which is *exactly* why it's dangerous. A worse idea wouldn't be tempting enough to derail you. You named the fear (ship-happy, procrastinating). The architecture confirms it's justified.

## The 100x, honestly
- **Real as a back-loaded *option*, seductive as a forward-loaded *bet*.** `100 × $0 = $0`. Establish the 1x first.
- **The inversion:** the reusable kernel is the *commoditizing* part (everyone's building gate stacks; LangGraph/CrewAI/Vertex/Agentforce chase the control plane with far more capital). The *value* lives in the non-reusable part — the land-native brain, the per-vertical trust earned, the regulatory envelope. Causal *discovery* doesn't transport across domains; only specific effects do, conditionally. Body transfers ~80-90%; the value-creating brain ~10-20%. Distribution doesn't abstract — each vertical needs its own GTM.
- **The version that IS big:** NOT "operate 100 businesses" (that concentrates N businesses' worst autonomous action onto one balance sheet — an *accumulation-risk machine*). It's **provably-governed autonomy sold as infrastructure** — bill the one capability competitors can't replicate (a tamper-evident, cause-allocable, per-action proof-receipt), and the accreting moat is the **cross-vertical, witnessed loss-and-outcome dataset** the running kernel emits as a byproduct (what insurers/regulators pay to manufacture from the outside while you'd own the runtime). Honest sizing: **~3-10x leverage on the cost of building vertical N + normal vertical-SaaS scaling** — meaningfully bigger than land-SaaS alone, not the naive 100x.

## The sequencing (unanimous): EXTRACT-THE-KERNEL-INCREMENTALLY-IN-PLACE
Not strip-and-rebuild (the trap, with a confirmed prior on disk). Not resurrect frozen-Foundry (a divergent, rotting second system). **Carve a `packages/kernel` workspace INSIDE the AcreOS monorepo**, behind a typed `DomainPack` interface, with land re-expressed as `packs/land/` and a **CI ratchet: `kernel/` may not import `packs/land/`** (same discipline as the truth-immutable + four-door ratchets). AcreOS runs the same code in prod, all existing tests keep gating it, the seam becomes **compiler-enforced, not a vision doc.** *The kernel extracts itself by being written domain-agnostically in the system that already has load.*

**Incremental is a correctness constraint, not a preference:** a governance kernel's only credential is having *held under real consequence* (the broadcast-laundering and un-witnessed-money holes were FOUND, not foreseen). Strip-and-rebuild forces you to invent the hardest box — the tenant boundary, the invariant set, the autonomy currency — blind.

## The milestone that earns the right to platformize (precise)
1. **AcreOS reaches first real revenue AND the loop closes once** — `operator.ts` wired into the live gated loop, a full sense→decide→act→measure→learn cycle, ≥1 causal edge visibly moving from prior to evidence, and a **per-tenant contribution-margin number off a real ledger.** *That number is the 100x's base; it converts the option in-the-money.*
2. **A second, deliberately-foreign (non-real-estate) pack runs on the UNCHANGED kernel** — first a cheap 2-day in-repo smoke test (a 5-variable toy pack + a model-swap test, founder NOT in the loop); funded as a vertical only if a real buyer pulls. **Platformize on the second pack, never the first.**

## What Foundry actually IS (when it's earned)
A **trust utility** selling **provably-governed autonomy machinery where the customer remains the legal principal/deployer** — NOT "we operate your business" (the verb "operate" recharacterizes you as deployer-of-record for N principals across N regulatory regimes — legally fatal). Billing = the kernel/pack seam = platform floor (governance control-plane) + per-witnessed-governed-action usage + earned-autonomy as the expansion axis. GTM wedge = the oversight/insurability substrate in the **reversible/witnessable trust-band** where land already sits (illiquid-asset, document-heavy, single-owner-of-record) — never lending/health/securities/money-transmission. Category = **"governed/witnessed autonomy."** Moat = the witnessed cross-vertical outcome/loss dataset (a *consequence* of distribution, never a prerequisite).

## The path that doesn't halt AcreOS (every move makes AcreOS better TODAY)
1. **Carve `packages/kernel` in-repo** + the `kernel`-can't-import-`packs/land` CI ratchet. (Pure refactor; tests keep gating; AcreOS gets cleaner; the seam becomes compiler-enforced.)
2. **Thread `TenantScope` everywhere NOW** (`orgId:number|null` → a required typed scope through gates/hands/budget/audit/ledgers; `orgId=null` for an outward action = hard error). Single-tenant today, but ruinous to retrofit onto a populated global ledger; closes the witnessed-send laundering surface further.
3. **Upgrade witnessed-send → a principal-attributed proof-receipt** (`{payloadHash, specVersion, gateResults, evalScore, cost, autonomyLevel, situationHash, accountable_human_id, constitution_version_hash, Art.50 disclosure}` + a ~150-line standalone `verifyReceipt()`). One build, four payoffs (legal shield · trust product · insurer artifact · multi-tenant primitive).
4. **Wire the loop + close it once** + stand up the per-tenant margin ledger + prompt-caching. The milestone that makes the 100x base real — pure AcreOS revenue work.
5. **Make governance visible + exportable** — render the causal ledger + gate trace as a per-tenant, hash-chained (EU AI Act Art.12-shaped) "governance evidence packet." AcreOS's own founder-trust UI *and* Foundry's literal sellable product.
6. **Paper + doors, zero headcount** — form a single-member LLC (assign both repos), keep repos private/trade-secret, generalize `claimsGate` into a per-pack regulatory profile, write (don't sign) a skeleton customer-as-deployer MSA, write the kernel↔pack contract + vertical-eligibility rubric as one-page specs, **freeze `foundry/` with a one-line MEMORY decision.**

**Explicitly DO NOT now:** stand up a multi-tenant runtime · port AcreOS onto Foundry · resurrect/extend `foundry/` · build a second *live* pack · write a meta-platform landing page · build revenue-share/attribution billing · onboard any tenant you don't own. All are post-revenue, post-second-pack — and all are the procrastination surface.

## The one move
**Carve `packages/kernel` this week + wire `operator.ts` into the live gated loop + close the autopilot loop once toward AcreOS's first paying customer.** Makes AcreOS the live proof the kernel survives a real boundary, produces the only Foundry artifact that matters (the seam as compiler-enforced types), advances AcreOS to revenue, and converts the 100x option in-the-money — with zero second codebase and zero halted hour.

## Team: hire nothing until revenue
13 AI personas are a thinking aid + a product surface, **not a company.** When the loop closes and a second vertical pulls: forward-deployed/solutions engineer first (packs don't onboard themselves) → an applied-safety/eval owner (the *named human on the kill-switch*) the moment you act over a business you don't own → a platform engineer who owns the seam as an API. The true 100x unlock is whether a *non-founder* can author a pack in 1-2 weeks; until proven once, Foundry is a consultancy with good tooling (3-5x), not a platform.

## The closing truth
The generational move and the founder trap are the *same set of code*; only the **sequencing** tells them apart. Ship the vertical. Keep the seam. Let the platform be the **reward for winning, never the strategy for avoiding the win. Fund the base before you fund the multiplier.**
