# The Kernel ↔ Domain-Pack Contract

**Status:** living spec · **Established:** 2026-06-24 (Foundry move #1–#6) · **Enforced by:** `scripts/check-kernel-boundary.mjs`

This is the one-page contract for the seam the Foundry decision rests on: a domain-agnostic **kernel** (the reusable governed-autonomy body) + thin **domain packs** (one per vertical). It is descriptive of what exists today AND prescriptive for the second pack.

## The rule (compiler/CI-enforced)

> **The kernel may not import any domain pack.** Packs depend on the kernel; never the reverse.

Enforced by the `lint:kernel-boundary` ratchet: every module in `KERNEL_MANIFEST` is scanned; importing anything under `server/services/autopilot/packs/` (K1) or any legacy land module (K2) fails the build. Baseline 0; tightens only. A module that *composes* kernel + a specific pack (e.g. `cognitionContext.ts`, `governance/evidencePacket.ts`) is deliberately **not** kernel — it sits above the seam.

## What the KERNEL provides (domain-agnostic, inherited unchanged)

- **The gate stack** — `policyGate` (compliance → quality → budget → autonomy → witnessed-send), `domainAutonomy` (earned-autonomy Trust Ladder), `riskautonomy`, `safety`, `escalation`/`escalationLadder`.
- **The causal world-model machinery** — `worldModel` (`queryIntervention`, `summarizeModel`, `predictMoveEffect`, `refineModel` — edge-confidence learning).
- **Accountability primitives** — `tenantScope` (the typed `platform | {org}` scope), `proofReceipt` (tamper-evident, principal-attributed, constitution-anchored).
- **Cognition** — `operator`, `reasoning`, `deliberate`, `memory`, `forecast`, `decisionEval`, `experienceLog`, `policyInducer`, `economics` (incl. `marginAllowsRamp`), `settings`.

## What a DOMAIN PACK supplies (the `DomainPack` interface)

A pack is a single typed object (`server/services/autopilot/domainPack.ts`) the kernel consumes:

| Field | Meaning | Land pack (`packs/land/`) |
|---|---|---|
| `id` / `label` | stable identity | `"land"` / `"Land acquisition"` |
| `causalModel` | the vertical's variables + causal edges (priors → refined from witnessed history) | `ACREOS_SEED_MODEL` |
| `moveToLever` | maps a decide.ts move-kind → the causal lever it pulls | `LAND_MOVE_TO_LEVER` |
| `regulatoryProfile` *(move #6)* | the per-pack claims/solicitation rules the kernel claims-engine screens against | `LAND_REGULATORY_PROFILE` |

A pack also contributes pure helpers that bridge kernel data to its ontology (e.g. `landEvidenceByLever` — routing witnessed move outcomes to causal levers).

## The discipline for a SECOND pack (the platformize milestone)

1. The second pack is **deliberately foreign** (non-real-estate) and must run on the **UNCHANGED** kernel — first a cheap in-repo smoke test (a ~5-variable toy `causalModel` + a `regulatoryProfile`), founder NOT in the loop.
2. If the kernel needs *any* edit to host it, that edit belongs in the kernel as a generalization — never a pack reaching back across the seam.
3. Platformize on the **second** pack, never the first. Until a non-founder can author a pack in 1–2 weeks, Foundry is a consultancy with good tooling, not a platform.

## Trust-band eligibility (which verticals a pack may serve)

See `vertical-eligibility-rubric.md`. In short: only **reversible/witnessable, illiquid-asset, document-heavy, single-owner-of-record** domains (where land already sits). Never lending / health / securities / money-transmission.
