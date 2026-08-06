# 01 — Gate coverage: the load-bearing six

*Phase 1, primary lane. Read the script, not the name. For each gate: what it matches, what a reader assumes it covers that it doesn't, the false-negative shape, and the proposed tightening. Cosmetic tier is in `02-cosmetic-gates.md`.*

---

## The one-paragraph verdict

Every one of the six is **real, honest about its own limits in its header comments, and narrower than its name.** None is a fig leaf. But three of them guard a *subset* of the surface their name implies, and the two most load-bearing — `no-fabrication` (the product's truth promise) and `org-scoped-fetch` (the tenant boundary) — are the narrowest of all: a single token over one-third of the server, and the storage layer only. **The defect classes that survive every gate concentrate exactly where these two stop looking: the client, `server/ai/`, `server/jobs/`, raw SQL, and every fabrication mechanism that isn't `Math.random`.**

---

## G1 — `lint:no-fabrication` (`scripts/check-no-fabrication.mjs`)  ← guards the load-bearing promise

**What it actually matches:** the literal token **`Math.random`** — nothing else — in exactly three server trees: `server/routes-*.ts`, `server/storage.ts` + `server/storage/**`, and `server/services/**`. Each current hit must be in a hand-curated allowlist tagged `id`/`jitter`/`P0-FIX-PENDING`/etc. Bidirectional ratchet (new hit fails; stale entry fails).

**What a reader assumes it covers that it does NOT:**
- **The client.** `client/src/**` is never scanned. A number fabricated or defaulted in a React component — where numbers are actually *rendered* — is invisible. (DEFECT-0066's synthetic-rectangle parcel boundary lived in `client/src/pages/properties.tsx`; this gate could never see it.)
- **`server/ai/**`.** `SERVICES_DIR` is `server/services`; `server/ai` is a *sibling* and is not walked. **AI output — the single most likely source of confident fabrication — is entirely outside the fabrication gate.**
- **`server/jobs/**`.** Background jobs that write fabricated values into tables are unscanned.
- **Every non-`Math.random` fabrication mechanism.** The script's own header says it does *not* scan `Date.now()`/`new Date()` as data, and does *not* classify fact-vs-id. So the whole class the brief names walks through: an aggregate over **zero rows** rendered as `0`/`100%` (the occupancy bug the ledger already caught), a **default presented as data**, a **stale cache** shown as current, an **integration failing open into empty success**, a **hardcoded constant** dressed as a live metric, **AI text presented as retrieved fact**.

**False-negative shape:** any fabricated fact that (a) is not the literal `Math.random`, or (b) lives in the client, `server/ai`, or `server/jobs`. That is most of the fabrication surface.

**Severity of the miss:** **P0-class.** This gate is the enforcement pointer for the constitution's `truth.no-fabrication` invariant — the product's core promise. It covers one mechanism in one-third of the server.

**Mitigations that already exist (so this isn't zero):** `killFabrications.test.ts`, the `noMockWidgets` ratchet (deletes `*_MOCK` constants), and the runtime AI eval gate cover slices of the rest. But there is no *systematic* gate for empty-set-as-measurement, which is the highest-value fabrication class for a zero-customer product (every account starts empty).

**Proposed tightening (hand this to slice 08 + T3 to seed):**
1. Extend the scan set to `server/ai/**` and `server/jobs/**` (cheap; same allowlist machinery). **Measured baseline needed:** run the scan over those two dirs first to seed the allowlist.
2. Add an **empty-set honesty** lint/test pattern: flag aggregates (`count`, `avg`, ratios) rendered without a `rows === 0 → "no data"` branch on the surfaces T3 traces. This is a targeted test, not a universal regex — scope it to the five first-seen numbers.
3. Client-side: an ESLint rule flagging numeric render of a value that can be `undefined`/`0`/default without an explicit empty state. High false-positive risk — scope to dashboard/metric components only.

---

## G2 — `lint:org-scoped-fetch` (`scripts/check-org-scoped-fetch.mjs`)  ← guards the tenant boundary

**What it actually matches:** storage-layer methods only. It parses `shared/schema*` for tables with an `organizationId` column, then walks **`server/storage.ts` + `server/storage/*.ts`** for `async` methods that touch such a table via `from(<ident>)`, `db.update(<ident>)`, or `db.delete(<ident>)` with a **literal table identifier**, and flags any whose text never *mentions* `organizationId`/`orgId`/`forOrg(`/`unscopedForPlatformOps(`. ~48 baseline offenders frozen.

**What a reader assumes it covers that it does NOT:**
- **Everything outside the storage layer.** Routes (`server/routes-*.ts`), services (`server/services/**`), jobs, webhook handlers, exports, and **`server/ai/tools.ts`** all query `db` directly and are **never scanned.** A cross-org query in a route handler is invisible here.
- **Raw SQL.** The heuristic requires a literal `from(ident)`/`update(ident)`/`delete(ident)`. Anything built via `sql.raw(...)`, `db.execute(sql\`...\`)`, or a table held in a variable is missed. (The 38 `sql.raw` sites are the exact blind spot — T4's hunting ground.)
- **"Mentions" ≠ "applies."** The gate's own *Known limitations* admit: a method that accepts an `orgId` but forgets to put it in the `WHERE` clause **passes** — the string appears in the signature, so the regex is satisfied while the predicate is absent.

**False-negative shape:** cross-tenant reads/writes in routes/services/jobs/AI-tools/raw-SQL, plus storage methods that take an org id and don't use it. The registry's DEFECT-0019/0071/0072 were all *outside* storage and had to be fixed by hand — this gate would not have caught any of them.

**Severity of the miss:** **P0-class** (cross-tenant leakage). Real but bounded coverage; the boundary is genuinely enforced *at the storage layer by construction* (`forOrg()`), which is the highest-traffic path. The gap is the direct-`db` paths.

**Proposed tightening:**
1. Extend the walk to `server/routes-*.ts` and `server/services/**` for the same `from(orgScopedTable)` pattern without org context. Expect a large initial baseline — seed with `--measure`, ratchet down. **This is the single highest-value new gate in the repo** and directly serves the first-customer trust goal.
2. A companion `sql.raw`-recurrence ratchet (see G-cross below) — the raw-SQL escape is currently ungated anywhere.
3. "Applies not mentions": out of reach for a regex; the converted-method vitest suite (emitted-SQL assertions) is the right tool — extend it to the direct-`db` call sites T4 finds.

---

## G3 — the constitution ratchet (`tests/unit/constitution.test.ts` over `shared/governance/constitution.ts`)

**What it actually checks:** (a) every enforcement `ref` path **resolves to a file that exists**; (b) `hardStops().length === 5`; (c) unenforced (prose-only) hard stops `≤ 0`. All hold at HEAD.

**What a reader assumes it covers that it does NOT:** that a hard-stop tagged `code-invariant` is *actually enforced*. **It checks the pointer exists, not that the pointed-to code still enforces the decision.** The real enforcement is inherited from each referenced test (`moneyCustodyHardStop.test.ts`, `spendHardStop.test.ts`, etc.). Gut the enforcement in `customerMoneyRouting.ts` but leave the file present and its test file present-but-hollow, and this meta-gate stays green.

**False-negative shape:** enforcement rot behind an intact filename. Low likelihood (the referenced tests are themselves real and run in the same suite), but it is a *paperwork-filed* check, not a *works* check.

**Severity of the miss:** **P2.** The design is sound — it makes governance debt countable and drives it to zero. The residual risk is delegated to the quality of each referenced test, which slices 07/09/15 assess individually.

**Proposed tightening:** none structural — this is the right shape. One improvement: the two `prose-only` items (`expansion.marketplace-25-api-50`, `ai.pax-stays-ambient`) are governance debt with no backstop; a customer-count gate for the expansion ladder and a Pax-surface gate would move them to `code-invariant` and are worth queuing (deferred until nearer the 25-customer trigger).

---

## G4 — `lint:reachability` (`scripts/lint-reachability.mjs`)  ← the repo's best gate

**What it checks:** four token-based counts, each ratcheted down-only — unreached exports in `services/`+`jobs/` (655), tables with no writer (45) / no reader (57), unregistered routes (1).

**What it honestly CANNOT see (from its own header — verified):**
- **Dynamic imports make a module opaque** → every export of an `await import("./x")` module is reported "opaque," **not counted as unreached.** A dead module reached only by a dynamic import is invisible. (This is precisely how the ledger's *second voice pipeline* and the `scp*` modules "looked referenced.")
- **String literals count as uses** → a registry, doc-comment, or inventory (`statuteRegister.ts`, `KNOWN_NON_MOUNTED`) that *names* a dead symbol resurrects it.
- **Common/short names** always look reached (collision).
- **Barrel re-exports don't count** as a use (good — a forwarded corpse stays dead).

**False-negative shape:** it **undercounts dead code** — deliberately, biasing to "miss a corpse" over "kill a live feature." So the reachability numbers are a *floor* on deadness, not the truth. The unadjudicated modules slice 04 finds via dynamic-import/registry indirection are exactly what this gate is structurally blind to.

**Severity of the miss:** **P2**, and *correct by design* — a reachability gate that false-positived would delete working features. The improvement is not to the gate but to feed its blind spots (dynamic-import registries) to the human/agent audit, which is what slice 04 + Phase 3 do.

**Proposed tightening:** add a **dynamic-import inventory** report (list every `await import(...)` target and whether *that* module's exports have any other reference) — turns the opaque set into a review queue instead of a silent pass. Cheap, high-yield for the deletion campaign.

---

## G5 — the `as-any` ratchet (`scripts/ratchet.mjs`, baseline 1417)

**What it matches:** the literal regex `as any` in `server/**/*.ts` (excl. tests), counted per-match, comment lines skipped. Bidirectional.

**What a reader assumes it covers that it does NOT:**
- **`: any` annotations** — the ~3,731-count sibling — are **completely uncounted.** A `: any` on `organizationId` erases the type exactly as `as any` would, and sails past. (This is slice 06's charge; the follow-on ratchet is the deliverable.)
- **`as unknown as X` double-casts** — the ratchet's *own note* records the rent-ledger using `as unknown as <shape>` **specifically to avoid this gate.** A double-cast erases types just as thoroughly and isn't matched. This is a sanctioned escape hatch that is also a blind spot.
- **`client/` and `shared/`** are out of scope — only `server/`.

**False-negative shape:** type erasure via `: any`, `as unknown as`, or in the client/shared trees. On a tenant key or money value, any of these is the `leads.organizationId`-widening class the ratchet exists to stop.

**Severity of the miss:** **P1** (blast radius includes tenant keys and money). The gate is genuinely driving the `as any` count down; the hole is the uncounted siblings.

**Proposed tightening (slice 06 owns, with measured baseline):** a `: any`-annotation ratchet over `server/**` (baseline ~3,731 — measure exactly and exclude generics-legit uses) plus an `as unknown as` counter folded into the existing `as-any` config. Rank the initial residue by blast radius before ratcheting so the count reduction targets tenant/money/auth first.

---

## G6 — the eval gate (`evals/` + `.github/workflows/eval.yml`)

**What it is:** two CI jobs on PRs touching AI paths (`evals/**`, `server/ai/**`, `server/services/*ai*`, `pax` prompts):
- **`eval`** — relative PR-vs-main regression on a golden set; **fails the check** (`exit 1`) if the score drops > 5%.
- **`eval-gate`** — absolute threshold `avgOverall ≥ 0.65` on a curated set via LLM judge; throws `EvalGateRejectedError`.
- Plus a separate **runtime** gate (`aiEvalHarness.gateOutputOrThrow`) that wraps live generations against CRITICAL DB cases → 422. (Stronger; slice 08 assesses.)

**What a reader assumes it covers that it does NOT:**
- **One dimension.** The judge scores a single **0–1 tone** number. **Factual grounding, tool-call correctness, refusal behavior, and injection resistance are unjudged.** A prompt change that makes Pax factually wrong or leaks a tool but stays on-tone **passes**.
- **The gate's real signal is contingent on `ANTHROPIC_API_KEY` in CI.** Without it, `eval-gate` **skips (exit 0)** and `eval` falls back to the **stub judge** (`judgeMode='stub'`, scores shape/topics only). If that secret isn't provisioned in this repo's Actions secrets, both gates pass everything silently. **This is a load-bearing dependency whose presence isn't verified anywhere.** (→ slice 13/08 to confirm the secret exists in CI.)
- **Model-under-test vs production.** The eval runs a **single fixed model** (`--model` default `claude-sonnet-4-6`). Production Solene/Pax routes **dynamically across four tiers** (`shared/schema/solene-chat-config.ts`: STRATEGIC=opus-4-8, CONVERSATIONAL=sonnet-4-6, FAST=haiku-4-5, CODE=sonnet-4-6) via a Haiku classifier. So the eval gates tone for the **default CONVERSATIONAL tier only**; a regression specific to the FAST (haiku) or STRATEGIC (opus) tier — or to whatever model actually serves customer-facing Pax, which slice 08 must confirm — is not caught.
- **Path-triggered, small golden set.** A change to a non-AI file that alters AI *behavior* (context assembly in a route) doesn't trigger the workflow; the golden set (`pax-conversations.json`) is small.

**Severity of the miss:** **P1.** The tone gate is real and blocks merges, but ~1 of ~40 (surface × dimension) cells is covered, and the whole thing is silently no-op without a CI secret.

**Proposed tightening (slice 08 delivers as a build plan):** the eval-coverage matrix below; wire the *production model resolution* into `run-eval.ts` so the model-under-test is whatever prod serves; add a CI assertion that fails loudly (not skips) if `ANTHROPIC_API_KEY` is absent on the main-branch gate.

### Eval coverage matrix (today → target)

| Surface \ Dimension | Tone | Factual grounding | Tool-call correctness | Refusal | Injection resistance |
|---|---|---|---|---|---|
| **Pax** | ✅ (Haiku judge, tone 0–1) | ❌ | ❌ | ❌ | partial (promptInjection.test.ts, HTTP boundary only) |
| **Sophie (support)** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Solene (founder)** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **supportAgent.ts** | ❌ | ❌ | ❌ (has `apply_bulk_fix` org guard, untested by eval) | ❌ | ❌ |
| **executive.ts** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **tools.ts** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **aiRouter.ts** | ❌ | ❌ | n/a | n/a | n/a |

**Fill order (slice 08 to justify): (1) tool-call correctness + org-scope for `tools.ts` and `supportAgent.ts` — side-effectful, tenant-touching, highest blast radius; (2) factual grounding for Pax (the fabrication class no other gate sees); (3) injection resistance beyond the HTTP boundary; (4) tone for the remaining surfaces.** Golden sets: reuse `pax-conversations.json` shape; seed tool-call cases from real tool schemas; seed grounding cases from the T3 number-provenance chains.

---

## Cross-cutting gate gap (feeds slices 07, 09, T4)

**`sql.raw` / `db.execute(sql\`...\`)` is gated by nothing.** 38 sites repo-wide. `no-fabrication` doesn't look for it; `org-scoped-fetch` can't match it; no ratchet counts it. DEFECT-0002 fixed two specific sites by hand; the *class* is ungated. **Proposed: a `sql.raw`-recurrence ratchet** (`pattern: "sql\\.raw\\("`, `globs: server/**`, measured baseline ≈ 38, direction down) so each new raw-SQL site is a conscious, reviewed decision — the same discipline as `table-count`. Pair with slice 07's per-site judgment (which of the 38 interpolate anything tenant- or user-derived).

---

## Summary — gate → covers → misses → tightening

| Gate | Covers | Biggest miss | Miss severity | Tightening (measured) |
|---|---|---|---|---|
| no-fabrication | `Math.random` in routes/storage/services | client, `server/ai`, `server/jobs`, all non-random fabrication (empty-set-as-data) | **P0-class** | scan ai+jobs; empty-set honesty test on T3 numbers |
| org-scoped-fetch | storage-layer literal-ident queries | routes/services/jobs/ai-tools/raw-SQL; "mentions≠applies" | **P0-class** | extend walk to routes+services; sql.raw ratchet |
| constitution | pointers resolve; hard-stops=5; unenforced≤0 | doesn't verify the code still enforces | P2 | none structural; 2 prose-only items → code-invariant later |
| reachability | unreached exports/tables/routes (token-based) | dynamic imports, registry/prose resurrection, name collisions (undercounts deadness) | P2 (by design) | dynamic-import inventory report |
| as-any | literal `as any` in `server/` | `: any` (~3,731), `as unknown as`, client/shared | P1 | `: any` ratchet (slice 06) + `as unknown as` counter |
| eval | Pax × tone (relative + absolute) | 39/40 matrix cells; no-op without CI key; single fixed model vs 4 prod tiers | P1 | eval matrix (slice 08); prod-model wiring; fail-loud on missing key |

**The pattern:** every gate is honest about its limits, and every gate's biggest miss is *the same region* — the code the storage/services/`Math.random` scanners don't reach (client, `server/ai`, `server/jobs`, raw SQL) and the *dimensions* single-metric gates don't score (grounding, tool-scope, injection). That region is where the surviving-defect classes live, and it's exactly where the fan-out slices are pointed.
