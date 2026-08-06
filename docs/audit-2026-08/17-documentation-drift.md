# 17 — Documentation Drift

*Slice 17. Read-only. Charge: stale doc claims that become a future session's confident-wrong assumption.*

The immune system gates **code** but nothing gates **prose about code**. Docs, ledgers, and the defect registry are edited by hand and never diffed against reality, so they rot silently. The single defect class that survives every gate here: **the deletion ledger's "KILL" verdicts and evidence pointers describe files that were renamed or already gone, so a fresh session cannot act on them** — most damagingly the row the ledger itself calls "the biggest pure win," which is fully un-executed while pointing at dead filenames and wrong line numbers. Registry rows and the README architecture block have also drifted off measured reality.

---

### F-17-1 — Deletion-ledger's "biggest pure win" KILL points at dead filenames + stale line numbers; the ~2,763-LOC target is still fully mounted
**Severity:** P1 serious
**Surfaced by:** slice 17
**Survives which gates:** No gate reads the deletion ledger. The reachability ratchet (`unregisteredRoutes`) checks routers ARE mounted, not that ledger prose matches disk. `constitution.test.ts` checks constitution pointers, not ledger pointers. Nothing diffs ledger evidence against the filesystem.
**Evidence:** `docs/company/deletion-ledger.md:16` (row "Founder narrative routers V6–V14") cites `server/routes-founder-*.ts mounted in routes.ts:1792-1807` and `nav-items.ts:293-298`, verdict plain **KILL**, no "executed" note. Reality: those filenames do not exist (`ls server/routes-founder-v6.ts` → gone); the routers were **renamed**, not deleted, and all 8 exist and are mounted at `server/routes.ts:1865-1879` (`routes-founder-sovereign-company.ts` 275L, `-learning-company.ts` 259L, `-living-organization.ts` 132L, `-conscious-organization.ts` 494L, `-anticipatory-enterprise.ts` 453L, `-real-runtime.ts` 383L, `-sentient-enterprise.ts` 390L, `-self-running-company.ts` 377L ≈ 2,763 LOC). `routes.ts:1792-1807` is now unrelated support routers; `nav-items.ts:293-298` is ops nav, not retired doors. The "dozens of `*V1[0-4].ts` service suites" also survive: 43 files, 17,328 LOC (`ls server/services/*V[6-9].ts server/services/*V1[0-4].ts`), still imported by the live routers.
**What's wrong:** The KILL was never executed, but every pointer in the row is stale. A fresh session opening the ledger to run the "biggest pure win" greps for `routes-founder-v6.ts`, finds nothing, and concludes the deletion already happened — so ~20K LOC the ledger marks for deletion silently survives the halving campaign. The row's "several synthetic (`Math.random` data)" claim is also unverifiable at the cited files (sampled routers/services show no `Math.random`).
**Impact:** Neither (internal) — but it burns the shrink campaign: the ledger's own top-priority KILL is un-actionable, so ~20K of the ~440K LOC gap stays put and the next session trusts a false "done."
**Fix:** Rewrite ledger row 16: update filenames to the 8 `routes-founder-<name>.ts`, fix the mount ref to `routes.ts:1865-1879`, list the 43 surviving `*V[6-14].ts` services with a real LOC count, and either mark KILL-pending with a live task or execute it. Drop the stale `Math.random` claim unless re-grounded.
**Gate it:** Add a `lint:ledger-refs` that parses `file.ts:LINE` and `` `path` `` tokens from `deletion-ledger.md` + `defect-registry.md` and fails when a cited path does not exist on disk. Baseline: measure current dangling-ref count first (this row alone contributes ≥3).
**Effort:** M (rewrite row + write the lint)
**Blast radius:** `docs/company/deletion-ledger.md`; the 8 routers + 43 services if the KILL is then executed.
**Confidence:** high — filenames, mount lines, and LOC all measured at HEAD.

---

### F-17-2 — The vN→narrative-name router rename is recorded NOWHERE; only `routes.ts` import lines hold the mapping
**Severity:** P2 real
**Surfaced by:** slice 17
**Survives which gates:** No gate. The mapping lives implicitly in `registerFounderV6Routes` being exported from `routes-founder-sovereign-company.ts` — a naming mismatch no linter flags.
**Evidence:** `server/routes.ts:1865` `const { registerFounderV6Routes } = await import("./routes-founder-sovereign-company")` … through `:1879` `registerFounderV14Routes` from `-self-running-company`. No doc, ledger, ADR, or CLAUDE.md note states "V6=sovereign-company, V7=learning-company, V8=living-organization, V10=conscious-organization, V11=anticipatory-enterprise, V12=real-runtime, V13=sentient-enterprise, V14=self-running-company." (No V9 mount exists.)
**What's wrong:** Every prior audit/ledger/registry references these surfaces by "V6–V14," but the files no longer carry those names. The only decoder ring is the import statements. A fresh session reading any historical doc that says "V13" has no written way to find `routes-founder-sentient-enterprise.ts`.
**Impact:** Neither — but this is the exact "what does a fresh session most need that is written nowhere" gap: the identity map between historical names and current files.
**Fix:** Add a short table (vN ⇄ filename ⇄ mounted?) to the deletion-ledger row or CLAUDE.md "Known monoliths" section. Cheap; unblocks every future reference.
**Gate it:** none possible cleanly (naming convention); the table itself is the mitigation, kept honest by F-17-1's ledger-ref lint once names are corrected.
**Effort:** S
**Blast radius:** one doc table.
**Confidence:** high.

---

### F-17-3 — DEFECT-0059 marked "P2 OPEN" but was resolved 2026-05-11 (V1 onboarding wizard deleted)
**Severity:** P3 minor
**Surfaced by:** slice 17
**Survives which gates:** The defect registry is a hand-maintained markdown file; no gate reconciles `Status:` against code. Orientation flagged this for slice 17; confirmed here.
**Evidence:** `docs/audits/defect-registry.md:601-608` — DEFECT-0059 `Severity: P2 / Status: OPEN`, evidence "Both files exist and both have routes defined," remediation "Canonicalize on V2." Reality: `client/src/App.tsx:496` "standalone `/pages/onboarding-wizard.tsx` page was deleted as redundant"; `App.tsx:36` "`OnboardingWizard` is no longer mounted. `/onboarding-v2` is the" canonical; `find client/src -iname "*onboarding-wizard*"` returns nothing. Resolved by the 2026-05-11 consolidation (`App.tsx:494`).
**What's wrong:** The registry still advertises a resolved P2 as OPEN with an evidence line ("both files exist") that is factually false at HEAD. It's the only OPEN row a future session would try to "fix," wasting a cycle rediscovering it's done.
**Impact:** Neither — internal noise; erodes trust in the registry's OPEN list (19 OPEN rows, this one already false).
**Fix:** Set DEFECT-0059 `Status: FIXED`, `Resolving commits:` the 2026-05-11 onboarding-consolidation commit. Sweep the other 18 OPEN rows the same way.
**Gate it:** Extend F-17-1's ledger-ref lint to also assert each registry row whose evidence cites a specific path still has that path on disk; a FIXED-but-OPEN with a deleted evidence file is auto-flaggable.
**Effort:** S
**Blast radius:** `docs/audits/defect-registry.md`.
**Confidence:** high.

---

### F-17-4 — README architecture block counts drifted from measured reality (services, tables, pages)
**Severity:** P3 minor
**Surfaced by:** slice 17
**Survives which gates:** README is documentation; `table-count` ratchet (748) governs code but not the README prose that names a different number.
**Evidence:** `README.md:118` "services/ 823 service files" — actual `find server/services -name "*.ts"` = **991** (+168). `README.md:123` "schema.ts … (491 tables)" — actual `grep -c pgTable( shared/schema.ts` = **500**. `README.md:124` "schema/ … (241 more tables; 732 total)" — actual **244 / 748** (matches the ratchet baseline 748). `README.md:112` "pages/ 260 page components" — actual **258**.
**What's wrong:** Four hard numbers in the README are stale. The table total (732) directly contradicts the `table-count` ratchet baseline (748) a fresh session will also read, producing a "which is right?" moment on the very metric the halving campaign tracks.
**Impact:** Neither — but the README is the first file a new session/contributor reads; wrong table count undermines confidence in the shrink narrative.
**Fix:** Update the four numbers, or replace them with "~" ranges plus a pointer to `scripts/ratchets/table-count.json` as source of truth.
**Gate it:** A tiny `lint:readme-stats` regenerating the counts and diffing — or simpler, delete the exact counts from README and cite the ratchet JSON (single source of truth), needing no gate.
**Effort:** S
**Blast radius:** `README.md`.
**Confidence:** high.

---

### F-17-5 — README lists "OpenAI (optional fallback)" as current stack while an active migration is deleting all OpenAI callsites
**Severity:** P3 minor
**Surfaced by:** slice 17
**Survives which gates:** None; two docs disagree and nothing cross-checks them.
**Evidence:** `README.md` Stack table "AI | OpenRouter (primary), OpenAI (optional fallback)" vs `docs/openai-bypass-migration.md:1-10` "Status: in progress … all 68 callsites converted by 2026-09-08" — direct OpenAI clients are being removed because they bypass the per-org cost ceiling, Haiku kill-switch, and telemetry.
**What's wrong:** The README frames OpenAI as a supported fallback; the migration doc frames every direct OpenAI call as a defect to be routed through `routeAITask`. A fresh session gets contradictory guidance on whether adding an OpenAI call is fine.
**Impact:** Neither — but risks a new session reintroducing a bypass the migration is actively removing.
**Fix:** README should say "AI: OpenRouter via `routeAITask` (single AI gateway); direct OpenAI calls are being retired — see `docs/openai-bypass-migration.md`."
**Gate it:** none needed beyond fixing the line; the migration's own `routeAITask` adoption count is the real gate.
**Effort:** S
**Blast radius:** `README.md`.
**Confidence:** medium — README "fallback" is defensible today, but misleading given the migration's direction.

---

## Coverage ledger

**Examined exhaustively (read + grounded against code at HEAD `5ca0f29`):**
- `docs/company/deletion-ledger.md` verdict table (rows 16–30) and "Executed deletions (log)" header; verified voice, satellite/vision, SCP-5, and founder-V6-V14 executed/unexecuted claims against the filesystem and `routes.ts` mounts.
- `docs/audits/defect-registry.md` — DEFECT-0059 fully; header P0 rows 0001–0005 read; OPEN-row count (19) enumerated (line offsets 492–672).
- `README.md` in full; every architecture-block number and Stack row spot-checked against `find`/`grep` counts and against `shared/billing/tier-pricing.ts` (pricing $20/$49/$79 — **accurate**, no drift), `server/services/emailService.ts` (SES — accurate), `batchdata-provider.ts` (accurate), `fly.toml` (IAD — accurate).
- `docs/openai-bypass-migration.md` header.
- CLAUDE.md founder-route doctrine cross-checked vs `founderFourDoors.test.ts` (baseline 82) and `founder-doors.ts` (5 `/founder` entries) — **consistent, no drift**.

**Examined by sampling:**
- The ~69 top-level `docs/*.md` files: listed and triaged by title/size; only those touching my charge (README, ledger, registry, openai-bypass) opened. Individual runbooks/SLO/security docs NOT line-audited.
- V-suite service files: counted (43) and 3 sampled for `Math.random`; not each read.

**Did NOT examine:**
- `docs/OWNERS-MANUAL.md` (59K), `research-land-investing-intelligence.md` (76K), the `docs/company/open-data-*` set, `docs/audits/v5|v6|v7|sweeps|lenses|red-team` historical trees — large, mostly-archival, out of a medium-depth budget. Stale claims there are lower-blast-radius (historical, not load-bearing for a fresh session's mental model).
- The other 18 registry OPEN rows were not individually reconciled against code (only 0059 confirmed stale); F-17-3's fix prescribes that sweep.
- ADRs (`docs/adr/`) and `docs/architecture/` not opened.

## Constitution Collisions

None. Every finding is documentation-only; no finding proposes a new nav entry, marketplace/API expansion, money-custody change, AI destination, or fabrication. The narrative routers in F-17-1 are founder-only and auth-mounted after the SCPv2 guard (`routes.ts:1863`); flagging their ledger row as stale does not touch the constitution — executing that KILL later would only shrink surface, which the doctrine favors.
