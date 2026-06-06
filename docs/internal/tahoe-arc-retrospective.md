# Tahoe Execution Arc — Waves H3–H6 Retrospective

_Authored 2026-06-06 (Solene). Covers the Wave H3→H6 execution arc per Tom's
2026-06-06 mandate: "work through wave H3 and any remaining waves after that
exhaustively." Waves H1–H2 are covered by their own commits + the H1 decisions
memo; this retro picks up at H3._

## What shipped (by wave)

All waves merged + pushed to `origin/main` with `tsc` (0 errors), schema-leading-
index lint, and voice lint green, plus per-stream unit tests.

### Wave H3 — `3b28e873..dca46b2c`
- **H3.1** P0 bug fixes — `ai_requests` enforcement moved daily→**monthly** with
  rebaselined caps (killed the −980% Starter margin: Free 75/mo, Starter 1500/mo,
  Pro 12k/mo, Scale 50k/mo); Pulse **Reserves** axis now reads live
  `financial_ledger` vs the constitutional floor instead of a hardcoded 30; in-app
  trial unified to **14 days** (matched landing copy + Stripe checkout).
- **H3.2** Quinn alignment — `precall_failing_open_spike` detector (catches the
  pre-call constitutional checker silently failing open on infra failure) +
  `validatePaxResponse` now writes output-side breaches to
  `solene_constitutional_violations` (idempotent). The precall + postvalidate +
  audit **triad now converges on one forensic ledger**.
- **H3.3** L12+L13 — ReadOnlyDb wrapper + `app_role` schema convention (active-
  active replica safety).
- **H3.4** KB auto-publish draft queue (PII-redacted, founder-reviewed) + NPS
  prompt queue (daily scheduler → `/api/nps/pending`).
- **H3.5** Subscription **pause** (30/60/90d) as the cancellation 4th rung +
  `cancellation_reasons` founder surface; Stripe `pause_collection` sync.

### Wave H4 — `dca46b2c..5ae8471a`
- **H4.1** E7 — productionized the prompt-change **eval gate**: curated golden set,
  LLM-judge (reuses the existing Anthropic wrapper; opus-4-8 under test, haiku-4-5
  judge), `EvalGateRejectedError`, CI gate on prompt-touching PRs.
- **H4.2** E5+E6 — `TenantThemeProvider` (per-org branding via design tokens,
  layered over personal theme) + server-backed `useUiState` (optimistic + debounced
  sync; sidebar + pax-rail migrated).
- **H4.3** E10 — lifecycle **email registry**: one typed `sendRegisteredEmail`
  entrypoint (9 kinds, transactional vs lifecycle), suppression-aware, logged to
  `outbound_email_log`; 3 live senders rerouted.
- **H4.4** E8 — **App Intent registry**: single typed catalog of 60 intents
  (door + permission + approval); the Pax loop now sources its tool list from it
  (byte-for-byte parity proven across all 7 roles). This became the source of
  truth the H6.1 MCP endpoint builds on.
- **H4.5** Soren — `marketing_touch` event substrate (4 real emit points + post-
  signup identity join, privacy-locked) + **voice linter** wired into npm + CI.

### Wave H5 — `5ae8471a..9f7e4a31`
- **H5.1** E1 — `@acreos/solene` **package boundary** (first monorepo seam):
  workspace package + barrel re-export + path alias, build-green, no big-bang file
  move. Incremental relocation plan documented in `packages/solene/README.md`.
- **H5.2** E4 — **Pax-Support** resolution variant (confidence gate 60/70/90,
  billing pinned to 90; same Pax identity; mounted at
  `/api/support/tickets/:id/pax-resolve`).
- **H5.3** Andrei — `predictCostCents()` + centralized per-model pricing +
  **prompt-prefix cache** (`cache_control: ephemeral` on the stable system prefix)
  on the Pax hot path.
- **H5.4** Tess — W3C **traceparent** propagated through the outbox queue
  (enqueue→consume), **IR severity** locked to a typed single source of truth, and
  persisted **apiTelemetry** (`distinct_orgs` written + rolled up + read).

### Wave H6 — `9f7e4a31..626fe3b4`
- **H6.1** E12 — **MCP server endpoint** (`/api/mcp`, spec-compliant Streamable
  HTTP): AcreOS callable by external AI agents. Tool surface derived from the H4
  App Intent registry, filtered to a **safe read-only subset**, bearer-authed +
  org-scoped per request, founder/mutating intents hidden. (Agentic-web prep.)
- **H6.2** Beatrice — column-level **data-classification** registry (consumed by
  audit redaction + a lint gate) + customer-visible **audit log** written from 6
  real mutation paths, read at `/api/audit/log`, surfaced in Settings → Security.

## The recurring lesson: built ≠ mounted

The single most valuable thing Solene added on top of the agents this arc was the
**mount audit**. Worktree-isolated agents reliably _produce_ substrate but
repeatedly leave it un-wired. Caught and fixed this arc:
- H3.4 NPS scheduler defined but never registered.
- H3.5 pause gate authored as a global `app.use` when org is attached per-route —
  would have silently no-op'd; rewired into the `getOrCreateOrg` chokepoint.
- H3.5 `resumeExpiredPauses` worker referenced but never implemented.

Final holistic mount audit (H6.3): **18/18 substrates verified wired into a live
path.** This check is now a standing discipline — run it before declaring any
substrate-bearing wave complete.

## H6.3 holistic verification result

- `tsc` (8GB heap): **0 errors**. Schema-leading-index lint: **PASS**. Voice lint:
  **PASS** (0 errors, 148 warn-level numeric-provenance notes). Route cost-class
  check: clean.
- Full suite: **5660 passed / 5668**. The 8 failures are all in
  `server/services/solene/founderBypass.test.ts` (3 deterministic in isolation; the
  rest surface only under full-suite parallel module-mock pollution). **Pre-existing
  and out of arc scope** — neither `founderBypass.ts` (last changed by `8f18c121`,
  pre-arc) nor its test was modified this arc; the failures are a test-vs-impl
  mismatch on the cost-ceiling boundary (strict `>` vs `>=` at exactly $100). Left
  for a dedicated fix because the $100-boundary semantics touch founder capital
  authority (constitution capital controls) and warrant a Quinn/Tom call rather
  than a silent assertion flip. **Tracked as a follow-up, not a Tahoe regression.**

## Recovery notes (process)

- **Wave H3** was dispatched in a session that hit the weekly limit _before_ any
  commit — all 5 streams were stranded uncommitted (main working tree + worktrees).
  Recovered by reconstructing state from worktrees, verifying, and committing.
- **Wave H5** agents were cut off _mid-run_ by the session limit: H5.1/H5.3
  salvaged from worktrees (+ missing tests/fixes added); H5.2 left an unmounted
  stub and H5.4's worktree was gone — both re-dispatched fresh with **commit-early**
  instructions so partial work survives a future cutoff.
- **tsc OOMs at the default 4GB heap** on this codebase — always run
  `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`.
- **Migration numbering** is a coordination hazard with parallel agents — assign
  each stream an explicit number up front (this arc used 0109–0119; gaps at
  0114/0116/0117/0120 where streams needed no schema).

## Wave Hx — long-arc registry (Phase 2+ R&D, NOT in the H3–H6 scope)

Carried forward from the wave plan's "intentionally NOT in this arc" set + items
surfaced during execution. These are Iyari/horizon items, gated behind Phase 2+
(MRR thresholds) or an explicit founder call:

- **L7 C-corp transition** — Tom deferred (decision D2).
- **Pricing architecture pick** — awaiting Tom's read of Lena's alternatives doc.
- **Patent filings** — deferred until $1k MRR.
- **/transparency public UI** — premature without published data (schema exists).
- **Per-tenant alignment customer Settings panel** — schema-bound only; ships after
  first-customer signal.
- **Quinn's demographic-bias detector** — needs an Andrei+Quinn collaboration
  session before code.
- **VERTICAL_PACKS not mounted** — `shared/billing/tier-pricing.ts` defines the
  schema but there's no customer pricing surface + no Stripe IDs (built-not-mounted).
- **credit-weights foundation-only** — visible credit pools are decorative; action
  handlers don't draw from the pool yet.
- **App Intent registry → command palette** — H4.4 built the registry as a multi-
  surface catalog; only the Pax loop + MCP consume it. A customer command-palette /
  quick-action surface is the natural third consumer.
- **@acreos/solene physical relocation** — H5.1 established the seam via re-export;
  the actual file move (52 service + 16 schema files) is the documented next step.
- **Legacy MCP surface retirement** — `/api/mcp/execute` + the stdio
  `server/mcp/index.ts` (takes `organizationId` as an untrusted param) should be
  retired/hardened now that the spec-compliant `/api/mcp` exists.
- **apiTelemetry `total_cost_cents` rollup** — left at 0; needs per-route realized-
  cost capture on the samples table.
- **Iyari long-arc**: per-tenant constitutional-alignment SKU, parcel data layer,
  evidentiary e-sign, stablecoin escrow, on-device model harness.
- **S12 (peer) + S13 (first customer)** — Tom owns personally.

## Disciplines reaffirmed this arc

- Schema additions go to **all three**: `shared/schema.ts` (Drizzle) +
  `scripts/migrate.mjs` (raw SQL) + a numbered `migrations/NNNN_*.sql`.
- Org-scoped tables carry a **leading-org composite index** (enforced by
  `scripts/check-org-leading-index.mjs`).
- Customer-facing copy passes the **voice linter** (`npm run lint:voice`).
- Every wave: per-stream worktree isolation → merge → resolve additive conflicts
  (keep both) → full `tsc` + lints + tests → push → mount audit.
