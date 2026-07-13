# Solene Kernel Restructure — Verification Memo

_Work-order step 1 of the founder directive (2026-07-13). Every claim checked
against the live repo; where the repo contradicts the directive, the repo's
reality is recorded here and wins. Evidence gathered by three parallel
repo-wide audits + direct counts, 2026-07-13._

## Verdict summary

| Finding | Verdict | One-line reality |
|---|---|---|
| F1 — three unreconciled persona systems | **PARTIAL** | All three exist, but there are **four** systems, a thin reconciliation layer already exists, and only two of the four are live |
| F2 — governor outclasses the engine | **CONFIRMED** | Grades quoted exactly; zero agent commits in 30 days; 20 built-but-dark switches inventoried below |
| F3 — complexity mass vs. Phase 0 | **CONFIRMED (undercounted)** | Actual: 741 tables, 870 service files, 259 pages, 278 route files, ~516K server LOC — against $0 billable MRR (no Stripe keys) |
| F4 — constitution has no objective function | **CONFIRMED** | 22 prohibitions, zero objective/ranking keys; phase is prose-defined + partially machine-encoded in gateWatcher; no persisted "current phase" |

## F1 — persona systems (the directive's model needs one correction)

- **`sovereign-protocol/agents/`** — CONFIRMED: 12 codename dirs (atlas…shield),
  each a "Day 1 stub" persona + zeroed evolution scaffolding (empty
  evolution-log/session-log/golden-suite, all-zero metrics). Runtime readers:
  only the on-demand `routes-scp-v2.ts` API via `scpConfigVersioning.ts` /
  `scpEvolutionEngine.ts`. **No loop or cron reads them. Dormant.**
- **`docs/internal/team-roster-overview.md`** — CONFIRMED, but the roster is
  **13** named members (12 + optional Henrik), and these names ARE the
  canonical codenames in code (`shared/schema/agent-codenames.ts`). Consumed
  by the live Solene tick (`server/services/solene/continuousLoop.ts`,
  `runContinuousTick()` every 30 min from the worker). **Live.**
- **`oz/agent.acreos.yaml`** — CONFIRMED exists, but it is NOT a persona
  system: one generic external cloud-agent config (single
  `acreos-autonomous-engineer`), consumed only by the external Oz platform
  CLI, never by the app. **Not app-consumed.**
- **The directive misses a fourth system**: `server/services/companyAgents.ts`
  defines its own 12-codename roster (`atlas_cto`, `sophie_csm`,
  `forge_revenue`, …) and IS live — DB-seeded at startup
  (`runScheduledJobs.ts:4242`). This — not the SCP stubs — is the real live
  codename fork.
- **"Unreconciled" is partially wrong**: `agentCodenameAlias.ts` +
  `LEGACY_TO_CANONICAL_ALIAS` are an explicit bridge (atlas→iris,
  sophie→rafe, forge→soren, oracle→iris; unknown→iris fallback). But the
  bridge covers only 4 codenames; **9 of 12 SCP dirs are unbridged**, and oz
  shares nothing.

**Consequence for work-order step 4 (kernel consolidation):** the merge target
is correct (one actor: the Solene tick loop reading the 13-name roster), but
the consolidation must retire **companyAgents.ts's parallel roster** (the live
fork) in addition to archiving the SCP stubs and subordinating oz — and can
reuse the existing alias layer as the migration shim rather than building one.

## F2 — the governor outclasses the engine (confirmed, with the full inventory)

- Step-away doctrine grades verified verbatim (`docs/autopilot-step-away-doctrine.md`,
  2026-07-03): Economics **A−**, Grows itself **B−**, Evolves itself **C+**
  (also: Operates B+, Maintains B−, Reports B+).
- Zero agent commits in 30 days: confirmed by `solene-team-state.md` (all five
  agent identities "no commit in last 30 days") and by git history (last 40
  commits are all founder-authored).
- `SELF_PATCH_ENABLED` defaults OFF (`autopilot/settings.ts:51`); it is one of
  **four master switches, all defaulting OFF**, under the machine-unwritable
  `SOLENE_PANIC_STOP` floor.

### The Arming Inventory (built-but-dark, ranked by founder-minutes saved per flip)

**Tier 1 — flag flips only, no credentials, safety nets verified:**

| Switch | What arming does | Bounded by |
|---|---|---|
| `dispatchEnabled` (SOLENE_DISPATCH_ENABLED) | Solene's hands execute dispatches instead of thinking-only | Every domain still starts at `observe` tier; promotion needs 10 clean cycles; panic-stop floor |
| `cognitionEnabled` (COGNITION_ENABLED) | Daily autonomous Operator cadence | OBSERVE-first by design |
| `SCP_LLM_JUDGES_ENABLED` | Adds LLM-judge gauntlet gating every evolution delta | **Fails CLOSED** on judge error — this is a pure safety ADD |
| `publishEnabled` (AUTOPILOT_PUBLISH_ENABLED) | Arms outward-content path | Same trust ladder |
| ETL jobs `irs_soi_migration_v1`, `census_bps_permits_v1`, `bls_qcew_employment_v1` | Keyless federal data starts flowing into county scoring | Read-only ingestion; fail-loud |
| `INDEXNOW_KEY` | Search engines learn about public pages | Needs only a random string; fail-soft |
| `COMPLIANCE_STRICT_MODE` | Usury/Dodd-Frank violations BLOCK instead of warn | Strictly safer |

**Tier 2 — flag + credential already implied elsewhere:**

| Switch | Needs |
|---|---|
| `SELF_PATCH_ENABLED` | `GITHUB_TOKEN`/`GITHUB_REPOSITORY` set + earned OPS trust; output is PRs only — a human still merges (sacred) |

**Tier 3 — deliberately NOT recommended yet:**

| Switch | Why wait |
|---|---|
| `AUTONOMOUS_EXECUTOR_ENABLED` | Sends customer-facing emails autonomously; its own comment records it once did so without approval. Arm after retention data exists (Ignition Protocol ordering) |
| Meta campaign activation | Gated on Ignition Protocol: no paid ads until ~10 manual customers + week-4 retention |
| `LOB_LIVE_SEND_ENABLED` | Real physical mail + real spend; arm at first customer send need |
| Witness grants | Per-grant founder issuance by design (money/broadcast DEFAULT DENIED) |

**Cross-cutting facts:** every master switch defaults OFF via `ALL_OFF()`;
DB `null` never accidentally enables; `SOLENE_PANIC_STOP` forces everything
OFF and cannot be written by the machine. Zero agent commits with this much
machinery confirms the directive's core diagnosis.

## F3 — complexity mass (confirmed by direct count, 2026-07-13)

741 pgTable definitions · 870 service files · 259 client pages · 278 route
files · ~515,879 server LOC · 206 migrations — against Phase 0 (<$200 MRR;
currently $0 billable, Stripe unkeyed). The directive's numbers (~732/~823/260)
slightly undercount. E3 (surface ratchets that only shrink) is justified.

## F4 — constitution and objective function (confirmed)

- `sovereign-protocol/immutables.json`: 10 Sovereign Principles + 12 Customer
  Immutables, all prohibitions/negative duties. No objective, ranking,
  utility, or priority key anywhere in the constitutional layer or codebase.
- Integrity: CI SHA-256 byte + structural hash pins
  (`tests/unit/sovereign-protocol-immutables.test.ts`), amendment procedure
  documented in triplicate, commit message must contain "constitutional
  amendment", CEO-only under Principle 7. Runtime consumers exist
  (constitutionChecker, preCall screener, Pax validators, transparency page),
  so a new `objective` block would need loader (`immutables.ts`) + consumer
  changes, plus both hash fixtures bumped through the amendment procedure.
- Phase gates: prose truth in `docs/company/mature-machine.md`; thresholds
  machine-encoded in `autopilot/gateWatcher.ts` (GATES array: $200-MRR-held,
  25/100/~500-customer gates); **no persisted current-phase enum** — the
  directive's "promote the activation timeline into immutables as single
  source of truth" is exactly the missing piece.
- Founder-minutes: concept defined in mature-machine §0; partial computations
  exist (`autonomyScoreV14.ts` founderTimeSpentMs, weekly decision counts;
  founderWellbeing override counts) but no single "decisions consumed vs
  budget" number is computed today — work-order step 5 is real work, not
  wiring.

## Corrections the directive must absorb (repo wins)

1. Four persona systems, not three; the live fork to retire is
   `companyAgents.ts`, and the existing alias layer is the migration shim.
2. Roster is 13 (incl. optional Henrik), not 12.
3. "Unreconciled" overstates: a partial bridge exists (4/12 aliased).
4. The arming batch is not one flavor: Tier 1 is pure flag flips; self-patch
   needs a GitHub token; the executor/Meta/Lob switches belong to the
   Ignition Protocol sequence, not this batch.

## Next actions (per work order)

- **Step 2 (now):** Arming Checklist presented to the founder as one
  phone-answerable batch (Tier 1 / Tier 2 / explicit deferral of Tier 3).
- **Step 3:** objective block amendment to immutables.json via the documented
  amendment procedure (hash fixtures + "constitutional amendment" commit
  message) — Class A, requires founder sign-off, drafted only after the
  founder answers the checklist.
- **Step 4:** kernel consolidation targeting the corrected four-system
  reality.
- **Step 5:** tick metric — wire the two Letter-opening numbers from
  autonomyScoreV14's existing counters.
